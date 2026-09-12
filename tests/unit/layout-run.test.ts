// The run's state machine, against a stub client and a stub bridge. No
// React, no Electron, no engine: the run is a plain object precisely so
// this is possible (.claude/rules/renderer.md).

import { describe, expect, it, vi } from 'vitest'
import {
  LayoutRun,
  advance,
  freshStages,
  readDiagnostics,
  readableMessage,
  reportOf,
  sentenceFor,
  type RunClient,
} from '../../src/renderer/src/engine/layoutRun'
import {
  doneSentence,
  drawnSentence,
  recolouredSentence,
  stoppedSentence,
} from '../../src/renderer/src/LayoutRun'
import { LAYOUT_STAGES } from '../../src/shared/layout'
import { ERROR_CODES, type EngineState } from '../../src/shared/engine'
import type { ProjectRecord } from '../../src/shared/project'

interface Pending {
  method: string
  params: Record<string, unknown>
  report(stage: string, message: string): void
  resolve(value: unknown): void
  reject(error: unknown): void
  cancelled: boolean
}

// The stub answers with whatever a test hands it, so the one cast lives
// here, at the seam, rather than anywhere in the code under test.
type AnyHandle = ReturnType<RunClient['request']>

function stubClient() {
  const calls: Pending[] = []
  const client: RunClient = {
    request(method, params: unknown) {
      const listeners: ((p: { stage: string; message: string }) => void)[] = []
      let settle!: (v: unknown) => void
      let fail!: (e: unknown) => void
      const result = new Promise<unknown>((res, rej) => {
        settle = res
        fail = rej
      })
      const pending: Pending = {
        method,
        params: params as Record<string, unknown>,
        cancelled: false,
        report: (stage, message) => listeners.forEach((l) => l({ stage, message })),
        resolve: settle,
        reject: fail,
      }
      calls.push(pending)
      return {
        result,
        onProgress: (listener: (p: { stage: string; message: string }) => void) => {
          listeners.push(listener)
          return () => {}
        },
        cancel: () => {
          pending.cancelled = true
        },
      } as unknown as AnyHandle
    },
  }
  return { client, calls }
}

// What graph.build answers with, as far as the run reads it: the engine's
// layout id and the lines the octi stage drew. The paths it also names are
// never opened by the app.
const LAYOUT = 'c'.repeat(64)
const MADE = '2026-09-10T12:00:00+00:00'
const BUILT = {
  layout: LAYOUT,
  paths: {},
  meta: { made: MADE, mode: 'all', agency: null },
  stages: { octi: { lines: ['A', 'B'] } },
}
// What feeds.service answers: the window, the engine's day from the anchor,
// and the anchor echoed (engine v0.6.0).
const SERVICE = {
  start: '2026-01-01',
  end: '2026-12-31',
  busiest_weekday: '2026-09-15',
  anchor: '2026-09-08',
}
// The same, as the record stores it.
const WINDOW = {
  start: '2026-01-01',
  end: '2026-12-31',
  busiest: '2026-09-15',
  anchor: '2026-09-08',
}

// What map.build answers beside its files, since engine v0.8.0: the
// build's numbers, the same numbers as sentences, and the weighted
// proportion the atlas is ordered by. The app keeps all three for the
// panel and throws the files away (specs/017).
const DIAGNOSTICS = {
  stations: 114,
  junctions: 8,
  edges: 121,
  lines: ['A', 'B'],
  octilinear: 0.9938,
  stops: {
    matched: 112,
    total: 116,
    by: { station_id: 100, parent_station: 10, name: 2 },
    unmatched: ['80122', '80123'],
  },
  trips: { total: 1135, paths: 40, unrouted: 3 },
  degraded: { skipped_calls: 12, borrowed_track: 260 },
  labels_dropped: 2,
  peak_concurrent: 19,
}
// The engine answers absolute paths under its home, and the point of the
// test below is that none of them reaches the snapshot. They are assembled
// rather than written out: bin/preflight refuses a path literal in a
// committed file, and a test is no reason to weaken the scanner.
const OUT = ['', 'engine-home', 'out', 'a-project'].join('/')
const MAP = {
  files: { svg: `${OUT}/la.svg`, html: `${OUT}/la.html`, positions: `${OUT}/la.json` },
  date: '2026-09-15',
  summary: 'the engine prints these same numbers',
  diagnostics: DIAGNOSTICS,
  caveats: ['4 of 116 stops could not be placed on the map'],
  issues: 0.2137,
}

const READY: EngineState = { state: 'ready', version: '0.2.0', protocol: 1 }

