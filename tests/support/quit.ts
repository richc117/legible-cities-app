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
// A second quit while the question is open is an answer, and quits - once
// the question has been on the screen for a second: sooner, it is held as
// the repeat of a held shortcut would be (`QUESTION_MIN_AGE_MS`). So
// `quitApp` asks once and learns whether the app held the quit for its
// question. Where it did not, the app is quitting exactly as it did at
// `app.close()`'s one quit, and is waited for with nothing more asked of it:
// a second quit landing while the app closes its log files would cut that
// short, and the tests that read a log's last lines would lose them. Where
// it did, `quitApp` waits until the question is old enough to be answered,
// and `app.close()` then asks again, which is the answer, and waits.
//
// A test that is about the question does not use this for the quit it is
// about: it asks with `askToQuit` and answers in the page.

import type { ElectronApplication, Locator } from '@playwright/test'
import { QUESTION_MIN_AGE_MS } from '../../src/main/window-lifecycle'
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

/**
 * How long after a test has seen the question a second quit is surely its
 * answer: the question's minimum age, and a margin for a timer that fires a
 * moment early. Measured from when the test learned of the question, which
 * is never before the app asked it.
 */
const ANSWERABLE_AFTER_MS = QUESTION_MIN_AGE_MS + 250

/**
 * Wait until a question first seen at `seen` (a `Date.now()` reading) is old
 * enough for a second quit, or a second close, to be its answer and not be
 * held. One wait to a point in time, not a count of anything.
 */
export async function untilAnswerable(seen: number): Promise<void> {
  const wait = seen + ANSWERABLE_AFTER_MS - Date.now()
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
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

/** Whether a page of the app is showing the question: an open dialog whose words ask about a run. */
async function questionOnScreen(app: ElectronApplication): Promise<boolean> {
  for (const page of app.windows()) {
    const open = await page
      .locator('dialog[open]')
      .filter({ hasText: /(?:Quit|Close) while / })
      .count()
      .catch(() => 0)
    if (open > 0) return true
  }
  return false
}

/**
 * Quit the app whatever it is running, and wait for it to go: the close for
 * a test's `finally`. One quit where nothing is running, as `app.close()`
 * always made; a second, the answer, only where the first was held. Rejects
 * as `app.close()` does.
 *
 * The first quit ends one of three ways. The app asks its question: the
 * second quit waits until the question is old enough to be answered. The
 * process goes: nothing more is asked of it. Or neither has happened by the
 * time a question would be old enough: the app is stopping its engine
 * slowly, and is waited for - or it held the quit without a word, because a
 * test left a question on the screen moments before, and that question is by
 * now old enough for the second quit to answer.
 */
export async function quitApp(app: ElectronApplication): Promise<void> {
  const child = app.process()
  const gone = new Promise<void>((resolve) => {
    if (hasExited(child)) resolve()
    else child.once('exit', () => resolve())
  })
  let seen = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const first = await Promise.race([
    quitAndSeeIfHeld(app).then(
      () => {
        seen = Date.now()
        return 'asked' as const
      },
      // The call ends with the process, or finds it already gone.
      () => 'going' as const,
    ),
    gone.then(() => 'going' as const),
    new Promise<'waiting'>((resolve) => {
      timer = setTimeout(() => resolve('waiting'), ANSWERABLE_AFTER_MS)
    }),
  ])
  clearTimeout(timer)
  if (first === 'asked') await untilAnswerable(seen)
  else if (first === 'going' || !(await questionOnScreen(app))) await gone
  // Held: the second quit, old enough to be the answer, and the wait for the
  // process. Otherwise the process has gone, and this is Playwright's own
  // leave-taking of it.
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
