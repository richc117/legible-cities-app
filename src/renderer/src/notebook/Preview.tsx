import type { JSX } from 'react'
import SkipPastMap from '../SkipPastMap'
import Viewer from '../Viewer'
import { useProject } from './context'

// The map in the notebook's flow (ADR-046, DESIGN.md 8.2, "The map"): the
// engine's own page in its frame, between cell 02, whose layout it is drawn
// from, and cell 03, the first of the cells that act on it - with the
// bypass control immediately before it (issue 106).
//
// A block like any other in the column, scrolling with the cells. Until
// ADR-046 it was the column's first child, pinned under the header as a
// band half the window tall, and the cells scrolled behind it; what a band
// hides (issues 213 and 240) is why it is not pinned any more.
//
// Nothing here moves the frame between parents, and nothing may: a
// reparent reloads the engine's page, as a changed address does, and a
// reload loses its clock, its view and its scrub position. `Notebook.tsx`
// renders this wrapper in the same place for the life of the screen, and
// the frame inside it is one element from the moment the project has a map.
//
// **The block is there whether or not there is a map** (FR-018). A project
// with no layout gets a shorter box saying so, with a way to cell 02, so a
// map arriving later fills room that was kept for it instead of pushing
// cell 03 down by a whole map from nowhere. The sentence sits in a status
// region that is never taken out of the document: a live region has to be
// there before its content changes for the change to be heard, and the
// map's arrival changes it.
//
// The frame carries `sandbox="allow-scripts"` and nothing else, and the
// app drives the page from the main process (ADR-028). Nothing here
// touches either. Cell 06's preview of the export is a frame of its own
// (`ExportPreview.tsx`) and never this one.

/** The empty state's sentence, before the link: quoted by the release documents. */
export const NO_MAP = 'This project has no map yet.'

/** What the status region says once the map is drawn, for a screen reader. */
export const MAP_DRAWN = 'The map is drawn.'

export default function Preview({
  onLayOut,
}: {
  /** Take a person to cell 02, opening it if it is closed. */
  onLayOut: () => void
}): JSX.Element | null {
  const { project, drawn, skipPastMap } = useProject()
  if (project === null) return null
  const hasMap = project.layout !== null
  return (
    <div className="preview" data-map={hasMap ? 'drawn' : 'none'}>
      {/* Just before the frame in the Tab order, so the engine's page is
          one press to pass rather than all its controls (issue 106,
          DESIGN.md 8.2). Only where there is a frame to pass. */}
      {hasMap && <SkipPastMap onSkip={skipPastMap} />}
      <div className="preview-status" role="status">
        {hasMap ? (
          MAP_DRAWN
        ) : (
          <p>
            {NO_MAP}{' '}
            {/* A read-only project cannot be laid out here, so it is not
                offered a way to; the header says why (FR-019). */}
            {!project.readOnly && (
              <button type="button" className="inline-link" onClick={onLayOut}>
                Lay it out in cell 02.
              </button>
            )}
          </p>
        )}
      </div>
      {/* `drawn` is a prop and not a `key`. As a key it remounted the
          frame after every run, which is one of the two ways to lose the
          page - the viewer navigates the frame it already has now, and
          gives the new page back the clock, the view and the labels the
          old one had (A5.5-20, `viewerRestore.ts`). */}
      {hasMap && <Viewer project={project} redraw={drawn} />}
    </div>
  )
}
