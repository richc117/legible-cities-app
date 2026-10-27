// @vitest-environment jsdom
// How often a cell renders, counted (ADR-059, measurement 10; codebase
// review R4-02, issue 433). Every cell reads the whole project screen's
// state through one context, which is a fresh object on every render of the
// screen, so a change to a field a cell does not read renders it again. This
// file counts it, so that the split which ends it (issue 433, part a) has a
// number to move.
//
// The split must sit where `renderCell` passes through, or this count says
// nothing of the app: 433a puts it in one `ProjectProviders({ state,
// children })` in `notebook/context.tsx`, which `ProjectView` and the
// harness both draw, so the harness cannot drift from the screen. A split
// into slices must also keep `themeReloads` out of every slice `LinesCell`
// and its hooks read, or a sound split still counts above zero.
//
// The count is of the lines cell's own renders: its adapter, wrapped by a
// mock that counts each call and draws what the adapter draws (the function
// itself, or the one inside it if it is ever wrapped in `memo`). A
// `Profiler` cannot count these. React 19 finds a context's readers late, as
// it passes them, so a `Profiler` that is not itself drawn again is not told
// of a render only the context caused (measured here: a reader rendered
// twice and the `Profiler` said "mount" once), and one that is drawn again
// says "update" whether anything under it rendered or not.
//
// And the render helper's own queries, which every rendered test leans on:
// a helper that answered nothing for a control that is not there would let
// a test pass over it.

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CellViewProps } from '../../src/renderer/src/notebook/cells'
import { answered, byName, cleanup, press, renderCell, renderPanel } from '../support/render'

const renders = vi.hoisted(() => ({ lines: 0 }))

vi.mock('../../src/renderer/src/notebook/cells/LinesCell', async (original) => {
  const { default: LinesCell } =
    await original<typeof import('../../src/renderer/src/notebook/cells/LinesCell')>()
  const draw =
    typeof LinesCell === 'function'
      ? LinesCell
      : (LinesCell as unknown as { type: typeof LinesCell }).type
  return {
    default: function Counted(props: CellViewProps) {
      renders.lines += 1
      return draw(props)
    },
  }
})

afterEach(cleanup)

describe('the lines cell, counted', () => {
  it('renders no more when the screen changes a field the cell does not read', async () => {
    // `LinesCell` reads `project`, `engine`, `run`, `runSnapshot`,
    // `exporter`, `inspect`, `exporting` and `settling`; `themeReloads` is
    // the map frame's, and none of the cell's business. Since 433a's split
    // it sits in a context of its own, which the cell does not read, so the
    // count stays at zero. The whole screen's counts follow in the next
    // change.
    renders.lines = 0
    const view = renderCell('lines')
    await answered()
    expect(renders.lines, 'the count sees the cell drawn').toBeGreaterThan(0)
    const before = renders.lines
    view.rerender({ themeReloads: 1 })
    expect(renders.lines - before, 'a field the cell does not read').toBe(0)
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
