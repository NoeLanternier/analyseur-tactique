import { Activity } from 'lucide-react'
import type { ReactElement } from 'react'
import type { TactiqueState } from '../hooks/useTactique'
import { champIcon } from '../engine/gameData'
import { Card, Chip, Meter } from './ui'

export function AnalysisTab({ t }: { t: TactiqueState }): ReactElement | null {
  const { gd, threat } = t
  if (!gd || !threat) return null
  if (threat.enemies.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-400">
        Aucun adversaire connu pour l’instant.
        <br />
        <span className="text-[11px] text-slate-500">
          L’analyse se remplit au fil des choix adverses, puis en partie.
        </span>
      </p>
    )
  }
  const m = threat.metrics
  const v = gd.version
  return (
    <div className="flex flex-col gap-3">
      {threat.fed && (
        <div className="flex items-center gap-2 rounded border border-red-400/40 bg-red-500/10 p-2">
          <Activity size={16} className="shrink-0 animate-pulse text-red-400" />
          <img src={champIcon(v, threat.fed.champ.id)} className="h-7 w-7 rounded-full" alt="" />
          <div className="text-[11px] leading-snug text-red-200">
            <b>{threat.fed.champ.name}</b> est la menace principale ({threat.fed.kda}). Le build
            donne la priorité à la défense contre lui.
          </div>
        </div>
      )}

      <Card
        title={threat.live ? 'Menace en partie (pondérée par l’avance)' : 'Composition adverse'}
      >
        <div className="mb-2 flex h-2 overflow-hidden rounded">
          <div className="bg-sky-400" style={{ width: `${m.ap * 100}%` }} />
          <div className="bg-orange-400" style={{ width: `${m.ad * 100}%` }} />
        </div>
        <div className="mb-3 flex justify-between text-[10px]">
          <span className="text-sky-300">Magique {Math.round(m.ap * 100)} %</span>
          <span className="text-orange-300">Physique {Math.round(m.ad * 100)} %</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Meter label="Résistance" value={m.tanky} />
          <Meter label="Contrôles" value={m.cc} />
          <Meter label="Soins" value={m.heal} tone="orange" />
          <Meter label="Burst" value={m.burst} tone="red" />
          <Meter label="Critiques" value={m.crit} />
          <Meter label="Attaques de base" value={m.aa} />
          <Meter label="Boucliers" value={m.shield} />
          {threat.live && <Meter label="Avance de l’équipe" value={m.ahead} />}
          {threat.live && <Meter label="Retard de l’équipe" value={m.behind} tone="red" />}
        </div>
      </Card>

      <Card title="Lecture tactique">
        <ul className="flex list-disc flex-col gap-1 pl-4 text-[11px] leading-snug text-slate-300">
          {threat.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Card>

      <Card title="Adversaires">
        <ul className="flex flex-col gap-1.5">
          {threat.enemies.map((e) => (
            <li key={e.champ.id} className="flex items-center gap-2 text-[11px]">
              <img src={champIcon(v, e.champ.id)} className="h-6 w-6 rounded" alt="" />
              <span className="flex-1 truncate text-slate-200">{e.champ.name}</span>
              {threat.live && <span className="tabular-nums text-slate-400">{e.kda}</span>}
              {threat.live && (
                <span className="w-12 text-right tabular-nums text-gold">
                  {(e.itemGold / 1000).toFixed(1)}k
                </span>
              )}
              <Chip tone={e.ap >= 0.6 ? 'blue' : e.ap <= 0.4 ? 'orange' : 'slate'}>
                {e.ap >= 0.6 ? 'AP' : e.ap <= 0.4 ? 'AD' : 'Mixte'}
              </Chip>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
