// Types partagés entre le processus main, le preload et l'interface.
// Aucun code exécutable ici : uniquement des types.
import type { Lang, LanguageSetting } from './i18n'

export type LcuStatus = 'disconnected' | 'connecting' | 'connected'

export type GamePhase =
  | 'None'
  | 'Lobby'
  | 'Matchmaking'
  | 'ReadyCheck'
  | 'ChampSelect'
  | 'GameStart'
  | 'InProgress'
  | 'WaitingForStats'
  | 'PreEndOfGame'
  | 'EndOfGame'
  | 'Reconnect'
  | 'TerminatedInError'
  | string

export interface DraftPlayer {
  cellId: number
  championId: number
  /** Position assignée par le client ("jungle", "top"...), vide en partie normale/blind. */
  position: string
  spell1Id: number
  spell2Id: number
}

export interface DraftState {
  /** Champion survolé ou verrouillé par le joueur local (0 = aucun). */
  localChampId: number
  isLocked: boolean
  /** Position du joueur local ("jungle", "top", "", ...). */
  position: string
  /** Le joueur local a Châtiment (11) dans ses sorts. */
  hasSmite: boolean
  allyIds: number[]
  enemyIds: number[]
  /** Champions bannis (des deux équipes). */
  bannedIds: number[]
  /** C'est au joueur local de bannir / de choisir maintenant. */
  banTurn: boolean
  pickTurn: boolean
  /** Phase du minuteur de sélection : PLANNING, BAN_PICK, FINALIZATION... */
  timerPhase: string
}

/** Champions du joueur : maîtrise (points) et champions possédés ou gratuits. */
export interface ChampionPool {
  mastery: { championId: number; points: number }[]
  owned: number[]
}

export type UpdateState =
  'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'none' | 'error' | 'unsupported'

export interface UpdateStatus {
  state: UpdateState
  version?: string
  percent?: number
  message?: string
}

export const EMPTY_DRAFT: DraftState = {
  localChampId: 0,
  isLocked: false,
  position: '',
  hasSmite: false,
  allyIds: [],
  enemyIds: [],
  bannedIds: [],
  banTurn: false,
  pickTurn: false,
  timerPhase: ''
}

export interface RunePagePayload {
  name: string
  primaryStyleId: number
  subStyleId: number
  /** 9 identifiants : 6 runes (keystone + 3 primaires + 2 secondaires) puis 3 fragments. */
  selectedPerkIds: number[]
}

export interface ItemSetBlock {
  type: string
  items: { id: string; count: number }[]
}

export interface ItemSetPayload {
  title: string
  championId: number
  blocks: ItemSetBlock[]
}

export interface ActionResult {
  success: boolean
  error?: string
}

/** Page de runes recommandée par le client Riot (normalisée). */
export interface RecommendedRunePage {
  primaryStyleId: number
  subStyleId: number
  perkIds: number[]
  keystoneId: number
  summonerSpellIds: number[]
}

export interface LiveItem {
  itemID: number
  count: number
  slot: number
}

export interface LivePlayer {
  championName: string
  rawChampionName: string
  riotId: string
  summonerName: string
  team: 'ORDER' | 'CHAOS' | string
  level: number
  isDead: boolean
  items: LiveItem[]
  scores: { kills: number; deaths: number; assists: number; creepScore: number; wardScore: number }
}

export interface LiveGameData {
  gameTime: number
  activePlayer: {
    riotId: string
    summonerName: string
    currentGold: number
    level: number
  } | null
  allPlayers: LivePlayer[]
}

export type RuneSource = 'auto' | 'tactique' | 'riot'

export interface Settings {
  /** Injection automatique de la page de runes. */
  autoRunes: boolean
  /** Si toutes les pages sont utilisées, remplacer la page active (sinon : message d'erreur). */
  replaceActivePageIfFull: boolean
  /** Envoyer l'ordre d'items adaptatif dans la boutique en jeu (set d'items du client). */
  autoItemSet: boolean
  /** Origine des runes : auto (base tactique si à jour, sinon Riot), base tactique, ou recommandations Riot. */
  runeSource: RuneSource
  /** Côté de l'écran où s'affiche l'overlay. */
  side: 'left' | 'right'
  /** URL optionnelle d'un JSON de builds pour mettre la base à jour sans recompiler. */
  metaUrl: string
  /** Journal de debug dans le dossier de l'application. */
  debug: boolean
  /** Lancer l'application au démarrage de Windows. */
  launchAtStartup: boolean
  /** Bilan automatique en fin de partie. */
  autoReview: boolean
  /** Adapter le build à vos propres résultats (apprentissage à partir des bilans). */
  personalLearning: boolean
  /** Langue de l'application : auto = langue du client League of Legends. */
  language: LanguageSetting
}

