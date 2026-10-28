// Wait for a fact, not for a number of turns.
//
// A count of ticks is deterministic only while the chain it waits on is
// microtasks alone; the first timer or disk read that enters the chain turns
// it into a race, and the failure it then makes is a different test each
// run, saying the thing never happened when what never happened was the
// waiting. So the wait is a deadline in real time, polled on a timer, and it
// says what never arrived. `tests/unit/export.test.ts` has the history.
//
// Its deadline sits well inside Vitest's own (30 s, `vitest.config.ts`), so a
// wait that never comes true fails with this sentence, not a bare timeout.
// Real timers only: under `vi.useFakeTimers()` the clock it polls stands still.

/** Poll `ok` on the clock until it holds, or throw saying `what` never happened within `ms`. */
export async function until(what: string, ok: () => boolean, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms
  while (!ok() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 1))
  if (!ok()) throw new Error(`${what} never happened`)
}
