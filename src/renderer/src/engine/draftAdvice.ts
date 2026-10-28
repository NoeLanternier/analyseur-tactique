import type { ChampionPool, DraftState } from '../../../shared/types'
import type { Catalog, JunglerStat } from './catalog'
import type { ChampInfo, GameData } from './gameData'
import { profileOf } from './threat'
import { fmtNumber, fmtPct, tr } from '../../../shared/i18n'

// Conseils de pick et de ban pour la jungle, à partir des statistiques Master+ du patch :
// - taux de victoire de chaque jungler ;
// - affrontement avec le jungler adverse, s'il est connu ;
// - taux de victoire avec chaque allié et contre chaque adversaire déjà choisis (la draft est
//   souvent incomplète quand on choisit : seuls les champions visibles comptent) ;
// - risque d'être contré quand le jungler adverse n'est pas encore choisi ;
// - équilibre de la composition, maîtrise du joueur et ses propres résultats (bilans).

export interface PickAdvice {
  champ: ChampInfo
  /** Taux de victoire estimé dans cette draft (lissé). */
  winRate: number
  score: number
  /** Raisons, la première étant le taux de victoire global du champion. */
  reasons: string[]
  inPool: boolean
  /** Jungler adverse inconnu : sûr ou risqué de le choisir maintenant (null = rien à signaler). */
  blind: 'safe' | 'risky' | null
}

export interface BanAdvice {
  champ: ChampInfo
  score: number
  reasons: string[]
}

export interface DraftAdvice {
  picks: PickAdvice[]
  bans: BanAdvice[]
  /** Jungler adverse supposé parmi les choix adverses (null tant qu'il n'est pas choisi). */
  enemyJungler: ChampInfo | null
  /** Nombre d'alliés (sur 4) et d'adversaires (sur 5) déjà choisis. */
  known: { allies: number; enemies: number }
}

/** Résultats du joueur par champion (bilans d'après-partie). */
export type PersonalRecord = Map<string, { games: number; wins: number }>

const bayes = (games: number, wr: number, prior: number, k: number): number =>
  (wr * games + prior * k) / (games + k)
const logit = (p: number): number => Math.log(p / (1 - p))
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x))
const pct = (x: number): string => fmtPct(x, 1)
const pts = (x: number): string => `${x > 0 ? '+' : '−'}${fmtNumber(Math.abs(x) * 100, 1)}`

/** Lissage des paires (allié / adversaire) : il faut beaucoup de parties pour s'écarter du global. */
const PAIR_K = 40
/** Effet cumulé maximal des alliés et adversaires, en log-odds (≈ ±6 points). */
const PAIR_CAP = 0.25
/** Part des parties où l'adversaire choisit un contre quand on se dévoile tôt. */
const COUNTER_PICK_RATE = 0.35

/** Part des parties d'un champion jouées en jungle (null si inconnue). */
function jungleShare(catalog: Catalog, c: ChampInfo): number | null {
  const jungle = catalog.junglerStats?.[c.id]?.games ?? 0
  const all = catalog.profiles?.[c.id]?.games ?? 0
  if (all < 50) return null
  return Math.min(1, jungle / all)
}

/**
 * Jungler adverse parmi les champions adverses visibles : celui qui joue le plus souvent jungle.
 * Tant qu'aucun d'eux n'est un jungler habituel, il est considéré comme pas encore choisi.
 */
export function findEnemyJungler(catalog: Catalog, enemies: ChampInfo[]): ChampInfo | null {
  const stats = catalog.junglerStats ?? {}
  const candidates = enemies.filter((c) => (stats[c.id]?.games ?? 0) >= 100)
  if (!candidates.length) return null
  const shares = candidates.map((c) => ({ c, share: jungleShare(catalog, c) }))
  if (shares.some((x) => x.share !== null)) {
    const best = shares
      .filter((x) => x.share !== null && x.share >= 0.35)
      .sort((a, b) => b.share! - a.share!)[0]
    return best?.c ?? null
  }
  return candidates.sort((a, b) => (stats[b.id]?.games ?? 0) - (stats[a.id]?.games ?? 0))[0]
}

interface PairEffect {
  champ: ChampInfo
  ally: boolean
  /** Écart propre à ce jungler (lissé, en log-odds), effet général du champion retiré. */
  delta: number
  games: number
}

/** Effet d'une paire [parties, taux] sur le taux du jungler, en log-odds. */
function pairDelta(pair: [number, number] | undefined, base: number, k: number): number {
  if (!pair) return 0
  return logit(bayes(pair[0], pair[1], base, k)) - logit(base)
}