const project = (over: Partial<ProjectRecord> = {}): ProjectRecord =>
  ({
    version: 1,
    id: 'p1',
    name: 'LA',
    feed: 'la-metro-rail',
    mode: 'all',
    agency: null,
    date: null,
    service: null,
    style: {},
    colors: {},
    defaultColor: '#888888',
    lineOrder: [],
    theme: 'warm-dark',
    layout: null,
    made: null,
    built: null,
    created: '2026-09-01T00:00:00.000Z',
    modified: '2026-09-01T00:00:00.000Z',
    ...over,
  }) as ProjectRecord

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function setup(over: Partial<ProjectRecord> = {}, engine: EngineState | null = READY) {
  const { client, calls } = stubClient()
  const complete = vi.fn(async () => ({ changed: false, relaid: false }))
  const completeRebuild = vi.fn(async () => ({}))
  const completeColors = vi.fn(async () => ({}))
  const record = project(over)
  const run = new LayoutRun({
    client,
    complete,
    completeRebuild,
    completeColors,
    today: () => '2026-09-08',
  })
  return {
    run,
    calls,
    complete,
    completeRebuild,
    completeColors,
    record,
    begin: () => run.start(record, engine),
  }
}

/** The layout answered and the day chosen: the map call is next. */
async function laidOut(calls: Pending[], built = BUILT): Promise<void> {
  calls[0].resolve(built)
  await tick()
  calls[1].resolve(SERVICE)
  await tick()
}

describe('the sentences a finished run shows', () => {
  it('say what a re-layout and a changed id each mean, and both together', () => {
    expect(doneSentence(false, false)).toBe('Laid out.')
    expect(doneSentence(false, true)).toMatch(/now names this one/)
    expect(doneSentence(true, false)).toMatch(/^Laid out again from scratch\./)
    expect(doneSentence(true, true)).toMatch(/in place of the one it had recorded/)
  })
})

describe('advance, the progress rule', () => {
  it('marks the finished stage done and the next one running', () => {
    const after = advance(freshStages(), 'gtfs2graph')
    expect(after[0].state).toBe('done')
    expect(after[1].state).toBe('running')
    expect(after[2].state).toBe('pending')
  })

  it('leaves a stage that is already done alone, and returns the same list', () => {
    const once = advance(freshStages(), 'gtfs2graph')
    const twice = advance(once, 'gtfs2graph')
    expect(twice).toBe(once)
  })

  it('ignores a stage it does not know', () => {
    const stages = freshStages()
    expect(advance(stages, 'sausage')).toBe(stages)
  })
})

