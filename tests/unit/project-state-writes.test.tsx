// The record's writers and the layout run's start, together (issue 388):
// `useProjectState` rendered with the real `LayoutRun`, the bridge's writes
// held open, and a start made as cell 02's "Lay out" and "Lay out again"
// make one - `run.start(project, engine)`, handed the record the screen held
// at the press - and, since issue 407, as Run all makes one,
// `run.runAll(project, engine, runAllPlan)`.
//
// A field in cell 02's Layout tuning commits when it is left, and cell 01's
// mode and operator when they are chosen. When what takes focus away is the
// press on Lay out, the commit is a write through the bridge - an IPC round
// trip and an atomic file write - that is still on its way when the press
// starts the run. The screen's record gains the value only when the write
// answers; a run that read it at the press laid out the inputs the record
// no longer holds, and cost one more run to put right.
//
// Nothing is rendered to a DOM, and none is needed, as in
// `line-options-hook.test.tsx`: the hook is called by a component that
// renders nothing, through React's own client, into a stand-in for the one
// element `createRoot` asks for. The run is the real one, over a client
// that records what it was sent; the runs' registry, which reaches for the
// bridge's engine, and the feed list, which asks the engine, are stood in
// for, and so is the bridge's `projects`.
//
// Each test was watched failing under the change named in it.

import { act, type JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LayoutRun, type RunClient } from '../../src/renderer/src/engine/layoutRun'
import { useProjectState, type ProjectState } from '../../src/renderer/src/notebook/useProjectState'
import { runAllPlan } from '../../src/renderer/src/runAll'
import type { EngineState } from '../../src/shared/engine'
import { drawnFrom, type ProjectRecord } from '../../src/shared/project'

const runs = vi.hoisted(() => ({
  layout: null as unknown,
  // An export that never runs: the hook reads its snapshot and listens. One
  // object, as the registry's is, or the hook's subscription renews forever.
  exporter: { snapshot: { state: 'idle' }, subscribe: () => () => undefined },
}))

vi.mock('../../src/renderer/src/engine/runs', () => ({
  layoutRunFor: () => runs.layout,
  exportRunFor: () => runs.exporter,
  engineClient: () => ({}),
  forgetProjectJobs: () => undefined,
  nameProject: () => undefined,
}))

vi.mock('../../src/renderer/src/engine/inspections', () => ({
  feedRecordFor: () => Promise.resolve(null),
  inspectionFor: () => new Promise(() => undefined),
  forgetFeedList: () => undefined,
}))

// React's client reads this to know it is driven by `act`.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const READY: EngineState = { state: 'ready', version: '0.16.1', protocol: 1 }

const RECORD = {
  version: 2,
  id: 'p1',
  name: 'Los Angeles',
  feed: 'la-metro-rail',
  mode: 'all',
  agency: null,
  date: '2026-09-15',
  service: { start: '2026-01-01', end: '2026-12-31', busiest: '2026-09-15', anchor: '2026-09-08' },
  style: {},
  colors: {},
  defaultColor: '#888888',
  lineOrder: [],
  theme: 'warm-dark',
  layout: 'c'.repeat(64),
  made: '2026-09-10T12:00:00+00:00',
  drawn: null,
  built: { mode: 'all', agency: null },
  created: '2026-09-01T00:00:00.000Z',
  modified: '2026-09-01T00:00:00.000Z',
} as unknown as ProjectRecord

const tick = (): Promise<void> => new Promise((settle) => setTimeout(settle, 0))

/** A promise held open until the test answers it, as a write on its way is. */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

/** What the run sent the engine, in order; nothing it asks is ever answered. */
function recordingClient(): { client: RunClient; sent: { method: string; params: unknown }[] } {
  const sent: { method: string; params: unknown }[] = []
  const client: RunClient = {
    request(method, params) {
      sent.push({ method, params })
      return {
        result: new Promise(() => undefined),
        onProgress: () => () => undefined,
        cancel: () => undefined,
      } as unknown as ReturnType<RunClient['request']>
    },
  }
  return { client, sent }
}

