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
// dispatcher answers "this map cannot do that" for it.
export const VIEWER_METHODS = [
  'showView',
  'setLabels',
  'setRoutes',
  'setTheme',
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
