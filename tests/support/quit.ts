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
// A second quit while the question is open is an answer, and quits. So
// `quitApp` asks once and learns whether the app held the quit for its
// question. Where it did not, the app is quitting exactly as it did at
// `app.close()`'s one quit, and is waited for with nothing more asked of it:
// a second quit landing while the app closes its log files would cut that
// short, and the tests that read a log's last lines would lose them. Where
// it did, `app.close()` asks again, which is the answer, and waits.
//
// A test that is about the question does not use this for the quit it is
// about: it asks with `askToQuit` and answers in the page.

import type { ElectronApplication, Locator } from '@playwright/test'
import { CHANNELS } from '../../src/shared/api'

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

/** Whether the app's process has gone. Read from `app.process()` taken while it ran. */
export const hasExited = (child: ReturnType<ElectronApplication['process']>): boolean =>
  child.exitCode !== null || child.signalCode !== null

/**
 * Ask the app to quit, once, and answer true if it holds the quit for its
 * question. Watched in the main process: the app sends its page the question
 * on one channel, so every window's `send` is watched for it from before the
 * quit is asked for. A quit that is not held ends the process, and this call
 * with it: it then rejects, and never answers false.
 */
function quitAndSeeIfHeld(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(
    ({ app: electron, BrowserWindow }, channel) =>
      new Promise<boolean>((resolve) => {
        const watched = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed())
        const unwatch = (): void => {
          for (const window of watched)
            if (!window.isDestroyed())
              delete (window.webContents as unknown as { send?: unknown }).send
        }
        for (const window of watched) {
          const contents = window.webContents
          const send = contents.send.bind(contents)
          contents.send = (to: string, ...args: unknown[]): void => {
            send(to, ...args)
            // The question itself, not the null that takes one back.
            if (to !== channel || args[0] === null) return
            unwatch()
            resolve(true)
          }
        }
        electron.quit()
      }),
    CHANNELS.quitQuestion,
  )
}

/**
 * Quit the app whatever it is running, and wait for it to go: the close for
 * a test's `finally`. One quit where nothing is running, as `app.close()`
 * always made; a second, the answer, only where the first was held for the
 * question. Rejects as `app.close()` does.
 */
export async function quitApp(app: ElectronApplication): Promise<void> {
  const child = app.process()
  const gone = new Promise<void>((resolve) => {
    if (hasExited(child)) resolve()
    else child.once('exit', () => resolve())
  })
  // The call ends with the process where the quit went ahead, or where the
  // process had already gone: held nothing, either way.
  const held = await quitAndSeeIfHeld(app).catch(() => false)
  if (!held) await gone
  // Held: the second quit, and the wait for the process. Not held: the
  // process has gone, and this is Playwright's own leave-taking of it.
  await app.close()
}

/**
 * Press a button whose press closes the window it is in ("Close anyway").
 * The window can be gone before Playwright has heard the press was taken,
 * and it then reports its page closed; what the press did is for the caller
 * to assert by what follows. Any other failure of the press is thrown.
 */
export async function pressAndLetTheWindowGo(target: Locator): Promise<void> {
  await target.click().catch((error: unknown) => {
    if (!/closed|crashed|destroyed/i.test(String(error))) throw error
  })
}
