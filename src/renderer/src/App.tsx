import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Activity, Gauge, LoaderCircle, Pin, PinOff, Settings, Swords, X, Zap } from 'lucide-react'
import { useTactique } from './hooks/useTactique'
import { BuildTab } from './components/BuildTab'
import { AnalysisTab } from './components/AnalysisTab'
import { SettingsTab } from './components/SettingsTab'

type Tab = 'build' | 'analyse' | 'settings'

export default function App(): ReactElement {
  const t = useTactique()
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [tab, setTab] = useState<Tab>('build')
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const expanded = hovered || pinned

  useEffect(() => window.api.onTogglePin(() => setPinned((p) => !p)), [])

  // Le panneau ouvert capte la souris ; fermé, les clics traversent vers le jeu.
  useEffect(() => {
    window.api.setOverlayMode(expanded)
  }, [expanded])

  const onEnter = (): void => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    setHovered(true)
  }
  const onLeave = (): void => {
    leaveTimer.current = setTimeout(() => setHovered(false), 250)
  }

  const side = t.settings.side
  const fed = t.threat?.fed

  if (!expanded) {
    return (
      <div className="pointer-events-none relative h-screen w-screen">
        <div
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          className={`pointer-events-auto absolute top-1/2 flex h-20 w-11 -translate-y-1/2 cursor-pointer items-center justify-center border border-white/20 bg-[#0a0d14]/90 shadow-[2px_0_15px_rgba(0,0,0,0.5)] backdrop-blur-md transition-colors hover:bg-[#0a0d14] ${side === 'left' ? 'left-0 rounded-r-2xl border-l-0' : 'right-0 rounded-l-2xl border-r-0'}`}
        >
          {!t.gd ? (
            <LoaderCircle size={18} className="animate-spin text-gold" />
          ) : fed ? (
            <Activity
              size={22}
              className="animate-pulse text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.6)]"
            />
          ) : (
            <Zap
              size={22}
              className={`${t.champ ? 'text-lolblue' : 'text-slate-500'} drop-shadow-[0_0_8px_rgba(10,200,185,0.6)]`}
            />
          )}
        </div>
      </div>
    )
  }

  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: 'build', label: 'Build', icon: <Swords size={13} /> },
    { id: 'analyse', label: 'Analyse', icon: <Gauge size={13} /> },
    { id: 'settings', label: 'Réglages', icon: <Settings size={13} /> }
  ]

  return (
    <div className="h-screen w-screen p-0">
      <div
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-panel font-sans shadow-2xl"
      >
        <header className="flex h-11 shrink-0 items-center justify-between bg-[#0a0d14] px-3">
          <span className="flex items-center gap-2 font-cinzel text-sm font-bold tracking-widest text-gold">
            <Zap size={14} className={t.champ ? 'text-lolblue' : 'text-slate-600'} /> Analyseur
            Tactique
          </span>
          <div className="flex items-center gap-2">
            <span
              title={`Client LoL : ${t.lcuStatus}`}
              className={`h-2 w-2 rounded-full ${t.lcuStatus === 'connected' ? 'bg-emerald-400' : t.lcuStatus === 'connecting' ? 'bg-amber-400' : 'bg-slate-600'}`}
            />
            <button
              title="Épingler (Ctrl+Maj+T)"
              onClick={() => setPinned(!pinned)}
              className="text-slate-400 hover:text-lolblue"
            >
              {pinned ? <PinOff size={15} /> : <Pin size={15} />}
            </button>
            <button
              title="Quitter"
              onClick={() => window.api.closeApp()}
              className="text-slate-400 hover:text-red-500"
            >
              <X size={17} />
            </button>
          </div>
        </header>

        <nav className="flex shrink-0 border-b border-white/5 bg-[#0a0d14]/60">
          {tabs.map((x) => (
            <button
              key={x.id}
              onClick={() => setTab(x.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-[11px] font-semibold uppercase tracking-wider ${tab === x.id ? 'border-b-2 border-lolblue text-lolblue' : 'text-slate-500 hover:text-slate-300'}`}
            >
              {x.icon} {x.label}
              {x.id === 'analyse' && fed && (
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              )}
            </button>
          ))}
        </nav>

        <main className="flex flex-1 flex-col overflow-y-auto p-3">
          {!t.gd && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-slate-400">
              <LoaderCircle className="animate-spin text-gold" />
              Chargement des données Riot…
              {t.loadError && (
                <span className="text-[11px] text-red-300">
                  {t.loadError} — nouvel essai dans 10 s
                </span>
              )}
            </div>
          )}
          {t.gd && tab === 'build' && <BuildTab t={t} />}
          {t.gd && tab === 'analyse' && <AnalysisTab t={t} />}
          {tab === 'settings' && <SettingsTab t={t} />}
        </main>
      </div>
    </div>
  )
}
