// Configuration: four locations and one development pointer, from the
// process environment, then .env.local, then defaults. Pure: no Electron
// import, so the parsing and the log lines are unit-tested without a
// window. Contract: specs/001-electron-skeleton/contracts/config.md; the
// export folder, specs/010-export/contracts/bridge.md.

import { isAbsolute, join, resolve } from 'node:path'

export const KEYS = [
  'SCHEMATIC_HOME',
  'SCHEMATIC_LOOM_BIN',
  'SCHEMATIC_FFMPEG',
  'LEGIBLE_EXPORT_FOLDER',
  'LEGIBLE_ENGINE_CHECKOUT',
  'LEGIBLE_ENGINE_PYTHON',
] as const

/** The folder made on the desktop when no export folder is named. */
export const EXPORT_FOLDER_NAME = 'Legible Cities'

export type Key = (typeof KEYS)[number]
export type Source = 'default' | '.env.local' | 'environment'

export interface Config {
  home: string
  loomBin: string | null
  ffmpeg: string | null
  /** Where exports are written: the person's choice, or a folder on the desktop. */
  exportFolder: string
  engineCheckout: string | null
  /** An interpreter named explicitly: a path, or a bare command name left for PATH to resolve. */
  enginePython: string | null
  sources: Record<Key, Source>
  unknownKeys: string[]
  fileFound: boolean
}

export interface ConfigInput {
  /** The text of .env.local, or undefined when the file does not exist. */
  fileText?: string
  env: Record<string, string | undefined>
  /** Electron's userData directory; the engine home defaults beneath it. */
  userData: string
  /** Electron's desktop directory; the export folder defaults beneath it. */
  desktop: string
  /** Relative values in the file resolve against this directory. */
  baseDir: string
}

/** KEY=value per line; `#` starts a comment; matching quotes are stripped; no interpolation. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function pick(
  key: Key,
  env: ConfigInput['env'],
  file: Record<string, string>,
): { value: string | null; source: Source } {
  const fromEnv = env[key]
  if (fromEnv !== undefined && fromEnv !== '') return { value: fromEnv, source: 'environment' }
  const fromFile = file[key]
  if (fromFile !== undefined && fromFile !== '') return { value: fromFile, source: '.env.local' }
  return { value: null, source: 'default' }
}

export function isCommandName(value: string): boolean {
  return !value.includes('/') && !value.includes('\\')
}

export function resolveConfig(input: ConfigInput): Config {
  const file = input.fileText === undefined ? {} : parseEnvFile(input.fileText)
  const absolute = (value: string): string =>
    isAbsolute(value) ? value : resolve(input.baseDir, value)

  const home = pick('SCHEMATIC_HOME', input.env, file)
  const loomBin = pick('SCHEMATIC_LOOM_BIN', input.env, file)
  const ffmpeg = pick('SCHEMATIC_FFMPEG', input.env, file)
  const exportFolder = pick('LEGIBLE_EXPORT_FOLDER', input.env, file)
  const checkout = pick('LEGIBLE_ENGINE_CHECKOUT', input.env, file)
  const python = pick('LEGIBLE_ENGINE_PYTHON', input.env, file)

  return {
    home: home.value === null ? join(input.userData, 'engine') : absolute(home.value),
    loomBin: loomBin.value === null ? null : absolute(loomBin.value),
    ffmpeg: ffmpeg.value === null ? null : absolute(ffmpeg.value),
    exportFolder:
      exportFolder.value === null
        ? join(input.desktop, EXPORT_FOLDER_NAME)
        : absolute(exportFolder.value),
    engineCheckout: checkout.value === null ? null : absolute(checkout.value),
    // A bare name ("python3") is a command for the spawn to find on PATH,
    // because the person named it; anything with a separator is a path.
    enginePython:
      python.value === null
        ? null
        : isCommandName(python.value)
          ? python.value
          : absolute(python.value),
    sources: {
      SCHEMATIC_HOME: home.source,
      SCHEMATIC_LOOM_BIN: loomBin.source,
      SCHEMATIC_FFMPEG: ffmpeg.source,
      LEGIBLE_EXPORT_FOLDER: exportFolder.source,
      LEGIBLE_ENGINE_CHECKOUT: checkout.source,
      LEGIBLE_ENGINE_PYTHON: python.source,
    },
    unknownKeys: Object.keys(file).filter((k) => !(KEYS as readonly string[]).includes(k)),
    fileFound: input.fileText !== undefined,
  }
}

/** The startup log lines, without the `[config]` tag the logger adds. */
export function describeConfig(config: Config, options: { development: boolean }): string[] {
  const lines: string[] = []
  const where = options.development ? '.env.local' : 'the environment'
  const unset = (key: Key): string =>
    `${key} unset - nothing in this build needs it; set it in ${where}`

  lines.push(`SCHEMATIC_HOME=${config.home} (${config.sources.SCHEMATIC_HOME})`)
  lines.push(
    config.loomBin === null
      ? unset('SCHEMATIC_LOOM_BIN')
      : `SCHEMATIC_LOOM_BIN=${config.loomBin} (${config.sources.SCHEMATIC_LOOM_BIN})`,
  )
  lines.push(
    config.ffmpeg === null
      ? unset('SCHEMATIC_FFMPEG')
      : `SCHEMATIC_FFMPEG=${config.ffmpeg} (${config.sources.SCHEMATIC_FFMPEG})`,
  )
  lines.push(
    `LEGIBLE_EXPORT_FOLDER=${config.exportFolder} (${config.sources.LEGIBLE_EXPORT_FOLDER})`,
  )
  if (config.engineCheckout !== null) {
    lines.push(
      `LEGIBLE_ENGINE_CHECKOUT=${config.engineCheckout} (${config.sources.LEGIBLE_ENGINE_CHECKOUT})`,
    )
  }
  if (config.enginePython !== null) {
    lines.push(
      `LEGIBLE_ENGINE_PYTHON=${config.enginePython} (${config.sources.LEGIBLE_ENGINE_PYTHON})`,
    )
  }
  if (options.development && !config.fileFound) {
    lines.push('.env.local not found; using defaults')
  }
  for (const key of config.unknownKeys) {
    lines.push(`.env.local: unknown key ${key} ignored`)
  }
  return lines
}
