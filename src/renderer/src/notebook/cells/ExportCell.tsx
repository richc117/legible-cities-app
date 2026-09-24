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

/**
 * A press on cell 06's heading row. Closing puts the plain map back in the
 * same call, before the cell closes, exactly as leaving the Export tab did:
 * an address planned for this choice must not survive a frame beyond it.
 *
 * Its own function so the order is held to a test rather than to a reading
 * of the file. Done in an effect instead, the map would carry the export's
 * frame and safe zones for one render after a person had left the export,
 * which is the rule A5-01 exists to keep. The planner's own late answers
 * are refused in `ExportTab.tsx`, which is the other half of it.
 */
export const toggleExportCell =
  (clearPreview: () => void, onToggle: (open: boolean) => void) =>
  (next: boolean): void => {
    if (!next) clearPreview()
    onToggle(next)
  }

export default function ExportCell({ cell, state, open, onToggle }: CellViewProps): JSX.Element {
  const { project, engine, exporter, layingOut, inspect, setExport, setPreview } = useProject()
  const toggle = toggleExportCell(() => setPreview(null), onToggle)
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
