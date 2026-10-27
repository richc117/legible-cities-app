// After the last worker: first, whether any record or settings write was
// retried or failed during the run, printed from the logs before they go
// (issue 93); then the run's own profile goes, its logs with it. It is
// removed only when the setup recorded making exactly this folder, and it
// still sits under the temporary folder with the setup's prefix, so a
// LEGIBLE_USER_DATA set by hand is never touched whatever it is called.

import { copyFileSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { logFiles, logFolders, logLines, RETRY_LINES } from '../support/store-lines'
import { RUN_PROFILE_PREFIX } from './global-setup'

/** The prefix every test's temporary folder is made with. */
const TEST_PREFIX = 'legible-cities-'

/**
 * The log folders this run wrote: the suite's shared one, in the run's own
 * profile, and the `logs` folder of each temporary profile a spec made
 * since the run began, which is where a launch with a profile of its own
 * keeps its logs instead.
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
    if (!name.startsWith(TEST_PREFIX) || name.startsWith(RUN_PROFILE_PREFIX)) continue
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

/** Where `LEGIBLE_KEEP_LOGS` puts what it keeps: under `test-results/`, which a loop run uploads. */
const KEPT = resolve(__dirname, '../../test-results/logs')

/**
 * With `LEGIBLE_KEEP_LOGS` set, copy the run's own log files into
 * `test-results/logs/` before the suite's folder is removed (issue 529: the
 * handshake's time per launch is in `engine.log`, and without this a CI run
 * loses it with the runner). Only this run's folders are read (the suite's
 * own, and the temporary profiles made since it began), and only plain
 * `.log` files. They are what the app wrote through its redacting sink, URLs'
 * user information, query values and fragments removed (`src/main/redact.ts`);
 * the one workflow that sets this runs a hosted runner with the stand-in
 * engine and no secret in the step, so a public artefact holds the runner's
 * temporary paths and the stand-in's own words, nothing of a person's.
 * A local run sets nothing and keeps nothing.
 */
function keepLogs(shared: string | undefined, ours: boolean): void {
  if ((process.env.LEGIBLE_KEEP_LOGS ?? '') === '') return
  try {
    const folders = runLogFolders(undefined)
    if (ours && shared !== undefined) folders.unshift(shared)
    let n = 0
    for (const folder of folders) {
      const to = join(KEPT, `${folder === shared ? 'suite' : 'profile'}-${++n}`)
      mkdirSync(to, { recursive: true })
      for (const file of logFiles(folder)) copyFileSync(file, join(to, basename(file)))
    }
    console.log(`[issue 529] ${n} log folders kept in test-results/logs/.`)
  } catch (error) {
    console.log(`[issue 529] the logs could not be kept: ${String(error)}`)
  }
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
  const profile = process.env.LEGIBLE_USER_DATA
  const made = process.env.LEGIBLE_E2E_PROFILE_MADE
  const ours =
    profile !== undefined &&
    profile !== '' &&
    made === profile &&
    resolve(dirname(profile)) === resolve(tmpdir()) &&
    basename(profile).startsWith(RUN_PROFILE_PREFIX)
  keepLogs(folder, ours)
  if (!ours) return
  // A whole Chromium profile: on Windows an app a timed-out close left
  // running can still hold files in it, and a failed removal must not fail
  // a run whose tests have passed.
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch (error) {
    console.log(`The run's profile could not be removed: ${String(error)}`)
  }
}
