import { Fragment, useLayoutEffect, useState, type JSX } from 'react'
import type { ProjectRecord } from '../../../shared/project'
import { CELL_LIST, runGraph, type CellId } from '../runGraph'
import { CELL_VIEWS } from './cells'
import { useProject } from './context'
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
  const { project } = useProject()
  // Nothing until the record has been read: six empty cells while it is, or
  // after a read that failed, would say there is work to do on a project
  // the screen cannot describe. The screen showed nothing then before.
  if (project === null) return null
  return <Column initial={startOpen(project)} />
}

/** The column, from the first render that has a record. */
function Column({ initial }: { initial: Record<CellId, boolean> }): JSX.Element {
  const { project, runSnapshot, exportSnapshot } = useProject()
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
  const goTo = (cell: CellId): void => {
    setOpen((was) => ({ ...was, [cell]: true }))
    setLanding(cell)
  }
  return (
    <>
      {/* The rail is placed from here and not from `ProjectView.tsx`
          (A5.5-21), for one reason: which cells are open is this
          component's state, and a step's press opens one. It stays outside
          `.notebook` - the column's children are the six cells and the map
          between 02 and 03. */}
      <Rail
        states={states}
        open={open}
        onOpen={(cell) => setOpen((was) => ({ ...was, [cell]: true }))}
      />
      <div className="notebook">
        {CELL_LIST.map((cell) => {
          const View = CELL_VIEWS[cell.id]
          return (
            <Fragment key={cell.id}>
              <View
                cell={cell}
                state={states[cell.id].state}
                open={open[cell.id]}
                onToggle={(next) => setOpen((was) => ({ ...was, [cell.id]: next }))}
              />
              {cell.id === 'process' && <Preview onLayOut={() => goTo('process')} />}
            </Fragment>
          )
        })}
      </div>
    </>
  )
}
