import type { JSX } from 'react'
import SkipPastMap from '../SkipPastMap'
import Viewer from '../Viewer'
import { useProject } from './context'

// The map on screen: the engine's own page in its frame, with the bypass
// control immediately before it (issue 106).
//
// The first child of the notebook's column (ADR-045, DESIGN.md 8.2), which
// is where it has to be to be pinned with CSS alone - sticky under the
// header, from the top of the column rather than at a scroll threshold
// (`preview.css`). Nothing here moves the frame between parents, and
// nothing may: a reparent reloads the engine's page, as a changed address
// does, and a reload loses its clock, its view and its scrub position.
// This wrapper is the whole of the pinning, and the frame inside it is one
// element for as long as the screen is open.
//
// It is also the only place the frame is on screen. Six open cells are
// several windows tall, and Chromium does not lay out the contents of an
// offscreen iframe: below them the map drew nothing and its page had no
// accessibility tree at all.
//
// The frame carries `sandbox="allow-scripts"` and nothing else, and the
// app drives the page from the main process (ADR-028). Nothing here
// touches either.

export default function Preview(): JSX.Element | null {
  const { project, preview, drawn, skipPastMap } = useProject()
  if (project === null || project.layout === null) return null
  return (
    <div className="preview">
      {/* Just before the frame in the Tab order, so the engine's page is
          one press to pass rather than all its controls (issue 106,
          DESIGN.md 8.2). */}
      <SkipPastMap onSkip={skipPastMap} />
      {/* One frame, because the viewer's bridge holds one per project: the
          plain map, or the export's frame planned by the engine while cell
          06 is open (A5-01, FR-005).

          `drawn` is a prop and not a `key`. As a key it remounted the
          frame after every run, which is one of the two ways to lose the
          page - the viewer navigates the frame it already has now, and
          gives the new page back the clock, the view and the labels the
          old one had (A5.5-20, `viewerRestore.ts`). */}
      <Viewer project={project} address={preview} redraw={drawn} />
    </div>
  )
}
