// @vitest-environment jsdom
// How often each part of the project screen renders, counted (ADR-059,
// measurement 10; codebase review R4-02, issue 433). The screen's state
// reaches its parts through contexts split by who reads what, each value
// memoised over its own fields (`notebook/context.tsx`), so a part renders
// again for a change to what it reads and for nothing else. Before the
// split it was one context whose value was a fresh object on every render
// of the screen, and every part rendered for every change.
//
// The screen is drawn as `ProjectView` draws it: its one body element
// (`PROJECT_SCREEN`, the header, the notebook with its rail, six cells and
// map, and the footer) under `ProjectProviders`, with the state made from
// `defaultProjectState` as `renderCell` makes it. The element is made once,
// so a render of the screen reaches a part only through the contexts it
// reads, and the cells only through those and the notebook's own slots,
// which pass a cell by when its number, state and openness are unchanged.
//
// Each count is of an adapter's own renders: its module mocked to a
// function that counts each call and draws what the adapter draws (the
// function itself, or the one inside it if it is ever wrapped in `memo`).
// A `Profiler` cannot count these. React 19 finds a context's readers late,
// as it passes them, so a `Profiler` that is not itself drawn again is not
// told of a render only the context caused (measured here: a reader
// rendered twice and the `Profiler` said "mount" once), and one that is
// drawn again says "update" whether anything under it rendered or not.
//
// And the render helper's own queries, which every rendered test leans on:
// a helper that answered nothing for a control that is not there would let
// a test pass over it.

import { act, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExportSnapshot } from '../../src/renderer/src/engine/exportRun'
import type { RunSnapshot } from '../../src/renderer/src/engine/layoutRun'
import { ProjectProviders, type ProjectState } from '../../src/renderer/src/notebook/context'
import ProjectView, { PROJECT_SCREEN } from '../../src/renderer/src/ProjectView'
import { useSnapshot } from '../../src/renderer/src/useSnapshot'
import type { Inspection } from '../../src/shared/protocol'
import { BASE, defaultProjectState, INSPECTION } from '../support/project-state'
import {
  answered,
  byName,
  cleanup,
  press,
  renderCell,
  renderPanel,
  type ApiStub,
} from '../support/render'
import { snap, StandInRun } from '../support/stand-in-run'

/** The parts counted: the six cells, the header and the footer, the map and the outputs. */
type Part =
  | 'data'
  | 'process'
  | 'frame'
  | 'style'
  | 'lines'
  | 'export'
  | 'header'
  | 'footer'
  | 'preview'
  | 'outputs'

const { renders, counting } = vi.hoisted(() => {
  const renders: Record<string, number> = {}
  // The adapter itself, or the function inside it should it be wrapped in
  // `memo`, called as React would call it, once per render, counted.
  const counting = (part: string, original: unknown) => {
    const draw = (
      typeof original === 'function' ? original : (original as { type: unknown }).type
    ) as (props: object) => unknown
    renders[part] = 0
    return function Counted(props: object) {
      renders[part] += 1
      return draw(props)
    }
  }
  return { renders, counting }
})

