// The project screen's delete, confirmed (issue 491, spec 037 FR-012):
// `deleteProject` re-reads the two runs at the moment of confirming, not
// at the render that drew the dialog. The footer's button is disabled while
// a run goes, but the dialog can have been opened before the run began, and
// the function it holds was made at that render. Main refuses too
// (`tests/unit/project-activity.test.ts`); this is the screen saying so
// first, in the same words, without sending the deletion at all.
//
// Set up as `project-state-writes.test.tsx` does: the hook called by a
// component that renders nothing, through React's own client, over a
// stand-in for the one element `createRoot` asks for.
//
// The re-read's tests were each watched failing with it removed; the
// others name their mutations, which `remove-confirm.mutations.json` runs.
//
// And the same harness holds the screen's other two uses of the way back:
// a delete confirmed goes back by the `onBack` handed in last, and a sample
// cancelled while its feed downloaded is deleted and said so by it.

import { act, type JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { LayoutRun, type RunClient } from '../../src/renderer/src/engine/layoutRun'
import {
  sampleNotKept,
  useProjectState,
  type ProjectState,
} from '../../src/renderer/src/notebook/useProjectState'
import { DELETE_WHILE_DRAWING, DELETE_WHILE_EXPORTING } from '../../src/shared/activity'
import type { EngineState } from '../../src/shared/engine'
import type { ProjectRecord } from '../../src/shared/project/types'
import { snap, StandInRun } from '../support/stand-in-run'

const runs = vi.hoisted(() => ({
  layout: null as unknown,
  // One object, as the registry's is, or the hook's subscription renews
  // forever. Its state is changed by the test without a render.
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

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const READY: EngineState = { state: 'ready', version: '0.19.0', protocol: 1 }

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

let root: Root
let mounted = false
let shown: ProjectState
let deleted: ReturnType<typeof vi.fn>
let left: Mock<(notice?: string) => void>
/** The record the store answers. */
let stored: ProjectRecord

/**
 * The hook, handed the way back the screen above hands it on this render,
 * and whether the project was just made from a sample city.
 */
function Harness({
  onBack,
  layOut = false,
}: {
  onBack: (notice?: string) => void
  layOut?: boolean
}): JSX.Element | null {
  shown = useProjectState('p1', onBack, layOut)
  return null
}

function container(): Element {
  const document: Record<string, unknown> = {
    nodeType: 9,
    activeElement: null,
    body: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
  const window = {
    document,
    HTMLIFrameElement: class {},
    api: {
      projects: {
        get: vi.fn(async () => ({ ...stored, readOnly: false })),
        markOpened: vi.fn(async () => RECORD),
        delete: deleted,
      },
      engine: { onState: () => () => undefined, state: async () => READY },
      export: { outputs: async () => [] },
    },
  }
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

beforeEach(() => {
  deleted = vi.fn(async () => ({ removed: ['project', 'output'], failed: [] }))
  left = vi.fn()
  stored = RECORD
  runs.exporter.snapshot = { state: 'idle' }
  const client: RunClient = {
    request: () =>
      ({
        result: new Promise(() => undefined),
        onProgress: () => () => undefined,
        cancel: () => undefined,
      }) as unknown as ReturnType<RunClient['request']>,
  }
  runs.layout = new LayoutRun({
    client,
    read: async () => RECORD,
    complete: async () => ({ changed: false, relaid: false }),
    completeRebuild: async () => ({}),
    completeColors: async () => ({}),
    completeOrder: async () => ({}),
    completeStyle: async () => ({}),
    completeLines: async () => ({}),
    today: () => '2026-09-08',
  })
  root = createRoot(container())
  mounted = true
})

/** The screen opened, its record read. */
async function opened(layOut = false): Promise<void> {
  await act(async () => root.render(<Harness onBack={left} layOut={layOut} />))
  await act(tick)
  expect(shown.project?.id, 'the record has been read').toBe('p1')
}

afterEach(() => {
  if (mounted) act(() => root.unmount())
  mounted = false
  vi.unstubAllGlobals()
})

describe('confirming a deletion', () => {
  beforeEach(() => opened())
  it('goes ahead when neither run is going', async () => {
    await act(async () => shown.deleteProject())
    expect(deleted).toHaveBeenCalledWith('p1')
    expect(left).toHaveBeenCalled()
  })
  it('goes back by the way back the screen above handed in last', async () => {
    // `App` hands in a new arrow on every render, and the one the screen
    // holds is one function for its life, which calls whichever came
    // last. Mutation: the effect that keeps it current removed - the first
    // one is called.
    const leftLater = vi.fn()
    await act(async () => root.render(<Harness onBack={leftLater} />))
    await act(async () => shown.deleteProject())
    expect(leftLater).toHaveBeenCalledWith(undefined)
    expect(left).not.toHaveBeenCalled()
  })
  it('is refused when the export began after the dialog was drawn', async () => {
    // The function the dialog holds, made at a render when nothing ran.
    const confirm = shown.deleteProject
    runs.exporter.snapshot = { state: 'running' }
    await expect(confirm()).rejects.toThrow(DELETE_WHILE_EXPORTING)
    expect(deleted).not.toHaveBeenCalled()
  })
  it('is refused when a run began after the dialog was drawn', async () => {
    const confirm = shown.deleteProject
    act(() => shown.run.start(shown.project as ProjectRecord, shown.engine))
    expect(shown.run.snapshot.state).toBe('running')
    await expect(confirm()).rejects.toThrow(DELETE_WHILE_DRAWING)
    expect(deleted).not.toHaveBeenCalled()
  })
})

// A sample city opened from its card and cancelled while its feed
// downloaded is not kept (issue 178). The screen hears the run through one
// subscription for its life: the listener reads the record and the way
// back as they are when the run moves (an effect event, issue 433), so a
// render of the screen above, which hands in a new `onBack` each time, and
// a record read again renew nothing.
describe('a sample cancelled while its feed downloaded', () => {
  /** The stand-in run, counting its subscriptions, and starting nothing when the screen starts it. */
  class CountedRun extends StandInRun {
    subscribed = 0
    readonly start = vi.fn()
    subscribe(listener: Parameters<StandInRun['subscribe']>[0]): () => void {
      this.subscribed += 1
      return super.subscribe(listener)
    }
  }

  it('is deleted once, and the way back handed in last says so', async () => {
    // Mutations: `state` and `onBack` put back in the effect's dependencies
    // - each render of the screen above subscribes again; the listener
    // reading the `onBack` it was subscribed with - the first one is
    // called.
    const run = new CountedRun()
    runs.layout = run
    stored = { ...RECORD, layout: null, made: null } as ProjectRecord
    await opened(true)
    expect(run.start, 'the layout started as the screen opened').toHaveBeenCalledTimes(1)
    const subscribed = run.subscribed
    for (let render = 0; render < 3; render++)
      await act(async () => root.render(<Harness onBack={vi.fn()} layOut />))
    expect(run.subscribed, 'three renders of the screen above').toBe(subscribed)
    const leftLast = vi.fn()
    await act(async () => root.render(<Harness onBack={leftLast} layOut />))
    await act(async () => run.move({ ...snap('cancelled'), feedMissing: true }))
    await act(tick)
    expect(deleted).toHaveBeenCalledTimes(1)
    expect(deleted).toHaveBeenCalledWith('p1')
    expect(leftLast).toHaveBeenCalledWith(sampleNotKept('Los Angeles'))
    expect(left).not.toHaveBeenCalled()
  })
})
