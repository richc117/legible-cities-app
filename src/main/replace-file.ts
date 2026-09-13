// Replacing a file by renaming a finished copy over it, tried again on
// Windows while the platform says the file is held: a defence, added for
// issue 93, whose cause is suspected and not proven.
//
// A project record and the settings file are written to a fresh temporary
// name and renamed over the real one, so a crash mid-write leaves the
// previous file whole. On Windows a rename over a file fails while another
// handle has that file open; libuv reports the refusal as EPERM when access
// is denied and EBUSY on a sharing violation. Holders are brief - a virus
// scanner or the search indexer looking at a file just renamed into place,
// or a reader in this process (a preview's `get`, the Library's `list`)
// that opened it a moment before. Issue 93 saw choices go unsaved on the
// Windows runner only, and a refused rename is the suspected cause; it did
// not reproduce on a quiet runner with or without this retry, so the retry
// is a defence against a failure that is possible, not a fix for one that
// was seen.
//
// Only those codes are tried again, a few times with growing waits, and
// only on Windows. Anywhere else a locked file or a permission error will
// not change by waiting and fails at once. The temporary file is the
// writer's own, so a failure to write it is never tried again either.

import { rename as renameFile } from 'node:fs/promises'

/**
 * The waits between attempts, in milliseconds: eight attempts in all, over
 * about 1.3 seconds. Long enough to outlast a scanner's look at a small
 * file, short enough that a write that will never land says so promptly.
 */
export const RENAME_RETRY_DELAYS_MS: readonly number[] = [10, 20, 40, 80, 160, 320, 640]

/**
 * The codes a held destination is reported with on Windows. EACCES is not
 * known to come from a held file there; it is kept because a retry of an
 * access refusal is bounded and cannot make a write land wrongly, only
 * later.
 */
export const WINDOWS_RETRY_CODES: ReadonlySet<string> = new Set(['EPERM', 'EACCES', 'EBUSY'])

/** The codes tried again by default: Windows' three there, and none anywhere else. */
export const RENAME_RETRY_CODES: ReadonlySet<string> =
  process.platform === 'win32' ? WINDOWS_RETRY_CODES : new Set<string>()

export type Rename = (from: string, to: string) => Promise<void>
export type Wait = (ms: number) => Promise<void>

/**
 * The seams a test replaces: the rename itself, the wait between attempts,
 * and the codes tried again, so the retry is exercised on any platform.
 */
export interface ReplaceOptions {
  rename?: Rename
  wait?: Wait
  codes?: ReadonlySet<string>
}

/** The code of a filesystem failure, never its message, which names the path. */
export function codeOf(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return typeof code === 'string' ? code : 'unknown error'
}

/**
 * A rename that did not land, with how many attempts were made and a code:
 * the last refusal's, which is the cause's own unless a wait between
 * attempts failed, when it is the refusal that wait followed.
 */
export class RenameRefused extends Error {
  readonly code: string

  constructor(
    readonly attempts: number,
    cause: unknown,
    code: string = codeOf(cause),
  ) {
    super('the file could not be replaced', { cause })
    this.code = code
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
 * RENAME_RETRY_DELAYS_MS while the refusal is one of the retried codes
 * (RENAME_RETRY_CODES unless a test says otherwise). Throws RenameRefused
 * on any other code at once, on a held file once the waits are spent, and
 * if a wait itself fails, always with the attempts made; cleaning up
 * `from` is the caller's.
 */
export async function renameOver(
  from: string,
  to: string,
  options: ReplaceOptions = {},
): Promise<Renamed> {
  const rename = options.rename ?? renameFile
  const wait = options.wait ?? sleep
  const codes = options.codes ?? RENAME_RETRY_CODES
  const refused: string[] = []
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to)
      return { attempts: attempt, refused }
    } catch (error) {
      const code = codeOf(error)
      if (!codes.has(code) || attempt > RENAME_RETRY_DELAYS_MS.length)
        throw new RenameRefused(attempt, error)
      refused.push(code)
    }
    try {
      await wait(RENAME_RETRY_DELAYS_MS[attempt - 1])
    } catch (error) {
      // The refusal is what failed the write; the wait only stopped it
      // being tried again, and is kept as the cause.
      throw new RenameRefused(attempt, error, refused[refused.length - 1])
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
