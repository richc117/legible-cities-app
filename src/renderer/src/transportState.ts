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

/** Where the page's clock stands, out of whatever `state()` answered. */
export function readClock(answer: unknown): { now: number; clock: string } | null {
  if (answer === null || typeof answer !== 'object') return null
  const { now, clock } = answer as { now?: unknown; clock?: unknown }
  if (typeof now !== 'number' || !Number.isFinite(now) || now < 0) return null
  // The page's own formatting, so the app never writes a time itself. Kept
  // short: it is `HH:MM`, or `HH:MM +1d` past midnight, and anything much
  // longer is not that.
  if (typeof clock !== 'string' || clock.length === 0 || clock.length > CLOCK_MAX) return null
  return { now, clock }
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
