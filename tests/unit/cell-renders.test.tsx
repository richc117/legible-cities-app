// @vitest-environment jsdom
// How often a cell renders, counted (ADR-059, measurement 10; codebase
// review R4-02, issue 433). Every cell reads the whole project screen's
// state through one context, so a render of the provider that changes
// nothing a cell shows renders every cell again. This file counts it, so
// that the split which ends it (issue 433, part a) has a number to move.
//
// And the render helper's own queries, which every rendered test leans on:
// a helper that answered nothing for a control that is not there would let
// a test pass over it.

import { describe, expect, it, vi } from 'vitest'
import { answered, byName, press, renderCell, renderPanel } from '../support/render'

describe('the lines cell, counted', () => {
  it('renders again for a render of the provider that changes nothing it shows', async () => {
    // Mutation: the screen handing the provider the same state object for a
    // render that changes nothing (a `useMemo` over the patch in
    // `renderCell`) - React then skips the cell, the count is zero and this
    // fails. That is what issue 433a's split does for real, and it will turn
    // this assertion around (`toBe(0)`) when it lands.
    const commits: string[] = []
    const view = renderCell('lines', {}, { onRender: (_id, phase) => commits.push(phase) })
    await answered()
    expect(commits[0], 'the count starts at the cell’s first render').toBe('mount')
    const before = commits.length
    view.rerender({})
    const extra = commits.length - before
    expect(extra, 'every render of the provider renders the cell again, today').toBeGreaterThan(0)
    view.unmount()
  })
})

describe('the render helper finds a control by its role and name', () => {
  it('throws, saying what it looked for, when no control has the name', () => {
    // Mutation: `byName` answering `undefined` for no match rather than
    // throwing - this fails, and a press of a control that is not drawn
    // would pass a test by doing nothing.
    const view = renderPanel(<button type="button">Lay out</button>)
    expect(() => byName('button', 'Lay out again')).toThrow(
      'no button named "Lay out again" is drawn',
    )
    expect(() => press('Lay out again')).toThrow('no button named "Lay out again"')
    view.unmount()
  })

  it('throws when two controls have the name, rather than choosing one', () => {
    const view = renderPanel(
      <>
        <button type="button">Cancel</button>
        <button type="button">Cancel</button>
      </>,
    )
    expect(() => byName('button', 'Cancel')).toThrow('2 of role button are named "Cancel"')
    view.unmount()
  })

  it('answers the kit button’s inner button, which a press reaches', async () => {
    const view = renderCell('lines')
    await answered()
    const inner = byName('button', 'Move line A down')
    expect(inner.localName).toBe('button')
    const root = inner.getRootNode()
    expect(root instanceof ShadowRoot && root.host.localName).toBe('fig-button')
    view.unmount()
  })

  it('presses with a real click, which a disabled button does not take', () => {
    const pressed = vi.fn()
    const view = renderPanel(
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
    view.unmount()
  })
})
