// The layout as it solves (issue 382, specs/032): cell 01's stage view draws
// each stage of a layout run as the engine reports it. What can be held
// without React or Electron is here, a section per decision of the spec: the
// run's snapshot naming its layout, the cache's identity while a run is in
// flight, and the view's own pure parts.

import { describe, expect, it, vi } from 'vitest'
import { LayoutRun, type RunClient } from '../../src/renderer/src/engine/layoutRun'
import { ERROR_CODES, type EngineState } from '../../src/shared/engine'
import type { ProjectRecord } from '../../src/shared/project'

// ------------------------------------------------------------ the snapshot

type Report = { stage: string; message: string; fraction?: number; layout?: string }

interface Pending {
  method: string
  params: Record<string, unknown>
  report(p: Report): void
  resolve(value: unknown): void
  reject(error: unknown): void
}

type AnyHandle = ReturnType<RunClient['request']>

/** A client whose requests a test answers, and whose reports carry what the test hands them. */
function stubClient(): { client: RunClient; calls: Pending[] } {
  const calls: Pending[] = []
  const client: RunClient = {
    request(method, params: unknown) {
      const listeners: ((p: Report) => void)[] = []
      let settle!: (v: unknown) => void
      let fail!: (e: unknown) => void
      const result = new Promise<unknown>((res, rej) => {
        settle = res
        fail = rej
      })
      calls.push({
        method,
        params: params as Record<string, unknown>,
        report: (p) => listeners.forEach((l) => l(p)),
        resolve: settle,
        reject: fail,
      })
      return {
        result,
        onProgress: (listener: (p: Report) => void) => {
          listeners.push(listener)
          return () => {}
        },
        cancel: () => {},
      } as unknown as AnyHandle
    },
  }
  return { client, calls }
}

const LAYOUT = 'c'.repeat(64)
const OTHER = 'd'.repeat(64)
const READY: EngineState = { state: 'ready', version: '0.14.0', protocol: 1 }
const BUILT = {
  layout: LAYOUT,
  paths: {},
  meta: { made: '2026-10-09T12:00:00+00:00', mode: 'all', agency: null },
  stages: { octi: { lines: ['A', 'B'] } },
}
const SERVICE = {
  start: '2026-01-01',
  end: '2026-12-31',
  busiest_weekday: '2026-09-15',
  anchor: '2026-09-08',
}

const record = (over: Partial<ProjectRecord> = {}): ProjectRecord =>
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

function setup(): { run: LayoutRun; calls: Pending[] } {
  const { client, calls } = stubClient()
  const run = new LayoutRun({
    client,
    complete: vi.fn(async () => ({ changed: false, relaid: false })),
    completeRebuild: vi.fn(async () => ({})),
    completeColors: vi.fn(async () => ({})),
    completeOrder: vi.fn(async () => ({})),
    completeStyle: vi.fn(async () => ({})),
    today: () => '2026-09-08',
  })
  return { run, calls }
}

const stage = (name: string, layout?: string): Report =>
  layout === undefined
    ? { stage: name, message: `${name}: 3 nodes`, fraction: 0.25 }
    : { stage: name, message: `${name}: 3 nodes`, fraction: 0.25, layout }

describe('the run’s snapshot names its layout from the first report that does (FR-002)', () => {
  it('carries no layout until a stage reports one, and the reported one after', async () => {
    const { run, calls } = setup()
    run.start(record(), READY)
    expect(run.snapshot.layout, 'nothing reported yet').toBeNull()
    // A download's reports come before the layout's id is known, and carry none.
    calls[0].report({ stage: 'download', message: 'downloaded 1 of 2 bytes', fraction: 0.5 })
    expect(run.snapshot.layout).toBeNull()
    calls[0].report(stage('gtfs2graph', LAYOUT))
    expect(run.snapshot.layout, 'named by the first stage').toBe(LAYOUT)
    expect(run.snapshot.stages[0].state, 'in the same change as the stage').toBe('done')
    for (const name of ['topo', 'loom', 'octi']) calls[0].report(stage(name, LAYOUT))
    expect(run.snapshot.layout).toBe(LAYOUT)
    calls[0].resolve(BUILT)
    await tick()
    calls[1].resolve(SERVICE)
    await tick()
    // The map call replays the four, naming the same layout, then its own four.
    for (const name of ['gtfs2graph', 'topo', 'loom', 'octi']) calls[2].report(stage(name, LAYOUT))
    for (const name of ['schedule', 'render', 'animate', 'write']) calls[2].report(stage(name))
    expect(run.snapshot.layout).toBe(LAYOUT)
  })

  it('keeps the first layout named for the whole run', () => {
    const { run, calls } = setup()
    run.start(record(), READY)
    calls[0].report(stage('gtfs2graph', LAYOUT))
    calls[0].report(stage('topo', OTHER))
    expect(run.snapshot.layout).toBe(LAYOUT)
  })

  it('takes the layout from a report that names a stage the run has already seen', () => {
    const { run, calls } = setup()
    run.start(record(), READY)
    calls[0].report(stage('gtfs2graph'))
    expect(run.snapshot.layout, 'an engine from before v0.14.0 names none').toBeNull()
    calls[0].report(stage('gtfs2graph', LAYOUT))
    expect(run.snapshot.layout).toBe(LAYOUT)
  })

  it('forgets it at the next start, and a start that is refused carries none', async () => {
    const { run, calls } = setup()
    run.start(record(), READY)
    calls[0].report(stage('gtfs2graph', LAYOUT))
    calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    expect(run.snapshot.state).toBe('cancelled')
    expect(run.snapshot.layout, 'a cancelled run keeps what it reported').toBe(LAYOUT)
    run.start(record(), null)
    expect(run.snapshot.state).toBe('failed')
    expect(run.snapshot.layout, 'a refused start is not the last run').toBeNull()
    run.start(record(), READY)
    expect(run.snapshot.state).toBe('running')
    expect(run.snapshot.layout, 'a new run has reported nothing').toBeNull()
  })

  it('is cleared by a refused redraw too', async () => {
    const { run, calls } = setup()
    run.start(record(), READY)
    calls[0].report(stage('gtfs2graph', LAYOUT))
    calls[0].reject(new Error('x'))
    await tick()
    expect(run.snapshot.layout).toBe(LAYOUT)
    // No layout to draw from: the rebuild is refused before it asks anything.
    run.rebuild(record(), READY, '2026-09-15')
    expect(run.snapshot.state).toBe('failed')
    expect(run.snapshot.layout).toBeNull()
  })
})
