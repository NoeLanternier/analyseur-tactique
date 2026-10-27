import { app } from 'electron'
import type { UpdateStatus } from '../shared/types'
import { debugLog } from './logger'
import { tr } from '../shared/i18n'

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

// Mises à jour automatiques : l'app installée (programme d'installation Windows) vérifie les
// « Releases » GitHub du dépôt de l'app, télécharge la nouvelle version en arrière-plan et
// l'installe à la fermeture (ou tout de suite via le bouton « Redémarrer »).

const CHECK_EVERY = 6 * 3600 * 1000

let status: UpdateStatus = { state: 'idle' }
let updater: any = null

export function getUpdateStatus(): UpdateStatus {
  return status
}

export function initUpdater(onStatus: (s: UpdateStatus) => void): void {
  const set = (s: UpdateStatus): void => {
    status = s
    onStatus(s)
  }
  if (!app.isPackaged)
    return set({ state: 'unsupported', message: tr('mode développement', 'development mode') })
  if (process.env['PORTABLE_EXECUTABLE_FILE']) {
    return set({
      state: 'unsupported',
      message: tr(
        'version portable : utilisez le programme d’installation',
        'portable version: use the installer'
      )
    })
  }
  try {
    // Chargé dynamiquement : l'app fonctionne même si le module n'est pas installé.
    const moduleName = 'electron-updater'
    updater = require(moduleName).autoUpdater
  } catch {
    return set({
      state: 'unsupported',
      message: tr(
        'module electron-updater absent (npm install)',
        'electron-updater module missing (npm install)'
      )
    })
  }
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  updater.on('checking-for-update', () => set({ state: 'checking' }))
  updater.on('update-available', (info: any) => set({ state: 'available', version: info?.version }))
  updater.on('update-not-available', () => set({ state: 'none' }))
  updater.on('download-progress', (p: any) =>
    set({ state: 'downloading', percent: Math.round(p?.percent ?? 0), version: status.version })
  )
  updater.on('update-downloaded', (info: any) => set({ state: 'ready', version: info?.version }))
  updater.on('error', (e: any) => {
    debugLog('update', { error: String(e?.message ?? e) })
    set({ state: 'error', message: String(e?.message ?? e).slice(0, 200) })
  })
  checkForUpdates()
  setInterval(checkForUpdates, CHECK_EVERY)
}

export function checkForUpdates(): void {
  updater?.checkForUpdates().catch(() => undefined)
}

export function installUpdate(): void {
  if (status.state === 'ready') updater?.quitAndInstall(true, true)
}
