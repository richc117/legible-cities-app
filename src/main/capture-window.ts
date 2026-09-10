// The Electron half of the capture: the offscreen window, its session, the
// debugger, and the registry that lets a quit destroy whatever is running.
// The order of the steps lives in capture.ts, behind `CapturePage`; this file
// is only the wiring, which is why it is thin and why the end-to-end test is
// what exercises it. A second build entry (electron.vite.config.ts), so the
// test harness can load it without the rest of the app.

import { isAbsolute } from 'node:path'
import { BrowserWindow, session } from 'electron'
import type { CaptureJob } from '../shared/capture'
import {
  CAPTURE_PARTITION,
  CaptureError,
  captureWindowOptions,
  printable,
  runCapture,
  validateCaptureJob,
  type CaptureOptions,
  type CapturePage,
  type CaptureResult,
} from './capture'
import { log } from './log'
import { registerAppProtocol } from './protocol'
import { registerAppScheme } from './scheme'

export { registerAppScheme }
export { registerAppProtocol } from './protocol'
export { CaptureError } from './capture'
export type { CaptureOptions, CaptureResult } from './capture'
export type { Beat, CaptureJob } from '../shared/capture'

let configured = false

/**
 * The capture session, once per process: the app's origin served from it,
 * project pages only, and every permission refused. Nothing in it persists.
 */
export function configureCapture(options: { engineHome: string }): void {
  if (configured) return
  configured = true
  const ses = session.fromPartition(CAPTURE_PARTITION)
  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    log.warn('capture', `refused a request for ${permission}`)
    callback(false)
  })
  ses.setPermissionCheckHandler(() => false)
  registerAppProtocol({
    session: ses,
    projectsOnly: true,
    engineHome: options.engineHome,
    log: (message) => log.warn('capture', message),
  })
}

class ElectronCapturePage implements CapturePage {
  readonly #window: BrowserWindow
  #goneListener: ((reason: string) => void) | null = null

  constructor(job: CaptureJob) {
    this.#window = new BrowserWindow(captureWindowOptions(job))
    const contents = this.#window.webContents
    // Nothing the page does may open a window or leave the page it was
    // given. `will-navigate` is not fired for the load below, only for what
    // the page itself starts.
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event) => event.preventDefault())
    contents.on('render-process-gone', (_event, details) => {
      this.#goneListener?.(details.reason)
    })
    contents.on('console-message', (details) => {
      const { level, message } = details as unknown as { level?: unknown; message?: unknown }
      if (level === 'error' || level === 3)
        log.warn('capture', `page: ${printable(String(message), 200)}`)
    })
  }

  /**
   * Load the page, and resolve on the page's own events for that URL rather
   * than on Electron's load promise: a navigation the page itself tries and
   * is refused rejects the promise with ERR_ABORTED while the page stays
   * loaded. A 404 from the origin's handler commits as a navigation, so the
   * status is read too; otherwise a wrong id would cost the whole page
   * timeout before a misleading sentence.
   */
  navigate(url: string): Promise<void> {
    const contents = this.#window.webContents
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: CaptureError) => {
        if (settled) return
        settled = true
        contents.removeListener('did-navigate', onNavigate)
        contents.removeListener('did-finish-load', onLoaded)
        contents.removeListener('dom-ready', onLoaded)
        contents.removeListener('did-fail-load', onFailed)
        if (error) reject(error)
        else resolve()
      }
      const onNavigate = (_event: unknown, navigated: string, code: number) => {
        if (navigated === url && code >= 400)
          finish(new CaptureError(`the page was not found (${code})`))
      }
      const onLoaded = () => {
        if (contents.getURL() === url) finish()
      }
      const onFailed = (
        _event: unknown,
        code: number,
        description: string,
        failed: string,
        isMainFrame: boolean,
      ) => {
        if (isMainFrame && failed === url)
          finish(new CaptureError(`the page did not load: ${printable(description, 80)} (${code})`))
      }
      contents.on('did-navigate', onNavigate)
      contents.on('did-finish-load', onLoaded)
      contents.on('dom-ready', onLoaded)
      contents.on('did-fail-load', onFailed)
      contents.loadURL(url).then(
        () => onLoaded(),
        () => {
          // Redundant with the events above; see the note on ERR_ABORTED.
        },
      )
    })
  }

  attach(): void {
    this.#window.webContents.debugger.attach('1.3')
  }

  send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.#window.webContents.debugger.sendCommand(method, params) as Promise<unknown>
  }

  evaluate(code: string): Promise<unknown> {
    return this.#window.webContents.executeJavaScript(code, true) as Promise<unknown>
  }

  onGone(listener: (reason: string) => void): void {
    this.#goneListener = listener
  }

  destroy(): void {
    if (this.#window.isDestroyed()) return
    // A destroy from outside (a quit) ends the capture too, rather than
    // leaving it to wait out a frame timeout on a window that is gone.
    this.#goneListener?.('the window was destroyed')
    const dbg = this.#window.webContents.debugger
    if (dbg.isAttached()) {
      try {
        dbg.detach()
      } catch {
        // Detaching a debugger from a dying page can throw; the window goes anyway.
      }
    }
    this.#window.destroy()
  }
}

const live = new Set<ElectronCapturePage>()

/**
 * Take a job's frames in a window of the job's own. The window is destroyed
 * when the promise settles, whichever way.
 */
export async function capture(job: CaptureJob, options: CaptureOptions): Promise<CaptureResult> {
  if (!configured) throw new CaptureError('the capture session is not configured')
  // Refused before a window exists; the orchestrator checks again.
  const problem = validateCaptureJob(job)
  if (problem !== null) throw new CaptureError(problem)
  if (!isAbsolute(options.frames))
    throw new CaptureError('the frames directory must be an absolute path')
  const page = new ElectronCapturePage(job)
  live.add(page)
  try {
    return await runCapture(page, job, {
      log: (message) => log.info('capture', message),
      ...options,
    })
  } finally {
    live.delete(page)
  }
}

/** Destroy every capture window; a quit calls this before the engine stops. */
export function abortCaptures(): void {
  for (const page of live) page.destroy()
}

/** How many captures are running; the tests read it to prove nothing is left. */
export function liveCaptures(): number {
  return live.size
}
