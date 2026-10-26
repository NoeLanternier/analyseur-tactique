import type { ItemSetPayload, LivePlayer } from '../../../shared/types'
import {
  ANTI_HEAL,
  ARCHETYPE_POOLS,
  BOOTS,
  ITEM_RULES,
  POTION,
  UNIQUE_GROUPS,
  type Archetype,
  type Metric
} from '../data/items'
import type { JunglerBuild, SituationContext } from '../data/junglers'
import type { GameData, ItemInfo } from './gameData'
import { clamp01, norm } from './normalize'
import type { ThreatProfile } from './threat'

export type StepKind = 'starter' | 'core' | 'boots' | 'antiheal' | 'situational' | 'owned'

export interface BuildStep {
  item: ItemInfo
  kind: StepKind
  owned: boolean
  /** Explication courte (« vs Syndra fed », « anti-soins »...). */
  reason?: string
  /** L'objet a remplacé un objet du cœur à cause de la partie. */
  swapped?: boolean
}

export interface NextBuy {
  item: ItemInfo
  remaining: number
  affordable: boolean
  /** Composant le plus cher achetable maintenant si l'objet complet ne l'est pas. */
  component: ItemInfo | null
  /** Inventaire plein : objet à vendre pour faire de la place. */
  sellHint?: string
}

/** 6 emplacements : bottes + 5 objets légendaires (le familier se vend en fin de partie). */
const MAX_LEGENDARIES = 5

export interface ItemPlan {
  starter: ItemInfo[]
  steps: BuildStep[]
  /** Autres bons choix si la partie évolue. */
  alternatives: BuildStep[]
  next: NextBuy | null
  unresolved: string[]
}

// Un objet peut appartenir à plusieurs groupes (ex. Rappel mortel : pénétration + anti-soins).
const groupsOf = new Map<string, number[]>()
UNIQUE_GROUPS.forEach((g, i) =>
  g.forEach((name) => groupsOf.set(norm(name), [...(groupsOf.get(norm(name)) ?? []), i]))
)

function conflicts(a: ItemInfo, b: ItemInfo): boolean {
  if (a.id === b.id || norm(a.name) === norm(b.name)) return true
  const ga = groupsOf.get(norm(a.name)) ?? []
  const gb = groupsOf.get(norm(b.name)) ?? []
  return ga.some((g) => gb.includes(g))
}

const METRIC_LABEL: Partial<Record<Metric, string>> = {
  ap: 'dégâts magiques',
  ad: 'dégâts physiques',
  mixed: 'dégâts mixtes',
  tanky: 'adversaires résistants',
  armorStack: 'armure adverse',
  mrStack: 'RM adverse',
  cc: 'contrôles',
  heal: 'anti-soins',
  shield: 'boucliers',
  burst: 'burst adverse',
  crit: 'critiques adverses',
  aa: 'attaques de base',
  ahead: 'avance',
  behind: 'retard'
}

interface Scored {
  item: ItemInfo
  score: number
  reason?: string
  defensive: boolean
}

const CONTEXT_LABEL: Record<SituationContext, string> = {
  all: 'meilleur taux',
  ap: 'gagne vs AP',
  ad: 'gagne vs AD',
  heal: 'gagne vs soins',
  tank: 'gagne vs tanks',
  cc: 'gagne vs contrôles'
}

/** Poids de chaque contexte mesuré selon la composition adverse actuelle. */
function contextWeights(m: Record<Metric, number>): Record<SituationContext, number> {
  return {
    all: 0.6,
    ap: clamp01((m.ap - 0.5) / 0.3),
    ad: clamp01((m.ad - 0.5) / 0.3),
    heal: m.heal,
    tank: m.tanky,
    cc: m.cc
  }
}

/**
 * Score appris : dans les contextes qui ressemblent à la partie, à quel point les joueurs Master+
 * construisent cet objet (part) et à quel point il fait gagner (écart de taux de victoire lissé).
 */