vi.mock('../../src/renderer/src/notebook/cells/DataCell', async (original) => {
  const module = await original<typeof import('../../src/renderer/src/notebook/cells/DataCell')>()
  return { ...module, default: counting('data', module.default) }
})
vi.mock('../../src/renderer/src/notebook/cells/ProcessCell', async (original) => {
  const module =
    await original<typeof import('../../src/renderer/src/notebook/cells/ProcessCell')>()
  return { ...module, default: counting('process', module.default) }
})
vi.mock('../../src/renderer/src/notebook/cells/FrameCell', async (original) => {
  const module = await original<typeof import('../../src/renderer/src/notebook/cells/FrameCell')>()
  return { ...module, default: counting('frame', module.default) }
})
vi.mock('../../src/renderer/src/notebook/cells/StyleCell', async (original) => {
  const module = await original<typeof import('../../src/renderer/src/notebook/cells/StyleCell')>()
  return { ...module, default: counting('style', module.default) }
})
vi.mock('../../src/renderer/src/notebook/cells/LinesCell', async (original) => {
  const module = await original<typeof import('../../src/renderer/src/notebook/cells/LinesCell')>()
  return { ...module, default: counting('lines', module.default) }
})
vi.mock('../../src/renderer/src/notebook/cells/ExportCell', async (original) => {
  const module = await original<typeof import('../../src/renderer/src/notebook/cells/ExportCell')>()
  return { ...module, default: counting('export', module.default) }
})
vi.mock('../../src/renderer/src/notebook/ProjectHeader', async (original) => {
  const module = await original<typeof import('../../src/renderer/src/notebook/ProjectHeader')>()
  return { ...module, default: counting('header', module.default) }
})
vi.mock('../../src/renderer/src/notebook/ProjectFooter', async (original) => {
  const module = await original<typeof import('../../src/renderer/src/notebook/ProjectFooter')>()
  return { ...module, default: counting('footer', module.default) }
})
vi.mock('../../src/renderer/src/notebook/Preview', async (original) => {
  const module = await original<typeof import('../../src/renderer/src/notebook/Preview')>()
  return { ...module, default: counting('preview', module.default) }
})
vi.mock('../../src/renderer/src/notebook/Outputs', async (original) => {
  const module = await original<typeof import('../../src/renderer/src/notebook/Outputs')>()
  return { ...module, default: counting('outputs', module.default) }
})
// `ProjectView` itself, drawn over a state the test hands it: its own hook
// answers what `screenState.current` holds.
const screenState = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('../../src/renderer/src/notebook/useProjectState', async (original) => ({
  ...(await original<typeof import('../../src/renderer/src/notebook/useProjectState')>()),
  useProjectState: () => screenState.current,
}))
// The engine's page is not what is counted, and its frame is the main
// process's to drive: the map's block is drawn around nothing.
vi.mock('../../src/renderer/src/Viewer', async (original) => {
  const module = await original<typeof import('../../src/renderer/src/Viewer')>()
  return { ...module, default: () => null }
})

afterEach(cleanup)

/** Every part's count from now on. */
function counted(): Record<Part, number> {
  for (const part of Object.keys(renders)) renders[part] = 0
  return renders as Record<Part, number>
}

/** Each part with the count given, and every other part at zero. */
const only = (rendered: Partial<Record<Part, number>>): Record<Part, number> => ({
  data: 0,
  process: 0,
  frame: 0,
  style: 0,
  lines: 0,
  export: 0,
  header: 0,
  footer: 0,
  preview: 0,
  outputs: 0,
  ...rendered,
})

/**
 * Nothing renders while nothing changes: whatever the screen asked as it
 * mounted, or as a row set it up, has answered and been drawn, so a read
 * that settles late is not counted as the change that follows.
 */
async function still(): Promise<void> {
  const idle = counted()
  await answered()
  expect(idle, 'the screen is still before the change').toEqual(only({}))
}

/**
 * The feed's three lines as the default inspection has them, with the rest
 * of what cell 01 says of a feed: its stop count, its tables, its trips.
 */
const inspected = Promise.resolve({
  ...INSPECTION,
  tables: ['agency', 'routes', 'stops', 'trips', 'stop_times', 'calendar'],
  agencies: [],
  stops: { stops: 3, stations: 0, entrances: 0, generic_nodes: 0, boarding_areas: 0, total: 3 },
  trips: 3,
  frequency_trips: 0,
  service: null,
  suggested_mode: 'subway',
  warnings: [],
} as Inspection)

/** Never answers: a request still on its way. */
const pending = <T,>(): Promise<T> => new Promise<T>(() => undefined)

/**
 * The stand-in run with the two things the screen's cells call of a run as
 * they render, and nothing that starts anything: no job yet, and a flush
 * before a start that has nothing to flush.
 */
class ScreenRun extends StandInRun {
  job(): null {
    return null
  }
  beforeStart(): () => void {
    return () => undefined
  }
}

/** The export a frame at a time: running, at frame `at`. */
const exportFrame = (at: number): ExportSnapshot => ({
  state: 'running',
  stages: [],
  message: `Frame ${at} of 300`,
  error: null,
  file: null,
  left: false,
  refused: false,
  announced: null,
})