export function computeDraftAdvice(
  gd: GameData,
  catalog: Catalog,
  draft: DraftState,
  pool: ChampionPool | null,
  personal: PersonalRecord | null = null
): DraftAdvice {
  const stats = catalog.junglerStats ?? {}
  const taken = new Set([...draft.allyIds, ...draft.enemyIds, ...draft.bannedIds])
  const owned = new Set(pool?.owned ?? [])
  const masteryOf = new Map((pool?.mastery ?? []).map((m) => [m.championId, m.points]))
  const totalGames = Object.values(stats).reduce((s, j) => s + j.games, 0) || 1

  // Junglers connus : statistiques du patch, sinon base de builds.
  const jungleIds = new Set([...Object.keys(stats), ...catalog.builds.keys()])
  const junglers = [...jungleIds]
    .map((id) => gd.championsById.get(id))
    .filter((c): c is ChampInfo => !!c)

  const toChamps = (ids: number[]): ChampInfo[] =>
    ids.map((k) => gd.champions.get(k)).filter((c): c is ChampInfo => !!c)
  const enemies = toChamps(draft.enemyIds)
  const allies = toChamps(draft.allyIds)
  const enemyJungler = findEnemyJungler(catalog, enemies)
  const otherEnemies = enemies.filter((c) => c !== enemyJungler)

  // Équilibre de dégâts et ligne de front de l'équipe alliée.
  const allyProfiles = allies.map((c) => profileOf(c, catalog.profiles))
  const allyAp = allyProfiles.length
    ? allyProfiles.reduce((s, p) => s + p.ap, 0) / allyProfiles.length
    : 0.5
  const allyFront = allyProfiles.reduce((s, p) => s + p.tank, 0)

  // Junglers adverses encore possibles (ni choisis ni bannis), avec leur fréquence.
  const openEnemyJunglers =
    enemyJungler || enemies.length >= 5
      ? []
      : junglers.filter((c) => !taken.has(c.key) && (stats[c.id]?.games ?? 0) >= 150)

  // Effet « général » d'un allié ou d'un adversaire, commun à tous les junglers (un champion fort
  // fait gagner son équipe quel que soit le jungler) : il est retiré pour ne garder que l'effet
  // propre à chaque jungler (synergie, affrontement).
  const baseOf = (j: JunglerStat): number => bayes(j.games, j.winRate, 0.5, 60)
  const generalEffect = (champ: ChampInfo, side: 'with' | 'against'): number => {
    let weight = 0
    let sum = 0
    for (const j of Object.values(stats)) {
      const pair = j[side][champ.id]
      if (!pair) continue
      weight += pair[0]
      sum += pair[0] * pairDelta(pair, baseOf(j), PAIR_K)
    }
    return weight > 0 ? sum / weight : 0
  }
  const general = new Map<string, number>()
  for (const a of allies) general.set(`with:${a.id}`, generalEffect(a, 'with'))
  for (const e of otherEnemies) general.set(`against:${e.id}`, generalEffect(e, 'against'))

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
    const s: JunglerStat | undefined = stats[c.id]
    const reasons: string[] = []
    const base = s ? bayes(s.games, s.winRate, 0.5, 60) : 0.5
    let z = logit(base)
    reasons.push(
      s
        ? tr(
            `${pct(s.winRate)} sur ${fmtNumber(s.games)} parties`,
            `${pct(s.winRate)} over ${fmtNumber(s.games)} games`
          )
        : tr('pas de statistiques ce patch', 'no stats this patch')
    )

    // Jungler adverse connu : affrontement direct.
    if (s && enemyJungler && s.vs[enemyJungler.id]) {
      const [g, vsWr] = s.vs[enemyJungler.id]
      z += pairDelta(s.vs[enemyJungler.id], base, 25)
      if (g >= 8)
        reasons.push(
          tr(
            `${pct(vsWr)} contre ${enemyJungler.label} (${g} parties)`,
            `${pct(vsWr)} vs ${enemyJungler.label} (${g} games)`
          )
        )
    }

    // Alliés et adversaires déjà choisis.
    let blind: PickAdvice['blind'] = null
    if (s) {
      const effects: PairEffect[] = []
      const effect = (champ: ChampInfo, side: 'with' | 'against'): void => {
        const pair = s[side][champ.id]
        if (!pair) return
        const delta = pairDelta(pair, base, PAIR_K) - (general.get(`${side}:${champ.id}`) ?? 0)
        effects.push({ champ, ally: side === 'with', delta, games: pair[0] })
      }
      for (const a of allies) effect(a, 'with')
      for (const e of otherEnemies) effect(e, 'against')
      const sum = effects.reduce((t, x) => t + x.delta, 0)
      z += clamp(sum, -PAIR_CAP, PAIR_CAP)
      const notable = effects
        .map((x) => ({ ...x, points: sigmoid(logit(base) + x.delta) - base }))
        .filter((x) => x.games >= 30 && Math.abs(x.points) >= 0.01)
        .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
        .slice(0, 2)
      for (const x of notable) {
        const p = pts(x.points)
        reasons.push(
          x.ally
            ? x.points > 0
              ? tr(`bon avec ${x.champ.label} (${p} pts)`, `good with ${x.champ.label} (${p} pts)`)
              : tr(
                  `moins bon avec ${x.champ.label} (${p} pts)`,
                  `weaker with ${x.champ.label} (${p} pts)`
                )
            : x.points > 0
              ? tr(
                  `fort contre ${x.champ.label} (${p} pts)`,
                  `strong vs ${x.champ.label} (${p} pts)`
                )
              : tr(
                  `souffre contre ${x.champ.label} (${p} pts)`,
                  `struggles vs ${x.champ.label} (${p} pts)`
                )
        )
      }

      // Jungler adverse pas encore choisi : risque qu'il prenne un contre.
      if (openEnemyJunglers.length) {
        const known = openEnemyJunglers
          .filter((e) => e.id !== c.id && (s.vs[e.id]?.[0] ?? 0) >= 15)
          .map((e) => ({ e, wr: bayes(s.vs[e.id][0], s.vs[e.id][1], base, 25) }))
        const coverage =
          known.reduce((t, x) => t + (stats[x.e.id]?.games ?? 0), 0) /
          openEnemyJunglers.reduce((t, e) => t + (stats[e.id]?.games ?? 0), 0)
        const counters = known.filter((x) => x.wr <= base - 0.02).sort((a, b) => a.wr - b.wr)
        if (counters.length) {
          const worst = counters.slice(0, 3)
          const loss = base - worst.reduce((t, x) => t + x.wr, 0) / worst.length
          z = logit(clamp(sigmoid(z) - COUNTER_PICK_RATE * loss, 0.05, 0.95))
          if (loss >= 0.03) {
            blind = 'risky'
            const names = counters
              .slice(0, 2)
              .map((x) => x.e.label)
              .join(', ')
            reasons.push(tr(`contré par ${names}`, `countered by ${names}`))
          }
        } else if (coverage >= 0.6) {
          blind = 'safe'
          reasons.push(tr('peu de contres', 'few counters'))
        }
      }
    }

    // Composition de l'équipe (dégâts, ligne de front).
    let fit = 0
    const p = profileOf(c, catalog.profiles)
    if (allies.length >= 2) {
      if (allyAp < 0.3 && p.ap >= 0.6) {
        fit += 0.012
        reasons.push(
          tr('apporte les dégâts magiques qui manquent', 'adds the missing magic damage')
        )
      } else if (allyAp > 0.7 && p.ap <= 0.4) {
        fit += 0.012
        reasons.push(
          tr('apporte les dégâts physiques qui manquent', 'adds the missing physical damage')
        )
      } else if ((allyAp < 0.3 && p.ap <= 0.3) || (allyAp > 0.7 && p.ap >= 0.7)) {
        fit -= 0.008
      }
      if (allyFront < 0.6 && p.tank >= 0.6) {
        fit += 0.008
        reasons.push(tr('ligne de front pour l’équipe', 'frontline for the team'))
      }
    }

    // Tes propres résultats sur ce champion (léger : peu de parties).
    let mine = 0
    const rec = personal?.get(c.id)
    if (rec && rec.games >= 3) {
      const est = sigmoid(z)
      mine = 0.5 * (bayes(rec.games, rec.wins / rec.games, est, 10) - est)
      if (rec.games >= 5)
        reasons.push(
          tr(
            `tes parties : ${rec.wins} V – ${rec.games - rec.wins} D`,
            `your games: ${rec.wins} W – ${rec.games - rec.wins} L`
          )
        )
    }

    const mastery = masteryOf.get(c.key) ?? 0
    const comfort = mastery > 0 ? Math.min(0.015, Math.log10(mastery) / 400) : 0
    if (mastery >= 50000)
      reasons.push(
        tr(
          `${Math.round(mastery / 1000)} k points de maîtrise`,
          `${Math.round(mastery / 1000)}k mastery points`
        )
      )
    const winRate = sigmoid(z)
    return {
      champ: c,
      winRate,
      score: winRate + fit + comfort + mine,
      reasons,
      inPool: poolIds.has(c.key),
      blind
    }
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
  const bans: BanAdvice[] = junglers
    .filter((c) => !taken.has(c.key) && !poolIds.has(c.key) && (stats[c.id]?.games ?? 0) >= 50)
    .map((c) => {
      const s = stats[c.id]
      const reasons: string[] = []
      const strength = bayes(s.games, s.winRate, 0.5, 60) - 0.5
      const presence = Math.sqrt(s.games / totalGames)
      let score = strength * (0.5 + 3 * presence)
      if (strength > 0.01)
        reasons.push(
          tr(
            `${pct(s.winRate)} sur ${fmtNumber(s.games)} parties`,
            `${pct(s.winRate)} over ${fmtNumber(s.games)} games`
          )
        )
      myTop.forEach((mine, rank) => {
        const vs = stats[mine.id]?.vs[c.id]
        if (vs && vs[0] >= 8) {
          const delta = 0.5 - bayes(vs[0], vs[1], 0.5, 20)
          score += delta * 0.8 * RANK_WEIGHT[rank]
          if (vs[1] < 0.46)
            reasons.push(
              tr(
                `bat ${mine.label} (${pct(vs[1])} pour toi)`,
                `beats ${mine.label} (${pct(vs[1])} for you)`
              )
            )
        }
      })
      return { champ: c, score, reasons }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  return {
    picks,
    bans,
    enemyJungler,
    known: { allies: Math.min(4, allies.length), enemies: Math.min(5, enemies.length) }
  }
}