function dataScore(
  item: ItemInfo,
  situational: JunglerBuild['situational'],
  m: Record<Metric, number>
): { score: number; reason?: string } | null {
  if (!situational) return null
  const weights = contextWeights(m)
  let sum = 0
  let weightSum = 0
  let best: { ctx: SituationContext; lift: number; value: number } | null = null
  for (const ctx of Object.keys(weights) as SituationContext[]) {
    const stats = situational[ctx]
    const w = weights[ctx]
    if (!stats || w <= 0) continue
    const entry = stats.items.find((x) => norm(x.item) === norm(item.name))
    // Objet quasiment jamais construit dans ce contexte : léger malus.
    const value = entry ? entry.share * 0.9 + entry.lift * 6 : -0.05
    sum += w * value
    weightSum += w
    if (entry && ctx !== 'all' && entry.lift > 0.015 && entry.share >= 0.08) {
      if (!best || w * value > best.value) best = { ctx, lift: entry.lift, value: w * value }
    }
  }
  if (weightSum === 0) return null
  const reason = best
    ? `${CONTEXT_LABEL[best.ctx]} (+${(best.lift * 100).toFixed(1).replace('.', ',')} %)`
    : undefined
  return { score: sum / weightSum, reason }
}

function scoreItem(
  item: ItemInfo,
  threat: ThreatProfile,
  optionIndex: number,
  situational?: JunglerBuild['situational']
): Scored {
  const rule =
    ITEM_RULES[item.name] ??
    Object.entries(ITEM_RULES).find(([k]) => norm(k) === norm(item.name))?.[1]
  const m = threat.metrics
  let score = rule ? rule.base : 0.1
  let bestMetric: Metric | null = null
  let bestContribution = 0
  if (rule) {
    for (const [metric, weight] of Object.entries(rule.w) as [Metric, number][]) {
      const c = weight * m[metric]
      score += c
      if (c > bestContribution) {
        bestContribution = c
        bestMetric = metric
      }
    }
  }
  const learned = dataScore(item, situational, m)
  const optionBonus = optionIndex >= 0 ? Math.max(0.1, 0.45 - optionIndex * 0.07) : 0
  if (learned) {
    // Données Master+ disponibles : elles pèsent autant que les règles. En cas d'urgence en partie
    // (adversaire très en avance, retard), les règles défensives reprennent le dessus.
    const emergency = Math.max(m.fedAp, m.fedAd, m.behind)
    const ruleWeight = 0.5 + 0.5 * emergency
    score = ruleWeight * score + 1.4 * learned.score + 0.4 * optionBonus
  } else {
    score += optionBonus
  }
  // Un objet anti-soins n'a de sens que si l'adversaire soigne vraiment.
  if (rule?.w.heal && rule.w.heal >= 1 && m.heal < 0.45) score -= 1

  let reason: string | undefined
  if (bestMetric && bestContribution >= 0.3) {
    reason = METRIC_LABEL[bestMetric]
    if ((bestMetric === 'fedAp' || bestMetric === 'fedAd') && threat.fed)
      reason = `vs ${threat.fed.champ.name}`
  }
  if (learned?.reason && !(reason && reason.startsWith('vs '))) reason = learned.reason
  return { item, score, reason, defensive: rule?.role === 'defense' || rule?.role === 'utility' }
}

function chooseBoots(
  gd: GameData,
  defaultBoots: ItemInfo | undefined,
  archetype: Archetype,
  threat: ThreatProfile
): { item: ItemInfo | undefined; reason?: string } {
  const m = threat.metrics
  const steel = gd.itemsByName.get(norm(BOOTS.steelcaps))
  const merc = gd.itemsByName.get(norm(BOOTS.mercury))
  if (threat.enemies.length === 0) return { item: defaultBoots }
  const steelNeed = m.ad * 0.8 + m.aa * 0.5 + m.crit * 0.3 + m.fedAd * 0.5
  const mercNeed = m.ap * 0.8 + m.cc * 0.7 + m.fedAp * 0.5
  const defaultIsDefensive =
    !!defaultBoots &&
    (norm(defaultBoots.name) === norm(BOOTS.steelcaps) ||
      norm(defaultBoots.name) === norm(BOOTS.mercury))
  // Les champions qui jouent des bottes offensives ne les changent que face à une menace nette.
  const canSwap =
    defaultIsDefensive || ['AD_FIGHTER', 'TANK', 'AD_CARRY', 'AP_FIGHTER'].includes(archetype)
  const threshold = defaultIsDefensive ? 0 : 1.0
  if (!canSwap) return { item: defaultBoots }
  if (mercNeed > steelNeed && mercNeed >= threshold && merc)
    return { item: merc, reason: m.cc >= 0.6 ? 'contrôles + magie' : 'dégâts magiques' }
  if (steelNeed >= mercNeed && steelNeed >= threshold && steel)
    return { item: steel, reason: m.aa >= 0.5 ? 'attaques de base' : 'dégâts physiques' }
  return { item: defaultBoots }
}

