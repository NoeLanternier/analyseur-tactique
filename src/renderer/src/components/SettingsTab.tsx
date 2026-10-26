import { useEffect, useState, type ReactElement } from 'react'
import type { TactiqueState } from '../hooks/useTactique'
import type { RuneSource, UpdateStatus } from '../../../shared/types'
import { Card, Toggle } from './ui'

function updateLabel(u: UpdateStatus): string {
  switch (u.state) {
    case 'checking':
      return 'recherche de mise à jour…'
    case 'available':
      return `version ${u.version ?? ''} trouvée, téléchargement…`
    case 'downloading':
      return `téléchargement ${u.percent ?? 0} %`
    case 'ready':
      return `version ${u.version ?? ''} prête`
    case 'none':
      return 'à jour'
    case 'error':
      return `erreur : ${u.message ?? ''}`
    case 'unsupported':
      return `mises à jour automatiques indisponibles (${u.message ?? ''})`
    default:
      return '—'
  }
}

/** Version installée et état des mises à jour automatiques. */
function UpdateCard(): ReactElement {
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<UpdateStatus>({ state: 'idle' })
  useEffect(() => {
    void window.api.getAppInfo().then((info) => {
      setVersion(info.version)
      setUpdate(info.update)
    })
    return window.api.onUpdateStatus(setUpdate)
  }, [])
  return (
    <Card title="Application">
      <p className="text-[11px] text-slate-300">
        Version {version} — {updateLabel(update)}
      </p>
      <div className="mt-2 flex gap-1.5">
        {update.state === 'ready' ? (
          <button
            className="rounded bg-emerald-500/20 px-2 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/30"
            onClick={() => window.api.installUpdate()}
          >
            Redémarrer et mettre à jour
          </button>
        ) : (
          update.state !== 'unsupported' && (
            <button
              className="rounded bg-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/20"
              onClick={() => window.api.checkForUpdates()}
            >
              Vérifier maintenant
            </button>
          )
        )}
      </div>
    </Card>
  )
}

export function SettingsTab({ t }: { t: TactiqueState }): ReactElement {
  const s = t.settings
  const [metaUrl, setMetaUrl] = useState(s.metaUrl)
  const [showIssues, setShowIssues] = useState(false)
  const update = (patch: Partial<typeof s>): void => void t.saveSettings({ ...s, ...patch })

  return (
    <div className="flex flex-col gap-3">
      <Card title="Automatisation">
        <Toggle
          label="Envoyer les runes automatiquement"
          hint="Crée ou met à jour une page « Tactique » pendant la sélection."
          checked={s.autoRunes}
          onChange={(v) => update({ autoRunes: v })}
        />
        <Toggle
          label="Remplacer la page active si plus de place"
          hint="Désactivé : vos pages ne sont jamais modifiées."
          checked={s.replaceActivePageIfFull}
          onChange={(v) => update({ replaceActivePageIfFull: v })}
        />
        <Toggle
          label="Set d’objets dans la boutique en jeu"
          hint="Ajoute un set « Tactique » ; vos propres sets sont conservés."
          checked={s.autoItemSet}
          onChange={(v) => update({ autoItemSet: v })}
        />
        <label className="flex items-center justify-between gap-3 py-1.5 text-xs text-slate-200">
          Source des runes
          <select
            className="rounded border border-white/10 bg-slate-900 px-2 py-1 text-xs"
            value={s.runeSource}
            onChange={(e) => update({ runeSource: e.target.value as RuneSource })}
          >
            <option value="auto">Auto (méta si à jour, sinon Riot)</option>
            <option value="tactique">Base tactique</option>
            <option value="riot">Recommandations Riot</option>
          </select>
        </label>
      </Card>

      <Card title="Démarrage">
        <Toggle
          label="Lancer avec Windows"
          hint="L’overlay démarre tout seul à l’ouverture de session (app installée)."
          checked={s.launchAtStartup}
          onChange={(v) => update({ launchAtStartup: v })}
        />
      </Card>

      <Card title="Affichage">
        <label className="flex items-center justify-between gap-3 py-1.5 text-xs text-slate-200">
          Côté de l’écran
          <select
            className="rounded border border-white/10 bg-slate-900 px-2 py-1 text-xs"
            value={s.side}
            onChange={(e) => update({ side: e.target.value as 'left' | 'right' })}
          >
            <option value="left">Gauche</option>
            <option value="right">Droite</option>
          </select>
        </label>
        <p className="text-[10px] leading-snug text-slate-500">
          Raccourci <b className="text-slate-300">Ctrl + Maj + T</b> : épingler / masquer le
          panneau. En jeu, utilisez le mode d’affichage « Sans bordures » pour voir l’overlay.
        </p>
      </Card>

      <Card title="Mise à jour de la méta">
        <p className="mb-2 text-[10px] leading-snug text-slate-500">
          URL d’un fichier JSON au format de la base (champ « builds »), pour mettre les builds à
          jour sans recompiler.
        </p>
        <div className="flex gap-1.5">
          <input
            className="min-w-0 flex-1 rounded border border-white/10 bg-slate-900 px-2 py-1 text-[11px]"
            placeholder="https://…/meta.json"
            value={metaUrl}
            onChange={(e) => setMetaUrl(e.target.value)}
          />
          <button
            className="rounded bg-lolblue/20 px-2 text-[11px] text-lolblue hover:bg-lolblue/30"
            onClick={() => update({ metaUrl })}
          >
            Appliquer
          </button>
        </div>
        {t.catalogNote && <p className="mt-1.5 text-[10px] text-slate-400">{t.catalogNote}</p>}
      </Card>

      <UpdateCard />

      <Card title="Diagnostic">
        <ul className="flex flex-col gap-1 text-[11px] text-slate-300">
          <li>
            Client LoL :{' '}
            {t.lcuStatus === 'connected'
              ? 'connecté'
              : t.lcuStatus === 'connecting'
                ? 'recherche…'
                : 'déconnecté'}
          </li>
          <li>Phase : {t.phase}</li>
          <li>
            Données Riot :{' '}
            {t.gd
              ? `version ${t.gd.version}`
              : t.loadError
                ? `erreur (${t.loadError})`
                : 'chargement…'}
          </li>
          <li>
            Base de builds : patch {t.catalog.patch} ({t.catalog.builds.size} junglers,{' '}
            {t.catalog.origin})
          </li>
          <li>
            Vérification :{' '}
            {t.validation.length === 0 ? (
              <span className="text-emerald-300">tous les noms sont valides</span>
            ) : (
              <button
                className="text-orange-300 underline"
                onClick={() => setShowIssues(!showIssues)}
              >
                {t.validation.length} point(s) à revoir
              </button>
            )}
          </li>
        </ul>
        {showIssues && (
          <ul className="mt-2 max-h-40 overflow-y-auto rounded bg-black/30 p-2 text-[10px] leading-snug text-orange-200">
            {t.validation.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}
        <Toggle
          label="Journal de debug"
          hint="Écrit tactique-debug.log dans le dossier de l’application."
          checked={s.debug}
          onChange={(v) => update({ debug: v })}
        />
      </Card>
    </div>
  )
}
