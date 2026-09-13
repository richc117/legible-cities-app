// Before any worker starts: a log folder of the suite's own. Most launches
// keep the default profile, and without this every one of them would write
// - and in a long run rotate - the log a person has in their own log
// folder. Every launch spreads `process.env`, and the workers inherit it
// from here, so setting it once reaches them all; a launch that moves its
// profile with LEGIBLE_USER_DATA keeps its logs beside that instead
// (src/main/index.ts, specs/023-logs-and-diagnostics).

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The prefix the folder is made with; the teardown checks it as well. */
export const LOGS_PREFIX = 'legible-cities-e2e-logs-'

export default function globalSetup(): void {
  // One named by hand is respected, and the teardown leaves it alone.
  if (process.env.LEGIBLE_LOGS !== undefined && process.env.LEGIBLE_LOGS !== '') return
  const made = mkdtempSync(join(tmpdir(), LOGS_PREFIX))
  process.env.LEGIBLE_LOGS = made
  // What this setup made, so the teardown removes that and nothing else.
  process.env.LEGIBLE_E2E_LOGS_MADE = made
}
