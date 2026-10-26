// Cell 01's mode and operator as `Inspect` writes them (issue 407): its own
// handlers, run for real, sent at once as `useProjectState` sends them
// (spec 037), against a stand-in store that writes one
// write at a time in the order it was sent them, each the fields it names
// onto the record as it then stands, as the main process's does.
//
// Nothing in this suite renders to a DOM. `Inspect` is called as a function
// inside a component that renders nothing, so its hooks are that
// component's and run as React runs them, and the element tree it returns
// is kept: its controls are found in it by their names and their handlers
// called as a press calls them. The kit's controls in it are never mounted.
//
// Each test was watched failing under the change named in it.

import { act, type JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Inspect from '../../src/renderer/src/Inspect'
import type { EngineState } from '../../src/shared/engine'
import type { ProjectInputs, ProjectRecord } from '../../src/shared/project/types'
import type { Inspection } from '../../src/shared/protocol'
import { find, text } from '../support/element-tree'

// React's client reads this to know it is driven by `act`.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const READY: EngineState = { state: 'ready', version: '0.16.2', protocol: 1 }

const RECORD = {
  version: 2,
  id: 'p1',
  name: 'CDMX',
  feed: 'cdmx',
  mode: 'subway',
  agency: 'METRO',
  date: '2026-09-15',
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
} as unknown as ProjectRecord

/** A feed with two operators, so the operator control is offered. */
const INSPECTION = {
  key: 'cdmx',
  name: 'Mexico City',
  tables: [],
  agencies: [
    { agency_id: 'METRO', agency_name: 'Metro' },
    { agency_id: 'SUB', agency_name: 'Suburbano' },
  ],
  routes: [],
  route_types: [
    { route_type: 1, name: 'subway', mode: 'subway', modes: ['subway'], routes: 1, trips: 1 },
    { route_type: 2, name: 'rail', mode: 'rail', modes: ['rail'], routes: 1, trips: 1 },
  ],
  stops: {
    stops: 1,
    stations: 0,
    entrances: 0,
    generic_nodes: 0,
    boarding_areas: 0,
    total: 1,
  },
  trips: 2,
  frequency_trips: 0,
  service: null,
  suggested_mode: 'subway',
  warnings: [],
} as unknown as Inspection

const tick = (): Promise<void> => new Promise((settle) => setTimeout(settle, 0))

/**
 * The least `createRoot` and a commit ask of a container, and a document
 * whose active element is nothing: the panel's focus handback reads it.
 */
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
  vi.stubGlobal('document', document)
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

/**
 * A store that keeps every write until `answerAll`, then writes them one at
 * a time in the order it was sent them, each answer the whole record.
 */
function heldStore(): {
  send: (inputs: Partial<ProjectInputs>) => Promise<ProjectRecord>
  sent: Partial<ProjectInputs>[]
  answerAll: () => Promise<void>
  record: () => ProjectRecord
} {
  let stored = RECORD
  const sent: Partial<ProjectInputs>[] = []
  const waiting: { inputs: Partial<ProjectInputs>; answer: (r: ProjectRecord) => void }[] = []
  return {
    send(inputs) {
      sent.push(inputs)
      return new Promise((answer) => waiting.push({ inputs, answer }))
    },
    sent,
    async answerAll() {
      for (let next = waiting.shift(); next !== undefined; next = waiting.shift()) {
        stored = { ...stored, ...next.inputs }
        next.answer(stored)
        await tick()
      }
    },
    record: () => stored,
  }
}

let root: Root
let tree: JSX.Element
let store: ReturnType<typeof heldStore>

/** What `useProjectState`'s `setInputs` does with what the panel hands it: send it at once. */
const onInputs = async (inputs: Partial<ProjectInputs>): Promise<void> => {
  await store.send(inputs)
}

// One of each for the life of the file, as the screen's are for the life of
// the panel: the inspection is asked again whenever `inspect` changes.
const inspect = async (): Promise<Inspection> => INSPECTION
const handback = { current: null }

function Harness({ registry }: { registry: ProjectInputs | null }): JSX.Element | null {
  tree = Inspect({ project: RECORD, engine: READY, inspect, onInputs, registry, handback })
  return null
}

/** A control's handler, from the tree the panel last returned. */
function select(label: string): (value: string) => void {
  const [control] = find(tree, (e) => e.props.label === label && 'onChange' in e.props)
  expect(control, `the ${label} control`).toBeDefined()
  return control.props.onChange as (value: string) => void
}
function button(name: string): () => void {
  const [control] = find(tree, (e) => 'onClick' in e.props && text(e.props.children) === name)
  expect(control, `the ${name} button`).toBeDefined()
  return control.props.onClick as () => void
}

async function opened(registry: ProjectInputs | null): Promise<void> {
  await act(async () => root.render(<Harness registry={registry} />))
  await act(tick)
}

beforeEach(() => {
  store = heldStore()
  root = createRoot(container())
})

afterEach(() => {
  act(() => root.unmount())
  vi.unstubAllGlobals()
})

describe('the mode and the operator, chosen a moment apart', () => {
  it('an operator chosen while a mode is on its way goes with that mode', async () => {
    // Mutation: `chooseAgency` writing `{ mode: project.mode, agency: next }`
    // again - the operator goes with subway, and the store, writing it
    // second, puts subway back.
    await opened(null)
    act(() => select('Mode')('rail'))
    act(() => select('Operator')('SUB'))
    expect(store.sent, 'the operator goes at once, alone').toEqual([
      { mode: 'rail', agency: 'METRO' },
      { agency: 'SUB' },
    ])
    await act(() => store.answerAll())
    expect(store.record()).toMatchObject({ mode: 'rail', agency: 'SUB' })
  })

  it('the feed’s entry, used after an operator still waiting, is what the record ends on', async () => {
    // A mode, then an operator, then "Use the feed's entry": the last press
    // is the entry, sent last and written last, and the record ends on it.
    await opened({ mode: 'subway', agency: 'METRO' })
    act(() => select('Mode')('rail'))
    act(() => select('Operator')('SUB'))
    act(() => button("Use the feed's entry")())
    await act(() => store.answerAll())
    expect(store.sent.at(-1), 'written last').toEqual({ mode: 'subway', agency: 'METRO' })
    expect(store.record()).toMatchObject({ mode: 'subway', agency: 'METRO' })
  })
})