/** L'objet se construit-il (directement ou non) à partir de ce composant ? */
function buildsFrom(gd: GameData, item: ItemInfo, componentId: number, depth = 0): boolean {
  if (depth > 4) return false
  return item.from.some((id) => {
    if (id === componentId) return true
    const sub = gd.items.get(id)
    return sub ? buildsFrom(gd, sub, componentId, depth + 1) : false
  })
}

/** Composant anti-soins (Blessures graves) dans la recette d'un objet. */
function antiHealComponentOf(gd: GameData, item: ItemInfo): ItemInfo | undefined {
  const queue = [...item.from]
  while (queue.length) {
    const comp = gd.items.get(queue.shift()!)
    if (!comp) continue
    if (comp.grievous && !comp.isLegendary) return comp
    queue.push(...comp.from)
  }
  return undefined
}

/** Valeur de composants déjà possédés pour un objet (consomme l'inventaire). */
function ownedComponentValue(gd: GameData, item: ItemInfo, inventory: Map<number, number>): number {
  let value = 0
  for (const compId of item.from) {
    const comp = gd.items.get(compId)
    if (!comp) continue
    const n = inventory.get(compId) ?? 0
    if (n > 0) {
      inventory.set(compId, n - 1)
      value += comp.total
    } else value += ownedComponentValue(gd, comp, inventory)
  }
  return value
}

function bestComponent(
  gd: GameData,
  item: ItemInfo,
  gold: number,
  inventory: Map<number, number>
): ItemInfo | null {
  let best: ItemInfo | null = null
  const visit = (it: ItemInfo): void => {
    for (const compId of it.from) {
      const comp = gd.items.get(compId)
      if (!comp) continue
      if ((inventory.get(compId) ?? 0) > 0) continue
      if (comp.total <= gold && (!best || comp.total > best.total)) best = comp
      visit(comp)
    }
  }
  visit(item)
  return best
}

