import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  EMPTY_DRAFT,
  type DraftState,
  type GamePhase,
  type LcuStatus,
  type LiveGameData,
  type ChampionPool,
  type RecommendedRunePage,
  type Settings
} from '../../../shared/types'
import { computeDraftAdvice, type DraftAdvice, type PersonalRecord } from '../engine/draftAdvice'
import {
  defaultCatalog,
  getBuild,
  mergeOverride,
  validateCatalog,
  type Catalog
} from '../engine/catalog'
import { champFromLive, loadGameData, type ChampInfo, type GameData } from '../engine/gameData'
import { buildItemPlan, toItemSet, type ItemPlan } from '../engine/items'
import { buildRunePage, type ResolvedRunePage } from '../engine/runes'
import { analyzeThreat, findMe, type ThreatProfile } from '../engine/threat'
import { META_PATCH, type JunglerBuild } from '../data/junglers'
import { liveNudges, type Nudge } from '../engine/learning'
import { DEFAULT_BENCH } from '../engine/postgame'
import { useReview, type ReviewState } from './useReview'
import { fmtNumber, getLang, setLang, tr, type Lang } from '../../../shared/i18n'

export type SyncState =
  | { state: 'idle' }
  | { state: 'pending' }
  | { state: 'ok'; at: number }
  | { state: 'error'; message: string }
  | { state: 'disabled' }

export interface TactiqueState {
  /** Langue effective de l'application. */
  lang: Lang
  gd: GameData | null
  loadError: string | null
  catalog: Catalog
  catalogNote: string | null
  validation: string[]
  settings: Settings
  saveSettings: (s: Settings) => Promise<void>
  lcuStatus: LcuStatus
  phase: GamePhase
  draft: DraftState
  live: LiveGameData | null
  champ: ChampInfo | null
  build: JunglerBuild | null
  genericBuild: boolean
  threat: ThreatProfile | null
  runePage: ResolvedRunePage | null
  plan: ItemPlan | null
  currentGold: number
  runeSync: SyncState
  itemSetSync: SyncState
  /** Le joueur n'est pas jungler (poste assigné différent, sans Châtiment). */
  offRole: boolean
  /** Conseils de pick et de ban (pendant la sélection, avant le verrouillage). */
  advice: DraftAdvice | null
  /** Bilans d'après-partie et apprentissage. */
  review: ReviewState
  /** Rappels en partie tirés de vos points faibles récurrents. */
  nudges: Nudge[]
}

const INJECT_DELAY = 700
const ITEMSET_DELAY = 1500
const RESET_PHASES = ['None', 'Lobby', 'Matchmaking']

/** État d'un envoi au client, rattaché à la version de la page/du set qu'il concerne. */
interface KeyedSync {
  key: string
  sync: SyncState
}

