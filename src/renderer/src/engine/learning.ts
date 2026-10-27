import type { LiveGameData, LivePlayer } from '../../../shared/types'
import type { Benchmark } from './catalog'
import type { PersonalItemBonus, ItemPlan } from './items'
import { norm } from './normalize'
import { CONTROL_WARD_ID, DEFAULT_BENCH, tipFor, type Category, type GameReport } from './postgame'

// Apprentissage à partir des bilans : l'application s'améliore à chaque partie jouée.
//
// - Objets : vos résultats avec chaque objet (par champion, sinon tous champions) ajustent
//   légèrement leur score dans le build adaptatif (±0,12 au maximum, lissé : il faut plusieurs
//   parties pour qu'un objet bouge, et les règles + la méta Master+ restent la base).
// - Fiabilité : taux de victoire quand vous suivez le build conseillé vs quand vous vous en écartez.
// - Points faibles récurrents : rappelés avant la partie, et surveillés pendant la partie.
// - Progression : comparaison de vos 5 dernières parties avec les 5 précédentes.

export interface Recurring {
  id: string
  label: string
  tip?: string
  count: number
  of: number
}

export interface Trend {
  key: string
  label: string
  recent: number
  previous: number
  higherIsBetter: boolean
  format: (x: number) => string
}

export interface ItemRecord {
  name: string
  games: number
  wins: number
  delta: number
}

export interface Learning {
  games: number
  wins: number
  followed: { games: number; wins: number }
  deviated: { games: number; wins: number }
  recurring: Recurring[]
  strengths: Recurring[]
  trends: Trend[]
  /** Moyenne des notes par catégorie sur les 10 dernières parties. */
  averages: Partial<Record<Category, number>>
  averageOverall: number | null
  /** Objets dont vos résultats s'écartent le plus de votre moyenne (tous champions). */
  items: ItemRecord[]
  /** Ajustement personnel du score d'un objet pour un champion. */
  bonusFor: (champId: string | null) => PersonalItemBonus
}

const LABELS: Record<string, string> = {
  'cs-low': 'Farm en début de partie',
  'gold-behind': 'Retard sur le jungler adverse',
  'first-item-late': '1er objet tardif',
  'off-build': 'Achats hors du build conseillé',
  'no-antiheal': 'Anti-soins absents ou tardifs',
  'no-mr': 'Pas de résistance magique',
  'no-armor': 'Pas d’armure',
  'deaths-gold': 'Morts avec de l’or en poche',
  'unspent-gold': 'Or non dépensé',
  'early-deaths': 'Morts avant 14 min',
  'many-deaths': 'Trop de morts',
  'kp-low': 'Faible participation',
  'objectives-lost': 'Objectifs perdus',
  'grubs-lost': 'Larves du Néant perdues',
  'no-control-ward': 'Pas de balise de contrôle',
  'vision-low': 'Vision faible',
  'cs-good': 'Farm',
  'gold-ahead': 'Avance sur le jungler adverse',
  'first-item-fast': 'Rythme d’achat',
  'follow-build': 'Build adapté',
  'antiheal-ok': 'Anti-soins',
  'safe-early': 'Début de partie sans mort',
  'few-deaths': 'Peu de morts',
  'kp-good': 'Présence en combat',
  'objectives-won': 'Contrôle des objectifs',
  smite: 'Châtiment',
  'vision-good': 'Vision'
}

const bayes = (wins: number, games: number, prior: number, k: number): number =>
  (wins + k * prior) / (games + k)
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x))
const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1)
const fr1 = (x: number): string => x.toFixed(1).replace('.', ',')

const MIN_CHAMP_GAMES = 4
const MIN_GLOBAL_GAMES = 6
const MAX_BONUS = 0.12

export const EMPTY_LEARNING: Learning = {
  games: 0,
  wins: 0,
  followed: { games: 0, wins: 0 },
  deviated: { games: 0, wins: 0 },
  recurring: [],
  strengths: [],
  trends: [],
  averages: {},
  averageOverall: null,
  items: [],
  bonusFor: () => () => null
}