interface Bridge {
  projects: {
    get: ReturnType<typeof vi.fn>
    markOpened: ReturnType<typeof vi.fn>
    setTuning: ReturnType<typeof vi.fn>
    setInputs: ReturnType<typeof vi.fn>
    setDate: ReturnType<typeof vi.fn>
  }
  engine: { onState: () => () => void; state: () => Promise<EngineState> }
}

/**
 * The least `createRoot` and a commit ask of a container, and a window
 * carrying the bridge the hook reads. The component renders nothing.
 */
function container(api: Bridge): Element {
  const document: Record<string, unknown> = {
    nodeType: 9,
    activeElement: null,
    body: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
  const window = { document, HTMLIFrameElement: class {}, api }
  document.defaultView = window
  vi.stubGlobal('window', window)
  return {
    nodeType: 1,
    nodeName: 'DIV',
    tagName: 'DIV',
    ownerDocument: document,
    firstChild: null,
    textContent: '',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as Element
}

let root: Root
let mounted = false
let shown: ProjectState
let api: Bridge
let sent: { method: string; params: unknown }[]

function Harness(): JSX.Element | null {
  shown = useProjectState('p1', () => undefined)
  return null
}

/** The project's screen, opened on the record, with the engine ready. */
async function opened(): Promise<void> {
  await act(async () => root.render(<Harness />))
  await act(tick)
  expect(shown.project?.id, 'the record has been read').toBe('p1')
  expect(shown.engine).toEqual(READY)
}

/** The press on Lay out or Lay out again, as `begin` in `LayoutRun.tsx` makes it. */
function press(): void {
  act(() => shown.run.start(shown.project as ProjectRecord, shown.engine))
}

const builds = (): Record<string, unknown>[] =>
  sent.filter((s) => s.method === 'graph.build').map((s) => s.params as Record<string, unknown>)

beforeEach(() => {
  const recording = recordingClient()
  sent = recording.sent
  runs.layout = new LayoutRun({
    client: recording.client,
    complete: async () => ({ changed: false, relaid: false }),
    completeRebuild: async () => ({}),
    completeColors: async () => ({}),
    completeOrder: async () => ({}),
    completeStyle: async () => ({}),
    completeLines: async () => ({}),
    today: () => '2026-09-08',
  })
  api = {
    projects: {
      get: vi.fn(async () => ({ ...RECORD, readOnly: false })),
      markOpened: vi.fn(async () => RECORD),
      setTuning: vi.fn(),
      setInputs: vi.fn(),
      setDate: vi.fn(),
    },
    engine: { onState: () => () => undefined, state: async () => READY },
  }
  root = createRoot(container(api))
  mounted = true
})

afterEach(() => {
  if (mounted) act(() => root.unmount())
  mounted = false
  vi.unstubAllGlobals()
})

describe('a value committed by the press on Lay out is the one the run sends', () => {
  it('the tuning a field committed as it was left, its write still on its way at the press', async () => {
    // Mutation: the start reading the record it was handed whatever is on
    // its way (`engine/layoutRun.ts`), or `setTuning` not handing its write
    // to the run (`useProjectState.ts`) - graph.build goes at the press,
    // without the tuning.
    await opened()
    const write = deferred<ProjectRecord>()
    api.projects.setTuning.mockReturnValueOnce(write.promise)
    let committed!: Promise<void>
    act(() => {
      committed = shown.setTuning({ gridSize: 50 })
    })
    press()
    await act(async () => {
      write.resolve({ ...RECORD, tuning: { gridSize: 50 } })
      await committed
      await tick()
    })
    expect(builds(), 'one layout run').toHaveLength(1)
    expect(builds()[0].tuning, 'the tuning the press committed').toEqual({ grid_size: 50 })
  })

  it('the mode and the operator cell 01 chose, their write still on its way at the press', async () => {
    // Mutation: `setInputs` not handing its write to the run
    // (`useProjectState.ts`) - graph.build goes at the press with `all`.
    await opened()
    const write = deferred<ProjectRecord>()
    api.projects.setInputs.mockReturnValueOnce(write.promise)
    let committed!: Promise<void>
    act(() => {
      committed = shown.setInputs({ mode: 'subway', agency: 'METRO' })
    })
    press()
    await act(async () => {
      write.resolve({ ...RECORD, mode: 'subway', agency: 'METRO' })
      await committed
      await tick()
    })
    expect(builds()).toHaveLength(1)
    expect(builds()[0]).toMatchObject({ mode: 'subway', agency: 'METRO' })
  })

  it('a day chosen in cell 03 is handed over too, so the run waits for it', async () => {
    // A day is written a beat after it is picked; a layout run draws the
    // record's day. Mutation: `setDate` not handing its write to the run
    // (`useProjectState.ts`) - graph.build goes at the press.
    await opened()
    const write = deferred<ProjectRecord>()
    api.projects.setDate.mockReturnValueOnce(write.promise)
    let committed!: Promise<void>
    act(() => {
      committed = shown.setDate('2026-09-12')
    })
    press()
    expect(builds(), 'nothing is laid out while the day is on its way').toHaveLength(0)
    await act(async () => {
      write.resolve({ ...RECORD, date: '2026-09-12' })
      await committed
      await tick()
    })
    expect(builds()).toHaveLength(1)
  })

  it('a refused write: the writer hears why, and the run goes from the record as it stands', async () => {
    // The section shows the refusal and goes back to the record (`notSaved`
    // in `LayoutTuning.tsx`); the run must neither wait for ever nor send
    // what was refused. Mutation: `writing` without its refusal handler
    // (`engine/layoutRun.ts`) - the wait never ends and nothing is laid out.
    await opened()
    const write = deferred<ProjectRecord>()
    api.projects.setTuning.mockReturnValueOnce(write.promise)
    let committed!: Promise<void>
    act(() => {
      committed = shown.setTuning({ gridSize: 50 })
    })
    press()
    await act(async () => {
      write.reject(new Error('read-only'))
      await expect(committed).rejects.toThrow('read-only')
      await tick()
    })
    expect(builds()).toHaveLength(1)
    expect(builds()[0], 'what the store kept: no tuning').not.toHaveProperty('tuning')
    expect(shown.project?.tuning, 'nor does the screen hold one').toBeUndefined()
  })

  it('with nothing on its way, the press lays out in its own turn, from the record the screen holds', async () => {
    // Mutation: the start awaiting the writes whatever is on its way
    // (`engine/layoutRun.ts`) - nothing is asked in the press's own turn.
    await opened()
    api.projects.setTuning.mockResolvedValueOnce({ ...RECORD, tuning: { gridSize: 50 } })
    await act(async () => {
      await shown.setTuning({ gridSize: 50 })
    })
    press()
    expect(builds(), 'asked in the press’s own turn').toHaveLength(1)
    expect(builds()[0].tuning).toEqual({ grid_size: 50 })
  })
})

// Issue 407. Run all chooses which run to make, a layout or a rebuild for
// the day, and it chooses from the record the writes on its way leave, as
// `ProjectHeader.tsx` asks it: `run.runAll(project, engine, runAllPlan)`,
// handed the record the screen held at the press.
describe('Run all chooses its run from the record the writes on their way leave', () => {
  /** Laid out and drawn for the 15th, with the 12th chosen since: only the day is behind. */
  const drawnFor15 = { ...RECORD, date: '2026-09-15' } as ProjectRecord
  const DAY_BEHIND = {
    ...drawnFor15,
    drawn: drawnFrom(drawnFor15),
    date: '2026-09-12',
  } as ProjectRecord

  /** The press on Run all, as the header makes it. */
  function runAll(): void {
    act(() => shown.run.runAll(shown.project as ProjectRecord, shown.engine, runAllPlan))
  }

  it('a tuning committed by its press, with only the day behind: a layout, with the tuning', async () => {
    // Mutation: `runAll` making the plan after the wait from the record it
    // was handed (`engine/layoutRun.ts`), or `setTuning` not handing its
    // write to the run (`useProjectState.ts`) - map.build alone, for the
    // day, and cell 02 left saying to lay out again.
    api.projects.get.mockImplementation(async () => ({ ...DAY_BEHIND, readOnly: false }))
    await opened()
    expect(runAllPlan(shown.project as ProjectRecord, shown.runSnapshot)).toEqual({
      kind: 'rebuild',
      date: '2026-09-12',
    })
    const write = deferred<ProjectRecord>()
    api.projects.setTuning.mockReturnValueOnce(write.promise)
    let committed!: Promise<void>
    act(() => {
      committed = shown.setTuning({ gridSize: 50 })
    })
    runAll()
    expect(sent, 'nothing asked while the tuning is on its way').toHaveLength(0)
    await act(async () => {
      write.resolve({ ...DAY_BEHIND, tuning: { gridSize: 50 } })
      await committed
      await tick()
    })
    expect(builds(), 'a layout').toHaveLength(1)
    expect(builds()[0].tuning).toEqual({ grid_size: 50 })
  })

  it('nothing left to run once the write lands: the run goes back as it stood, and the map is not loaded again', async () => {
    // A mode chosen and put back, the second choice committed by the press.
    // The run had finished a draw before, which this screen read back.
    // Mutation: the read-back after a run taking the snapshot the run was
    // put back to for a finish (`snapshot !== settled` dropped in
    // `useProjectState.ts`) - the record is read again and the page's
    // address moves, reloading a map nobody drew.
    const answering: { method: string; resolve: (value: unknown) => void }[] = []
    runs.layout = new LayoutRun({
      client: {
        request(method) {
          let resolve!: (value: unknown) => void
          const result = new Promise((yes) => {
            resolve = yes
          })
          answering.push({ method, resolve })
          return {
            result,
            onProgress: () => () => undefined,
            cancel: () => undefined,
          } as unknown as ReturnType<RunClient['request']>
        },
      },
      complete: async () => ({ changed: false, relaid: false }),
      completeRebuild: async () => ({}),
      completeColors: async () => ({}),
      completeOrder: async () => ({}),
      completeStyle: async () => ({}),
      completeLines: async () => ({}),
      today: () => '2026-09-08',
    })
    api.projects.get.mockImplementation(async () => ({
      ...RECORD,
      mode: 'subway',
      readOnly: false,
    }))
    await opened()
    act(() => shown.run.rebuild(shown.project as ProjectRecord, shown.engine, '2026-09-15'))
    await act(async () => {
      answering[0].resolve({ files: {} })
      await tick()
      await tick()
    })
    expect(shown.runSnapshot.state).toBe('done')
    expect(shown.drawn, 'the finished draw was read back').toBe(1)
    const reads = api.projects.get.mock.calls.length

    expect(runAllPlan(shown.project as ProjectRecord, shown.runSnapshot)).toEqual({
      kind: 'layout',
    })
    const write = deferred<ProjectRecord>()
    api.projects.setInputs.mockReturnValueOnce(write.promise)
    let committed!: Promise<void>
    act(() => {
      committed = shown.setInputs({ mode: 'all', agency: null })
    })
    runAll()
    expect(shown.runSnapshot.state).toBe('running')
    await act(async () => {
      write.resolve({ ...RECORD })
      await committed
      await tick()
      await tick()
    })
    expect(
      answering.map((a) => a.method),
      'only the first draw was ever asked',
    ).toEqual(['map.build'])
    expect(shown.runSnapshot.state).toBe('done')
    expect(shown.settling).toBe(false)
    expect(api.projects.get.mock.calls.length, 'nothing read back').toBe(reads)
    expect(shown.drawn, 'the page not loaded again').toBe(1)
  })
})