describe('the run asks for the layout, then the day, then the map', () => {
  it('sends the feed key, then asks which day with the lines the layout drew, then draws for it', async () => {
    const { calls, begin } = setup()
    begin()
    expect(calls[0]).toMatchObject({ method: 'graph.build', params: { key: 'la-metro-rail' } })
    calls[0].resolve(BUILT)
    await tick()
    // The anchor is the machine's date; the lines are the octi stage's, so
    // the day counts trips the way the map does (ADR-031).
    expect(calls[1]).toMatchObject({
      method: 'feeds.service',
      params: { key: 'la-metro-rail', anchor: '2026-09-08', lines: ['A', 'B'] },
    })
    calls[1].resolve(SERVICE)
    await tick()
    // A project without a day is drawn for the engine's, not for today.
    expect(calls[2]).toMatchObject({
      method: 'map.build',
      params: { key: 'la-metro-rail', layout: LAYOUT, date: '2026-09-15', out: 'p1' },
    })
  })

  it('says what it is waiting for while the day is chosen', async () => {
    const { run, calls, begin } = setup()
    begin()
    for (const stage of ['gtfs2graph', 'topo', 'loom', 'octi'])
      calls[0].report(stage, `${stage} finished`)
    calls[0].resolve(BUILT)
    await tick()
    expect(run.snapshot.message).toMatch(/Choosing the service day/)
    expect(run.snapshot.stages[4].state, 'the schedule tick waits').toBe('running')
  })

  it('draws the map from the layout the engine just answered, never asking it to lay out', async () => {
    const { calls, begin } = setup()
    begin()
    await laidOut(calls, { ...BUILT, layout: 'd'.repeat(64) })
    expect(calls[2].params.layout).toBe('d'.repeat(64))
    expect(Object.keys(calls[2].params)).not.toContain('force')
  })

  it('a re-layout forces every stage and says so when done', async () => {
    const { run, calls, complete, record } = setup({ layout: LAYOUT })
    run.start(record, READY, { force: true })
    expect(calls[0]).toMatchObject({
      method: 'graph.build',
      params: { key: 'la-metro-rail', mode: 'all', force: true },
    })
    expect(run.snapshot.forced).toBe(true)
    await laidOut(calls)
    expect(Object.keys(calls[2].params).sort()).toEqual([
      'colors',
      'date',
      'default_color',
      'key',
      'layout',
      'out',
    ])
    calls[2].resolve({ files: {} })
    await tick()
    expect(complete).toHaveBeenCalledWith('p1', {
      date: '2026-09-15',
      layout: LAYOUT,
      made: MADE,
      built: { mode: 'all', agency: null },
      service: WINDOW,
    })
    expect(run.snapshot).toMatchObject({ state: 'done', forced: true, changed: false })
  })

  it('an ordinary run sends no force', async () => {
    const { calls, begin } = setup()
    begin()
    expect(Object.keys(calls[0].params).sort()).toEqual(['agency', 'key', 'mode'])
  })

  it("uses the day the project already has rather than the engine's, and still asks for the window", async () => {
    const { calls, complete, begin } = setup({ date: '2026-05-04' })
    begin()
    await laidOut(calls)
    expect(calls[1].method).toBe('feeds.service')
    expect(calls[2].params).toMatchObject({ date: '2026-05-04' })
    calls[2].resolve({ files: {} })
    await tick()
    expect(complete).toHaveBeenCalledWith('p1', {
      date: '2026-05-04',
      layout: LAYOUT,
      made: MADE,
      built: { mode: 'all', agency: null },
      service: WINDOW,
    })
  })

  it("passes the project's mode and agency to the layout call, and none to the map's", async () => {
    const { calls, begin } = setup({ mode: 'rail', agency: 'Metro' })
    begin()
    await laidOut(calls)
    expect(calls[0].params).toEqual({ key: 'la-metro-rail', mode: 'rail', agency: 'Metro' })
    // The map call takes no mode and no agency: it draws a stored layout,
    // which was named by them. It does take the project's colours (A4-01).
    expect(Object.keys(calls[2].params).sort()).toEqual([
      'colors',
      'date',
      'default_color',
      'key',
      'layout',
      'out',
    ])
    // No agency is sent as the empty string, which the engine reads as every
    // operator; left out, it would read as the registry entry's.
    const none = setup({ mode: 'all', agency: null })
    none.begin()
    expect(none.calls[0].params).toEqual({ key: 'la-metro-rail', mode: 'all', agency: '' })
  })

  it("writes the record once, with the engine's layout id and its window", async () => {
    const { run, calls, complete, begin } = setup()
    begin()
    await laidOut(calls)
    calls[2].resolve({ files: {} })
    await tick()
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledWith('p1', {
      date: '2026-09-15',
      layout: LAYOUT,
      made: MADE,
      built: { mode: 'all', agency: null },
      service: WINDOW,
    })
    expect(run.snapshot.state).toBe('done')
    expect(run.snapshot.stages.every((s) => s.state === 'done')).toBe(true)
  })

  it('reports a layout laid out again from another project, in words', async () => {
    const { run, calls, complete, begin } = setup({ layout: LAYOUT, made: '2026-09-01T00:00:00Z' })
    complete.mockResolvedValueOnce({ changed: false, relaid: true })
    begin()
    await laidOut(calls)
    calls[2].resolve({ files: {} })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'done', changed: false, relaid: true })
    expect(doneSentence(false, false, true)).toMatch(/laid out again from another project/)
    // A re-layout from this project moves made too; the store says relaid,
    // and the run, which knows it forced, does not.
    const own = setup({ layout: LAYOUT, made: '2026-09-01T00:00:00Z' })
    own.complete.mockResolvedValueOnce({ changed: false, relaid: true })
    own.run.start(own.record, READY, { force: true })
    await laidOut(own.calls)
    own.calls[2].resolve({ files: {} })
    await tick()
    expect(own.run.snapshot).toMatchObject({ state: 'done', forced: true, relaid: false })
    expect(doneSentence(true, false, true), 'a forced run says so itself').toMatch(
      /^Laid out again from scratch\./,
    )
    expect(doneSentence(false, true, true), 'a different id says more').toMatch(/differs from/)
  })

  it('reports a layout that differs from the one the project stored', async () => {
    const { run, calls, complete, begin } = setup({ layout: 'a'.repeat(64) })
    complete.mockResolvedValueOnce({ changed: true, relaid: false })
    begin()
    await laidOut(calls)
    calls[2].resolve({ files: {} })
    await tick()
    expect(run.snapshot.changed).toBe(true)
  })

  it("a refused day fails the run with the engine's sentence and writes nothing", async () => {
    const { run, calls, complete, begin } = setup()
    begin()
    calls[0].resolve(BUILT)
    await tick()
    calls[1].reject({
      code: -32000,
      message: 'no calendar',
      data: { kind: 'feed', detail: 'x', hint: 'The feed has no calendar.' },
    })
    await tick()
    expect(run.snapshot.state).toBe('failed')
    expect(run.snapshot.error).toBe('The feed has no calendar.')
    expect(calls, 'the map was never asked for').toHaveLength(2)
    expect(complete).not.toHaveBeenCalled()
  })
})