/** reports : bilans du plus récent au plus ancien. */
export function computeLearning(reports: GameReport[]): Learning {
  if (reports.length === 0) return EMPTY_LEARNING
  const games = reports.length
  const wins = reports.filter((r) => r.win).length
  // Taux de victoire personnel, lissé vers 50 % tant qu'il y a peu de parties.
  const base = bayes(wins, games, 0.5, 10)

  // Résultats par objet (tous champions et par champion).
  const stats = new Map<string, { name: string; g: number; w: number }>()
  const count = (key: string, name: string, win: boolean): void => {
    const s = stats.get(key) ?? { name, g: 0, w: 0 }
    s.g++
    if (win) s.w++
    stats.set(key, s)
  }
  for (const r of reports) {
    const champ = r.champ?.id ?? '?'
    for (const it of new Set(r.legendaries)) {
      count(`*|${norm(it.name)}`, it.name, r.win)
      count(`${champ}|${norm(it.name)}`, it.name, r.win)
    }
  }
  const delta = (s: { g: number; w: number }): number => bayes(s.w, s.g, base, 6) - base

  const bonusFor =
    (champId: string | null): PersonalItemBonus =>
    (itemName) => {
      const key = norm(itemName)
      const own = champId ? stats.get(`${champId}|${key}`) : undefined
      let d: number | null = null
      let s = own
      if (own && own.g >= MIN_CHAMP_GAMES) d = delta(own)
      else {
        s = stats.get(`*|${key}`)
        if (s && s.g >= MIN_GLOBAL_GAMES) d = delta(s) * 0.5
      }
      if (d === null || !s) return null
      const bonus = clamp(d * 0.8, -MAX_BONUS, MAX_BONUS)
      if (Math.abs(bonus) < 0.02) return null
      return {
        bonus,
        reason: bonus >= 0.06 ? `vous réussit (${s.w}/${s.g} V)` : undefined
      }
    }

  const items: ItemRecord[] = [...stats.entries()]
    .filter(([k, s]) => k.startsWith('*|') && s.g >= MIN_GLOBAL_GAMES)
    .map(([, s]) => ({ name: s.name, games: s.g, wins: s.w, delta: delta(s) }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6)

  // Fiabilité du build conseillé.
  const followed = { games: 0, wins: 0 }
  const deviated = { games: 0, wins: 0 }
  for (const r of reports) {
    if (r.adherence === null) continue
    const target = r.adherence >= 0.7 ? followed : deviated
    target.games++
    if (r.win) target.wins++
  }

  // Points récurrents sur les 10 dernières parties.
  const recent = reports.slice(0, 10)
  const tally = (tone: 'good' | 'bad'): Recurring[] => {
    if (recent.length < 3) return []
    const counts = new Map<string, number>()
    for (const r of recent)
      for (const id of new Set(r.findings.filter((f) => f.tone === tone).map((f) => f.id)))
        counts.set(id, (counts.get(id) ?? 0) + 1)
    const bench = recent[0].bench ?? DEFAULT_BENCH
    return [...counts.entries()]
      .filter(([, n]) => n >= 2 && n / recent.length >= (tone === 'bad' ? 0.4 : 0.5))
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => ({
        id,
        label: LABELS[id] ?? id,
        tip: tone === 'bad' ? tipFor(id, bench) : undefined,
        count: n,
        of: recent.length
      }))
  }

  const averages: Partial<Record<Category, number>> = {}
  for (const c of ['farm', 'build', 'fights', 'objectives', 'vision'] as Category[]) {
    const xs = recent.map((r) => r.scores[c]).filter((x): x is number => typeof x === 'number')
    if (xs.length) averages[c] = Math.round(avg(xs))
  }

  // Progression : 5 dernières parties vs 5 précédentes.
  const trends: Trend[] = []
  if (reports.length >= 6) {
    const a = reports.slice(0, 5)
    const b = reports.slice(5, 10)
    const add = (
      key: string,
      label: string,
      get: (r: GameReport) => number | null,
      higherIsBetter: boolean,
      format: (x: number) => string
    ): void => {
      const xa = a.map(get).filter((x): x is number => x !== null)
      const xb = b.map(get).filter((x): x is number => x !== null)
      if (xa.length >= 3 && xb.length >= 1)
        trends.push({ key, label, recent: avg(xa), previous: avg(xb), higherIsBetter, format })
    }
    add(
      'overall',
      'Note globale',
      (r) => r.overall,
      true,
      (x) => String(Math.round(x))
    )
    add(
      'cs10',
      'Farm à 10 min',
      (r) => r.stats.cs10,
      true,
      (x) => `${Math.round(x)} cs`
    )
    add(
      'kp',
      'Participation',
      (r) => r.stats.kp,
      true,
      (x) => `${Math.round(x * 100)} %`
    )
    add(
      'deaths',
      'Morts / 10 min',
      (r) => (r.facts.players.find((p) => p.pid === r.facts.me)!.d / Math.max(r.minutes, 1)) * 10,
      false,
      fr1
    )
    add(
      'item',
      '1er objet',
      (r) => r.stats.firstItemMin,
      false,
      (x) => `${fr1(x)} min`
    )
    add('vision', 'Vision / min', (r) => r.stats.visionPerMin, true, fr1)
  }

  return {
    games,
    wins,
    followed,
    deviated,
    recurring: tally('bad'),
    strengths: tally('good'),
    trends,
    averages,
    averageOverall: recent.length ? Math.round(avg(recent.map((r) => r.overall))) : null,
    items,
    bonusFor
  }
}

