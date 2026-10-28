// A promise or a deadline, whichever comes first: the one race the main
// process runs (issue 598). Until then it was written four times - the
// folder checks' `inTime` in `settings.ts`, the logs' `within`, the
// supervisor's `waitFor` and two hand-rolled races in the diagnostics copy -
// each right and each free to drift. Every one is now a call to this, and
// each site keeps its own deadline and its own answer to a lapse: the folder
// checks refuse with a sentence, the logs carry on, the supervisor moves to
// the next way of ending the engine, the copy refuses or says the engine
// gave no answer.

/** What `inTime` answers when the deadline came first. */
export const LAPSED: unique symbol = Symbol('the deadline came first')

/**
 * `check`'s answer, or `LAPSED` once `ms` has passed. The timer is cleared
 * whichever way it ends, so nothing is left to hold a process open, and a
 * check that fails before the deadline fails here, as it failed.
 *
 * **A check that lapsed is abandoned, not stopped**: nothing can take back
 * a question already put to the disk or a child process. So whatever acts
 * on its answer - a removal, a write - comes after this and only on an
 * answer that came in time. A check that fails after it was abandoned fails
 * unheard.
 */
export async function inTime<T>(check: Promise<T>, ms: number): Promise<T | typeof LAPSED> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<typeof LAPSED>((resolve) => {
    timer = setTimeout(() => resolve(LAPSED), ms)
  })
  try {
    return await Promise.race([check, deadline])
  } finally {
    clearTimeout(timer)
  }
}
