import type { LiveGameData, LivePlayer, RawPostGame } from '../../../shared/types'
import { getBuild, type Benchmark, type Catalog } from './catalog'
import type { ChampInfo, GameData, ItemInfo } from './gameData'
import { buildItemPlan } from './items'
import { analyzeThreat } from './threat'

/* eslint-disable @typescript-eslint/no-explicit-any */

// Bilan d'après-partie.
//
// 1. normalizeGame : convertit l'historique du client (format Riot « V4 » ou « V5 ») en données
//    compactes (GameFacts), enregistrées sur le disque.
// 2. analyzeGame : rejoue la partie minute par minute et produit le bilan : ce qui a été bien ou
//    mal fait (farm, build, combats, objectifs, vision) et, pour chaque objet acheté, ce que
//    l'application conseillait à ce moment-là (inventaires et scores reconstitués).
//
// Les bilans sont recalculés à partir des GameFacts à chaque lancement : une amélioration du moteur
// s'applique donc aussi aux anciennes parties.

export const FACTS_VERSION = 1
const SMITE = 11
const CONTROL_WARD = 2055

export interface FactPlayer {
  pid: number
  team: number
  champ: number
  smite: boolean
  win: boolean
  k: number
  d: number
  a: number
  cs: number
  jcs: number
  gold: number
  level: number
  items: number[]
  phys: number
  magic: number
  heal: number
  cc: number
  vision: number
  wards: number
  controlWards: number
}

export type MonsterKind = 'dragon' | 'elder' | 'grubs' | 'herald' | 'baron' | 'atakhan'

export interface GameFacts {
  v: number
  gameId: number
  createdAt: number
  /** Durée en secondes. */
  duration: number
  queueId: number
  version: string
  me: number
  perks: { primary: number; sub: number; ids: number[] } | null
  players: FactPlayer[]
  /** frames[minute][pid - 1] = [or total, or en poche, sbires + monstres, niveau]. */
  frames: number[][][]
  /** [seconde, pid, objet, op] : 1 achat, 0 vente/destruction, 2 achat annulé, 3 vente annulée. */
  items: [number, number, number, number][]
  /** [seconde, tueur, victime, assistants]. */
  kills: [number, number, number, number[]][]
  /** [seconde, tueur, équipe, type]. */
  monsters: [number, number, number, MonsterKind][]
}

const num = (x: any): number => (typeof x === 'number' && Number.isFinite(x) ? x : Number(x) || 0)

