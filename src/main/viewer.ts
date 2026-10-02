// Driving the engine's page from the privileged process.
//
// The page runs in a sandboxed frame at an opaque origin, so the interface
// cannot reach it and it cannot reach the interface (ADR-028). What can
// reach it is this: `webFrameMain.executeJavaScript` injects into the
// frame's main world from the browser process, which the sandbox does not
// stop. That is the fact the whole design turns on, and it is why the app
// never needed to share an origin with the page.
//
// Two rules hold the boundary up, and both are here rather than in a comment
// somewhere:
//
//   1. A frame is held by identity, from the moment it is attached. It is
//      never looked up by address at the moment of use, because the page can
//      navigate itself and a lookup by address would then find nothing, or
//      worse, fall back to the interface's own frame.
//   2. Nothing a caller sends becomes code. The method's name is checked
//      against the page's own list and the arguments are serialised as data
//      into a fixed dispatcher.
//
// Since ADR-046 a window holds two frames, by role: the `map` in the
// notebook's flow, and the `export` preview cell 06 mounts while it is open.
// Which frame is which is decided once, at attach, from its address, and
// never again; a call names its role and reaches the frame held for it.
//
// Contract: specs/008-viewer/contracts/viewer.md; the roles are
// specs/029-the-map-in-the-flow (FR-006).

import type { WebContents, WebFrameMain } from 'electron'
import {
  EXPORT_FRAME_METHODS,
  isViewerMethod,
  type ViewerMethod,
  type ViewerRole,
} from '../shared/viewer'

/**
 * Which of the two frames an address can be held as, for this project, or
 * neither.
 *
 * The address has to be under the project's own folder, which both frames'
 * pages are. Then:
 *
 * - **`safe=1` is the export's, always.** The app asks for the safe zones
 *   only for cell 06's preview, the engine writes them onto that address
 *   alone, and an export's own plan never carries them (specs/022 FR-006).
 *   So an address with them is never matched as the map, which is the rule
 *   that keeps the map's frame from being driven while it shows a preview.
 * - **`controls=1` is the map's.** It is the app's own word, written by
 *   `pageUrl` in `Viewer.tsx`, and the engine's planned addresses never
 *   carry it: `url_for` in its export.py writes the frame, the title, the
 *   clock and the rest, and no controls.
 * - **Anything else under the folder is a planned page without safe
 *   zones**, which is the export's: a preset such as a LinkedIn post has
 *   none, and its preview is still the export's frame. `safe=1` alone could
 *   not tell that address from the map's, which is why the map's own word
 *   is read as well.
 */
export function roleOfAddress(url: string, projectId: string): ViewerRole | null {
  const prefix = `app://local/projects/${projectId}/`
  if (!url.startsWith(prefix)) return null
  let query: URLSearchParams
  try {
    query = new URL(url).searchParams
  } catch {
    return null
  }
  if (query.getAll('safe').includes('1')) return 'export'
  if (query.getAll('controls').includes('1')) return 'map'
  return 'export'
}

interface Held {
  frame: WebFrameMain
  projectId: string
}

/** The frames this window's viewer is showing, by role. */
export class Viewer {
  #held: Record<ViewerRole, Held | null> = { map: null, export: null }
  /**
   * The role each frame was first held in, by its place in the frame tree,
   * for the life of this viewer. A frame that has been the map is never the
   * export's, even when it is not held at the moment: a map page that sends
   * itself to an address without `controls=1` reads as the export's by its
   * address, fails to be re-attached as the map, and would otherwise be
   * adopted by the next export attach with the roles swapped.
   */
  #roles = new Map<number, ViewerRole>()
  readonly #log: (message: string) => void

  constructor(log: (message: string) => void = () => {}) {
    this.#log = log
  }

  /** The project whose frame is held in this role, or null. */
  projectIdOf(role: ViewerRole): string | null {
    return this.#held[role]?.projectId ?? null
  }

