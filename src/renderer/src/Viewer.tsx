import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import type { ProjectRecord } from '../../shared/project'
import { VIEWER_SANDBOX } from '../../shared/viewer'
import type { PreviewAddress } from './exportChoice'

// The engine's page, on the screen.
//
// The frame carries `allow-scripts` and nothing else, so the page runs at an
// opaque origin: it cannot read this document, cannot reach the bridge, and
// cannot navigate the window (ADR-028). **Never add `allow-same-origin`
// here.** One word beside the other undoes all of it, and a frame holding
// both can even remove its own sandbox attribute.
//
// Nothing in this file drives the page. The interface asks the privileged
// process, which reaches into the frame; from here the page is a rectangle
// that draws itself. Its own controls are the controls (DESIGN.md 8.2).

/**
 * Where the engine wrote the page: named after the feed, not the project.
 *
 * The theme is the project's own (A4-03), not the interface's. It followed
 * the interface until then, which was always a placeholder: a theme belongs
 * to the map being made, which is exported and published, rather than to
 * the room the maker is sitting in. The page reads `theme=` before its
 * first paint, so the frame never shows one theme and then the other.
 */
const pageUrl = (project: ProjectRecord): string =>
  `app://local/projects/${project.id}/${project.feed}.html` +
  `?present=1&controls=1&theme=${encodeURIComponent(project.theme)}`

/**
 * The frame's shape for a planned preview: the preset's width and height as
 * two plain numbers the stylesheet divides, so the frame keeps the export's
 * aspect ratio inside the space the map had. Data, not a size: the numbers
 * are the engine's, and no unit is written here.
 */
const shapeOf = (address: PreviewAddress): CSSProperties =>
  ({
    '--frame-width': address.width,
    '--frame-height': address.height,
  }) as CSSProperties

export default function Viewer({
  project,
  address = null,
}: {
  project: ProjectRecord
  /**
   * While the export tab is open, the address `export.plan` answered for
   * the choice there, and the size it was planned at (A5-01). The frame is
   * the same frame, still sandboxed and still attached from the main
   * process by the project's prefix, which the planned address shares; the
   * page draws the frame, the title, the clock and the safe zones itself
   * from that address. Null for the map with its own controls.
   */
  address?: PreviewAddress | null
}): JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null)
  const [problem, setProblem] = useState<string | null>(null)

  // Attaching is what lets the privileged process hold this frame. It is
  // released when the project is left, so nothing is ever injected into a
  // frame that has gone.
  useEffect(() => {
    let left = false
    setProblem(null)
    const element = frame.current
    if (element === null) return undefined
    // A page that is missing still loads: the origin answers 404 with a body,
    // and the frame reports success. Asking the page what it is showing is
    // what tells the two apart.
    const onLoad = (): void => {
      window.api.viewer
        .attach(project.id)
        .then((held) => (held ? window.api.viewer.call('state') : Promise.reject(new Error('no'))))
        .then(
          () => {
            if (!left) setProblem(null)
          },
          () => {
            if (!left) setProblem("This project's map is not there. Lay it out again.")
          },
        )
    }
    element.addEventListener('load', onLoad)
    return () => {
      left = true
      element.removeEventListener('load', onLoad)
      void window.api.viewer.release().catch(() => undefined)
    }
  }, [project.id, project.feed, project.theme])

  return (
    <section className="viewer" aria-label="Map">
      <div
        className={address === null ? 'viewer-shape' : 'viewer-shape viewer-shape-planned'}
        style={address === null ? undefined : shapeOf(address)}
      >
        <iframe
          ref={frame}
          className="viewer-frame"
          sandbox={VIEWER_SANDBOX}
          src={address === null ? pageUrl(project) : address.url}
          title={
            address === null
              ? `${project.name}, animated`
              : `${project.name}, as the export will frame it`
          }
        />
      </div>
      {problem !== null && (
        <p className="message error" role="alert">
          {problem}
        </p>
      )}
    </section>
  )
}