export function useTactique(): TactiqueState {
  const [gd, setGd] = useState<GameData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [override, setOverride] = useState<{
    url: string
    catalog: Catalog | null
    error?: string
    info?: {
      accepted: number
      rejected: number
      sampleGames: number | null
      generatedAt: string | null
    }
  } | null>(null)
  const [lang, setLangState] = useState<Lang>(getLang())
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [lcuStatus, setLcuStatus] = useState<LcuStatus>('disconnected')
  const [phase, setPhase] = useState<GamePhase>('None')
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT)
  const [live, setLive] = useState<LiveGameData | null>(null)
  const [riot, setRiot] = useState<{ key: number; pages: RecommendedRunePage[] }>({
    key: 0,
    pages: []
  })
  const [runeState, setRuneState] = useState<KeyedSync>({ key: '', sync: { state: 'idle' } })
  const [itemSetState, setItemSetState] = useState<KeyedSync>({ key: '', sync: { state: 'idle' } })
  const [pool, setPool] = useState<ChampionPool | null>(null)
  const appliedRunes = useRef('')
  const appliedItemSet = useRef('')

  // Données Riot (avec nouvel essai si le réseau n'est pas encore prêt).
  useEffect(() => {
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const load = (): void => {
      loadGameData()
        .then((data) => {
          if (cancelled) return
          setGd(data)
          setLoadError(null)
        })
        .catch((err) => {
          if (cancelled) return
          setLoadError(String(err?.message ?? err))
          retry = setTimeout(load, 10000)
        })
    }
    load()
    return () => {
      cancelled = true
      if (retry) clearTimeout(retry)
    }
  }, [])

  // Connexion au processus principal.
  useEffect(() => {
    const api = window.api
    const onPhase = (p: GamePhase): void => {
      // Nouvelle file / nouveau salon : les prochains envois repartent de zéro.
      if (RESET_PHASES.includes(p)) {
        appliedRunes.current = ''
        appliedItemSet.current = ''
      }
      setPhase(p)
    }
    void api.getSettings().then(setSettings)
    // La langue est appliquée au module i18n avant le nouveau rendu : tous les textes calculés
    // (moteur, interface) suivent alors la langue choisie.
    const onLang = (l: Lang): void => {
      setLang(l)
      setLangState(l)
    }
    void api.getInitialState().then((s) => {
      if (s.lang) onLang(s.lang)
      setLcuStatus(s.status)
      onPhase(s.phase)
      setDraft(s.draft)
    })
    const offs = [
      api.onLcuStatus(setLcuStatus),
      api.onPhaseUpdate(onPhase),
      api.onDraftUpdate(setDraft),
      api.onLiveUpdate(setLive),
      api.onLangUpdate(onLang)
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // Mise à jour distante de la base de builds, au démarrage puis toutes les 3 heures.
  useEffect(() => {
    const url = settings.metaUrl
    if (!url) return
    let cancelled = false
    const refresh = (): void => {
      void window.api.fetchMetaOverride(url).then((res) => {
        if (cancelled) return
        if (!res.ok) {
          // On garde la dernière méta reçue si elle existe.
          setOverride((prev) =>
            prev?.url === url && prev.catalog
              ? prev
              : { url, catalog: null, error: res.error ?? '?' }
          )
          return
        }
        const merged = mergeOverride(defaultCatalog(), res.data)
        setOverride({
          url,
          catalog: merged.catalog,
          info: {
            accepted: merged.accepted,
            rejected: merged.rejected,
            sampleGames: merged.sampleGames,
            generatedAt: merged.generatedAt
          }
        })
      })
    }
    refresh()
    const timer = setInterval(refresh, 3 * 3600 * 1000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [settings.metaUrl])

  const activeOverride = settings.metaUrl && override?.url === settings.metaUrl ? override : null
  const catalog = useMemo(() => activeOverride?.catalog ?? defaultCatalog(), [activeOverride])
  const catalogNote = useMemo(() => {
    if (!activeOverride) return null
    if (activeOverride.error || !activeOverride.catalog || !activeOverride.info)
      return tr(
        `URL de méta inaccessible (${activeOverride.error}) : base intégrée utilisée.`,
        `Meta URL unreachable (${activeOverride.error}): built-in database used.`
      )
    const i = activeOverride.info
    const date = i.generatedAt
      ? new Date(i.generatedAt).toLocaleString(lang === 'en' ? 'en-US' : 'fr-FR')
      : null
    const patch = activeOverride.catalog.patch
    return lang === 'en'
      ? `Remote meta patch ${patch}: ${i.accepted} builds` +
          (i.sampleGames ? ` computed from ${fmtNumber(i.sampleGames)} games` : '') +
          (date ? ` (updated ${date})` : '') +
          (i.rejected ? `, ${i.rejected} ignored (invalid format)` : '') +
          '.'
      : `Méta distante patch ${patch} : ${i.accepted} builds` +
          (i.sampleGames ? ` calculés sur ${fmtNumber(i.sampleGames)} parties` : '') +
          (date ? ` (mise à jour du ${date})` : '') +
          (i.rejected ? `, ${i.rejected} ignorés (format invalide)` : '') +
          '.'
  }, [activeOverride, lang])

  const validation = useMemo(
    () => (gd ? validateCatalog(gd, catalog).issues : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lang : les textes calculés suivent la langue
    [gd, catalog, lang]
  )

  // Champion local : sélection, sinon données de partie (app lancée pendant la partie).
  const champ = useMemo<ChampInfo | null>(() => {
    if (!gd) return null
    if (draft.localChampId) return gd.champions.get(draft.localChampId) ?? null
    const me = findMe(gd, live, null)
    return me ? (champFromLive(gd, me.rawChampionName, me.championName) ?? null) : null
  }, [gd, draft.localChampId, live])

  const { build, genericBuild } = useMemo(() => {
    if (!champ) return { build: null, genericBuild: false }
    const res = getBuild(catalog, champ)
    return { build: res.build, genericBuild: res.generic }
  }, [catalog, champ])

  // Pages de runes recommandées par Riot pour ce champion.
  const champKey = champ?.key ?? 0
  useEffect(() => {
    if (!champKey || lcuStatus !== 'connected' || riot.key === champKey) return
    const timer = setTimeout(() => {
      void window.api
        .getRecommendedRunes(champKey, draft.position || 'jungle')
        .then((pages) => setRiot({ key: champKey, pages }))
        .catch(() => setRiot({ key: champKey, pages: [] }))
    }, 300)
    return () => clearTimeout(timer)
  }, [champKey, lcuStatus, draft.position, riot.key])

  // Champions du joueur (maîtrise), relus à chaque nouvelle sélection.
  useEffect(() => {
    if (lcuStatus !== 'connected' || phase !== 'ChampSelect') return
    let cancelled = false
    void window.api.getChampionPool().then((p) => {
      if (!cancelled) setPool(p)
    })
    return () => {
      cancelled = true
    }
  }, [lcuStatus, phase])

  const threat = useMemo(
    () =>
      gd
        ? analyzeThreat(
            gd,
            draft.enemyIds,
            draft.allyIds,
            live,
            champ?.id ?? null,
            catalog.profiles
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lang : les textes calculés suivent la langue
    [gd, draft.enemyIds, draft.allyIds, live, champ, catalog.profiles, lang]
  )
  const me = useMemo(() => (gd ? findMe(gd, live, champ?.id ?? null) : null), [gd, live, champ])
  const currentGold = live?.activePlayer?.currentGold ?? 0

  const runePage = useMemo(() => {
    if (!gd || !champ || !threat) return null
    const pages = riot.key === champ.key ? riot.pages : []
    // Chaque build porte son propre patch : un build d'un ancien patch laisse la place aux runes Riot.
    const buildPatch = build?.patch ?? META_PATCH
    return buildRunePage(
      gd,
      champ.label,
      genericBuild ? null : build,
      buildPatch,
      pages,
      settings.runeSource,
      threat
    )
  }, [gd, champ, threat, riot, genericBuild, build, settings.runeSource])

  const review = useReview(gd, catalog, settings.autoReview, lang)

  // Résultats du joueur par champion (bilans), pour les conseils de pick.
  const personalRecord = useMemo(() => {
    const m: PersonalRecord = new Map()
    for (const r of review.reports) {
      if (!r.champ) continue
      const rec = m.get(r.champ.id) ?? { games: 0, wins: 0 }
      rec.games++
      if (r.win) rec.wins++
      m.set(r.champ.id, rec)
    }
    return m
  }, [review.reports])

  const advice = useMemo(
    () =>
      gd && phase === 'ChampSelect' && !draft.isLocked
        ? computeDraftAdvice(gd, catalog, draft, pool, personalRecord)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lang : les textes calculés suivent la langue
    [gd, phase, draft, catalog, pool, personalRecord, lang]
  )
  const personal = useMemo(
    () =>
      settings.personalLearning && review.learning.games > 0
        ? review.learning.bonusFor(champ?.id ?? null)
        : undefined,
    [settings.personalLearning, review.learning, champ]
  )

  const plan = useMemo(
    () =>
      gd && build && threat ? buildItemPlan(gd, build, threat, me, currentGold, personal) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lang : les textes calculés suivent la langue
    [gd, build, threat, me, currentGold, personal, lang]
  )

  const bench =
    (champ && catalog.benchmarks?.[champ.id]) ?? catalog.benchmarks?.['_all'] ?? DEFAULT_BENCH
  const nudges = useMemo(
    () => liveNudges(review.learning, live, me, plan, bench),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lang : les textes calculés suivent la langue
    [review.learning, live, me, plan, bench, lang]
  )

  // Injection des runes pendant la sélection (avec délai pour ne pas spammer au survol).
  const runeKey = runePage
    ? `${runePage.payload.name}:${runePage.payload.primaryStyleId}:${runePage.payload.selectedPerkIds.join(',')}`
    : ''
  const runePayload = runePage?.payload
  useEffect(() => {
    if (!settings.autoRunes || phase !== 'ChampSelect' || !runePayload || lcuStatus !== 'connected')
      return
    if (appliedRunes.current === runeKey) return
    const timer = setTimeout(() => {
      setRuneState({ key: runeKey, sync: { state: 'pending' } })
      void window.api.applyRunes(runePayload).then((res) => {
        if (res.success) appliedRunes.current = runeKey
        setRuneState({
          key: runeKey,
          sync: res.success
            ? { state: 'ok', at: Date.now() }
            : { state: 'error', message: res.error ?? 'Erreur inconnue' }
        })
      })
    }, INJECT_DELAY)
    return () => clearTimeout(timer)
    // runePayload change à chaque calcul ; runeKey suffit à détecter un vrai changement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runeKey, phase, settings.autoRunes, lcuStatus])

  // Set d'items pour la boutique en jeu, une fois le champion verrouillé.
  const itemSetKey =
    plan && champ ? `${champ.key}:${plan.steps.map((s) => s.item.id).join(',')}` : ''
  useEffect(() => {
    if (!settings.autoItemSet || phase !== 'ChampSelect' || !draft.isLocked || !plan || !champ)
      return
    if (lcuStatus !== 'connected' || appliedItemSet.current === itemSetKey) return
    const payload = toItemSet(champ.key, champ.label, plan)
    const timer = setTimeout(() => {
      setItemSetState({ key: itemSetKey, sync: { state: 'pending' } })
      void window.api.applyItemSet(payload).then((res) => {
        if (res.success) appliedItemSet.current = itemSetKey
        setItemSetState({
          key: itemSetKey,
          sync: res.success
            ? { state: 'ok', at: Date.now() }
            : { state: 'error', message: res.error ?? 'Erreur inconnue' }
        })
      })
    }, ITEMSET_DELAY)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemSetKey, phase, draft.isLocked, settings.autoItemSet, lcuStatus])

  const runeSync: SyncState = !settings.autoRunes
    ? { state: 'disabled' }
    : runeState.key === runeKey
      ? runeState.sync
      : { state: 'idle' }
  const itemSetSync: SyncState = !settings.autoItemSet
    ? { state: 'disabled' }
    : itemSetState.key === itemSetKey
      ? itemSetState.sync
      : { state: 'idle' }

  const saveSettings = async (s: Settings): Promise<void> => {
    setSettings(await window.api.saveSettings(s))
  }

  const offRole =
    live === null && !!draft.position && draft.position !== 'jungle' && !draft.hasSmite

  return {
    lang,
    gd,
    loadError,
    catalog,
    catalogNote,
    validation,
    settings,
    saveSettings,
    lcuStatus,
    phase,
    draft,
    live,
    champ,
    build,
    genericBuild,
    threat,
    runePage,
    plan,
    currentGold,
    runeSync,
    itemSetSync,
    offRole,
    advice,
    review,
    nudges
  }
}
