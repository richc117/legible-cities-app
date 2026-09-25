import type { ViewerBounds } from '../../shared/viewer'
import type { PageState } from './viewerRestore'

// Cell 03's transport, without React: what the app may believe about the
// page's clock, and what it has to remember for it (A5.5-16).
//
// The engine's page already runs the service day - `seek`, `setPlaying`,
// `setSpeed`, `bounds` and `state` are on its `__present` seam and
// `VIEWER_METHODS` already carries all five - so nothing here is an engine
// request, a map build or a record write. Looking is not editing: no cell
// goes stale for any of it (contracts/run-graph.md).
//
// Two facts shape everything below.
//
//   1. **The clock is the page's and never the app's.** `state()` answers
//      `now` and `clock`, so the app reads it back rather than counting
//      seconds of its own. An app-side clock would be a second renderer of
//      the one thing the page is authoritative about, and it would drift
//      the moment the page was busy, paused by its own controls, or
//      navigated by a run.
//   2. **The page cannot be asked whether it is playing, or how fast.**
//      `state()` answers `now`, `clock`, `viewName`, `labels` and no more
//      (engine issue 29). So those two the app must remember - and it has
//      to remember them somewhere that outlives the component, because a
//      run, a theme change or the export's preview navigates the frame and
//      the page that arrives starts at the address's own defaults.
//      `restoreCalls` in `viewerRestore.ts` was built to take `speed` and
//      `playing` "from a caller that knows them"; this is where that caller
//      keeps them, and `Viewer.tsx` reads it as it hands the page over.
//
// The memory is per project and lives for the session. It is two values -
// a number and a flag - so nothing is freed when a project is deleted: a
// forgotten entry costs less than a bridge method to forget it with, and
// the values are meaningless to any other project's page.

/**
 * The page's own speed on the address the app builds, in seconds of the
 * service day per second of wall clock.
 *
 * The app's address names neither `speed` nor `play`, so what a freshly
 * loaded page is doing is what `present.js` falls back to: `num("speed",
 * 60)` and `on("play", true)`. Those are the engine's, not ours, which is
 * why they are stated here with the engine's own defaults beside them and
 * asserted against a real generated page by `tests/unit/viewer-real.test.ts`
 * rather than assumed. Until a person presses something, the controls show
 * these because they are what the page is actually doing.
 */
export const PAGE_SPEED = 60

/** The page plays from load, for the same reason and from the same place. */
export const PAGE_PLAYING = true

/** What the app has told this project's page, and cannot read back. */
export interface Remembered {
  /** The last speed set, or null where the app has set none. */
  speed: number | null
  /** The last play or pause, or null where the app has asked for neither. */
  playing: boolean | null
}

/** A speed the transport offers, and the words it offers it in. */
export interface Speed {
  /** Seconds of the service day per second of wall clock. */
  rate: number
  label: string
}

/**
 * The speeds on offer. Named in the service day's own terms - how much of
 * the day passes in a second - rather than as a multiple of a default,
 * because the default is the engine's and a "2x" that moved with it would
 * mean two different things in two versions.
 *
 * `PAGE_SPEED` is one of them, so the control can show what an untouched
 * page is doing without inventing a row for it.
 */
export const SPEEDS: readonly Speed[] = [
  { rate: 15, label: '15 seconds a second' },
  { rate: 30, label: '30 seconds a second' },
  { rate: PAGE_SPEED, label: 'A minute a second' },
  { rate: 120, label: 'Two minutes a second' },
  { rate: 300, label: 'Five minutes a second' },
]

/** The speed to show: the one remembered, if it is still one we offer. */
export function shownSpeed(remembered: Remembered): number {
  return SPEEDS.some(({ rate }) => rate === remembered.speed)
    ? (remembered.speed as number)
    : PAGE_SPEED
}

/** Whether the page is playing, as far as the app can know. */
export function shownPlaying(remembered: Remembered): boolean {
  return remembered.playing ?? PAGE_PLAYING
}

/**
 * The bounds of the service day, out of whatever `bounds()` answered.
 *
 * Everything from the page is untrusted (ADR-028), and this one is arithmetic
 * a control is then built from: a `t1` of `NaN` makes a range control whose
 * every position is invalid, silently.
 */
export function readBounds(answer: unknown): ViewerBounds | null {
  if (answer === null || typeof answer !== 'object') return null
  const { t0, t1 } = answer as { t0?: unknown; t1?: unknown }
  if (typeof t0 !== 'number' || !Number.isFinite(t0) || t0 < 0) return null
  if (typeof t1 !== 'number' || !Number.isFinite(t1) || t1 <= t0) return null
  return { t0, t1 }
}

