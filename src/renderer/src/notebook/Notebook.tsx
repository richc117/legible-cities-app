import { useState, type JSX } from 'react'
import { CELL_LIST, runGraph, type CellId } from '../runGraph'
import { CELL_VIEWS } from './cells'
import { useProject } from './context'

// The notebook: the six cells in one scrolling column, read top to bottom
// (ADR-045, docs/DESIGN.md 9).
//
// It walks `CELL_LIST` and names no adapter: which view draws which cell is
// the registry's answer, so a cell's own branch edits its file under
// `cells/` and never this one. Each cell's state is derived from the
// record and the runs in flight (A5.5-04) rather than held as a flag here.
//
// Which cells are open is where a person is looking, not a setting, and is
// not stored - the same rule the tab strip it replaces followed. Cell 06
// starts closed because the export's preview takes over the map's frame
// while it is open, which is the Export tab's own rule (A5-01) and the one
// thing about the tabs that was not merely where a panel sat.

const START_OPEN: Record<CellId, boolean> = {
  data: true,
  process: true,
  frame: true,
  style: true,
  lines: true,
  export: false,
}

export default function Notebook(): JSX.Element | null {
  const { project, runSnapshot, exportSnapshot } = useProject()
  const [open, setOpen] = useState<Record<CellId, boolean>>(START_OPEN)
  // Nothing until the record has been read: six empty cells while it is, or
  // after a read that failed, would say there is work to do on a project
  // the screen cannot describe. The screen showed nothing then before.
  if (project === null) return null
  const states = runGraph({ record: project, run: runSnapshot, exportRun: exportSnapshot })
  return (
    <div className="notebook">
      {CELL_LIST.map((cell) => {
        const View = CELL_VIEWS[cell.id]
        return (
          <View
            key={cell.id}
            cell={cell}
            state={states[cell.id].state}
            open={open[cell.id]}
            onToggle={(next) => setOpen((was) => ({ ...was, [cell.id]: next }))}
          />
        )
      })}
    </div>
  )
}
