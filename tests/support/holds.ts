// A claim that something did not happen, held over a window (issue 596).
//
// The suite's rule is that a wait is a deadline: the test polls a fact until
// it is true or the deadline passes, and a fixed sleep followed by an
// assertion is neither, since on a loaded runner the thing being waited for
// can land after the sleep and the test is green for the wrong reason.
//
// That rule has a fact to poll when what is claimed is that something
// happened, and where the app says it has decided, as the screen does for
// the page it opened on (`data-on-open`). It has none for a claim that a
// theme pressed on a page that took it did not also load the page again:
// that decision is made by a rejection that never comes, and nothing marks
// it. So this is not a fact. It is the weaker thing that is left, and it is
// named so its callers are read for what they are:
//
// - The caller first polls the last fact that is observable, so the window
//   starts as late as it can.
// - The check is then made again and again over the window, and the first
//   time it fails the test fails, so a reload that lands early is not waited
//   out and a state that comes and goes is not missed by a single read at
//   the end.
//
// What it cannot do is show that the thing would have shown by the end of
// the window. Where a decision is given a signal, the caller polls that
// instead and drops this.

import { setTimeout as sleep } from 'node:timers/promises'

/**
 * Run `check` now, and again every `every` milliseconds until `window`
 * milliseconds have passed, and once more at the end. A check that throws
 * (an `expect` that fails) ends the wait at once with its error.
 */
export async function stillHolds(
  check: () => void | Promise<void>,
  { window, every = 50 }: { window: number; every?: number },
): Promise<void> {
  const end = Date.now() + window
  for (;;) {
    await check()
    if (Date.now() >= end) return
    await sleep(Math.min(every, Math.max(1, end - Date.now())))
  }
}
