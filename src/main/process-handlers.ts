// What the main process does with a failure nobody caught (issue 432, R5-04,
// R5-06). Without a handler Node prints an exception to a stream nobody reads
// and, since Electron 44, may leave the engine running; with these the line
// reaches the log and the app leaves through its ordinary quit, which stops
// the engine first. No dialog: a crash that cannot be explained is not made
// into a window that asks to be dismissed.
//
// No Electron import, so the rules are tested without a session; index.ts
// hands in the process, the quit and the window.

import { log } from './log'

/** The slice of `process` registered on, so a test hands in an emitter. */
export interface ProcessLike {
  on(event: 'uncaughtException', listener: (error: unknown) => void): unknown
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown
}

/** Printable ASCII only, cut to a length (the same rule as capture.ts's, kept local so this module imports nothing of Electron's). */
function printable(text: string, max: number): string {
  return text
    .replace(/[^ -~]/g, '')
    .slice(0, max)
    .trim()
}

/**
 * The failure as a line: its name and, for a system error, its code, and
 * nothing of the message, which names a path. An error with no code has its
 * message cut to 200 characters. Never the stack. Never throws: a thrown
 * object whose getters throw is "an error that could not be read".
 */
function describe(error: unknown): string {
  try {
    if (error instanceof Error) {
      const code = (error as NodeJS.ErrnoException).code
      if (typeof code === 'string') return `${printable(error.name, 80)} (${printable(code, 40)})`
      return `${printable(error.name, 80)}: ${printable(String(error.message), 200)}`
    }
    return typeof error === 'string' ? printable(error, 200) : 'a value that is not an error'
  } catch {
    return 'an error that could not be read'
  }
}

/** A line that cannot throw into a process handler. */
function logQuietly(message: string): void {
  try {
    log.error('process', message)
  } catch {
    // Nowhere left to say it.
  }
}

/**
 * Log an uncaught exception and quit once; log a rejection and carry on.
 * `quit` is the app's own (before-quit stops the engine); it is asked once,
 * so an exception thrown during the quit is logged and does not ask again.
 */
export function registerProcessHandlers(proc: ProcessLike, quit: () => void): void {
  let quitting = false
  proc.on('uncaughtException', (error) => {
    // Logged first and quietly: a log that throws must not keep the app
    // from leaving, and a second exception during the quit only adds a line.
    logQuietly(`uncaught exception: ${describe(error)}`)
    if (quitting) return
    quitting = true
    try {
      quit()
    } catch (failure) {
      logQuietly(`quit after an exception failed: ${describe(failure)}`)
    }
  })
  proc.on('unhandledRejection', (reason) => {
    logQuietly(`unhandled rejection: ${describe(reason)}`)
  })
}

/** The slice of a window's contents the crash rule listens to. */
export interface CrashableContents {
  on(
    event: 'render-process-gone',
    listener: (event: unknown, details: { reason: string }) => void,
  ): unknown
  reload(): void
}

/** A crash this soon after a reload is the reload failing, not a new one. */
export const RELOAD_GRACE_MS = 30_000

/** What the person chose in the platform's message box. */
export type CrashChoice = 'reload' | 'quit'

/**
 * When the interface's renderer dies: log the reason; unless it left cleanly,
 * ask once per crash through `ask` (the platform's message box) whether to
 * reload or quit. A renderer that dies again within RELOAD_GRACE_MS of a reload
 * offers only the quit, so the box cannot loop. `ask(canReload)` resolves with the choice.
 */
export function watchRendererCrash(
  contents: CrashableContents,
  ask: (canReload: boolean) => Promise<CrashChoice>,
  quit: () => void,
  now: () => number = Date.now,
): void {
  let reloadedAt = -Infinity
  let asking = false
  contents.on('render-process-gone', (_event, details) => {
    log.error('window', `the interface's renderer went away (${details.reason})`)
    if (details.reason === 'clean-exit' || asking) return
    asking = true
    const canReload = now() - reloadedAt > RELOAD_GRACE_MS
    void ask(canReload)
      .then((choice) => {
        if (choice === 'reload' && canReload) {
          reloadedAt = now()
          contents.reload()
        } else quit()
      })
      .catch((error: unknown) => {
        logQuietly(`the crash box failed: ${describe(error)}`)
        quit()
      })
      .finally(() => {
        asking = false
      })
  })
}

/** The slice of `dialog` the crash box uses. */
export type ShowMessageBox = (options: {
  type: 'error'
  message: string
  detail: string
  buttons: string[]
  defaultId: number
  cancelId: number
}) => Promise<{ response: number }>

/**
 * The crash box, for `watchRendererCrash`. Deliberately unparented: the window
 * it would hang from is the one whose page just died, and a parented box held
 * a quit on Linux (.claude/rules/main.md). The signature takes no window, so
 * a parent cannot be passed by mistake.
 */
export function crashBox(
  show: ShowMessageBox,
  product: string,
): (canReload: boolean) => Promise<CrashChoice> {
  return async (canReload) => {
    const { response } = await show({
      type: 'error',
      message: `${product}'s window stopped working.`,
      detail: canReload
        ? 'Reload the window to carry on, or quit. Your projects are saved as you make each choice.'
        : 'It stopped again straight after reloading. Quit and open the app again.',
      buttons: canReload ? ['Reload', 'Quit'] : ['Quit'],
      defaultId: 0,
      cancelId: canReload ? 1 : 0,
    })
    return canReload && response === 0 ? 'reload' : 'quit'
  }
}
