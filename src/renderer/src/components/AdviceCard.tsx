import { Ban, Sparkles } from 'lucide-react'
import type { ReactElement } from 'react'
import type { TactiqueState } from '../hooks/useTactique'
import { champIcon } from '../engine/gameData'
import { Card, Chip } from './ui'
import { fmtPct, tr } from '../../../shared/i18n'

const pct = (x: number): string => fmtPct(x, 1)

/** Conseils de pick et de ban pendant la sélection des champions. */
export function AdviceCard({ t }: { t: TactiqueState }): ReactElement | null {
  const { advice, gd, draft } = t
  if (!advice || !gd) return null
  const showBans = draft.banTurn || draft.timerPhase === 'PLANNING'
  const v = gd.version
  const noStats = !t.catalog.junglerStats

  if (advice.picks.length === 0 && (!showBans || advice.bans.length === 0)) return null

  return (
    <div className="flex flex-col gap-3">
      {showBans && advice.bans.length > 0 && (
        <Card
          title={tr('Bans conseillés', 'Suggested bans')}
          right={
            draft.banTurn ? (
              <Chip tone="red">{tr('à toi de bannir', 'your turn to ban')}</Chip>
            ) : undefined
          }
        >
          <ul className="flex flex-col gap-2">
            {advice.bans.map((b) => (
              <li key={b.champ.id} className="flex items-center gap-2">
                <Ban size={13} className="shrink-0 text-red-400" />
                <img src={champIcon(v, b.champ.id)} alt="" className="h-7 w-7 rounded" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-slate-100">{b.champ.label}</div>
                  <div className="truncate text-[10px] text-slate-400">
                    {b.reasons.join(' · ') ||
                      tr('jungler fort du patch', 'strong jungler this patch')}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {advice.picks.length > 0 && (
        <Card
          title={tr('Conseils de pick', 'Pick suggestions')}
          right={
            advice.enemyJungler ? (
              <span className="text-[10px] text-slate-400">vs {advice.enemyJungler.label}</span>
            ) : draft.pickTurn ? (
              <Chip tone="blue">{tr('à toi de choisir', 'your turn to pick')}</Chip>
            ) : undefined
          }
        >
          <ul className="flex flex-col gap-2">
            {advice.picks.map((p) => (
              <li key={p.champ.id} className="flex items-center gap-2">
                <img
                  src={champIcon(v, p.champ.id)}
                  alt=""
                  className="h-8 w-8 rounded-full border border-lolblue/60"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold text-slate-100">
                      {p.champ.label}
                    </span>
                    {!p.inPool && (
                      <span className="flex items-center gap-0.5 text-[9px] text-gold">
                        <Sparkles size={10} /> {tr('hors de tes champions', 'outside your pool')}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[10px] text-slate-400">
                    {p.reasons.slice(1).join(' · ') || p.reasons[0] || ''}
                  </div>
                </div>
                <span
                  className={`text-xs font-bold tabular-nums ${p.winRate >= 0.51 ? 'text-emerald-300' : p.winRate <= 0.49 ? 'text-orange-300' : 'text-slate-300'}`}
                >
                  {pct(p.winRate)}
                </span>
              </li>
            ))}
          </ul>
          {noStats && (
            <p className="mt-2 text-[10px] leading-snug text-slate-500">
              {tr(
                'Branche la méta distante (Réglages) pour des conseils basés sur les parties Master+.',
                'Set up the remote meta (Settings) for advice based on Master+ games.'
              )}
            </p>
          )}
        </Card>
      )}
    </div>
  )
}
