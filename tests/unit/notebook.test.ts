// The notebook's two decisions that are not visible in what it draws
// (A5.5-08): which cells a project's screen opens with, and what a press on
// cell 06's heading row does to the map's frame.
//
// Both were comments in a component until they were this. The first is a
// design decision (ADR-045, DESIGN.md 8.2) that nothing else records; the
// second is an ordering, and an ordering read from a file rather than run
// is how the map came to carry an export's frame over a closed cell.

import { describe, expect, it } from 'vitest'
import { START_OPEN } from '../../src/renderer/src/notebook/Notebook'
import { toggleExportCell } from '../../src/renderer/src/notebook/cells/ExportCell'
import { CELLS } from '../../src/renderer/src/runGraph'

describe('which cells a project opens with', () => {
  it('opens the five the Map tab showed, and leaves 06 closed as the Export tab was', () => {
    expect(START_OPEN).toEqual({
      data: true,
      process: true,
      frame: true,
      style: true,
      lines: true,
      export: false,
    })
  })

  it('answers for every cell, so none is drawn without one', () => {
    expect(Object.keys(START_OPEN).sort()).toEqual([...CELLS].sort())
  })
})

describe('a press on cell 06', () => {
  it('puts the plain map back in the same call the cell closes in', () => {
    const order: string[] = []
    const toggle = toggleExportCell(
      () => order.push('the plain map'),
      (open) => order.push(`the cell is ${open ? 'open' : 'closed'}`),
    )
    toggle(false)
    expect(order).toEqual(['the plain map', 'the cell is closed'])
  })

  it('takes nothing off the frame when the cell opens', () => {
    const order: string[] = []
    const toggle = toggleExportCell(
      () => order.push('the plain map'),
      (open) => order.push(`the cell is ${open ? 'open' : 'closed'}`),
    )
    toggle(true)
    expect(order).toEqual(['the cell is open'])
  })
})