/** The bridge as far as the screen reaches it: no outputs yet, and a map that answers nothing. */
const SCREEN_API: ApiStub = {
  export: { outputs: async () => [], preview: () => pending() },
  viewer: {
    attach: async () => true,
    release: async () => undefined,
    call: () => pending(),
    seams: () => pending(),
  },
}

interface Screen {
  /** The screen drawn again with these fields of its state changed, on top of the ones before. */
  rerender(patch?: Partial<ProjectState>): void
  run: ScreenRun
}

/** The project screen, drawn as `ProjectView` draws it, over the default state and `state`. */
function renderScreen(state: Partial<ProjectState> = {}): Screen {
  const run = new ScreenRun()
  const base: ProjectState = { ...defaultProjectState(run), inspect: () => inspected }
  let patch = state

  function Drawn({ given }: { given: Partial<ProjectState> }): JSX.Element {
    const snapshot = useSnapshot<RunSnapshot>(run)
    return (
      <ProjectProviders
        state={{
          ...base,
          runSnapshot: snapshot,
          layingOut: snapshot.state === 'running',
          ...given,
        }}
      >
        {PROJECT_SCREEN}
      </ProjectProviders>
    )
  }

  const view = renderPanel(<Drawn given={patch} />, { api: SCREEN_API })
  return {
    rerender: (next = {}) => {
      patch = { ...patch, ...next }
      view.rerender(<Drawn given={patch} />)
    },
    run,
  }
}

