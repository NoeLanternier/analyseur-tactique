import { Coins, LoaderCircle, TriangleAlert, Check, Info, Lightbulb } from 'lucide-react'
import type { ReactElement } from 'react'
import type { TactiqueState, SyncState } from '../hooks/useTactique'
import { champIcon } from '../engine/gameData'
import { SHARD_NAMES } from '../engine/runes'
import { Card, Chip, ItemIcon, RuneIcon } from './ui'
import { AdviceCard } from './AdviceCard'

const ARCHETYPE_LABEL: Record<string, string> = {
  AD_FIGHTER: 'Combattant AD',
  AD_ASSASSIN: 'Assassin AD',
  AD_CARRY: 'Carry AD',
  AP_FIGHTER: 'Combattant AP',
  AP_BURST: 'Mage / burst AP',
  TANK: 'Tank',
  ENCHANTER: 'Soutien'
}

const KIND_LABEL: Record<string, string> = {
  starter: 'Départ',
  core: 'Cœur',
  boots: 'Bottes',
  antiheal: 'Anti-soins',
  situational: 'Situationnel',
  owned: 'Acheté'
}

function SyncBadge({ sync, okText }: { sync: SyncState; okText: string }): ReactElement | null {
  switch (sync.state) {
    case 'pending':
      return (
        <span className="flex items-center gap-1 text-[10px] text-slate-400">
          <LoaderCircle size={11} className="animate-spin" /> envoi…
        </span>
      )
    case 'ok':
      return (
        <span className="flex items-center gap-1 text-[10px] text-emerald-300">
          <Check size={11} /> {okText}
        </span>
      )
    case 'error':
      return (
        <span className="flex items-center gap-1 text-[10px] text-red-300" title={sync.message}>
          <TriangleAlert size={11} /> échec
        </span>
      )
    case 'disabled':
      return <span className="text-[10px] text-slate-500">auto désactivé</span>
    default:
      return null
  }
}

