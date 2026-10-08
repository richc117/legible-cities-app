import type { Theme } from '../../shared/project'
import type { ViewerMethod } from '../../shared/viewer'

// Giving the engine's page back what the page before it was showing.
//
// The frame is never moved between parents and never remounted (ADR-045,
// A5.5-20): both reload the engine's page. What is left is one deliberate
// navigation, made when a run has rewritten the page file - and a
// navigation is still a new document. (A theme is not one: since engine
// v0.11.0 the page restyles in place through `setTheme`, issue 349, unless
// the page is an older one with none, which is loaded again.) The
// page that arrives starts where present.js puts it: at the beginning of
// the service day, in the view its address names, playing. So the page on
// screen is asked what it is showing before the frame is sent anywhere, and
// this is what gives it back.
//
// This file is the sequence and nothing else: a state in, an ordered list
// of calls out. No React, no window, no bridge, so it is tested without
// any of them - and the order is the part worth testing.
//
//   0. The project's theme, before anything else and whatever else is
//      known. The address the page loaded from carries the theme of the
//      moment it was made, which may not be the project's now (a press
//      lands between an address being made and its document arriving), and
//      a page a run has rewritten says whatever its address said. It
//      neither moves the clock nor depends on anything below, and it is
//      first so that a press made while this sequence runs - which sends its
//      own `setTheme` after the record is written - is always the later
//      word.
//   1. The page is stopped, whatever it was doing, because every call below
//      is a round trip through the privileged process and a running clock
//      moves between them.
//   2. The view, the labels and the speed, which redraw.
//   3. The clock last of the things that move it.
//   4. Playing again, only if it was.
//
// What can be given back is what the page will say. Its `state()` answers
// `viewName`, `labels` and `now`, and says nothing about the speed or
// whether it was playing - the same seam gap engine issue 29 is about from
// the other side. Those two are therefore optional: a caller that knows
// them, as the scrub in cell 03 will because it set them, hands them in
// and they are restored too. A caller that does not leaves the page with
// its own defaults, which is what it had before this existed.
//
// Everything here arrives from a page the app does not trust (ADR-028), so
// every field is checked for shape before it is handed back. There is no
// allowlist of view names: the name goes back to the page that gave it,
// which could have called `showView` on itself anyway, and a list here
// would only rot the first time the engine grows a view.

/** One call to the page's own seam, in the shape `window.api.viewer.call` takes. */
export interface ViewerCall {
  method: ViewerMethod
  args: unknown[]
}

/**
 * What a page said it was showing. Deliberately loose: it is whatever
 * `state()` answered, which is the engine's shape and not ours, plus the
 * two fields a caller may know that the page does not report.
 */
export interface PageState {
  /** `showView`'s own name for the view now showing: "schematic", "time", "geographic". */
  viewName?: unknown
  labels?: unknown
  /** Seconds into the service day. */
  now?: unknown
  /** Seconds of the service day per second of wall clock. Not reported by the page. */
  speed?: unknown
  /** Not reported by the page either; known only to a caller that set it. */
  playing?: unknown
}

/** A view name is long enough to be readable and short enough not to be an essay. */
const VIEW_NAME_MAX = 64

const view = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= VIEW_NAME_MAX ? value : null

const flag = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null)

/** A second of the service day: finite, and never before its start. */
const seconds = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

/** A speed the page can run at: finite and above zero. Zero is what pausing is for. */
const rate = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null

/**
 * The calls that put a freshly loaded page back where the last one was, in
 * the order they are to be made. The first is always the project's theme,
 * which is the project's and not something the page being left said; after
 * it nothing known means nothing to do, and the page keeps the state its
 * address gave it.
 *
 * `showView` is passed a duration of zero so the view snaps rather than
 * tweening: this is a page coming back to where it already was, and an
 * animation would say something happened.
 */
export function restoreCalls(state: unknown, theme: Theme): ViewerCall[] {
  const calls: ViewerCall[] = [{ method: 'setTheme', args: [theme] }]
  if (state === null || typeof state !== 'object') return calls
  const was = state as PageState
  const playing = flag(was.playing)
  const name = view(was.viewName)
  const labels = flag(was.labels)
  const speed = rate(was.speed)
  const at = seconds(was.now)

  // Stopped first of what moves the page, and only when the caller knows it
  // was stopped or running: a page paused by this that nothing then restarts
  // is worse than a clock a fraction of a second behind.
  if (playing !== null) calls.push({ method: 'setPlaying', args: [false] })
  if (name !== null) calls.push({ method: 'showView', args: [name, 0] })
  if (labels !== null) calls.push({ method: 'setLabels', args: [labels] })
  if (speed !== null) calls.push({ method: 'setSpeed', args: [speed] })
  if (at !== null) calls.push({ method: 'seek', args: [at] })
  if (playing === true) calls.push({ method: 'setPlaying', args: [true] })
  return calls
}