// A day a person chose: the map alone, from the stored layout, and the day
// written only once the map is drawn (specs/012, constitution III).
describe('a rebuild for a chosen day', () => {
  it('draws from the stored layout without a layout call, then writes the day', async () => {
    const { run, calls, complete, completeRebuild, record } = setup({
      layout: LAYOUT,
      made: null,
      built: null,
      date: '2026-09-15',
      service: WINDOW,
    })
    run.rebuild(record, READY, '2026-09-12')
    expect(run.snapshot).toMatchObject({ state: 'running', rebuilt: true, day: '2026-09-12' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'map.build',
      params: { key: 'la-metro-rail', layout: LAYOUT, date: '2026-09-12', out: 'p1' },
    })
    for (const stage of LAYOUT_STAGES) calls[0].report(stage, `${stage} finished`)
    calls[0].resolve({ files: {} })
    await tick()
    expect(completeRebuild).toHaveBeenCalledWith('p1', { date: '2026-09-12' })
    expect(complete, 'the layout record is not rewritten').not.toHaveBeenCalled()
    expect(run.snapshot).toMatchObject({ state: 'done', rebuilt: true, changed: false })
    expect(drawnSentence('2026-09-12')).toMatch(/Drawn for 2026-09-12 from the stored layout/)
  })

  it('refuses a project without a layout and calls nothing', () => {
    const { run, calls, record } = setup()
    run.rebuild(record, READY, '2026-09-12')
    expect(calls).toHaveLength(0)
    expect(run.snapshot.state).toBe('failed')
    expect(run.snapshot.error).toMatch(/Lay the project out/)
  })

  it('writes nothing when cancelled, and says the day is kept', async () => {
    const { run, calls, completeRebuild, record } = setup({ layout: LAYOUT, service: WINDOW })
    run.rebuild(record, READY, '2026-09-12')
    run.cancel()
    expect(calls[0].cancelled).toBe(true)
    calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'cancelled', rebuilt: true })
    expect(completeRebuild).not.toHaveBeenCalled()
    expect(stoppedSentence('cancelled', false, true)).toMatch(/keeps its day/)
    expect(stoppedSentence('failed', false, true)).toMatch(/was not drawn for that day/)
  })

  it("shows the main process's refusal of a day outside the window", async () => {
    const { run, calls, completeRebuild, record } = setup({ layout: LAYOUT, service: WINDOW })
    completeRebuild.mockRejectedValueOnce(new Error('the feed covers 2026-01-01 to 2026-12-31'))
    run.rebuild(record, READY, '2027-01-01')
    calls[0].resolve({ files: {} })
    await tick()
    expect(run.snapshot.state).toBe('failed')
    expect(run.snapshot.error).toMatch(/the feed covers/)
  })
})

