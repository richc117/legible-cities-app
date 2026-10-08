import { useEffect, useRef, useState, type JSX, type SyntheticEvent } from 'react'
import type { ProjectRecord } from '../../shared/project'
import { VIEWER_SANDBOX, type ViewerRole } from '../../shared/viewer'
import { asDispatched, transportFor, withRemembered } from './transportState'
import { wantedAddress } from './viewerAddress'
import { restoreCalls } from './viewerRestore'

// The engine's page, on the screen: the map, in the notebook's flow after
// cell 02 (ADR-046).
//
// The frame carries `allow-scripts` and nothing else, so the page runs at an
// opaque origin: it cannot read this document, cannot reach the bridge, and
// cannot navigate the window (ADR-028). **Never add `allow-same-origin`
// here.** One word beside the other undoes all of it, and a frame holding
// both can even remove its own sandbox attribute.
//
// **And never reparent this frame, or put a `key` back on it.** That is the
// second way to lose the page, and it is the one that looks harmless: an
// iframe moved between parents reloads, as one whose address changes
// reloads, and a reload throws away the page's clock, its view, its labels
// and its scrub position. There was a `key` here until A5.5-20, remounting
// the frame after every run for exactly the reload the remount was hiding.
// There is one kind of navigation now - to the page a run has just
// rewritten - and the page is asked what it is showing before it happens
// and told again after (`viewerRestore.ts`). **A theme is not a navigation**
// (issue 349): the page restyles in place through `setTheme`, sent when the
// record has been written (`themeWrites.ts`), so a press leaves the
// frame's address, its document and everything the document was showing as
// they were.
//
// **This frame is never sent to the export's planned address.** Until
// ADR-046 it was: cell 06 took it for its preview and gave it back, which
// is what cost issue 222. Cell 06 has a frame of its own now
// (`ExportPreview.tsx`), and this one is the `map` to the main process from
// the first load to the last (`src/main/viewer.ts`), so the transport in
// cell 03 drives it whatever cell 06 is doing.
//
// Nothing in this file drives the page beyond giving it back its state. The
// interface asks the privileged process, which reaches into the frame; from
// here the page is a rectangle that draws itself. Its own controls are the
// controls (DESIGN.md 8.2).

/** The role this frame is held in by the main process (ADR-046). */
const ROLE: ViewerRole = 'map'

/**
 * How long the page being left is given to say what it is showing, in
 * milliseconds.
 *
 * The frame navigates whether or not it answers, and that is the whole
 * point of the deadline. `viewer.call` reaches the page by injecting into
 * its main world, and a page whose main thread is blocked never answers at
 * all: without this the frame would stay on the old document for the life
 * of the screen, so a run would draw a map nobody ever saw. That is a lever
 * in the hands of a page the app does not trust, which is the thing ADR-028
 * exists to deny it, and it is reachable without malice - a feed's route
 * name can become live markup in a generated page (engine issue E17). A
 * deadline that passes loses the answer, which is `restoreCalls`'s "nothing
 * known, nothing to do".
 */
const STATE_DEADLINE = 1000

/**
 * What the page says it is showing, or nothing. A refusal and a silence
 * read alike, because nothing done with the answer tells them apart: both
 * mean the state is not known.
 *
 * It takes the asking and the deadline rather than reaching for either, so
 * the rule that matters - that a promise which never settles still produces
 * an answer, on time - is tested without a window, a bridge or a frame.
 */
export function answerWithin(ask: () => Promise<unknown>, deadline: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), deadline)
  })
  let asked: Promise<unknown>
  try {
    asked = ask()
  } catch {
    clearTimeout(timer)
    return Promise.resolve(null)
  }
  return Promise.race([asked.catch(() => null), late]).finally(() => clearTimeout(timer))
}

/**
 * Hold a frame that has just loaded, in its role, and ask its page what it
 * is showing - which is how a page is told from the origin's 404, since a
 * missing page still loads and the frame reports success. Resolves when
 * the page answered and rejects when it is not there to.
 *
 * Shared by the map and by cell 06's preview, which is asked this and
 * nothing more (`EXPORT_FRAME_METHODS`).
 */
export function probeFrame(projectId: string, role: ViewerRole): Promise<unknown> {
  return window.api.viewer
    .attach(projectId, role)
    .then((held) =>
      held ? window.api.viewer.call(role, 'state') : Promise.reject(new Error('no')),
    )
}

