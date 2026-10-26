// The run's state machine, against a stub client and a stub bridge. No
// React, no Electron, no engine: the run is a plain object precisely so
// this is possible (.claude/rules/renderer.md).

import { describe, expect, it, vi } from 'vitest'
import {
  LAYOUT_KEPT,
  LayoutRun,
  MAP_KEPT,
  advance,
  freshStages,
  readDiagnostics,
  readableMessage,
  reportOf,
  sentenceFor,
  type RunClient,
} from '../../src/renderer/src/engine/layoutRun'
import {
  ON_DISK_DEADLINE,
  downloading,
  isRedraw,
  isTuningRedraw,
  kindFlags,
  kindOfRun,
  type RunKindOf,
} from '../../src/renderer/src/engine/layoutRun'
import {
  doneSentence,
  drawnSentence,
  optionedSentence,
  recolouredSentence,
  reorderedSentence,
  restyledSentence,
  stoppedSentence,
} from '../../src/renderer/src/LayoutRun'
import { refusedAtStart, stoppedNow, type Seen } from '../../src/renderer/src/panelRelease'
import { linesParams } from '../../src/renderer/src/lineOptions'
import { runAllPlan } from '../../src/renderer/src/runAll'
import {
  OPENING_REDRAW_STOPPED,
  frameFailure,
  processStoppedSentence,
  redrawPageOnOpen,
} from '../../src/renderer/src/notebook/olderPage'
import { styleParams } from '../../src/renderer/src/styleRules'
import { cellOfRun, runGraph } from '../../src/renderer/src/runGraph'
import { LAYOUT_STAGES } from '../../src/shared/layout'
import { cameTooLate, ERROR_CODES, type EngineState } from '../../src/shared/engine'
import { drawnDate, type ProjectRecord } from '../../src/shared/project'
import { drawnOf, sentOf } from '../support/sent'

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

/** What a layout run of this record sends map.build (spec 037): the layout just answered, for a day. */
const sentLaidOut = (record: ProjectRecord, date: string) =>
  sentOf(record, { layout: LAYOUT, made: MADE, date })
/** What a redraw of this record sends: the record's own, for the day its map shows, with its choice. */
const sentFor = (record: ProjectRecord, over: Parameters<typeof sentOf>[1] = {}) =>
  sentOf(record, { date: drawnDate(record) ?? undefined, ...over })

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
  // The store's record, as a run's read answers it: the one handed, until a
  // test says the store holds another (spec 037).
  let held = record
  const read = vi.fn(async (id: string) => (void id, held))
  const run = new LayoutRun({
    client,
    read,
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
    read,
    /** Say the store holds this record from now on. */
    store: (next: ProjectRecord) => {
      held = next
    },
    /** What the store holds now. */
    stored: () => held,
    /** Hold the next read until the test answers or refuses it. */
    hold: () => {
      let answer!: (r: ProjectRecord) => void
      let refuse!: (reason: unknown) => void
      read.mockImplementationOnce(
        () =>
          new Promise<ProjectRecord>((yes, no) => {
            answer = yes
            refuse = no
          }),
      )
      return {
        answer: (r: ProjectRecord) => answer(r),
        refuse: (reason: unknown) => refuse(reason),
      }
    },
    begin: () => run.start(record, engine),
  }
}

/**
 * The layout answered and the day chosen: the map call is next. A run that
 * has only just been started is still reading its record (spec 037), so the
 * read is let answer first.
 */
