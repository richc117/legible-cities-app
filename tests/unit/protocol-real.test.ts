// The boundary against the engine that is actually installed, where a
// checkout exists; skipped, saying so, where it does not. Two halves:
//
// - **drift**: what the engine says about itself now, against the copy the
//   app was built from. This is the check that turns a renamed parameter in
//   Python into a failed build here.
// - **contract**: the four methods, called through the real sidecar.
//   `engine.info` and `engine.shutdown` run in full. `graph.build` and
//   `map.build` are proven at their refusals, which is what a machine
//   without Docker and a downloaded feed can reach, and what exercises the
//   parameter names and the error's shape. Their full runs belong to A3-01.
//   See specs/006-typed-engine-client/research.md, section 7.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../../src/main/config'
import { engineCommand, engineEnvironment, resolveInterpreter } from '../../src/main/interpreter'
import { Sidecar } from '../../src/main/sidecar'
import type { EngineError, EnginePin } from '../../src/shared/engine'
import type { EngineInfo, Ok } from '../../src/shared/protocol'

const repo = resolve(__dirname, '../..')
const pins = JSON.parse(readFileSync(join(repo, 'vendor/pins.json'), 'utf8')) as {
  engine: EnginePin & { schema_sha256: string }
  loom: { commit: string }
}
const committed = readFileSync(join(repo, 'vendor/protocol.schema.json'), 'utf8')

function localConfig() {
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
    loomPin: pins.loom.commit,
    baseDir: repo,
  })
}

// The local configuration decides the LOOM backend too: with
// SCHEMATIC_LOOM_BIN in .env.local the engine runs the app's binaries and
// must report the app's pin; without it, Docker and no commit.
const LOCAL = localConfig()
const CHECKOUT = LOCAL.engineCheckout
const INTERPRETER = (() => {
  const resolution = resolveInterpreter({
    config: { enginePython: null, engineCheckout: CHECKOUT },
    packaged: false,
    resourcesPath: '',
    platform: process.platform,
    exists: existsSync,
  })
  return resolution.interpreter
})()

const FIX = 'Run `npm run typegen` and commit what it writes.'

// A skipped block prints only its title, so the title carries the reason.
const WHY = INTERPRETER === null ? ' (skipped: LEGIBLE_ENGINE_CHECKOUT names no engine)' : ''

describe.skipIf(INTERPRETER === null)(`the committed protocol description${WHY}`, () => {
  it('is what the installed engine says about itself', () => {
    const run = spawnSync(INTERPRETER as string, ['-m', 'schematic.serve', '--schema'], {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    })
    expect(run.status, run.stderr).toBe(0)
    if (run.stdout !== committed) {
      const now = run.stdout.split('\n')
      const then = committed.split('\n')
      const at = now.findIndex((line, i) => line !== then[i])
      throw new Error(
        `The engine's description differs from vendor/protocol.schema.json at line ${at + 1}.\n` +
          `  engine:    ${now[at] ?? '(end of file)'}\n` +
          `  committed: ${then[at] ?? '(end of file)'}\n${FIX}`,
      )
    }
  })

  it('came from an engine of the pinned version', async () => {
    const info = await withEngine(async (sidecar) => {
      return (await sidecar.request('engine.info').result) as EngineInfo
    })
    expect(
      info.engine,
      `the checkout holds ${info.engine}, the pin says ${pins.engine.version}`,
    ).toBe(pins.engine.version)
    expect(info.protocol).toBe(pins.engine.protocol)
  })
})

/**
 * Start the real engine, run one thing against it, stop it and remove its
 * home. Every test here goes through this: readiness is bounded, the
 * sidecar is stopped whatever the body does, and a body that hangs cannot
 * leave a Python process behind.
 */
