// An export's working frames: `<engine home>/frames/<token>/`, which exist
// only while an export runs (ADR-016).
//
// A crash mid-export leaves them, and nothing will ever ask for them again,
// so they are swept at startup. That sweep used to remove the whole folder,
// on the home as configured and with no check of any kind - and the home is
// a setting, which a person or SCHEMATIC_HOME can point anywhere. A home at
// somebody's own folder that happened to hold a `frames` directory lost it
// at every launch, silently, with no confirmation and no undo.
//
// So the app now sweeps only a folder it made itself, and proves that by a
// marker it writes when it makes one. No marker, no sweep: the folder is
// somebody else's and the app leaves it alone and says so. The root itself
// is never removed, only what is inside it, which is also what keeps the
// marker from having to be rewritten on every run.

import { lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { realOrResolved } from './settings'

/** Where the frames live under the engine home. */
export const FRAMES_FOLDER = 'frames'

/** What says the folder is the app's to empty. */
export const FRAMES_MARKER = '.legible-frames'

const MARKER_TEXT = [
  "This folder holds a Legible Cities export's frames while it runs.",
  'Everything in it is temporary and is removed when the app next starts.',
  'Deleting this file stops the app from clearing the folder.',
  '',
].join('\n')

/** The code of a filesystem failure, never its message, which names the path. */
function reasonOf(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code
  return typeof code === 'string' ? code : 'unknown error'
}

/**
 * Make the frames root if it is not there, and mark it as the app's.
 *
 * **Only a folder this makes is marked.** A folder that was already there is
 * left exactly as found, unmarked, and so is never swept: adopting one would
 * be the original bug again, since the folder it adopted might be somebody's
 * own. `mkdir` answers the path it created and nothing when it created
 * nothing, which is the whole test.
 *
 * The cost is that a frames folder made by a version of the app from before
 * this is never swept either, and its leftovers stay until a person removes
 * them. That is the right way round: stale frames waste space, and the other
 * mistake loses work.
 */
export async function claimFramesRoot(root: string): Promise<boolean> {
  const made = await mkdir(root, { recursive: true })
  if (made === undefined) return false
  await writeFile(join(root, FRAMES_MARKER), MARKER_TEXT, 'utf8')
  return true
}

/** What a sweep did, for the log: never a path. */
export type FramesSweep =
  { swept: number; failed?: string } | { refused: 'no marker' | 'not a folder' | 'a link' }

/**
 * Empty the frames root of everything an export left, and nothing else.
 *
 * The path is resolved through every symbolic link first, for the same
 * reason the reset resolves the home: a link at the root would otherwise
 * carry the removal somewhere the app never looked at. A root that is not
 * there, or is not the app's, is left exactly as it is.
 */
export async function clearFrames(root: string): Promise<FramesSweep> {
  let real: string
  let entries: string[]
  try {
    // A link where the app expects its own folder is somebody's arrangement,
    // because the app never makes one. The reset refuses that outright and
    // this refuses it the same way: one policy, or the exception becomes the
    // thing a later change reasons from.
    if ((await lstat(root)).isSymbolicLink()) return { refused: 'a link' }
    real = await realOrResolved(root)
    entries = await readdir(real)
  } catch (error) {
    // Not there at all is the ordinary case on a first run, and there is
    // nothing to sweep either way.
    const code = reasonOf(error)
    return code === 'ENOENT' ? { swept: 0 } : { refused: 'not a folder' }
  }
  if (!entries.includes(FRAMES_MARKER)) return { refused: 'no marker' }

  let swept = 0
  let failed: string | undefined
  for (const entry of entries) {
    if (entry === FRAMES_MARKER) continue
    try {
      // `rm` unlinks a link rather than following it, so a link an export
      // never made cannot carry the removal out of this folder.
      await rm(join(real, entry), { recursive: true, force: true })
      swept += 1
    } catch (error) {
      // Every entry is attempted whatever happened to the last, as the
      // reset's folders are: one that will not go must not pin the rest
      // here forever, since the next start would stop at the same place.
      failed ??= reasonOf(error)
    }
  }
  return failed === undefined ? { swept } : { swept, failed }
}

/** The sweep as a sentence for the log, naming folders and codes, never a path. */
export function describeSweep(sweep: FramesSweep): string {
  if ('refused' in sweep) {
    if (sweep.refused === 'no marker')
      return 'the frames folder is not one the app made, so it was left alone'
    if (sweep.refused === 'a link')
      return 'the frames folder is a symbolic link, which the app will not follow'
    return 'the frames folder could not be read, so it was left alone'
  }
  const cleared =
    sweep.swept === 0
      ? 'the frames folder held nothing to clear'
      : `cleared ${sweep.swept} left-over export folder${sweep.swept === 1 ? '' : 's'}`
  return sweep.failed === undefined ? cleared : `${cleared}; some would not go (${sweep.failed})`
}
