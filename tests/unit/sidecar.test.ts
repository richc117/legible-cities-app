// The supervisor against the stand-in engine, as a real child process:
// start, handshake, mismatch, pass-through, notifications, cancellation,
// the bounds, restart, backoff, shutdown. Needs a Python 3 on the PATH to
// run the stand-in; skips, saying so, without one.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { engineEnvironment } from '../../src/main/interpreter'
import {
  engineWorkRefusal,
  HANDSHAKE_FAILED_REASON,
  handshakeTimedOutReason,
  PROTOCOL_ERROR_REASON,
  Sidecar,
  WROTE_IN_THE_LOG,
  type Bounds,
} from '../../src/main/sidecar'
import {
  describeState,
  ERROR_CODES,
  RETRY_REFUSALS,
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
  const sidecar = new Sidecar({
    command: [PYTHON as string, '-m', 'schematic.serve'],
    env: engineEnvironment({
      config: { home, loomBin: null, loomCommit: null, ffmpeg: null },
      base: { ...process.env, PYTHONPATH: FAKE_ENGINE },
      development: true,
    }),
    pin: PIN,
    log: (m) => log.push(m),
    bounds: { ...FAST, ...bounds },
  })
  sidecar.onState((s) => states.push(s))
  const h: Harness = {
    sidecar,
    home,
    states,
    log,
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

/** A feed a person added, in the stand-in's registry, so a removal of it succeeds. */
function userFeed(home: string, key: string): void {
  mkdirSync(join(home, 'data', 'feeds'), { recursive: true })
  writeFileSync(
    join(home, 'data', 'feeds', 'user-feeds.json'),
    JSON.stringify([{ key, name: key, source: 'user' }]),
  )
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

  // Issue 529: a slow first start is a number in the log, not a guess. The
  // stand-in waits 400 ms before it answers, so the number has a floor to be
  // held to; a line that always said 0, or the limit, would not clear it.
  it('logs how long the handshake took, from the spawn to the answer', async () => {
    const h = harness({ handshake_delay_ms: 400 })
    h.sidecar.start()
    await h.until(ready)
    const lines = h.log.filter((l) => l.startsWith('handshake:'))
    expect(lines, h.log.join('\n')).toHaveLength(1)
    const match = /^handshake: answered in (\d+) ms \(limit 10000 ms\)$/.exec(lines[0])
    expect(match, lines[0]).not.toBeNull()
    const took = Number(match?.[1])
    expect(took).toBeGreaterThanOrEqual(400)
    expect(took).toBeLessThan(9_000)
    // Before the engine is called ready, so a log read top to bottom has the cost first.
    const at = (prefix: string): number => h.log.findIndex((l) => l.startsWith(prefix))
    expect(at('handshake:')).toBeLessThan(at('ready:'))
  })

  // Issue 529: and when it does not come, how long the app waited.
  it('logs how long it waited when the handshake timed out', async () => {
    const h = harness({ mute: true }, { handshakeMs: 300 })
    h.sidecar.start()
    await h.until((s) => s.state === 'restarting')
    const lines = h.log.filter((l) => l.startsWith('handshake:'))
    expect(lines.length, h.log.join('\n')).toBeGreaterThanOrEqual(1)
    const match = /^handshake: no answer after (\d+) ms \(limit 300 ms\)$/.exec(lines[0])
    expect(match, lines[0]).not.toBeNull()
    const waited = Number(match?.[1])
    // A timer may fire a millisecond early against a different clock; never by much.
    expect(waited).toBeGreaterThanOrEqual(295)
    expect(waited).toBeLessThan(5_000)
    expect(lines.some((l) => l.includes('answered in'))).toBe(false)
  })

  // Issue 494: the version the store stamps on a map as the engine that drew
  // it. A draw's completion reaches the store after its build was answered,
  // and the engine may have gone between the two, so it outlives the process.
  it('says which version passed the handshake, and keeps it once that engine has gone', async () => {
    const h = harness()
    expect(h.sidecar.readyVersion, 'before any engine has answered').toBeNull()
    h.sidecar.start()
    await h.until(ready)
    expect(h.sidecar.readyVersion).toBe('0.2.0')
    await h.sidecar.stop()
    expect(h.sidecar.state.state).toBe('stopped')
    expect(h.sidecar.readyVersion, 'after the engine it names has stopped').toBe('0.2.0')
  })

  it('names no version an engine answered but the handshake refused', async () => {
    // Mutation: the version kept before the identity is checked - a
    // mismatched engine, which drew nothing, would be named.
    const h = harness({ version: '0.1.0' })
    h.sidecar.start()
    await h.until((s) => s.state === 'mismatched')
    expect(h.sidecar.readyVersion).toBeNull()
  })

  it('refuses a wrong version or protocol: the state says both, the process gone, no restart', async () => {
    for (const control of [{ version: '0.1.0' }, { protocol: 2 }]) {
      const h = harness(control)
      h.sidecar.start()
      const state = await h.until((s) => s.state === 'mismatched')
      expect(state).toEqual({
        state: 'mismatched',
        expected: PIN,
        found: { version: control.version ?? '0.2.0', protocol: control.protocol ?? 1 },
      })
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
      expect(state.reason).toContain('The engine failed 4 times in a row.')
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
    if (state.state !== 'restarting') throw new Error('expected restarting')
    // The app's own limit, as the app wrote it: nothing the engine said, and
    // not the sentence for an engine that answered with an error.
    expect(state.reason).toBe(handshakeTimedOutReason(200))
    expect(state.reason).toContain('within 0.2 seconds')
    expect(state.reason).not.toBe(HANDSHAKE_FAILED_REASON)
  })

  it('says how long the handshake was given, never 0 seconds, and a second as one', () => {
    expect(handshakeTimedOutReason(10_000)).toContain('within 10 seconds.')
    expect(handshakeTimedOutReason(1_000)).toContain('within 1 second.')
    expect(handshakeTimedOutReason(300)).toContain('within 0.3 seconds.')
    expect(handshakeTimedOutReason(10)).toContain('within 0.1 seconds.')
  })

  it('treats a stray line on stdout as a failure', async () => {
    const h = harness({ garbage: true })
    h.sidecar.start()
    const state = await h.until((s) => s.state === 'restarting')
    if (state.state === 'restarting') expect(state.reason).toContain('not a message')
  })

  // Issue 207: the state goes to the page as it is, so a web address in a
  // reason must not reach it whole. The reason that can still quote the
  // engine is the exit's, which tails its stderr and drops any line holding a
  // path separator; an address percent-encoded has no slash, so it passes that
  // filter and `setState`'s `redactUrls` is what keeps its key off the screen.
  it('redacts a web address the stderr tail quotes, in the state the page reads', async () => {
    const h = harness({
      exit: 'at-once',
      stderr_line: 'fetch failed https%3A%2F%2Ffeeds.example.org%2Fg.zip%3Fapi_key%3Dplanted207',
    })
    h.sidecar.start()
    const state = await h.until((s) => s.state === 'restarting')
    if (state.state !== 'restarting') throw new Error('expected restarting')
    expect(state.reason).toContain('fetch failed')
    expect(state.reason).not.toContain('planted207')
    expect(JSON.stringify(h.sidecar.state)).not.toContain('planted207')
    expect(describeState(state)).not.toContain('planted207')
  })

  // Issue 580: a reason is drawn on screen, and a screenshot sent with a bug
  // report would carry a path the engine printed (a library's warning begins
  // with the file it came from). The snippet stays in the log, the one place a
  // path may be; the reason says what happened and where, and quotes nothing.
  // The Windows case has no drive letter on purpose: a line with a colon
  // reads as a frame header, and `C:\\...` would fail as a missing
  // Content-Length, not as a line that is not a frame.
  it.each([
    ['a POSIX path', '/opt/engine/lib/site-packages/warn_planted580'],
    ['a Windows path', String.raw`Engine\lib\site-packages\warn_planted580`],
  ])(
    'shows no path in the reason for a stray line that is %s, and keeps it in the log',
    async (_name, stray) => {
      const h = harness({ garbage: stray })
      h.sidecar.start()
      const state = await h.until((s) => s.state === 'restarting')
      if (state.state !== 'restarting') throw new Error('expected restarting')
      expect(state.reason).toContain('not a message')
      expect(state.reason).not.toMatch(/[\\/]/)
      expect(state.reason).not.toContain('planted580')
      expect(describeState(state)).not.toContain('planted580')
      expect(h.log.some((l) => l.startsWith('protocol error:') && l.includes(stray))).toBe(true)
    },
  )

  // Issue 580, the handshake: an engine that fails on a file answers
  // engine.info with an error whose message holds the path. It goes to the log
  // and the reason says what happened.
  it('shows no path in the reason for a refused handshake, and keeps the message in the log', async () => {
    const message = 'cannot read /opt/engine/data/planted580/registry.json'
    const h = harness({ info_refuses: message })
    h.sidecar.start()
    const state = await h.until((s) => s.state === 'restarting')
    if (state.state !== 'restarting') throw new Error('expected restarting')
    expect(state.reason).toContain('handshake')
    expect(state.reason).not.toMatch(/[\\/]/)
    expect(state.reason).not.toContain('planted580')
    expect(describeState(state)).not.toContain('planted580')
    expect(h.log.some((l) => l.includes(message))).toBe(true)
  })

  it('names the same file, the same way, in every reason that sends the person to the log', () => {
    for (const sentence of [PROTOCOL_ERROR_REASON, HANDSHAKE_FAILED_REASON, WROTE_IN_THE_LOG]) {
      expect(sentence).toContain('engine.log in the logs folder')
      expect(sentence).not.toMatch(/[\\/]/)
    }
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
      retryable: false,
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
    // An interpreter that is not the installer's - a checkout's, or one a
    // person named - is not mended by a reinstall, so it is told what to check.
    if (missing.state.state === 'unavailable') {
      expect(missing.state.reason).toContain('LEGIBLE_ENGINE_PYTHON')
      expect(missing.state.reason).not.toContain('Reinstall')
    }
    await missing.stop()
  })

  it('gives the installer’s own interpreter a reason with no environment variable in it (issue 547)', async () => {
    const log: string[] = []
    const missing = new Sidecar({
      command: ['no-such-interpreter-xyz', '-m', 'schematic.serve'],
      env: { PATH: process.env.PATH ?? '' },
      pin: PIN,
      log: (m) => log.push(m),
      bounds: FAST,
      bundledInterpreter: true,
    })
    missing.start()
    await new Promise<void>((resolve) => {
      if (missing.state.state === 'unavailable') resolve()
      missing.onState((s) => s.state === 'unavailable' && resolve())
    })
    if (missing.state.state !== 'unavailable') throw new Error('expected unavailable')
    expect(missing.state.reason).not.toMatch(/LEGIBLE_/)
    expect(missing.state.reason).not.toContain('checkout')
    // The next step first.
    expect(missing.state.reason.startsWith('Reinstall the app')).toBe(true)
    expect(missing.state.reason).not.toContain(':')
    // What the system said is kept for the log, not the screen.
    expect(log.join('\n')).toContain('the interpreter could not be started: ENOENT')
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

  // Issue 587: a listener is the app's own code, and what it throws is the
  // app's error. It used to escape into the frame reader, which called it a
  // protocol error: the engine was restarted, the request in flight ended, and
  // the reason said the engine had written something that is not a message.
  // The thrown message carries a key in an address, which the line must not.
  it("logs a listener's exception as the app's own error, and the engine keeps running (issue 587)", async () => {
    const h = harness()
    h.sidecar.start()
    await h.until(ready)
    h.sidecar.onNotification(() => {
      throw new TypeError('listener broke on https://feeds.example.org/g.zip?api_key=planted587')
    })
    const seen: string[] = []
    h.sidecar.onNotification((n) => seen.push(n.method))
    const { result } = h.sidecar.request('graph.build', { key: 'la-metro-rail' })
    const value = (await result) as { stages: Record<string, unknown> }
    expect(Object.keys(value.stages)).toEqual(['gtfs2graph', 'topo', 'loom', 'octi'])
    expect(h.sidecar.state).toEqual({ state: 'ready', version: '0.2.0', protocol: 1 })
    expect(h.states.map((s) => s.state)).toEqual(['starting', 'ready'])
    expect(h.states.some((s) => 'reason' in s && s.reason.includes('not a message'))).toBe(false)
    expect(h.log.some((l) => l.startsWith('protocol error'))).toBe(false)
    // Every listener after the one that threw still had every notification.
    expect(seen.filter((m) => m === 'job/progress')).toHaveLength(4)
    const lines = h.log.filter((l) => l.startsWith('error in the app: a notification listener'))
    expect(lines).toHaveLength(seen.length)
    expect(lines[0]).toMatch(
      /^error in the app: a notification listener threw on job\/\w+: TypeError: listener broke on https:\/\/feeds\.example\.org\/g\.zip\?api_key=/,
    )
    expect(lines[0]).toContain('the engine keeps running')
    expect(h.log.join('\n')).not.toContain('planted587')
  })

  it('cancels a request and ends it with the engine cancelled error', async () => {
    const h = harness({ progress_delay_ms: 100 })
    h.sidecar.start()
    await h.until(ready)
    const { id, result } = h.sidecar.request('graph.build', { key: 'la-metro-rail' })
    h.sidecar.cancel(id)
    await expect(result).rejects.toMatchObject({ code: ERROR_CODES.cancelled })
    expect(h.received().some((m) => m.method === '$/cancelRequest')).toBe(true)
  })

  it("passes the engine's error through with code, message and data", async () => {
    const h = harness()
    h.sidecar.start()
    await h.until(ready)
    const error = (await h.sidecar
      .request('map.build', { key: 'x', layout: '0'.repeat(64) })
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
    const { id, result } = h.sidecar.request('graph.build', { key: 'la-metro-rail' })
    const error = (await result.catch((e: EngineError) => e)) as EngineError
    expect(error.code).toBe(ERROR_CODES.inactive)
    expect(error.data?.hint).toContain('No progress for 300 ms')
    // The rejection is ours and the cancel is the engine's: the request is
    // failed here the moment the bound passes, and `$/cancelRequest` is
    // written, read by the process and appended to its file after that,
    // unordered against this line. A fixed wait is a race whatever its size
    // (issue 147), so this polls to a deadline instead.
    const sent = (): Record<string, unknown> | undefined =>
      h.received().find((m) => m.method === '$/cancelRequest')
    await expect.poll(() => sent() !== undefined, { timeout: 10_000 }).toBe(true)
    const cancel = sent()
    expect((cancel?.params as { id: number }).id).toBe(id)
    expect(h.sidecar.state.state).toBe('ready')
  })

  // A request's own deadline (issue 107), on feeds.remove. The app sends no
  // request with one since issue 351, but the supervisor keeps the option.
  // With remove_delay_ms the stand-in answers on a thread after the delay
  // and never stops for a cancel; with remove_blocks_ms it runs the removal
  // as a job that does. The inactivity bound is set well beyond each
  // deadline so only the deadline can be what ends a request here.
  const LONG_INACTIVITY: Partial<Bounds> = { inactivityMs: 10_000 }
  const cancelsFor = (h: Harness, id: number): number =>
    h
      .received()
      .filter((m) => m.method === '$/cancelRequest' && (m.params as { id: number }).id === id)
      .length

  it('answers a request within its deadline, and leaves no deadline armed', async () => {
    const h = harness({ remove_delay_ms: 100 }, LONG_INACTIVITY)
    userFeed(h.home, 'mine')
    h.sidecar.start()
    await h.until(ready)
    const { result } = h.sidecar.request('feeds.remove', { key: 'mine' }, { deadlineMs: 5_000 })
    expect(h.sidecar.deadlinesArmed).toBe(1)
    await expect(result).resolves.toEqual({ ok: true })
    expect(h.sidecar.deadlinesArmed).toBe(0)
    expect(h.sidecar.inFlight).toBe(0)
    expect(h.received().some((m) => m.method === '$/cancelRequest')).toBe(false)
  })

  it('ends a request past its deadline: cancelled once, the inactive error, the late answer dropped', async () => {
    const h = harness({ remove_delay_ms: 1_000 }, LONG_INACTIVITY)
    userFeed(h.home, 'mine')
    h.sidecar.start()
    await h.until(ready)
    const started = Date.now()
    const { id, result } = h.sidecar.request('feeds.remove', { key: 'mine' }, { deadlineMs: 200 })
    const error = (await result.catch((e: EngineError) => e)) as EngineError
    expect(Date.now() - started, 'ended by the deadline, not by the answer').toBeLessThan(1_000)
    expect(error.code).toBe(ERROR_CODES.inactive)
    const sentence = 'No answer within 200 ms; the engine was asked to cancel the request.'
    expect(error.data).toEqual({ kind: 'inactive', detail: sentence, hint: sentence })
    expect(h.sidecar.deadlinesArmed).toBe(0)
    // The engine finishes the work anyway and answers; the answer is for an
    // id the client no longer holds.
    await eventually(
      () => h.log.some((l) => l === `dropped a response for an unknown request id ${id}`),
      5_000,
      'the late answer to be dropped',
    )
    await eventually(() => cancelsFor(h, id) === 1, 5_000, 'the cancel to be read')
    expect(h.sidecar.state.state).toBe('ready')
    expect(h.log.some((l) => l.includes(`request ${id} (feeds.remove): No answer within`))).toBe(
      true,
    )
  })

  it('counts a request past its deadline as in flight until the engine answers it', async () => {
    const h = harness({ remove_delay_ms: 1_000 }, LONG_INACTIVITY)
    userFeed(h.home, 'mine')
    h.sidecar.start()
    await h.until(ready)
    const { id, result } = h.sidecar.request('feeds.remove', { key: 'mine' }, { deadlineMs: 200 })
    await expect(result).rejects.toMatchObject({ code: ERROR_CODES.inactive })
    // Settled for the page, still the engine's work: a reset must wait.
    expect(h.sidecar.inFlight).toBe(1)
    expect(h.sidecar.abandoned).toBe(1)
    await eventually(() => h.sidecar.inFlight === 0, 5_000, 'the late answer to release the id')
    expect(h.sidecar.abandoned).toBe(0)
    expect(h.log).toContain(`request ${id}: the engine answered after the app stopped waiting`)
    // And the answer, when it came, was the removal done.
    expect(
      JSON.parse(readFileSync(join(h.home, 'data', 'feeds', 'user-feeds.json'), 'utf8')),
    ).toEqual([])
  })

  it('says a deadline in whole seconds as seconds', async () => {
    const h = harness({ remove_delay_ms: 3_000 }, LONG_INACTIVITY)
    h.sidecar.start()
    await h.until(ready)
    const error = (await h.sidecar
      .request('feeds.remove', { key: 'x' }, { deadlineMs: 1_000 })
      .result.catch((e: EngineError) => e)) as EngineError
    expect(error.data?.hint).toBe(
      'No answer within 1 second; the engine was asked to cancel the request.',
    )
  })

  it('refuses a deadline that is not a positive, finite number of milliseconds a timer holds', async () => {
    const h = harness({}, LONG_INACTIVITY)
    h.sidecar.start()
    await h.until(ready)
    for (const deadlineMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31]) {
      expect(
        () => h.sidecar.request('feeds.list', undefined, { deadlineMs }),
        String(deadlineMs),
      ).toThrow(RangeError)
    }
    expect(h.sidecar.inFlight).toBe(0)
    expect(h.received().filter((m) => m.method === 'feeds.list')).toEqual([])
  })

  it('keeps a deadline through a cancel the engine does not honour, and asks it to cancel once', async () => {
    const h = harness({ remove_delay_ms: 1_000 }, LONG_INACTIVITY)
    userFeed(h.home, 'mine')
    h.sidecar.start()
    await h.until(ready)
    const started = Date.now()
    const { id, result } = h.sidecar.request('feeds.remove', { key: 'mine' }, { deadlineMs: 200 })
    h.sidecar.cancel(id)
    expect(h.sidecar.deadlinesArmed).toBe(1)
    // The stand-in does not stop a removal for a cancel; the deadline ends
    // the request all the same, without sending a second cancel.
    await expect(result).rejects.toMatchObject({ code: ERROR_CODES.inactive })
    expect(Date.now() - started).toBeLessThan(1_000)
    await eventually(() => h.sidecar.inFlight === 0, 5_000, 'the late answer')
    expect(cancelsFor(h, id)).toBe(1)
  })

  it('against an engine that runs the removal as a job, the deadline still ends it, the rest is answered meanwhile and the cancel it sent is honoured', async () => {
    // remove_blocks_ms is how long the job takes (the name is from when the
    // engine ran it on its reader). The deadline's cancel lands before the
    // point of no return, which here is the end of the removal.
    const h = harness({ remove_blocks_ms: 1_200 }, LONG_INACTIVITY)
    userFeed(h.home, 'mine')
    h.sidecar.start()
    await h.until(ready)
    const started = Date.now()
    const removal = h.sidecar.request('feeds.remove', { key: 'mine' }, { deadlineMs: 200 })
    const list = h.sidecar.request('feeds.list')
    await expect(removal.result).rejects.toMatchObject({ code: ERROR_CODES.inactive })
    expect(Date.now() - started, 'the deadline, not the engine').toBeLessThan(1_200)
    // The reader is free: the list is answered while the removal is out, and
    // names the feed, which the removal has not yet forgotten.
    const listed = (await list.result) as { feeds: { key: string }[] }
    expect(Date.now() - started, 'answered meanwhile, not behind the removal').toBeLessThan(1_200)
    expect(listed.feeds.map((f) => f.key)).toContain('mine')
    await eventually(() => cancelsFor(h, removal.id) === 1, 5_000, 'the cancel to be read')
    // The engine honours it with the cancelled error, which is for an id
    // the client no longer holds, and the feed is kept.
    await eventually(() => h.sidecar.inFlight === 0, 5_000, 'the late answer')
    expect(
      JSON.parse(readFileSync(join(h.home, 'data', 'feeds', 'user-feeds.json'), 'utf8')),
    ).toEqual([{ key: 'mine', name: 'mine', source: 'user' }])
  })

  it('clears every deadline and forgets expired requests when the engine exits and restarts', async () => {
    const h = harness({ remove_delay_ms: 5_000 }, LONG_INACTIVITY)
    h.sidecar.start()
    await h.until(ready)
    const first = h.pid()
    const expired = h.sidecar.request('feeds.remove', { key: 'x' }, { deadlineMs: 100 })
    await expect(expired.result).rejects.toMatchObject({ code: ERROR_CODES.inactive })
    expect(h.sidecar.inFlight).toBe(1)
    const { result } = h.sidecar.request('feeds.remove', { key: 'y' }, { deadlineMs: 400 })
    expect(h.sidecar.deadlinesArmed).toBe(1)
    process.kill(first, 'SIGKILL')
    await expect(result).rejects.toMatchObject({ code: ERROR_CODES.engineExited })
    expect(h.sidecar.deadlinesArmed).toBe(0)
    expect(h.sidecar.inFlight).toBe(0)
    await h.until((s) => s.state === 'restarting')
    await h.until(ready)
    await sleep(600)
    expect(h.log.filter((l) => l.includes('No answer within'))).toHaveLength(1)
    expect(h.sidecar.deadlinesArmed).toBe(0)
    expect(h.sidecar.inFlight).toBe(0)
  })

  it('counts a request past its deadline until the process has exited, not while it is being ended', async () => {
    // Ignores engine.shutdown, so ending it takes the whole shutdown bound.
    const h = harness(
      { remove_delay_ms: 10_000, ignore_shutdown: true },
      { ...LONG_INACTIVITY, shutdownMs: 1_500, terminateMs: 3_000 },
    )
    h.sidecar.start()
    await h.until(ready)
    const pid = h.pid()
    const expired = h.sidecar.request('feeds.remove', { key: 'x' }, { deadlineMs: 100 })
    await expect(expired.result).rejects.toMatchObject({ code: ERROR_CODES.inactive })
    const stopping = h.sidecar.stop()
    await sleep(300)
    expect(alive(pid), 'still being ended').toBe(true)
    expect(h.sidecar.abandoned).toBe(1)
    expect(h.sidecar.inFlight).toBe(1)
    await stopping
    expect(alive(pid)).toBe(false)
    expect(h.sidecar.abandoned).toBe(0)
    expect(h.sidecar.inFlight).toBe(0)
  })

  it('leaves no deadline armed and nothing counted after a stop', async () => {
    const h = harness({ remove_delay_ms: 5_000 }, LONG_INACTIVITY)
    h.sidecar.start()
    await h.until(ready)
    const expired = h.sidecar.request('feeds.remove', { key: 'x' }, { deadlineMs: 100 })
    await expect(expired.result).rejects.toMatchObject({ code: ERROR_CODES.inactive })
    const { result } = h.sidecar.request('feeds.remove', { key: 'y' }, { deadlineMs: 60_000 })
    const settled = result.catch((e: EngineError) => e)
    expect(h.sidecar.deadlinesArmed).toBe(1)
    expect(h.sidecar.inFlight).toBe(2)
    await h.sidecar.stop()
    expect(h.sidecar.deadlinesArmed).toBe(0)
    expect(h.sidecar.inFlight).toBe(0)
    expect(((await settled) as EngineError).code).toBe(ERROR_CODES.engineExited)
  })

  it('restarts after an exit nobody asked for, rejecting what was in flight', async () => {
    const h = harness({ silent: true }, { inactivityMs: 5_000 })
    h.sidecar.start()
    await h.until(ready)
    const first = h.pid()
    const inFlight = h.sidecar.request('graph.build', { key: 'la-metro-rail' }).result
    process.kill(first, 'SIGKILL')
    await expect(inFlight).rejects.toMatchObject({ code: ERROR_CODES.engineExited })
    const restarting = await h.until((s) => s.state === 'restarting')
    if (restarting.state === 'restarting') {
      expect(restarting.attempt).toBe(2)
      expect(restarting.reason).toMatch(/ended by signal SIGKILL|exited with code/)
    }
    // The engine that answered before the exit is still the one named, for a
    // draw whose write arrives while the next one starts (issue 494).
    expect(h.sidecar.readyVersion, 'while the engine restarts').toBe('0.2.0')
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
    const inFlight = h.sidecar.request('graph.build', { key: 'la-metro-rail' }).result
    const rejected = expect(inFlight).rejects.toMatchObject({ code: ERROR_CODES.engineExited })
    const started = Date.now()
    await h.sidecar.stop()
    await rejected
    expect(Date.now() - started).toBeLessThan(1_500)
    expect(alive(pid)).toBe(false)
    expect(h.sidecar.state).toEqual({
      state: 'stopped',
      reason: 'The app is quitting.',
      retryable: false,
    })
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

  // A person's "Try again" on the Library (issue 562).
  describe('a retry', () => {
    const attempts = (states: EngineState[]): string[] =>
      states.map((s) =>
        s.state === 'starting' || s.state === 'restarting' ? `${s.state} ${s.attempt}` : s.state,
      )

    it('after giving up, starts again with the whole restart budget', async () => {
      const h = harness({ exit: 'at-once' })
      h.sidecar.start()
      const gaveUp = await h.until((s) => s.state === 'stopped')
      expect(gaveUp).toMatchObject({ state: 'stopped', retryable: true })
      const before = h.states.length
      expect(h.sidecar.retry()).toBeNull()
      // Each launch reads the stand-in's control file again; it still exits.
      await h.until((s) => s.state === 'stopped' && h.states.length > before)
      // Four starts again, three restarts between them, as a first start has:
      // the failures that ended in giving up were forgiven.
      expect(attempts(h.states.slice(before))).toEqual([
        'starting 1',
        'restarting 2',
        'starting 2',
        'restarting 3',
        'starting 3',
        'restarting 4',
        'starting 4',
        'stopped',
      ])
      expect(h.log).toContain('trying again, as a person asked')
    })

    it('after giving up, reaches ready when the engine has been put right', async () => {
      const h = harness({ exit: 'at-once' })
      h.sidecar.start()
      await h.until((s) => s.state === 'stopped')
      writeFileSync(join(h.home, 'fake-engine.json'), JSON.stringify({}))
      expect(h.sidecar.retry()).toBeNull()
      await h.until(ready)
    })

    it('starts an interpreter that could not be spawned once more, and says so again', async () => {
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
      await eventually(() => missing.state.state === 'unavailable', 5_000, 'unavailable')
      expect(missing.state).toMatchObject({ state: 'unavailable', retryable: true })
      expect(missing.retry()).toBeNull()
      await eventually(
        () => states.filter((s) => s.state === 'unavailable').length === 2,
        5_000,
        'unavailable again',
      )
      expect(attempts(states)).toEqual(['starting 1', 'unavailable', 'starting 1', 'unavailable'])
      await missing.stop()
    })

    // The supervisor says stopped the moment it gives up, and only then ends
    // the engine it gave up on. A handshake that timed out leaves that engine
    // alive, and one that answers nothing takes the whole shutdown bound to
    // end: a retry meanwhile would start a second engine on the same home.
    it('is refused while the engine it gave up on is still being ended, and starts once it has gone', async () => {
      const h = harness(
        { mute: true },
        // No restarts, so the first failure is the give-up.
        { handshakeMs: 1_000, shutdownMs: 2_000, restartDelaysMs: [] },
      )
      h.sidecar.start()
      await h.until((s) => s.state === 'stopped')
      // A cold interpreter can take a while to write its pid.
      const pidFile = join(h.home, 'fake-engine.pid')
      await eventually(() => existsSync(pidFile), 5_000, 'the engine to write its pid')
      const pid = h.pid()
      expect(alive(pid), 'the engine given up on is still running').toBe(true)
      expect(h.sidecar.retry()).toBe(RETRY_REFUSALS.stillStopping)
      expect(h.states.filter((s) => s.state === 'starting')).toHaveLength(1)
      expect(h.pid(), 'no second engine wrote its pid').toBe(pid)

      await eventually(() => !alive(pid), 10_000, 'the first engine to end')
      // Its ending settles a moment after the exit is seen.
      await eventually(() => h.sidecar.retry() === null, 5_000, 'a retry to start')
      expect(h.states.filter((s) => s.state === 'starting')).toHaveLength(2)
    })

    it('is refused with no interpreter at all, which is not retryable', () => {
      const none = new Sidecar({ command: null, env: {}, pin: PIN, log: () => {} })
      none.start()
      expect(none.state).toMatchObject({ state: 'unavailable', retryable: false })
      expect(none.retry()).toBe(RETRY_REFUSALS.noInterpreter)
      expect(none.state.state).toBe('unavailable')
    })

    it('is refused for a mismatched engine, which would answer the same version', async () => {
      const h = harness({ version: '0.1.0' })
      h.sidecar.start()
      await h.until((s) => s.state === 'mismatched')
      const launches = h.states.filter((s) => s.state === 'starting').length
      expect(h.sidecar.retry()).toBe(RETRY_REFUSALS.mismatched)
      expect(h.sidecar.state.state).toBe('mismatched')
      expect(h.states.filter((s) => s.state === 'starting')).toHaveLength(launches)
    })

    it('is refused while the engine is ready, or on its way, so no second engine starts', async () => {
      const h = harness()
      expect(h.sidecar.retry(), 'before the first start').toBe(RETRY_REFUSALS.notDown)
      h.sidecar.start()
      expect(h.sidecar.retry(), 'starting').toBe(RETRY_REFUSALS.notDown)
      await h.until(ready)
      const pid = h.pid()
      expect(h.sidecar.retry(), 'ready').toBe(RETRY_REFUSALS.notDown)
      expect(h.states.filter((s) => s.state === 'starting')).toHaveLength(1)
      expect(h.pid()).toBe(pid)
    })

    it('is refused once the app is quitting, after giving up as before it', async () => {
      const h = harness({ exit: 'at-once' })
      h.sidecar.start()
      await h.until((s) => s.state === 'stopped')
      await h.sidecar.stop()
      const states = h.states.length
      expect(h.sidecar.retry()).toBe(RETRY_REFUSALS.quitting)
      expect(h.states).toHaveLength(states)

      const quit = harness()
      quit.sidecar.start()
      await quit.until(ready)
      await quit.sidecar.stop()
      expect(quit.sidecar.state).toMatchObject({ state: 'stopped', retryable: false })
      expect(quit.sidecar.retry()).toBe(RETRY_REFUSALS.quitting)
    })
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

describe('engineWorkRefusal (issue 107)', () => {
  it('lets a reset through when the engine has nothing to do', () => {
    expect(engineWorkRefusal({ inFlight: 0, abandoned: 0 })).toBeNull()
  })

  it('asks to wait for a request the engine is answering', () => {
    expect(engineWorkRefusal({ inFlight: 2, abandoned: 0 })).toBe(
      'The engine is answering a request; wait for it to finish.',
    )
  })

  it('names the way out for a request the engine stopped answering, which may never end', () => {
    const said =
      'The engine has not finished a request it stopped answering. If it does not, quit and reopen Legible Cities.'
    expect(engineWorkRefusal({ inFlight: 1, abandoned: 1 })).toBe(said)
    expect(engineWorkRefusal({ inFlight: 3, abandoned: 1 })).toBe(said)
  })
})

describe('describeState', () => {
  it('has one sentence per state', () => {
    expect(describeState({ state: 'starting', attempt: 1 })).toBe('Starting the engine.')
    expect(describeState({ state: 'ready', version: '0.2.0', protocol: 1 })).toBe(
      'Engine ready (0.2.0).',
    )
    expect(describeState({ state: 'unavailable', reason: 'x.', retryable: false })).toBe(
      'Engine unavailable: x.',
    )
    expect(
      describeState({
        state: 'mismatched',
        expected: PIN,
        found: { version: '0.1.0', protocol: 1 },
      }),
    ).toContain('needs engine 0.2.0')
  })
})

// A6-03: the log files close once the supervisor's stop resolves, so what
// the engine's side printed on its way out must have been read by then.
// 'exit' arrives as soon as the engine has gone, while its stderr pipe can
// stay open - here a helper it started holds it for a moment and writes
// last - so the stop waits for 'close', bounded. A Node child stands in,
// because the behaviour is the pipe's and not the engine's.
//
// Not on Windows. Two runs on the Windows runner (PR 92) showed the engine
// ending on request and the helper's line never arriving: the grandchild
// does not keep the parent's stderr pipe open there, so the pipe closes as
// the engine exits and there is nothing left to wait for. The wait for
// 'close' is harmless on that platform; this test of it only means
// something where a grandchild can hold the pipe.
describe('stopping', () => {
  it.skipIf(process.platform === 'win32')(
    'has read the last stderr line written before the pipe closed',
    async () => {
      // The helper says it has started before the engine leaves, so however
      // slowly a Node starts, the gap between the exit and the last line is
      // the helper's own 300 ms and nothing else.
      const helper = [
        "process.stdout.write('started')",
        "setTimeout(() => process.stderr.write('the last line\\n'), 300)",
      ].join('\n')
      const script = [
        "const { spawn } = require('node:child_process')",
        "process.stdin.once('data', () => {",
        `  const h = spawn(process.execPath, ['-e', ${JSON.stringify(helper)}], { stdio: ['ignore', 'pipe', 'inherit'] })`,
        "  h.stdout.once('data', () => process.exit(0))",
        '})',
        'setInterval(() => undefined, 1000)',
      ].join('\n')
      const log: string[] = []
      const sidecar = new Sidecar({
        command: [process.execPath, '-e', script],
        // The environment the app gives the engine, not an empty one: Node on
        // Windows does not start without SystemRoot, and an empty environment
        // made this stand-in exit at once there, before it had started the
        // helper at all (120 ms, four log lines, on the Windows runner).
        env: engineEnvironment({
          config: { home: tmpdir(), loomBin: null, loomCommit: null, ffmpeg: null },
          base: process.env,
          development: true,
        }),
        pin: PIN,
        log: (m) => log.push(m),
        // Generous, because a stand-in that has not left by `shutdownMs` is
        // ended as a tree - `taskkill /T /F` on Windows, the process group on
        // POSIX - and the helper holding the pipe would go with it. Two Node
        // starts on a slow runner can take longer than the fast bound.
        bounds: { ...FAST, handshakeMs: 30_000, shutdownMs: 15_000 },
      })
      sidecar.start()
      // The handshake written at start is what makes it leave.
      await sidecar.stop()
      expect(log, log.join('\n')).toContain('stderr: the last line')
      expect(log, 'it left on its own, not as a killed tree').toContain('ended on request (quit)')
    },
    20_000,
  )
})