/** Convertit les données du client. Renvoie un motif si la partie n'est pas une partie jungle. */
export function normalizeGame(raw: RawPostGame): GameFacts | { skip: string } {
  const g: any = (raw.game as any)?.info ?? raw.game
  if (!g || !Array.isArray(g.participants)) return { skip: 'données illisibles' }
  const mapId = num(g.mapId)
  if (mapId && mapId !== 11) return { skip: 'pas la Faille de l’invocateur' }
  const duration = num(g.gameDuration) > 20000 ? num(g.gameDuration) / 1000 : num(g.gameDuration)
  if (duration < 600) return { skip: 'partie trop courte (remake)' }

  // Joueur local : puuid, sinon identifiant d'invocateur.
  let me = 0
  const identities: any[] = Array.isArray(g.participantIdentities) ? g.participantIdentities : []
  for (const id of identities) {
    const p = id?.player ?? {}
    if (
      (raw.puuid && p.puuid === raw.puuid) ||
      (raw.summonerId && num(p.summonerId) === raw.summonerId)
    )
      me = num(id.participantId)
  }
  if (!me) {
    const p = g.participants.find((x: any) => raw.puuid && x.puuid === raw.puuid)
    if (p) me = num(p.participantId)
  }
  if (!me) return { skip: 'joueur introuvable dans la partie' }

  const players: FactPlayer[] = g.participants.map((p: any): FactPlayer => {
    const s = p.stats ?? p
    const spells = [num(p.spell1Id ?? p.summoner1Id), num(p.spell2Id ?? p.summoner2Id)]
    const items: number[] = []
    for (let i = 0; i <= 6; i++) if (num(s[`item${i}`]) > 0) items.push(num(s[`item${i}`]))
    return {
      pid: num(p.participantId),
      team: num(p.teamId),
      champ: num(p.championId),
      smite: spells.includes(SMITE),
      win: s.win === true || s.win === 'Win',
      k: num(s.kills),
      d: num(s.deaths),
      a: num(s.assists),
      cs: num(s.totalMinionsKilled),
      jcs: num(s.neutralMinionsKilled),
      gold: num(s.goldEarned),
      level: num(s.champLevel),
      items,
      phys: num(s.physicalDamageDealtToChampions),
      magic: num(s.magicDamageDealtToChampions),
      heal: num(s.totalHeal),
      cc: num(s.timeCCingOthers),
      vision: num(s.visionScore),
      wards: num(s.wardsPlaced),
      controlWards: num(s.visionWardsBoughtInGame ?? s.detectorWardsPlaced)
    }
  })
  const mine = players.find((p) => p.pid === me)
  if (!mine?.smite) return { skip: 'pas joué en jungle (sans Châtiment)' }

  const sm = g.participants.find((p: any) => num(p.participantId) === me)
  const st = sm?.stats ?? {}
  let perks: GameFacts['perks'] = null
  if (num(st.perk0)) {
    perks = {
      primary: num(st.perkPrimaryStyle),
      sub: num(st.perkSubStyle),
      ids: [0, 1, 2, 3, 4, 5].map((i) => num(st[`perk${i}`]))
    }
  } else if (Array.isArray(sm?.perks?.styles)) {
    const styles = sm.perks.styles
    perks = {
      primary: num(styles[0]?.style),
      sub: num(styles[1]?.style),
      ids: styles.flatMap((x: any) => (x.selections ?? []).map((y: any) => num(y.perk)))
    }
  }

  const facts: GameFacts = {
    v: FACTS_VERSION,
    gameId: num(g.gameId) || raw.gameId,
    createdAt: num(g.gameCreation),
    duration,
    queueId: num(g.queueId),
    version: String(g.gameVersion ?? ''),
    me,
    perks,
    players,
    frames: [],
    items: [],
    kills: [],
    monsters: []
  }

  const tl: any = raw.timeline
  const frames: any[] = Array.isArray(tl?.frames)
    ? tl.frames
    : Array.isArray(tl?.info?.frames)
      ? tl.info.frames
      : []
  const teamOf = new Map(players.map((p) => [p.pid, p.team]))
  for (const f of frames) {
    const pf = f?.participantFrames ?? {}
    const row: number[][] = players.map((p) => {
      const x = pf[String(p.pid)] ?? {}
      return [
        num(x.totalGold),
        num(x.currentGold),
        num(x.minionsKilled) + num(x.jungleMinionsKilled),
        num(x.level)
      ]
    })
    facts.frames.push(row)
    for (const e of f?.events ?? []) {
      const t = Math.round(num(e.timestamp) / 1000)
      const pid = num(e.participantId)
      switch (e.type) {
        case 'ITEM_PURCHASED':
          facts.items.push([t, pid, num(e.itemId), 1])
          break
        case 'ITEM_SOLD':
        case 'ITEM_DESTROYED':
          facts.items.push([t, pid, num(e.itemId), 0])
          break
        case 'ITEM_UNDO':
          if (num(e.beforeId) > 0) facts.items.push([t, pid, num(e.beforeId), 2])
          if (num(e.afterId) > 0) facts.items.push([t, pid, num(e.afterId), 3])
          break
        case 'CHAMPION_KILL':
          facts.kills.push([
            t,
            num(e.killerId),
            num(e.victimId),
            Array.isArray(e.assistingParticipantIds) ? e.assistingParticipantIds.map(num) : []
          ])
          break
        case 'ELITE_MONSTER_KILL': {
          const type = String(e.monsterType ?? '')
          const sub = String(e.monsterSubType ?? '')
          const kind: MonsterKind | null =
            type === 'DRAGON'
              ? sub.includes('ELDER')
                ? 'elder'
                : 'dragon'
              : type === 'BARON_NASHOR'
                ? 'baron'
                : type === 'RIFTHERALD'
                  ? 'herald'
                  : type === 'HORDE'
                    ? 'grubs'
                    : type === 'ATAKHAN'
                      ? 'atakhan'
                      : null
          const killer = num(e.killerId)
          const team = num(e.killerTeamId) || teamOf.get(killer) || 0
          if (kind && team) facts.monsters.push([t, killer, team, kind])
          break
        }
      }
    }
  }
  return facts
}

// --- Rejeu ------------------------------------------------------------------------------------

/** Inventaire d'un joueur à un instant donné, reconstitué à partir des achats et ventes. */
export function inventoryAt(facts: GameFacts, pid: number, t: number): Map<number, number> {
  const inv = new Map<number, number>()
  const add = (id: number, n: number): void => {
    const v = (inv.get(id) ?? 0) + n
    if (v > 0) inv.set(id, v)
    else inv.delete(id)
  }
  for (const [time, who, id, op] of facts.items) {
    if (time > t) break
    if (who !== pid) continue
    if (op === 1 || op === 3) add(id, 1)
    else add(id, -1)
  }
  return inv
}

/** Achats effectifs d'un joueur (les achats annulés sont retirés). */
export function purchasesOf(facts: GameFacts, pid: number): { t: number; id: number }[] {
  const out: { t: number; id: number }[] = []
  for (const [t, who, id, op] of facts.items) {
    if (who !== pid) continue
    if (op === 1) out.push({ t, id })
    else if (op === 2) {
      const idx = out.map((x) => x.id).lastIndexOf(id)
      if (idx >= 0) out.splice(idx, 1)
    }
  }
  return out
}

