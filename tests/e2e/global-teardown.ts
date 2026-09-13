// After the last worker: first, whether any record or settings write was
// retried or failed during the run, printed from the logs before they go
// (issue 93); then the suite's own log folder goes. It is removed only when
// the setup recorded making exactly this folder, and it still sits under the
// temporary folder with the setup's prefix, so a LEGIBLE_LOGS set by hand is
// never touched whatever it is called.

import { lstatSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { logFiles, logFolders, logLines, RETRY_LINES } from '../support/store-lines'
import { LOGS_PREFIX } from './global-setup'

/** The prefix every test's temporary folder is made with. */
const TEST_PREFIX = 'legible-cities-'

/**
 * The log folders this run wrote: the suite's shared one, and the `logs`
 * folder of each temporary profile made since the run began, which is where
 * a launch with LEGIBLE_USER_DATA keeps its logs instead.
 */
function runLogFolders(shared: string | undefined): string[] {
  const folders = shared !== undefined && shared !== '' ? [shared] : []
  const started = Number(process.env.LEGIBLE_E2E_STARTED)
  if (!Number.isFinite(started)) return folders
  let names: string[]
  try {
    names = readdirSync(tmpdir())
  } catch {
    return folders
  }
  for (const name of names) {
    if (!name.startsWith(TEST_PREFIX) || name.startsWith(LOGS_PREFIX)) continue
    const path = join(tmpdir(), name)
    try {
      const info = lstatSync(path)
      // A second's slack for a filesystem that keeps coarse times.
      if (!info.isDirectory() || info.mtimeMs < started - 1000) continue
    } catch {
      continue
    }
    folders.push(...logFolders(path))
  }
  return folders
}

/** Say whether a write was retried or failed, so a run that passed still shows it. */
function reportRetries(shared: string | undefined): void {
  const folders = runLogFolders(shared)
  const files = folders.reduce((sum, folder) => sum + logFiles(folder).length, 0)
  const lines = folders.flatMap((folder) => logLines(folder, RETRY_LINES))
  if (lines.length === 0) {
    console.log(
      `[issue 93] ${files} log files searched; no record or settings write was retried or failed.`,
    )
    return
  }
  console.log(`[issue 93] ${files} log files searched; writes retried or failed:`)
  for (const line of lines) console.log(`  ${line}`)
}

export default function globalTeardown(): void {
  const folder = process.env.LEGIBLE_LOGS
  try {
    reportRetries(folder)
  } catch (error) {
    console.log(`[issue 93] the logs could not be searched: ${String(error)}`)
  }
  const made = process.env.LEGIBLE_E2E_LOGS_MADE
  if (folder === undefined || folder === '' || made !== folder) return
  const ours =
    resolve(dirname(folder)) === resolve(tmpdir()) && basename(folder).startsWith(LOGS_PREFIX)
  if (ours) rmSync(folder, { recursive: true, force: true })
}
