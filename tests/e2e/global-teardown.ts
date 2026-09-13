// After the last worker: the suite's own log folder goes. Only a folder
// global-setup made is removed, recognised by the prefix it was made with
// under the temporary folder, so a LEGIBLE_LOGS set by hand is left alone.

import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'

export default function globalTeardown(): void {
  const folder = process.env.LEGIBLE_LOGS
  if (folder === undefined || folder === '') return
  const made =
    resolve(dirname(folder)) === resolve(tmpdir()) &&
    basename(folder).startsWith('legible-cities-e2e-logs-')
  if (made) rmSync(folder, { recursive: true, force: true })
}
