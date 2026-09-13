// After the last worker: the suite's own log folder goes. Removed only when
// the setup recorded making exactly this folder, and it still sits under the
// temporary folder with the setup's prefix, so a LEGIBLE_LOGS set by hand is
// never touched whatever it is called.

import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'
import { LOGS_PREFIX } from './global-setup'

export default function globalTeardown(): void {
  const folder = process.env.LEGIBLE_LOGS
  const made = process.env.LEGIBLE_E2E_LOGS_MADE
  if (folder === undefined || folder === '' || made !== folder) return
  const ours =
    resolve(dirname(folder)) === resolve(tmpdir()) && basename(folder).startsWith(LOGS_PREFIX)
  if (ours) rmSync(folder, { recursive: true, force: true })
}