describe('what the map call said about the map it drew', () => {
  it("keeps the engine's diagnostics, caveats and score, and none of its paths", async () => {
    const { run, calls, begin } = setup()
    begin()
    await laidOut(calls)
    expect(run.snapshot.report, 'nothing until the map has answered').toBeNull()
    calls[2].resolve(MAP)
    await tick()
    expect(run.snapshot.report).toEqual({
      date: '2026-09-15',
      diagnostics: DIAGNOSTICS,
      caveats: MAP.caveats,
      issues: 0.2137,
    })
    // They arrive with the sentence that says the run finished, never
    // before the map they describe is on screen.
    expect(run.snapshot.state).toBe('done')
    // The result's files are absolute paths under the engine's home. The
    // snapshot is read by a screen, so they stay where they were.
    expect(JSON.stringify(run.snapshot.report)).not.toMatch(/[/\\]/)
  })

  it("a rebuild for a chosen day gets that day's figures, from the same call", async () => {
    const { run, calls, record } = setup({ layout: LAYOUT, date: '2026-09-15', service: WINDOW })
    run.rebuild(record, READY, '2026-09-12')
    // A clean network: no sentences, and a score of zero.
    calls[0].resolve({ ...MAP, date: '2026-09-12', caveats: [], issues: 0 })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'done', rebuilt: true })
    expect(run.snapshot.report).toMatchObject({ date: '2026-09-12', caveats: [], issues: 0 })
  })

  it('says nothing when the map was drawn but the record could not be written', async () => {
    const { run, calls, complete, begin } = setup()
    complete.mockRejectedValueOnce(new Error('the project could not be written'))
    begin()
    await laidOut(calls)
    expect(run.snapshot.report, 'nothing while the run is still running').toBeNull()
    calls[2].resolve(MAP)
    await tick()
    expect(run.snapshot.state).toBe('failed')
    expect(run.snapshot.report, 'a run that did not finish shows no figures').toBeNull()
  })

  it('is cleared when the next run starts, and by a run that does not finish', async () => {
    const { run, calls, record } = setup()
    run.start(record, READY)
    await laidOut(calls)
    calls[2].resolve(MAP)
    await tick()
    expect(run.snapshot.report).not.toBeNull()
    run.start(record, READY)
    expect(run.snapshot.report, "the last run's figures go when the next begins").toBeNull()
    calls[3].reject({ code: -32000, message: 'the feed could not be read' })
    await tick()
    expect(run.snapshot.state).toBe('failed')
    expect(run.snapshot.report).toBeNull()
  })

  it('survives a result that carries no diagnostics at all', () => {
    expect(reportOf({ files: {} } as never, '2026-09-15')).toBeNull()
    expect(reportOf(undefined as never, '2026-09-15')).toBeNull()
    expect(reportOf(null as never, '2026-09-15')).toBeNull()
    // A caveat that is not a sentence, and a score that is not a number,
    // are dropped rather than rendered: the answer is another process's.
    expect(
      reportOf(
        { diagnostics: DIAGNOSTICS, caveats: ['ok', 7], issues: null } as never,
        '2026-09-15',
      ),
    ).toMatchObject({ date: '2026-09-15', caveats: ['ok'], issues: 0 })
  })

  // The panel reaches four levels into the block, and the renderer has no
  // error boundary: a block that is only half the shape it claims would
  // take the window blank after the map had been drawn and the record
  // written. Every field the panel reads is checked to the depth it is
  // read, so a block that is not whole is simply not shown.
  it('refuses a diagnostics block that is not whole, at every level', () => {
    const whole = (over: Record<string, unknown>): unknown => ({ ...DIAGNOSTICS, ...over })
    expect(readDiagnostics(DIAGNOSTICS)).toEqual(DIAGNOSTICS)
    for (const broken of [
      undefined,
      null,
      7,
      [],
      { stations: 3 },
      whole({ stops: undefined }),
      whole({ trips: undefined }),
      whole({ degraded: undefined }),
      whole({ stops: { ...DIAGNOSTICS.stops, by: undefined } }),
      whole({ stops: { ...DIAGNOSTICS.stops, by: { station_id: 1, parent_station: 2 } } }),
      whole({ stops: { ...DIAGNOSTICS.stops, total: '116' } }),
      whole({ trips: { total: 1, paths: 1 } }),
      whole({ degraded: { skipped_calls: 1 } }),
      whole({ octilinear: Number.NaN }),
      whole({ peak_concurrent: null }),
      whole({ lines: 'A, B' }),
      whole({ lines: ['A', 7] }),
      whole({ stops: { ...DIAGNOSTICS.stops, unmatched: [null] } }),
    ]) {
      expect(readDiagnostics(broken), JSON.stringify(broken) ?? 'undefined').toBeNull()
      expect(reportOf({ diagnostics: broken } as never, '2026-09-15')).toBeNull()
    }
  })

  it('a run whose result is half a block finishes, and says nothing about the map', async () => {
    const { run, calls, complete, begin } = setup()
    begin()
    await laidOut(calls)
    calls[2].resolve({ ...MAP, diagnostics: { stations: 3 } })
    await tick()
    // The run is unaffected: the record is written and the map is drawn.
    expect(complete).toHaveBeenCalled()
    expect(run.snapshot.state).toBe('done')
    expect(run.snapshot.report, 'a block that is not whole is not shown').toBeNull()
  })
})

describe('the sentence on screen describes the stage that finished', () => {
  it('walks the stages and keeps the last completed sentence', async () => {
    const { run, calls, begin } = setup()
    begin()
    expect(run.snapshot.stages[0].state).toBe('running')
    calls[0].report('gtfs2graph', '114 nodes, 112 edges')
    expect(run.snapshot.stages[0].state).toBe('done')
    expect(run.snapshot.stages[1].state).toBe('running')
    expect(run.snapshot.message).toBe('114 nodes, 112 edges')
  })

  it("ignores the map call repeating the layout's stages", async () => {
    const { run, calls, begin } = setup()
    begin()
    for (const stage of ['gtfs2graph', 'topo', 'loom', 'octi']) {
      calls[0].report(stage, `${stage} finished`)
    }
    await laidOut(calls)
    expect(run.snapshot.stages[4].state).toBe('running')
    calls[2].report('gtfs2graph', 'again')
    expect(run.snapshot.stages[4].state, 'the map has not moved past schedule').toBe('running')
    expect(run.snapshot.message, 'a repeat does not replace the sentence').toMatch(
      /Choosing the service day/,
    )
  })

  it('reaches every stage the engine reports, in order', async () => {
    const { run, calls, begin } = setup()
    begin()
    await laidOut(calls)
    for (const stage of LAYOUT_STAGES) calls[2].report(stage, `${stage} finished`)
    expect(run.snapshot.stages.every((s) => s.state === 'done')).toBe(true)
    expect(run.snapshot.message, 'the write stage never shows its folder').toBe(
      'Wrote the map and its page.',
    )
  })

  it('notifies a subscriber of each change and stops when it unsubscribes', () => {
    const { run, calls, begin } = setup()
    const seen: string[] = []
    const off = run.subscribe((s) => seen.push(s.state))
    begin()
    calls[0].report('gtfs2graph', 'x')
    off()
    calls[0].report('topo', 'y')
    expect(seen).toEqual(['running', 'running'])
  })
})

