// The app's own settings and the view the screen reads. Pure: no Electron,
// no filesystem, no node:path, so the preload, the renderer and the main
// process share one definition and the unit tests run in Node.
// Contract: specs/019-settings/contracts/bridge.md.

export const SETTINGS_VERSION = 1

/** The interface's theme: the system's preference, or one of the engine's two by name. */
export type AppTheme = 'system' | 'warm-dark' | 'sepia'

export const APP_THEMES = ['system', 'warm-dark', 'sepia'] as const

export const DEFAULT_APP_THEME: AppTheme = 'system'

export interface AppSettings {
  version: number
  /** The engine's home as a person chose it; null to take the default under the user-data folder. */
  engineFolder: string | null
  /** Where exports go; null to take a `Legible Cities` folder on the desktop. */
  exportFolder: string | null
  theme: AppTheme
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: SETTINGS_VERSION,
  engineFolder: null,
  exportFolder: null,
  theme: DEFAULT_APP_THEME,
}

/** Where a folder in force came from. `.env.local` counts as the environment: it is one, in development. */
export type FolderSource = 'default' | 'settings' | 'environment'

export interface FolderView {
  /** The folder the running app is using. */
  path: string
  source: FolderSource
  /** A folder chosen but not yet in force, so the screen can say a restart applies it. */
  pending: string | null
  /** The environment names it, so the app does not change it here. */
  locked: boolean
}

export interface SettingsView {
  theme: AppTheme
  engine: FolderView
  export: FolderView
}

export interface FolderSize {
  bytes: number
  files: number
  /** The walk stopped at its cap, or could not read a folder: what is reported is a floor. */
  partial: boolean
  /** The folder is not there yet. Not an error: it is made when something writes. */
  missing: boolean
}

/**
 * What a reset did, by folder role. The home itself is never removed, so
 * this says which of the folders the app and the engine keep under it went
 * and which stayed, and why; never a path.
 */
export interface ResetOutcome {
  removed: string[]
  failed: { folder: string; reason: string }[]
}

/** What a finished reset says, for the screen. */
export function describeReset(outcome: ResetOutcome): string {
  const kept =
    outcome.failed.length === 0
      ? ''
      : ` The ${outcome.failed.map((f) => `${f.folder} folder is still there (${f.reason})`).join(', and the ')}.`
  if (outcome.removed.length === 0) {
    return `There was nothing to remove.${kept}`
  }
  return (
    `The engine's data is gone: ${outcome.removed.join(', ')}.` +
    `${kept} Start the app again so the engine reads its folder afresh.`
  )
}

export function isAppTheme(value: unknown): value is AppTheme {
  return typeof value === 'string' && (APP_THEMES as readonly string[]).includes(value)
}

/**
 * An absolute path on either platform: a POSIX path, a Windows path with a
 * drive letter, or a UNC path. Written here rather than taken from
 * `node:path` because the renderer imports this module and has no Node.
 */
const ABSOLUTE = /^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\/])/

/** No path the app stores is longer than this; a longer one is not a path a person chose. */
export const FOLDER_MAX = 4096

/**
 * A folder the app may store: absolute, of a sane length, and free of the
 * control characters and NUL that a filesystem call would carry into a
 * surprise. A relative path is refused outright, because what it would be
 * relative to changes between a development run and a packaged one.
 */
export function isStorableFolder(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.length > FOLDER_MAX) return false
  if (!ABSOLUTE.test(value)) return false
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 32 || code === 127) return false
  }
  return true
}

/**
 * Read settings from parsed JSON. Total: every field that is missing or
 * wrong takes its default, so a half-written or hand-edited file starts the
 * app rather than stopping it (FR-001), exactly as `parseRecord` does for a
 * project. The version is kept as read, so a file from a newer app is
 * recognisable; nothing here refuses one, because every field is optional.
 */
export function parseSettings(json: unknown): AppSettings {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { ...DEFAULT_SETTINGS }
  }
  const value = json as Record<string, unknown>
  const version =
    typeof value.version === 'number' && Number.isInteger(value.version) && value.version >= 1
      ? value.version
      : SETTINGS_VERSION
  return {
    version,
    engineFolder: isStorableFolder(value.engineFolder) ? value.engineFolder : null,
    exportFolder: isStorableFolder(value.exportFolder) ? value.exportFolder : null,
    theme: isAppTheme(value.theme) ? value.theme : DEFAULT_APP_THEME,
  }
}

/**
 * The `data-theme` attribute for a theme and the system's current
 * preference, or null for none: the warm-dark defaults live on bare
 * `:root`, so "no attribute" is the dark theme (docs/DESIGN.md section 3).
 */
export function themeAttribute(theme: AppTheme, prefersLight: boolean): 'sepia' | null {
  if (theme === 'sepia') return 'sepia'
  if (theme === 'warm-dark') return null
  return prefersLight ? 'sepia' : null
}

/** The theme's name for a person, in the design document's words. */
export const THEME_LABELS: Record<AppTheme, string> = {
  system: 'Follow the system',
  'warm-dark': 'Warm dark',
  sepia: 'Sepia',
}

const UNITS = ['bytes', 'kB', 'MB', 'GB', 'TB'] as const
const STEP = 1000

/**
 * A byte count for a person, in the units the platforms show (powers of a
 * thousand, as macOS and GNOME both do). One decimal above a kilobyte, so
 * a folder's size reads at a glance and does not jitter.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 bytes'
  let value = bytes
  let unit = 0
  while (value >= STEP && unit < UNITS.length - 1) {
    value /= STEP
    unit += 1
  }
  if (unit === 0) {
    const whole = Math.round(value)
    return whole === 1 ? '1 byte' : `${whole} ${UNITS[0]}`
  }
  return `${value.toFixed(1)} ${UNITS[unit]}`
}

/**
 * A folder's size and count in one sentence, for the screen. A walk that
 * was cut short is said before a count of nothing is: a folder the app
 * could not read reports zero files and would otherwise read as "empty",
 * which is a lie about a folder that may be full.
 */
export function describeSize(size: FolderSize): string {
  if (size.missing) return 'empty (the folder is not there yet)'
  if (size.partial && size.files === 0) return 'could not be measured'
  if (size.files === 0) return 'empty'
  const files = size.files === 1 ? '1 file' : `${size.files} files`
  const measured = `${formatBytes(size.bytes)} in ${files}`
  return size.partial ? `${measured} counted so far` : measured
}