function frameAt(facts: GameFacts, t: number): number[][] | null {
  if (!facts.frames.length) return null
  return facts.frames[Math.max(0, Math.min(facts.frames.length - 1, Math.floor(t / 60)))]
}

const riotIdOf = (facts: GameFacts, pid: number): string =>
  pid === facts.me ? 'moi#0' : `joueur${pid}#0`

/** Données « en jeu » reconstituées à l'instant t (même format que l'API Live Client Data). */
export function liveAt(gd: GameData, facts: GameFacts, t: number): LiveGameData {
  const frame = frameAt(facts, t)
  const score = new Map<number, { k: number; d: number; a: number }>()
  for (const p of facts.players) score.set(p.pid, { k: 0, d: 0, a: 0 })
  for (const [time, killer, victim, assists] of facts.kills) {
    if (time > t) break
    if (score.has(killer)) score.get(killer)!.k++
    if (score.has(victim)) score.get(victim)!.d++
    for (const a of assists) if (score.has(a)) score.get(a)!.a++
  }
  const players: LivePlayer[] = facts.players.map((p, idx) => {
    const champ = gd.champions.get(p.champ)
    const inv = inventoryAt(facts, p.pid, t)
    let slot = 0
    const items = [...inv.entries()].map(([itemID, count]) => {
      const info = gd.items.get(itemID)
      return {
        itemID,
        count,
        slot: info?.tags.includes('Trinket') ? 6 : slot++
      }
    })
    const s = score.get(p.pid)!
    return {
      championName: champ?.name ?? '',
      rawChampionName: `game_character_displayname_${champ?.id ?? ''}`,
      riotId: riotIdOf(facts, p.pid),
      summonerName: '',
      team: p.team === 100 ? 'ORDER' : 'CHAOS',
      level: frame?.[idx]?.[3] || 1,
      isDead: false,
      items,
      scores: {
        kills: s.k,
        deaths: s.d,
        assists: s.a,
        creepScore: frame?.[idx]?.[2] ?? 0,
        wardScore: 0
      }
    }
  })
  const meIdx = facts.players.findIndex((p) => p.pid === facts.me)
  return {
    gameTime: t,
    activePlayer: {
      riotId: riotIdOf(facts, facts.me),
      summonerName: '',
      currentGold: frame?.[meIdx]?.[1] ?? 0,
      level: frame?.[meIdx]?.[3] || 1
    },
    allPlayers: players
  }
}

// --- Bilan ------------------------------------------------------------------------------------

export type Category = 'farm' | 'build' | 'fights' | 'objectives' | 'vision'

export const CATEGORY_LABEL: Record<Category, string> = {
  farm: 'Farm et avance',
  build: 'Build',
  fights: 'Combats et morts',
  objectives: 'Objectifs',
  vision: 'Vision'
}

export interface Finding {
  id: string
  cat: Category
  tone: 'good' | 'bad'
  title: string
  detail?: string
  /** Importance (0..1) pour trier les points. */
  impact: number
}

export interface PurchaseCheck {
  t: number
  item: ItemInfo
  /** follow : l'objet conseillé à ce moment ; plan : prévu plus tard ou en alternative ; off : hors plan. */
  status: 'follow' | 'plan' | 'off'
  suggested: ItemInfo | null
}

export type ObjectiveCount = Record<MonsterKind, number>

export interface GameStats {
  csPerMin: number
  cs10: number | null
  cs15: number | null
  csDiff10: number | null
  goldDiff15: number | null
  levelDiff15: number | null
  kp: number
  visionPerMin: number
  controlWardsPer10: number
  firstItemMin: number | null
  secondItemMin: number | null
  deathsWithGold: number
  earlyDeaths: number
  unspentShare: number | null
}

export interface GameReport {
  facts: GameFacts
  champ: ChampInfo | null
  enemyJungler: ChampInfo | null
  win: boolean
  kda: string
  minutes: number
  scores: Partial<Record<Category, number>>
  overall: number
  grade: 'S' | 'A' | 'B' | 'C' | 'D'
  findings: Finding[]
  purchases: PurchaseCheck[]
  /** Part des achats conformes au conseil de l'app (null sans chronologie). */
  adherence: number | null
  objectives: { team: ObjectiveCount; enemy: ObjectiveCount; smited: number }
  stats: GameStats
  /** Objets légendaires achetés, dans l'ordre. */
  legendaries: ItemInfo[]
  bench: Benchmark
  benchSource: 'master' | 'défaut'
  hasTimeline: boolean
}

/** Repères d'un jungler Master+ (remplacés par les vrais chiffres de la méta distante). */
export const DEFAULT_BENCH: Benchmark = {
  games: 0,
  cs10: 68,
  cs15: 104,
  gold15: 5700,
  level15: 11.2,
  firstItem: 11.5,
  secondItem: 19.5,
  kp: 0.6,
  visionPerMin: 1.05,
  controlWardsPer10: 1.1
}