async function laidOut(calls: Pending[], built = BUILT): Promise<void> {
  if (calls.length === 0) await tick()
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
    await tick()
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
    await tick()
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
    await tick()
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
      sent: sentLaidOut(record, '2026-09-15'),
    })
    expect(run.snapshot).toMatchObject({ state: 'done', forced: true, changed: false })
  })

  it('an ordinary run sends no force', async () => {
    const { calls, begin } = setup()
    begin()
    await tick()
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
    await tick()
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
    await tick()
    expect(calls[0].params).toMatchObject({ force: true, tuning: { merge_distance: 80 } })
  })

  it('sends no tuning, and tells the store none, for a project that never tuned', async () => {
    const { calls, complete, begin } = setup()
    begin()
    await tick()
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
    await tick()
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
    const { calls, complete, begin, record } = setup({ date: '2026-05-04' })
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
      sent: sentLaidOut(record, '2026-05-04'),
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
    await tick()
    expect(none.calls[0].params).toEqual({ key: 'la-metro-rail', mode: 'all', agency: '' })
  })

  it("writes the record once, with the engine's layout id and its window", async () => {
    const { run, calls, complete, begin, record } = setup()
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
      sent: sentLaidOut(record, '2026-09-15'),
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
    await tick()
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
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'running', rebuilt: true, day: '2026-09-12' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'map.build',
      params: { key: 'la-metro-rail', layout: LAYOUT, date: '2026-09-12', out: 'p1' },
    })
    for (const stage of LAYOUT_STAGES) calls[0].report(stage, `${stage} finished`)
    calls[0].resolve({ files: {} })
    await tick()
    expect(completeRebuild).toHaveBeenCalledWith('p1', {
      sent: sentOf(record, { date: '2026-09-12' }),
    })
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
    await tick()
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
    await tick()
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
    await tick()
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
    await tick()
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
    await tick()
    expect(run.snapshot.stages[0].state).toBe('running')
    calls[0].report('gtfs2graph', '114 nodes, 112 edges')
    expect(run.snapshot.stages[0].state).toBe('done')
    expect(run.snapshot.stages[1].state).toBe('running')
    expect(run.snapshot.message).toBe('114 nodes, 112 edges')
  })

  it("ignores the map call repeating the layout's stages", async () => {
    const { run, calls, begin } = setup()
    begin()
    await tick()
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

  it('notifies a subscriber of each change and stops when it unsubscribes', async () => {
    const { run, calls, begin } = setup()
    const seen: string[] = []
    const off = run.subscribe((s) => seen.push(s.state))
    begin()
    await tick()
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
    await tick()
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
    await tick()
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
    await tick()
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
    await tick()
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
    await tick()
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
      read: async () => record,
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
      read: async () => project({ date: '2026-01-01' }),
      complete,
      completeRebuild: async () => ({}),
      completeColors: async () => ({}),
      completeOrder: async () => ({}),
      completeStyle: async () => ({}),
      completeLines: async () => ({}),
      today: () => '2026-09-08',
    })
    run.start(project({ date: '2026-01-01' }), READY)
    await tick()
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
    await tick()
    calls[0].resolve({ files: {} })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'done', rebuilt: true })
    run.start(record, null)
    await tick()
    expect(run.snapshot).toMatchObject({
      state: 'failed',
      rebuilt: false,
      day: null,
      forced: false,
    })
    // And the other way round, after a re-layout stopped with the layout replaced.
    run.start(record, READY, { force: true })
    await tick()
    calls[1].resolve(BUILT)
    await tick()
    run.cancel()
    calls[2].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'cancelled', forced: true, replaced: true })
    run.rebuild(record, null, '2026-09-12')
    await tick()
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

  it('refuses a second run while one is in flight', async () => {
    const { calls, begin, read } = setup()
    begin()
    begin()
    await tick()
    expect(read, 'one read, for the one run').toHaveBeenCalledTimes(1)
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
    expect(completeColors).toHaveBeenCalledWith(
      'p1',
      chosen,
      sentFor(record, { colors: chosen.colors, defaultColor: chosen.defaultColor }),
    )
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
    calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
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
    expect(completeOrder).toHaveBeenCalledWith('p1', chosen, sentFor(record, { lineOrder: chosen }))
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
    calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
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
    expect(completeStyle).toHaveBeenCalledWith(
      'p1',
      { lineWidth: 12 },
      sentFor(record, { style: { lineWidth: 12 } }),
    )
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
    expect(completeStyle).toHaveBeenCalledWith('p1', chosen, sentFor(record, { style: chosen }))
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
    calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
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
    expect(completeLines).toHaveBeenCalledWith('p1', lines, sentFor(record, { lines }))
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
    expect(completeLines).toHaveBeenCalledWith('p1', lines, sentFor(record, { lines }), [
      { id: '0x1', name: 'Alpha' },
    ])
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
    // Mutation: the cancelled error taken for a finished draw - a stopped
    // redraw would then write options the map on disk does not show. Since
    // engine v0.18.0 the cancelled error is the only answer that says the
    // draw stopped; a result is a map drawn (below, "a cancel that came too
    // late").
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
    cancelled.calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
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

// Issue 399: what `refusedAtStart` rests on, against the run itself. A
// redraw that failed, then the same kind refused at its start because the
// engine is restarting: `failed` to `failed` with the kind unmoved, which
// `stoppedNow` does not see and `refusedAtStart` must.
describe('a redraw refused at its start after one of its own kind failed', () => {
  const stored = { layout: LAYOUT, date: '2026-09-15', service: WINDOW }
  type Start = (run: LayoutRun, record: ProjectRecord, engine: EngineState | null) => void
  const kinds: Array<{ name: string; start: Start; own: (s: LayoutRun['snapshot']) => boolean }> = [
    {
      name: 'recolour',
      start: (run, record, engine) =>
        run.recolour(record, engine, { colors: { A: '#ff0000' }, defaultColor: '#00ff00' }),
      own: (s) => s.recoloured && !s.optioned,
    },
    {
      name: 'redrawLines',
      start: (run, record, engine) => run.redrawLines(record, engine, { B: { hidden: true } }),
      own: (s) => s.optioned,
    },
    {
      name: 'reorder',
      start: (run, record, engine) => run.reorder(record, engine, ['B', 'A']),
      own: (s) => s.reordered,
    },
    {
      name: 'restyle',
      start: (run, record, engine) => run.restyle(record, engine, { lineWidth: 12 }),
      own: (s) => s.restyled,
    },
  ]
  for (const { name, start, own } of kinds)
    it(`${name}: refused after its own failure is seen only by refusedAtStart`, async () => {
      // Mutation: `refusedAtStart` answering false - the panels as they were.
      const { run, calls, record } = setup(stored)
      start(run, record, READY)
      await tick()
      calls[0].reject({ code: -32000, message: 'the engine went away' })
      await tick()
      const before = run.snapshot
      expect(before.state).toBe('failed')
      expect(refusedAtStart(run, own, () => start(run, record, null))).toBe(true)
      expect(calls, 'nothing was sent for the refused start').toHaveLength(1)
      const seen = (snapshot: LayoutRun['snapshot']) => ({
        state: snapshot.state,
        own: own(snapshot),
      })
      expect(stoppedNow(seen(before), seen(run.snapshot)), 'which the next render cannot see').toBe(
        false,
      )
    })
})

// Issue 399: a redraw whose map was drawn and whose record the store then
// refused said the map was not drawn. It says what happened now.
describe('a redraw drawn and then not kept', () => {
  const stored = { layout: LAYOUT, date: '2026-09-15', service: WINDOW }
  type Setup = ReturnType<typeof setup>
  const kinds: Array<{
    name: string
    start: (run: LayoutRun, record: ProjectRecord, engine: EngineState | null) => void
    refuse: (setup: Setup) => void
    words: RegExp
  }> = [
    {
      name: 'recolour',
      start: (run, record, engine) =>
        run.recolour(record, engine, { colors: { A: '#ff0000' }, defaultColor: '#00ff00' }),
      refuse: ({ completeColors }) => completeColors.mockRejectedValueOnce(new Error('refused')),
      words:
        /^The map was drawn in those colours, but the project could not keep them\. Nothing was written: it keeps the colours it had/,
    },
    {
      name: 'redrawLines',
      start: (run, record, engine) => run.redrawLines(record, engine, { B: { hidden: true } }),
      refuse: ({ completeLines }) => completeLines.mockRejectedValueOnce(new Error('refused')),
      words:
        /^The map was drawn with those line options, but the project could not keep them\. Nothing was written: it keeps the line options it had/,
    },
    {
      name: 'reorder',
      start: (run, record, engine) => run.reorder(record, engine, ['B', 'A']),
      refuse: ({ completeOrder }) => completeOrder.mockRejectedValueOnce(new Error('refused')),
      words:
        /^The map was drawn in that order, but the project could not keep it\. Nothing was written: it keeps the order it had/,
    },
    {
      name: 'restyle',
      start: (run, record, engine) => run.restyle(record, engine, { lineWidth: 12 }),
      refuse: ({ completeStyle }) => completeStyle.mockRejectedValueOnce(new Error('refused')),
      words:
        /^The map was drawn in those sizes, but the project could not keep them\. Nothing was written: it keeps the sizes it had/,
    },
    {
      name: 'rebuild',
      start: (run, record, engine) => run.rebuild(record, engine, '2026-09-12'),
      refuse: ({ completeRebuild }) =>
        completeRebuild.mockRejectedValueOnce(
          new Error('the feed covers 2026-01-01 to 2026-12-31'),
        ),
      words:
        /^The map was drawn for that day, but the project could not keep it\. Nothing was written: it keeps its day/,
    },
  ]
  const sentence = (snapshot: LayoutRun['snapshot']): string =>
    stoppedSentence(
      snapshot.state,
      snapshot.replaced,
      snapshot.rebuilt,
      snapshot.recoloured,
      snapshot.reordered,
      snapshot.restyled,
      snapshot.optioned,
      snapshot.unkept,
    )

  for (const { name, start, refuse, words } of kinds) {
    it(`${name}: a write refused after the draw says the map was drawn and not kept`, async () => {
      // Mutation: `#failed` not told the map was drawn - the sentence would
      // say the map was not drawn, which is false.
      const made = setup(stored)
      refuse(made)
      start(made.run, made.record, READY)
      await tick()
      made.calls[0].resolve({ files: {} })
      await tick()
      expect(made.run.snapshot).toMatchObject({ state: 'failed', unkept: true })
      expect(sentence(made.run.snapshot)).toMatch(words)
      expect(sentence(made.run.snapshot)).toMatch(/Nothing was written/)
      expect(sentence(made.run.snapshot)).not.toMatch(/was not drawn/)
    })

    it(`${name}: a draw that failed still says the map was not drawn`, async () => {
      // Mutation: `unkept` set for any failure of a redraw.
      const made = setup(stored)
      start(made.run, made.record, READY)
      await tick()
      made.calls[0].reject({ code: -32000, message: 'the stand-in draws nothing' })
      await tick()
      expect(made.run.snapshot).toMatchObject({ state: 'failed', unkept: false })
      expect(sentence(made.run.snapshot)).toMatch(/was not drawn/)
    })
  }

  it('is cleared by the next start, refused or not', async () => {
    // Mutation: `#begin` not clearing it - a start refused while the engine
    // restarts would say the map had been drawn.
    const made = setup(stored)
    made.completeColors.mockRejectedValueOnce(new Error('refused'))
    made.run.recolour(made.record, READY, { colors: { A: '#ff0000' }, defaultColor: '#00ff00' })
    await tick()
    made.calls[0].resolve({ files: {} })
    await tick()
    expect(made.run.snapshot.unkept).toBe(true)
    made.run.recolour(made.record, null, { colors: { A: '#00ff00' }, defaultColor: '#00ff00' })
    await tick()
    expect(made.run.snapshot).toMatchObject({ state: 'failed', unkept: false })
    made.run.recolour(made.record, READY, { colors: { A: '#00ff00' }, defaultColor: '#00ff00' })
    await tick()
    expect(made.run.snapshot).toMatchObject({ state: 'running', unkept: false })
  })

  it('is cleared by a refusal for a project with no layout', async () => {
    // Mutation: a refusal for a missing layout not clearing it.
    const made = setup(stored)
    made.completeOrder.mockRejectedValueOnce(new Error('refused'))
    made.run.reorder(made.record, READY, ['B', 'A'])
    await tick()
    made.calls[0].resolve({ files: {} })
    await tick()
    expect(made.run.snapshot.unkept).toBe(true)
    made.run.reorder({ ...made.record, layout: null }, READY, ['B', 'A'])
    await tick()
    expect(made.run.snapshot).toMatchObject({ state: 'failed', unkept: false })
  })

  it('leaves a layout run’s sentence as it was, which was already true', async () => {
    // A layout run whose map was drawn and whose record was refused: nothing
    // was saved, and the project is as it was.
    const { run, calls, complete, begin } = setup()
    complete.mockRejectedValueOnce(new Error('the project could not be written'))
    begin()
    await laidOut(calls)
    calls[2].resolve(MAP)
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'failed', unkept: false })
    expect(sentence(run.snapshot)).toBe('Nothing was saved. The project is as it was.')
  })

  it('says nothing of its own for a cancel, which never reaches the write', () => {
    expect(stoppedSentence('cancelled', false, false, true, false, false, false, true)).toMatch(
      /^The redraw was cancelled/,
    )
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
    await tick()
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
    await tick()
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
    await tick()
    expect(run.job()?.id).not.toBe(first)
    expect(run.job()?.state).toBe('running')
  })

  it("a failure carries the engine's hint and its detail, both without paths", async () => {
    const { run, calls, begin } = setup()
    begin()
    await tick()
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
    await tick()
    expect(run.job()).toMatchObject({ kind: 'layout', label: 'Re-layout' })
    run.cancel()
    calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    expect(run.job()?.state).toBe('cancelled')
    run.rebuild(record, READY, '2026-09-16')
    await tick()
    expect(run.job()).toMatchObject({ kind: 'rebuild', label: 'Rebuild for 2026-09-16' })
    run.cancel()
    calls[1].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    run.recolour(record, READY, { colors: {}, defaultColor: '#888888' })
    await tick()
    expect(run.job()).toMatchObject({ kind: 'rebuild', label: 'Redraw in new colours' })
    run.cancel()
    calls[2].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    run.reorder(record, READY, ['B', 'A'])
    await tick()
    expect(run.job()).toMatchObject({ kind: 'rebuild', label: 'Redraw in a new line order' })
    run.cancel()
    calls[3].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    run.restyle(record, READY, { lineWidth: 12 })
    await tick()
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
        // Added by issue 399 on purpose: a redraw whose map was drawn and
        // whose record was refused, so cell 02 does not say it was not drawn.
        'unkept',
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
    await tick()
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
    await tick()
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
    await tick()
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
    await tick()
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
    await tick()
    none.calls[0].report('download', 'downloaded 65,536 bytes', 0.1)
    none.calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    expect(none.run.snapshot.feedMissing).toBe(false)

    const asked: string[] = []
    const past = setup({}, READY, async (key) => (asked.push(key), false))
    past.begin()
    await tick()
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
    await tick()
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
      // The read answers in a microtask; the timers are the test's here.
      await vi.advanceTimersByTimeAsync(0)
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

  it('draws a large download at most four times a second, and always its last byte', async () => {
    const { run, calls, begin } = setup()
    begin()
    await tick()
    const seen: string[] = []
    run.subscribe((s) => {
      if (s.download !== null && seen[seen.length - 1] !== s.download.message)
        seen.push(s.download.message)
    })
    for (let i = 1; i <= 50; i += 1)
      calls[0].report('download', `downloaded ${i} of 50 bytes`, i / 50)
    expect(seen).toEqual(['downloaded 1 of 50 bytes', 'downloaded 50 of 50 bytes'])
  })

  it('clears the last download when a start is refused', async () => {
    const { run, calls, record } = setup()
    run.start(record, READY)
    await tick()
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
    await tick()
    calls[0].report('download', 'downloaded 65,536 bytes', 0)
    calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    begin()
    await tick()
    expect(run.snapshot.download).toBeNull()
    calls[calls.length - 1].report('gtfs2graph', '114 nodes')
    expect(run.snapshot.download).toBeNull()
  })
})

// Spec 037 (issues 388, 407). A run reads its record once, at its start,
// from the store (`RunOptions.read`, `projects.get` queued in main behind the
// project's writes), and plans from what the store answers, never from the
// record the screen handed, which may be a render behind: a field committed
// by leaving it for "Lay out", a day still in its debounce, a write the
// store has answered and the screen has not drawn. That the store's answer
// holds every write sent before the read is main's (FR-006) and the
// bridge's (FR-008), held in `projects-store.test.ts`, `ipc.test.ts` and
// `tests/e2e/record-order.spec.ts`; these hold the run's own rules.
describe('a run reads its record from the store, once, at its start', () => {
  it('plans from the record the store answers, not the one handed, and tells the store what it sent', async () => {
    // Mutation: `#readFor` answering the record handed (`start` passing
    // `handed` to `#layOut`) - graph.build goes with LOOM's defaults and the
    // mode the screen held.
    const s = setup({ layout: LAYOUT })
    s.store({ ...s.record, mode: 'subway', agency: 'METRO', tuning: { gridSize: 50 } })
    s.begin()
    expect(s.run.snapshot.state, 'going from the press: Cancel is on the screen').toBe('running')
    expect(s.calls, 'nothing is asked before the record is read').toHaveLength(0)
    s.begin()
    await tick()
    expect(s.read, 'read once, for the one run').toHaveBeenCalledTimes(1)
    expect(s.read).toHaveBeenCalledWith('p1')
    expect(s.calls, 'one run: the second press was refused as any is').toHaveLength(1)
    expect(s.calls[0].params).toEqual({
      key: 'la-metro-rail',
      mode: 'subway',
      agency: 'METRO',
      tuning: { grid_size: 50 },
    })
    await laidOut(s.calls)
    s.calls[2].resolve({ files: {} })
    await tick()
    expect((s.complete.mock.calls[0] as unknown[])[1]).toMatchObject({ tuning: { gridSize: 50 } })
  })

  it('reads once: what the store holds after the run has read it is not what it sends', async () => {
    // A run sends what it was started with (spec 033, FR-007). Mutation: the
    // record read again before map.build - the colours written since go with
    // the map, and the record would say they were drawn from a run that did
    // not choose them.
    const s = setup({ layout: LAYOUT })
    s.begin()
    await tick()
    s.store({ ...s.record, colors: { A: '#ff0000' } })
    await laidOut(s.calls)
    expect(s.read).toHaveBeenCalledTimes(1)
    expect(s.calls[2].params.colors).toEqual({})
  })

  it('a rebuild and each of the four redraws read the same way: map.build in what the store holds', async () => {
    // Mutation: one of them drawing from the record handed - its map.build
    // goes in the colours, order or sizes the screen held.
    const drawn = { layout: LAYOUT, date: '2026-09-15', service: WINDOW }
    const stored = { colors: { A: '#0072bc' }, lineOrder: ['B', 'A'], style: { lineWidth: 11 } }
    const presses: [string, (s: ReturnType<typeof setup>) => void, Record<string, unknown>][] = [
      ['a rebuild', (s) => s.run.rebuild(s.record, READY, '2026-09-12'), {}],
      [
        'a recolour',
        (s) =>
          s.run.recolour(s.record, READY, { colors: { K: '#00ff00' }, defaultColor: '#888888' }),
        { colors: { K: '#00ff00' } },
      ],
      ['a reorder', (s) => s.run.reorder(s.record, READY, ['A']), { line_order: ['A'] }],
      ['a restyle', (s) => s.run.restyle(s.record, READY, { lineWidth: 12 }), {}],
      ['a redraw of the lines', (s) => s.run.redrawLines(s.record, READY, {}), {}],
    ]
    for (const [name, press, own] of presses) {
      const s = setup(drawn)
      s.store({ ...s.record, ...stored })
      press(s)
      expect(s.calls, `${name}: nothing before the read`).toHaveLength(0)
      await tick()
      expect(s.calls[0], name).toMatchObject({
        method: 'map.build',
        params: { layout: LAYOUT, colors: { A: '#0072bc' }, line_order: ['B', 'A'], ...own },
      })
      if (name !== 'a restyle')
        expect(s.calls[0].params.style, `${name}: the stored sizes`).toEqual({ line_width: 11 })
    }
  })

  it('a cancel ends the read at once, and nothing is asked when the store answers after it', async () => {
    // Mutation: `cancel` not waking the read - the run stays running until
    // the store answers, and then draws a run that was cancelled.
    const presses: [string, (s: ReturnType<typeof setup>) => void][] = [
      ['a layout run', (s) => s.begin()],
      ['a rebuild', (s) => s.run.rebuild(s.record, READY, '2026-09-12')],
      ['Run all', (s) => s.run.runAll(s.record, READY, runAllPlan)],
      [
        'a recolour',
        (s) => s.run.recolour(s.record, READY, { colors: {}, defaultColor: '#888888' }),
      ],
    ]
    for (const [name, press] of presses) {
      const s = setup({
        layout: LAYOUT,
        date: '2026-09-15',
        service: WINDOW,
        tuning: { gridSize: 50 },
      })
      const read = s.hold()
      press(s)
      expect(s.run.snapshot.state, name).toBe('running')
      s.run.cancel()
      await tick()
      expect(s.run.snapshot.state, name).toBe('cancelled')
      read.answer(s.record)
      await tick()
      expect(s.calls, `${name}: nothing was asked`).toHaveLength(0)
      expect(s.run.snapshot.state, name).toBe('cancelled')
    }
  })

  it('a read the store refuses fails the run with its sentence, and asks nothing', async () => {
    // Mutation: the read's refusal left unhandled - the run stays running
    // for good, with an unhandled rejection.
    const s = setup({ layout: LAYOUT, date: '2026-09-15', service: WINDOW })
    const read = s.hold()
    s.run.rebuild(s.record, READY, '2026-09-12')
    read.refuse(new Error('not found'))
    await tick()
    expect(s.run.snapshot).toMatchObject({ state: 'failed', rebuilt: true, error: 'not found' })
    expect(s.calls).toHaveLength(0)
  })

  it('a redraw whose record has nothing drawn by the time it is read fails in its own words', () => {
    // The record handed at the press had a map; the store's no longer does.
    const s = setup({ layout: LAYOUT, date: '2026-09-15', service: WINDOW })
    s.store({ ...s.record, layout: null })
    s.run.reorder(s.record, READY, ['A'])
    return tick().then(() => {
      expect(s.run.snapshot).toMatchObject({
        state: 'failed',
        reordered: true,
        error: 'Lay the project out before arranging the lines.',
      })
      expect(s.calls).toHaveLength(0)
    })
  })
})

// Issue 407. Run all chooses its run - a layout, or a rebuild for the
// record's day - and it chooses it from the record the store answers: it is
// going from the press as the press's plan would go, reads as a start does,
// and makes the plan again from the record read, with the run as the press
// found it. `runAllPlan` is the real one, handed in as the header hands it;
// what is held here is which record and which run it is asked about, and
// what is started.
describe('Run all plans again from the record the store answers', () => {
  /** Laid out and drawn for the 15th, and the 12th chosen since: only the day is behind. */
  function dayBehind(over: Partial<ProjectRecord> = {}): ProjectRecord {
    const drawn = project({
      layout: LAYOUT,
      made: MADE,
      built: { mode: 'all', agency: null },
      service: WINDOW,
      date: '2026-09-15',
    })
    return { ...drawn, drawn: drawnOf(drawn), date: '2026-09-12', ...over }
  }

  it('a tuning the store holds makes it a layout, though only the day was behind on the screen', async () => {
    // Mutation: the plan after the read made from the record handed at the
    // press (`planOf(handed, …)` in `runAll`) - a rebuild for the day, and
    // no graph.build, so the tuning waits for one more press.
    const { run, calls, record, complete, store } = setup(dayBehind())
    expect(runAllPlan(record, run.snapshot), 'the plan at the press').toEqual({
      kind: 'rebuild',
      date: '2026-09-12',
    })
    store({ ...record, tuning: { gridSize: 50 } })
    run.runAll(record, READY, runAllPlan)
    // Going from the press as the press's plan would go: cell 03's run.
    expect(run.snapshot).toMatchObject({ state: 'running', rebuilt: true, day: '2026-09-12' })
    expect(run.job()).toMatchObject({ kind: 'rebuild', label: 'Rebuild for 2026-09-12' })
    const job = run.job()?.id
    expect(calls, 'nothing is asked before the record is read').toHaveLength(0)

    await tick()
    expect(calls.map((c) => c.method)).toEqual(['graph.build'])
    expect(calls[0].params.tuning).toEqual({ grid_size: 50 })
    // Now the layout it is, cell 02's, the same job under its own name.
    expect(run.snapshot).toMatchObject({
      state: 'running',
      rebuilt: false,
      forced: false,
      day: null,
    })
    expect(run.job()).toMatchObject({ id: job, kind: 'layout', label: 'Layout run' })

    await laidOut(calls)
    expect(calls[2]).toMatchObject({ method: 'map.build', params: { date: '2026-09-12' } })
    calls[2].resolve({ files: {} })
    await tick()
    expect(run.snapshot.state).toBe('done')
    expect((complete.mock.calls[0] as unknown[])[1]).toMatchObject({
      date: '2026-09-12',
      tuning: { gridSize: 50 },
    })
  })

  it('a day the store holds is the day the rebuild draws and writes', async () => {
    // Mutation: the rebuild started for the day of the plan at the press
    // (`pressed.date` after the read) - the 12th is drawn, and written back
    // over the 20th the person chose.
    const { run, calls, record, completeRebuild, store } = setup(dayBehind())
    store({ ...record, date: '2026-09-20' })
    run.runAll(record, READY, runAllPlan)
    await tick()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'map.build',
      params: { layout: LAYOUT, date: '2026-09-20' },
    })
    expect(run.snapshot).toMatchObject({ rebuilt: true, day: '2026-09-20' })
    expect(run.job()).toMatchObject({ kind: 'rebuild', label: 'Rebuild for 2026-09-20' })
    calls[0].resolve({ files: {} })
    await tick()
    expect(completeRebuild).toHaveBeenCalledWith('p1', {
      sent: sentOf(record, { date: '2026-09-20' }),
    })
  })

  it('with the record as the screen holds it, the plan is the press’s, a turn later', async () => {
    const day = setup(dayBehind())
    day.run.runAll(day.record, READY, runAllPlan)
    expect(day.run.snapshot).toMatchObject({ state: 'running', rebuilt: true, day: '2026-09-12' })
    await tick()
    expect(day.calls.map((c) => c.method)).toEqual(['map.build'])
    expect(day.calls[0].params.date).toBe('2026-09-12')
    expect(day.run.job()).toMatchObject({ kind: 'rebuild', label: 'Rebuild for 2026-09-12' })

    const tuned = setup(dayBehind({ date: '2026-09-15', tuning: { gridSize: 50 } }))
    tuned.run.runAll(tuned.record, READY, runAllPlan)
    await tick()
    expect(tuned.calls.map((c) => c.method)).toEqual(['graph.build'])
    expect(tuned.run.snapshot).toMatchObject({ rebuilt: false, forced: false, day: null })
    expect(tuned.run.job()).toMatchObject({ kind: 'layout', label: 'Layout run' })
  })

  it('is refused in the press’s own turn where the engine cannot run, and reads nothing', () => {
    // Mutation: `runAll` reading before it asks the engine - the refusal
    // waits a turn, and a record is read for a run that cannot go.
    const refused = setup(dayBehind(), null)
    refused.run.runAll(refused.record, null, runAllPlan)
    expect(refused.run.snapshot).toMatchObject({
      state: 'failed',
      rebuilt: true,
      day: '2026-09-12',
      error: 'The engine is still starting. Try again in a moment.',
    })
    expect(refused.read).not.toHaveBeenCalled()
  })

  it('a layout at the press that becomes a rebuild forgets the feed: a cancel then asks the registry nothing', async () => {
    // A mode chosen on the screen, so the press's plan is a layout, and put
    // back in the store, so only the day is behind in the record read. A
    // layout stopped before its first stage asks the registry whether its
    // feed is on disk (issue 178); a rebuild never does. Mutation: the feed
    // kept when the run becomes a rebuild (`this.#feedKey = null` dropped
    // from `runAll`) - the stopped rebuild asks the registry about the feed.
    const onDisk = vi.fn(async () => true)
    const { run, calls, record, store } = setup(dayBehind({ mode: 'subway' }), READY, onDisk)
    expect(runAllPlan(record, run.snapshot), 'the plan at the press').toEqual({ kind: 'layout' })
    store({ ...record, mode: 'all' })
    run.runAll(record, READY, runAllPlan)
    expect(run.snapshot).toMatchObject({ state: 'running', rebuilt: false, day: null })
    expect(run.job()).toMatchObject({ kind: 'layout', label: 'Layout run' })

    await tick()
    expect(calls.map((c) => c.method)).toEqual(['map.build'])
    expect(run.snapshot).toMatchObject({ state: 'running', rebuilt: true, day: '2026-09-12' })
    expect(run.job()).toMatchObject({ kind: 'rebuild', label: 'Rebuild for 2026-09-12' })

    run.cancel()
    calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'cancelled', rebuilt: true, feedMissing: false })
    expect(onDisk, 'the registry is not asked about a rebuild').not.toHaveBeenCalled()
  })

  it('a record that leaves nothing to run puts the run back as it stood: nothing asked, no job ended', async () => {
    // A day chosen and then put back to the one the map shows, the second
    // in the store and not yet on the screen. Mutation: a plan of none after
    // the read taken for the press's plan (`#withdraw` not called) - the
    // run never ends, or draws a day nobody now chose.
    const { run, calls, record, completeRebuild, store } = setup(dayBehind())
    // A run that finished before, so there is a job to go back to.
    run.rebuild(record, READY, '2026-09-12')
    await tick()
    calls[0].resolve({ files: {} })
    await tick()
    const before = run.snapshot
    const job = run.job()
    expect(before.state).toBe('done')
    const ended: string[] = []
    run.subscribe((s) => ended.push(s.state))

    store({ ...record, date: '2026-09-15' })
    run.runAll(record, READY, runAllPlan)
    expect(run.snapshot.state).toBe('running')
    await tick()
    expect(calls, 'only the first rebuild was ever asked').toHaveLength(1)
    expect(completeRebuild).toHaveBeenCalledTimes(1)
    expect(run.snapshot, 'the very snapshot it had').toBe(before)
    expect(run.job(), 'the job it had').toEqual(job)
    expect(ended).toEqual(['running', 'done'])
  })

  it('puts a stopped redraw back as idle, so its panel sees no second stop, and a stopped layout as it was', async () => {
    // A panel puts its control back on the change into its own stop
    // (`stoppedNow`); a stop put back after the press would be a second one.
    // Mutation: `#withdraw` restoring every snapshot as it was (the
    // `stoppedRedraw` branch dropped) - the colours see a stop of their own.
    const redrawn = setup(dayBehind())
    redrawn.run.recolour(redrawn.record, READY, {
      colors: { A: '#0072bc' },
      defaultColor: '#888888',
    })
    await tick()
    redrawn.run.cancel()
    redrawn.calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    expect(redrawn.run.snapshot).toMatchObject({ state: 'cancelled', recoloured: true })
    let seen: Seen = { state: 'cancelled', own: true }
    const stops: string[] = []
    redrawn.run.subscribe((s) => {
      const now = { state: s.state, own: s.recoloured }
      if (stoppedNow(seen, now)) stops.push(s.state)
      seen = now
    })
    redrawn.store({ ...redrawn.record, date: '2026-09-15' })
    redrawn.run.runAll(redrawn.record, READY, runAllPlan)
    await tick()
    expect(stops, 'no stop of the colours’ own').toEqual([])
    expect(redrawn.run.snapshot).toMatchObject({
      state: 'idle',
      recoloured: false,
      error: null,
      report: null,
    })

    // A stopped layout run has no panel to put back, and is restored as it was.
    const laid = setup(dayBehind())
    laid.run.start(laid.record, READY)
    await tick()
    laid.run.cancel()
    laid.calls[0].resolve(BUILT)
    await tick()
    const stopped = laid.run.snapshot
    expect(stopped.state).toBe('cancelled')
    laid.store({ ...laid.record, date: '2026-09-15' })
    laid.run.runAll(laid.record, READY, runAllPlan)
    await tick()
    expect(laid.run.snapshot).toBe(stopped)
  })
})

