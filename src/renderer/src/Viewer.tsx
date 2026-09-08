import { useEffect, useRef, useState, type JSX } from 'react'
import type { ProjectRecord } from '../../shared/project'
import { VIEWER_SANDBOX } from '../../shared/viewer'

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
 * The theme the page is drawn in.
 *
 * A record carries a theme, but nothing sets it yet: every project is
 * created warm-dark, and choosing one per project is A4-03's. Until then
 * the map follows the interface, which follows the operating system, so a
 * light interface does not hold a dark map. When A4-03 gives a project a
 * theme of its own, that choice takes precedence over this.
 */
const themeNow = (): string =>
  document.documentElement.dataset.theme === 'sepia' ? 'sepia' : 'warm-dark'

/** Where the engine wrote the page: named after the feed, not the project. */
const pageUrl = (project: ProjectRecord, theme: string): string =>
  `app://local/projects/${project.id}/${project.feed}.html` +
  `?present=1&controls=1&theme=${encodeURIComponent(theme)}`

export default function Viewer({ project }: { project: ProjectRecord }): JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null)
  const [problem, setProblem] = useState<string | null>(null)
  // The theme rides on the address, so a change reloads the page rather than
  // restyling it from outside, which the design document forbids.
  const [theme, setTheme] = useState(themeNow)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const follow = (): void => setTheme(themeNow())
    media.addEventListener('change', follow)
    return () => media.removeEventListener('change', follow)
  }, [])

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
  }, [project.id, project.feed, theme])

  return (
    <section className="viewer" aria-label="Map">
      <div className="viewer-shape">
        <iframe
          ref={frame}
          className="viewer-frame"
          sandbox={VIEWER_SANDBOX}
          src={pageUrl(project, theme)}
          title={`${project.name}, animated`}
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
