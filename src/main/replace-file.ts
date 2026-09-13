// Replacing a file by renaming a finished copy over it, tried again while
// the platform says the file is held (issue 93).
//
// A project record and the settings file are written to a fresh temporary
// name and renamed over the real one, so a crash mid-write leaves the
// previous file whole. On Windows that rename fails while any other handle
// has the destination open: libuv's MoveFileExW with
// MOVEFILE_REPLACE_EXISTING answers EPERM when the handle allows deletion
// and EBUSY when it does not, and EACCES is the same refusal by another
// route. The holders are brief - the virus scanner or the search indexer
// opening the file just renamed into place, or a reader in this process (a
// preview's `get`, the Library's `list`) that opened it a moment before -
// so back-to-back writes of one file meet them and a person's choice was
// lost to one. A refused rename is therefore tried again a few times with
// growing waits. Nothing else is: another code will not change by waiting,
// and the temporary file is the writer's own, so a failure to write it is
// not a hold.

import { rename as renameFile } from 'node:fs/promises'

/**
 * The waits between attempts, in milliseconds: eight attempts in all, over
 * about 1.3 seconds. Long enough to outlast a scanner's look at a small
 * file, short enough that a write that will never land says so promptly.
 */
export const RENAME_RETRY_DELAYS_MS: readonly number[] = [10, 20, 40, 80, 160, 320, 640]

/** The codes a held destination produces; no other failure is tried again. */
export const RENAME_RETRY_CODES: ReadonlySet<string> = new Set(['EPERM', 'EACCES', 'EBUSY'])

export type Rename = (from: string, to: string) => Promise<void>
export type Wait = (ms: number) => Promise<void>

/** The seams a test replaces: the rename itself, and the wait between attempts. */
export interface ReplaceOptions {
  rename?: Rename
  wait?: Wait
}

/** The code of a filesystem failure, never its message, which names the path. */
export function codeOf(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return typeof code === 'string' ? code : 'unknown error'
}

/** A rename that did not land, with the last failure's code and how many attempts were made. */
export class RenameRefused extends Error {
  readonly code: string

  constructor(
    readonly attempts: number,
    cause: unknown,
  ) {
    super('the file could not be replaced', { cause })
    this.code = codeOf(cause)
  }
}

/** How a rename landed: the attempts it took, and the codes of those refused on the way. */
export interface Renamed {
  attempts: number
  refused: string[]
}

const sleep: Wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Rename `from` over `to`, trying again after each wait in
 * RENAME_RETRY_DELAYS_MS while the refusal is one of RENAME_RETRY_CODES.
 * Throws RenameRefused on any other code at once, and on a held file once
 * the waits are spent; cleaning up `from` is the caller's.
 */
export async function renameOver(
  from: string,
  to: string,
  options: ReplaceOptions = {},
): Promise<Renamed> {
  const rename = options.rename ?? renameFile
  const wait = options.wait ?? sleep
  const refused: string[] = []
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to)
      return { attempts: attempt, refused }
    } catch (error) {
      const code = codeOf(error)
      if (!RENAME_RETRY_CODES.has(code) || attempt > RENAME_RETRY_DELAYS_MS.length)
        throw new RenameRefused(attempt, error)
      refused.push(code)
      await wait(RENAME_RETRY_DELAYS_MS[attempt - 1])
    }
  }
}

/** The words a log line gives a rename that landed only after a refusal, or null when it did not need them. */
export function retriedWords({ attempts, refused }: Renamed): string | null {
  if (refused.length === 0) return null
  return `saved after ${attempts} attempts (${[...new Set(refused)].join(', ')})`
}

/** The words a log line gives a failed write: the code, and the attempts when it was the rename. */
export function failedWords(error: unknown): string {
  if (error instanceof RenameRefused)
    return `write failed (${error.code}, ${error.attempts} ${error.attempts === 1 ? 'attempt' : 'attempts'})`
  return `write failed (${codeOf(error)})`
}
