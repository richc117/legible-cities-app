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
//   1. The frame is held by identity, from the moment it is attached. It is
//      never looked up by address at the moment of use, because the page can
//      navigate itself and a lookup by address would then find nothing, or
//      worse, fall back to the interface's own frame.
//   2. Nothing a caller sends becomes code. The method's name is checked
//      against the page's own list and the arguments are serialised as data
//      into a fixed dispatcher.
//
// Contract: specs/008-viewer/contracts/viewer.md.

import type { WebContents, WebFrameMain } from 'electron'
import { isViewerMethod, type ViewerMethod } from '../shared/viewer'

/** The one frame this window's viewer is showing, or none. */
export class Viewer {
  #frame: WebFrameMain | null = null
  #projectId: string | null = null
  readonly #log: (message: string) => void

  constructor(log: (message: string) => void = () => {}) {
    this.#log = log
  }

  get projectId(): string | null {
    return this.#projectId
  }

  /**
   * Hold the frame showing this project's page. The frame is found once,
   * among the interface's children, by the address it was given; from here
   * on it is held, and its address is never consulted again.
   */
  attach(contents: WebContents, projectId: string): boolean {
    this.release()
    const wanted = `app://local/projects/${projectId}/`
    const main = contents.mainFrame
    const frame = main.frames.find((child) => child !== main && child.url.startsWith(wanted))
    if (frame === undefined) {
      this.#log(`no viewer frame for the project asked for`)
      return false
    }
    this.#frame = frame
    this.#projectId = projectId
    return true
  }

  release(): void {
    this.#frame = null
    this.#projectId = null
  }

  /** The held frame, if it is still there and still is not the interface's. */
  #usable(contents: WebContents): WebFrameMain | null {
    const frame = this.#frame
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
   * One of the page's own methods. The name is checked against the page's
   * list first, so a caller cannot name anything else, and the arguments go
   * in as data.
   */
  async call(contents: WebContents, method: string, args: unknown[]): Promise<unknown> {
    if (!isViewerMethod(method)) {
      throw new Error('that is not something the map can be asked to do')
    }
    const frame = this.#usable(contents)
    if (frame === null) {
      throw new Error('the map is not on the screen')
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
