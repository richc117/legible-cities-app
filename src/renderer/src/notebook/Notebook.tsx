import {
  Fragment,
  memo,
  useCallback,
  useLayoutEffect,
  useState,
  type Dispatch,
  type JSX,
  type SetStateAction,
} from 'react'
import type { ProjectRecord } from '../../../shared/project/types'
import { CELL_LIST, runGraph, type Cell, type CellId, type CellState } from '../runGraph'
import { CELL_VIEWS } from './cells'
import { useProjectExport, useProjectRecord, useProjectRuns } from './context'
import Preview from './Preview'
import Rail, { landOnCell } from './Rail'

// The notebook: the six cells in one scrolling column, read top to bottom
// (ADR-045, docs/DESIGN.md 9), with the map between cells 02 and 03
// (ADR-046).
//
// It walks `CELL_LIST` and names no adapter: which view draws which cell is
// the registry's answer, so a cell's own branch edits its file under
// `cells/` and never this one. Each cell's state is derived from the
// record and the runs in flight (A5.5-04) rather than held as a flag here.
//
// Which cells are open is where a person is looking, not a setting, and is
// not stored - the same rule the tab strip it replaces followed.
//
// The map is a child of the column, after cell 02 and before cell 03: where
// it is made, and just above the cells that act on it (ADR-046, DESIGN.md
// 8.2, "The map"). It is rendered in the same place in every render - in
// cell 02's fragment, whatever the record says - so the frame inside it is
// never moved between parents, which is the one operation ADR-045 forbids
// and ADR-046 keeps forbidding. Nothing in the column is pinned.
//
// The column reads the runs and the export, for the run graph, so it renders
// on every run snapshot and every export frame; each cell and the map sit
// in a slot that passes them by when what it hands them has not changed -
// the cell's number, its state and whether it is open, and a press that
// is the same function every time - so a cell renders for the contexts it
// reads and for a change to its own state, and not because the column did
// (issue 433, `tests/unit/cell-renders.test.tsx`).

/**
 * Which cells a project's screen opens with, from its record (ADR-046,
 * FR-010). A project with a layout opens on its map: cells 01 and 02 are
 * the data and the run that made it, finished with, so they start collapsed
 * and the map is the first tall thing on screen. A project with none needs
 * exactly those two, so they start open. Cells 03 to 05 start open as the
 * Map tab showed them, and cell 06 closed as the Export tab was, so its
 * preview is mounted only once a person asks for it.
 *
 * Read once, when the screen first has the record. A layout finishing while
 * the screen is open closes nothing: a cell never opens or closes itself
 * (FR-017).
 */
export function startOpen(record: Pick<ProjectRecord, 'layout'>): Record<CellId, boolean> {
  const laidOut = record.layout !== null
  return {
    data: !laidOut,
    process: !laidOut,
    frame: true,
    style: true,
    lines: true,
    export: false,
  }
}

export default function Notebook(): JSX.Element | null {
  const { project } = useProjectRecord()
  // Nothing until the record has been read: six empty cells while it is, or
  // after a read that failed, would say there is work to do on a project
  // the screen cannot describe. The screen showed nothing then before.
  if (project === null) return null
  return <Column initial={startOpen(project)} />
}

/** The column, from the first render that has a record. */
function Column({ initial }: { initial: Record<CellId, boolean> }): JSX.Element {
  const { project } = useProjectRecord()
  const { runSnapshot } = useProjectRuns()
  const { exportSnapshot } = useProjectExport()
  // `initial` is read by the first render alone: which cells are open is
  // the person's from then on.
  const [open, setOpen] = useState<Record<CellId, boolean>>(initial)
  // A cell the map's empty state has sent a person to, once it is open and
  // laid out: the same landing the rail's press makes.
  const [landing, setLanding] = useState<CellId | null>(null)
  useLayoutEffect(() => {
    if (landing === null) return
    setLanding(null)
    landOnCell(landing)
  }, [landing])
  const states = runGraph({
    record: project as NonNullable<typeof project>,
    run: runSnapshot,
    exportRun: exportSnapshot,
  })
  const onOpen = useCallback(
    (cell: CellId): void => setOpen((was) => ({ ...was, [cell]: true })),
    [],
  )
  // The map's empty state sends a person to cell 02: one function for the
  // screen's life, so the map's slot passes it by.
  const layOut = useCallback((): void => {
    setOpen((was) => ({ ...was, process: true }))
    setLanding('process')
  }, [])
  return (
    <>
      {/* The rail is placed from here and not from `ProjectView.tsx`
          (A5.5-21), for one reason: which cells are open is this
          component's state, and a step's press opens one. It stays outside
          `.notebook` - the column's children are the six cells and the map
          between 02 and 03. */}
      <Rail states={states} open={open} onOpen={onOpen} />
      <div className="notebook">
        {CELL_LIST.map((cell) => (
          <Fragment key={cell.id}>
            <CellSlot
              cell={cell}
              state={states[cell.id].state}
              open={open[cell.id]}
              setOpen={setOpen}
            />
            {cell.id === 'process' && <MapSlot onLayOut={layOut} />}
          </Fragment>
        ))}
      </div>
    </>
  )
}

/**
 * One cell, by the view the registry names for it, passed by while its
 * number, state and openness are what they were. Its toggle is made here,
 * once per cell, so it is the same function from render to render.
 */
const CellSlot = memo(function CellSlot({
  cell,
  state,
  open,
  setOpen,
}: {
  cell: Cell
  state: CellState
  open: boolean
  setOpen: Dispatch<SetStateAction<Record<CellId, boolean>>>
}): JSX.Element {
  const View = CELL_VIEWS[cell.id]
  const onToggle = useCallback(
    (next: boolean): void => setOpen((was) => ({ ...was, [cell.id]: next })),
    [cell.id, setOpen],
  )
  return <View cell={cell} state={state} open={open} onToggle={onToggle} />
})

/**
 * The map, passed by while its one prop is the same function. The slot is
 * in the same place in every render, as the map is, so the frame inside it
 * is never moved between parents.
 */
const MapSlot = memo(Preview)
