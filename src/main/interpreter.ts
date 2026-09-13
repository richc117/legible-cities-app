// Which program runs the engine, and with what environment. Pure: no
// Electron import, `exists` injected, so the order and the allowlist are
// unit-tested on every platform's path shape.
// Contract: specs/004-sidecar-supervisor/contracts/sidecar.md; the reasons
// in research.md sections 2 and 3.

import { join } from 'node:path'
import { isCommandName, type Config } from './config'

export type Origin = 'LEGIBLE_ENGINE_PYTHON' | 'engine checkout' | 'bundled runtime'

export type Resolution =
  | { interpreter: string; origin: Origin }
  | {
      interpreter: null
      /** For the person: names the key, never a path. */
      reason: string
      /** For the log: what was looked for and where. */
      detail: string
    }

export interface ResolveInput {
  config: Pick<Config, 'enginePython' | 'engineCheckout'>
  packaged: boolean
  resourcesPath: string
  platform: NodeJS.Platform
  exists: (path: string) => boolean
}

export function resolveInterpreter(input: ResolveInput): Resolution {
  const windows = input.platform === 'win32'
  const explicit = input.config.enginePython
  if (explicit !== null) {
    if (isCommandName(explicit) || input.exists(explicit)) {
      return { interpreter: explicit, origin: 'LEGIBLE_ENGINE_PYTHON' }
    }
    return {
      interpreter: null,
      reason:
        'LEGIBLE_ENGINE_PYTHON names an interpreter that does not exist; fix the key or unset it.',
      detail: `LEGIBLE_ENGINE_PYTHON=${explicit} does not exist`,
    }
  }
  if (!input.packaged) {
    const checkout = input.config.engineCheckout
    if (checkout === null) {
      return {
        interpreter: null,
        reason:
          'No engine to run: set LEGIBLE_ENGINE_CHECKOUT to the engine checkout (its .venv runs the engine), or LEGIBLE_ENGINE_PYTHON to an interpreter that has the engine installed.',
        detail: 'neither LEGIBLE_ENGINE_CHECKOUT nor LEGIBLE_ENGINE_PYTHON is set',
      }
    }
    const venv = join(
      checkout,
      '.venv',
      ...(windows ? ['Scripts', 'python.exe'] : ['bin', 'python']),
    )
    if (input.exists(venv)) return { interpreter: venv, origin: 'engine checkout' }
    return {
      interpreter: null,
      reason:
        'The engine checkout has no virtual environment; make one there (uv venv, then uv pip install -e ".[dev]"), or set LEGIBLE_ENGINE_PYTHON.',
      detail: `no interpreter at ${venv}`,
    }
  }
  const bundled = join(
    input.resourcesPath,
    'python',
    ...(windows ? ['python.exe'] : ['bin', 'python3']),
  )
  if (input.exists(bundled)) return { interpreter: bundled, origin: 'bundled runtime' }
  return {
    interpreter: null,
    reason:
      'The bundled Python runtime is missing; reinstall the app, or set LEGIBLE_ENGINE_PYTHON.',
    detail: `no bundled runtime at ${bundled}`,
  }
}

export function engineCommand(interpreter: string): string[] {
  return [interpreter, '-m', 'schematic.serve']
}

// What an interpreter needs to run, what a feed download needs to reach
// the network the way the person's shell does, and the development
// backend's Docker variables. Nothing else from the app's environment: a
// token or a password in it has no business in a child we did not write.
const PASS_THROUGH = new Set([
  'PATH',
  'HOME',
  'USERPROFILE',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SYSTEMROOT',
  'SystemRoot',
  'LANG',
  'LC_ALL',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'REQUESTS_CA_BUNDLE',
])

export interface EnvironmentInput {
  config: Pick<Config, 'home' | 'loomBin' | 'loomCommit' | 'ffmpeg'>
  base: Record<string, string | undefined>
  development: boolean
  logLevel?: string
  platform?: NodeJS.Platform
}

const PASS_THROUGH_UPPER = new Set([...PASS_THROUGH].map((name) => name.toUpperCase()))

export function engineEnvironment(input: EnvironmentInput): Record<string, string> {
  const env: Record<string, string> = {}
  // Windows environment names are case-insensitive and arrive as `Path`
  // and `SystemRoot`: match them as such, and keep the name as it came.
  const windows = (input.platform ?? process.platform) === 'win32'
  const passes = (key: string): boolean =>
    windows
      ? PASS_THROUGH_UPPER.has(key.toUpperCase()) || key.toUpperCase().startsWith('DOCKER_')
      : PASS_THROUGH.has(key) || key.startsWith('DOCKER_')
  for (const [key, value] of Object.entries(input.base)) {
    if (value === undefined) continue
    if (passes(key)) env[key] = value
    // The tests put the stand-in engine in front of the real one this way;
    // a packaged app runs the engine it ships and nothing else.
    if (key === 'PYTHONPATH' && input.development) env[key] = value
  }
  env.SCHEMATIC_HOME = input.config.home
  if (input.config.loomBin !== null) env.SCHEMATIC_LOOM_BIN = input.config.loomBin
  // The binaries cannot say which LOOM they are; the engine reports what it is told.
  if (input.config.loomCommit !== null) env.SCHEMATIC_LOOM_COMMIT = input.config.loomCommit
  if (input.config.ffmpeg !== null) env.SCHEMATIC_FFMPEG = input.config.ffmpeg
  env.SCHEMATIC_LOG = input.logLevel ?? 'info'
  // Lines arrive as they are written, and survive any locale.
  env.PYTHONUNBUFFERED = '1'
  env.PYTHONIOENCODING = 'utf-8'
  return env
}
