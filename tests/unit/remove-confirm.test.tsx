// The project screen's delete, confirmed (issue 491, spec 037 FR-012):
// `remove.confirm` re-reads the two runs at the moment of confirming, not
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
// Each test was watched failing with the re-read removed.

import { act, type JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LayoutRun, type RunClient } from '../../src/renderer/src/engine/layoutRun'
import { useProjectState, type ProjectState } from '../../src/renderer/src/notebook/useProjectState'
import { DELETE_WHILE_DRAWING, DELETE_WHILE_EXPORTING } from '../../src/shared/activity'
import type { EngineState } from '../../src/shared/engine'
import type { ProjectRecord } from '../../src/shared/project'

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
let left: ReturnType<typeof vi.fn>

function Harness(): JSX.Element | null {
  shown = useProjectState('p1', left as never)
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
        get: vi.fn(async () => ({ ...RECORD, readOnly: false })),
        markOpened: vi.fn(async () => RECORD),
        delete: deleted,
      },
      engine: { onState: () => () => undefined, state: async () => READY },
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

beforeEach(async () => {
  deleted = vi.fn(async () => ({ removed: ['project', 'output'], failed: [] }))
  left = vi.fn()
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
  await act(async () => root.render(<Harness />))
  await act(tick)
  expect(shown.project?.id, 'the record has been read').toBe('p1')
})

afterEach(() => {
  if (mounted) act(() => root.unmount())
  mounted = false
  vi.unstubAllGlobals()
})

describe('confirming a deletion', () => {
  it('goes ahead when neither run is going', async () => {
    await act(async () => shown.remove.confirm())
    expect(deleted).toHaveBeenCalledWith('p1')
    expect(left).toHaveBeenCalled()
  })
  it('is refused when the export began after the dialog was drawn', async () => {
    // The function the dialog holds, made at a render when nothing ran.
    const confirm = shown.remove.confirm
    runs.exporter.snapshot = { state: 'running' }
    await expect(confirm()).rejects.toThrow(DELETE_WHILE_EXPORTING)
    expect(deleted).not.toHaveBeenCalled()
  })
  it('is refused when a run began after the dialog was drawn', async () => {
    const confirm = shown.remove.confirm
    act(() => shown.run.start(shown.project as ProjectRecord, shown.engine))
    expect(shown.run.snapshot.state).toBe('running')
    await expect(confirm()).rejects.toThrow(DELETE_WHILE_DRAWING)
    expect(deleted).not.toHaveBeenCalled()
  })
})
