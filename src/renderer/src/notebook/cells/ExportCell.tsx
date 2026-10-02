import { useRef, useState, type JSX } from 'react'
import type { PreviewAddress } from '../../exportChoice'
import ExportPreview from '../../ExportPreview'
import ExportTab from '../../ExportTab'
import Cell from '../Cell'
import { exportFooter } from '../CellFooter'
import type { CellViewProps } from '../cells'
import { useProject } from '../context'

// Cell 06, Export: the preset, the storyboard and everything the reel is
// made of (ADR-045), and a preview of the frame it will make (ADR-046).
//
// `ExportTab` as A5-01 wrote it, with the tab's own "is this the panel
// showing?" now "is this cell open?".
//
// The preview is a frame of this cell's own, mounted while the cell is open
// and gone when it closes (`ExportPreview.tsx`). Until ADR-046 it was the
// map's frame, sent to the planned address and back; the map stays where it
// is now, with its clock, and opening this cell sends it nothing. The
// address the engine last planned is this cell's state and nobody else's,
// and it is forgotten as the cell closes, so a cell opened again shows
// nothing until a plan for the choice as it is now has answered.
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
 * A press on cell 06's heading row. Closing forgets the planned address in
 * the same call, before the cell closes: an address planned for this
 * choice must not be the first thing the cell shows when it opens again.
 *
 * Its own function so the order is held to a test rather than to a reading
 * of the file. The planner's own late answers are refused in
 * `ExportTab.tsx`, which is the other half of it.
 */
export const toggleExportCell =
  (clearPreview: () => void, onToggle: (open: boolean) => void) =>
  (next: boolean): void => {
    if (!next) clearPreview()
    onToggle(next)
  }

export default function ExportCell({ cell, state, open, onToggle }: CellViewProps): JSX.Element {
  const { project, engine, exporter, layingOut, inspect, setExport } = useProject()
  const [address, setAddress] = useState<PreviewAddress | null>(null)
  const toggle = toggleExportCell(() => setAddress(null), onToggle)
  const heading = useRef<HTMLHeadingElement>(null)
  return (
    <Cell
      number={cell.number}
      name={cell.name}
      state={state}
      open={open}
      onToggle={toggle}
      headingRef={heading}
      footer={exportFooter(exporter.snapshot)}
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
          onPreview={setAddress}
          preview={
            // Only while the cell is open: a collapsed cell keeps its
            // controls in the document (`Cell.tsx`), and a frame kept there
            // would be a second live page nobody can see. Never on a
            // read-only project, whose export cannot be made (FR-019).
            open &&
            address !== null &&
            !project.readOnly && (
              <ExportPreview projectId={project.id} projectName={project.name} address={address} />
            )
          }
          handback={heading}
        />
      )}
    </Cell>
  )
}
