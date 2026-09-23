import type { ProjectRecord } from '../../shared/project'
import type { ExportSnapshot } from './engine/exportRun'
import type { RunSnapshot } from './engine/layoutRun'
import { sameOrder } from './order'

// The run graph: the six cells of the notebook, the order they run in, and
// each one's state derived from the project's record and the runs in flight
// (ADR-045, A5.5-04). Pure - no React, no Electron, no filesystem, no
// clock - so the whole model is a table of records in a unit test rather
// than six conditions spread through six views that can disagree.
//
// Contract: specs/028-the-notebook/contracts/run-graph.md, which the cell
// issues cite rather than restating.
//
// Two things make it a derivation rather than a set of flags. A run says
// which cell it belongs to through its own snapshot, so nothing has to be
// told; and the record says what the map on screen was drawn from, in
// `drawn`, so staleness is the record compared against itself.

/** The six cells, in the order they run: upstream first (ADR-045). */
export const CELLS = ['data', 'process', 'frame', 'style', 'lines', 'export'] as const

export type CellId = (typeof CELLS)[number]

/**
 * A cell's number and name, fixed by ADR-045: they are in the rail, the
 * stepper, the issue codes and every screenshot, so a thin cell stays a
 * cell rather than being renumbered away.
 */
export interface Cell {
  id: CellId
  /** 1 to 6, written `01` to `06` on screen. */
  number: number
  name: string
}

export const CELL_LIST: readonly Cell[] = [
  { id: 'data', number: 1, name: 'Data' },
  { id: 'process', number: 2, name: 'Process' },
  { id: 'frame', number: 3, name: 'Frame and service day' },
  { id: 'style', number: 4, name: 'Style' },
  { id: 'lines', number: 5, name: 'Lines' },
  { id: 'export', number: 6, name: 'Export' },
]

/**
 * What a cell is doing, said on screen as an icon and a word and never as a
 * colour alone (DESIGN.md 8.2). `stale` is not a warning about the app: it
 * says the map on screen was drawn before a change above it, and the map
 * and its controls stay exactly where they are until a person re-runs.
 */
export type CellState = 'ready' | 'running' | 'stale' | 'error'

/**
 * Why a cell is in the state it is in, for the sentence the cell and the
 * rail say. `upstream` is a cell made stale by a cell above it rather than
 * by anything of its own, which is every stale cell but the first.
 */
export type CellReason =
  /** The mode or the operator has moved since the stored layout was built. */
  | 'inputs'
  /** The record names a layout the map on screen was not drawn from. */
  | 'layout'
  /** The same layout, laid out again since this project drew from it (A3-06). */
  | 'relaid'
  /** A re-layout replaced the stored set and no map was drawn from it (A3-05). */
  | 'replaced'
  /** The service day has moved since the map was drawn. */
  | 'day'
  /** A run of this cell's own failed. */
  | 'failed'
  /** A cell above this one is stale or in error. */
  | 'upstream'

export interface CellStatus {
  state: CellState
  /** Null exactly when the state is `ready` or `running`. */
  because: CellReason | null
}

/**
 * What the derivation reads of a layout run. `Pick` rather than a fresh
 * shape so that a field renamed in `RunSnapshot` is a build error here
 * rather than a cell that silently stops reporting.
 */
export type RunFacts = Pick<
  RunSnapshot,
  'state' | 'rebuilt' | 'recoloured' | 'reordered' | 'replaced'
>

/** What the derivation reads of an export. */
export type ExportFacts = Pick<ExportSnapshot, 'state'>

export interface RunGraphInput {
  record: ProjectRecord
  /** The project's one layout run, whatever kind it last was; null before one exists. */
  run: RunFacts | null
  /** The project's one export; null before one exists. */
  exportRun: ExportFacts | null
}

/**
 * Which cell a layout run belongs to, from the snapshot's own flags: a
 * rebuild for a chosen day is cell 03's, a recolour or a reorder is cell
 * 05's, and anything else - a layout, a re-layout - is cell 02's. An idle
 * run belongs to no cell.
 *
 * It is one function rather than a condition in each view because getting
 * it wrong shows `running` on the wrong cell for minutes at a time, and one
 * function can be held to a table.
 */
export function cellOfRun(run: RunFacts | null): CellId | null {
  if (run === null || run.state === 'idle') return null
  if (run.rebuilt) return 'frame'
  if (run.recoloured || run.reordered) return 'lines'
  return 'process'
}

/**
 * A source of staleness: a value that has moved since the map was drawn,
 * named with the cell it belongs to. A source marks the cells *below* its
 * own stale and never its own cell, because the cell holding the change
 * shows the change - what is behind is everything drawn from it.
 */