  /**
   * Hold the frame showing this project's page in this role. The frame is
   * found once, among the interface's children, by its address; from here
   * on it is held, and its address is never consulted again.
   *
   * Once per document, which is not once per element. The interface never
   * remounts the map's frame - a remount reloads the page, and a reload
   * loses its clock, its view and its scrub position - but it does send it
   * to the page a run has just rewritten, and the export's frame is sent to
   * each plan in turn. Each of those is a new document that has to be found
   * again, so the renderer attaches on every load and the hold already there
   * for that role is released first, on the line below. The frame held in
   * the other role is never taken, whatever its address says now.
   */
  attach(contents: WebContents, projectId: string, role: ViewerRole): boolean {
    this.release(role)
    const main = contents.mainFrame
    const other = this.#held[role === 'map' ? 'export' : 'map']?.frame ?? null
    const frame = main.frames.find((child) => {
      if (child === main || child === other) return false
      if (roleOfAddress(child.url, projectId) !== role) return false
      const was = this.#roles.get(child.frameTreeNodeId)
      return was === undefined || was === role
    })
    if (frame === undefined) {
      this.#log(`no ${role} frame for the project asked for`)
      return false
    }
    this.#roles.set(frame.frameTreeNodeId, role)
    this.#held[role] = { frame, projectId }
    return true
  }

  release(role: ViewerRole): void {
    this.#held[role] = null
  }

  /** The held frame, if it is still there and still is not the interface's. */
  #usable(contents: WebContents, role: ViewerRole): WebFrameMain | null {
    const frame = this.#held[role]?.frame ?? null
    if (frame === null) return null
    // A frame that has gone answers nothing useful, and a frame that has
    // somehow become the interface's own must never be injected into.
    try {
      if (frame === contents.mainFrame) return null
      if (!contents.mainFrame.frames.includes(frame)) return null
    } catch {
      return null
    }
    return frame
  }

  /**
   * One of the page's own methods, in the frame held for this role. The
   * name is checked against the page's list first, so a caller cannot name
   * anything else, and the arguments go in as data. The export's frame is
   * asked whether it has loaded and nothing more.
   */
  async call(
    contents: WebContents,
    role: ViewerRole,
    method: string,
    args: unknown[],
  ): Promise<unknown> {
    if (!isViewerMethod(method)) {
      throw new Error('that is not something the map can be asked to do')
    }
    if (role === 'export' && !EXPORT_FRAME_METHODS.includes(method)) {
      throw new Error("the export's preview is not driven from here")
    }
    const frame = this.#usable(contents, role)
    if (frame === null) {
      throw new Error(
        role === 'map' ? 'the map is not on the screen' : 'the preview is not on the screen',
      )
    }
    let serialised: string
    try {
      serialised = JSON.stringify(args)
    } catch {
      throw new Error('the map cannot be asked that')
    }
    const answer = (await frame.executeJavaScript(dispatcher(method, serialised))) as
      { ok: true; value: unknown } | { ok: false; error: string } | undefined
    // `typeof null` is 'object', which is exactly the sort of thing that
    // turns an unexpected answer into an internal error message on a screen.
    if (answer === null || typeof answer !== 'object' || typeof answer.ok !== 'boolean') {
      throw new Error('the map did not answer')
    }
    if (!answer.ok) {
      // The page's own words, trimmed **here**. The dispatcher trims them
      // too, but it runs in the page's realm, where the page owns `String`,
      // `RegExp` and `slice` and could return anything it liked at any
      // length. The control belongs on this side of the line.
      const said = typeof answer.error === 'string' ? answer.error : ''
      const safe = said
        .replace(/[^ -~]/g, '')
        .slice(0, 200)
        .trim()
      throw new Error(safe === '' ? 'the map could not do that' : safe)
    }
    return answer.value
  }
}

/**
 * The injected text. Fixed but for the method's name, which has already been
 * checked against the page's list, and the arguments, which are JSON.
 *
 * It answers with a result object rather than throwing, because a throw
 * inside an injected script comes back as a fixed sentence with the page's
 * own message lost.
 */
function dispatcher(method: ViewerMethod, args: string): string {
  return `(function () {
  try {
    var present = window.__present
    if (!present) return { ok: false, error: 'the map is still loading' }
    var fn = present[${JSON.stringify(method)}]
    if (typeof fn !== 'function') return { ok: false, error: 'this map cannot do that' }
    var value = fn.apply(present, JSON.parse(${JSON.stringify(args)}))
    return { ok: true, value: value === undefined ? null : JSON.parse(JSON.stringify(value)) }
  } catch (e) {
    var said = e && e.message ? String(e.message) : ''
    return { ok: false, error: said.replace(/[^ -~]/g, '').slice(0, 200) }
  }
})()`
}