// Issue 407. Cell 03's day is written a beat after it is picked, so a press
// on "Lay out again" or Run all in that beat would read a record without it,
// and draw the day before. A control holding a choice back hears the press
// first (`beforeStart`) and sends it, before the run reads its record, so
// the store answers the read with it (spec 037).
describe('a press tells what holds a choice back, before it reads the record', () => {
  /** Laid out and drawn for the 15th, and nothing behind. */
  function drawn(): ProjectRecord {
    const record = project({
      layout: LAYOUT,
      made: MADE,
      built: { mode: 'all', agency: null },
      service: WINDOW,
      date: '2026-09-15',
    })
    return { ...record, drawn: drawnOf(record) }
  }

  it('a write sent as the press is heard goes before the read, for a layout run, a rebuild and Run all', async () => {
    // Mutation: the listeners told after the record is read, or not at all
    // (`#pressed()` in `start`, `rebuild` or `runAll`) - the read goes first,
    // and the run draws the 15th.
    const presses: [string, (run: LayoutRun, record: ProjectRecord) => void][] = [
      ['a layout run', (run, record) => run.start(record, READY)],
      ['a rebuild', (run, record) => run.rebuild(record, READY, '2026-09-20')],
      ['Run all', (run, record) => run.runAll(record, READY, runAllPlan)],
    ]
    for (const [name, press] of presses) {
      const s = setup(drawn())
      const order: string[] = []
      s.read.mockImplementation(async () => {
        order.push('read')
        return s.stored()
      })
      // The day's flush: a write sent at once, which the store then holds.
      s.run.beforeStart(() => {
        order.push('write')
        s.store({ ...s.record, date: '2026-09-20' })
      })
      press(s.run, s.record)
      expect(order, name).toEqual(['write', 'read'])
      await tick()
      if (s.calls[0].method === 'graph.build') await laidOut(s.calls)
      const map = s.calls.find((c) => c.method === 'map.build')
      expect(map?.params.date, `${name} draws the day`).toBe('2026-09-20')
    }
  })

  it('tells a redraw too, but not a refused second press, nor once the listener has gone', async () => {
    // Mutation: the listener left in place by the function `beforeStart`
    // answers - it is told of the press after it was taken away.
    const { run, calls, record } = setup(drawn())
    const heard = vi.fn()
    const off = run.beforeStart(heard)
    run.recolour(record, READY, { colors: { A: '#0072bc' }, defaultColor: '#888888' })
    expect(heard, 'a redraw is a press like any other (spec 037)').toHaveBeenCalledTimes(1)
    run.start(record, READY)
    expect(heard, 'refused: a run is going').toHaveBeenCalledTimes(1)
    await tick()
    run.cancel()
    calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    expect(run.snapshot.state).toBe('cancelled')
    run.start(record, READY)
    expect(heard, 'told of a press while it listens').toHaveBeenCalledTimes(2)
    await tick()
    run.cancel()
    calls[1].resolve(BUILT)
    await tick()
    expect(run.snapshot.state).toBe('cancelled')
    off()
    run.start(record, READY)
    expect(run.snapshot.state, 'started').toBe('running')
    expect(heard, 'and not once it has gone').toHaveBeenCalledTimes(2)
  })

  it('a day held back when a redraw of a record with no drawn block starts is the day it draws', async () => {
    // A record from before `drawn` was kept draws its own day on a redraw
    // (`drawnDate`), and the store takes the completion only for that day.
    // Mutation: `#redraw` without `this.#pressed()` - the redraw reads the
    // 15th, draws it, and its completion names a day the record no longer
    // holds once the 20th lands, which the store refuses after the map is
    // drawn.
    const s = setup({ layout: LAYOUT, made: MADE, date: '2026-09-15', service: WINDOW })
    expect(s.record.drawn).toBeNull()
    // The day's flush: a write sent at once, which the store then holds.
    s.run.beforeStart(() => s.store({ ...s.record, date: '2026-09-20' }))
    const palette = { colors: { A: '#0072bc' }, defaultColor: '#888888' }
    s.run.recolour(s.record, READY, palette)
    await tick()
    expect(s.calls[0]).toMatchObject({ method: 'map.build', params: { date: '2026-09-20' } })
    s.calls[0].resolve({ files: {} })
    await tick()
    expect(s.run.snapshot.state).toBe('done')
    const sent = (s.completeColors.mock.calls[0] as unknown[])[2] as { date: string }
    expect(sent.date, 'the day the store will take, as the day drawn').toBe('2026-09-20')
    expect(drawnDate(s.stored()), 'the record’s own day').toBe(sent.date)
  })
})