export function buildItemPlan(
  gd: GameData,
  build: JunglerBuild,
  threat: ThreatProfile,
  me: LivePlayer | null,
  currentGold: number
): ItemPlan {
  const unresolved: string[] = []
  const resolve = (name: string): ItemInfo | undefined => {
    const it = gd.itemsByName.get(norm(name))
    if (!it) unresolved.push(name)
    return it
  }
  const m = threat.metrics

  // Inventaire en partie.
  const inventory = new Map<number, number>()
  for (const it of me?.items ?? [])
    inventory.set(it.itemID, (inventory.get(it.itemID) ?? 0) + Math.max(1, it.count))
  const ownsId = (id: number): boolean => (inventory.get(id) ?? 0) > 0
  const ownedItems = [...inventory.keys()]
    .map((id) => gd.items.get(id))
    .filter((i): i is ItemInfo => !!i)
  const ownedLegendaries = ownedItems.filter((i) => i.isLegendary)
  const ownedBoots = ownedItems.find((i) => i.isBoots)

  const starter = [resolve(build.pet), gd.itemsByName.get(norm(POTION))].filter(
    (i): i is ItemInfo => !!i
  )

  const core = build.core.map(resolve).filter((i): i is ItemInfo => !!i)
  const optionNames = build.options.map(norm)
  const pool = new Map<number, ItemInfo>()
  // Objets réellement construits par les joueurs Master+ dans au moins un contexte (≥ 8 %).
  const learnedNames = Object.values(build.situational ?? {}).flatMap((ctx) =>
    (ctx?.items ?? []).filter((x) => x.share >= 0.08).map((x) => x.item)
  )
  for (const name of [
    ...ARCHETYPE_POOLS[build.archetype],
    ...build.options,
    ...learnedNames,
    ANTI_HEAL[build.archetype].final
  ]) {
    const it = gd.itemsByName.get(norm(name))
    if (it && it.isLegendary) pool.set(it.id, it)
    else if (!it && build.options.includes(name)) unresolved.push(name)
  }
  for (const c of core) pool.delete(c.id)

  // Composants importants déjà achetés : on privilégie les objets qui les terminent (l'or investi
  // n'est pas perdu et le plan ne change pas de direction en cours de partie).
  const startedComponents = ownedItems.filter(
    (i) =>
      !i.isLegendary &&
      !i.isBoots &&
      i.total >= 700 &&
      !i.tags.includes('Consumable') &&
      !i.tags.includes('Jungle') &&
      !i.tags.includes('Trinket')
  )
  const scored = [...pool.values()]
    .map((it) => {
      const sc = scoreItem(it, threat, optionNames.indexOf(norm(it.name)), build.situational)
      const started = startedComponents.find((c) => buildsFrom(gd, it, c.id))
      if (started) {
        sc.score += 0.5
        sc.reason = `termine ${started.nameFr}`
      }
      return sc
    })
    .sort((a, b) => b.score - a.score)

  // Cœur, avec remplacement du 3e objet si la partie l'exige vraiment.
  const coreSteps: BuildStep[] = core.map((item) => ({ item, kind: 'core' as const, owned: false }))
  // - le 3e objet est offensif et un objet défensif devient indispensable ;
  // - ou le 3e objet est défensif mais protège mal contre la menace réelle (ex. Danse de la mort
  //   face à une équipe presque entièrement AP).
  const urgent = scored.find(
    (s) => s.defensive && s.score >= 1.15 && !core.slice(0, 2).some((c) => conflicts(c, s.item))
  )
  if (urgent && coreSteps.length === 3) {
    const third = coreSteps[2].item
    const thirdRule = ITEM_RULES[third.name]
    const thirdOwned = ownsId(third.id)
    const thirdScore = scoreItem(third, threat, -1, build.situational).score
    const thirdIsDamage = !thirdRule || thirdRule.role === 'damage'
    if (!thirdOwned && (thirdIsDamage || urgent.score - thirdScore >= 0.45)) {
      coreSteps[2] = {
        item: urgent.item,
        kind: 'core',
        owned: false,
        reason: urgent.reason,
        swapped: true
      }
      scored.splice(scored.indexOf(urgent), 1)
      scored.unshift({ item: third, score: 1, defensive: false })
    }
  }

  // Bottes.
  const boots = chooseBoots(gd, resolve(build.boots), build.archetype, threat)
  const steps: BuildStep[] = []
  // Familier de jungle : premier achat de la partie.
  const pet = gd.itemsByName.get(norm(build.pet))
  if (pet) steps.push({ item: pet, kind: 'starter', owned: false, reason: 'familier de jungle' })
  if (coreSteps[0]) steps.push(coreSteps[0])
  if (ownedBoots) steps.push({ item: ownedBoots, kind: 'boots', owned: true })
  else if (boots.item)
    steps.push({ item: boots.item, kind: 'boots', owned: false, reason: boots.reason })

  steps.push(...coreSteps.slice(1))

  // Situationnels : on complète jusqu'à 5 légendaires en tenant compte de l'inventaire.
  const legendaryInPlan = (): ItemInfo[] =>
    steps.filter((s) => s.item.isLegendary).map((s) => s.item)
  const situational: BuildStep[] = []
  const alternatives: BuildStep[] = []
  for (const s of scored) {
    const taken = [...legendaryInPlan(), ...situational.map((x) => x.item)]
    if (taken.some((t) => conflicts(t, s.item))) continue
    if (ownedLegendaries.some((o) => conflicts(o, s.item) && o.id !== s.item.id)) continue
    const step: BuildStep = { item: s.item, kind: 'situational', owned: false, reason: s.reason }
    if (taken.length < MAX_LEGENDARIES) situational.push(step)
    else if (alternatives.length < 4) alternatives.push(step)
  }

  // Anti-soins : un seul objet complet, cohérent avec ce qui a déjà été acheté.
  // - un composant anti-soins est déjà dans l'inventaire → on termine l'objet qu'il construit ;
  // - sinon, beaucoup de soins adverses et rien de prévu → l'objet anti-soins de l'archétype.
  const plannedLegendaries = (): ItemInfo[] => [
    ...legendaryInPlan(),
    ...situational.map((x) => x.item)
  ]
  const ownsGrievousLegendary = ownedLegendaries.some((i) => i.grievous)
  const ownedGrievousComp = ownedItems.find((i) => i.grievous && !i.isLegendary)
  let antiHealTarget: ItemInfo | undefined
  let antiHealReason = 'anti-soins'
  if (!ownsGrievousLegendary && ownedGrievousComp) {
    const completions = [...gd.items.values()].filter(
      (i) =>
        i.isLegendary &&
        i.grievous &&
        gd.itemsByName.get(norm(i.name)) === i &&
        buildsFrom(gd, i, ownedGrievousComp.id)
    )
    antiHealTarget =
      completions.find((i) => plannedLegendaries().some((p) => p.id === i.id)) ??
      completions.find((i) => norm(i.name) === norm(ANTI_HEAL[build.archetype].final)) ??
      completions[0]
    antiHealReason = `termine ${ownedGrievousComp.nameFr}`
  } else if (
    !ownsGrievousLegendary &&
    m.heal >= 0.55 &&
    !plannedLegendaries().some((i) => i.grievous)
  ) {
    antiHealTarget = gd.itemsByName.get(norm(ANTI_HEAL[build.archetype].final))
  }
  if (
    antiHealTarget &&
    !ownedLegendaries.some((o) => conflicts(o, antiHealTarget!)) &&
    !legendaryInPlan().some((i) => conflicts(i, antiHealTarget!))
  ) {
    const target = antiHealTarget
    // Un seul anti-soins : les autres objets anti-soins prévus passent en alternatives.
    for (let i = situational.length - 1; i >= 0; i--) {
      if (
        situational[i].item.id !== target.id &&
        (situational[i].item.grievous || conflicts(situational[i].item, target))
      )
        alternatives.unshift(...situational.splice(i, 1))
    }
    const existing = situational.findIndex((x) => x.item.id === target.id)
    if (existing >= 0) situational.splice(existing, 1)
    if (plannedLegendaries().length >= MAX_LEGENDARIES) {
      const idx = situational.map((x) => ownsId(x.item.id)).lastIndexOf(false)
      if (idx >= 0) alternatives.unshift(...situational.splice(idx, 1))
    }
    if (plannedLegendaries().length < MAX_LEGENDARIES) {
      situational.unshift({
        item: target,
        kind: 'situational',
        owned: false,
        reason: antiHealReason
      })
    }
  }

  // Composant anti-soins tôt (avant le 2e objet légendaire) : toujours celui de l'objet anti-soins
  // prévu, pour que l'or investi serve plus tard.
  if (m.heal >= 0.5 && ownedLegendaries.length < 2 && !ownedItems.some((i) => i.grievous)) {
    const plannedAntiHeal = [...plannedLegendaries()].find((i) => i.grievous)
    const comp = plannedAntiHeal ? antiHealComponentOf(gd, plannedAntiHeal) : undefined
    if (comp && plannedAntiHeal) {
      const bootsIdx = steps.findIndex((x) => x.kind === 'boots')
      const at = bootsIdx >= 0 ? bootsIdx + 1 : Math.min(steps.length, 2)
      steps.splice(at, 0, {
        item: comp,
        kind: 'antiheal',
        owned: false,
        reason: `anti-soins tôt → ${plannedAntiHeal.nameFr}`
      })
    }
  }
  alternatives.splice(4)
  steps.push(...situational)

  // Objets légendaires achetés hors plan : ils prennent la place des derniers situationnels.
  const planIds = new Set(steps.map((s) => s.item.id))
  for (const extra of ownedLegendaries.filter((o) => !planIds.has(o.id))) {
    const conflictIdx = steps.findIndex(
      (s) => !s.owned && s.item.isLegendary && conflicts(s.item, extra)
    )
    // On remplace le dernier situationnel prévu, en gardant l'anti-soins si l'adversaire soigne.
    const replaceable = (s: BuildStep, keepAntiHeal: boolean): boolean =>
      s.kind === 'situational' && !ownsId(s.item.id) && !(keepAntiHeal && s.item.grievous)
    let lastSit = [...steps].reverse().findIndex((s) => replaceable(s, m.heal >= 0.55))
    if (lastSit < 0) lastSit = [...steps].reverse().findIndex((s) => replaceable(s, false))
    const idx = conflictIdx >= 0 ? conflictIdx : lastSit >= 0 ? steps.length - 1 - lastSit : -1
    const owned: BuildStep = { item: extra, kind: 'owned', owned: true, reason: 'acheté' }
    if (idx >= 0) steps.splice(idx, 1, owned)
    else steps.push(owned)
  }

  // Possédé : même identifiant, ou même nom (le familier change d'identifiant en évoluant).
  const ownedNames = new Set(ownedItems.map((i) => norm(i.name)))
  for (const s of steps) if (ownsId(s.item.id) || ownedNames.has(norm(s.item.name))) s.owned = true
  // Familier vendu en fin de partie (ou jamais acheté) : inutile de le proposer une fois le build lancé.
  for (const s of steps) if (s.kind === 'starter' && ownedLegendaries.length > 0) s.owned = true
  // Le composant anti-soins est considéré acquis si un objet à Blessures graves est possédé.
  for (const s of steps)
    if (s.kind === 'antiheal' && ownedItems.some((i) => i.grievous || i.from.includes(s.item.id)))
      s.owned = true

  // Affichage : ce qui est déjà acheté d'abord, puis la suite dans l'ordre conseillé.
  const ordered = [...steps.filter((s) => s.owned), ...steps.filter((s) => !s.owned)]
  steps.splice(0, steps.length, ...ordered)

  // Prochain achat.
  let next: NextBuy | null = null
  const pending = steps.find((s) => !s.owned)
  if (pending && me) {
    const inv = new Map(inventory)
    const remaining = Math.max(0, pending.item.total - ownedComponentValue(gd, pending.item, inv))
    const affordable = currentGold >= remaining
    next = {
      item: pending.item,
      remaining,
      affordable,
      component: affordable
        ? null
        : bestComponent(gd, pending.item, currentGold, new Map(inventory))
    }
    // Inventaire plein (6 emplacements hors balise) et aucun composant à compléter : il faut vendre.
    const slotsUsed = (me.items ?? []).filter((it) => it.slot < 6).length
    if (slotsUsed >= 6 && remaining === pending.item.total) {
      const sellable = ownedItems
        .filter((i) => !i.isLegendary && !i.isBoots)
        .sort((a, b) => {
          const petA = a.tags.includes('Jungle') ? 0 : 1
          const petB = b.tags.includes('Jungle') ? 0 : 1
          return petA - petB || a.total - b.total
        })[0]
      next.sellHint = sellable
        ? `Inventaire plein : vends ${sellable.nameFr}`
        : 'Inventaire plein : vends un objet pour faire de la place'
    }
  } else if (pending) {
    next = { item: pending.item, remaining: pending.item.total, affordable: false, component: null }
  }

  return { starter, steps, alternatives, next, unresolved: Array.from(new Set(unresolved)) }
}

/** Set d'items envoyé au client : il apparaît dans la boutique en jeu. */
export function toItemSet(championId: number, champName: string, plan: ItemPlan): ItemSetPayload {
  const block = (type: string, items: ItemInfo[]): ItemSetPayload['blocks'][number] => ({
    type,
    items: items.map((i) => ({ id: String(i.id), count: 1 }))
  })
  const core = plan.steps
    .filter((s) => s.kind !== 'situational' && s.kind !== 'starter')
    .map((s) => s.item)
  const sit = plan.steps.filter((s) => s.kind === 'situational').map((s) => s.item)
  return {
    title: champName,
    championId,
    blocks: [
      block('Départ', plan.starter),
      block('Cœur (ordre d’achat)', core),
      block('Situationnels (adaptés à la composition)', sit),
      block(
        'Alternatives',
        plan.alternatives.map((s) => s.item)
      )
    ].filter((b) => b.items.length > 0)
  }
}