export const DEFAULT_SETTINGS: Settings = {
  autoRunes: true,
  replaceActivePageIfFull: false,
  autoItemSet: true,
  runeSource: 'auto',
  side: 'left',
  metaUrl: '',
  debug: false,
  launchAtStartup: true,
  autoReview: true,
  personalLearning: true,
  language: 'auto'
}

/** Partie de l'historique du client. */
export interface RecentGame {
  gameId: number
  createdAt: number
  queueId: number
  mapId: number
}

/** Données brutes d'après-partie lues dans le client (format de l'historique Riot). */
/**
 * Journal enregistré pendant la partie à partir de l'API en jeu (toutes les 2 s) : l'historique du
 * client ne contient pas les achats d'objets, ce journal permet d'en connaître le minutage exact.
 */
export interface GameJournal {
  /** Heure (ms) correspondant au début de la partie. */
  startedAt: number
  /** Temps de jeu (s) du premier relevé : au-delà de ~2 min, l'app a été ouverte en cours de partie. */
  from: number
  lastTime: number
  /** Indice du joueur local dans players (-1 si inconnu). */
  me: number
  players: { champ: string; raw: string; team: string }[]
  /** [seconde, indice du joueur, objet, op] : 1 = apparu dans l'inventaire, 0 = disparu. */
  items: [number, number, number, number][]
  /** [seconde, or en poche] du joueur local. */
  gold: [number, number][]
}

export interface RawPostGame {
  gameId: number
  game: unknown
  timeline: unknown
  puuid: string
  summonerId: number
  /** Dernier journal de partie enregistré (rattaché si les champions correspondent). */
  journal?: GameJournal | null
}

export interface TactiqueApi {
  onDraftUpdate: (cb: (draft: DraftState) => void) => () => void
  onPhaseUpdate: (cb: (phase: GamePhase) => void) => () => void
  onLcuStatus: (cb: (status: LcuStatus) => void) => () => void
  onLiveUpdate: (cb: (data: LiveGameData | null) => void) => () => void
  onTogglePin: (cb: () => void) => () => void
  getInitialState: () => Promise<{
    status: LcuStatus
    phase: GamePhase
    draft: DraftState
    lang: Lang
  }>
  /** Langue effective (réglage, ou langue du client LoL en mode auto). */
  onLangUpdate: (cb: (lang: Lang) => void) => () => void
  applyRunes: (payload: RunePagePayload) => Promise<ActionResult>
  applyItemSet: (payload: ItemSetPayload) => Promise<ActionResult>
  getRecommendedRunes: (championId: number, position: string) => Promise<RecommendedRunePage[]>
  getChampionPool: () => Promise<ChampionPool>
  getAppInfo: () => Promise<{ version: string; update: UpdateStatus }>
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => () => void
  checkForUpdates: () => void
  installUpdate: () => void
  getSettings: () => Promise<Settings>
  saveSettings: (settings: Settings) => Promise<Settings>
  fetchMetaOverride: (url: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>
  /** Attend la partie qui vient de se terminer (jusqu'à 4 min) et la renvoie. */
  waitForFinishedGame: (sinceMs: number) => Promise<RawPostGame | null>
  getRecentGames: (count: number) => Promise<RecentGame[]>
  getGameDetails: (gameId: number) => Promise<RawPostGame | null>
  /** Bilans enregistrés (données compactes de chaque partie), les plus récents d'abord. */
  listReports: () => Promise<unknown[]>
  saveReport: (gameId: number, facts: unknown) => Promise<ActionResult>
  openReportsFolder: () => void
  setOverlayMode: (expanded: boolean) => void
  closeApp: () => void
}