export interface StaleSource {
  cell: CellId
  reason: CellReason
}

const at = (cell: CellId): number => CELLS.indexOf(cell)

/**
 * Everything about this project that has moved since the map on screen was
 * drawn, in cell order.
 *
 * The cheap edits are deliberately absent: the colours, the order and the
 * theme redraw themselves as A4-01, A4-02 and A4-03 built them, so their
 * cell reads `running` while they do and never `stale` (ADR-045). Their
 * values are still kept in `drawn`, because Revert reads them (A5.5-12).
 *
 * A record with no `drawn` raises nothing but the inputs: a project from
 * before the field existed cannot be proved current, and an old project's
 * map is not wrong. The inputs are the exception because they are compared
 * against `built`, which is what the engine made the stored layout with and
 * has been on the record since A2-02.
 */
export function stalenessOf(record: ProjectRecord, run: RunFacts | null): StaleSource[] {
  const sources: StaleSource[] = []
  const { built, drawn } = record
  // Cell 01 holds the mode and the operator, and a change to either is the
  // expensive edit: the engine names a layout by its inputs, so the stored
  // layout is of something else now (A2-02, A5.5-09).
  if (built !== null && (built.mode !== record.mode || built.agency !== record.agency))
    sources.push({ cell: 'data', reason: 'inputs' })
  if (drawn !== null) {
    // Cell 02 holds the layout. The record naming one the page was not
    // drawn from is a layout produced with no map made from it.
    if (drawn.layout !== record.layout) sources.push({ cell: 'process', reason: 'layout' })
    // The same id under a different `made` is the same inputs laid out
    // again since this project drew from them (A3-06): the id alone cannot
    // see it, which is why `drawn` carries both.
    else if (drawn.made !== record.made) sources.push({ cell: 'process', reason: 'relaid' })
    // Cell 03 holds the service day.
    if (drawn.date !== record.date) sources.push({ cell: 'frame', reason: 'day' })
  }
  // A re-layout that answered and then stopped before the map was drawn
  // left the stored set replaced, so the page is of geometry that is gone
  // (A3-05). Nothing on the record can see it; the run can.
  if (run !== null && run.replaced) sources.push({ cell: 'process', reason: 'replaced' })
  return sources.sort((a, b) => at(a.cell) - at(b.cell))
}

/**
 * Every cell's state, from the record and the runs in flight.
 *
 * Per cell, in order: a run of its own that is going reads `running`; one
 * that failed reads `error`; a source above it reads `stale`; otherwise
 * `ready`. A cancelled run is not an error - Stop returns a cell to what it
 * was - and a running cell makes nothing below it stale, because running is
 * not a change to anything yet.
 *
 * The four cheap-edit exemptions of ADR-045 fall out of `stalenessOf`
 * raising no source for a colour, a default colour, an order or a theme.
 */
export function runGraph(input: RunGraphInput): Record<CellId, CellStatus> {
  const { record, run, exportRun } = input
  const running = cellOfRun(run)
  const failed = run !== null && run.state === 'failed' ? cellOfRun(run) : null
  const sources = stalenessOf(record, run)

  const states = {} as Record<CellId, CellStatus>
  for (const cell of CELLS) {
    const isExport = cell === 'export'
    if (isExport ? exportRun?.state === 'running' : running === cell && run?.state === 'running') {
      states[cell] = { state: 'running', because: null }
      continue
    }
    if (isExport ? exportRun?.state === 'failed' : failed === cell) {
      states[cell] = { state: 'error', because: 'failed' }
      continue
    }
    // A cell in error is a source for the cells below it, exactly as a
    // change is: the map below a failed run is of what came before it.
    const above = sources.find((source) => at(source.cell) < at(cell))
    const errorAbove = failed !== null && at(failed) < at(cell)
    if (above !== undefined || errorAbove) {
      states[cell] = { state: 'stale', because: above?.reason ?? 'upstream' }
      continue
    }
    states[cell] = { state: 'ready', because: null }
  }
  return states
}

/**
 * Whether the record's colours, order or theme are the ones the map on
 * screen carries. Not a staleness source - the cheap edits redraw
 * themselves - but Revert and a cell's summary both need the answer
 * (A5.5-12, A5.5-18).
 */
export function drawnMatchesEdits(record: ProjectRecord): boolean {
  const { drawn } = record
  if (drawn === null) return true
  const labels = Object.keys(record.colors)
  return (
    drawn.defaultColor === record.defaultColor &&
    drawn.theme === record.theme &&
    sameOrder(drawn.lineOrder, record.lineOrder) &&
    labels.length === Object.keys(drawn.colors).length &&
    labels.every((label) => drawn.colors[label] === record.colors[label])
  )
}
