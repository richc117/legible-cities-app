// What the seven `*-real` unit suites share (spec 038, FR-002): which
// interpreter runs the real engine, a home seeded from the committed BART
// fixture, the engine started on a home, and the rule that where the
// determinism workflow opts in, a suite that would skip fails instead.
//
// The interpreter is found the way the app finds it in development:
// LEGIBLE_ENGINE_PYTHON first, then LEGIBLE_ENGINE_CHECKOUT's virtual
// environment, from the environment or .env.local. The determinism workflow
// has no checkout and names the runtime it vendored with the engine, so a
// suite that needs a feed, a stored layout or a page takes it from the
// fixture rather than from a checkout's `data` or `out`. Nothing here
// downloads a feed or runs LOOM.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { it } from 'vitest'
import { resolveConfig, type Config } from '../../src/main/config'
import { engineCommand, engineEnvironment, resolveInterpreter } from '../../src/main/interpreter'
import { Sidecar } from '../../src/main/sidecar'
import type { EnginePin } from '../../src/shared/engine'
import { OFFLINE, seedHome } from './determinism'

const repo = resolve(__dirname, '../..')

export const PINS = JSON.parse(readFileSync(join(repo, 'vendor/pins.json'), 'utf8')) as {
  engine: EnginePin & { schema_sha256: string }
  loom: { commit: string }
}

/**
 * The determinism workflow opts in with LEGIBLE_DETERMINISM_TEST=1, and there
 * a skip would read as proof: every suite runs there, on the fixture.
 */
export const REQUIRED = process.env.LEGIBLE_DETERMINISM_TEST === '1'

/** The development configuration: the environment, then .env.local. */
export function localConfig(loomPin = ''): Config {
  let fileText: string | undefined
  try {
    fileText = readFileSync(join(repo, '.env.local'), 'utf8')
  } catch {
    fileText = undefined
  }
  return resolveConfig({
    fileText,
    env: process.env,
    userData: tmpdir(),
    desktop: tmpdir(),
    loomPin,
    baseDir: repo,
  })
}

/** The interpreter that runs the real engine here, or null where none is named. */
export function realInterpreter(config: Config = localConfig()): string | null {
  return resolveInterpreter({
    config,
    packaged: false,
    resourcesPath: '',
    platform: process.platform,
    exists: existsSync,
  }).interpreter
}

/** Why a suite without an interpreter skips; a skipped block prints only its title. */
export const NO_ENGINE =
  ' (skipped: neither LEGIBLE_ENGINE_PYTHON nor LEGIBLE_ENGINE_CHECKOUT names an engine)'

/**
 * A test that fails where the determinism workflow opted in and `missing`
 * holds, so a suite that would skip there is a failure rather than a pass
 * with nothing in it. Otherwise nothing is registered, not even a skipped
 * test: the workflow's run of the seven must read "no skipped" when every
 * suite ran, and a skip anywhere in it is then a suite that did not.
 */
export function failIfRequired(suite: string, missing: boolean, why: string): void {
  if (!(REQUIRED && missing)) return
  it(`${suite} runs where LEGIBLE_DETERMINISM_TEST=1, so ${why} is a failure`, () => {
    throw new Error(`LEGIBLE_DETERMINISM_TEST=1, but ${why}`)
  })
}

/** The feed the fixture holds, and its one stored layout's feed folder. */
export const BART = 'bart'

/**
 * A temporary engine home holding the BART fixture's feed and stored layout
 * and nothing else; `seedHome` refuses one without the feed's zip. The
 * caller removes the folder it answers.
 */
export function bartHome(prefix: string): string {
  const home = mkdtempSync(join(tmpdir(), prefix))
  seedHome(home)
  return home
}

/**
 * A LOOM folder that does not exist: a layout the engine did not find in the
 * store then fails at once, instead of being made through Docker, which the
 * workflow does not have and a developer's run should not start.
 */
export const noLoom = (home: string): string => join(home, 'no-loom-here')

/**
 * How long an engine is given to come up. A cold start imports pandas, which
 * on a fresh Windows runner is slow, and the seven suites start theirs side
 * by side; the determinism fixture's own start allows the same.
 */
