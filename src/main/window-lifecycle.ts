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

export interface ShutdownDeps {
  /** What ends at once on a quit, each named for the log: an export, the captures, the first-run check. */
  aborts: { name: string; run: () => void }[]
  /** The engine's stop, or null when there is no engine. */
  stop: (() => Promise<void>) | null
  /** The gate's `finished`. */
  finished: () => void
  /** The app's own quit, asked again once the stop has ended. */
  quit: () => void
  error: (message: string) => void
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * A line that cannot throw: the message is built inside the guard (a thrown
 * object whose string form throws) and so is the logger. Nothing here may
 * stop the quit, which the gate is waiting on.
 */
function sayQuietly(error: (message: string) => void, message: () => string): void {
  try {
    error(message())
  } catch {
    // Nowhere left to say it.
  }
}

/**
 * The first pass of a quit, after the gate has cancelled it: end what runs,
 * stop the engine, then let go. The gate keeps cancelling until `finished`,
 * so nothing here may throw past the stop: each abort has its own try, a
 * failing one is logged and the others still run, and the stop is always
 * reached, however it ends, because a throw that skipped it would leave a
 * windowless process that no quit could end.
 */
export function shutDown(deps: ShutdownDeps): void {
  for (const abort of deps.aborts) {
    try {
      abort.run()
    } catch (error) {
      sayQuietly(deps.error, () => `${abort.name} did not end on quit: ${reason(error)}`)
    }
  }
  if (deps.stop === null) return
  let stopping: Promise<void>
  try {
    stopping = deps.stop()
  } catch (error) {
    stopping = Promise.reject(error)
  }
  void stopping
    .catch((error: unknown) => sayQuietly(deps.error, () => `stop failed: ${reason(error)}`))
    .finally(() => {
      deps.finished()
      deps.quit()
    })
}