/** A clock is `07:20`, or `07:20 +1d`. Nothing the page says is longer than a label. */
const CLOCK_MAX = 32

/** Where the page's clock stands: the seconds, and the page's own wording of them. */
export interface PageClock {
  now: number
  clock: string
}

/** Where the page's clock stands, out of whatever `state()` answered. */
export function readClock(answer: unknown): PageClock | null {
  if (answer === null || typeof answer !== 'object') return null
  const { now, clock } = answer as { now?: unknown; clock?: unknown }
  if (typeof now !== 'number' || !Number.isFinite(now) || now < 0) return null
  // The page's own formatting, so the app never writes a time itself. Kept
  // short: it is `HH:MM`, or `HH:MM +1d` past midnight, and anything much
  // longer is not that.
  if (typeof clock !== 'string' || clock.length === 0 || clock.length > CLOCK_MAX) return null
  return { now, clock }
}

/** What one pass of the poll managed to learn. `bounds` is null once it is known. */
export interface Polled {
  /** The day, the first time it is learnt, and null on every pass after. */
  bounds: ViewerBounds | null
  clock: PageClock | null
}

/**
 * The poll: what the control asks the page, and when.
 *
 * **`bounds` is asked on every pass until it answers, and this is the whole
 * reason the poll is a unit of its own.** The first ask cannot succeed. The
 * privileged process can only reach the page through a frame it is holding,
 * and it is handed that frame by the iframe's own `load` handler
 * (`Viewer.tsx`) - so on a project screen the order is: React commits, the
 * iframe begins loading, React flushes passive effects, and this asks. The
 * frame is not attached yet, `viewer.call` throws "the map is not on the
 * screen", and there is nothing to retry it. Asked once at mount, the
 * control therefore never appeared at all on the plain path - open a
 * laid-out project and look at cell 03 - and appeared only where something
 * later re-ran the effect, which is a cell toggled or a run finished. Five
 * end-to-end runs out of five caught it, because it is not a race: the load
 * cannot complete inside the commit that starts it.
 *
 * **One ask is outstanding at a time.** Every ask is an injection into the
 * frame's main world, and injections into one frame are serialised by that
 * frame's main thread: a pass fired while the last has not answered does not
 * overtake it, it queues behind it. A page that answers slowly would build a
 * backlog two a second, and that backlog sits *ahead of* the one-second
 * read `Viewer.tsx` makes before it navigates - so a poll with no guard
 * makes that deadline more likely to pass, and a missed deadline silently
 * discards the restore and loses the person's clock, view and labels across
 * a run. The guard also removes the reordering: without it a slow pass can
 * answer after a fast one and write an older clock over a newer one.
 *
 * There is deliberately **no deadline on the ask itself**. A deadline would
 * resolve the pass while the underlying call stayed outstanding, and the
 * next pass would then ask again - which is the backlog back, only slower.
 * The cost of the guard alone is that a page whose main thread never returns
 * freezes this control. That is the better of the two: a frozen scrub beside
 * a frozen map is visible and honest, and it costs the person nothing they
 * cannot see, while a lost restore is invisible and costs them their place.
 *
 * Pure but for `ask`, which is handed in, so all of the above is a test
 * without a window, a bridge or a frame.
 */
export function makePoll(
  ask: (method: 'bounds' | 'state') => Promise<unknown>,
  learnt: (what: Polled) => void,
): { tick: () => void } {
  let asking = false
  let day: ViewerBounds | null = null
  const pass = async (): Promise<void> => {
    let found: ViewerBounds | null = null
    if (day === null) {
      found = readBounds(await ask('bounds').catch(() => null))
      // Nothing more is asked on a pass that could not learn the day: there
      // is no control on the screen yet for a clock to be the clock of. The
      // next tick asks again.
      if (found === null) return
      day = found
    }
    learnt({ bounds: found, clock: readClock(await ask('state').catch(() => null)) })
  }
  // Cleared in **both** branches, and this is not belt and braces: `pass`
  // handles its own refusals, so the way it throws is `learnt` throwing -
  // the caller's own callback, which in the control sets React state.
  // Cleared on success alone, one throw from there would leave the guard up
  // and stop the poll for the life of the screen, which is the defect above
  // again by another route. Passing a handler to both arms also keeps the
  // rejection from escaping as an unhandled one.
  const done = (): void => {
    asking = false
  }
  return {
    tick: (): void => {
      if (asking) return
      asking = true
      void pass().then(done, done)
    },
  }
}

