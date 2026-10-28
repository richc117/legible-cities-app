// @vitest-environment jsdom
// Landing on a cell (issue 433, ADR-045): the map's empty state sends a
// person to cell 02, and the rail's steps and the Outputs' empty state send
// one to their cell. A closed cell is opened first, and the landing - focus
// on the cell's heading, then the scroll that brings it clear of the header
// - is measured against the cell once it is open, never against the closed
// one about to grow, which would land short (`landOnCell` in `Rail.tsx`).
//
// The open is committed with `flushSync` before the landing, in the press
// itself. Before issue 433 it was a state that a layout effect landed on.
// So what is held here is what the document says at the moment
// `window.scrollTo` is called: the cell open, and its heading holding the
// focus. `tests/unit/rail.test.tsx` holds `goToCell`'s order with spies,
// which would pass without the commit; the rendered press is what sees it.
//
// The column is drawn as `ProjectView` draws it, under `ProjectProviders`
// over the default state; the engine's page is drawn as nothing. jsdom has
// no `matchMedia`, which the landing reads for reduced motion; this file
// gives it one that never matches.
//
// Mutations, each watched failing (`notebook-landing.mutations.json`):
// `flushSync` dropped from the map's empty state - cell 02 is still closed
// at the scroll; `flushSync` dropped from `goToCell` - the step's cell is
// still closed at the scroll.

import { type JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectProviders, type ProjectState } from '../../src/renderer/src/notebook/context'
import Notebook from '../../src/renderer/src/notebook/Notebook'
import {
  answered,
  BASE,
  cleanup,
  defaultProjectState,
  press,
  renderPanel,
  type ApiStub,
} from '../support/render'
import { StandInRun } from '../support/stand-in-run'

vi.mock('../../src/renderer/src/Viewer', async (original) => ({
  ...(await original<typeof import('../../src/renderer/src/Viewer')>()),
  default: () => null,
}))

/** Never answers: a request still on its way. */
const pending = <T,>(): Promise<T> => new Promise<T>(() => undefined)

/** The bridge as far as the column reaches it: no outputs yet, and a map that answers nothing. */
const API: ApiStub = {
  export: { outputs: async () => [], preview: () => pending() },
  viewer: {
    attach: async () => true,
    release: async () => undefined,
    call: () => pending(),
    seams: () => pending(),
  },
}

/**
 * The stand-in run with the two things the cells call of a run as they
 * render, and nothing that starts anything, as `cell-renders.test.tsx` has
 * it.
 */
class ScreenRun extends StandInRun {
  job(): null {
    return null
  }
  beforeStart(): () => void {
    return () => undefined
  }
}

/** What the document said when the landing scrolled. */
interface AtScroll {
  expanded: string | null
  focused: boolean
}

let scrolls: AtScroll[]
/** The cell, by its number, whose state each scroll records. */
let watched: string

const cellOf = (number: string): HTMLElement => {
  const cell = document.querySelector<HTMLElement>(`.cell[data-cell="${number}"]`)
  if (cell === null) throw new Error(`cell ${number} is not drawn`)
  return cell
}
const toggleOf = (number: string): HTMLElement => {
  const toggle = cellOf(number).querySelector<HTMLElement>('button[aria-expanded]')
  if (toggle === null) throw new Error(`cell ${number} has no heading to press`)
  return toggle
}
const headingOf = (number: string): HTMLElement | null =>
  cellOf(number).querySelector<HTMLElement>('.disclosure-heading')

beforeEach(() => {
  scrolls = []
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query }),
  })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {
    scrolls.push({
      expanded: toggleOf(watched).getAttribute('aria-expanded'),
      focused: document.activeElement !== null && document.activeElement === headingOf(watched),
    })
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete (window as { matchMedia?: unknown }).matchMedia
})

/** The column over the default state with `state` laid over it. */
async function column(state: Partial<ProjectState> = {}): Promise<void> {
  // The feed's inspection still on its way: cell 01 is not what is landed on.
  const drawn: ProjectState = {
    ...defaultProjectState(new ScreenRun()),
    inspect: () => pending(),
    ...state,
  }
  function Screen(): JSX.Element {
    return (
      <ProjectProviders state={drawn}>
        <Notebook />
      </ProjectProviders>
    )
  }
  renderPanel(<Screen />, { api: API })
  await answered()
}

describe('the map’s empty state', () => {
  it('opens cell 02 before it lands on it', async () => {
    // A project with no layout opens with cell 02 open; a person closed it.
    await column({ project: { ...BASE, layout: null, made: null, readOnly: false } })
    watched = '02'
    press('Lay it out in cell 02.')
    expect(scrolls, 'it has not landed while the cell is open').toEqual([
      { expanded: 'true', focused: true },
    ])
    scrolls = []
    toggleOf('02').click()
    await answered()
    expect(toggleOf('02').getAttribute('aria-expanded'), 'closed by hand').toBe('false')
    press('Lay it out in cell 02.')
    expect(scrolls).toEqual([{ expanded: 'true', focused: true }])
  })
})