/** Conseils associés aux points faibles (affichés en rappel avant les parties suivantes). */
export const TIPS: Record<string, string> = {
  'cs-low': 'Enchaînez les camps entre deux actions : pas de temps mort sans farm.',
  'gold-behind': 'Suivez le jungler adverse : contre-gank ou contre-jungle du côté opposé.',
  'first-item-late': 'Visez votre 1er objet vers {first} min : farm + retour au bon moment.',
  'off-build': 'Suivez l’ordre d’objets conseillé, il s’adapte à la partie.',
  'no-antiheal': 'Face aux soins, achetez le composant anti-soins tôt.',
  'no-mr': 'Face à beaucoup de magie, prenez de la résistance magique.',
  'no-armor': 'Face à beaucoup de dégâts physiques, prenez de l’armure.',
  'deaths-gold': 'Rentrez dépenser votre or avant de prendre un risque.',
  'unspent-gold': 'Rentrez dès que vous avez de quoi acheter un composant important.',
  'early-deaths': 'Avant 14 min, ne vous battez pas sans vision ni avantage de niveau.',
  'many-deaths': 'Moins de morts : placez-vous derrière vos tanks en combat.',
  'kp-low': 'Participez davantage aux actions de vos voies (ganks, contre-ganks).',
  'objectives-lost': 'Préparez les dragons 1 min avant : vision, retour, poussée des voies.',
  'grubs-lost': 'Les larves du Néant comptent : prenez-les quand le haut est poussé.',
  'no-control-ward': 'Achetez une balise de contrôle à chaque retour.',
  'vision-low': 'Posez vos balises et changez de totem selon la phase de jeu.'
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** Note 0..100 : 75 au niveau du repère, 100 à +15 %, 20 à −25 %. */
function rate(value: number, target: number, lowerIsBetter = false): number {
  if (target <= 0) return 75
  const r = lowerIsBetter ? target / Math.max(value, 0.01) : value / target
  if (r >= 1.15) return 100
  if (r >= 1) return 75 + ((r - 1) / 0.15) * 25
  if (r >= 0.75) return 20 + ((r - 0.75) / 0.25) * 55
  return Math.max(0, 20 - (0.75 - r) * 80)
}

const fmtMin = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
const fr1 = (x: number): string => x.toFixed(1).replace('.', ',')
const signed = (x: number): string => (x >= 0 ? `+${Math.round(x)}` : `${Math.round(x)}`)

const OBJ_WEIGHT: Record<MonsterKind, number> = {
  dragon: 1,
  elder: 2,
  grubs: 0.35,
  herald: 1,
  baron: 1.6,
  atakhan: 1.4
}

const emptyCount = (): ObjectiveCount => ({
  dragon: 0,
  elder: 0,
  grubs: 0,
  herald: 0,
  baron: 0,
  atakhan: 0
})

export function gradeOf(score: number): GameReport['grade'] {
  return score >= 85 ? 'S' : score >= 72 ? 'A' : score >= 58 ? 'B' : score >= 45 ? 'C' : 'D'
}

export function analyzeGame(gd: GameData, catalog: Catalog, facts: GameFacts): GameReport {
  const me = facts.players.find((p) => p.pid === facts.me)!
  const meIdx = facts.players.indexOf(me)
  const champ = gd.champions.get(me.champ) ?? null
  const allies = facts.players.filter((p) => p.team === me.team && p.pid !== me.pid)
  const foes = facts.players.filter((p) => p.team !== me.team)
  const enemyJ = foes.find((p) => p.smite) ?? null
  const enemyJIdx = enemyJ ? facts.players.indexOf(enemyJ) : -1
  const minutes = facts.duration / 60
  const hasTimeline = facts.frames.length >= 5
  const bench =
    (champ && catalog.benchmarks?.[champ.id]) ?? catalog.benchmarks?.['_all'] ?? DEFAULT_BENCH
  const benchSource = bench === DEFAULT_BENCH ? 'défaut' : 'master'
  const findings: Finding[] = []
  const push = (f: Finding): void => {
    findings.push(f)
  }
  const sub: Record<Category, number[]> = {
    farm: [],
    build: [],
    fights: [],
    objectives: [],
    vision: []
  }
  const frameVal = (min: number, idx: number, k: number): number | null =>
    facts.frames.length > min && idx >= 0 ? facts.frames[min][idx][k] : null

  // --- Farm et avance sur le jungler adverse ---
  const csPerMin = (me.cs + me.jcs) / Math.max(minutes, 1)
  const cs10 = frameVal(10, meIdx, 2)
  const cs15 = frameVal(15, meIdx, 2)
  const csDiff10 = cs10 !== null && enemyJIdx >= 0 ? cs10 - frameVal(10, enemyJIdx, 2)! : null
  const gold15 = frameVal(15, meIdx, 0)
  const goldDiff15 = gold15 !== null && enemyJIdx >= 0 ? gold15 - frameVal(15, enemyJIdx, 0)! : null
  const level15 = frameVal(15, meIdx, 3)
  const levelDiff15 =
    level15 !== null && enemyJIdx >= 0 ? level15 - frameVal(15, enemyJIdx, 3)! : null
  const ejName = enemyJ ? (gd.champions.get(enemyJ.champ)?.name ?? 'le jungler adverse') : ''

  if (cs10 !== null) {
    const s = rate(cs10, bench.cs10)
    sub.farm.push(s)
    if (s < 45)
      push({
        id: 'cs-low',
        cat: 'farm',
        tone: 'bad',
        title: `Farm faible : ${cs10} cs à 10 min`,
        detail: `Repère Master+ : ${Math.round(bench.cs10)} cs.`,
        impact: 0.6 + (45 - s) / 100
      })
    else if (s >= 85)
      push({
        id: 'cs-good',
        cat: 'farm',
        tone: 'good',
        title: `Très bon farm : ${cs10} cs à 10 min`,
        detail: `Repère Master+ : ${Math.round(bench.cs10)} cs.`,
        impact: 0.5
      })
  } else {
    sub.farm.push(rate(csPerMin, bench.cs15 / 15))
  }
  if (cs15 !== null) sub.farm.push(rate(cs15, bench.cs15))
  if (goldDiff15 !== null) {
    sub.farm.push(Math.max(0, Math.min(100, 70 + goldDiff15 / 30)))
    if (goldDiff15 <= -800)
      push({
        id: 'gold-behind',
        cat: 'farm',
        tone: 'bad',
        title: `En retard sur ${ejName} : ${signed(goldDiff15)} po à 15 min`,
        detail:
          levelDiff15 !== null && levelDiff15 < 0
            ? `${levelDiff15} niveau(x) de retard.`
            : undefined,
        impact: 0.6 + Math.min(0.4, -goldDiff15 / 5000)
      })
    else if (goldDiff15 >= 600)
      push({
        id: 'gold-ahead',
        cat: 'farm',
        tone: 'good',
        title: `En avance sur ${ejName} : ${signed(goldDiff15)} po à 15 min`,
        impact: 0.5 + Math.min(0.4, goldDiff15 / 5000)
      })
  }

  // --- Build : rythme d'achat, choix d'objets, anti-soins, résistances ---
  const buys = purchasesOf(facts, me.pid)
  const legendaryBuys = buys.filter((b) => gd.items.get(b.id)?.isLegendary)
  const seen = new Set<number>()
  const legendaries: ItemInfo[] = []
  const legendaryTimes: number[] = []
  for (const b of legendaryBuys) {
    if (seen.has(b.id)) continue
    seen.add(b.id)
    legendaries.push(gd.items.get(b.id)!)
    legendaryTimes.push(b.t)
  }
  if (!hasTimeline) {
    // Sans chronologie : objets de fin de partie.
    for (const id of me.items) {
      const it = gd.items.get(id)
      if (it?.isLegendary && !seen.has(id)) {
        seen.add(id)
        legendaries.push(it)
      }
    }
  }
  const firstItemMin = legendaryTimes[0] !== undefined ? legendaryTimes[0] / 60 : null
  const secondItemMin = legendaryTimes[1] !== undefined ? legendaryTimes[1] / 60 : null
  if (hasTimeline) {
    if (firstItemMin !== null) {
      const s = rate(firstItemMin, bench.firstItem, true)
      sub.build.push(s)
      if (firstItemMin > bench.firstItem + 2.5)
        push({
          id: 'first-item-late',
          cat: 'build',
          tone: 'bad',
          title: `1er objet tardif : ${fr1(firstItemMin)} min`,
          detail: `Repère Master+ : ${fr1(bench.firstItem)} min.`,
          impact: 0.5 + Math.min(0.3, (firstItemMin - bench.firstItem) / 20)
        })
      else if (firstItemMin <= bench.firstItem - 0.5)
        push({
          id: 'first-item-fast',
          cat: 'build',
          tone: 'good',
          title: `1er objet rapide : ${fr1(firstItemMin)} min`,
          impact: 0.4
        })
    } else if (minutes >= 16) {
      sub.build.push(15)
      push({
        id: 'first-item-late',
        cat: 'build',
        tone: 'bad',
        title: 'Aucun objet légendaire terminé',
        impact: 0.8
      })
    }
    if (secondItemMin !== null) sub.build.push(rate(secondItemMin, bench.secondItem, true))
  }

  // Conformité aux conseils de l'app, achat par achat (inventaires reconstitués).
  const purchases: PurchaseCheck[] = []
  const build = champ ? getBuild(catalog, champ).build : null
  if (hasTimeline && build && champ) {
    const enemyKeys = foes.map((p) => p.champ)
    const allyKeys = allies.map((p) => p.champ)
    const done = new Set<number>()
    for (const b of legendaryBuys) {
      if (done.has(b.id)) continue
      done.add(b.id)
      const t = Math.max(0, b.t - 1)
      const live = liveAt(gd, facts, t)
      const meLive = live.allPlayers.find((p) => p.riotId === live.activePlayer?.riotId) ?? null
      const threat = analyzeThreat(gd, enemyKeys, allyKeys, live, champ.id, catalog.profiles)
      const plan = buildItemPlan(gd, build, threat, meLive, live.activePlayer?.currentGold ?? 0)
      const pending = plan.steps.filter((s) => !s.owned && s.item.isLegendary)
      const item = gd.items.get(b.id)!
      const same = (x: ItemInfo): boolean => x.id === item.id || x.name === item.name
      const status: PurchaseCheck['status'] =
        pending[0] && same(pending[0].item)
          ? 'follow'
          : pending.some((s) => same(s.item)) || plan.alternatives.some((s) => same(s.item))
            ? 'plan'
            : 'off'
      purchases.push({ t: b.t, item, status, suggested: pending[0]?.item ?? null })
    }
  }
  const adherence = purchases.length
    ? purchases.reduce(
        (s, p) => s + (p.status === 'follow' ? 1 : p.status === 'plan' ? 0.6 : 0),
        0
      ) / purchases.length
    : null
  if (adherence !== null) {
    sub.build.push(30 + adherence * 70)
    const off = purchases.filter((p) => p.status === 'off')
    if (off.length >= 2 || (off.length === 1 && purchases.length <= 2))
      push({
        id: 'off-build',
        cat: 'build',
        tone: 'bad',
        title: `${off.length} objet(s) hors du build conseillé`,
        detail: off
          .map(
            (p) => `${p.item.nameFr}${p.suggested ? ` (conseillé : ${p.suggested.nameFr})` : ''}`
          )
          .join(' · '),
        impact: 0.35 + 0.1 * off.length
      })
    else if (adherence >= 0.8 && purchases.length >= 2)
      push({
        id: 'follow-build',
        cat: 'build',
        tone: 'good',
        title: 'Build adapté à la partie',
        detail: 'Vos achats suivent les conseils calculés pour cette composition.',
        impact: 0.35
      })
  }

  // Anti-soins : besoin estimé comme l'app le fait avant la partie.
  const preThreat = analyzeThreat(
    gd,
    foes.map((p) => p.champ),
    allies.map((p) => p.champ),
    null,
    champ?.id ?? null,
    catalog.profiles
  )
  const grievousBuy = buys.find((b) => gd.items.get(b.id)?.grievous)
  const ownsGrievous = !!grievousBuy || me.items.some((id) => gd.items.get(id)?.grievous)
  if (preThreat.metrics.heal >= 0.55 && minutes >= 18) {
    const healers = [...foes]
      .sort((a, b) => b.heal - a.heal)
      .slice(0, 2)
      .map((p) => gd.champions.get(p.champ)?.name)
      .filter(Boolean)
      .join(', ')
    if (!ownsGrievous) {
      sub.build.push(25)
      push({
        id: 'no-antiheal',
        cat: 'build',
        tone: 'bad',
        title: 'Pas d’anti-soins',
        detail: `Soins adverses importants (${healers}).`,
        impact: 0.7
      })
    } else if (grievousBuy && grievousBuy.t > 18 * 60) {
      push({
        id: 'no-antiheal',
        cat: 'build',
        tone: 'bad',
        title: `Anti-soins tardif (${fmtMin(grievousBuy.t)})`,
        detail: `Soins adverses importants (${healers}) : composant dès le 1er ou 2e retour.`,
        impact: 0.45
      })
    } else {
      push({
        id: 'antiheal-ok',
        cat: 'build',
        tone: 'good',
        title: 'Anti-soins pris à temps',
        detail: healers ? `Face à ${healers}.` : undefined,
        impact: 0.35
      })
    }
  }

  // Résistances face aux dégâts réellement subis (si beaucoup de morts).
  const foePhys = foes.reduce((s, p) => s + p.phys, 0)
  const foeMagic = foes.reduce((s, p) => s + p.magic, 0)
  const magicShare = foePhys + foeMagic > 0 ? foeMagic / (foePhys + foeMagic) : 0.5
  const finalItems = me.items.map((id) => gd.items.get(id)).filter((i): i is ItemInfo => !!i)
  const hasStat = (k: string): boolean =>
    finalItems.some((i) => (i.isLegendary || i.isBoots) && (i.stats[k] ?? 0) > 0)
  if (me.d >= 6 && minutes >= 20 && build?.archetype !== 'ENCHANTER') {
    if (magicShare >= 0.62 && !hasStat('FlatSpellBlockMod'))
      push({
        id: 'no-mr',
        cat: 'build',
        tone: 'bad',
        title: 'Aucune résistance magique',
        detail: `${Math.round(magicShare * 100)} % des dégâts adverses étaient magiques et vous êtes mort ${me.d} fois.`,
        impact: 0.6
      })
    else if (magicShare <= 0.38 && !hasStat('FlatArmorMod'))
      push({
        id: 'no-armor',
        cat: 'build',
        tone: 'bad',
        title: 'Aucune armure',
        detail: `${Math.round((1 - magicShare) * 100)} % des dégâts adverses étaient physiques et vous êtes mort ${me.d} fois.`,
        impact: 0.6
      })
  }

  // --- Combats et morts ---
  const teamKills = facts.players.filter((p) => p.team === me.team).reduce((s, p) => s + p.k, 0)
  const kp = teamKills > 0 ? (me.k + me.a) / teamKills : 0
  sub.fights.push(rate(kp, bench.kp))
  if (teamKills >= 8) {
    if (kp < bench.kp * 0.75)
      push({
        id: 'kp-low',
        cat: 'fights',
        tone: 'bad',
        title: `Participation faible : ${Math.round(kp * 100)} % des éliminations`,
        detail: `Repère Master+ : ${Math.round(bench.kp * 100)} %.`,
        impact: 0.55
      })
    else if (kp >= bench.kp * 1.1)
      push({
        id: 'kp-good',
        cat: 'fights',
        tone: 'good',
        title: `Très présent : ${Math.round(kp * 100)} % des éliminations`,
        impact: 0.45
      })
  }
  const deathsPer10 = (me.d / Math.max(minutes, 1)) * 10
  sub.fights.push(rate(deathsPer10, 1.6, true))
  const myDeaths = facts.kills.filter((k) => k[2] === me.pid)
  const earlyDeaths = myDeaths.filter((k) => k[0] < 14 * 60).length
  let deathsWithGold = 0
  let worstGold = 0
  if (hasTimeline) {
    for (const [t] of myDeaths) {
      const g = frameAt(facts, t)?.[meIdx]?.[1] ?? 0
      if (g >= 1400) {
        deathsWithGold++
        worstGold = Math.max(worstGold, g)
      }
    }
    if (earlyDeaths >= 3) {
      sub.fights.push(25)
      push({
        id: 'early-deaths',
        cat: 'fights',
        tone: 'bad',
        title: `${earlyDeaths} morts avant 14 min`,
        detail: 'Chaque mort en début de partie donne de l’avance au jungler adverse.',
        impact: 0.6 + 0.08 * earlyDeaths
      })
    } else if (earlyDeaths === 0 && minutes >= 15) {
      push({
        id: 'safe-early',
        cat: 'fights',
        tone: 'good',
        title: 'Aucune mort avant 14 min',
        impact: 0.35
      })
    }
    if (deathsWithGold >= 2)
      push({
        id: 'deaths-gold',
        cat: 'fights',
        tone: 'bad',
        title: `${deathsWithGold} morts avec beaucoup d’or non dépensé`,
        detail: `Jusqu’à ${Math.round(worstGold)} po en poche au moment de mourir.`,
        impact: 0.55
      })
  }
  if (me.d >= 9)
    push({
      id: 'many-deaths',
      cat: 'fights',
      tone: 'bad',
      title: `${me.d} morts`,
      detail: `${fr1(deathsPer10)} morts toutes les 10 min (repère : moins de 1,6).`,
      impact: 0.5 + Math.min(0.3, (me.d - 9) * 0.05)
    })
  else if (me.d <= 2 && minutes >= 22)
    push({
      id: 'few-deaths',
      cat: 'fights',
      tone: 'good',
      title: `Seulement ${me.d} mort(s)`,
      impact: 0.4
    })

  // Or non dépensé (gestion des retours).
  let unspentShare: number | null = null
  if (hasTimeline && facts.frames.length > 10) {
    const late = facts.frames.slice(6).map((f) => f[meIdx][1])
    unspentShare = late.filter((g) => g >= 1500).length / late.length
    sub.farm.push(Math.max(10, 100 - unspentShare * 220))
    if (unspentShare >= 0.25)
      push({
        id: 'unspent-gold',
        cat: 'farm',
        tone: 'bad',
        title: `Or non dépensé ${Math.round(unspentShare * 100)} % du temps`,
        detail: 'Plus de 1 500 po en poche : un retour plus tôt aurait donné un objet d’avance.',
        impact: 0.4 + unspentShare * 0.5
      })
  }

  // --- Objectifs ---
  const team = emptyCount()
  const enemy = emptyCount()
  let smited = 0
  for (const [, killer, tm, kind] of facts.monsters) {
    if (tm === me.team) team[kind]++
    else enemy[kind]++
    if (killer === me.pid) smited++
  }
  const wsum = (c: ObjectiveCount): number =>
    (Object.keys(c) as MonsterKind[]).reduce((s, k) => s + c[k] * OBJ_WEIGHT[k], 0)
  const totalObj = wsum(team) + wsum(enemy)
  if (totalObj > 0) {
    const share = wsum(team) / totalObj
    sub.objectives.push(15 + share * 85)
    const dragons = `${team.dragon + team.elder}/${enemy.dragon + enemy.elder}`
    if (totalObj >= 3 && share <= 0.35)
      push({
        id: 'objectives-lost',
        cat: 'objectives',
        tone: 'bad',
        title: `Objectifs perdus (dragons ${dragons})`,
        detail: `Votre équipe : ${Math.round(share * 100)} % des objectifs neutres.`,
        impact: 0.55 + (0.35 - share)
      })
    else if (totalObj >= 3 && share >= 0.65)
      push({
        id: 'objectives-won',
        cat: 'objectives',
        tone: 'good',
        title: `Contrôle des objectifs (dragons ${dragons})`,
        detail: `Votre équipe : ${Math.round(share * 100)} % des objectifs neutres.`,
        impact: 0.5 + (share - 0.65)
      })
    if (enemy.grubs >= 5 && team.grubs <= 1)
      push({
        id: 'grubs-lost',
        cat: 'objectives',
        tone: 'bad',
        title: `Larves du Néant : ${team.grubs}/${enemy.grubs}`,
        impact: 0.35
      })
    if (smited >= 4)
      push({
        id: 'smite',
        cat: 'objectives',
        tone: 'good',
        title: `${smited} objectifs sécurisés au Châtiment`,
        impact: 0.3
      })
  }

  // --- Vision ---
  const visionPerMin = me.vision / Math.max(minutes, 1)
  const controlWardsPer10 = (me.controlWards / Math.max(minutes, 1)) * 10
  sub.vision.push(rate(visionPerMin, bench.visionPerMin))
  sub.vision.push(rate(controlWardsPer10, bench.controlWardsPer10))
  if (me.controlWards === 0 && minutes >= 20)
    push({
      id: 'no-control-ward',
      cat: 'vision',
      tone: 'bad',
      title: 'Aucune balise de contrôle achetée',
      impact: 0.45
    })
  else if (visionPerMin < bench.visionPerMin * 0.7)
    push({
      id: 'vision-low',
      cat: 'vision',
      tone: 'bad',
      title: `Vision faible : ${fr1(visionPerMin)} / min`,
      detail: `Repère Master+ : ${fr1(bench.visionPerMin)} / min.`,
      impact: 0.35
    })
  else if (visionPerMin >= bench.visionPerMin * 1.15)
    push({
      id: 'vision-good',
      cat: 'vision',
      tone: 'good',
      title: `Bonne vision : ${fr1(visionPerMin)} / min`,
      impact: 0.3
    })

  const scores: Partial<Record<Category, number>> = {}
  for (const c of Object.keys(sub) as Category[])
    if (sub[c].length) scores[c] = Math.round(mean(sub[c]))
  const WEIGHTS: Record<Category, number> = {
    farm: 0.25,
    build: 0.2,
    fights: 0.25,
    objectives: 0.2,
    vision: 0.1
  }
  let wTotal = 0
  let sTotal = 0
  for (const [c, s] of Object.entries(scores) as [Category, number][]) {
    wTotal += WEIGHTS[c]
    sTotal += WEIGHTS[c] * s
  }
  const overall = wTotal > 0 ? Math.round(sTotal / wTotal) : 50

  findings.sort((a, b) => b.impact - a.impact)
  return {
    facts,
    champ,
    enemyJungler: enemyJ ? (gd.champions.get(enemyJ.champ) ?? null) : null,
    win: me.win,
    kda: `${me.k}/${me.d}/${me.a}`,
    minutes,
    scores,
    overall,
    grade: gradeOf(overall),
    findings,
    purchases,
    adherence,
    objectives: { team, enemy, smited },
    stats: {
      csPerMin,
      cs10,
      cs15,
      csDiff10,
      goldDiff15,
      levelDiff15,
      kp,
      visionPerMin,
      controlWardsPer10,
      firstItemMin,
      secondItemMin,
      deathsWithGold,
      earlyDeaths,
      unspentShare
    },
    legendaries,
    bench,
    benchSource,
    hasTimeline
  }
}

/** Conseil d'un point faible, avec les repères remplacés. */
export function tipFor(id: string, bench: Benchmark): string | undefined {
  return TIPS[id]?.replace('{first}', fr1(bench.firstItem))
}

/** Identifiant de l'objet balise de contrôle (pour les rappels en partie). */
export const CONTROL_WARD_ID = CONTROL_WARD
