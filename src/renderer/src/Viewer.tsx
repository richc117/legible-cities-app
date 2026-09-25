import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import type { ProjectRecord } from '../../shared/project'
import { VIEWER_SANDBOX } from '../../shared/viewer'
import type { PreviewAddress } from './exportChoice'
import { restoreCalls } from './viewerRestore'

// The engine's page, on the screen.
//
// The frame carries `allow-scripts` and nothing else, so the page runs at an
// opaque origin: it cannot read this document, cannot reach the bridge, and
// cannot navigate the window (ADR-028). **Never add `allow-same-origin`
// here.** One word beside the other undoes all of it, and a frame holding
// both can even remove its own sandbox attribute.
//
// **And never reparent this frame, or put a `key` back on it.** Since
// A5.5-20 that is the second way to lose the page, and it is the one that
// looks harmless: an iframe moved between parents reloads, as one whose
// address changes reloads, and a reload throws away the page's clock, its
// view, its labels and its scrub position. There was a `key` here until
// then, remounting the frame after every run for exactly the reload the
// remount was hiding. There is one navigation now, it is deliberate, and
// the page is asked what it is showing before it happens and told again
// after (`viewerRestore.ts`).
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
 *
 * `redraw` is how many runs have rewritten this page while the screen has
 * been open. It is on the address because a run writes the same file again:
 * without it the address after a run is the address before it, React
 * changes nothing, and the frame goes on showing a document that no longer
 * matches the file behind it. present.js reads the keys it knows and
 * ignores the rest, and the protocol handler resolves the path alone, so it
 * costs the page nothing.
 */
const pageUrl = (project: ProjectRecord, redraw: number): string =>
  `app://local/projects/${project.id}/${project.feed}.html` +
  `?present=1&controls=1&theme=${encodeURIComponent(project.theme)}&redraw=${redraw}`

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
  redraw = 0,
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
  /**
   * How many runs have rewritten this project's page while the screen has
   * been open. A change sends the frame to the page a run has just written;
   * the frame stays the element it always was.
   */
  redraw?: number
}): JSX.Element {
  const [problem, setProblem] = useState<string | null>(null)

  const wanted = address === null ? pageUrl(project, redraw) : address.url

  // The address the frame is on, which is not always the address it is
  // wanted on: the page it is about to leave is asked what it is showing
  // first, and only then is it sent. One piece of state, so the navigation
  // is one commit and the address never moves twice for one change - and
  // the shape, the title and the restore all read from what the frame is
  // actually showing rather than from what it is about to show.
  const [showing, setShowing] = useState<{ src: string; planned: PreviewAddress | null }>({
    src: wanted,
    planned: address,
  })
  const planned = showing.planned
  // The plain map's own state, read as the frame leaves it and given back
  // to the plain map that comes next. Never the export preview's: that
  // address is the engine's plan and says where the map is to be, so
  // arriving there restores nothing and leaving it keeps what the map had,
  // which is what brings cell 06 back to the clock it was opened at.
  const kept = useRef<unknown>(null)
  // Which load a restore belongs to. A second navigation while the first
  // one's calls are still in flight would otherwise seek the wrong page.
  const loads = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (wanted === showing.src) return undefined
    let off = false
    // The state of the page being left, when it is a page worth
    // remembering and there is one there to ask. A refusal is not a
    // failure and is not an answer either: the frame may be mid-navigation
    // from a change a moment ago, and what was read before that is still
    // the last thing anyone knows the map was showing, so it is kept.
    const read =
      planned === null ? window.api.viewer.call('state').catch(() => null) : Promise.resolve(null)
    void read.then((state) => {
      if (off) return
      if (planned === null && state !== null) kept.current = state
      setShowing({ src: wanted, planned: address })
    })
    return () => {
      off = true
    }
  }, [wanted, address, planned, showing.src])

  // Attaching is what lets the privileged process hold this frame; it is
  // released when the project is left, so nothing is ever injected into a
  // frame that has gone. Holding it is the load handler's, because every
  // navigation is a new document and the frame has to be found again.
  useEffect(() => {
    return () => {
      void window.api.viewer.release().catch(() => undefined)
    }
  }, [project.id])

  // A page that is missing still loads: the origin answers 404 with a body,
  // and the frame reports success. Asking the page what it is showing is
  // what tells the two apart.
  //
  // React's own `onLoad`, rather than a listener added in an effect: the
  // event cannot arrive before the commit that changed the address, and
  // React hands the event the closure of that commit, so a restore is
  // always the one read for the address that just loaded.
  const onLoad = (): void => {
    const load = ++loads.current
    window.api.viewer
      .attach(project.id)
      .then((held) => (held ? window.api.viewer.call('state') : Promise.reject(new Error('no'))))
      .then(
        async () => {
          if (!mounted.current) return
          setProblem(null)
          if (planned !== null) return
          // Not spent by being used. It is refreshed before every
          // navigation away from the map and is the only record of where
          // the map was, so a second navigation whose own read came too
          // late still has it. It goes when the screen does.
          const calls = restoreCalls(kept.current)
          for (const { method, args } of calls) {
            if (load !== loads.current || !mounted.current) return
            await window.api.viewer.call(method, ...args).catch(() => undefined)
          }
        },
        () => {
          if (mounted.current) setProblem("This project's map is not there. Lay it out again.")
        },
      )
  }

  return (
    <section className="viewer" aria-label="Map">
      <div
        className={planned === null ? 'viewer-shape' : 'viewer-shape viewer-shape-planned'}
        style={planned === null ? undefined : shapeOf(planned)}
      >
        <iframe
          className="viewer-frame"
          sandbox={VIEWER_SANDBOX}
          src={showing.src}
          onLoad={onLoad}
          title={
            planned === null
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
