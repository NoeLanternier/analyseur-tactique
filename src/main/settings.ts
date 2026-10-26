import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { DEFAULT_SETTINGS, type Settings } from '../shared/types'

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf-8'))
    return sanitize(raw)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(next: Partial<Settings>): Settings {
  const merged = sanitize({ ...loadSettings(), ...next })
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
    fs.writeFileSync(settingsFile(), JSON.stringify(merged, null, 2))
  } catch {
    // On garde les réglages en mémoire si l'écriture échoue.
  }
  return merged
}

function sanitize(raw: Record<string, unknown>): Settings {
  const s = { ...DEFAULT_SETTINGS }
  if (typeof raw.autoRunes === 'boolean') s.autoRunes = raw.autoRunes
  if (typeof raw.replaceActivePageIfFull === 'boolean')
    s.replaceActivePageIfFull = raw.replaceActivePageIfFull
  if (typeof raw.autoItemSet === 'boolean') s.autoItemSet = raw.autoItemSet
  if (raw.runeSource === 'auto' || raw.runeSource === 'tactique' || raw.runeSource === 'riot')
    s.runeSource = raw.runeSource
  if (raw.side === 'left' || raw.side === 'right') s.side = raw.side
  if (typeof raw.metaUrl === 'string') s.metaUrl = raw.metaUrl.trim()
  if (typeof raw.debug === 'boolean') s.debug = raw.debug
  if (typeof raw.launchAtStartup === 'boolean') s.launchAtStartup = raw.launchAtStartup
  return s
}
