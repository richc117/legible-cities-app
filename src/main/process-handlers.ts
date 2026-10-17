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

/** The kind of the failure and its message, for a line; never the stack, which names paths. */
function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return typeof error === 'string' ? error : 'a value that is not an error'
}

/**
 * Log an uncaught exception and quit once; log a rejection and carry on.
 * `quit` is the app's own (before-quit stops the engine); it is asked once,
 * so an exception thrown during the quit is logged and does not ask again.
 */
export function registerProcessHandlers(proc: ProcessLike, quit: () => void): void {
  let quitting = false
  proc.on('uncaughtException', (error) => {
    log.error('process', `uncaught exception: ${describe(error)}`)
    if (quitting) return
    quitting = true
    try {
      quit()
    } catch (failure) {
      log.error('process', `quit after an exception failed: ${describe(failure)}`)
    }
  })
  proc.on('unhandledRejection', (reason) => {
    log.error('process', `unhandled rejection: ${describe(reason)}`)
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
        log.error('window', `the crash box failed: ${describe(error)}`)
        quit()
      })
      .finally(() => {
        asking = false
      })
  })
}
