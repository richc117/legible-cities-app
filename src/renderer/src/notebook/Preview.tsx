import type { JSX } from 'react'
import SkipPastMap from '../SkipPastMap'
import Viewer from '../Viewer'
import { useProject } from './context'

// The map on screen: the engine's own page in its frame, with the bypass
// control immediately before it (issue 106).
//
// Moved from the project screen unchanged, and deliberately not yet
// pinned. Making it sticky under the header is A5.5-20's, and it is that
// branch's alone because the frame must never be reparented and its
// address must never change by accident: both reload the engine's page,
// and a reload loses its clock, its view and its scrub position (ADR-045).
// So this file holds the frame where the tabs left it, keyed the way it
// was keyed, and `preview.css` waits empty beside it.
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
          06 is open (A5-01, FR-005). */}
      <Viewer key={drawn} project={project} address={preview} />
    </div>
  )
}
