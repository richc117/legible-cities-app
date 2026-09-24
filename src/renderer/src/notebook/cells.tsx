import type { ComponentType } from 'react'
import type { Cell, CellId, CellState } from '../runGraph'
import DataCell from './cells/DataCell'
import ExportCell from './cells/ExportCell'
import FrameCell from './cells/FrameCell'
import LinesCell from './cells/LinesCell'
import ProcessCell from './cells/ProcessCell'
import StyleCell from './cells/StyleCell'

// Which view draws which cell (A5.5-08).
//
// A registry that never grows: ADR-045 fixes the six cells and their
// numbers, so this table is complete and a seventh entry would be a
// different decision rather than a different branch. It exists so that
// `Notebook.tsx` walks `CELL_LIST` without naming a single adapter, and so
// that a cell's own branch edits one file under `cells/` and no other.

/** What a cell's view is given: which cell it is, how it stands, and whether it is open. */
export interface CellViewProps {
  /** The cell's number and name, fixed by ADR-045 and taken from `CELL_LIST`. */
  cell: Cell
  /** Derived from the record and the runs in flight, never held as a flag (A5.5-04). */
  state: CellState
  /**
   * Whether the cell is open. The notebook holds it, not the cell: where a
   * person is looking is one answer per screen, not six independent ones.
   */
  open: boolean
  onToggle: (open: boolean) => void
}

export const CELL_VIEWS: Record<CellId, ComponentType<CellViewProps>> = {
  data: DataCell,
  process: ProcessCell,
  frame: FrameCell,
  style: StyleCell,
  lines: LinesCell,
  export: ExportCell,
}
