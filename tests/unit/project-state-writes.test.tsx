// The record's writers and the layout run's start, together (issue 388):
// `useProjectState` rendered with the real `LayoutRun`, the bridge's writes
// held open, and a start made as cell 02's "Lay out" and "Lay out again"
// make one - `run.start(project, engine)`, handed the record the screen held
// at the press - and, since issue 407, as Run all makes one,
// `run.runAll(project, engine, runAllPlan)`.
//
// Since spec 037 the screen sends every write at once and the run reads its
// record through the bridge's `projects.get`, which main queues behind the
// project's writes. The bridge here does what main does: one queue, a read
// answered only once every write sent before it has landed, and the record
// a landed write answered with is the one a later read answers.
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

import { act, useRef, type JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LayoutRun, type RunClient } from '../../src/renderer/src/engine/layoutRun'
import { sayRefusedGone } from '../../src/renderer/src/notebook/useCheapEdit'
import { useProjectState, type ProjectState } from '../../src/renderer/src/notebook/useProjectState'
import type { Debounced } from '../../src/renderer/src/debounce'
import { runAllPlan } from '../../src/renderer/src/runAll'
import { useDayChoice } from '../../src/renderer/src/ServiceDay'
import { usePutBack } from '../../src/renderer/src/usePutBack'
import { ERROR_CODES, type EngineState } from '../../src/shared/engine'
import { type ProjectRecord } from '../../src/shared/project'
import { drawnOf } from '../support/sent'

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

