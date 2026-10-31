import { useEffect, useRef, useState, type JSX, type SyntheticEvent } from 'react'
import type { ProjectRecord, Theme } from '../../shared/project/types'
import { VIEWER_SANDBOX, readSeams, type ViewerRole } from '../../shared/viewer'
import { themeAsItStands } from './themeMemory'
import { soughtSince, transportFor, withRemembered } from './transportState'
import { wantedAddress } from './viewerAddress'
import { giveBack } from './viewerGiveBack'
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
// they were. Every document that loads is given the project's theme as the
// first call of its restore, read at the moment it is sent from the memory a
// press writes as its record write returns (`themeMemory.ts`), so a press
// that lands while a document is loading is never overwritten by a restore
// that was composed before it. The exception is a page the engine wrote before v0.11.0, which
// has no `setTheme`: a press on one is a navigation after all, by the path a
// redraw takes (the `reloads` count), because nothing else would show it.
// Such a page is redrawn as its project opens (issue 465: the screen judges
// from what this frame reports of each page's seam, `onSeams`), so the
// exception is met only where that redraw could not run.
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
  reloads = 0,
  onSeams,
  openDecision = null,
}: {
  project: ProjectRecord
  /**
   * How many runs have rewritten this project's page while the screen has
   * been open. A change sends the frame to the page a run has just written;
   * the frame stays the element it always was.
   */
  redraw?: number
  /**
   * How many times a theme was pressed on a page that could not be told it:
   * one the engine wrote before v0.11.0 has no `setTheme`. A change sends
   * the frame to its address again with the theme the project has now, by
   * the path a redraw takes, so the page is asked what it shows first and
   * given it back after. Nothing else counts here - a page that can be told
   * is never reloaded for a theme.
   */
  reloads?: number
  /**
   * Told, once for each document the frame has loaded and been given back,
   * what that page has on its seam (`readSeams`), or null where it did not
   * say. The screen judges from it whether an older engine drew the page
   * (`isOlderPage`, issue 465); nothing here does anything with it.
   */
  onSeams?: (seams: string[] | null) => void
  /**
   * What the screen decided to do about the page it opened on, once it has:
   * said as `data-on-open` on the section, and drawn as nothing (issue 596).
   * It is for a test to wait on; no style, text or ARIA reads it.
   */
  openDecision?: 'redraw' | 'never' | null
}): JSX.Element {
  const [problem, setProblem] = useState<string | null>(null)

  // The address the frame is wanted on. It is made again only when the
  // project, its feed, the number of redraws or the number of reloads
  // changes, and it carries the project's theme at that moment: a theme
  // change alone leaves it as it was (`viewerAddress.ts`). Held in state and
  // adjusted during the render, the way React asks for a value derived from
  // props that has to remember its last answer, so no ref is written while
  // rendering.
  const [wantedFor, setWantedFor] = useState(() => wantedAddress(null, project, redraw, reloads))
  const wantedNow = wantedAddress(wantedFor, project, redraw, reloads)
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
  // How many seeks cell 03 had asked for when the page being left was last
  // asked what it shows: one after it is newer than anything that page
  // said, and is what the next page is given back (`soughtSince`, issue
  // 660). From the memory as it stands at mount, so a seek made on an
  // earlier visit to the project is never given back to this one.
  const keptSeeks = useRef(transportFor(project.id).sought?.count ?? 0)
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
    // The seeks counted as the page is asked, not as it answers: one sent
    // after the ask may or may not be in the answer, and given back again
    // it costs nothing. Kept only with an answer, as the state is, so a
    // read that failed leaves the two describing the same page.
    const asked = transportFor(project.id).sought?.count ?? 0
    // The state of the page being left. Neither a refusal nor a silence is
    // an answer: the frame may be mid-navigation from a change a moment
    // ago, and what was read before that is still the last thing anyone
    // knows the map was showing, so it is kept.
    void answerWithin(() => window.api.viewer.call(ROLE, 'state'), STATE_DEADLINE).then((state) => {
      if (off) return
      if (state !== null) {
        kept.current = state
        keptSeeks.current = asked
      }
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
    // The project's id moves the wanted address with it, so naming it adds
    // no run of its own.
  }, [wanted, showing, project.id])

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
    // The seeks counted when the page this navigation left was read, taken
    // with the navigation itself, so a later one cannot move it underneath.
    const since = keptSeeks.current
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
        // The theme is the project's as it stands at the moment each call is
        // sent, whatever this document's address said: its first call, on
        // every load. It is not read from this render's `project`, which is
        // the one that started the load, nor from a ref set by an effect,
        // which runs after a press has already sent its own call; it is
        // read from the memory the press writes the moment its record write
        // returns (`themeMemory.ts`), so whichever of the press and this
        // restore reaches the page last carries the same theme.
        //
        // And a seek made since the page being left was read goes in place
        // of the clock that page said (issue 660): the transport is offered
        // from the run's end, before this document had loaded, and a
        // person's move in that beat is the newer word. Read again before
        // each call, as the speed and the pause are.
        const memory = transportFor(project.id)
        const sought = (): number | null => soughtSince(memory.sought, since)
        const themeNow = (): Theme => themeAsItStands(project.id, project.theme)
        const composed = withRemembered(kept.current, memory.snapshot, sought())
        await giveBack(restoreCalls(composed, themeNow()), {
          alive: () => navigation === navigations.current && mounted.current,
          // Read again one call before each is sent, rather than once for the
          // whole list: this loop is up to seven awaited round trips long and
          // cell 03's controls and the theme switch are live throughout. A
          // Pause pressed during it writes the memory and sends its own call,
          // and a list composed before that press would then overwrite it.
          // `asDispatched` and `asDispatchedTheme` are which of these calls
          // assert a state and which do not (`viewerGiveBack.ts`).
          remembered: () => memory.snapshot,
          sought,
          theme: themeNow,
          send: (method, args) => window.api.viewer.call(ROLE, method, ...args),
        })
        // What this document's seam has, for the screen to tell a page an
        // older engine drew (issue 465): asked once the page has been given
        // back, so the restore goes as it always went, and held to the same
        // deadline as the state read, because the page answering is the
        // page's to refuse. Said only for the document this load was for.
        if (onSeams === undefined) return
        const seams = await answerWithin(() => window.api.viewer.seams(), STATE_DEADLINE)
        if (navigation !== navigations.current || !mounted.current) return
        onSeams(readSeams(seams))
      },
      () => {
        if (mounted.current) setProblem("This project's map is not there. Lay it out again.")
      },
    )
  }

  return (
    <section className="viewer" aria-label="Map" data-on-open={openDecision ?? undefined}>
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
