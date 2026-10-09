// The layout as it solves (issue 382, specs/032): cell 01's stage view draws
// each stage of a layout run as the engine reports it. What can be held
// without React or Electron is here, a section per decision of the spec: the
// run's snapshot naming its layout, the cache's identity while a run is in
// flight, and the view's own pure parts.

import { describe, expect, it, vi } from 'vitest'
import { LayoutRun, type RunClient } from '../../src/renderer/src/engine/layoutRun'
import {
  forgetAllStages,
  forgetStagesOf,
  stageFor,
  stageSet,
} from '../../src/renderer/src/engine/stages'
import { ERROR_CODES, type EngineState } from '../../src/shared/engine'
import type { ProjectRecord } from '../../src/shared/project'
import type { RenderStageParams, RenderStageResult } from '../../src/shared/protocol'

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

// ------------------------------------------------- the cache while a run runs

describe('the stage cache keys a drawing by the run while one is in flight (FR-005)', () => {
  // Each answer is numbered, so a test can tell which request it came from:
  // a drawing answered from the wrong slot is a number it did not ask for.
  function numbered(): { client: Parameters<typeof stageFor>[0]; sent: RenderStageParams[] } {
    const sent: RenderStageParams[] = []
    const client = {
      request: (_method: 'render.stage', params: RenderStageParams) => {
        sent.push(params)
        return {
          result: Promise.resolve({
            layout: params.layout,
            stage: params.stage,
            svg: `answer ${sent.length}`,
          } as RenderStageResult),
        }
      },
    }
    return { client, sent }
  }
  const MADE = '2026-10-09T12:00:00+00:00'
  const LATER = '2026-10-09T12:05:00+00:00'
  const DAY = '2026-09-15'
  const svgOf = async (p: Promise<RenderStageResult>): Promise<string> => (await p).svg

  it('never answers a build’s drawing for the stored set, another build, or the reverse', async () => {
    forgetAllStages()
    const { client, sent } = numbered()
    const ask = (made: string | null, run: string | null, date: string | null = null) =>
      svgOf(stageFor(client, 'la', LAYOUT, stageSet(made, run), 'gtfs2graph', 1600, date))

    // The stored set, for the day drawn, as the view reads it today.
    expect(await ask(MADE, null, DAY)).toBe('answer 1')
    // A re-layout under the same id: `made` is still the stored set's.
    expect(await ask(MADE, 'job-1'), 'the build is asked, not the store').toBe('answer 2')
    expect(await ask(MADE, 'job-1'), 'and held for the run').toBe('answer 2')
    // That run was stopped, so `made` did not move; the next re-layout's
    // build is another build, and its first stage is not the first one's.
    expect(await ask(MADE, 'job-2'), 'a second run is never answered the first’s').toBe('answer 3')
    // The stored set, asked as the view asks it, without a day too.
    expect(await ask(MADE, null, DAY), 'the stored set is still the store’s').toBe('answer 1')
    expect(await ask(MADE, null), 'never a build’s, with no day either').toBe('answer 4')
    // The run finished: the store is read under the new `made`, as today.
    expect(await ask(LATER, null, DAY)).toBe('answer 5')
    expect(sent.map((p) => 'date' in p)).toEqual([true, false, false, false, true])
  })

  it('writes a run’s set so that no `made` can be it', () => {
    expect(stageSet(MADE, null)).toBe(MADE)
    expect(stageSet(null, null)).toBeNull()
    expect(stageSet(MADE, 'job-7')).toBe('run job-7')
    expect(stageSet(null, 'job-7')).toBe('run job-7')
    expect(stageSet(MADE, 'job-7')).not.toBe(stageSet(MADE, 'job-8'))
  })

  it('forgets one run’s drawings and nothing else', async () => {
    forgetAllStages()
    const { client, sent } = numbered()
    const ask = (run: string | null) =>
      stageFor(client, 'la', LAYOUT, stageSet(MADE, run), 'loom', 1600)
    await ask('job-1')
    await ask(null)
    forgetStagesOf(stageSet(MADE, 'job-1') as string)
    await ask('job-1')
    await ask(null)
    expect(sent, 'the run’s asked again, the stored set’s not').toHaveLength(3)
  })

  it('keeps a slot asked again after it was forgotten, whatever the first ask did', async () => {
    forgetAllStages()
    let refuse!: (e: unknown) => void
    let asked = 0
    const client = {
      request: () => {
        asked += 1
        return {
          result:
            asked === 1
              ? new Promise<RenderStageResult>((_r, reject) => (refuse = reject))
              : Promise.resolve({ svg: 'second' } as RenderStageResult),
        }
      },
    }
    const set = stageSet(MADE, 'job-3') as string
    const first = stageFor(client, 'la', LAYOUT, set, 'topo', 1600).catch(() => 'refused')
    forgetStagesOf(set)
    expect((await stageFor(client, 'la', LAYOUT, set, 'topo', 1600)).svg).toBe('second')
    refuse(new Error('not yet'))
    expect(await first).toBe('refused')
    expect((await stageFor(client, 'la', LAYOUT, set, 'topo', 1600)).svg).toBe('second')
    expect(asked, 'the late refusal did not take the second answer with it').toBe(2)
  })
})