async function withEngine<T>(run: (sidecar: Sidecar) => Promise<T>): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), 'lc-protocol-'))
  const log: string[] = []
  const sidecar = new Sidecar({
    command: engineCommand(INTERPRETER as string),
    env: engineEnvironment({
      config: { home, loomBin: LOCAL.loomBin, loomCommit: LOCAL.loomCommit, ffmpeg: null },
      base: process.env,
      development: true,
    }),
    pin: pins.engine,
    log: (m) => log.push(m),
    bounds: { handshakeMs: 20_000 },
  })
  try {
    sidecar.start()
    await new Promise<void>((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error(log.join('\n'))), 25_000)
      sidecar.onState((state) => {
        if (state.state === 'ready') {
          clearTimeout(timer)
          resolveReady()
        } else if (state.state !== 'starting') {
          clearTimeout(timer)
          reject(new Error(`${state.state}: ${log.join('\n')}`))
        }
      })
    })
    return await run(sidecar)
  } finally {
    await sidecar.stop()
    rmSync(home, { recursive: true, force: true })
  }
}

const refusal = (promise: Promise<unknown>): Promise<EngineError> =>
  promise.then(
    () => {
      throw new Error('the engine accepted a request it should have refused')
    },
    (error: EngineError) => error,
  )

describe.skipIf(INTERPRETER === null)(`every method the description names${WHY}`, () => {
  it('answers engine.info with the shape the types claim', async () => {
    const info = await withEngine((s) => s.request('engine.info').result as Promise<EngineInfo>)
    expect(typeof info.engine).toBe('string')
    expect(info.protocol).toBe(1)
    expect(typeof info.python).toBe('string')
    // The engine reports the backend the configuration chose and the commit
    // it was told, which is the pin unless .env.local names another; the
    // default itself is proven in config.test.ts.
    expect(info.loom).toEqual({
      backend: LOCAL.loomBin === null ? 'docker' : 'native',
      commit: LOCAL.loomCommit,
    })
    expect(info).toHaveProperty('ffmpeg')
  })

  it('answers engine.shutdown and the process ends', async () => {
    // The pid is read before the request, because after it the child may
    // already have gone and `pid` would be undefined; `process.kill` would
    // then throw for the wrong reason.
    const pid = await withEngine(async (sidecar) => {
      const running = sidecar.pid as number
      expect(typeof running).toBe('number')
      const answer = (await sidecar.request('engine.shutdown').result) as Ok
      expect(answer.ok).toBe(true)
      return running
    })
    expect(() => process.kill(pid, 0)).toThrow()
  })

  // The two long methods are proven where a machine without the layout
  // tools can reach them: at their refusals. A refusal exercises the
  // parameter names the types claim, the schema's closed objects, the error
  // code and the {kind, detail, hint} shape.
  it('refuses graph.build for a feed it does not know, with a sentence', async () => {
    const error = await withEngine((s) =>
      refusal(s.request('graph.build', { key: 'not-a-feed' }).result),
    )
    expect(error.data?.kind).toBeDefined()
    expect(typeof error.data?.detail).toBe('string')
    expect(error.data?.hint.length).toBeGreaterThan(0)
    expect(error.data?.hint).toMatch(/[a-z]/)
  })

  it('refuses graph.build with a parameter the description does not define', async () => {
    const error = await withEngine((s) =>
      refusal(s.request('graph.build', { key: 'la-metro-rail', mode: 'rail' }).result),
    )
    expect(error.code).toBe(-32602)
    expect(error.data?.kind).toBe('params')
  })

  it('refuses map.build without the service day it requires', async () => {
    const error = await withEngine((s) =>
      refusal(s.request('map.build', { key: 'la-metro-rail' }).result),
    )
    expect(error.code).toBe(-32602)
    expect(error.data?.kind).toBe('params')
    expect(error.data?.hint).toMatch(/date/i)
  })

  it('refuses a method the engine does not have', async () => {
    const error = await withEngine((s) => refusal(s.request('engine.sing').result))
    expect(error.code).toBe(-32601)
  })
})
