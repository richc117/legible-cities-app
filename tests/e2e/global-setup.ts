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

export default function globalSetup(): void {
  sayIfTheEngineIsNotNamed()
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
