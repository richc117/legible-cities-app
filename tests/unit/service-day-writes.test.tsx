// Cell 03's service day as `ServiceDay` writes it, against the real
// `LayoutRun` (issue 407): a day picked is written a quarter of a second
// later, and a run started inside that beat must send it first and draw
// it, rather than draw the day the record held and let the day land while
// it goes. The store here is main's in miniature (spec 037): one queue, and
// the run's read answered only once the write sent before it has landed.
//
// Nothing in this suite renders to a DOM. `ServiceDay` is called as a
// function inside a component that renders nothing, so its hooks are that
// component's and run as React runs them, and the date control's handler is
// taken from the tree it returns (`tests/support/element-tree.ts`).
//
// Each test was watched failing under the change named in it.

import { act, type JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LayoutRun, type RunClient } from '../../src/renderer/src/engine/layoutRun'
import ServiceDay from '../../src/renderer/src/ServiceDay'
import type { EngineState } from '../../src/shared/engine'
import { type ProjectRecord } from '../../src/shared/project/types'
import { drawnOf } from '../support/sent'
import { find } from '../support/element-tree'

// React's client reads this to know it is driven by `act`.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const READY: EngineState = { state: 'ready', version: '0.16.2', protocol: 1 }

const LAID = {
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
/** Laid out and drawn for the 15th: nothing behind. */
const DRAWN: ProjectRecord = { ...LAID, drawn: drawnOf(LAID) }

const tick = (): Promise<void> => new Promise((settle) => setTimeout(settle, 0))

/** The least `createRoot` and a commit ask of a container. */
function container(): Element {
  const document: Record<string, unknown> = {
    nodeType: 9,
    activeElement: null,
    body: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
  const window = { document, HTMLIFrameElement: class {} }
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
let tree: JSX.Element
let run: LayoutRun
let asked: { method: string; params: Record<string, unknown>; resolve: (v: unknown) => void }[]
const complete = vi.fn(async () => ({ changed: false, relaid: false }))
let answerDay: (record: ProjectRecord) => void
/** What the store holds, and its one queue, as `ProjectStore.#serial` keeps it. */
let stored: ProjectRecord
let line: Promise<unknown>
function queued<T>(step: () => Promise<T>): Promise<T> {
  const next = line.then(step)
  line = next.catch(() => undefined)
  return next
}
/** What the screen's `setDate` does: send the write at once; it lands when the test says. */
const onDate = vi.fn(async (date: string): Promise<void> => {
  void date
  await queued(async () => {
    stored = await new Promise<ProjectRecord>((answer) => {
      answerDay = answer
    })
  })
})
const handback = { current: null }

function Harness(): JSX.Element | null {
  tree = ServiceDay({ run, project: DRAWN, engine: READY, onDate, handback })
  return null
}

beforeEach(() => {
  asked = []
  complete.mockClear()
  onDate.mockClear()
  stored = DRAWN
  line = Promise.resolve()
  run = new LayoutRun({
    // The run's read, queued behind the writes sent before it.
    read: () => queued(async () => stored),
    client: {
      request(method, params) {
        let resolve!: (value: unknown) => void
        const result = new Promise((yes) => {
          resolve = yes
        })
        asked.push({ method, params: params as unknown as Record<string, unknown>, resolve })
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
  root = createRoot(container())
})

afterEach(() => {
  act(() => root.unmount())
  vi.unstubAllGlobals()
})

describe('a day picked in cell 03, still waiting to be written when a run starts', () => {
  it('is sent by the press, waited for, and is the day the run draws and records', async () => {
    // Mutation: `ServiceDay` handing `useDayChoice` something other than its
    // run, which never hears the press - the run reads the 15th and lays it
    // out, and the 20th is written a quarter of a second later.
    await act(async () => root.render(<Harness />))
    const [control] = find(tree, (e) => e.type === 'input' && e.props.type === 'date')
    expect(control, 'the date control').toBeDefined()
    act(() =>
      (control.props.onChange as (event: { target: { value: string } }) => void)({
        target: { value: '2026-09-20' },
      }),
    )
    expect(onDate, 'still waiting on its delay').not.toHaveBeenCalled()

    act(() => run.start(DRAWN, READY))
    expect(onDate, 'sent by the press').toHaveBeenCalledWith('2026-09-20')
    await act(tick)
    expect(asked, 'and the run’s read waits behind it').toHaveLength(0)
    await act(async () => {
      answerDay({ ...DRAWN, date: '2026-09-20' })
      await tick()
    })
    expect(asked.map((a) => a.method)).toEqual(['graph.build'])
    await act(async () => {
      asked[0].resolve({
        layout: LAID.layout,
        paths: {},
        meta: { made: LAID.made, mode: 'all', agency: null },
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