export const HANDSHAKE_MS = 120_000
export const READY_MS = 150_000
/** A test that starts an engine and asks it a few things. */
export const ENGINE_TEST_MS = 200_000

export interface StartOptions {
  /** The LOOM folder; a folder that does not exist (`noLoom`) unless one is named. */
  loomBin?: string | null
  loomCommit?: string | null
  /** Added to the engine's environment, after the app's own. */
  env?: Record<string, string>
  log?: string[]
}

/**
 * The real engine, started on a home and ready for requests. Stop it when
 * done. It cannot reach the network (`OFFLINE`), and unless the caller names
 * one its LOOM folder does not exist, so nothing it is asked can download a
 * feed or lay one out.
 */
export async function startRealEngine(
  interpreter: string,
  home: string,
  options: StartOptions = {},
): Promise<Sidecar> {
  const log = options.log ?? []
  const sidecar = new Sidecar({
    command: engineCommand(interpreter),
    env: {
      ...engineEnvironment({
        config: {
          home,
          loomBin: options.loomBin === undefined ? noLoom(home) : options.loomBin,
          loomCommit: options.loomCommit ?? null,
          ffmpeg: null,
        },
        base: process.env,
        development: true,
      }),
      ...OFFLINE,
      ...options.env,
    },
    pin: PINS.engine,
    log: (m) => log.push(m),
    bounds: { handshakeMs: HANDSHAKE_MS },
  })
  sidecar.start()
  await new Promise<void>((ready, reject) => {
    // An engine that did not come up is stopped before the failure is
    // reported, or the supervisor would go on restarting it in the background.
    const fail = (error: Error): void => {
      void sidecar.stop().finally(() => reject(error))
    }
    const timer = setTimeout(() => fail(new Error(log.join('\n'))), READY_MS)
    const check = (state: Sidecar['state']): void => {
      if (state.state === 'ready') {
        clearTimeout(timer)
        ready()
      } else if (state.state !== 'starting') {
        clearTimeout(timer)
        fail(new Error(`${state.state}: ${log.join('\n')}`))
      }
    }
    sidecar.onState(check)
    check(sidecar.state)
  })
  return sidecar
}

/** Where an engine's page template is, or why it was not found. */
export type TemplateLookup = { path: string; why: null } | { path: null; why: string }

/**
 * The page template of the engine an interpreter runs, which every page that
 * engine draws is made from: `schematic/page/page.html` inside the installed
 * package, found by asking the interpreter where the package is. That is the
 * checkout's own file under an editable install and the wheel's copy under
 * the runtime the determinism workflow vendors. When the interpreter cannot
 * say, the answer carries what it printed on stderr.
 */
export function installedPageTemplate(interpreter: string): TemplateLookup {
  const run = spawnSync(
    interpreter,
    [
      '-I',
      '-c',
      "import importlib.resources as r; print(r.files('schematic').joinpath('page', 'page.html'))",
    ],
    { encoding: 'utf8', timeout: 60_000, windowsHide: true },
  )
  if (run.status !== 0) {
    const said = `${run.error?.message ?? ''}\n${run.stderr ?? ''}`.trim()
    return {
      path: null,
      why: `${interpreter} could not say where the engine's page template is (${
        run.status === null ? `ended by ${run.signal ?? 'its timeout'}` : `exit ${run.status}`
      })${said === '' ? '' : `:\n${said}`}`,
    }
  }
  const path = run.stdout.trim()
  return path !== '' && existsSync(path)
    ? { path, why: null }
    : {
        path: null,
        why: `the engine names its page template as ${path || 'nothing'}, which is not there`,
      }
}

/**
 * The page template for a seam check: the installed engine's, which is the
 * engine that actually ran, wherever an interpreter is named - under an
 * editable install that is the checkout's own file anyway; else, with only a
 * checkout named, the checkout's.
 */
export function enginePageTemplate(
  checkout: string | null,
  interpreter: string | null,
): TemplateLookup {
  if (interpreter !== null) return installedPageTemplate(interpreter)
  if (checkout === null) return { path: null, why: 'no engine is named' }
  const path = join(checkout, 'src', 'schematic', 'page', 'page.html')
  return existsSync(path)
    ? { path, why: null }
    : { path: null, why: `the checkout has no page template at ${path}` }
}
