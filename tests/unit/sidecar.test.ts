// The supervisor against the stand-in engine, as a real child process:
// start, handshake, mismatch, pass-through, notifications, cancellation,
// the bounds, restart, backoff, shutdown. Needs a Python 3 on the PATH to
// run the stand-in; skips, saying so, without one.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { engineEnvironment } from '../../src/main/interpreter'
import { Sidecar, type Bounds } from '../../src/main/sidecar'
import {
  describeState,
  ERROR_CODES,
  type EngineError,
  type EnginePin,
  type EngineState,
} from '../../src/shared/engine'
import { FAKE_ENGINE, findPython } from '../support/python'

const PYTHON = findPython()
const PIN: EnginePin = {
  repo: 'https://github.com/x/y',
  tag: 'v0.2.0',
  version: '0.2.0',
  protocol: 1,
}

const FAST: Partial<Bounds> = {
  handshakeMs: 10_000,
  inactivityMs: 300,
  shutdownMs: 1_500,
  terminateMs: 1_500,
  restartDelaysMs: [20, 40, 80],
  stableMs: 100,
}

interface Harness {
  sidecar: Sidecar
  home: string
  states: EngineState[]
  log: string[]
  mismatches: unknown[]
  until: (predicate: (s: EngineState) => boolean, ms?: number) => Promise<EngineState>
  pid: () => number
  received: () => Record<string, unknown>[]
}

const running: Harness[] = []

function harness(control: Record<string, unknown> = {}, bounds: Partial<Bounds> = {}): Harness {
  const home = mkdtempSync(join(tmpdir(), 'lc-sidecar-'))
  writeFileSync(join(home, 'fake-engine.json'), JSON.stringify(control))
  const states: EngineState[] = []
  const log: string[] = []
  const mismatches: unknown[] = []
  const sidecar = new Sidecar({
    command: [PYTHON as string, '-m', 'schematic.serve'],
    env: engineEnvironment({
      config: { home, loomBin: null, ffmpeg: null },
      base: { ...process.env, PYTHONPATH: FAKE_ENGINE },
      development: true,
    }),
    pin: PIN,
    log: (m) => log.push(m),
    onMismatch: (expected, found) => mismatches.push({ expected, found }),
    bounds: { ...FAST, ...bounds },
  })
  sidecar.onState((s) => states.push(s))
  const h: Harness = {
    sidecar,
    home,
    states,
    log,
    mismatches,
    until: (predicate, ms = 10_000) =>
      new Promise((resolve, reject) => {
        if (predicate(sidecar.state)) {
          resolve(sidecar.state)
          return
        }
        const timer = setTimeout(() => {
          off()
          reject(
            new Error(
              `state never matched; last: ${describeState(sidecar.state)}\n${log.join('\n')}`,
            ),
          )
        }, ms)
        const off = sidecar.onState((s) => {
          if (predicate(s)) {
            clearTimeout(timer)
            off()
            resolve(s)
          }
        })
      }),
    pid: () => Number(readFileSync(join(home, 'fake-engine.pid'), 'utf8')),
    received: () =>
      existsSync(join(home, 'fake-engine.received'))
        ? readFileSync(join(home, 'fake-engine.received'), 'utf8')
            .trim()
            .split('\n')
            .map((l) => JSON.parse(l) as Record<string, unknown>)
        : [],
  }
  running.push(h)
  return h
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function eventually(predicate: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(25)
  }
}

afterEach(async () => {
  for (const h of running.splice(0)) {
    await h.sidecar.stop()
    rmSync(h.home, { recursive: true, force: true })
  }
})

const ready = (s: EngineState): boolean => s.state === 'ready'