// Engine v0.18.0 (its issue 80). A cancel that reaches a call after its point
// of no return is answered with the call's result, carrying
// `cancel_too_late`, over what the result names, written; the cancelled error
// means nothing a client sees was written. So a map call's result is a map
// on disk whoever pressed Cancel: every path that draws - a layout, a
// rebuild, Run all, the four redraws, all through `#draw` - writes the
// record from it and finishes, and says the map is kept where the result
// says the cancel came too late. A layout call's result is a stored layout:
// the run stops there, before the day is asked for, and says so.
describe('a cancel that came too late', () => {
  const stored = { layout: LAYOUT, date: '2026-09-15', service: WINDOW }
  const late = (answer: object): object => ({ ...answer, cancel_too_late: true })

  it('reads the field as data: only true says the cancel came too late', () => {
    expect(cameTooLate({ cancel_too_late: true })).toBe(true)
    for (const answer of [
      { cancel_too_late: 'true' },
      { cancel_too_late: 1 },
      { cancel_too_late: false },
      {},
      null,
      'cancel_too_late',
    ])
      expect(cameTooLate(answer), JSON.stringify(answer)).toBe(false)
  })

  it('a layout run whose map call answers too late writes the record and finishes, the map kept', async () => {
    // Mutation: the cancel looked at again after the draw (`if
    // (this.#cancelled) return this.#stopped()` after `#draw` in `#layOut`)
    // - the run then ends cancelled over a map on disk, with no record.
    const { run, calls, complete, begin } = setup()
    begin()
    await laidOut(calls)
    run.cancel()
    expect(calls[2].method).toBe('map.build')
    expect(calls[2].cancelled, 'the map call was asked to stop').toBe(true)
    calls[2].resolve(late(MAP))
    await tick()
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledWith('p1', expect.objectContaining({ layout: LAYOUT }))
    expect(run.snapshot).toMatchObject({ state: 'done', message: MAP_KEPT })
    expect(run.snapshot.report, 'the figures of the map that was drawn').not.toBeNull()
    expect(run.job()?.message, 'and the inspector says it too').toBe(MAP_KEPT)
  })

  it('a rebuild whose map call answers too late writes the day and finishes', async () => {
    // Mutation: the cancel looked at again after the draw in `#drawDay`.
    const { run, calls, completeRebuild, record } = setup(stored)
    run.rebuild(record, READY, '2026-09-12')
    await tick()
    run.cancel()
    calls[0].resolve(late(MAP))
    await tick()
    expect(completeRebuild).toHaveBeenCalledWith('p1', {
      sent: sentOf(record, { date: '2026-09-12' }),
    })
    expect(run.snapshot).toMatchObject({ state: 'done', rebuilt: true, message: MAP_KEPT })
  })

  it('Run all’s rebuild whose map call answers too late writes the day and finishes', async () => {
    // Run all draws through `#drawDay` as a rebuild does. Mutation: as above.
    const drawn = project({
      layout: LAYOUT,
      made: MADE,
      built: { mode: 'all', agency: null },
      service: WINDOW,
      date: '2026-09-15',
    })
    const { run, calls, completeRebuild, record } = setup({
      ...drawn,
      drawn: drawnOf(drawn),
      date: '2026-09-12',
    })
    expect(runAllPlan(record, run.snapshot)).toEqual({ kind: 'rebuild', date: '2026-09-12' })
    run.runAll(record, READY, runAllPlan)
    await tick()
    run.cancel()
    calls[0].resolve(late(MAP))
    await tick()
    expect(completeRebuild).toHaveBeenCalledWith('p1', {
      sent: sentOf(record, { date: '2026-09-12' }),
    })
    expect(run.snapshot).toMatchObject({ state: 'done', rebuilt: true, message: MAP_KEPT })
  })

  it('each of the four redraws whose map call answers too late writes what it drew, and says the map is kept', async () => {
    // Mutation: the cancel looked at again after the draw in any one of
    // `recolour`, `reorder`, `restyle` and `redrawLines` - that redraw then
    // ends cancelled, its choice unwritten over a map on disk drawn with it.
    const palette = { colors: { A: '#ff0000' }, defaultColor: '#00ff00' }
    const order = ['B', 'A']
    const style = { lineWidth: 12 }
    const lines = { A: { name: 'Alpha' } }
    const redraws = [
      {
        name: 'recolour',
        press: (s: ReturnType<typeof setup>) => s.run.recolour(s.record, READY, palette),
        written: (s: ReturnType<typeof setup>) => s.completeColors,
        value: palette,
        kind: { recoloured: true },
      },
      {
        name: 'reorder',
        press: (s: ReturnType<typeof setup>) => s.run.reorder(s.record, READY, order),
        written: (s: ReturnType<typeof setup>) => s.completeOrder,
        value: order,
        kind: { reordered: true },
      },
      {
        name: 'restyle',
        press: (s: ReturnType<typeof setup>) => s.run.restyle(s.record, READY, style),
        written: (s: ReturnType<typeof setup>) => s.completeStyle,
        value: style,
        kind: { restyled: true },
      },
      {
        name: 'redrawLines',
        press: (s: ReturnType<typeof setup>) => s.run.redrawLines(s.record, READY, lines),
        written: (s: ReturnType<typeof setup>) => s.completeLines,
        value: lines,
        kind: { recoloured: true, optioned: true },
      },
    ]
    for (const redraw of redraws) {
      const s = setup(stored)
      redraw.press(s)
      await tick()
      s.run.cancel()
      expect(s.calls[0].cancelled, `${redraw.name}: the map call was asked to stop`).toBe(true)
      s.calls[0].resolve(late({ files: {} }))
      await tick()
      expect(redraw.written(s), redraw.name).toHaveBeenCalledWith(
        'p1',
        redraw.value,
        expect.objectContaining({ layout: LAYOUT }),
      )
      expect(s.run.snapshot, redraw.name).toMatchObject({
        state: 'done',
        message: MAP_KEPT,
        ...redraw.kind,
      })
    }
  })

  it('a map call that answers a result without the field after a cancel is a finished draw, in the ordinary words', async () => {
    // The cancel reached the engine after it had answered, so the engine
    // never saw it: the map is on disk all the same, and the result is what
    // says so, not the order the press and the answer came in. Mutation: the
    // cancel looked at again after the draw in `recolour`.
    const { run, calls, completeColors, record } = setup(stored)
    const palette = { colors: { A: '#ff0000' }, defaultColor: '#00ff00' }
    run.recolour(record, READY, palette)
    await tick()
    run.cancel()
    calls[0].resolve({ files: {} })
    await tick()
    expect(completeColors).toHaveBeenCalledWith('p1', palette, expect.objectContaining(palette))
    expect(run.snapshot.state).toBe('done')
    expect(run.snapshot.message, 'no cancel came too late as far as the engine knows').not.toBe(
      MAP_KEPT,
    )
  })

  it('a layout call that answers too late stops the run there, asks nothing more, and says the next run draws from it', async () => {
    // Mutation: the field not read (`cameTooLate(built)` taken as false in
    // `#layOut`) - the run then says nothing of the layout the engine kept.
    // And the words themselves, which the cell shows above "The run was
    // cancelled. The project is as it was.": a sentence saying the layout
    // "is kept" read there as a second, contrary answer.
    const { run, calls, complete, begin } = setup()
    begin()
    await tick()
    run.cancel()
    expect(calls[0].cancelled).toBe(true)
    calls[0].resolve(late(BUILT))
    await tick()
    expect(calls, 'neither the day nor the map is asked for').toHaveLength(1)
    expect(complete).not.toHaveBeenCalled()
    expect(run.snapshot).toMatchObject({
      state: 'cancelled',
      message: LAYOUT_KEPT,
      layout: LAYOUT,
      replaced: false,
    })
    expect(run.snapshot.message).toBe(
      'The layout was already made when you cancelled; the next run draws from it.',
    )
    expect(run.job()?.message, 'the inspector says the same').toBe(run.snapshot.message)
  })

  it('a forced layout call that answers too late is a replaced layout, and says the next run draws from it', async () => {
    const { run, calls, record } = setup({ layout: LAYOUT })
    run.start(record, READY, { force: true })
    await tick()
    run.cancel()
    calls[0].resolve(late(BUILT))
    await tick()
    expect(calls).toHaveLength(1)
    expect(run.snapshot).toMatchObject({
      state: 'cancelled',
      forced: true,
      replaced: true,
      message: LAYOUT_KEPT,
    })
  })

  it('a layout call that answers without the field after a cancel stops there in the ordinary words', async () => {
    const { run, calls, begin } = setup()
    begin()
    await tick()
    run.cancel()
    calls[0].resolve(BUILT)
    await tick()
    expect(calls).toHaveLength(1)
    expect(run.snapshot.state).toBe('cancelled')
    expect(run.snapshot.message).not.toBe(LAYOUT_KEPT)
  })
})

