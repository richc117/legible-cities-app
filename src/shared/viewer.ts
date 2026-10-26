// The seam the engine's page exposes, as the app is allowed to use it.
//
// The list is the app's copy of the page's own `window.__present`, and it is
// deliberately shorter: the capture methods belong to the export path, and
// `onDraw` takes a function, which cannot cross into another frame. A gated
// test against a real generated page asserts the page still has every method
// named here.
//
// Contract: specs/008-viewer/contracts/viewer.md. Why the frame is sandboxed
// and driven from the privileged process: ADR-028.

// `setTheme` is the page's own since engine v0.11.0 (its issue 29): it takes
// `warm-dark` or `sepia`, restyles the page in place and answers false for any
// other name. A page the engine wrote before that has no such method, and the
// dispatcher answers "this map cannot do that" for it. Such a page is redrawn
// from its stored layout when its project opens (issue 465, `PAGE_SEAMS`
// below), so the answer is met only where that redraw could not run.
//
// `setTrip` is the page's own since engine v0.13.0 (its issue 49, app issue
// 272, ADR-048): `setTrip(from, to)` with two station ids from `map.build`'s
// `stations` fades everything off the trip the page finds between them, and
// `setTrip(null)` shows the whole network again. It answers what
// `state().trip` then says - null, a trip with its legs, or `legs: null` and
// the page's reason - which the app reads as untrusted data
// (`readTrip` in `trip.ts`). Called from cell 03's Trip section and from a
// reloaded page's restore, through the main process, as every method here is.
export const VIEWER_METHODS = [
  'showView',
  'setLabels',
  'setRoutes',
  'setTheme',
  'setTrip',
  'seek',
  'setSpeed',
  'setPlaying',
  'hasGeo',
  'bounds',
  'state',
] as const

export type ViewerMethod = (typeof VIEWER_METHODS)[number]

/**
 * What the dispatcher in `src/main/viewer.ts` answers when the page has no
 * such method: its own fixed sentence, which reaches the interface as the
 * message of a rejected `viewer.call`. A page the engine wrote before v0.11.0
 * answers it to `setTheme`, and that is how the interface knows to fall back
 * to loading the theme through the address (`themeWrites.ts`). A test runs
 * the real dispatcher against a page without the method, so the two cannot
 * drift apart.
 */
export const MISSING_METHOD = 'this map cannot do that'

export function isViewerMethod(value: unknown): value is ViewerMethod {
  return typeof value === 'string' && (VIEWER_METHODS as readonly string[]).includes(value)
}

/**
 * Every method the pinned engine's page has on `window.__present`, which is
 * more than the app drives on the map (`VIEWER_METHODS`): the capture's own
 * (`advance`, `setCapture`, `settle`, `setFrame`), the opening's (`setCard`,
 * `setDrawn`, engine v0.15.0) and the two axes beneath `showView`. As of
 * engine v0.20.0, `page/page.html`'s seam object, in its order.
 *
 * It is how a page an older engine drew is told from a current one (issue
 * 465). The page carries no version of the engine that drew it - its HTML
 * has none, and `state()` answers none - and until issue 494 neither did the
 * record, whose `drawn` now names it (`drawn.engine`) for every map drawn
 * since, and a `drawn` that names none is older by that alone. Every
 * seam the engine has added has been a method on this object
 * (`setTheme` at v0.11.0, `setTrip` at v0.13.0, `setCard` and `setDrawn` at
 * v0.15.0), so **a page lacking any of these is older than the pin**,
 * whatever else it has. A gated test holds this list to the engine's own
 * page template at the checkout, method for method in both directions
 * (`tests/unit/viewer-real.test.ts`), so a pin that adds a seam fails there
 * until the seam is named here, and every page drawn before it is then
 * redrawn when it opens.
 */
export const PAGE_SEAMS = [
  'advance',
  'seek',
  'setCapture',
  'setPlaying',
  'setSpeed',
  'setView',
  'setGeo',
  'showView',
  'hasGeo',
  'setLabels',
  'setRoutes',
  'setFrame',
  'setTheme',
  'settle',
  'bounds',
  'onDraw',
  'state',
  'setTrip',
  'setCard',
  'setDrawn',
] as const

/** The most names a page's answer about its seam may hold before it is no answer. */
export const SEAMS_MAX = 256

/** One method's name, as the page's answer may give it: a plain identifier of at most 64 characters. */
const SEAM_NAME = /^[A-Za-z_$][\w$]{0,63}$/

/**
 * The names of the methods a page says its seam has, or null where the
 * answer is not a list of them. Data from a page the app does not trust
 * (ADR-028), read here before anything is done with it: an answer that is
 * not an array, holds more than `SEAMS_MAX` entries or anything but a
 * method's name is no answer at all, never a list cut down to its good part,
 * because a page that would say that much is not saying which seams it has.
 */
export function readSeams(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > SEAMS_MAX) return null
  const names: string[] = []
  for (const name of value) {
    if (typeof name !== 'string' || !SEAM_NAME.test(name)) return null
    if (!names.includes(name)) names.push(name)
  }
  return names
}

/**
 * Whether a page an older engine drew is the one on screen, from what its
 * seam has (`readSeams`): true when any method the pinned engine's page has
 * is missing from it, false when none is, and null when the page did not say,
 * which is not a reason to do anything. A page with methods beyond the pin's
 * - one a newer engine drew - is not older.
 */
export function isOlderPage(seams: readonly string[] | null): boolean | null {
  if (seams === null) return null
  return PAGE_SEAMS.some((name) => !seams.includes(name))
}

/**
 * What the page says it is showing. Data from a page we do not trust.
 *
 * `theme` is `warm-dark` or `sepia` from engine v0.11.0 on, and is a claim
 * like the rest of it: read as unknown and checked with `isTheme` before
 * anything is done with it.
 */
export interface ViewerState {
  now: number
  clock: string
  viewName: string
  labels: boolean
  theme?: string
  /** What `setTrip` last answered, from engine v0.13.0: null, or a trip or a reason (`readTrip`). */
  trip?: unknown
  [key: string]: unknown
}

export interface ViewerBounds {
  t0: number
  t1: number
}

/** The exact sandbox the viewer's frame carries, and the whole of it.
 *  `allow-same-origin` beside this would undo ADR-028 in one word. */
export const VIEWER_SANDBOX = 'allow-scripts'

/**
 * Which of a window's two engine frames a request is for (ADR-046): the
 * map in the notebook's flow, which keeps its clock for the life of the
 * screen, and cell 06's preview of the export, which is mounted while the
 * cell is open and asked nothing but whether it has loaded.
 */
export const VIEWER_ROLES = ['map', 'export'] as const

export type ViewerRole = (typeof VIEWER_ROLES)[number]

export function isViewerRole(value: unknown): value is ViewerRole {
  return typeof value === 'string' && (VIEWER_ROLES as readonly string[]).includes(value)
}

/**
 * The one thing the export's frame is asked: whether its page has loaded,
 * which is what tells a page from the origin's 404 (`Viewer.tsx`). Nothing
 * in the interface drives the export's page, so the main process refuses
 * anything else for that role.
 */
export const EXPORT_FRAME_METHODS: readonly ViewerMethod[] = ['state']