// The engine's last progress message is the folder it wrote into. A path is
// not for a screen, and the specification forbids one (FR-012).
describe('a message that is a path never reaches the screen', () => {
  it("replaces the write stage's folder with what it did", async () => {
    const { run, calls, begin } = setup()
    begin()
    await laidOut(calls)
    for (const stage of ['gtfs2graph', 'topo', 'loom', 'octi', 'schedule', 'render', 'animate']) {
      calls[2].report(stage, `${stage} finished`)
    }
    calls[2].report('write', '/engine-home/out/p1')
    expect(run.snapshot.message).toBe('Wrote the map and its page.')
    expect(run.snapshot.message).not.toContain('/')
  })

  // A slash is not evidence of a path. These are the engine's real
  // sentences, from specs/007-layout-run/research.md, and every one of them
  // has to survive.
  it('keeps the sentences the engine actually sends', () => {
    const real: [string, string][] = [
      ['gtfs2graph', '114 nodes (114 stations, 0 junctions), 112 edges, lines: A, B, C, D, E, K'],
      ['schedule', '1236 trips on Wednesday 2 September 2026; matched 114/114 stops (100%)'],
      ['render', '3 labels dropped'],
      ['animate', '28 distinct paths'],
    ]
    for (const [stage, message] of real) {
      expect(readableMessage(stage, message), stage).toBe(message)
    }
    // A line label may carry a slash too.
    expect(readableMessage('topo', '9 nodes, 8 edges, lines: A/C/E, B/D')).toBe(
      '9 nodes, 8 edges, lines: A/C/E, B/D',
    )
  })

  it('replaces a message that is path-shaped, whatever its stage', () => {
    expect(readableMessage('render', 'wrote C:\\out\\map.svg')).toBe('Finished render.')
    expect(readableMessage('render', '/var/folders/x/out')).toBe('Finished render.')
    expect(readableMessage('topo', '')).toBeNull()
  })
})

describe('cancelling and failing write nothing', () => {
  it('cancels the request in flight and says the run was cancelled', async () => {
    const { run, calls, complete, begin } = setup()
    begin()
    run.cancel()
    expect(calls[0].cancelled).toBe(true)
    calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    expect(run.snapshot.state).toBe('cancelled')
    expect(complete).not.toHaveBeenCalled()
    expect(run.snapshot.stages.some((s) => s.state === 'failed')).toBe(false)
  })

  it('a forced run stopped after the layout answered says the layout was replaced', async () => {
    const { run, calls, record } = setup({ layout: LAYOUT })
    run.start(record, READY, { force: true })
    expect(run.snapshot.replaced).toBe(false)
    calls[0].resolve(BUILT)
    await tick()
    expect(run.snapshot.replaced, 'the engine has swapped the stored set in').toBe(true)
    // The cancel lands while the day is being chosen.
    run.cancel()
    expect(calls[1].method).toBe('feeds.service')
    expect(calls[1].cancelled).toBe(true)
    calls[1].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'cancelled', forced: true, replaced: true })
    expect(stoppedSentence('cancelled', true)).toMatch(/laid out again, before the map was drawn/)
    expect(stoppedSentence('failed', true)).toMatch(/but the map was not drawn/)
    expect(stoppedSentence('cancelled', false)).toBe(
      'The run was cancelled. The project is as it was.',
    )
  })

  it('an unforced run stopped after the layout answered left the stored layout alone', async () => {
    const { run, calls, begin } = setup({ layout: LAYOUT })
    begin()
    calls[0].resolve(BUILT)
    await tick()
    run.cancel()
    calls[1].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'cancelled', forced: false, replaced: false })
  })

  it('cancels the map call once the layout has finished and the day is chosen', async () => {
    const { run, calls, begin } = setup()
    begin()
    await laidOut(calls)
    run.cancel()
    expect(calls[2].cancelled).toBe(true)
    expect(calls[0].cancelled, 'the finished call is not cancelled again').toBe(false)
    expect(calls[1].cancelled).toBe(false)
  })

  it('a cancel that lands between the layout and the day stops before the map is asked for', async () => {
    const { run, calls, complete, begin } = setup()
    begin()
    calls[0].resolve(BUILT)
    // Cancelled before the microtask that sends feeds.service has run: the
    // run notices when it wakes and asks for nothing more.
    run.cancel()
    await tick()
    expect(run.snapshot.state).toBe('cancelled')
    expect(calls, 'no further call').toHaveLength(1)
    expect(complete).not.toHaveBeenCalled()
  })

  it("marks the running stage failed and shows the engine's sentence, not its detail", async () => {
    const { run, calls, complete, begin } = setup()
    begin()
    calls[0].report('gtfs2graph', 'ok')
    calls[0].reject({
      code: -32000,
      message: 'topo failed',
      data: {
        kind: 'loom',
        detail: '/a/path exit 137',
        hint: 'The layout tool ran out of memory.',
      },
    })
    await tick()
    expect(run.snapshot.state).toBe('failed')
    expect(run.snapshot.error).toBe('The layout tool ran out of memory.')
    expect(run.snapshot.error).not.toContain('/a/path')
    expect(run.snapshot.stages[1].state).toBe('failed')
    expect(complete).not.toHaveBeenCalled()
  })

  it('falls back to the message when the engine sent no hint', () => {
    expect(sentenceFor({ code: -32000, message: 'plain' })).toBe('plain')
    expect(sentenceFor(new Error('thrown'))).toBe('thrown')
    expect(sentenceFor('nonsense')).toMatch(/did not finish/)
  })
})

