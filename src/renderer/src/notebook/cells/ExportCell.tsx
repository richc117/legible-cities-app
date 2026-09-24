import type { JSX } from 'react'
import ExportTab from '../../ExportTab'
import Cell from '../Cell'
import type { CellViewProps } from '../cells'
import { useProject } from '../context'

// Cell 06, Export: the preset, the storyboard and everything the reel is
// made of (ADR-045).
//
// `ExportTab` unchanged (A5-01), with the tab's own "is this the panel
// showing?" now "is this cell open?". The rule it carries is the same: the
// map's own frame is the export's preview while the cell is open, and the
// plain map again once it is closed, so the frame never shows an address
// planned for a choice a person has left.

export default function ExportCell({ cell, state, open, onToggle }: CellViewProps): JSX.Element {
  const { project, engine, exporter, layingOut, inspect, setExport, setPreview } = useProject()
  // Closing puts the plain map back in the same render the cell closes in,
  // as leaving the Export tab did: an address planned for this choice must
  // not survive a frame beyond it.
  const toggle = (next: boolean): void => {
    if (!next) setPreview(null)
    onToggle(next)
  }
  return (
    <Cell number={cell.number} name={cell.name} state={state} open={open} onToggle={toggle}>
      {project !== null && (
        <ExportTab
          project={project}
          engine={engine}
          run={exporter}
          layingOut={layingOut}
          active={open}
          inspect={inspect}
          onChoice={setExport}
          onPreview={setPreview}
        />
      )}
    </Cell>
  )
}