describe("a run's kind is one union, and the flags are derived from it (issue 429)", () => {
  const kinds: RunKindOf[] = [
    { kind: 'layout', forced: false },
    { kind: 'layout', forced: true },
    { kind: 'rebuild', day: '2026-09-12' },
    { kind: 'colours', day: '2026-09-12' },
    { kind: 'options', day: '2026-09-12' },
    { kind: 'order', day: '2026-09-12' },
    { kind: 'sizes', day: '2026-09-12' },
  ]
  it('reads back the kind it was written from', () => {
    for (const kind of kinds) expect(kindOfRun(kindFlags(kind)), kind.kind).toEqual(kind)
  })
  it('sets exactly the flags the readers have always read', () => {
    expect(kindFlags({ kind: 'options', day: 'd' })).toEqual({
      forced: false,
      rebuilt: false,
      recoloured: true,
      optioned: true,
      reordered: false,
      restyled: false,
      day: 'd',
    })
  })
  it('answers "is this a redraw?" once: a day counts, a tuning redraw excludes it', () => {
    expect(kinds.map((k) => isRedraw(kindFlags(k)))).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
      true,
    ])
    expect(kinds.map((k) => isTuningRedraw(kindFlags(k)))).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
      true,
    ])
  })
})

// User Story 1's matrix at the run (spec 037, SC-001): every kind of run
// hands its completion what its map.build was sent - the same values the
// request was built from, from the record it read at its start - whatever
// the store holds by the time it finishes. `projects-store.test.ts` holds
// the other half: `drawn` is made from that and nothing else.
describe('what each run tells the store it sent', () => {
  /** Drawn for the 15th, with a choice of its own in every field a draw sends. */
  const chosen = (): ProjectRecord => {
    const record = project({
      layout: LAYOUT,
      made: MADE,
      built: { mode: 'all', agency: null },
      service: WINDOW,
      date: '2026-09-15',
      colors: { A: '#0072bc' },
      defaultColor: '#123456',
      lineOrder: ['B', 'A'],
      style: { lineWidth: 11 },
      lines: { A: { name: 'Airport' } },
    })
    return { ...record, drawn: drawnOf(record) }
  }
  /** Every field a draw sends, chosen otherwise: a write landing while the run went. */
  const meanwhile = (record: ProjectRecord): ProjectRecord => ({
    ...record,
    date: '2026-09-20',
    colors: { K: '#ff0000' },
    defaultColor: '#654321',
    lineOrder: ['K'],
    style: { lineWidth: 9 },
    lines: { B: { hidden: true } },
    tuning: { gridSize: 50 },
  })

  const RUNS: {
    kind: string
    press: (s: ReturnType<typeof setup>) => void
    sent: (s: ReturnType<typeof setup>) => unknown
    over: (record: ProjectRecord) => Parameters<typeof sentOf>[1]
  }[] = [
    {
      kind: 'layout',
      press: (s) => s.begin(),
      sent: (s) => (s.complete.mock.calls[0] as unknown[])[1],
      over: () => ({ layout: LAYOUT, made: MADE, date: '2026-09-15' }),
    },
    {
      kind: 'rebuild',
      press: (s) => s.run.rebuild(s.record, READY, '2026-09-12'),
      sent: (s) => (s.completeRebuild.mock.calls[0] as unknown[])[1],
      over: () => ({ date: '2026-09-12' }),
    },
    {
      kind: 'Run all',
      press: (s) => s.run.runAll({ ...s.record, date: '2026-09-12' }, READY, runAllPlan),
      sent: (s) => (s.completeRebuild.mock.calls[0] as unknown[])[1],
      over: () => ({ date: '2026-09-12' }),
    },
    {
      kind: 'colours',
      press: (s) =>
        s.run.recolour(s.record, READY, { colors: { C: '#00ff00' }, defaultColor: '#000000' }),
      sent: (s) => (s.completeColors.mock.calls[0] as unknown[])[2],
      over: (r) => ({
        date: drawnDate(r) ?? '',
        colors: { C: '#00ff00' },
        defaultColor: '#000000',
      }),
    },
    {
      kind: 'order',
      press: (s) => s.run.reorder(s.record, READY, ['A', 'B']),
      sent: (s) => (s.completeOrder.mock.calls[0] as unknown[])[2],
      over: (r) => ({ date: drawnDate(r) ?? '', lineOrder: ['A', 'B'] }),
    },
    {
      kind: 'sizes',
      press: (s) => s.run.restyle(s.record, READY, { lineWidth: 12 }),
      sent: (s) => (s.completeStyle.mock.calls[0] as unknown[])[2],
      over: (r) => ({ date: drawnDate(r) ?? '', style: { lineWidth: 12 } }),
    },
    {
      kind: 'options',
      press: (s) => s.run.redrawLines(s.record, READY, { A: { hidden: true } }),
      sent: (s) => (s.completeLines.mock.calls[0] as unknown[])[2],
      over: (r) => ({ date: drawnDate(r) ?? '', lines: { A: { hidden: true } } }),
    },
  ]

  for (const run of RUNS)
    it(`${run.kind}: what map.build was sent, with every field written while it drew`, async () => {
      // Mutation: `#draw` building the sent set from the record as it stood
      // after the draw (a read again before the completion), or from the
      // record handed at the press - the fields written meanwhile, or the
      // run's own choice, are then in what the store is told was drawn.
      const s = setup(chosen())
      // The store holds what the screen does not yet: another default colour
      // and another order, which the run must send rather than the screen's.
      const stored = { ...s.record, defaultColor: '#abcdef', lineOrder: ['A', 'B', 'K'] }
      s.store(run.kind === 'Run all' ? { ...stored, date: '2026-09-12' } : stored)
      const read = s.stored()
      run.press(s)
      await tick()
      // Everything a draw sends is written otherwise while the run goes.
      s.store(meanwhile(read))
      if (s.calls[0].method === 'graph.build') await laidOut(s.calls)
      const map = s.calls.find((c) => c.method === 'map.build')
      expect(map, 'the map was asked for').toBeDefined()
      map?.resolve({ files: {} })
      await tick()
      expect(s.run.snapshot.state).toBe('done')
      const sent = run.sent(s) as Record<string, unknown> & { sent?: unknown }
      const set = (sent.sent ?? sent) as ReturnType<typeof sentOf>
      expect(set, 'the record it read, with its own choice').toEqual(sentOf(read, run.over(read)))
      // And it is what the request carried, field by field.
      const params = map?.params as Record<string, unknown>
      expect(params.layout).toBe(set.layout)
      expect(params.date).toBe(set.date)
      expect(params.colors).toEqual(set.colors)
      expect(params.default_color).toBe(set.defaultColor)
      expect(params.line_order ?? []).toEqual(set.lineOrder)
      expect({ style: params.style, lines: params.lines }).toEqual({
        style: styleParams(set.style).style,
        lines: linesParams(set.lines).lines,
      })
    })
})