export default function Viewer({
  project,
  redraw = 0,
}: {
  project: ProjectRecord
  /**
   * How many runs have rewritten this project's page while the screen has
   * been open. A change sends the frame to the page a run has just written;
   * the frame stays the element it always was.
   */
  redraw?: number
}): JSX.Element {
  const [problem, setProblem] = useState<string | null>(null)

  // The address the frame is wanted on. It is made again only when the
  // project, its feed or the number of redraws changes, and it carries the
  // project's theme at that moment: a theme change alone leaves it as it
  // was (`viewerAddress.ts`). Held in state and adjusted during the render,
  // the way React asks for a value derived from props that has to remember
  // its last answer, so no ref is written while rendering.
  const [wantedFor, setWantedFor] = useState(() => wantedAddress(null, project, redraw))
  const wantedNow = wantedAddress(wantedFor, project, redraw)
  if (wantedNow !== wantedFor) setWantedFor(wantedNow)
  const wanted = wantedNow.address

  // The address the frame is on, which is not always the address it is
  // wanted on: the page it is about to leave is asked what it is showing
  // first, and only then is it sent. One piece of state, so the navigation
  // is one commit and the address never moves twice for one change.
  const [showing, setShowing] = useState<string>(wanted)
  // The map's own state, read as the frame leaves a page and given back to
  // the page that comes next.
  const kept = useRef<unknown>(null)
  // The project's theme as it stands, for the load handler to read when a
  // document arrives. The handler's own `project` is the render's that
  // started the load, and a press made since then is on the record and not
  // in that closure: the address carries the theme of the moment it was
  // made, and this is what puts a page right when its document is behind.
  const theme = useRef(project.theme)
  useEffect(() => {
    theme.current = project.theme
  }, [project.theme])
  // Which navigation a restore belongs to. Bumped where the navigation is
  // decided and not where the new document lands, because the gap between
  // the two is exactly where a restore loop - up to seven awaited round
  // trips - would otherwise go on dispatching into a page the screen has
  // already sent somewhere else.
  const navigations = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (wanted === showing) return undefined
    let off = false
    // The state of the page being left. Neither a refusal nor a silence is
    // an answer: the frame may be mid-navigation from a change a moment
    // ago, and what was read before that is still the last thing anyone
    // knows the map was showing, so it is kept.
    void answerWithin(() => window.api.viewer.call(ROLE, 'state'), STATE_DEADLINE).then((state) => {
      if (off) return
      if (state !== null) kept.current = state
      // The message is **not** cleared here. It was for a while, so that
      // a sentence about the page being left could not sit over the page
      // arriving - and that guarantees two reflows in the common case
      // rather than one: the line goes as the frame is sent, and the new
      // page's failed probe puts it straight back. Cleared on the load's
      // outcome instead it moves at most once and usually not at all,
      // since broken and still broken is a steady state.
      navigations.current += 1
      setShowing(wanted)
    })
    return () => {
      off = true
    }
  }, [wanted, showing])

  // Attaching is what lets the privileged process hold this frame; it is
  // released when the project is left, so nothing is ever injected into a
  // frame that has gone. Holding it is the load handler's, because every
  // navigation is a new document and the frame has to be found again.
  useEffect(() => {
    return () => {
      void window.api.viewer.release(ROLE).catch(() => undefined)
    }
  }, [project.id])

  // React's own `onLoad`, rather than a listener added in an effect, so
  // there is no window in which the element carries no listener at all.
  // But `load` is not delegated: React attaches to the element and then
  // looks the handler up from the fibre's **current** props when it
  // dispatches, so what runs is the newest render's closure and not the
  // closure of the commit that started this navigation. That is why the
  // address is checked rather than assumed - a load answering for a
  // document the screen has since moved away from would otherwise be given
  // the state read for a different one.
  const onLoad = (event: SyntheticEvent<HTMLIFrameElement>): void => {
    const mine = event.currentTarget.getAttribute('src') === showing
    const navigation = navigations.current
    probeFrame(project.id, ROLE).then(
      async () => {
        if (!mounted.current) return
        setProblem(null)
        if (!mine) return
        // Not spent by being used. It is refreshed before every navigation
        // and is the only record of where the map was, so a second
        // navigation whose own read came too late still has it. It goes
        // when the screen does.
        //
        // The speed and whether it was playing are laid over it from cell
        // 03's own memory (A5.5-16). They are not in what the page answered
        // and never can be - `state()` reports neither (engine issue 29) -
        // so `restoreCalls` takes them "from a caller that knows them", and
        // the caller that knows them is whoever set them. Without this a
        // run would hand a person's paused, quarter-speed map back to them
        // playing at the page's own default.
        //
        // The theme is the project's as it stands now, whatever this
        // document's address said: its first call, on every load.
        const memory = transportFor(project.id)
        const calls = restoreCalls(withRemembered(kept.current, memory.snapshot), theme.current)
        for (const { method, args } of calls) {
          if (navigation !== navigations.current || !mounted.current) return
          // The memory is read again here, one call before it is sent,
          // rather than once for the whole list. This loop is up to six
          // awaited round trips long and cell 03's controls are live
          // throughout: a Pause pressed during it writes the memory and
          // sends its own call, and a list composed before that press would
          // then overwrite it. `asDispatched` is which of these calls
          // assert a state and which do not.
          const sending = asDispatched(method, args, memory.snapshot)
          await window.api.viewer.call(ROLE, method, ...sending).catch(() => undefined)
        }
      },
      () => {
        if (mounted.current) setProblem("This project's map is not there. Lay it out again.")
      },
    )
  }

  return (
    <section className="viewer" aria-label="Map">
      <div className="viewer-shape">
        <iframe
          className="viewer-frame"
          sandbox={VIEWER_SANDBOX}
          src={showing}
          onLoad={onLoad}
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
