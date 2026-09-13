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

export default function globalSetup(): void {
  // One named by hand is respected; the teardown leaves it too.
  if (process.env.LEGIBLE_LOGS !== undefined && process.env.LEGIBLE_LOGS !== '') return
  process.env.LEGIBLE_LOGS = mkdtempSync(join(tmpdir(), 'legible-cities-e2e-logs-'))
}
