// The first-run check's bridge, main side (A6-02, specs/026, FR-007 and
// FR-009): one read, one change notification, and the way to the install
// document.
//
// Nothing here takes anything from the page. The install document's address
// is held on this side and opened in the platform's browser; the page asks
// for it by name and cannot say where to go. Each handler answers the
// interface's own top frame only, as every other handler does.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from '../shared/api'
import type { FirstRunResult } from '../shared/first-run'

/**
 * The install document, on the repository's default branch. It arrives with
 * A6-01 (`docs/install.md`); the address is fixed now and resolves once that
 * lands. Opened only when a person presses "How to install".
 */
export const INSTALL_GUIDE_URL =
  'https://github.com/richc117/legible-cities-app/blob/main/docs/install.md'

export interface FirstRunIpcDeps {
  check: {
    readonly result: FirstRunResult
    onChange(listener: (result: FirstRunResult) => void): () => void
  }
  /** Send to the window, if there is one. */
  send: (channel: string, payload: FirstRunResult) => void
  /** The platform's browser: `shell.openExternal`. */
  openExternal: (url: string) => Promise<void>
  log: (message: string) => void
}

/** Register the handlers and forward every change; returns the unsubscribe. */
export function registerFirstRunHandlers(
  ipcMain: IpcMain,
  deps: FirstRunIpcDeps,
  isTopFrame: (event: IpcMainInvokeEvent) => boolean,
): () => void {
  ipcMain.handle(CHANNELS.firstRunGet, async (event) => {
    if (!isTopFrame(event)) throw new Error('forbidden')
    return deps.check.result
  })
  // Whatever arguments arrive are ignored: the address is this side's.
  ipcMain.handle(CHANNELS.firstRunOpenInstallGuide, async (event) => {
    if (!isTopFrame(event)) throw new Error('forbidden')
    deps.log('opening the install document in the browser')
    await deps.openExternal(INSTALL_GUIDE_URL)
  })
  return deps.check.onChange((result) => deps.send(CHANNELS.firstRunChanged, result))
}
