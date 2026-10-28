// A claim that something did not happen, held over a window (issue 596).
//
// The suite's rule is that a wait is a deadline: the test polls a fact until
// it is true or the deadline passes, and a fixed sleep followed by an
// assertion is neither, since on a loaded runner the thing being waited for
// can land after the sleep and the test is green for the wrong reason.
//
// That rule has a fact to poll when what is claimed is that something
// happened. It has none when the claim is that something did not, and the app
// writes nothing at the moment it decides against it: "the page was not
// redrawn" is decided in the renderer (`redrawOnOpen`), and the "no" crosses
// no process boundary a test can see. So this is not a fact. It is the
// weaker thing that is left, and it is named so the callers are read for
// what they are:
//
// - The caller first polls the last fact that is observable before the
//   decision, so the window starts as late as it can.
// - The check is then made again and again over the window, and the first
//   time it fails the test fails, so a redraw that lands early is not waited
//   out and a state that comes and goes is not missed by a single read at
//   the end.
//
// What it cannot do is show that the decision has been made by the end of the
// window. Where the app gives a signal (issue 596 names the one it would
// take), the caller polls that instead and this goes.

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
