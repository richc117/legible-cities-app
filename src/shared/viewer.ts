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

export const VIEWER_METHODS = [
  'showView',
  'setLabels',
  'setRoutes',
  'seek',
  'setSpeed',
  'setPlaying',
  'hasGeo',
  'bounds',
  'state',
] as const

export type ViewerMethod = (typeof VIEWER_METHODS)[number]

export function isViewerMethod(value: unknown): value is ViewerMethod {
  return typeof value === 'string' && (VIEWER_METHODS as readonly string[]).includes(value)
}

/** What the page says it is showing. Data from a page we do not trust. */
export interface ViewerState {
  now: number
  clock: string
  viewName: string
  labels: boolean
  [key: string]: unknown
}

export interface ViewerBounds {
  t0: number
  t1: number
}

/** The exact sandbox the viewer's frame carries, and the whole of it.
 *  `allow-same-origin` beside this would undo ADR-028 in one word. */
export const VIEWER_SANDBOX = 'allow-scripts'