describe('the project screen, counted', () => {
  it('draws every part it counts', async () => {
    // So a count of zero below is a part that did not render, and not one
    // that is not on the screen.
    counted()
    renderScreen()
    await answered()
    for (const [part, count] of Object.entries(renders))
      expect(count, `${part} is drawn`).toBeGreaterThan(0)
  })

  it('renders nothing again for a render of the screen that changes nothing', async () => {
    // Row 1. Mutation: a context's value not memoised (the fields spread
    // into a fresh object in `ProjectProviders`) - every reader of it
    // renders, and this fails.
    const screen = renderScreen()
    await answered()
    await still()
    const count = counted()
    screen.rerender({})
    expect(count).toEqual(only({}))
  })

  it('renders the footer alone for a keystroke in the rename field', async () => {
    // Row 2. The rename's field is the footer's own state (`useRename` in
    // `ProjectFooter.tsx`), so a keystroke renders the footer and nothing
    // else. Held in the screen's state, as it was before issue 433, every
    // part rendered for every keystroke. Mutation: the field's typing not
    // reaching the form (`onChange` doing nothing) - the footer's count is
    // zero, so the row does see the keystroke it counts.
    renderScreen()
    await answered()
    press('Rename')
    const field = byName('textbox', 'New name') as HTMLInputElement
    await still()
    const count = counted()
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        field,
        'Los Angeles 2',
      )
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(count).toEqual(only({ footer: 1 }))
  })

  it('renders cell 04 alone when its heading is pressed', async () => {
    // Whether a cell is open is the one prop of a notebook slot a person
    // changes by hand: the column holds it, so the column renders, and the
    // slot of the cell pressed is the only one whose props moved. Mutation:
    // the slot passing a cell by whatever its `open` - the press renders
    // nothing.
    renderScreen()
    await answered()
    const toggle = document.querySelector<HTMLElement>(
      '.cell[data-cell="04"] button[aria-expanded]',
    )
    if (toggle === null) throw new Error('cell 04 has no heading to press')
    expect(toggle.getAttribute('aria-expanded'), 'cell 04 opens open').toBe('true')
    await still()
    const count = counted()
    act(() => toggle.click())
    expect(count).toEqual(only({ style: 1 }))
    expect(toggle.getAttribute('aria-expanded'), 'the press closed it').toBe('false')
  })

  it('renders cell 06, the header and the outputs for a frame of the export', async () => {
    // Row 3. A frame is the most frequent change on the screen and three
    // parts read it: cell 06 (its strip), the header (the run graph) and
    // the outputs (which read the folder again when the run's state moves).
    // The notebook reads it too, for the run graph, and passes the five
    // other cells by: their state did not change. Mutations: `exporting`
    // put back in the export's context - the five cells that read whether
    // an export goes render on every frame; the notebook's cell slot not
    // memoised - the same five render with the column; cell 06's strip read
    // from the run's own snapshot - cell 06 does not render, and its strip
    // goes stale.
    const screen = renderScreen()
    await answered()
    screen.rerender({ exporting: true, exportSnapshot: exportFrame(1) })
    await answered()
    await still()
    const count = counted()
    screen.rerender({ exportSnapshot: exportFrame(2) })
    expect(count).toEqual(only({ export: 1, header: 1, outputs: 1 }))
  })

  it('renders every cell for a move of the layout run, by design', async () => {
    // Row 4. Every cell's row shows its own progress
    // (`runRowStatus(runSnapshot, cell.id)`) and every cell reads the
    // run's state, so a run snapshot renders all six; the header says the
    // notebook's state, and the footer's Delete is held while a layout
    // goes. This is the design, not a split to make: a change here that
    // brings a cell's count to zero has stopped it showing the run. The map
    // and the outputs read none of it. Mutation: the rail's outputs slot not
    // memoised - the outputs render with the rail, which the column renders.
    const screen = renderScreen()
    await answered()
    await still()
    const count = counted()
    act(() => screen.run.move(snap('running')))
    expect(count).toEqual(
      only({ data: 1, process: 1, frame: 1, style: 1, lines: 1, export: 1, header: 1, footer: 1 }),
    )
  })

  it('renders the map and cell 03 alone for a redraw count, and the map alone for a reload', async () => {
    // Row 5, the slice rule's. `drawn` is the map's address and cell 03's
    // transport polls the page again on it; `themeReloads` is the map's
    // address and nobody else's. Neither may sit where another cell
    // subscribes. Mutation: `themeReloads` in the slice with `drawn` -
    // cell 03 renders for a reload it does not read.
    const screen = renderScreen()
    await answered()
    await still()
    const count = counted()
    screen.rerender({ drawn: 1 })
    expect(count, 'a redraw').toEqual(only({ preview: 1, frame: 1 }))
    counted()
    screen.rerender({ themeReloads: 1 })
    expect(count, 'a reload').toEqual(only({ preview: 1 }))
  })

  it('renders cells 02 and 03 alone for what the opening redrew', async () => {
    // `redrawAsked` and `openedSeams` are what cells 02 and 03 say of the
    // page the screen opened on (issue 517). Mutation: the two in the
    // slice with `drawn` - the map renders for them too.
    const screen = renderScreen()
    await answered()
    await still()
    const count = counted()
    screen.rerender({ redrawAsked: 'job-9' })
    expect(count, 'the redraw asked').toEqual(only({ process: 1, frame: 1 }))
    counted()
    screen.rerender({ openedSeams: ['setTheme'] })
    expect(count, 'the seams heard').toEqual(only({ process: 1, frame: 1 }))
  })

  it('renders the map alone for the decision it settled on for the page it opened', async () => {
    // `onOpen` is said on the map's section and read by nothing else (issue
    // 596). Mutation: it in the opening's slice - cells 02 and 03 render
    // for it too.
    const screen = renderScreen()
    await answered()
    await still()
    const count = counted()
    screen.rerender({ onOpen: 'never' })
    expect(count, 'the decision').toEqual(only({ preview: 1 }))
  })

  it('renders every part that shows the record for a write’s answer, by design', async () => {
    // Every cell, the header, the footer, the map and the outputs show the
    // record, so an answer to a write renders them all: the record is what
    // they draw.
    const screen = renderScreen()
    await answered()
    await still()
    const count = counted()
    screen.rerender({ project: { ...defaultProjectState().project!, date: '2026-09-13' } })
    expect(count).toEqual(
      only({
        data: 1,
        process: 1,
        frame: 1,
        style: 1,
        lines: 1,
        export: 1,
        header: 1,
        footer: 1,
        preview: 1,
        outputs: 1,
      }),
    )
  })
})

