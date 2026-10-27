import { useState, type ReactElement } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleCheck,
  FolderOpen,
  History,
  LoaderCircle,
  RefreshCw,
  TriangleAlert
} from 'lucide-react'
import type { TactiqueState } from '../hooks/useTactique'
import { champIcon } from '../engine/gameData'
import { categoryLabel, tipFor, type Category, type GameReport } from '../engine/postgame'
import { fmtNumber, fmtPct, getLang, tr } from '../../../shared/i18n'
import type { Learning } from '../engine/learning'
import { Card, Chip, ItemIcon, Meter } from './ui'

const fmt = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
const fr1 = (x: number): string => fmtNumber(x, 1)
const pct = (w: number, g: number): string => (g ? fmtPct(w / g) : '—')

const GRADE_COLOR: Record<GameReport['grade'], string> = {
  S: 'text-gold',
  A: 'text-emerald-300',
  B: 'text-lolblue',
  C: 'text-orange-300',
  D: 'text-red-400'
}

const STATUS_CHIP = {
  follow: { tone: 'green', label: ['conseillé', 'suggested'] },
  plan: { tone: 'blue', label: ['prévu', 'planned'] },
  off: { tone: 'orange', label: ['hors plan', 'off plan'] }
} as const

function Toolbar({ t }: { t: TactiqueState }): ReactElement {
  const { status } = t.review
  const busy = status.state === 'waiting' || status.state === 'importing'
  const connected = t.lcuStatus === 'connected'
  const btn =
    'flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/20 disabled:opacity-40'
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        <button className={btn} disabled={busy || !connected} onClick={t.review.analyzeLast}>
          <RefreshCw size={12} /> {tr('Dernière partie', 'Last game')}
        </button>
        <button
          className={btn}
          disabled={busy || !connected}
          onClick={() => t.review.importRecent(20)}
          title={tr(
            'Analyse vos 20 dernières parties de l’historique (seules les parties en jungle sont gardées)',
            'Analyzes your last 20 games from the history (only jungle games are kept)'
          )}
        >
          <History size={12} /> {tr('Importer 20 parties', 'Import 20 games')}
        </button>
        <button
          className={btn}
          onClick={() => window.api.openReportsFolder()}
          title={tr('Dossier', 'Folder')}
        >
          <FolderOpen size={12} />
        </button>
      </div>
      {status.state === 'waiting' && (
        <p className="flex items-center gap-1 text-[10px] text-slate-400">
          <LoaderCircle size={11} className="animate-spin" />{' '}
          {tr(
            'Récupération de la partie dans le client (jusqu’à quelques minutes)…',
            'Fetching the game from the client (up to a few minutes)…'
          )}
        </p>
      )}
      {status.state === 'importing' && (
        <p className="flex items-center gap-1 text-[10px] text-slate-400">
          <LoaderCircle size={11} className="animate-spin" /> {tr('Import', 'Importing')}{' '}
          {status.done + 1}/{status.total}…
        </p>
      )}
      {status.state === 'info' && <p className="text-[10px] text-slate-400">{status.message}</p>}
      {status.state === 'error' && (
        <p className="text-[10px] text-red-300">
          {tr('Erreur', 'Error')}: {status.message}
        </p>
      )}
      {!connected && (
        <p className="text-[10px] text-slate-500">
          {tr(
            'Client LoL non connecté : import indisponible.',
            'LoL client not connected: import unavailable.'
          )}
        </p>
      )}
    </div>
  )
}