export interface Nudge {
  id: string
  text: string
  tone: 'orange' | 'blue'
}

/**
 * Rappels en partie, centrés sur vos points faibles récurrents (et sur l'or non dépensé dans tous
 * les cas quand il y en a vraiment beaucoup).
 */
export function liveNudges(
  learning: Learning,
  live: LiveGameData | null,
  me: LivePlayer | null,
  plan: ItemPlan | null,
  bench: Benchmark
): Nudge[] {
  if (!live || !me) return []
  const out: Nudge[] = []
  const weak = new Set(learning.recurring.map((r) => r.id))
  const t = live.gameTime
  const gold = live.activePlayer?.currentGold ?? 0

  const goldWeak = weak.has('unspent-gold') || weak.has('deaths-gold')
  if ((goldWeak && gold >= 1300) || gold >= 2200) {
    const target = plan?.next?.affordable ? plan.next.item.nameFr : null
    out.push({
      id: 'gold',
      text: `${Math.floor(gold)} po en poche : rentrez acheter${target ? ` ${target}` : ''}.`,
      tone: 'orange'
    })
  }
  if (
    (weak.has('no-control-ward') || weak.has('vision-low')) &&
    t >= 6 * 60 &&
    !me.items.some((i) => i.itemID === CONTROL_WARD_ID)
  ) {
    out.push({
      id: 'ward',
      text: 'Pas de balise de contrôle : prenez-en une au prochain retour.',
      tone: 'blue'
    })
  }
  if ((weak.has('cs-low') || weak.has('gold-behind')) && t >= 5 * 60 && t <= 20 * 60) {
    const perMin = me.scores.creepScore / (t / 60)
    const target = bench.cs10 / 10
    if (perMin < target * 0.88)
      out.push({
        id: 'cs',
        text: `Farm : ${fr1(perMin)} cs/min (repère ${fr1(target)}). Enchaînez les camps.`,
        tone: 'orange'
      })
  }
  if (weak.has('early-deaths') && t < 14 * 60) {
    out.push({
      id: 'early',
      text: 'Rappel : pas de combat sans vision ni avantage avant 14 min.',
      tone: 'blue'
    })
  }
  return out
}