/** A run whose every request is answered when the test says, and what it asked, in order. */
function answeringRun(complete = vi.fn(async () => ({ changed: false, relaid: false }))): {
  run: LayoutRun
  asked: {
    method: string
    params: Record<string, unknown>
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
  }[]
  complete: typeof complete
} {
  const asked: {
    method: string
    params: Record<string, unknown>
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
  }[] = []
  const run = new LayoutRun({
    read: readThroughBridge,
    client: {
      request(method, params) {
        let resolve!: (value: unknown) => void
        let reject!: (error: unknown) => void
        const result = new Promise((yes, no) => {
          resolve = yes
          reject = no
        })
        asked.push({
          method,
          params: params as unknown as Record<string, unknown>,
          resolve,
          reject,
        })
        return {
          result,
          onProgress: () => () => undefined,
          cancel: () => undefined,
        } as unknown as ReturnType<RunClient['request']>
      },
    },
    complete,
    completeRebuild: async () => ({}),
    completeColors: async () => ({}),
    completeOrder: async () => ({}),
    completeStyle: async () => ({}),
    completeLines: async () => ({}),
    today: () => '2026-09-08',
  })
  return { run, asked, complete }
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

/** A call on the bridge's stand-in, as a function the test's mocks are. */
type Call = (...args: unknown[]) => Promise<unknown>

/** The run's read of its record, through the bridge the hook sees, as `runs.ts` wires it. */
const readThroughBridge = (id: string): Promise<ProjectRecord> =>
  ((globalThis as unknown as { window: { api: Bridge } }).window.api.projects.get as Call)(
    id,
  ) as Promise<ProjectRecord>

/** What the store holds; a write that lands moves it, and a read answers it. */
let stored: ProjectRecord
/** The project's one queue, as `ProjectStore.#serial` keeps it. */
let line: Promise<unknown>

function queued<T>(step: () => Promise<T>): Promise<T> {
  const next = line.then(step)
  line = next.catch(() => undefined)
  return next
}

/**
 * The bridge the hook and the run see: each call goes into the queue in the
 * order it was made, as main applies a frame's calls (spec 037), and is
 * answered there by the test's own mock, which may hold it open. A write's
 * answer is what the store then holds.
 */
function sessionOf(api: Bridge): Bridge {
  const write =
    (mock: ReturnType<typeof vi.fn>) =>
    (...args: unknown[]): Promise<unknown> =>
      queued(async () => {
        const answer = (await (mock as Call)(...args)) as ProjectRecord | undefined
        if (answer !== undefined) stored = answer
        return answer
      })
  return {
    ...api,
    projects: {
      get: ((...args: unknown[]) =>
        queued(async () => (api.projects.get as Call)(...args))) as never,
      markOpened: api.projects.markOpened,
      setTuning: write(api.projects.setTuning) as never,
      setInputs: write(api.projects.setInputs) as never,
      setDate: write(api.projects.setDate) as never,
    },
  }
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
  const window = { document, HTMLIFrameElement: class {}, api: sessionOf(api) }
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
  stored = RECORD
  line = Promise.resolve()
  runs.layout = new LayoutRun({
    client: recording.client,
    read: readThroughBridge,
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
      get: vi.fn(async () => ({ ...stored, readOnly: false })),
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
    // Mutation: the start planning from the record it was handed
    // (`engine/layoutRun.ts`) - graph.build goes without the tuning.
    await opened()
    const write = deferred<ProjectRecord>()
    api.projects.setTuning.mockReturnValueOnce(write.promise)
    let committed!: Promise<void>
    act(() => {
      committed = shown.setTuning({ gridSize: 50 })
    })
    press()
    await act(tick)
    expect(builds(), 'nothing is laid out while the tuning is on its way').toHaveLength(0)
    await act(async () => {
      write.resolve({ ...RECORD, tuning: { gridSize: 50 } })
      await committed
      await tick()
    })
    expect(builds(), 'one layout run').toHaveLength(1)
    expect(builds()[0].tuning, 'the tuning the press committed').toEqual({ grid_size: 50 })
  })

  it('the mode and the operator cell 01 chose, their write still on its way at the press', async () => {
    // Mutation: the start planning from the record it was handed
    // (`engine/layoutRun.ts`) - graph.build goes with `all`.
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

  it('a day chosen in cell 03 is read with it, so the run draws it', async () => {
    // A day is written a beat after it is picked; a layout run draws the
    // record's day. Mutation: the run's read not queued behind the writes
    // (`queued` dropped from the bridge's `get` here, as `get` outside the
    // store's queue in main) - graph.build goes before the day lands.
    await opened()
    const write = deferred<ProjectRecord>()
    api.projects.setDate.mockReturnValueOnce(write.promise)
    let committed!: Promise<void>
    act(() => {
      committed = shown.setDate('2026-09-12')
    })
    press()
    await act(tick)
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
    // what was refused: the store answers its read with what it kept.
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

  it('with nothing on its way, the press lays out once the store has answered its read', async () => {
    await opened()
    api.projects.setTuning.mockResolvedValueOnce({ ...RECORD, tuning: { gridSize: 50 } })
    await act(async () => {
      await shown.setTuning({ gridSize: 50 })
    })
    press()
    expect(builds(), 'nothing before the record is read').toHaveLength(0)
    await act(tick)
    expect(builds(), 'a turn later').toHaveLength(1)
    expect(builds()[0].tuning).toEqual({ grid_size: 50 })
  })
})

// Issue 407. Run all chooses which run to make, a layout or a rebuild for
// the day, and it chooses from the record the writes on its way leave, as
// `ProjectHeader.tsx` asks it: `run.runAll(project, engine, runAllPlan)`,
// handed the record the screen held at the press.
describe('Run all chooses its run from the record the store answers', () => {
  /** Laid out and drawn for the 15th, with the 12th chosen since: only the day is behind. */
  const drawnFor15 = { ...RECORD, date: '2026-09-15' } as ProjectRecord
  const DAY_BEHIND = {
    ...drawnFor15,
    drawn: drawnOf(drawnFor15),
    date: '2026-09-12',
  } as ProjectRecord

  /** The press on Run all, as the header makes it. */
  function runAll(): void {
    act(() => shown.run.runAll(shown.project as ProjectRecord, shown.engine, runAllPlan))
  }

  it('a tuning committed by its press, with only the day behind: a layout, with the tuning', async () => {
    // Mutation: `runAll` making the plan after the read from the record it
    // was handed (`engine/layoutRun.ts`) - map.build alone, for the day,
    // and cell 02 left saying to lay out again.
    stored = DAY_BEHIND
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
    await act(tick)
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
    const { run, asked: answering } = answeringRun()
    runs.layout = run
    stored = { ...RECORD, mode: 'subway' }
    await opened()
    act(() => shown.run.rebuild(shown.project as ProjectRecord, shown.engine, '2026-09-15'))
    await act(async () => {
      await tick()
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
    expect(
      api.projects.get.mock.calls.length,
      'the run’s own read of its record, and nothing read back',
    ).toBe(reads + 1)
    expect(shown.drawn, 'the page not loaded again').toBe(1)
  })
})

// Issue 407. The write has answered, but the screen has not rendered the
// record it answered with: the writer's update is queued, and a press in
// that beat closes over the record the screen held. The run reads the
// store's record, which has it.
describe('a press between a write’s answer and the screen rendering it', () => {
  it('lays out what the store answered, not the record the screen still holds', async () => {
    // Mutation: the start planning from the record it was handed
    // (`engine/layoutRun.ts`) - graph.build goes without the tuning, which
    // the screen draws a moment later.
    await opened()
    const write = deferred<ProjectRecord>()
    api.projects.setTuning.mockReturnValueOnce(write.promise)
    let committed!: Promise<void>
    act(() => {
      committed = shown.setTuning({ gridSize: 50 })
    })
    const held = shown.project as ProjectRecord
    await act(async () => {
      write.resolve({ ...RECORD, tuning: { gridSize: 50 }, modified: '2026-09-01T00:00:01.000Z' })
      await committed
      // Answered, and the screen's update queued but not rendered: the
      // press closes over the record it rendered last.
      expect(shown.project, 'not rendered yet').toBe(held)
      shown.run.start(shown.project as ProjectRecord, shown.engine)
      await tick()
    })
    expect(builds()).toHaveLength(1)
    expect(builds()[0].tuning, 'the tuning the store answered with').toEqual({ grid_size: 50 })
    expect(shown.project?.tuning, 'which the screen then shows').toEqual({ gridSize: 50 })
  })
})

// Issue 407. A day picked in cell 03 is written a quarter of a second
// later, so a press on "Lay out again" in that beat found nothing on its
// way: the run drew the day the record held, and the day landed while it
// went - the control already disabled - and was kept by the layout's write
// and recorded as the day drawn. The day's write is held back by
// `useDayChoice`, which `ServiceDay` draws with, and that hears the press.
describe('a day picked in cell 03, still waiting to be written at the press', () => {
  let schedule!: Debounced<[string]>

  /** The screen's state, and the service day's write as `ServiceDay` makes it. */
  function DayHarness(): JSX.Element | null {
    shown = useProjectState('p1', () => undefined)
    const write = useRef<(date: string) => void>(() => undefined)
    write.current = (date) => {
      void shown.setDate(date).catch(() => undefined)
    }
    schedule = useDayChoice(shown.run, write)
    return null
  }

  it('is sent by the press, before the run reads, and drawn', async () => {
    // Mutation: `useDayChoice` without its `beforeStart` effect
    // (`ServiceDay.tsx`) - the run reads the 15th, the map is drawn for it,
    // and the 20th lands while the run goes.
    const { run, asked, complete } = answeringRun()
    runs.layout = run
    await act(async () => root.render(<DayHarness />))
    await act(tick)
    const write = deferred<ProjectRecord>()
    api.projects.setDate.mockReturnValueOnce(write.promise)
    act(() => schedule('2026-09-20'))
    expect(api.projects.setDate, 'still waiting on its delay').not.toHaveBeenCalled()

    press()
    await act(tick)
    expect(api.projects.setDate, 'sent by the press').toHaveBeenCalledWith('p1', '2026-09-20')
    expect(asked, 'and the read waits behind it').toHaveLength(0)
    await act(async () => {
      write.resolve({ ...RECORD, date: '2026-09-20' })
      await tick()
    })
    expect(asked.map((a) => a.method)).toEqual(['graph.build'])
    await act(async () => {
      asked[0].resolve({
        layout: RECORD.layout,
        paths: {},
        meta: { made: RECORD.made, mode: 'all', agency: null },
        stages: { octi: { lines: ['A'] } },
      })
      await tick()
      asked[1].resolve({
        start: '2026-01-01',
        end: '2026-12-31',
        busiest_weekday: '2026-09-15',
        anchor: '2026-09-08',
      })
      await tick()
    })
    expect(asked[2]).toMatchObject({ method: 'map.build', params: { date: '2026-09-20' } })
    await act(async () => {
      asked[2].resolve({ files: {} })
      await tick()
    })
    expect((complete.mock.calls[0] as unknown[])[1], 'the day drawn').toMatchObject({
      date: '2026-09-20',
    })
  })
})

// Issue 407. An operator chosen while a mode was on its way was sent with the
// mode this screen held, and the store, writing it second, put the old mode
// back. `Inspect` sends the operator alone (`chooseAgency`), and the store
// writes it onto the record the mode left (spec 037).
describe('an operator chosen while a mode is on its way', () => {
  it('is sent at once and alone, and does not put the old mode back', async () => {
    // Mutation: `setInputs` sending the operator with the mode this screen
    // held (`{ ...pick(project), ...inputs }` in `useProjectState.ts`) - the
    // operator goes with `all`.
    await opened()
    const mode = deferred<ProjectRecord>()
    const both = deferred<ProjectRecord>()
    api.projects.setInputs.mockReturnValueOnce(mode.promise).mockReturnValueOnce(both.promise)
    let chosen!: Promise<void>
    let operator!: Promise<void>
    act(() => {
      chosen = shown.setInputs({ mode: 'subway', agency: null })
    })
    act(() => {
      // As `Inspect`'s `chooseAgency` sends it: the operator alone.
      operator = shown.setInputs({ agency: 'METRO' })
    })
    await act(tick)
    expect(api.projects.setInputs, 'the mode was sent first').toHaveBeenNthCalledWith(1, 'p1', {
      mode: 'subway',
      agency: null,
    })
    await act(async () => {
      mode.resolve({ ...RECORD, mode: 'subway' })
      await chosen
      await tick()
    })
    expect(api.projects.setInputs, 'the operator alone').toHaveBeenLastCalledWith('p1', {
      agency: 'METRO',
    })
    await act(async () => {
      both.resolve({ ...RECORD, mode: 'subway', agency: 'METRO' })
      await operator
      await tick()
    })
    expect(shown.project).toMatchObject({ mode: 'subway', agency: 'METRO' })
  })
})

// Issue 407. Run all that found nothing to run after its wait puts the run
// back as it stood. Where that was a redraw for colours (or line options,
// the order, the sizes) that had been stopped, its panel puts its control
// back to the record on the change into its own stop (`usePutBack`), and
// the press was a change out of it: put back as it was, the stop reads as a
// second one, and the panel drops a change made while Run all waited. The
// panel here is the hook every cheap edit puts itself back through.
describe('Run all with nothing to run, after a redraw for colours was stopped', () => {
  const drawnFor15 = { ...RECORD, date: '2026-09-15' } as ProjectRecord
  const DAY_BEHIND = {
    ...drawnFor15,
    drawn: drawnOf(drawnFor15),
    date: '2026-09-12',
  } as ProjectRecord
  const putBack = vi.fn()

  /** The screen's state, and cell 05's colours as they put themselves back. */
  function ColoursHarness(): JSX.Element | null {
    shown = useProjectState('p1', () => undefined)
    usePutBack(shown.runSnapshot.state, shown.runSnapshot.recoloured, putBack)
    return null
  }

  it('does not tell the colours they were stopped a second time', async () => {
    // Mutation: `#withdraw` putting a stopped redraw back as it was (the
    // `stoppedRedraw` branch dropped) - the panel is put back again, and a
    // colour held while Run all waited is lost.
    putBack.mockClear()
    const { run, asked } = answeringRun()
    runs.layout = run
    stored = DAY_BEHIND
    await act(async () => root.render(<ColoursHarness />))
    await act(tick)

    // A colour's redraw, stopped: the panel goes back to the record, once.
    act(() =>
      shown.run.recolour(shown.project as ProjectRecord, shown.engine, {
        colors: { A: '#0072bc' },
        defaultColor: '#888888',
      }),
    )
    await act(tick)
    act(() => shown.run.cancel())
    await act(async () => {
      // Stopped: the engine's cancelled error, the one answer that says the
      // draw wrote nothing (engine v0.18.0); a result would be a map drawn.
      asked[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
      await tick()
    })
    expect(shown.runSnapshot).toMatchObject({ state: 'cancelled', recoloured: true })
    expect(putBack, 'the stop').toHaveBeenCalledTimes(1)

    // The drawn day put back in cell 03, its write on its way, and Run all.
    const write = deferred<ProjectRecord>()
    api.projects.setDate.mockReturnValueOnce(write.promise)
    let committed!: Promise<void>
    act(() => {
      committed = shown.setDate('2026-09-15')
    })
    act(() => shown.run.runAll(shown.project as ProjectRecord, shown.engine, runAllPlan))
    expect(shown.runSnapshot.state).toBe('running')
    await act(async () => {
      write.resolve({ ...DAY_BEHIND, date: '2026-09-15' })
      await tick()
      await committed
      await tick()
    })
    expect(
      asked.map((a) => a.method),
      'nothing run',
    ).toEqual(['map.build'])
    expect(putBack, 'and no second stop').toHaveBeenCalledTimes(1)
    expect(shown.runSnapshot).toMatchObject({
      state: 'idle',
      recoloured: false,
      error: null,
      report: null,
    })
  })
})

// Engine v0.18.0 (its issue 80): a map call the cancel reached after the
// map's files were in place answers its result with `cancel_too_late`, and
// the map on disk is the one drawn. The screen treats it as any finished
// draw: the record the run wrote is read back, and the viewer's address
// moves on (`drawn`), so the frame loads the page the engine wrote. Before,
// a cancelled redraw left the old page in the frame over new files on disk.
describe('a redraw the cancel reached too late', () => {
  it('reads the record back and loads the page again, as after any draw', async () => {
    // Mutation: the cancel looked at again after the draw in `recolour` - the
    // run then ends cancelled, nothing is read back and the frame keeps the
    // page from before.
    const { run, asked } = answeringRun()
    runs.layout = run
    const before = { ...RECORD, drawn: drawnOf(RECORD) } as ProjectRecord
    stored = before
    await act(async () => root.render(<Harness />))
    await act(tick)
    const loads = shown.drawn
    const reads = api.projects.get.mock.calls.length

    const chosen = { colors: { A: '#ff0000' }, defaultColor: '#888888' }
    act(() => shown.run.recolour(shown.project as ProjectRecord, shown.engine, chosen))
    await act(tick)
    const readsBefore = api.projects.get.mock.calls.length
    act(() => shown.run.cancel())
    // What the store holds once the run has written the colours it drew.
    const after = { ...before, colors: chosen.colors, drawn: drawnOf({ ...before, ...chosen }) }
    stored = after
    await act(async () => {
      asked[0].resolve({ files: {}, cancel_too_late: true })
      await tick()
      await tick()
    })
    expect(shown.runSnapshot).toMatchObject({ state: 'done', recoloured: true })
    expect(readsBefore, 'the run read its record once').toBe(reads + 1)
    expect(api.projects.get.mock.calls.length, 'the record is read back').toBe(reads + 2)
    expect(shown.project?.colors, 'and is the one the run wrote').toEqual(chosen.colors)
    expect(shown.drawn, 'the frame loads the page the engine wrote').toBe(loads + 1)
  })
})

// Spec 037, User Story 3 scenario 5: a cheap edit flushed as its panel went
// and refused at its start is said on the project's status line, which
// reads it from this hook's `refused` (`ProjectHeader.tsx`).
describe('a cheap edit refused after its panel went', () => {
  it('reaches the screen as `refused`, and goes when the run next moves', async () => {
    // Mutation: `useProjectState` returning `refused: null` - the header
    // would never say it, though its own test, handed one, passes.
    await opened()
    const run = runs.layout as LayoutRun
    expect(shown.refused).toBeNull()
    // Refused at once, as a redraw with no engine is.
    act(() =>
      run.recolour(shown.project as ProjectRecord, null, { colors: {}, defaultColor: '#888888' }),
    )
    const refusal = run.snapshot.error as string
    expect(run.snapshot.state).toBe('failed')
    act(() => sayRefusedGone(run, run.snapshot, refusal))
    expect(shown.refused).toBe(refusal)
    act(() => run.start(shown.project as ProjectRecord, null))
    expect(shown.refused, 'gone once the run moves').toBeNull()
  })
})
