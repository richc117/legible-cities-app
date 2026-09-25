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
import { frameSummary } from '../../src/renderer/src/notebook/cells/FrameCell'
import { CELLS } from '../../src/renderer/src/runGraph'
import {
  DEFAULT_COLOR,
  DEFAULT_STYLE,
  DEFAULT_THEME,
  type DrawnFrom,
  type ProjectRecord,
} from '../../src/shared/project'
import { DEFAULT_CHOICE } from '../../src/shared/export'

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

// Cell 03's collapsed row (A5.5-15, issue 210). Prose, and a unit test
// because the sentence has to answer two questions at once - which day, and
// whether the map shows it - and carry the engine's own answer beside them
// without drawing a conclusion from the two.
describe("cell 03's summary", () => {
  const WINDOW = {
    start: '2026-01-01',
    end: '2026-12-31',
    busiest: '2026-09-15',
    anchor: '2026-09-08',
  }
  const LAYOUT = 'a'.repeat(64)
  const MADE = '2026-09-10T12:00:00+00:00'
  const drawn = (date: string | null): DrawnFrom => ({
    layout: LAYOUT,
    made: MADE,
    date,
    colors: {},
    defaultColor: DEFAULT_COLOR,
    lineOrder: [],
    theme: DEFAULT_THEME,
  })
  const project = (overrides: Partial<ProjectRecord> = {}): ProjectRecord => ({
    version: 1,
    id: 'aaaaaaaaaaaa',
    name: 'Los Angeles',
    feed: 'la-metro-rail',
    mode: 'all',
    agency: null,
    date: '2026-09-15',
    service: WINDOW,
    style: { ...DEFAULT_STYLE },
    colors: {},
    defaultColor: DEFAULT_COLOR,
    lineOrder: [],
    theme: DEFAULT_THEME,
    export: { ...DEFAULT_CHOICE },
    destination: null,
    layout: LAYOUT,
    built: { mode: 'all', agency: null },
    made: MADE,
    drawn: drawn('2026-09-15'),
    created: '2026-09-10T12:00:00.000Z',
    modified: '2026-09-10T12:00:00.000Z',
    ...overrides,
  })

  it('says nothing before a day has been resolved', () => {
    expect(frameSummary(null)).toBeNull()
    expect(frameSummary(project({ date: null, service: null, drawn: null }))).toBeNull()
  })

  it("draws the engine's own answer beside the day, rather than judging it", () => {
    expect(frameSummary(project())).toBe('2026-09-15; the engine’s busiest weekday is 2026-09-15')
  })

  it('says the map does not show a day that has been chosen and not drawn', () => {
    expect(frameSummary(project({ date: '2026-09-12' }))).toBe(
      '2026-09-12, not drawn yet; the engine’s busiest weekday is 2026-09-15',
    )
  })

  it('has only the day when there is no window to put beside it', () => {
    expect(frameSummary(project({ service: null, date: '2026-09-12' }))).toBe(
      '2026-09-12, not drawn yet',
    )
  })

  it('says nothing about a map it cannot prove is behind', () => {
    // A record from before `drawn` existed: unknown is not stale.
    expect(frameSummary(project({ date: '2026-09-12', drawn: null }))).toBe(
      '2026-09-12; the engine’s busiest weekday is 2026-09-15',
    )
  })

  it("is the drawn day's own sentence once the rebuild has answered", () => {
    expect(frameSummary(project({ date: '2026-09-12', drawn: drawn('2026-09-12') }))).toBe(
      '2026-09-12; the engine’s busiest weekday is 2026-09-15',
    )
  })

  // Issue 210. `feeds.service` is asked on every layout run with today as
  // the anchor and the fresh window is written while the day is kept
  // (`tests/unit/projects-store.test.ts`, "replaces the window on a later
  // run, keeping the day"), so this record - a day the **engine** chose at
  // the first run, under a window whose busiest weekday has since moved -
  // is one the app reaches by itself, without a person touching the date
  // control. The row said "the day you chose" about it.
  it('never credits a day to the person because the window moved under it', () => {
    const engines = project({
      date: '2026-09-15',
      service: { ...WINDOW, busiest: '2026-09-22', anchor: '2026-09-15' },
      drawn: drawn('2026-09-15'),
    })
    const said = frameSummary(engines) as string
    expect(said).toBe('2026-09-15; the engine’s busiest weekday is 2026-09-22')
    // Asserted as the whole sentence above, and again as the claim itself:
    // no wording of this row may assert whose choice the day was, in
    // either direction.
    expect(said).not.toMatch(/you chose|your choice/)
    expect(said, 'and the engine is credited with nothing either').not.toMatch(
      /the engine’s (own )?(day|choice)/,
    )
  })
})