/** Rappels tirés des bilans : avant la partie (points faibles) et pendant (situations à risque). */
function CoachCard({ t, inGame }: { t: TactiqueState; inGame: boolean }): ReactElement | null {
  if (inGame) {
    if (t.nudges.length === 0) return null
    return (
      <Card title="Coach">
        <ul className="flex flex-col gap-1">
          {t.nudges.map((n) => (
            <li
              key={n.id}
              className={`flex gap-1.5 text-[11px] ${n.tone === 'orange' ? 'text-orange-200' : 'text-slate-200'}`}
            >
              <Lightbulb size={12} className="mt-0.5 shrink-0 text-gold" /> {n.text}
            </li>
          ))}
        </ul>
      </Card>
    )
  }
  const recurring = t.review.learning.recurring.slice(0, 3)
  if (recurring.length === 0) return null
  return (
    <Card title="Rappels de vos dernières parties">
      <ul className="flex flex-col gap-1.5">
        {recurring.map((r) => (
          <li key={r.id} className="flex gap-1.5">
            <Lightbulb size={12} className="mt-0.5 shrink-0 text-gold" />
            <div className="min-w-0">
              <div className="text-[11px] text-orange-200">
                {r.label}{' '}
                <span className="text-slate-500">
                  ({r.count}/{r.of})
                </span>
              </div>
              {r.tip && <div className="text-[10px] text-slate-400">{r.tip}</div>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function BuildTab({ t }: { t: TactiqueState }): ReactElement | null {
  const { gd, champ, build, runePage, plan, live } = t
  if (!gd) return null

  if (!champ || !build) {
    if (t.advice && (t.advice.picks.length > 0 || t.advice.bans.length > 0)) {
      return <AdviceCard t={t} />
    }
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-slate-400">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-lolblue border-t-transparent" />
        <p className="text-sm">
          {t.lcuStatus === 'connected'
            ? 'Survolez un champion en sélection…'
            : 'En attente du client League of Legends…'}
        </p>
        <p className="max-w-[260px] text-[11px] text-slate-500">
          Les runes et l’ordre d’objets s’adaptent automatiquement à la composition adverse, puis au
          déroulé de la partie.
        </p>
      </div>
    )
  }

  const v = gd.version
  const inGame = live !== null

  return (
    <div className="flex flex-col gap-3">
      {/* Champion */}
      <div className="flex items-center gap-3">
        <img
          src={champIcon(v, champ.id)}
          alt={champ.name}
          className="h-12 w-12 rounded-full border-2 border-lolblue"
        />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-cinzel text-lg font-bold text-white">{champ.name}</h1>
          <div className="flex flex-wrap items-center gap-1">
            <Chip tone="blue">{ARCHETYPE_LABEL[build.archetype]}</Chip>
            {build.skills && <Chip>Montée {build.skills.replace(/>/g, ' > ')}</Chip>}
            {build.games && !t.genericBuild && (
              <Chip tone="green">
                {build.games.toLocaleString('fr-FR')} parties Master+
                {build.winRate
                  ? ` · ${(build.winRate * 100).toFixed(1).replace('.', ',')} % V`
                  : ''}
                {build.patch ? ` · patch ${build.patch}` : ''}
              </Chip>
            )}
            {inGame && <Chip tone="green">En partie {formatTime(live.gameTime)}</Chip>}
            {!inGame && t.draft.isLocked && <Chip tone="green">Verrouillé</Chip>}
          </div>
        </div>
      </div>

      {!inGame && !t.draft.isLocked && <AdviceCard t={t} />}
      {!inGame && <CoachCard t={t} inGame={false} />}

      {t.genericBuild && (
        <p className="flex gap-1.5 rounded border border-orange-400/30 bg-orange-500/10 p-2 text-[11px] text-orange-200">
          <Info size={13} className="mt-0.5 shrink-0" /> Champion absent de la base jungle : build
          générique ({ARCHETYPE_LABEL[build.archetype]}) et runes recommandées par Riot.
        </p>
      )}
      {t.offRole && (
        <p className="flex gap-1.5 rounded border border-slate-500/30 bg-slate-500/10 p-2 text-[11px] text-slate-300">
          <Info size={13} className="mt-0.5 shrink-0" /> Poste « {t.draft.position} » : l’analyse
          est optimisée pour la jungle.
        </p>
      )}

      {/* Prochain achat (en partie) */}
      {inGame && plan?.next && (
        <Card
          title="Prochain achat"
          right={
            <span className="flex items-center gap-1 text-[11px] text-gold">
              <Coins size={12} /> {Math.floor(t.currentGold)} po
            </span>
          }
        >
          <div className="flex items-center gap-3">
            <ItemIcon item={plan.next.item} version={v} size={40} highlight />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-white">
                {plan.next.item.nameFr}
              </div>
              {plan.next.affordable ? (
                <div className="text-[11px] text-emerald-300">
                  Achetable maintenant ({plan.next.remaining} po)
                </div>
              ) : (
                <div className="text-[11px] text-slate-400">
                  Il manque {Math.max(0, Math.ceil(plan.next.remaining - t.currentGold))} po
                  {plan.next.component && (
                    <>
                      {' '}
                      · achetez <span className="text-slate-200">{plan.next.component.nameFr}</span>
                    </>
                  )}
                </div>
              )}
            </div>
            {plan.next.component && <ItemIcon item={plan.next.component} version={v} size={28} />}
          </div>
          {plan.next.sellHint && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-orange-300">
              <TriangleAlert size={12} className="shrink-0" /> {plan.next.sellHint}
            </p>
          )}
        </Card>
      )}

      {inGame && <CoachCard t={t} inGame />}

      {/* Runes */}
      {runePage ? (
        <Card
          title="Runes"
          right={
            !inGame ? (
              <SyncBadge sync={t.runeSync} okText="page envoyée" />
            ) : (
              <Chip>verrouillées en partie</Chip>
            )
          }
        >
          <div className="flex items-center gap-2">
            <RuneIcon rune={runePage.runes[0]} size={38} keystone />
            <div className="flex flex-1 flex-col gap-1">
              <div className="flex items-center gap-1">
                {runePage.runes.slice(1, 4).map((r) => (
                  <RuneIcon key={r.id} rune={r} />
                ))}
                <span className="mx-1 h-4 w-px bg-white/15" />
                {runePage.runes.slice(4, 6).map((r) => (
                  <RuneIcon key={r.id} rune={r} size={18} />
                ))}
              </div>
              <div className="text-[10px] text-slate-400">
                {runePage.runes[0].nameFr} · {runePage.primaryTree.nameFr} /{' '}
                {runePage.subTree.nameFr}
              </div>
            </div>
          </div>
          <div className="mt-2 text-[10px] leading-relaxed text-slate-400">
            Fragments : {runePage.shards.map((s) => SHARD_NAMES[s] ?? s).join(' · ')}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {runePage.reasons.map((r) => (
              <Chip key={r} tone={r.startsWith('Fragment') ? 'orange' : 'slate'}>
                {r}
              </Chip>
            ))}
          </div>
          {t.runeSync.state === 'error' && (
            <p className="mt-2 text-[10px] leading-snug text-red-300">{t.runeSync.message}</p>
          )}
        </Card>
      ) : (
        <Card title="Runes">
          <p className="text-[11px] text-slate-400">
            Aucune page disponible pour ce champion (client non connecté ?).
          </p>
        </Card>
      )}

      {/* Objets */}
      {plan && (
        <Card
          title={inGame ? 'Build adapté à la partie' : 'Ordre d’objets adaptatif'}
          right={!inGame ? <SyncBadge sync={t.itemSetSync} okText="dans la boutique" /> : undefined}
        >
          <ol className="flex flex-col gap-1.5">
            {plan.steps.map((s, i) => {
              const isNext = inGame && plan.next?.item.id === s.item.id && !s.owned
              return (
                <li
                  key={`${s.item.id}-${i}`}
                  className={`flex items-center gap-2 rounded px-1 py-0.5 ${isNext ? 'bg-lolblue/10' : ''}`}
                >
                  <span className="w-4 text-right text-[10px] tabular-nums text-slate-500">
                    {i + 1}
                  </span>
                  <ItemIcon
                    item={s.item}
                    version={v}
                    size={28}
                    owned={s.owned}
                    highlight={isNext}
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className={`truncate text-xs ${s.owned ? 'text-slate-500 line-through' : 'text-slate-100'}`}
                    >
                      {s.item.nameFr}
                    </div>
                    <div className="flex gap-1">
                      <span className="text-[9px] uppercase tracking-wider text-slate-500">
                        {KIND_LABEL[s.kind]}
                      </span>
                      {s.reason && (
                        <Chip tone={s.swapped ? 'red' : s.kind === 'antiheal' ? 'orange' : 'blue'}>
                          {s.swapped ? `priorité · ${s.reason}` : s.reason}
                        </Chip>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
          {plan.alternatives.length > 0 && (
            <div className="mt-3 flex items-center gap-1.5 border-t border-white/5 pt-2">
              <span className="w-16 text-[10px] uppercase tracking-wider text-slate-500">
                Si besoin
              </span>
              {plan.alternatives.map((s) => (
                <ItemIcon
                  key={s.item.id}
                  item={s.item}
                  version={v}
                  size={24}
                  title={`${s.item.nameFr}${s.reason ? ` — ${s.reason}` : ''}`}
                />
              ))}
            </div>
          )}
          {t.itemSetSync.state === 'error' && (
            <p className="mt-2 text-[10px] leading-snug text-red-300">
              Set d’items : {t.itemSetSync.message}
            </p>
          )}
        </Card>
      )}
    </div>
  )
}
