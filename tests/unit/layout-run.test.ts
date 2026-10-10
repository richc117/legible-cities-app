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
import { ON_DISK_DEADLINE, downloading } from '../../src/renderer/src/engine/layoutRun'
import {
  doneSentence,
  drawnSentence,
  optionedSentence,
  recolouredSentence,
  reorderedSentence,
  restyledSentence,
  stoppedSentence,
} from '../../src/renderer/src/LayoutRun'
import { cellOfRun } from '../../src/renderer/src/runGraph'
import { LAYOUT_STAGES } from '../../src/shared/layout'
import { ERROR_CODES, type EngineState } from '../../src/shared/engine'
import type { ProjectRecord } from '../../src/shared/project'

interface Pending {
  method: string
  params: Record<string, unknown>
  report(stage: string, message: string, fraction?: number): void
  /** A `job/log` line for this request, as the typed client delivers one. */
  log(level: string, line: string): void
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
      const listeners: ((p: { stage: string; message: string; fraction?: number }) => void)[] = []
      const logs: ((l: { level: string; line: string }) => void)[] = []
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
        report: (stage, message, fraction) =>
          listeners.forEach((l) => l({ stage, message, fraction })),
        log: (level, line) => logs.forEach((l) => l({ level, line })),
        resolve: settle,
        reject: fail,
      }
      calls.push(pending)
      return {
        result,
        onProgress: (
          listener: (p: { stage: string; message: string; fraction?: number }) => void,
        ) => {
          listeners.push(listener)
          return () => {}
        },
        onLog: (listener: (l: { level: string; line: string }) => void) => {
          logs.push(listener)
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
    drawn: null,
    built: null,
    created: '2026-09-01T00:00:00.000Z',
    modified: '2026-09-01T00:00:00.000Z',
    ...over,
  }) as ProjectRecord

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function setup(
  over: Partial<ProjectRecord> = {},
  engine: EngineState | null = READY,
  onDisk?: (key: string) => Promise<boolean>,
) {
  const { client, calls } = stubClient()
  const complete = vi.fn(async () => ({ changed: false, relaid: false }))
  const completeRebuild = vi.fn(async () => ({}))
  const completeColors = vi.fn(async () => ({}))
  const completeOrder = vi.fn(async () => ({}))
  const completeStyle = vi.fn(async () => ({}))
  const completeLines = vi.fn(async () => ({}))
  const record = project(over)
  const run = new LayoutRun({
    client,
    complete,
    completeRebuild,
    completeColors,
    completeOrder,
    completeStyle,
    completeLines,
    today: () => '2026-09-08',
    ...(onDisk === undefined ? {} : { onDisk }),
  })
  return {
    run,
    calls,
    complete,
    completeRebuild,
    completeColors,
    completeOrder,
    completeStyle,
    completeLines,
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

  // Issue 385, spec 033 FR-007 and FR-008. Mutation: the `tuningParams`
  // spread removed from the graph.build call - no `tuning` is then sent, and
  // the first assertion fails. Mutation: the `asked` spread removed from the
  // complete call - the store is then told the layout was asked with LOOM's
  // defaults, and the last one does.
  it('sends the record’s tuning in the engine’s names, and tells the store it did', async () => {
    const { calls, complete, begin } = setup({
      tuning: { grid: 'orthoradial', gridSize: 50, deg45: 3, diagonal: 1 },
    })
    begin()
    expect(calls[0].params.tuning).toEqual({
      grid: 'orthoradial',
      grid_size: 50,
      penalties: { deg45: 3, diagonal: 1 },
    })
    await laidOut(calls)
    calls[2].resolve({ files: {} })
    await tick()
    expect(complete).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        tuning: { grid: 'orthoradial', gridSize: 50, deg45: 3, diagonal: 1 },
      }),
    )
  })

  it('sends a re-layout the tuning too, since it lays out the same inputs', async () => {
    const { run, calls, record } = setup({ layout: LAYOUT, tuning: { mergeDistance: 80 } })
    run.start(record, READY, { force: true })
    expect(calls[0].params).toMatchObject({ force: true, tuning: { merge_distance: 80 } })
  })

  it('sends no tuning, and tells the store none, for a project that never tuned', async () => {
    const { calls, complete, begin } = setup()
    begin()
    expect(calls[0].params).not.toHaveProperty('tuning')
    await laidOut(calls)
    calls[2].resolve({ files: {} })
    await tick()
    expect(complete.mock.calls[0]).toBeDefined()
    expect((complete.mock.calls[0] as unknown[])[1]).not.toHaveProperty('tuning')
  })

  it('sends what the run was started with, whatever the record says by the time it ends', async () => {
    const { calls, complete, record, run } = setup({ tuning: { grid: 'hexalinear' } })
    run.start(record, READY)
    // A tuning committed while the run goes is a new record; the run's own
    // is the one it was handed.
    record.tuning = { grid: 'ortholinear' }
    await laidOut(calls)
    calls[2].resolve({ files: {} })
    await tick()
    expect(calls[0].params.tuning).toEqual({ grid: 'hexalinear' })
    expect((complete.mock.calls[0] as unknown[])[1]).toMatchObject({
      tuning: { grid: 'hexalinear' },
    })
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
      completeOrder: async () => ({}),
      completeStyle: async () => ({}),
      completeLines: async () => ({}),
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
      completeOrder: async () => ({}),
      completeStyle: async () => ({}),
      completeLines: async () => ({}),
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

  // A5.5-15: `date` may be a day chosen and waiting to be drawn. A colour
  // is a render of the map that is there, so it draws the day that map was
  // drawn for - otherwise dragging a colour would quietly draw a day nobody
  // asked it to and close cell 03's gap with nobody pressing the button.
  it('draws the day the map was drawn for, not a day merely chosen', async () => {
    const { run, calls, record } = setup({
      ...stored,
      date: '2026-09-20',
      drawn: {
        layout: LAYOUT,
        made: null,
        date: '2026-09-15',
        colors: {},
        defaultColor: '#888888',
        lineOrder: [],
        theme: 'warm-dark',
        style: {},
      },
    })
    run.recolour(record, READY, chosen)
    await tick()
    expect(calls[0].method).toBe('map.build')
    expect(calls[0].params).toMatchObject({ date: '2026-09-15' })
    expect(run.snapshot.day, 'and the run says which day it drew').toBe('2026-09-15')
  })

  it("takes the record's day when the project cannot say what it drew", async () => {
    // A record from before `drawn` existed: its stored day is the only
    // answer there is, which is what a recolour used before.
    const { run, calls, record } = setup({ ...stored, date: '2026-09-20', drawn: null })
    run.recolour(record, READY, chosen)
    await tick()
    expect(calls[0].params).toMatchObject({ date: '2026-09-20' })
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

describe('reorder', () => {
  const stored = { layout: LAYOUT, date: '2026-09-15', service: WINDOW }
  const chosen = ['C', 'A']

  it('draws the stored layout for the stored day in the chosen order, and never lays out', async () => {
    const { run, calls, completeOrder, record } = setup(stored)
    run.reorder(record, READY, chosen)
    await tick()
    expect(calls).toHaveLength(1)
    expect(calls[0].method, 'the map alone: an order is a render').toBe('map.build')
    expect(calls[0].params).toMatchObject({
      key: 'la-metro-rail',
      layout: LAYOUT,
      date: '2026-09-15',
      out: 'p1',
      line_order: ['C', 'A'],
    })
    expect(run.snapshot.state).toBe('running')
    expect(run.snapshot.reordered).toBe(true)
    expect(completeOrder, 'nothing is written until the map is drawn').not.toHaveBeenCalled()

    calls[0].resolve({ files: {} })
    await tick()
    expect(completeOrder).toHaveBeenCalledWith('p1', chosen)
    expect(run.snapshot.state).toBe('done')
    expect(run.snapshot.reordered).toBe(true)
  })

  it('sends no order at all for a project nobody has arranged', async () => {
    const { run, calls, record } = setup(stored)
    run.reorder(record, READY, [])
    await tick()
    expect(
      'line_order' in calls[0].params,
      'the request is the one it made before the panel existed',
    ).toBe(false)
  })

  it('writes nothing when the build fails, and says so', async () => {
    const { run, calls, completeOrder, record } = setup(stored)
    run.reorder(record, READY, chosen)
    await tick()
    calls[0].reject({ code: -32000, message: 'the stand-in draws nothing' })
    await tick()
    expect(completeOrder).not.toHaveBeenCalled()
    expect(run.snapshot.state).toBe('failed')
    expect(stoppedSentence('failed', false, false, false, true)).toMatch(/keeps the order it had/)
  })

  it('writes nothing when it is cancelled', async () => {
    const { run, calls, completeOrder, record } = setup(stored)
    run.reorder(record, READY, chosen)
    await tick()
    run.cancel()
    expect(calls[0].cancelled).toBe(true)
    calls[0].resolve({ files: {} })
    await tick()
    expect(completeOrder).not.toHaveBeenCalled()
    expect(run.snapshot.state).toBe('cancelled')
    expect(stoppedSentence('cancelled', false, false, false, true)).toMatch(
      /keeps the order it had/,
    )
  })

  it('refuses a project that has not been laid out, and starts nothing', async () => {
    const { run, calls, completeOrder, record } = setup()
    run.reorder(record, READY, chosen)
    await tick()
    expect(calls).toEqual([])
    expect(completeOrder).not.toHaveBeenCalled()
    expect(run.snapshot.state).toBe('failed')
    expect(run.snapshot.reordered).toBe(true)
    expect(run.snapshot.error).toMatch(/Lay the project out/)
  })

  it('refuses while another run is going: the two would rewrite one page', async () => {
    const { run, calls, record, begin } = setup(stored)
    begin()
    await tick()
    run.reorder(record, READY, chosen)
    await tick()
    expect(calls, 'only the layout call is out').toHaveLength(1)
    expect(calls[0].method).toBe('graph.build')
    expect(run.snapshot.reordered).toBe(false)
  })

  it('says, when it has finished, that the stations have not moved', () => {
    expect(reorderedSentence()).toMatch(/stations have not moved/)
  })
})

describe('the arrangement on every other draw', () => {
  const arranged = { lineOrder: ['C', 'A'] }

  it('goes with a layout run', async () => {
    const { calls, begin } = setup({ ...arranged })
    begin()
    await laidOut(calls)
    expect(calls[2].method).toBe('map.build')
    expect(calls[2].params).toMatchObject({ line_order: ['C', 'A'] })
  })

  it('goes with a chosen day', async () => {
    const { run, calls, record } = setup({
      ...arranged,
      layout: LAYOUT,
      date: '2026-09-15',
      service: WINDOW,
    })
    run.rebuild(record, READY, '2026-09-16')
    await tick()
    expect(calls[0].params).toMatchObject({ date: '2026-09-16', line_order: ['C', 'A'] })
  })

  it('goes with a colour change', async () => {
    const { run, calls, record } = setup({
      ...arranged,
      layout: LAYOUT,
      date: '2026-09-15',
      service: WINDOW,
    })
    run.recolour(record, READY, { colors: { A: '#ff0000' }, defaultColor: '#00ff00' })
    await tick()
    expect(calls[0].params).toMatchObject({
      colors: { A: '#ff0000' },
      line_order: ['C', 'A'],
    })
  })

  it("carries the record's palette when the order changes, the other way round", async () => {
    const { run, calls, record } = setup({
      ...arranged,
      layout: LAYOUT,
      date: '2026-09-15',
      service: WINDOW,
      colors: { A: '#0072bc' },
      defaultColor: '#112233',
    })
    run.reorder(record, READY, ['A', 'C'])
    await tick()
    expect(calls[0].params).toMatchObject({
      colors: { A: '#0072bc' },
      default_color: '#112233',
      line_order: ['A', 'C'],
    })
  })

  it("is the record's, not the one being tried, when a colour changes", async () => {
    const { run, calls, record } = setup({
      ...arranged,
      layout: LAYOUT,
      date: '2026-09-15',
      service: WINDOW,
    })
    run.recolour(record, READY, { colors: {}, defaultColor: '#888888' })
    await tick()
    expect(calls[0].params).toMatchObject({ line_order: ['C', 'A'] })
  })
})

// Issue 350, ADR-049. A size is a render, never a layout: the map call alone,
// from the stored layout, for the day it already showed, with a `style`
// only when the project has set one.
describe('the sizes on every draw', () => {
  const stored = { layout: LAYOUT, date: '2026-09-15', service: WINDOW }
  const sized = { lineWidth: 12 }

  it('sends no style at all for a project nobody has sized, whichever run draws', async () => {
    // The one thing this must not get wrong: an existing project's map is
    // what it was, so its map.build is the request it always was.
    const layoutRun = setup({})
    layoutRun.begin()
    await laidOut(layoutRun.calls)
    expect(layoutRun.calls[2].method).toBe('map.build')
    expect(layoutRun.calls[2].params, 'a layout run').not.toHaveProperty('style')

    const day = setup(stored)
    day.run.rebuild(day.record, READY, '2026-09-16')
    await tick()
    expect(day.calls[0].params, 'a chosen day').not.toHaveProperty('style')

    const colour = setup(stored)
    colour.run.recolour(colour.record, READY, { colors: {}, defaultColor: '#112233' })
    await tick()
    expect(colour.calls[0].params, 'a colour change').not.toHaveProperty('style')

    const order = setup(stored)
    order.run.reorder(order.record, READY, ['B', 'A'])
    await tick()
    expect(order.calls[0].params, 'an order').not.toHaveProperty('style')

    const style = setup(stored)
    style.run.restyle(style.record, READY, {})
    await tick()
    expect(style.calls[0].params, 'a reset to the engine’s own').not.toHaveProperty('style')
  })

  it('sends no style for sizes that are all the engine’s own either', async () => {
    const { run, calls, record } = setup({
      ...stored,
      style: { lineWidth: 7, labelSize: 11, padding: 24 },
    })
    run.rebuild(record, READY, '2026-09-16')
    await tick()
    expect(calls[0].params).not.toHaveProperty('style')
  })

  it('goes with every other draw when the project has set one, so a day or a colour does not lose it', async () => {
    const withStyle = { ...stored, style: sized }
    const layoutRun = setup({ style: sized })
    layoutRun.begin()
    await laidOut(layoutRun.calls)
    expect(layoutRun.calls[2].params).toMatchObject({ style: { line_width: 12 } })

    const day = setup(withStyle)
    day.run.rebuild(day.record, READY, '2026-09-16')
    await tick()
    expect(day.calls[0].params).toMatchObject({ style: { line_width: 12 } })

    const colour = setup(withStyle)
    colour.run.recolour(colour.record, READY, { colors: {}, defaultColor: '#112233' })
    await tick()
    expect(colour.calls[0].params).toMatchObject({ style: { line_width: 12 } })

    const order = setup(withStyle)
    order.run.reorder(order.record, READY, ['B', 'A'])
    await tick()
    expect(order.calls[0].params).toMatchObject({ style: { line_width: 12 } })
  })

  it("is the record's, not the one being tried, when a colour changes", async () => {
    const { run, calls, record } = setup({ ...stored, style: { labelSize: 20 } })
    run.recolour(record, READY, { colors: {}, defaultColor: '#888888' })
    await tick()
    expect((calls[0].params as { style: unknown }).style).toEqual({ label_size: 20 })
  })
})

// Issue 394 (spec 036, FR-009): the line options go on every draw the
// record is drawn with, and on none for a project that chose none.
describe('the line options on every draw', () => {
  const stored = { layout: LAYOUT, date: '2026-09-15', service: WINDOW }
  const lines = { B: { hidden: true }, A: { name: 'Airport Express', width: 1 } }
  const sent = { B: { hidden: true }, A: { name: 'Airport Express' } }

  it('sends no lines at all for a project that chose none, whichever run draws', async () => {
    // Mutation: the draw sends `lines` whatever it holds - `{}` then goes on
    // every request, which no project sent before this feature.
    const layoutRun = setup({})
    layoutRun.begin()
    await laidOut(layoutRun.calls)
    expect(layoutRun.calls[2].params, 'a layout run').not.toHaveProperty('lines')
    const plain = setup({ ...stored, lines: { A: { hidden: false } } })
    plain.run.rebuild(plain.record, READY, '2026-09-16')
    await tick()
    expect(plain.calls[0].params, 'only the engine’s own').not.toHaveProperty('lines')
  })

  it('goes with every draw of a project that chose some, so a day, a colour, an order or a size keeps them', async () => {
    // Mutation: one caller of the draw passes no lines - a colour changed
    // then draws a hidden line back on the map.
    const withLines = { ...stored, lines }
    const layoutRun = setup({ lines })
    layoutRun.begin()
    await laidOut(layoutRun.calls)
    expect(layoutRun.calls[2].params).toMatchObject({ lines: sent })

    const day = setup(withLines)
    day.run.rebuild(day.record, READY, '2026-09-16')
    await tick()
    expect((day.calls[0].params as { lines: unknown }).lines, 'a chosen day').toEqual(sent)

    const colour = setup(withLines)
    colour.run.recolour(colour.record, READY, { colors: {}, defaultColor: '#112233' })
    await tick()
    expect((colour.calls[0].params as { lines: unknown }).lines, 'a colour').toEqual(sent)

    const order = setup(withLines)
    order.run.reorder(order.record, READY, ['B', 'A'])
    await tick()
    expect((order.calls[0].params as { lines: unknown }).lines, 'an order').toEqual(sent)

    const size = setup(withLines)
    size.run.restyle(size.record, READY, { lineWidth: 12 })
    await tick()
    expect((size.calls[0].params as { lines: unknown }).lines, 'a size').toEqual(sent)
    // Beside the colours and the order, never in place of them.
    expect(colour.calls[0].params).toMatchObject({ colors: {}, default_color: '#112233' })
    expect(order.calls[0].params).toMatchObject({ line_order: ['B', 'A'] })
  })
})

describe('restyle', () => {
  const stored = { layout: LAYOUT, date: '2026-09-15', service: WINDOW }

  it('draws the stored layout for the stored day with the chosen sizes, and never lays out', async () => {
    const { run, calls, completeStyle, record } = setup(stored)
    run.restyle(record, READY, { lineWidth: 12 })
    await tick()
    expect(calls).toHaveLength(1)
    expect(calls[0].method, 'the map alone: a size is a render').toBe('map.build')
    expect(calls[0].params).toMatchObject({
      key: 'la-metro-rail',
      layout: LAYOUT,
      date: '2026-09-15',
      out: 'p1',
      style: { line_width: 12 },
    })
    // Nothing else is in `style`: the fields a person set, in the engine's
    // names, and none of its four colours.
    expect((calls[0].params as { style: object }).style).toEqual({ line_width: 12 })
    expect(
      calls.map((c) => c.method),
      'no graph.build, no feeds.service',
    ).toEqual(['map.build'])
    expect(run.snapshot.state).toBe('running')
    expect(run.snapshot.restyled).toBe(true)
    expect(run.snapshot.recoloured).toBe(false)
    expect(completeStyle, 'nothing is written until the map is drawn').not.toHaveBeenCalled()

    calls[0].resolve({ files: {} })
    await tick()
    expect(completeStyle).toHaveBeenCalledWith('p1', { lineWidth: 12 })
    expect(run.snapshot.state).toBe('done')
    expect(run.snapshot.restyled).toBe(true)
    expect(run.snapshot.stages.every((s) => s.state === 'done')).toBe(true)
  })

  it('sends both radii whenever either is set, the one not set as the engine’s', async () => {
    const { run, calls, record } = setup(stored)
    run.restyle(record, READY, { stationRadius: 5 })
    await tick()
    expect((calls[0].params as { style: object }).style).toEqual({
      station_radius: 5,
      interchange_radius: 6,
    })
  })

  // Issue 391 (spec 034, FR-004 and FR-009): the markers and the face go
  // inside `style`, the trains beside it as `map.build`'s own parameters.
  it('sends the markers and the face inside the style and the trains beside it', async () => {
    // Mutation: `dot_radius` and `trail` sent inside `style`, which the
    // engine refuses whole.
    const { run, calls, completeStyle, record } = setup(stored)
    const chosen = { stationShape: 'tick', labelFont: 'inter', dotRadius: 8, trail: 1.5 } as const
    run.restyle(record, READY, chosen)
    await tick()
    const params = calls[0].params as Record<string, unknown>
    expect(params.style).toEqual({ station_shape: 'tick', label_font: 'inter' })
    expect(params.dot_radius).toBe(8)
    expect(params.trail).toBe(1.5)
    expect(params).not.toHaveProperty('preset')
    calls[0].resolve({ files: {} })
    await tick()
    expect(completeStyle).toHaveBeenCalledWith('p1', chosen)
  })

  it('sends the trains on every draw of a project that set them, and nothing of them for one that did not', async () => {
    const trains = { ...stored, style: { dotRadius: 8 } }
    const colour = setup(trains)
    colour.run.recolour(colour.record, READY, { colors: {}, defaultColor: '#112233' })
    await tick()
    expect(colour.calls[0].params).toMatchObject({ dot_radius: 8 })
    expect(colour.calls[0].params, 'no style for the trains alone').not.toHaveProperty('style')

    const day = setup(trains)
    day.run.rebuild(day.record, READY, '2026-09-16')
    await tick()
    expect(day.calls[0].params).toMatchObject({ dot_radius: 8 })

    const plain = setup(stored)
    plain.run.restyle(plain.record, READY, {})
    await tick()
    for (const name of ['style', 'dot_radius', 'trail'])
      expect(plain.calls[0].params, name).not.toHaveProperty(name)
  })

  it('sends the eight in the engine’s names, and not a colour among them', async () => {
    const { run, calls, record } = setup(stored)
    run.restyle(record, READY, {
      lineWidth: 12,
      lineGap: 2,
      stationRadius: 5,
      interchangeRadius: 9,
      stationStroke: 3,
      labelSize: 20,
      labelOffset: 12,
      padding: 40,
    })
    await tick()
    const sent = (calls[0].params as { style: Record<string, number> }).style
    expect(sent).toEqual({
      line_width: 12,
      line_gap: 2,
      station_radius: 5,
      interchange_radius: 9,
      station_stroke: 3,
      label_size: 20,
      label_offset: 12,
      padding: 40,
    })
    for (const colour of ['background', 'station_fill', 'station_stroke_color', 'label_color'])
      expect(sent, colour).not.toHaveProperty(colour)
  })

  it('draws the day the map was drawn for, not a day merely chosen', async () => {
    const { run, calls, record } = setup({
      ...stored,
      date: '2026-09-20',
      drawn: {
        layout: LAYOUT,
        made: null,
        date: '2026-09-15',
        colors: {},
        defaultColor: '#888888',
        lineOrder: [],
        theme: 'warm-dark',
        style: {},
      },
    })
    run.restyle(record, READY, { lineWidth: 12 })
    await tick()
    expect(calls[0].params).toMatchObject({ date: '2026-09-15' })
    expect(run.snapshot.day, 'and the run says which day it drew').toBe('2026-09-15')
  })

  it("carries the record's colours and order, so a size does not lose them", async () => {
    const { run, calls, record } = setup({
      ...stored,
      colors: { A: '#0072bc' },
      defaultColor: '#112233',
      lineOrder: ['C', 'A'],
    })
    run.restyle(record, READY, { lineWidth: 12 })
    await tick()
    expect(calls[0].params).toMatchObject({
      colors: { A: '#0072bc' },
      default_color: '#112233',
      line_order: ['C', 'A'],
    })
  })

  it('writes nothing when the build fails, and says so', async () => {
    const { run, calls, completeStyle, record } = setup(stored)
    run.restyle(record, READY, { lineWidth: 12 })
    await tick()
    calls[0].reject({ code: -32000, message: 'the stand-in draws nothing' })
    await tick()
    expect(completeStyle).not.toHaveBeenCalled()
    expect(run.snapshot.state).toBe('failed')
    expect(run.snapshot.restyled).toBe(true)
    expect(stoppedSentence('failed', false, false, false, false, true)).toMatch(
      /keeps the sizes it had/,
    )
  })

  it('writes nothing when it is cancelled', async () => {
    const { run, calls, completeStyle, record } = setup(stored)
    run.restyle(record, READY, { lineWidth: 12 })
    await tick()
    run.cancel()
    expect(calls[0].cancelled).toBe(true)
    calls[0].resolve({ files: {} })
    await tick()
    expect(completeStyle).not.toHaveBeenCalled()
    expect(run.snapshot.state).toBe('cancelled')
    expect(stoppedSentence('cancelled', false, false, false, false, true)).toMatch(
      /keeps the sizes it had/,
    )
  })

  it('refuses a project that has not been laid out, and starts nothing', async () => {
    const { run, calls, completeStyle, record } = setup()
    run.restyle(record, READY, { lineWidth: 12 })
    await tick()
    expect(calls).toEqual([])
    expect(completeStyle).not.toHaveBeenCalled()
    expect(run.snapshot.state).toBe('failed')
    expect(run.snapshot.restyled).toBe(true)
    expect(run.snapshot.error).toMatch(/Lay the project out/)
  })

  it('refuses while another run is going: the two would rewrite one page', async () => {
    const { run, calls, record, begin } = setup(stored)
    begin()
    await tick()
    run.restyle(record, READY, { lineWidth: 12 })
    await tick()
    expect(calls, 'only the layout call is out').toHaveLength(1)
    expect(calls[0].method).toBe('graph.build')
    expect(run.snapshot.restyled).toBe(false)
  })

  it('says, when it has finished, that the stations have not moved', () => {
    expect(restyledSentence()).toMatch(/stations have not moved/)
  })
})

// Issue 394 (spec 036, FR-010): a redraw for chosen line options, the
// colours' kind of cheap edit.
describe('redrawLines', () => {
  const stored = {
    layout: LAYOUT,
    date: '2026-09-20',
    service: WINDOW,
    colors: { A: '#0072bc' },
    lineOrder: ['B', 'A'],
    style: { labelSize: 20 },
    drawn: {
      layout: LAYOUT,
      made: null,
      date: '2026-09-15',
      colors: { A: '#0072bc' },
      defaultColor: '#888888',
      lineOrder: ['B', 'A'],
      theme: 'warm-dark' as const,
      style: { labelSize: 20 },
    },
  }
  const lines = { B: { hidden: true }, A: { name: 'Airport Express', width: 1.25 } }

  it('draws the stored layout for the day the map showed, with the options, and never lays out', async () => {
    // Mutation: the redraw draws the record's options rather than the ones
    // chosen - the map would then never show a choice until it was stored,
    // and it is stored only once the map shows it.
    const { run, calls, completeLines, completeColors, record } = setup(stored)
    run.redrawLines(record, READY, lines)
    await tick()
    expect(
      calls.map((c) => c.method),
      'the map alone: an option is a render',
    ).toEqual(['map.build'])
    expect(calls[0].params).toMatchObject({
      key: 'la-metro-rail',
      layout: LAYOUT,
      // The day the map on disk was drawn for, not the one chosen and waiting.
      date: '2026-09-15',
      out: 'p1',
      lines,
      // The record's colours, order and sizes beside them, never in place.
      colors: { A: '#0072bc' },
      line_order: ['B', 'A'],
      style: { label_size: 20 },
    })
    expect(run.snapshot.state).toBe('running')
    expect(completeLines, 'nothing is written until the map is drawn').not.toHaveBeenCalled()

    calls[0].resolve({ files: {} })
    await tick()
    expect(completeLines).toHaveBeenCalledWith('p1', lines)
    expect(completeColors).not.toHaveBeenCalled()
    expect(run.snapshot.state).toBe('done')
  })

  it('writes the stations the build answered with the options', async () => {
    // Mutation: the stations left off the write - cell 03's Trip would then
    // offer a hidden line's stations after the map dropped them.
    const { run, calls, completeLines, record } = setup(stored)
    run.redrawLines(record, READY, lines)
    await tick()
    calls[0].resolve({ files: {}, stations: [{ id: '0x1', name: 'Alpha' }] })
    await tick()
    expect(completeLines).toHaveBeenCalledWith('p1', lines, [{ id: '0x1', name: 'Alpha' }])
  })

  it('is the colours’ kind of run, so cell 05 is the one running and a stop puts both back', async () => {
    // Mutation: the redraw marked as none of the cheap edits - the run graph
    // would then show cell 02 running for a line option.
    const { run, record } = setup(stored)
    run.redrawLines(record, READY, lines)
    await tick()
    expect(run.snapshot).toMatchObject({
      recoloured: true,
      optioned: true,
      reordered: false,
      restyled: false,
      rebuilt: false,
      forced: false,
    })
    expect(cellOfRun(run.snapshot)).toBe('lines')
    expect(run.job()).toMatchObject({ kind: 'rebuild', label: 'Redraw with new line options' })
  })

  it('says its own words, and a recolour does not say them', async () => {
    // Mutation: `optioned` left false in the redraw - cell 02 would then say
    // the map was drawn in the colours a person chose after a rename.
    const { run, record } = setup(stored)
    run.redrawLines(record, READY, lines)
    await tick()
    expect(run.snapshot.optioned).toBe(true)
    const recolour = setup(stored)
    recolour.run.recolour(recolour.record, READY, {
      colors: { A: '#ff0000' },
      defaultColor: '#00ff00',
    })
    await tick()
    expect(recolour.run.snapshot).toMatchObject({ recoloured: true, optioned: false })
    expect(optionedSentence()).toMatch(/line options you chose.*stations have not moved/)
    expect(optionedSentence()).not.toMatch(/colours/)
    expect(stoppedSentence('cancelled', false, false, true, false, false, true)).toMatch(
      /keeps the line options it had/,
    )
    expect(stoppedSentence('failed', false, false, true, false, false, true)).toMatch(
      /not drawn with those line options/,
    )
    expect(stoppedSentence('failed', false, false, true)).toMatch(/not drawn in those colours/)
  })

  it('writes nothing when the build fails or is cancelled', async () => {
    // Mutation: the cancel not looked at after the draw - a stopped redraw
    // would then write options the map on screen does not show.
    const failing = setup(stored)
    failing.run.redrawLines(failing.record, READY, lines)
    await tick()
    failing.calls[0].reject({
      code: -32000,
      message: 'every line on this map is hidden',
      data: { kind: 'feed', hint: 'every line on this map is hidden' },
    })
    await tick()
    expect(failing.completeLines).not.toHaveBeenCalled()
    expect(failing.run.snapshot.state).toBe('failed')
    expect(failing.run.snapshot.recoloured).toBe(true)

    const cancelled = setup(stored)
    cancelled.run.redrawLines(cancelled.record, READY, lines)
    await tick()
    cancelled.run.cancel()
    cancelled.calls[0].resolve({ files: {} })
    await tick()
    expect(cancelled.completeLines).not.toHaveBeenCalled()
    expect(cancelled.run.snapshot.state).toBe('cancelled')
  })

  it('refuses a project that has not been laid out, and while another run is going', async () => {
    // Mutation: the layout's check removed - a project with no map would then
    // send a map.build with no layout.
    const fresh = setup()
    fresh.run.redrawLines(fresh.record, READY, lines)
    await tick()
    expect(fresh.calls).toEqual([])
    expect(fresh.run.snapshot.state).toBe('failed')
    expect(fresh.run.snapshot.error).toBe('Lay the project out before choosing line options.')

    const busy = setup(stored)
    busy.begin()
    await tick()
    busy.run.redrawLines(busy.record, READY, lines)
    await tick()
    expect(busy.calls, 'only the layout call is out').toHaveLength(1)
    expect(busy.calls[0].method).toBe('graph.build')
  })
})

// The inspector's view of a run (A1-03, specs/024-jobs): one job per
// attempt, derived from the snapshot, so the two can never disagree.
describe('the run as a job', () => {
  it('is no job until it starts, then a running layout job for its project', () => {
    const { run, begin } = setup()
    expect(run.job()).toBeNull()
    begin()
    const job = run.job()
    expect(job).toMatchObject({
      kind: 'layout',
      label: 'Layout run',
      projectId: 'p1',
      projectName: null,
      state: 'running',
      hint: null,
      detail: null,
      ended: null,
    })
    expect(job?.stages.map((s) => s.id)).toEqual([...LAYOUT_STAGES])
    expect(job?.stages).toEqual(
      run.snapshot.stages.map(({ id, label, state }) => ({ id, label, state })),
    )
  })

  it('keeps its own log lines, from every call it makes, and its stages and sentence as the snapshot has them', async () => {
    const { run, calls, begin } = setup()
    begin()
    calls[0].log('info', 'gtfs2graph: running')
    calls[0].report('gtfs2graph', 'gtfs2graph: 3 nodes')
    await laidOut(calls)
    calls[2].log('warning', 'schedule: 2 trips skipped')
    const job = run.job()
    expect(job?.log).toEqual(['[info] gtfs2graph: running', '[warning] schedule: 2 trips skipped'])
    expect(job?.message).toBe(run.snapshot.message)
    expect(job?.stages.map((s) => s.state)).toEqual(run.snapshot.stages.map((s) => s.state))
  })

  it('ends done with an end time, and a new attempt is a new job', async () => {
    const { run, calls, begin } = setup()
    begin()
    const first = run.job()?.id
    await laidOut(calls)
    calls[2].resolve(MAP)
    await tick()
    await tick()
    expect(run.snapshot.state).toBe('done')
    const done = run.job()
    expect(done).toMatchObject({ id: first, state: 'done' })
    expect(done?.ended).not.toBeNull()
    expect((done?.ended ?? 0) >= (done?.started ?? 0)).toBe(true)
    begin()
    expect(run.job()?.id).not.toBe(first)
    expect(run.job()?.state).toBe('running')
  })

  it("a failure carries the engine's hint and its detail, both without paths", async () => {
    const { run, calls, begin } = setup()
    begin()
    const detail = ['ValueError: empty graph in ', '', 'engine-home', 'graphs', 'la.json'].join('/')
    calls[0].reject({
      code: -32000,
      message: 'empty',
      data: { kind: 'engine', detail, hint: 'la-metro-rail: the line graph is empty' },
    })
    await tick()
    const job = run.job()
    expect(job).toMatchObject({ state: 'failed', hint: 'la-metro-rail: the line graph is empty' })
    expect(job?.detail).toBe('ValueError: empty graph in a file')
    expect(job?.rawDetail, 'kept as sent for the copy, which main redacts').toBe(detail)
  })

  it('a start the engine is not ready for is a failed job of its own', () => {
    const { run, record } = setup({}, null)
    run.start(record, null)
    expect(run.job()).toMatchObject({
      state: 'failed',
      hint: expect.stringMatching(/still starting/),
    })
    expect(run.job()?.ended).not.toBeNull()
  })

  it('names a re-layout, a rebuild, a recolour, a reorder and a restyle by what they are', async () => {
    const { run, calls, record } = setup({ layout: LAYOUT, date: '2026-09-15' })
    run.start(record, READY, { force: true })
    expect(run.job()).toMatchObject({ kind: 'layout', label: 'Re-layout' })
    run.cancel()
    calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    expect(run.job()?.state).toBe('cancelled')
    run.rebuild(record, READY, '2026-09-16')
    expect(run.job()).toMatchObject({ kind: 'rebuild', label: 'Rebuild for 2026-09-16' })
    run.cancel()
    calls[1].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    run.recolour(record, READY, { colors: {}, defaultColor: '#888888' })
    expect(run.job()).toMatchObject({ kind: 'rebuild', label: 'Redraw in new colours' })
    run.cancel()
    calls[2].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    run.reorder(record, READY, ['B', 'A'])
    expect(run.job()).toMatchObject({ kind: 'rebuild', label: 'Redraw in a new line order' })
    run.cancel()
    calls[3].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    run.restyle(record, READY, { lineWidth: 12 })
    expect(run.job()).toMatchObject({ kind: 'rebuild', label: 'Redraw in new sizes' })
  })

  it('leaves the snapshot exactly as it was: no field added', () => {
    const { run, begin } = setup()
    begin()
    expect(Object.keys(run.snapshot).sort()).toEqual(
      [
        'state',
        'stages',
        'message',
        'error',
        'changed',
        'relaid',
        'forced',
        'replaced',
        'rebuilt',
        'recoloured',
        // Added by issue 394 on purpose: the redraw for line options is the
        // colours' kind of run, told apart only so cell 02 says what it drew.
        'optioned',
        'reordered',
        // Added by issue 350 on purpose: the run is a redraw for sizes, and
        // belongs to cell 04.
        'restyled',
        'day',
        'report',
        // Added by issue 178 on purpose, not by the jobs: where the feed's
        // download inside the run has got (engine v0.10.0, E36), and whether
        // the run ended with its feed not on disk.
        'download',
        'feedMissing',
        // Added by issue 382 on purpose: the layout the run's stage reports
        // name (engine v0.14.0), which cell 01 draws each stage of.
        'layout',
      ].sort(),
    )
  })
})

// Issue 178, on engine v0.10.0 (E36). A preset's zip is fetched inside the
// layout the first time, and the engine reports it as stage "download": the
// run keeps it apart from its own stages, so the line does not move and the
// run is cell 01's while it lasts.
describe("a feed's download inside the run", () => {
  it('is kept apart from the stages, and the first stage of the layout ends it', async () => {
    const { run, calls, begin } = setup()
    begin()
    calls[0].report('download', 'downloaded 65,536 of 1,732,403 bytes', 0.0378)
    expect(run.snapshot.download).toEqual({
      message: 'downloaded 65,536 of 1,732,403 bytes',
      fraction: 0.0378,
    })
    expect(run.snapshot.stages.map((s) => s.state)[0]).toBe('running')
    expect(run.snapshot.message, "the stages' sentence is not the download's").toBeNull()
    expect(downloading(run.snapshot)).toBe(true)
    calls[0].report('download', 'downloaded 1,732,403 of 1,732,403 bytes', 1)
    expect(downloading(run.snapshot), 'at its end, though no stage has reported yet').toBe(false)
    calls[0].report('gtfs2graph', '114 nodes')
    expect(run.snapshot.download).toBeNull()
    expect(run.snapshot.stages[0].state).toBe('done')
  })

  it("ends as the feed's when the registry says the zip is not on disk, however far the bytes came", async () => {
    // The engine refuses a page that is not a zip after its last byte.
    const asked: string[] = []
    const refused = setup({}, READY, async (key) => {
      asked.push(key)
      return false
    })
    refused.begin()
    refused.calls[0].report('download', 'downloaded 21 of 21 bytes', 1)
    refused.calls[0].reject({
      code: -32000,
      message: 'feed',
      data: { kind: 'feed', hint: 'https://example.test/t.zip did not return a zip (21 bytes)' },
    })
    await tick()
    await tick()
    expect(asked).toEqual(['la-metro-rail'])
    expect(refused.run.snapshot.state).toBe('failed')
    expect(refused.run.snapshot.feedMissing).toBe(true)
    expect(refused.run.snapshot.error).toBe(
      'https://example.test/t.zip did not return a zip (21 bytes)',
    )
    expect(refused.complete, 'nothing was written').not.toHaveBeenCalled()

    // A failure before the first byte - offline, a 404 - reported nothing.
    const early = setup({}, READY, async () => false)
    early.begin()
    early.calls[0].reject({
      code: -32000,
      message: 'feed',
      data: { kind: 'feed', hint: 'could not be fetched' },
    })
    await tick()
    await tick()
    expect(early.run.snapshot.download).toBeNull()
    expect(early.run.snapshot.feedMissing).toBe(true)
  })

  it("ends as the run's when the zip was kept, even with the fraction short of the end", async () => {
    // A download of unknown size reports 0 to its end; a cancel in the
    // gtfs2graph after it must not call the kept zip missing.
    const kept = setup({}, READY, async () => true)
    kept.begin()
    kept.calls[0].report('download', 'downloaded 1,732,403 bytes', 0)
    kept.run.cancel()
    kept.calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    await tick()
    expect(kept.run.snapshot.state).toBe('cancelled')
    expect(kept.run.snapshot.feedMissing).toBe(false)
  })

  it('asks nothing of a run with no registry to ask, or one past its first stage', async () => {
    const none = setup()
    none.begin()
    none.calls[0].report('download', 'downloaded 65,536 bytes', 0.1)
    none.calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    expect(none.run.snapshot.feedMissing).toBe(false)

    const asked: string[] = []
    const past = setup({}, READY, async (key) => (asked.push(key), false))
    past.begin()
    past.calls[0].report('gtfs2graph', '114 nodes')
    past.calls[0].reject({
      code: -32000,
      message: 'x',
      data: { kind: 'engine', hint: 'topo failed' },
    })
    await tick()
    expect(asked).toEqual([])
    expect(past.run.snapshot.feedMissing).toBe(false)
  })

  it('ends not knowing, rather than claiming either, when the registry fails', async () => {
    const broken = setup({}, READY, () => Promise.reject(new Error('engine gone')))
    broken.begin()
    broken.calls[0].report('download', 'downloaded 65,536 bytes', 0.1)
    broken.calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    await tick()
    expect(broken.run.snapshot.state).toBe('cancelled')
    expect(broken.run.snapshot.feedMissing).toBeNull()
  })

  it('ends at the deadline, not knowing, when the registry never answers', async () => {
    vi.useFakeTimers()
    try {
      const hung = setup({}, READY, () => new Promise<boolean>(() => undefined))
      hung.begin()
      hung.calls[0].report('download', 'downloaded 65,536 bytes', 0.1)
      hung.calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
      await vi.advanceTimersByTimeAsync(0)
      expect(hung.run.snapshot.state, 'still ending').toBe('running')
      await vi.advanceTimersByTimeAsync(ON_DISK_DEADLINE)
      expect(hung.run.snapshot.state).toBe('cancelled')
      expect(hung.run.snapshot.feedMissing).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('draws a large download at most four times a second, and always its last byte', () => {
    const { run, calls, begin } = setup()
    begin()
    const seen: string[] = []
    run.subscribe((s) => {
      if (s.download !== null && seen[seen.length - 1] !== s.download.message)
        seen.push(s.download.message)
    })
    for (let i = 1; i <= 50; i += 1)
      calls[0].report('download', `downloaded ${i} of 50 bytes`, i / 50)
    expect(seen).toEqual(['downloaded 1 of 50 bytes', 'downloaded 50 of 50 bytes'])
  })

  it('clears the last download when a start is refused', () => {
    const { run, calls, record } = setup()
    run.start(record, READY)
    calls[0].report('download', 'downloaded 65,536 bytes', 0.1)
    calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    return tick().then(() => {
      run.start(record, null)
      expect(run.snapshot.state).toBe('failed')
      expect(run.snapshot.download).toBeNull()
      expect(run.snapshot.feedMissing).toBe(false)
    })
  })

  it('is gone when the next run begins, and a feed on disk never sets it', async () => {
    const { run, calls, begin } = setup()
    begin()
    calls[0].report('download', 'downloaded 65,536 bytes', 0)
    calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    begin()
    expect(run.snapshot.download).toBeNull()
    calls[calls.length - 1].report('gtfs2graph', '114 nodes')
    expect(run.snapshot.download).toBeNull()
  })
})
