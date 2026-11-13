// Quitting the app from a test, since a quit can be held for a question
// (issue 552, specs/039-quit-guard).
//
// Playwright's `app.close()` asks the app to quit once, as its menu does, and
// then waits for the process to go. While an export or a layout is running
// the app no longer quits at that: it holds the quit and asks the person in
// its page, so a test that closes the app with a run still going - by design,
// or in a `finally` after an assertion failed half way through a run - would
// wait out its whole timeout for an answer nobody gives, and report the
// timeout in place of what went wrong.
//
// A second quit while the question is open is an answer, and quits. So the
// way to close the app whatever it is running is to ask twice: `quitApp`
// asks once itself, and `app.close()` asks again and waits. With nothing
// running the first quit goes ahead and the second is one more quit made
// while the engine stops, which the quit gate has always held.
//
// A test that is about the question does not use this for the quit it is
// about: it asks with `askToQuit` and answers in the page.

import type { ElectronApplication } from '@playwright/test'

/**
 * Ask the app to quit, once, as the menu's Quit does. With a run going this
 * opens the question and returns with the app still running; with nothing
 * running the app begins to quit.
 */
export async function askToQuit(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electron }) => {
    electron.quit()
  })
}

/**
 * Quit the app whatever it is running, and wait for it to go: the close for
 * a test's `finally`. Rejects as `app.close()` does.
 */
export async function quitApp(app: ElectronApplication): Promise<void> {
  // Already gone, or going: nothing to ask, and `close` below says so.
  await askToQuit(app).catch(() => undefined)
  await app.close()
}

/** Whether the app's process has gone. Read from `app.process()` taken while it ran. */
export const hasExited = (child: ReturnType<ElectronApplication['process']>): boolean =>
  child.exitCode !== null || child.signalCode !== null