/**
 * The argument one call of a restore should carry at the moment it is
 * dispatched, rather than the one it was composed with.
 *
 * `Viewer.tsx` composes the restore from the memory and then awaits up to
 * six round trips through the privileged process. A Play, a Pause or a speed
 * pressed during those trips writes the memory and sends its own call, and
 * was then overwritten by the restore's own - and because `state()` reports
 * neither speed nor playing (engine issue 29), nothing anywhere could ever
 * notice: the control said "Pause" while the page ran, for good.
 *
 * Two of the restore's calls assert a state and are therefore re-read:
 * `setSpeed`, and the `setPlaying(true)` that ends the sequence. The
 * `setPlaying(false)` that begins it is not re-read, because it is not a
 * claim about anything - it is the stop that keeps the clock still while
 * the view, the labels and the seek are given back, and a person's press
 * arriving after it is the last word either way.
 */
export function asDispatched(method: string, args: unknown[], remembered: Remembered): unknown[] {
  if (method === 'setSpeed' && remembered.speed !== null) return [remembered.speed]
  if (method === 'setPlaying' && args[0] === true && remembered.playing !== null)
    return [remembered.playing]
  return args
}

/** A second of the service day, inside the day the page says it has. */
export function clampTo(bounds: ViewerBounds, seconds: number): number {
  if (!Number.isFinite(seconds)) return bounds.t0
  return Math.min(bounds.t1, Math.max(bounds.t0, seconds))
}

/**
 * Why the page cannot be moved just now, or null where it can.
 *
 * A run, a rebuild, a recolour and a reorder all end by rewriting the page
 * file and navigating the frame to it, and an export reads the page frame
 * by frame; the export's preview replaces the map with the address
 * `export.plan` answered, which is cell 06's picture and not this cell's.
 * Moving the clock in any of those either lands on a document about to be
 * replaced or moves a picture the person is looking at for another reason.
 *
 * It is a sentence and not a disabled control, deliberately. A control that
 * disables itself under a person's hands drops the focus with it (A6-07,
 * ADR-045), and the cheapest of these - a recolour's debounced redraw -
 * starts without a press. So the controls stay reachable and a press gets
 * an answer. Nothing is queued for later either, unlike a colour: a clock
 * position a person asked for four seconds ago, applied to a map that has
 * since been redrawn, is not what they asked for.
 */
export function transportRefusal(page: {
  laying: boolean
  exporting: boolean
  previewing: boolean
}): string | null {
  if (page.laying) return 'The map is being drawn. It can be moved again when the run ends.'
  if (page.exporting) return 'The export is reading the map. It can be moved again afterwards.'
  if (page.previewing)
    return 'The map is showing what the export will frame. Close cell 06 and it moves again.'
  return null
}

/**
 * What a freshly loaded page should be given back: whatever the page being
 * left said it was showing, with the two fields no page will ever say laid
 * over it.
 *
 * The state is untrusted and may be anything at all, so a non-object is
 * taken as nothing known rather than spread. A field the app has not set is
 * left out entirely, which `restoreCalls` reads as "not known": that is the
 * difference between a page left at its own defaults and one paused by this
 * and never started again.
 */
export function withRemembered(state: unknown, remembered: Remembered): PageState {
  const base: PageState =
    state !== null && typeof state === 'object' ? { ...(state as PageState) } : {}
  if (remembered.speed !== null) base.speed = remembered.speed
  if (remembered.playing !== null) base.playing = remembered.playing
  return base
}

/**
 * One project's memory of what the app told its page. It has the shape
 * `useSnapshot` takes, so the control re-renders from it and the memory is
 * the one copy rather than a mirror of a component's state.
 */
export class TransportMemory {
  #state: Remembered = { speed: null, playing: null }
  readonly #listeners = new Set<(state: Remembered) => void>()

  get snapshot(): Remembered {
    return this.#state
  }

  subscribe(listener: (state: Remembered) => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /**
   * Remember what has just been asked of the page. Written before the call
   * is answered, and deliberately: the call is answered only by a page that
   * is there, and a page that is not there is one about to be navigated -
   * at which point this is what tells the next page what to be.
   *
   * A write of the value already held raises nothing, so a control that
   * re-sends its own state does not re-render the cell around it.
   */
  remember(next: Partial<Remembered>): void {
    const merged = { ...this.#state, ...next }
    if (merged.speed === this.#state.speed && merged.playing === this.#state.playing) return
    this.#state = merged
    for (const listener of this.#listeners) listener(merged)
  }
}

const memories = new Map<string, TransportMemory>()

/** This project's memory, made on first use and kept for the session. */
export function transportFor(projectId: string): TransportMemory {
  const held = memories.get(projectId)
  if (held !== undefined) return held
  const made = new TransportMemory()
  memories.set(projectId, made)
  return made
}