function ReportView({ r, version }: { r: GameReport; version: string }): ReactElement {
  const good = r.findings.filter((f) => f.tone === 'good').slice(0, 4)
  const bad = r.findings.filter((f) => f.tone === 'bad').slice(0, 5)
  const s = r.stats
  const o = r.objectives
  const cats = Object.entries(r.scores) as [Category, number][]
  return (
    <>
      <Card>
        <div className="flex items-center gap-3">
          {r.champ && (
            <img
              src={champIcon(version, r.champ.id)}
              alt={r.champ.label}
              className={`h-11 w-11 rounded-full border-2 ${r.win ? 'border-emerald-400' : 'border-red-400'}`}
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-cinzel text-sm font-bold text-white">
                {r.champ?.label ?? '?'}
              </span>
              <Chip tone={r.win ? 'green' : 'red'}>
                {r.win ? tr('Victoire', 'Victory') : tr('Défaite', 'Defeat')}
              </Chip>
            </div>
            <div className="text-[11px] text-slate-400">
              {r.kda} · {fmt(r.facts.duration)}
              {r.enemyJungler ? ` · vs ${r.enemyJungler.label}` : ''} ·{' '}
              {new Date(r.facts.createdAt).toLocaleDateString(
                getLang() === 'en' ? 'en-US' : 'fr-FR'
              )}
            </div>
          </div>
          <div className="text-center">
            <div className={`font-cinzel text-3xl font-bold leading-none ${GRADE_COLOR[r.grade]}`}>
              {r.grade}
            </div>
            <div className="text-[9px] text-slate-500">{r.overall}/100</div>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-1">
          {cats.map(([c, v]) => (
            <Meter
              key={c}
              label={categoryLabel(c)}
              value={v / 100}
              tone={v < 45 ? 'red' : v < 60 ? 'orange' : 'blue'}
            />
          ))}
        </div>
        {!r.hasTimeline ? (
          <p className="mt-2 text-[10px] text-slate-500">
            {tr(
              'Chronologie indisponible : analyse partielle (pas de minutage ni de rejeu du build).',
              'Timeline unavailable: partial review (no timings or build replay).'
            )}
          </p>
        ) : (
          !r.hasItems && (
            <p className="mt-2 text-[10px] leading-snug text-slate-500">
              {tr(
                'L’historique du client ne contient pas les achats : minutage des objets et balises de contrôle disponibles pour les parties jouées avec l’app ouverte.',
                'The client history has no purchases: item timings and control wards are available for games played with the app open.'
              )}
            </p>
          )
        )}
      </Card>

      {bad.length > 0 && (
        <Card title={tr('À travailler', 'To work on')}>
          <ul className="flex flex-col gap-2">
            {bad.map((f) => (
              <li key={f.id} className="flex gap-1.5">
                <TriangleAlert size={13} className="mt-0.5 shrink-0 text-orange-300" />
                <div className="min-w-0">
                  <div className="text-xs text-slate-100">{f.title}</div>
                  {f.detail && <div className="text-[10px] text-slate-400">{f.detail}</div>}
                  {tipFor(f.id, r.bench) && (
                    <div className="text-[10px] text-lolblue">→ {tipFor(f.id, r.bench)}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {good.length > 0 && (
        <Card title={tr('Points forts', 'Strengths')}>
          <ul className="flex flex-col gap-1.5">
            {good.map((f) => (
              <li key={f.id} className="flex gap-1.5">
                <CircleCheck size={13} className="mt-0.5 shrink-0 text-emerald-300" />
                <div className="min-w-0">
                  <div className="text-xs text-slate-100">{f.title}</div>
                  {f.detail && <div className="text-[10px] text-slate-400">{f.detail}</div>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {r.purchases.length > 0 && (
        <Card
          title={
            r.hasItems
              ? tr('Vos achats vs le conseil', 'Your purchases vs the advice')
              : tr('Votre build final vs le conseil', 'Your final build vs the advice')
          }
          right={
            r.adherence !== null ? (
              <Chip tone={r.adherence >= 0.7 ? 'green' : 'orange'}>
                {fmtPct(r.adherence)} {tr('conforme', 'match')}
              </Chip>
            ) : undefined
          }
        >
          <ol className="flex flex-col gap-1.5">
            {r.purchases.map((p) => (
              <li key={`${p.item.id}-${p.t}`} className="flex items-center gap-2">
                {p.t >= 0 && (
                  <span className="w-9 text-right text-[10px] tabular-nums text-slate-500">
                    {fmt(p.t)}
                  </span>
                )}
                <ItemIcon item={p.item} version={version} size={24} />
                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-200">
                  {p.item.label}
                </span>
                <Chip tone={STATUS_CHIP[p.status].tone}>
                  {tr(STATUS_CHIP[p.status].label[0], STATUS_CHIP[p.status].label[1])}
                </Chip>
                {p.status !== 'follow' && p.suggested && (
                  <ItemIcon
                    item={p.suggested}
                    version={version}
                    size={20}
                    title={`${tr('Conseillé à ce moment', 'Suggested at that time')}: ${p.suggested.label}`}
                  />
                )}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[10px] leading-snug text-slate-500">
            {r.hasItems
              ? tr(
                  'Conseil recalculé à chaque achat avec les inventaires et le score de ce moment-là.',
                  'Advice recomputed at each purchase with the inventories and score at that time.'
                )
              : tr(
                  'Conseil calculé avec les objets de fin de partie de tous les joueurs (sans minutage).',
                  'Advice computed with every player’s end-of-game items (no timings).'
                )}
          </p>
        </Card>
      )}

      <Card title={tr('Chiffres clés', 'Key stats')}>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
          <Stat
            label={tr('CS à 10 min', 'CS at 10 min')}
            value={s.cs10 !== null ? String(s.cs10) : `${fr1(s.csPerMin)}/min`}
            ref_={`${Math.round(r.bench.cs10)}`}
          />
          <Stat
            label={tr('Or à 15 min', 'Gold at 15 min')}
            value={
              s.goldDiff15 !== null
                ? `${s.goldDiff15 >= 0 ? '+' : ''}${fmtNumber(Math.round(s.goldDiff15))}`
                : '—'
            }
            ref_="vs jungler"
          />
          <Stat
            label={tr('Participation', 'Kill part.')}
            value={fmtPct(s.kp)}
            ref_={fmtPct(r.bench.kp)}
          />
          <Stat
            label={tr('1er objet', '1st item')}
            value={s.firstItemMin !== null ? `${fr1(s.firstItemMin)} min` : '—'}
            ref_={`${fr1(r.bench.firstItem)}`}
          />
          <Stat label="Vision / min" value={fr1(s.visionPerMin)} ref_={fr1(r.bench.visionPerMin)} />
          <Stat
            label={tr('Balises / 10 min', 'Wards / 10 min')}
            value={s.controlWardsPer10 !== null ? fr1(s.controlWardsPer10) : '—'}
            ref_={fr1(r.bench.controlWardsPer10)}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          <Chip>
            {tr('Dragons', 'Dragons')} {o.team.dragon + o.team.elder}/
            {o.enemy.dragon + o.enemy.elder}
          </Chip>
          <Chip>
            {tr('Larves', 'Grubs')} {o.team.grubs}/{o.enemy.grubs}
          </Chip>
          <Chip>
            {tr('Héraut', 'Herald')} {o.team.herald}/{o.enemy.herald}
          </Chip>
          <Chip>
            {tr('Nashor', 'Baron')} {o.team.baron}/{o.enemy.baron}
          </Chip>
          {o.team.atakhan + o.enemy.atakhan > 0 && (
            <Chip>
              Atakhan {o.team.atakhan}/{o.enemy.atakhan}
            </Chip>
          )}
          {o.smited > 0 && (
            <Chip tone="blue">
              {o.smited} {tr('au Châtiment', 'with Smite')}
            </Chip>
          )}
        </div>
        <p className="mt-2 text-[10px] text-slate-500">
          {r.benchSource === 'master'
            ? tr(
                'Repères : moyennes des junglers Master+ du patch.',
                'Benchmarks: averages of Master+ junglers this patch.'
              )
            : tr(
                'Repères par défaut (les chiffres Master+ arrivent avec la méta distante).',
                'Default benchmarks (Master+ numbers come with the remote meta).'
              )}
        </p>
      </Card>
    </>
  )
}

function Stat({
  label,
  value,
  ref_
}: {
  label: string
  value: string
  ref_: string
}): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <span className="text-slate-400">{label}</span>
      <span>
        <span className="font-semibold text-slate-100">{value}</span>{' '}
        <span className="text-[9px] text-slate-500">({ref_})</span>
      </span>
    </div>
  )
}

function ProgressCard({ l }: { l: Learning }): ReactElement {
  return (
    <Card
      title={tr('Progression et apprentissage', 'Progress & learning')}
      right={
        <Chip>
          {l.games} {tr('parties', 'games')}
        </Chip>
      }
    >
      <div className="flex flex-col gap-1 text-[11px] text-slate-300">
        <div>
          {tr('Victoires', 'Wins')}: <b className="text-slate-100">{pct(l.wins, l.games)}</b>
          {l.averageOverall !== null && (
            <>
              {' '}
              · {tr('note moyenne (10 dernières)', 'average score (last 10)')}:{' '}
              <b className="text-slate-100">{l.averageOverall}</b>
            </>
          )}
        </div>
        {(l.followed.games > 0 || l.deviated.games > 0) && (
          <div>
            {tr('Build suivi', 'Build followed')}:{' '}
            <b className="text-emerald-300">{pct(l.followed.wins, l.followed.games)}</b> (
            {l.followed.games}) · {tr('sinon', 'otherwise')}:{' '}
            <b className="text-orange-300">{pct(l.deviated.wins, l.deviated.games)}</b> (
            {l.deviated.games})
          </div>
        )}
      </div>

      {l.trends.length > 0 && (
        <div className="mt-2 flex flex-col gap-0.5 border-t border-white/5 pt-2">
          <span className="text-[9px] uppercase tracking-wider text-slate-500">
            {tr('5 dernières parties vs 5 précédentes', 'Last 5 games vs previous 5')}
          </span>
          {l.trends.map((trend) => {
            const better =
              trend.recent === trend.previous
                ? null
                : trend.recent > trend.previous === trend.higherIsBetter
            return (
              <div key={trend.key} className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">{trend.label}</span>
                <span className="flex items-center gap-1 tabular-nums">
                  <span className="text-slate-500">{trend.format(trend.previous)} →</span>
                  <span className="text-slate-100">{trend.format(trend.recent)}</span>
                  {better === true && <ArrowUpRight size={12} className="text-emerald-300" />}
                  {better === false && <ArrowDownRight size={12} className="text-red-300" />}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {l.recurring.length > 0 && (
        <div className="mt-2 border-t border-white/5 pt-2">
          <span className="text-[9px] uppercase tracking-wider text-slate-500">
            {tr(
              'Points faibles récurrents (surveillés en partie)',
              'Recurring weaknesses (watched in game)'
            )}
          </span>
          <ul className="mt-1 flex flex-col gap-1">
            {l.recurring.slice(0, 4).map((x) => (
              <li key={x.id} className="text-[11px]">
                <span className="text-orange-300">{x.label}</span>{' '}
                <span className="text-slate-500">
                  ({x.count}/{x.of})
                </span>
                {x.tip && <div className="text-[10px] text-slate-400">{x.tip}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {l.strengths.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-white/5 pt-2">
          <span className="text-[9px] uppercase tracking-wider text-slate-500">
            {tr('Points forts', 'Strengths')}
          </span>
          {l.strengths.slice(0, 4).map((x) => (
            <Chip key={x.id} tone="green">
              {x.label}
            </Chip>
          ))}
        </div>
      )}

      {l.items.length > 0 && (
        <div className="mt-2 border-t border-white/5 pt-2">
          <span className="text-[9px] uppercase tracking-wider text-slate-500">
            {tr('Vos objets (écart à votre taux de victoire)', 'Your items (vs your win rate)')}
          </span>
          <div className="mt-1 flex flex-wrap gap-1">
            {l.items.map((it) => (
              <Chip key={it.name} tone={it.delta >= 0 ? 'green' : 'red'}>
                {it.name} {it.delta >= 0 ? '+' : ''}
                {Math.round(it.delta * 100)} {tr('pts', 'pts')} ({it.wins}/{it.games})
              </Chip>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-slate-500">
            {tr(
              'Ces résultats ajustent légèrement le build conseillé (réglable dans Réglages).',
              'These results slightly adjust the suggested build (can be turned off in Settings).'
            )}
          </p>
        </div>
      )}
    </Card>
  )
}

export function ReviewTab({ t }: { t: TactiqueState }): ReactElement | null {
  const [selected, setSelected] = useState<number | null>(null)
  const { gd } = t
  const { reports, learning } = t.review
  if (!gd) return null
  const current = reports.find((r) => r.facts.gameId === selected) ?? reports[0] ?? null

  return (
    <div className="flex flex-col gap-3">
      <Toolbar t={t} />

      {reports.length === 0 ? (
        <Card title={tr('Bilan d’après-partie', 'Post-game review')}>
          <p className="text-[11px] leading-relaxed text-slate-400">
            {tr(
              'À la fin de chaque partie jouée en jungle, l’application récupère la partie dans le client et analyse votre farm, votre build (comparé aux conseils de chaque moment), vos morts, les objectifs et la vision. Les points faibles qui reviennent sont rappelés avant et pendant les parties suivantes, et vos résultats affinent le build conseillé.',
              'After each jungle game, the app fetches the game from the client and reviews your farm, your build (compared with the advice at each moment), your deaths, objectives and vision. Recurring weaknesses are recalled before and during your next games, and your results refine the suggested build.'
            )}
          </p>
          <p className="mt-2 text-[11px] text-slate-300">
            {tr(
              'Pour démarrer tout de suite : « Importer 20 parties ».',
              'To get started right away: “Import 20 games”.'
            )}
          </p>
        </Card>
      ) : (
        <>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {reports.slice(0, 20).map((r) => (
              <button
                key={r.facts.gameId}
                onClick={() => setSelected(r.facts.gameId)}
                title={`${r.champ?.label ?? ''} ${r.kda} — ${r.grade}`}
                className={`relative shrink-0 rounded-full border-2 ${r.win ? 'border-emerald-400/70' : 'border-red-400/70'} ${current === r ? 'ring-2 ring-lolblue' : 'opacity-70 hover:opacity-100'}`}
              >
                {r.champ && (
                  <img
                    src={champIcon(gd.version, r.champ.id)}
                    alt={r.champ.label}
                    className="h-8 w-8 rounded-full"
                  />
                )}
                <span
                  className={`absolute -bottom-1 -right-1 rounded bg-black/80 px-0.5 text-[8px] font-bold ${GRADE_COLOR[r.grade]}`}
                >
                  {r.grade}
                </span>
              </button>
            ))}
          </div>
          {current && <ReportView r={current} version={gd.version} />}
          <ProgressCard l={learning} />
        </>
      )}
    </div>
  )
}
