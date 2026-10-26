// What the app does when its own window goes and when the Dock icon is
// pressed (issue 537). Both rules look at the app's window and nothing else:
// an export's offscreen capture window is a `BrowserWindow` too, and counting
// every window made the app's own absence invisible while a capture ran -
// on macOS no window came back from the Dock, and on Windows and Linux the
// app sat windowless until the capture ended and then quit, cancelling the
// export at its encode with nothing said.
//
// No Electron import, so the rules are tested without a session; index.ts
// hands in the platform, the quit and the opener.

/** What the closing handler needs: the platform's name and the app's own quit. */
export interface AppWindowClosedDeps {
  platform: string
  quit: () => void
}

/**
 * The handler for the app's own window closing. Windows and Linux quit, as
 * they do when nothing else is open, so a running export is cancelled by the
 * quit at once and visibly; macOS stays running with no window, as its apps
 * do, and a running export goes on and finishes.
 */
export function onAppWindowClosed(deps: AppWindowClosedDeps): () => void {
  return () => {
    if (deps.platform !== 'darwin') deps.quit()
  }
}

/** What the activate handler needs: the app's window, if it has one, and the way to make one. */
export interface ActivateDeps {
  /** The app's own window, or null once it has closed. Never a capture window. */
  appWindow: () => unknown
  open: () => void
}

/** The handler for the Dock icon: a window when the app has none of its own. */
export function onActivate(deps: ActivateDeps): () => void {
  return () => {
    if (deps.appWindow() === null) deps.open()
  }
}

/** The slice of Electron's event the gate needs. */
export interface Cancellable {
  preventDefault(): void
}

/** What a `before-quit` was: the pass that starts the shutdown, or one that came after it. */
export type QuitPass = 'first' | 'later'

export interface QuitGate {
  /** Whether a quit is under way; a second `app.quit()` is then pointless. */
  readonly quitting: boolean
  /**
   * Every `before-quit` goes through here. The first pass is cancelled when
   * the engine is to be stopped, and the caller starts the stop. Every pass
   * after it is cancelled too until `finished()`: an `app.quit()` made while
   * the stop runs - the window's close and then `window-all-closed` on
   * Windows and Linux, an uncaught exception, the crash box's Quit - must not
   * let Electron go with the engine half-stopped.
   */
  beforeQuit(event: Cancellable, engineRunning: boolean): QuitPass
  /** The stop has ended (however it ended): the next quit is let through. */
  finished(): void
}

export function quitGate(): QuitGate {
  let quitting = false
  let stopped = false
  return {
    get quitting() {
      return quitting
    },
    beforeQuit(event, engineRunning) {
      if (quitting) {
        if (!stopped) event.preventDefault()
        return 'later'
      }
      quitting = true
      if (engineRunning) event.preventDefault()
      else stopped = true
      return 'first'
    },
    finished() {
      stopped = true
    },
  }
}