// The redraw a project's opening makes of a page an older engine drew (issue
// 465), as the run sees it. It goes through Run all, so the day it draws is
// the record's as the run reads it from the store (issue 407, spec 037):
// cell 03 holds a day a person picked for a moment before writing it, and a
// start flushes that write first, before the read.
describe('the redraw of an older page as its project opens', () => {
  /** Laid out and drawn for the 15th, the record's day the same: an older page's project. */
  function drawnFor15(): ProjectRecord {
    const laid = project({
      layout: LAYOUT,
      made: MADE,
      built: { mode: 'all', agency: null },
      service: WINDOW,
      date: '2026-09-15',
    })
    return { ...laid, drawn: drawnOf(laid) }
  }
  // Older by its seam, and, since its record names no engine, by version too
  // (issue 494).
  const OLDER = { older: true, running: '0.19.0', drawnHere: 0 }
  const screen = (record: ProjectRecord) => ({ ...record, readOnly: false })

  it('is cell 03’s rebuild for the day the map shows, its job, its line and its sentence', async () => {
    const opened = setup(drawnFor15())
    redrawPageOnOpen(opened.run, screen(opened.record), READY, OLDER)
    const pressed = setup(drawnFor15())
    pressed.run.rebuild(pressed.record, READY, '2026-09-15')
    // Each reads its record first (spec 037).
    await tick()
    for (const { run, calls } of [opened, pressed]) {
      expect(calls.map((c) => c.method)).toEqual(['map.build'])
      expect(calls[0].params).toMatchObject({ layout: LAYOUT, date: '2026-09-15' })
      expect(run.job()).toMatchObject({ kind: 'rebuild', label: 'Rebuild for 2026-09-15' })
      calls[0].resolve({ files: {} })
    }
    await tick()
    // The same job but for its own id and its clock.
    const timeless = (run: LayoutRun) => ({ ...run.job()!, id: null, started: 0, ended: 0 })
    expect(timeless(opened.run), 'the same job').toEqual(timeless(pressed.run))
    expect(opened.run.snapshot, 'the same run, done').toEqual(pressed.run.snapshot)
    expect(opened.run.snapshot).toMatchObject({ state: 'done', rebuilt: true, day: '2026-09-15' })
    // Its write is the rebuild's own: what the map was sent, for the day it
    // already was, as cell 03's rebuild writes it.
    expect(opened.completeRebuild).toHaveBeenCalledWith('p1', {
      sent: sentOf(opened.record, { date: '2026-09-15' }),
    })
    expect(opened.completeRebuild.mock.calls[0]).toEqual(pressed.completeRebuild.mock.calls[0])
  })

  it('draws nothing, and writes no day back, over a day chosen just before it', async () => {
    // Mutation: the redraw started as cell 03's rebuild for the day the
    // screen held (`run.rebuild(project, engine, now.date)`, as it first was)
    // - it waits for the flushed write and then draws the 15th, and
    // `completeRebuild` writes the 15th back over the 20th just chosen.
    const { run, calls, record, completeRebuild, store } = setup(drawnFor15())
    // Cell 03's held day, flushed by the start as `ServiceDay` flushes it:
    // sent before the run's read, so the store answers the read with it.
    run.beforeStart(() => store({ ...record, date: '2026-09-20' }))
    const before = run.snapshot
    redrawPageOnOpen(run, screen(record), READY, OLDER)
    await tick()
    await tick()
    expect(calls, 'nothing was drawn').toHaveLength(0)
    expect(completeRebuild, 'and no day was written').not.toHaveBeenCalled()
    expect(run.snapshot, 'the run is as it was before').toBe(before)
    expect(run.job(), 'and no job is left').toBeNull()
  })

  it('draws nothing over a day whose write was already on its way when it was asked for', async () => {
    // The other order: the day was sent before the redraw was asked for, not
    // flushed by its start. Mutation: the redraw started as cell 03's rebuild
    // for the day the screen held - it waits for the write in flight and
    // then draws the 15th over the 20th.
    const { run, calls, record, completeRebuild, store } = setup(drawnFor15())
    // Sent before the redraw was asked for: in the store's queue, ahead of
    // the run's read, while the screen still holds the 15th.
    store({ ...record, date: '2026-09-20' })
    const before = run.snapshot
    redrawPageOnOpen(run, screen(record), READY, OLDER)
    await tick()
    await tick()
    expect(calls, 'nothing was drawn').toHaveLength(0)
    expect(completeRebuild, 'and no day was written').not.toHaveBeenCalled()
    expect(run.snapshot, 'the run is as it was before').toBe(before)
    expect(run.job(), 'and no job is left').toBeNull()
  })

  it('answers the job it started, so cell 03 can tell its failure later', async () => {
    // Mutation: `redrawPageOnOpen` answers null - cell 03 never learns which
    // job was the opening's, and says nothing of the failure.
    const { run, calls } = setup(drawnFor15())
    const asked = redrawPageOnOpen(run, screen(drawnFor15()), READY, OLDER)
    expect(asked, 'a job was started').not.toBeNull()
    expect(asked, 'and it is the run’s latest').toBe(run.job()?.id)
    await tick()
    calls[0].resolve({ files: {} })
    await tick()
    expect(run.job()?.id, 'the same job, done').toBe(asked)
  })

  it('answers no job where the press started none of its own', async () => {
    // Mutation: the job read only after the press, not compared with the one
    // before it - a run already going is answered as the opening's.
    const { run, record } = setup(drawnFor15())
    run.rebuild(record, READY, '2026-09-15')
    const going = run.job()?.id
    expect(going).toBeTruthy()
    expect(redrawPageOnOpen(run, screen(record), READY, OLDER)).toBeNull()
    expect(run.job()?.id, 'the run going is untouched').toBe(going)
  })

  it('that fails is cell 03’s own failure, the cells under it behind it', async () => {
    // What a failed redraw on open shows: a failed rebuild, in cell 03, which
    // since issue 517 says it was the opening's in words of its own.
    const { run, calls, record, completeRebuild } = setup(drawnFor15())
    const asked = redrawPageOnOpen(run, screen(record), READY, OLDER)
    await tick()
    calls[0].reject(new Error('la-metro-rail has no stored layout cccccccc'))
    await tick()
    expect(run.snapshot).toMatchObject({
      state: 'failed',
      rebuilt: true,
      day: '2026-09-15',
      error: 'la-metro-rail has no stored layout cccccccc',
    })
    expect(run.job()).toMatchObject({ kind: 'rebuild', state: 'failed' })
    expect(completeRebuild).not.toHaveBeenCalled()
    expect(cellOfRun(run.snapshot)).toBe('frame')
    // Cell 03's words for it, with the engine's reason (issue 517).
    const failure = frameFailure({
      asked,
      job: run.job()?.id ?? null,
      run: run.snapshot,
      seams: [],
    })
    expect(failure).toEqual({
      kind: 'opening',
      reason: 'la-metro-rail has no stored layout cccccccc',
      lacks: { theme: true, trip: true },
    })
    // Cell 02's run panel points at cell 03 instead of the stopped sentence a
    // rebuild a person pressed for gets, which was written for a press.
    expect(
      processStoppedSentence(
        failure,
        stoppedSentence(run.snapshot.state, run.snapshot.replaced, run.snapshot.rebuilt),
      ),
    ).toBe(OPENING_REDRAW_STOPPED)
    const cells = runGraph({ record, run: run.snapshot, exportRun: null })
    expect(cells.frame).toEqual({ state: 'error', because: 'failed' })
    for (const cell of ['style', 'lines', 'export'] as const)
      expect(cells[cell], cell).toEqual({ state: 'stale', because: 'upstream' })
    for (const cell of ['data', 'process'] as const)
      expect(cells[cell], cell).toEqual({ state: 'ready', because: null })
  })

  it('that fails and is tried again by Run all is said plainly, and cell 02 keeps its own words', async () => {
    // Mutation: `frameFailure` not comparing the job - the retry, a press of
    // a person's, is told it was the opening's, and cell 02 says the map was
    // not redrawn as the project opened.
    const { run, calls, record } = setup(drawnFor15())
    const asked = redrawPageOnOpen(run, screen(record), READY, OLDER)
    await tick()
    calls[0].reject(new Error('la-metro-rail has no stored layout cccccccc'))
    await tick()
    // Cell 03 is in error, so Run all offers the rebuild again.
    run.runAll(record, READY, runAllPlan)
    await tick()
    expect(calls).toHaveLength(2)
    calls[1].reject(new Error('la-metro-rail has no stored layout cccccccc'))
    await tick()
    expect(run.job()?.id, 'a job of its own').not.toBe(asked)
    const failure = frameFailure({
      asked,
      job: run.job()?.id ?? null,
      run: run.snapshot,
      seams: [],
    })
    expect(failure).toEqual({
      kind: 'rebuild',
      reason: 'la-metro-rail has no stored layout cccccccc',
      day: '2026-09-15',
    })
    const ordinary = stoppedSentence(
      run.snapshot.state,
      run.snapshot.replaced,
      run.snapshot.rebuilt,
    )
    expect(processStoppedSentence(failure, ordinary)).toBe(
      'The map was not drawn for that day. The project keeps its day; the map on screen may be the old one until the next build.',
    )
  })

  it('that withdraws answers a job no failure is ever told it was', async () => {
    // A press that withdraws puts the run's attempt back after the press has
    // answered its id (`redrawPageOnOpen`'s doc). Mutation: `frameFailure`
    // taking any failure under a screen that asked for a redraw as the
    // opening's - the person's own rebuild after the withdrawal is told so.
    const { run, calls, record, store } = setup(drawnFor15())
    run.beforeStart(() => store({ ...record, date: '2026-09-20' }))
    const asked = redrawPageOnOpen(run, screen(record), READY, OLDER)
    expect(asked, 'the press opened a job').not.toBeNull()
    await tick()
    await tick()
    expect(calls, 'and withdrew: nothing was drawn').toHaveLength(0)
    expect(run.job(), 'the attempt is put back as it was').toBeNull()
    // The person draws the day they chose, and it fails.
    run.rebuild({ ...record, date: '2026-09-20' }, READY, '2026-09-20')
    await tick()
    calls[0].reject(new Error('la-metro-rail has no stored layout cccccccc'))
    await tick()
    expect(run.job()?.id).not.toBe(asked)
    expect(
      frameFailure({ asked, job: run.job()?.id ?? null, run: run.snapshot, seams: [] }),
    ).toMatchObject({ kind: 'rebuild', day: '2026-09-20' })
  })
})
