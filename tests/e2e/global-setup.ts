// Before any worker starts: a log folder of the suite's own. Most launches
// keep the default profile, and without this every one of them would write
// - and in a long run rotate - the log a person has in their own log
// folder. Every launch spreads `process.env`, and the workers inherit it
// from here, so setting it once reaches them all; a launch that moves its
// profile with LEGIBLE_USER_DATA keeps its logs beside that instead
// (src/main/index.ts, specs/023-logs-and-diagnostics).

import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { findPython } from '../support/python'
import { warmEngine } from '../support/warm-engine'

/** The prefix the folder is made with; the teardown checks it as well. */
export const LOGS_PREFIX = 'legible-cities-e2e-logs-'

/**
 * Say so, once, when the engine checkout is not named.
 *
 * The tests that need a real generated page find it through
 * `LEGIBLE_ENGINE_CHECKOUT`, from the environment or from `.env.local`, which
 * is gitignored and so exists only in the checkout a person works in. Run the
 * suite from a worktree without naming it - which `/lanes` step 6 says to do
 * and which is easy to forget - and those tests skip. Each one carries its own
 * reason, but `--reporter=line` prints a count and not the reasons, so a run
 * that silently proves less than the same command in the checkout looks
 * exactly like one that proves more.
 *
 * On 25 September a whole wave of branches was verified that way before
 * anyone noticed. This is the line that would have said so on the first run.
 */
function sayIfTheEngineIsNotNamed(): void {
  const named = process.env.LEGIBLE_ENGINE_CHECKOUT ?? ''
  const envFile = resolve(__dirname, '../../.env.local')
  if (named !== '' || existsSync(envFile)) return
  console.warn(
    '\n  LEGIBLE_ENGINE_CHECKOUT is not set and there is no .env.local here,\n' +
      '  so the tests that need a real generated page will skip. Name a checkout\n' +
      '  of the engine at the pinned tag to run them.\n',
  )
}

/**
 * Start the stand-in engine once and stop it, so the run's first launch is
 * warm like the rest (issue 529). The first test of a run has twice missed
 * the supervisor's 10 s handshake on a cold start - the interpreter, the
 * stand-in compiled for the first time, a scanner reading both - and then
 * waited through a restart its deadline did not cover. Best effort: a
 * warm-up that fails is said and the run goes on, since all it changes is
 * that first test's odds. `engine.log` has the handshake's own time for every
 * launch (`handshake: answered in N ms`), which is how a warm first test is
 * told from a cold one.
 */
async function warmTheEngine(): Promise<void> {
  const python = findPython()
  if (python === null) return // every test that needs the stand-in skips itself
  try {
    const { ms } = await warmEngine(python)
    console.log(`\n  Stand-in engine warmed in ${ms} ms before the first launch.\n`)
  } catch (error) {
    console.warn(
      `\n  The stand-in engine could not be warmed (${(error as Error).message});\n` +
        '  the first launch of the run may be a cold one.\n',
    )
  }
}

export default async function globalSetup(): Promise<void> {
  sayIfTheEngineIsNotNamed()
  await warmTheEngine()
  // When the run began, so the teardown reads only the temporary profiles
  // this run made (issue 93).
  process.env.LEGIBLE_E2E_STARTED = String(Date.now())
  // One named by hand is respected, and the teardown leaves it alone.
  if (process.env.LEGIBLE_LOGS !== undefined && process.env.LEGIBLE_LOGS !== '') return
  const made = mkdtempSync(join(tmpdir(), LOGS_PREFIX))
  process.env.LEGIBLE_LOGS = made
  // What this setup made, so the teardown removes that and nothing else.
  process.env.LEGIBLE_E2E_LOGS_MADE = made
}
