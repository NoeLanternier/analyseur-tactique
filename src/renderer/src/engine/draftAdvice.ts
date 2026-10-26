import type { ChampionPool, DraftState } from '../../../shared/types'
import type { Catalog } from './catalog'
import type { ChampInfo, GameData } from './gameData'
import { profileOf } from './threat'

// Conseils de pick et de ban pour la jungle, à partir des statistiques Master+ du patch
// (taux de victoire de chaque jungler et de chaque affrontement de junglers), de la composition
// des deux équipes et de la maîtrise du joueur sur ses champions.

export interface PickAdvice {
  champ: ChampInfo
  /** Taux de victoire estimé (lissé) dans cette situation. */
  winRate: number
  score: number
  reasons: string[]
  inPool: boolean
}

export interface BanAdvice {
  champ: ChampInfo
  score: number
  reasons: string[]
}

export interface DraftAdvice {
  picks: PickAdvice[]
  bans: BanAdvice[]
  /** Jungler adverse supposé (le plus souvent joué jungle parmi les choix adverses). */
  enemyJungler: ChampInfo | null
}

const bayes = (games: number, wr: number, prior: number, k: number): number =>
  (wr * games + prior * k) / (games + k)
const pct = (x: number): string => `${(x * 100).toFixed(1).replace('.', ',')} %`

export function computeDraftAdvice(
  gd: GameData,
  catalog: Catalog,
  draft: DraftState,
  pool: ChampionPool | null
): DraftAdvice {
  const stats = catalog.junglerStats ?? {}
  const taken = new Set([...draft.allyIds, ...draft.enemyIds, ...draft.bannedIds])
  const owned = new Set(pool?.owned ?? [])
  const masteryOf = new Map((pool?.mastery ?? []).map((m) => [m.championId, m.points]))

  // Junglers connus : statistiques du patch, sinon base de builds.
  const jungleIds = new Set([...Object.keys(stats), ...catalog.builds.keys()])
  const junglers = [...jungleIds]
    .map((id) => gd.championsById.get(id))
    .filter((c): c is ChampInfo => !!c)

  // Jungler adverse : le choix adverse le plus joué en jungle.
  const enemyChamps = draft.enemyIds
    .map((k) => gd.champions.get(k))
    .filter((c): c is ChampInfo => !!c)
  const enemyJungler =
    enemyChamps
      .filter((c) => (stats[c.id]?.games ?? 0) >= 100)
      .sort((a, b) => (stats[b.id]?.games ?? 0) - (stats[a.id]?.games ?? 0))[0] ?? null

  // Équilibre de dégâts et ligne de front de l'équipe alliée.
  const allies = draft.allyIds.map((k) => gd.champions.get(k)).filter((c): c is ChampInfo => !!c)
  const allyProfiles = allies.map((c) => profileOf(c, catalog.profiles))
  const allyAp = allyProfiles.length
    ? allyProfiles.reduce((s, p) => s + p.ap, 0) / allyProfiles.length
    : 0.5
  const allyFront = allyProfiles.reduce((s, p) => s + p.tank, 0)

  // Pool du joueur : ses junglers les plus maîtrisés.
  const playable = junglers.filter(
    (c) => (owned.size === 0 || owned.has(c.key)) && !taken.has(c.key)
  )
  const byMastery = junglers
    .filter((c) => (masteryOf.get(c.key) ?? 0) > 0)
    .sort((a, b) => (masteryOf.get(b.key) ?? 0) - (masteryOf.get(a.key) ?? 0))
    .slice(0, 8)
  const poolIds = new Set(byMastery.map((c) => c.key))

  const scorePick = (c: ChampInfo): PickAdvice => {
    const s = stats[c.id]
    const reasons: string[] = []
    let wr = s ? bayes(s.games, s.winRate, 0.5, 60) : 0.5
    if (s) reasons.push(`${pct(s.winRate)} sur ${s.games.toLocaleString('fr-FR')} parties`)
    if (enemyJungler && s?.vs[enemyJungler.id]) {
      const [g, vsWr] = s.vs[enemyJungler.id]
      wr = bayes(g, vsWr, wr, 25)
      if (g >= 8) reasons.push(`${pct(vsWr)} contre ${enemyJungler.name} (${g} parties)`)
    }
    let fit = 0
    const p = profileOf(c, catalog.profiles)
    if (allies.length >= 2) {
      if (allyAp < 0.3 && p.ap >= 0.6) {
        fit += 0.012
        reasons.push('apporte les dégâts magiques qui manquent')
      } else if (allyAp > 0.7 && p.ap <= 0.4) {
        fit += 0.012
        reasons.push('apporte les dégâts physiques qui manquent')
      } else if ((allyAp < 0.3 && p.ap <= 0.3) || (allyAp > 0.7 && p.ap >= 0.7)) {
        fit -= 0.008
      }
      if (allyFront < 0.6 && p.tank >= 0.6) {
        fit += 0.008
        reasons.push('ligne de front pour l’équipe')
      }
    }
    const mastery = masteryOf.get(c.key) ?? 0
    const comfort = mastery > 0 ? Math.min(0.015, Math.log10(mastery) / 400) : 0
    if (mastery >= 50000) reasons.push(`${Math.round(mastery / 1000)} k points de maîtrise`)
    return { champ: c, winRate: wr, score: wr + fit + comfort, reasons, inPool: poolIds.has(c.key) }
  }

  const scored = playable.map(scorePick).sort((a, b) => b.score - a.score)
  const fromPool = scored.filter((x) => x.inPool).slice(0, 3)
  // Un pick fort hors de tes champions habituels, s'il dépasse nettement ton meilleur choix.
  const outside = scored.find(
    (x) =>
      !x.inPool &&
      x.winRate - (fromPool[0]?.winRate ?? 0) >= 0.015 &&
      (stats[x.champ.id]?.games ?? 0) >= 150
  )
  const picks = fromPool.length ? [...fromPool, ...(outside ? [outside] : [])] : scored.slice(0, 3)

  // Bans : junglers forts et fréquents, et ceux qui battent tes champions principaux (le plus
  // joué compte davantage). On ne propose jamais de bannir un de tes propres champions.
  const myTop = byMastery.slice(0, 3)
  const RANK_WEIGHT = [1, 0.6, 0.4]
  const totalGames = Object.values(stats).reduce((s, j) => s + j.games, 0) || 1
  const bans: BanAdvice[] = junglers
    .filter((c) => !taken.has(c.key) && !poolIds.has(c.key) && (stats[c.id]?.games ?? 0) >= 50)
    .map((c) => {
      const s = stats[c.id]
      const reasons: string[] = []
      const strength = bayes(s.games, s.winRate, 0.5, 60) - 0.5
      const presence = Math.sqrt(s.games / totalGames)
      let score = strength * (0.5 + 3 * presence)
      if (strength > 0.01)
        reasons.push(`${pct(s.winRate)} sur ${s.games.toLocaleString('fr-FR')} parties`)
      myTop.forEach((mine, rank) => {
        const vs = stats[mine.id]?.vs[c.id]
        if (vs && vs[0] >= 8) {
          const delta = 0.5 - bayes(vs[0], vs[1], 0.5, 20)
          score += delta * 0.8 * RANK_WEIGHT[rank]
          if (vs[1] < 0.46) reasons.push(`bat ${mine.name} (${pct(vs[1])} pour toi)`)
        }
      })
      return { champ: c, score, reasons }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  return { picks, bans, enemyJungler }
}