// Four Python starts in one test take a couple of seconds on a loaded runner.
describe.skipIf(PYTHON === null)('Sidecar', { timeout: 20_000 }, () => {
  it('starts the engine, checks it, and is ready', async () => {
    const h = harness()
    h.sidecar.start()
    const state = await h.until(ready)
    expect(state).toEqual({ state: 'ready', version: '0.2.0', protocol: 1 })
    expect(h.states[0]).toEqual({ state: 'starting', attempt: 1 })
    expect(
      h.log.some((l) => l.startsWith('starting, attempt 1:') && l.includes('schematic.serve')),
    ).toBe(true)
    expect(
      h.log.some((l) => l.includes('ready: engine 0.2.0, protocol 1 (expected 0.2.0, 1); home')),
    ).toBe(true)
    expect(h.log.some((l) => l.startsWith('stderr: fake engine 0.2.0'))).toBe(true)
    expect(alive(h.pid())).toBe(true)
  })

  it('refuses a wrong version or protocol: the dialog once, the process gone, no restart', async () => {
    for (const control of [{ version: '0.1.0' }, { protocol: 2 }]) {
      const h = harness(control)
      h.sidecar.start()
      const state = await h.until((s) => s.state === 'mismatched')
      expect(state).toEqual({
        state: 'mismatched',
        expected: PIN,
        found: { version: control.version ?? '0.2.0', protocol: control.protocol ?? 1 },
      })
      expect(h.mismatches).toEqual([
        { expected: PIN, found: state.state === 'mismatched' ? state.found : null },
      ])
      await eventually(() => !alive(h.pid()), 5_000, 'the mismatched engine to end')
      expect(h.states.filter((s) => s.state === 'restarting')).toEqual([])
      const error = await h.sidecar.request('engine.info').result.catch((e: EngineError) => e)
      expect((error as EngineError).code).toBe(ERROR_CODES.notReady)
      expect((error as EngineError).message).toContain('found 0.')
    }
  })

  it('gives up after three restarts when the engine exits at once, with the reason', async () => {
    const h = harness({ exit: 'at-once' })
    h.sidecar.start()
    const state = await h.until((s) => s.state === 'stopped')
    expect(
      h.states.map((s) =>
        s.state === 'starting' || s.state === 'restarting' ? `${s.state} ${s.attempt}` : s.state,
      ),
    ).toEqual([
      'starting 1',
      'restarting 2',
      'starting 2',
      'restarting 3',
      'starting 3',
      'restarting 4',
      'starting 4',
      'stopped',
    ])
    if (state.state === 'stopped') {
      expect(state.reason).toContain('exited with code 3')
      expect(state.reason).toContain('exiting at once as told')
      expect(state.reason).toContain('4 times in a row')
    }
    const error = (await h.sidecar
      .request('engine.info')
      .result.catch((e: EngineError) => e)) as EngineError
    expect(error.code).toBe(ERROR_CODES.notReady)
    expect(error.data?.hint).toContain('Engine stopped')
  })

  it('treats a silent handshake as a failure to start', async () => {
    const h = harness({ mute: true }, { handshakeMs: 200 })
    h.sidecar.start()
    const state = await h.until((s) => s.state === 'restarting')
    if (state.state === 'restarting') expect(state.reason).toContain('handshake')
  })

  it('treats a stray line on stdout as a failure', async () => {
    const h = harness({ garbage: true })
    h.sidecar.start()
    const state = await h.until((s) => s.state === 'restarting')
    if (state.state === 'restarting') expect(state.reason).toContain('not a message')
  })

  it('is unavailable with the reason when there is no interpreter, or it cannot be started', async () => {
    const none = new Sidecar({
      command: null,
      unavailableReason: 'No engine to run: set LEGIBLE_ENGINE_CHECKOUT.',
      env: {},
      pin: PIN,
      log: () => {},
    })
    none.start()
    expect(none.state).toEqual({
      state: 'unavailable',
      reason: 'No engine to run: set LEGIBLE_ENGINE_CHECKOUT.',
    })
    await expect(none.request('engine.info').result).rejects.toMatchObject({
      code: ERROR_CODES.notReady,
    })

    const states: EngineState[] = []
    const missing = new Sidecar({
      command: ['no-such-interpreter-xyz', '-m', 'schematic.serve'],
      env: { PATH: process.env.PATH ?? '' },
      pin: PIN,
      log: () => {},
      bounds: FAST,
    })
    missing.onState((s) => states.push(s))
    missing.start()
    await new Promise<void>((resolve) => {
      if (missing.state.state === 'unavailable') resolve()
      missing.onState((s) => s.state === 'unavailable' && resolve())
    })
    expect(states.filter((s) => s.state === 'restarting')).toEqual([])
    if (missing.state.state === 'unavailable')
      expect(missing.state.reason).toContain('could not be started')
    await missing.stop()
  })

  it('refuses a request before ready, and forwards one after', async () => {
    const h = harness()
    const early = h.sidecar.request('engine.info')
    expect(early.id).toBe(0)
    await expect(early.result).rejects.toMatchObject({
      code: ERROR_CODES.notReady,
      message: 'Starting the engine.',
    })
    h.sidecar.start()
    await h.until(ready)
    const info = (await h.sidecar.request('engine.info').result) as Record<string, unknown>
    expect(info).toMatchObject({ engine: '0.2.0', protocol: 1, home: h.home })
    expect(h.received().map((m) => m.method)).toEqual(['engine.info', 'engine.info'])
  })

  it('hands on progress and log notifications with the request id, in order, then the result', async () => {
    const h = harness()
    h.sidecar.start()
    await h.until(ready)
    const seen: { method: string; params: unknown }[] = []
    h.sidecar.onNotification((n) => seen.push(n))
    const { id, result } = h.sidecar.request('graph.build', { key: 'la-metro-rail' })
    const value = (await result) as { stages: Record<string, unknown> }
    expect(Object.keys(value.stages)).toEqual(['gtfs2graph', 'topo', 'loom', 'octi'])
    const progress = seen
      .filter((n) => n.method === 'job/progress')
      .map((n) => n.params as Record<string, unknown>)
    expect(progress.map((p) => p.stage)).toEqual(['gtfs2graph', 'topo', 'loom', 'octi'])
    expect(progress.every((p) => p.id === id)).toBe(true)
    expect(seen.filter((n) => n.method === 'job/log')).toHaveLength(4)
  })

  it('cancels a request and ends it with the engine cancelled error', async () => {
    const h = harness({ progress_delay_ms: 100 })
    h.sidecar.start()
    await h.until(ready)
    const { id, result } = h.sidecar.request('graph.build', { key: 'x' })
    h.sidecar.cancel(id)
    await expect(result).rejects.toMatchObject({ code: ERROR_CODES.cancelled })
    expect(h.received().some((m) => m.method === '$/cancelRequest')).toBe(true)
  })

  it("passes the engine's error through with code, message and data", async () => {
    const h = harness()
    h.sidecar.start()
    await h.until(ready)
    const error = (await h.sidecar
      .request('map.build', { key: 'x' })
      .result.catch((e: EngineError) => e)) as EngineError
    expect(error.code).toBe(-32602)
    expect(error.message.startsWith('date is required')).toBe(true)
    expect(error.data).toEqual({ kind: 'params', detail: error.message, hint: error.message })
    expect(h.sidecar.state.state).toBe('ready')
  })

  it('cancels a request that makes no progress within the bound and says so', async () => {
    const h = harness({ silent: true })
    h.sidecar.start()
    await h.until(ready)
    const { id, result } = h.sidecar.request('graph.build', { key: 'x' })
    const error = (await result.catch((e: EngineError) => e)) as EngineError
    expect(error.code).toBe(ERROR_CODES.inactive)
    expect(error.data?.hint).toContain('No progress for 300 ms')
    await sleep(100)
    const cancel = h.received().find((m) => m.method === '$/cancelRequest')
    expect(cancel).toBeDefined()
    expect((cancel?.params as { id: number }).id).toBe(id)
    expect(h.sidecar.state.state).toBe('ready')
  })

  it('restarts after an exit nobody asked for, rejecting what was in flight', async () => {
    const h = harness({ silent: true }, { inactivityMs: 5_000 })
    h.sidecar.start()
    await h.until(ready)
    const first = h.pid()
    const inFlight = h.sidecar.request('graph.build', { key: 'x' }).result
    process.kill(first, 'SIGKILL')
    await expect(inFlight).rejects.toMatchObject({ code: ERROR_CODES.engineExited })
    const restarting = await h.until((s) => s.state === 'restarting')
    if (restarting.state === 'restarting') {
      expect(restarting.attempt).toBe(2)
      expect(restarting.reason).toMatch(/ended by signal SIGKILL|exited with code/)
    }
    await h.until((s) => s.state === 'starting' && s.attempt === 2)
    await h.until(ready)
    expect(h.pid()).not.toBe(first)
    expect(alive(h.pid())).toBe(true)
  })

  it('forgets earlier failures once the engine has been stable', async () => {
    const h = harness({}, { stableMs: 50 })
    h.sidecar.start()
    await h.until(ready)
    process.kill(h.pid(), 'SIGKILL')
    await h.until((s) => s.state === 'restarting' && s.attempt === 2)
    await h.until(ready)
    await sleep(120) // past stableMs
    process.kill(h.pid(), 'SIGKILL')
    const again = await h.until((s) => s.state === 'restarting')
    if (again.state === 'restarting') expect(again.attempt).toBe(2)
    await h.until(ready)
  })

  it('gives up when the engine keeps dying after the handshake', async () => {
    const h = harness({ exit: 'after-handshake' }, { stableMs: 60_000 })
    h.sidecar.start()
    const state = await h.until((s) => s.state === 'stopped')
    expect(
      h.states
        .filter((s) => s.state === 'restarting')
        .map((s) => (s.state === 'restarting' ? s.attempt : 0)),
    ).toEqual([2, 3, 4])
    if (state.state === 'stopped') expect(state.reason).toContain('exited with code 3')
  })

  it('stops: the engine ends on request, the pid is dead, a second stop is immediate', async () => {
    const h = harness()
    h.sidecar.start()
    await h.until(ready)
    const pid = h.pid()
    const inFlight = h.sidecar.request('graph.build', { key: 'x' }).result
    const rejected = expect(inFlight).rejects.toMatchObject({ code: ERROR_CODES.engineExited })
    const started = Date.now()
    await h.sidecar.stop()
    await rejected
    expect(Date.now() - started).toBeLessThan(1_500)
    expect(alive(pid)).toBe(false)
    expect(h.sidecar.state).toEqual({ state: 'stopped', reason: 'The app is quitting.' })
    expect(h.log.some((l) => l.startsWith('ended on request'))).toBe(true)
    const again = Date.now()
    await h.sidecar.stop()
    expect(Date.now() - again).toBeLessThan(50)
    expect(h.received().map((m) => m.method)).toContain('engine.shutdown')
  })

  it('stops an engine that ignores the shutdown request by ending it', async () => {
    const h = harness({ ignore_shutdown: true }, { shutdownMs: 300, terminateMs: 1_000 })
    h.sidecar.start()
    await h.until(ready)
    const pid = h.pid()
    await h.sidecar.stop()
    expect(alive(pid)).toBe(false)
    expect(h.log.some((l) => l.includes('terminating'))).toBe(true)
    expect(h.log.some((l) => l.startsWith('ended on terminate'))).toBe(true)
  })

  it('ends what the engine started: a child of the engine dies with it', async () => {
    const h = harness(
      { spawn_child: true, ignore_shutdown: true },
      { shutdownMs: 300, terminateMs: 2_000 },
    )
    h.sidecar.start()
    await h.until(ready)
    await eventually(
      () => existsSync(join(h.home, 'fake-engine.child.pid')),
      5_000,
      'the child pid',
    )
    const child = Number(readFileSync(join(h.home, 'fake-engine.child.pid'), 'utf8'))
    expect(alive(child)).toBe(true)
    await h.sidecar.stop()
    expect(alive(h.pid())).toBe(false)
    await eventually(() => !alive(child), 3_000, "the engine's child to end")
  })

  it.skipIf(process.platform === 'win32')('kills an engine that ignores terminate', async () => {
    const h = harness(
      { ignore_shutdown: true, ignore_sigterm: true },
      { shutdownMs: 200, terminateMs: 300 },
    )
    h.sidecar.start()
    await h.until(ready)
    const pid = h.pid()
    await h.sidecar.stop()
    expect(alive(pid)).toBe(false)
    expect(h.log.some((l) => l.includes('killing'))).toBe(true)
  })

  it('stops during a failure without letting the restart through', async () => {
    // A stray line makes the supervisor end a live child; a stop() that
    // arrives during that must wait for it and leave the state stopped.
    const h = harness({ garbage: true }, { restartDelaysMs: [300, 300, 300] })
    h.sidecar.start()
    await h.until((s) => s.state === 'restarting')
    await h.sidecar.stop()
    await sleep(500)
    expect(h.states.filter((s) => s.state === 'starting')).toHaveLength(1)
    expect(h.sidecar.state.state).toBe('stopped')
  })

  it('refuses a request with the failure, not with ready, while the child is being ended', async () => {
    const h = harness({ garbage: true }, { restartDelaysMs: [5_000, 5_000, 5_000] })
    h.sidecar.start()
    await h.until((s) => s.state === 'restarting')
    const error = (await h.sidecar
      .request('engine.info')
      .result.catch((e: EngineError) => e)) as EngineError
    expect(error.code).toBe(ERROR_CODES.notReady)
    expect(error.message).toContain('restarting')
  })

  it('does not restart while stopping', async () => {
    const h = harness({ exit: 'after-handshake' }, { restartDelaysMs: [500, 500, 500] })
    h.sidecar.start()
    await h.until((s) => s.state === 'restarting')
    await h.sidecar.stop()
    await sleep(700)
    expect(h.states.filter((s) => s.state === 'starting')).toHaveLength(1)
    expect(h.sidecar.state.state).toBe('stopped')
  })
})

describe('describeState', () => {
  it('has one sentence per state', () => {
    expect(describeState({ state: 'starting', attempt: 1 })).toBe('Starting the engine.')
    expect(describeState({ state: 'ready', version: '0.2.0', protocol: 1 })).toBe(
      'Engine ready (0.2.0).',
    )
    expect(describeState({ state: 'unavailable', reason: 'x.' })).toBe('Engine unavailable: x.')
    expect(
      describeState({
        state: 'mismatched',
        expected: PIN,
        found: { version: '0.1.0', protocol: 1 },
      }),
    ).toContain('needs engine 0.2.0')
  })
})
