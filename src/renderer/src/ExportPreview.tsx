import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { VIEWER_SANDBOX } from '../../shared/viewer'
import { previewCaption, type PreviewAddress } from './exportChoice'
import { probeFrame } from './Viewer'

// Cell 06's preview of the export (ADR-046, specs/029 FR-004): the engine's
// plan for the choices in the cell, in a frame of its own, inside the cell.
//
// Until ADR-046 the preview was the map's own frame, sent to the planned
// address while cell 06 was open and back when it closed - a navigation the
// map had to survive (`viewerRestore.ts`), and the one issue 222 came from.
// This frame is mounted only while the cell is open and goes when it
// closes. It is the engine's plan pinned at its own time, with no clock
// worth keeping, so it is disposable: a new plan sends it to the new
// address and nothing is asked of the page it leaves.
//
// It is the `export` frame to the main process, matched at attach by its
// address (`roleOfAddress` in `src/main/viewer.ts`), and it is asked one
// thing - whether its page loaded, which is what tells a page from the
// origin's 404 - and nothing else; the main process refuses anything more
// for that role. The transport in cell 03 names the map's frame and never
// reaches this one.
//
// The frame carries `sandbox="allow-scripts"` and nothing else, as the
// map's does (ADR-028). **Never add `allow-same-origin` here.**
//
// Its box is the preset's ratio, fit into a box bounded at the smaller of
// a fraction of the window and a fixed height, centred, with an outline at
// the frame's edge and a caption naming the ratio and the size. The width
// and height reach the stylesheet as two plain numbers, as they did when
// this shape was the map's (`preview.css`); they are the engine's, and no
// unit is written here.

const shapeOf = (address: PreviewAddress): CSSProperties =>
  ({
    '--frame-width': address.width,
    '--frame-height': address.height,
  }) as CSSProperties

export default function ExportPreview({
  projectId,
  projectName,
  address,
}: {
  projectId: string
  projectName: string
  address: PreviewAddress
}): JSX.Element {
  const [problem, setProblem] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // The cell has closed: nothing may be injected into a frame that has
      // gone, and the next open attaches its own.
      void window.api.viewer.release('export').catch(() => undefined)
    }
  }, [])

  return (
    <figure className="export-preview" style={shapeOf(address)}>
      <iframe
        className="export-frame"
        sandbox={VIEWER_SANDBOX}
        src={address.url}
        title={`${projectName}, as the export will frame it`}
        onLoad={(event) => {
          const src = event.currentTarget.getAttribute('src')
          probeFrame(projectId, 'export').then(
            () => {
              if (mounted.current) setProblem(null)
            },
            () => {
              // Only for the document the frame is on now: a late answer
              // for an address a newer plan has replaced says nothing.
              if (mounted.current && src === address.url)
                setProblem("The preview's page did not answer, so it may not show the export.")
            },
          )
        }}
      />
      <figcaption className="message">{previewCaption(address)}</figcaption>
      {/* Plain words and not an alert: the map's block above already says
          so assertively when the page is missing, and this is the same
          file at another address. */}
      {problem !== null && <p className="message">{problem}</p>}
    </figure>
  )
}
