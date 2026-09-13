// "Copy log" on a job, main side (A1-03, specs/024-jobs, FR-007).
//
// The page composes a job's text - it holds the job - and this side decides
// what reaches the clipboard: bounded text only, every web address with its
// secrets taken out, and the home folder written as `~` in every form the
// diagnostics copy knows, looked up through the same service with the same
// deadline. A home that survives the replacement refuses the copy, as the
// diagnostics copy refuses. The page never writes the clipboard itself.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from '../shared/api'
import { JOB_LOG_BYTES } from '../shared/jobs'
import { containsHome, shortenHome } from './diagnostics-text'
import { redactUrls } from './redact'

export interface JobsDeps {
  /** Every form of the home folder, from the settings service; rejects when the home does not answer in time. */
  homes: () => Promise<string[]>
  platform: string
  /** The system clipboard, the same writer the other copies use. */
  writeText: (text: string) => void
  log: (message: string) => void
}

/** Whether what the page sent is a job's text the bridge accepts. */
export function isJobLog(value: unknown): value is string {
  return (
    typeof value === 'string' && value !== '' && Buffer.byteLength(value, 'utf8') <= JOB_LOG_BYTES
  )
}

/**
 * The text as it may leave for the clipboard: addresses redacted first,
 * then the home folder shortened, then checked for a home that survived.
 */
export function jobLogText(text: string, homes: readonly string[], platform: string): string {
  const out = shortenHome(redactUrls(text), homes, platform)
  if (containsHome(out, homes, platform)) {
    throw new Error('the log still named your home folder, so nothing was copied')
  }
  return out
}

/** Copy one job's log: checked, redacted, then written. */
export async function copyJobLog(raw: unknown, deps: JobsDeps): Promise<void> {
  if (!isJobLog(raw)) throw new Error('the log to copy is not a short piece of text')
  const text = jobLogText(raw, await deps.homes(), deps.platform)
  deps.writeText(text)
  deps.log(`copied a job's log (${Buffer.byteLength(text, 'utf8')} bytes) to the clipboard`)
}

/** The one handler, for the interface's own top frame only. */
export function registerJobsHandlers(
  ipcMain: IpcMain,
  deps: JobsDeps,
  isTopFrame: (event: IpcMainInvokeEvent) => boolean,
): void {
  ipcMain.handle(CHANNELS.jobsCopyLog, async (event, raw: unknown) => {
    if (!isTopFrame(event)) throw new Error('forbidden')
    await copyJobLog(raw, deps)
  })
}