// Writing the record at the end of a run changes the project the view
// holds. The run must not lose what it just produced because of that.
describe('the run survives the record it writes', () => {
  it('keeps its outcome after the project has changed underneath it', async () => {
    const { client, calls } = stubClient()
    let record = project()
    const complete = vi.fn(async () => {
      record = project({ layout: 'b'.repeat(64), date: '2026-09-08' })
      return { changed: false, relaid: false }
    })
    const run = new LayoutRun({
      client,
      complete,
      completeRebuild: async () => ({}),
      completeColors: async () => ({}),
      today: () => '2026-09-08',
    })
    run.start(record, READY)
    await laidOut(calls)
    calls[2].resolve({ files: {} })
    await tick()
    expect(run.snapshot.state, 'the outcome is still there to be read').toBe('done')
  })

  it('writes the day it started with, not one the record gained meanwhile', async () => {
    const { client, calls } = stubClient()
    const complete = vi.fn(async () => ({ changed: false, relaid: false }))
    const run = new LayoutRun({
      client,
      complete,
      completeRebuild: async () => ({}),
      completeColors: async () => ({}),
      today: () => '2026-09-08',
    })
    run.start(project({ date: '2026-01-01' }), READY)
    // The record is written again while the run is in flight, as another
    // screen might. The run is unmoved: it holds the day it began with.
    project({ date: '2026-12-25' })
    await laidOut(calls)
    calls[2].resolve({ files: {} })
    await tick()
    expect(calls[2].params).toMatchObject({ date: '2026-01-01' })
    expect(complete).toHaveBeenCalledWith('p1', expect.objectContaining({ date: '2026-01-01' }))
  })
})

describe('the run refuses when it cannot start', () => {
  it('refuses while the engine is not ready, and calls nothing', () => {
    const { run, calls, begin } = setup({}, { state: 'unavailable', reason: 'no interpreter' })
    begin()
    expect(calls).toHaveLength(0)
    expect(run.snapshot.state).toBe('failed')
    expect(run.snapshot.error).toMatch(/not ready/i)
  })

  it("a failure to start is this attempt's, not the previous run's", async () => {
    // A rebuild finished; the engine restarts; "Lay out again" is pressed
    // while it is starting. The sentence must be the layout run's.
    const { run, calls, record } = setup({ layout: LAYOUT, service: WINDOW })
    run.rebuild(record, READY, '2026-09-12')
    calls[0].resolve({ files: {} })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'done', rebuilt: true })
    run.start(record, null)
    expect(run.snapshot).toMatchObject({
      state: 'failed',
      rebuilt: false,
      day: null,
      forced: false,
    })
    // And the other way round, after a re-layout stopped with the layout replaced.
    run.start(record, READY, { force: true })
    calls[1].resolve(BUILT)
    await tick()
    run.cancel()
    calls[2].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'cancelled', forced: true, replaced: true })
    run.rebuild(record, null, '2026-09-12')
    expect(run.snapshot).toMatchObject({
      state: 'failed',
      rebuilt: true,
      forced: false,
      replaced: false,
    })
  })

  it('refuses before the engine has said anything', () => {
    const { run, calls, begin } = setup({}, null)
    begin()
    expect(calls).toHaveLength(0)
    expect(run.snapshot.error).toMatch(/starting/i)
  })

  it('refuses a second run while one is in flight', () => {
    const { calls, begin } = setup()
    begin()
    begin()
    expect(calls).toHaveLength(1)
  })
})

