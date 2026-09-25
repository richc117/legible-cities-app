import { useState, type JSX } from 'react'
import { CELL_LIST, runGraph, type CellId } from '../runGraph'
import { CELL_VIEWS } from './cells'
import { useProject } from './context'
import Preview from './Preview'
import Rail from './Rail'

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
//
// The map is the column's first child and not a sibling of it (ADR-045,
// DESIGN.md 8.2, "The pinned preview"): the wrapper has to be inside the
// column for A5.5-20 to pin it with CSS alone, and putting it there now
// means that branch never moves the frame between parents, which is the
// one operation ADR-045 forbids. Below the cells it was also off screen in
// a window the six of them are taller than, and Chromium does not lay out
// an offscreen iframe's contents at all.

/**
 * Which cells a project's screen opens with: the five the Map tab showed,
 * and cell 06 closed as the Export tab was. Exported so the decision is
 * held to a test rather than to a comment (A5.5-08).
 */
export const START_OPEN: Record<CellId, boolean> = {
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
    <>
      {/* The rail is placed from here and not from `ProjectView.tsx`
          (A5.5-21), for one reason: which cells are open is this
          component's state, and a step's press opens one. Lifting that
          state to the screen so the two could be siblings would put a
          value six cells read, and one region writes, a file further from
          both. It stays outside `.notebook` - the column's children are
          the map and the six cells, and `Preview` stays the first of them,
          which is the arrangement `preview.css` pins. */}
      <Rail
        states={states}
        open={open}
        onOpen={(cell) => setOpen((was) => ({ ...was, [cell]: true }))}
      />
      <div className="notebook">
        <Preview />
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
    </>
  )
}
