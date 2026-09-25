import { useRef, type JSX } from 'react'
import ExportTab from '../../ExportTab'
import Cell from '../Cell'
import type { CellViewProps } from '../cells'
import { useProject } from '../context'

// Cell 06, Export: the preset, the storyboard and everything the reel is
// made of (ADR-045).
//
// `ExportTab` as A5-01 wrote it, with the tab's own "is this the panel
// showing?" now "is this cell open?". The rule it carries is the same: the
// map's own frame is the export's preview while the cell is open, and the
// plain map again once it is closed, so the frame never shows an address
// planned for a choice a person has left.
//
// It is drawn headless, as cells 04 and 05 draw their panels: this cell's
// heading row is the section's heading now, and it is where focus goes
// when a control inside disables or removes itself - the heading, not the
// toggle inside it, which a reflexive Space after the handback would
// collapse (A5.5-19).
//
// Where the exports go is the cell's own new choice (A5.5-19), and it is
// the panel's rather than this adapter's for the reason every other choice
// is: the folder belongs beside the preset and the quality, and the record
// it writes is answered by the call that writes it. No path crosses the
// bridge inward - the main process opens the platform's dialog and applies
// its own answer, exactly as Settings does (A1-04).

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
  const heading = useRef<HTMLHeadingElement>(null)
  return (
    <Cell
      number={cell.number}
      name={cell.name}
      state={state}
      open={open}
      onToggle={toggle}
      headingRef={heading}
    >
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
          handback={heading}
        />
      )}
    </Cell>
  )
}