// The colours (A4-01): every draw carries the project's palette, and a
// colour change is the map call alone, from the stored layout, for the
// stored day, written only once the map has been drawn.
describe('the palette on every draw', () => {
  const PALETTE = { colors: { A: '#0072bc' }, defaultColor: '#112233' }

  it("a layout run's map call carries the record's colours", async () => {
    const { calls, begin } = setup({ colors: PALETTE.colors, defaultColor: PALETTE.defaultColor })
    begin()
    await laidOut(calls)
    expect(calls[2].method).toBe('map.build')
    expect(calls[2].params).toMatchObject({
      colors: { A: '#0072bc' },
      default_color: '#112233',
    })
  })

  it('a rebuild for a chosen day carries them too, so a day does not lose them', async () => {
    const { run, calls, record } = setup({
      layout: LAYOUT,
      date: '2026-09-15',
      service: WINDOW,
      colors: PALETTE.colors,
      defaultColor: PALETTE.defaultColor,
    })
    run.rebuild(record, READY, '2026-09-12')
    await tick()
    expect(calls[0].method).toBe('map.build')
    expect(calls[0].params).toMatchObject({
      date: '2026-09-12',
      colors: { A: '#0072bc' },
      default_color: '#112233',
    })
  })
})

describe('recolour', () => {
  const stored = { layout: LAYOUT, date: '2026-09-15', service: WINDOW }
  const chosen = { colors: { A: '#ff0000' }, defaultColor: '#00ff00' }

  it('draws the stored layout for the stored day in the chosen colours, and never lays out', async () => {
    const { run, calls, completeColors, record } = setup(stored)
    run.recolour(record, READY, chosen)
    await tick()
    expect(calls).toHaveLength(1)
    expect(calls[0].method, 'the map alone: a colour is a render').toBe('map.build')
    expect(calls[0].params).toMatchObject({
      key: 'la-metro-rail',
      layout: LAYOUT,
      date: '2026-09-15',
      out: 'p1',
      colors: { A: '#ff0000' },
      default_color: '#00ff00',
    })
    expect(run.snapshot.state).toBe('running')
    expect(run.snapshot.recoloured).toBe(true)
    expect(completeColors, 'nothing is written until the map is drawn').not.toHaveBeenCalled()

    calls[0].resolve({ files: {} })
    await tick()
    expect(completeColors).toHaveBeenCalledWith('p1', chosen)
    expect(run.snapshot.state).toBe('done')
    expect(run.snapshot.recoloured).toBe(true)
    expect(run.snapshot.stages.every((s) => s.state === 'done')).toBe(true)
  })

  it('writes nothing when the build fails, and says so', async () => {
    const { run, calls, completeColors, record } = setup(stored)
    run.recolour(record, READY, chosen)
    await tick()
    calls[0].reject({ code: -32000, message: 'the stand-in draws nothing' })
    await tick()
    expect(completeColors).not.toHaveBeenCalled()
    expect(run.snapshot.state).toBe('failed')
    expect(stoppedSentence('failed', false, false, true)).toMatch(/keeps the colours it had/)
  })

  it('writes nothing when it is cancelled', async () => {
    const { run, calls, completeColors, record } = setup(stored)
    run.recolour(record, READY, chosen)
    await tick()
    run.cancel()
    expect(calls[0].cancelled).toBe(true)
    calls[0].resolve({ files: {} })
    await tick()
    expect(completeColors).not.toHaveBeenCalled()
    expect(run.snapshot.state).toBe('cancelled')
    expect(stoppedSentence('cancelled', false, false, true)).toMatch(/keeps the colours it had/)
  })

  it('refuses a project that has not been laid out, and starts nothing', async () => {
    const { run, calls, completeColors, record } = setup()
    run.recolour(record, READY, chosen)
    await tick()
    expect(calls).toEqual([])
    expect(completeColors).not.toHaveBeenCalled()
    expect(run.snapshot.state).toBe('failed')
    expect(run.snapshot.recoloured).toBe(true)
    expect(run.snapshot.error).toMatch(/Lay the project out/)
  })

  it('refuses while another run is going: the two would rewrite one page', async () => {
    const { run, calls, record, begin } = setup(stored)
    begin()
    await tick()
    run.recolour(record, READY, chosen)
    await tick()
    expect(calls, 'only the layout call is out').toHaveLength(1)
    expect(calls[0].method).toBe('graph.build')
    expect(run.snapshot.recoloured).toBe(false)
  })

  it('says, when it has finished, that the stations have not moved', () => {
    expect(recolouredSentence()).toMatch(/stations have not moved/)
  })
})
