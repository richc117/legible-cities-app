// After the last worker: first, whether any record or settings write was
// retried or failed during the run, printed from the logs before they go
// (issue 93); then the run's own profile goes, its logs with it. It is
// removed only when the setup recorded making exactly this folder, and it
// still sits under the temporary folder with the setup's prefix, so a
// LEGIBLE_USER_DATA set by hand is never touched whatever it is called.

import { copyFileSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { logFiles, logFolders, logLines, receivedFiles, RETRY_LINES } from '../support/store-lines'
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
  for (const path of runTestFolders()) folders.push(...logFolders(path))
  return folders
}

/** The temporary folders the specs made since the run began (not the run's own profile). */
function runTestFolders(): string[] {
  const found: string[] = []
  const started = Number(process.env.LEGIBLE_E2E_STARTED)
  if (!Number.isFinite(started)) return found
  let names: string[]
  try {
    names = readdirSync(tmpdir())
  } catch {
    return found
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
    found.push(path)
  }
  return found
}

/** Where `LEGIBLE_KEEP_LOGS` puts what it keeps: under `test-results/`, which `ci.yml` and the loop and determinism workflows upload when a run fails. */
const KEPT = resolve(__dirname, '../../test-results/logs')

/**
 * With `LEGIBLE_KEEP_LOGS` set, or on CI (issue 671), copy the run's own log files into
 * `test-results/logs/` before the suite's folder is removed (issue 529: the
 * handshake's time per launch is in `engine.log`, and without this a CI run
 * loses it with the runner). Only this run's folders are read (the suite's
 * own, and the temporary profiles made since it began), and only plain
 * `.log` files, and each stand-in engine `fake-engine.received`. The logs are
 * what the app wrote through its redacting sink, URLs' user information,
 * query values and fragments removed (`src/main/redact.ts`); the request
 * records are raw JSON-RPC and never pass through it. Any non-empty `CI` keeps
 * them: `ci.yml`'s `e2e` and `e2e-quarantine` and `determinism.yml` (the real
 * pinned engine), and `e2e-loop.yml` sets `LEGIBLE_KEEP_LOGS`. None has a
 * secret in the step, so a public artefact holds committed fixtures, the
 * runner's temporary paths and the engines' own words, nothing of a person's.
 * A local run sets nothing and keeps nothing.
 */
function keepLogs(shared: string | undefined, ours: boolean): void {
  if ((process.env.LEGIBLE_KEEP_LOGS ?? '') === '' && (process.env.CI ?? '') === '') return
  try {
    const folders = runLogFolders(undefined)
    if (ours && shared !== undefined) folders.unshift(shared)
    let n = 0
    let failed = 0
    // Each copy alone: one file held open or rotated away must not lose the rest.
    const copy = (from: string, to: string): void => {
      try {
        mkdirSync(dirname(to), { recursive: true })
        copyFileSync(from, to)
      } catch {
        failed++
      }
    }
    for (const folder of folders) {
      const to = join(KEPT, `${folder === shared ? 'suite' : 'profile'}-${++n}`)
      for (const file of logFiles(folder)) copy(file, join(to, basename(file)))
    }
    // The stand-in engine's request record, beside the logs: the specs make
    // their folders in many ways and mostly leave them to the runner, so the
    // run's end is the one place that reaches them all (issue 671). The
    // upload step keeps test-results/ only when the run failed.
    let r = 0
    for (const folder of runTestFolders()) {
      for (const file of receivedFiles(folder)) {
        copy(file, join(KEPT, `received-${++r}`, `${basename(folder)}.fake-engine.received`))
      }
    }
    console.log(
      `[issue 529] ${n} log folders and ${r} engine request records kept in test-results/logs/, ${failed} could not be copied.`,
    )
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