describe('the project screen as ProjectView draws it, counted', () => {
  it('renders nothing again when the screen renders with nothing changed', async () => {
    // The rows above draw `PROJECT_SCREEN` themselves; this holds
    // `ProjectView` to drawing that one element, over its own hook. Its
    // hook hands back a fresh object on every render, as the real one
    // does. Mutation: the body written inside `ProjectView` again - a new
    // element on every render, so every part renders with it.
    const state: ProjectState = {
      ...defaultProjectState(new ScreenRun()),
      inspect: () => inspected,
    }
    screenState.current = state
    const view = renderPanel(<ProjectView id={BASE.id} onBack={() => undefined} />, {
      api: SCREEN_API,
    })
    await answered()
    await still()
    const count = counted()
    screenState.current = { ...state }
    view.rerender(<ProjectView id={BASE.id} onBack={() => undefined} />)
    expect(count).toEqual(only({}))
  })
})

describe('a cell drawn through the render helper, counted', () => {
  it('renders the lines cell no more for a field it does not read', async () => {
    // `renderCell` draws under the same `ProjectProviders` the screen does,
    // so this holds the harness to the screen: a split the harness did not
    // pass through would count above zero here. `themeReloads` is the map
    // frame's and none of cell 05's business. Mutation: `renderCell`
    // drawing the cell's element afresh on every render of its screen -
    // the count goes above zero.
    const view = renderCell('lines')
    await answered()
    await still()
    const count = counted()
    view.rerender({ themeReloads: 1 })
    expect(count.lines).toBe(0)
  })
})

// Two tests in order: the first stubs the bridge with a spy, the second
// finds it gone. Mutation: `cleanup` not putting `window.api` back - the
// second fails on the spy still there.
describe('the render helper puts the bridge back between tests', () => {
  const spy = vi.fn(async () => {
    throw new Error('not this test’s bridge')
  })

  it('stubs the bridge a test hands it', () => {
    renderPanel(<p>Nothing to draw</p>, { api: { projects: { get: spy } } })
    expect(window.api.projects.get).toBe(spy)
  })

  it('and the next test finds no bridge at all', () => {
    expect((window as { api?: unknown }).api).toBeUndefined()
  })
})

describe('the render helper finds a control by its role and name', () => {
  it('throws, saying what it looked for, when no control has the name', () => {
    // Mutation: `byName` answering `undefined` for no match rather than
    // throwing - this fails, and a press of a control that is not drawn
    // would pass a test by doing nothing.
    renderPanel(<button type="button">Lay out</button>)
    expect(() => byName('button', 'Lay out again')).toThrow(
      'no button named "Lay out again" is drawn',
    )
    expect(() => press('Lay out again')).toThrow('no button named "Lay out again"')
  })

  it('throws when two controls have the name, rather than choosing one', () => {
    renderPanel(
      <>
        <button type="button">Cancel</button>
        <button type="button">Cancel</button>
      </>,
    )
    expect(() => byName('button', 'Cancel')).toThrow('2 of role button are named "Cancel"')
  })

  it('looks only within its own screen when asked through that screen', () => {
    // Mutation: a screen's `byName` and `press` searching the whole
    // document - the two screens' Go buttons are then two of one name.
    const pressed = vi.fn()
    const first = renderPanel(
      <button type="button" onClick={() => pressed('first')}>
        Go
      </button>,
    )
    const second = renderPanel(
      <button type="button" onClick={() => pressed('second')}>
        Go
      </button>,
    )
    expect(first.byName('button', 'Go')).toBe(first.host.querySelector('button'))
    second.press('Go')
    expect(pressed.mock.calls).toEqual([['second']])
    expect(() => byName('button', 'Go'), 'the document holds both').toThrow('2 of role button')
  })

  it('answers the kit button’s inner button, which a press reaches', async () => {
    renderCell('lines')
    await answered()
    const inner = byName('button', 'Move line A down')
    expect(inner.localName).toBe('button')
    const root = inner.getRootNode()
    expect(root instanceof ShadowRoot && root.host.localName).toBe('fig-button')
  })

  it('presses with a real click, which a disabled button does not take', () => {
    const pressed = vi.fn()
    renderPanel(
      <>
        <button type="button" onClick={() => pressed('go')}>
          Go
        </button>
        <button type="button" disabled onClick={() => pressed('held')}>
          Held
        </button>
      </>,
    )
    press('Go')
    press('Held')
    expect(pressed.mock.calls).toEqual([['go']])
  })
})
