// @vitest-environment jsdom
// How often a cell renders, counted (ADR-059, measurement 10; codebase
// review R4-02, issue 433). Every cell reads the whole project screen's
// state through one context, which is a fresh object on every render of the
// screen, so a render that changes nothing a cell shows renders every cell
// again. This file counts it, so that the split which ends it (issue 433,
// part a) has a number to move.
//
// The count is of the lines cell's own renders: its adapter, wrapped by a
// mock that counts each call and draws what the adapter draws. A
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
  return {
    default: function Counted(props: CellViewProps) {
      renders.lines += 1
      return LinesCell(props)
    },
  }
})

afterEach(cleanup)

describe('the lines cell, counted', () => {
  it('renders again for a render of the screen that changes nothing it shows', async () => {
    // Mutation: the screen handing the provider the same state for a render
    // that changes nothing (`useMemo` over the patch in `renderCell`) - the
    // count is zero and this fails. That is what issue 433a's split does in
    // the app, and it will turn this assertion around (`toBe(0)`).
    renders.lines = 0
    const view = renderCell('lines')
    await answered()
    expect(renders.lines, 'the count sees the cell drawn').toBeGreaterThan(0)
    const before = renders.lines
    view.rerender({})
    expect(
      renders.lines - before,
      'every render of the screen renders the cell again, today',
    ).toBeGreaterThan(0)
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
