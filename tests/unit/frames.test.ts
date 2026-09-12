// The frames sweep, against a temporary folder. The behaviour under test is
// a refusal as much as a removal: the engine home is a setting, so the
// folder this sweeps can be anybody's, and the app must empty only one it
// made itself.

import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  claimFramesRoot,
  clearFrames,
  describeSweep,
  FRAMES_MARKER,
  type FramesSweep,
} from '../../src/main/frames'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'legible-cities-frames-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A folder with something in it, to prove what survives and what does not. */
async function folderWith(path: string, file: string): Promise<void> {
  await mkdir(path, { recursive: true })
  await writeFile(join(path, file), 'x')
}

describe('claimFramesRoot', () => {
  it('makes the folder and marks it', async () => {
    const root = join(dir, 'frames')
    expect(await claimFramesRoot(root)).toBe(true)
    expect(await readdir(root)).toEqual([FRAMES_MARKER])
  })

  // Adopting a folder that was already there would be the original bug
  // again: the app cannot know whose it is.
  it('leaves a folder it did not make unmarked, so the sweep will refuse it', async () => {
    const root = join(dir, 'frames')
    await folderWith(join(root, 'holiday-2024'), 'photo.jpg')

    expect(await claimFramesRoot(root)).toBe(false)
    expect(await readdir(root)).toEqual(['holiday-2024'])
    expect(await clearFrames(root)).toEqual({ refused: 'no marker' })
  })
})

describe('clearFrames empties a folder the app made', () => {
  it('removes what an export left and keeps the marker', async () => {
    const root = join(dir, 'frames')
    await claimFramesRoot(root)
    await folderWith(join(root, 'abc123'), 'frame-0.png')
    await folderWith(join(root, 'def456'), 'frame-0.png')

    expect(await clearFrames(root)).toEqual({ swept: 2 })
    expect(await readdir(root)).toEqual([FRAMES_MARKER])
  })

  it('says there was nothing to do for a folder that is only marked', async () => {
    const root = join(dir, 'frames')
    await claimFramesRoot(root)
    expect(await clearFrames(root)).toEqual({ swept: 0 })
  })

  it('is content with a folder that is not there', async () => {
    expect(await clearFrames(join(dir, 'never-made'))).toEqual({ swept: 0 })
  })
})

// The reason this module exists. Before it, startup did `rm` on the whole
// folder, on the home exactly as configured: a home pointed at somebody's
// own directory lost its `frames` at every launch, with no confirmation.
describe('clearFrames refuses a folder the app did not make', () => {
  it('leaves a folder with no marker exactly as it is', async () => {
    const root = join(dir, 'frames')
    await folderWith(root, 'a-persons-work.txt')
    await folderWith(join(root, 'holiday-2024'), 'photo.jpg')

    expect(await clearFrames(root)).toEqual({ refused: 'no marker' })
    expect((await readdir(root)).sort()).toEqual(['a-persons-work.txt', 'holiday-2024'])
    expect(await readdir(join(root, 'holiday-2024'))).toEqual(['photo.jpg'])
  })

  it('leaves a file standing where a folder was expected', async () => {
    const root = join(dir, 'frames')
    await writeFile(root, 'not a folder at all')
    expect(await clearFrames(root)).toEqual({ refused: 'not a folder' })
  })

  // The app never makes a link where it keeps its own folder, so one here is
  // somebody's arrangement. The engine home's reset refuses that outright
  // and this refuses it the same way, marker or no marker.
  it('refuses a link where it expects its own folder', async () => {
    const real = join(dir, 'somebody-elses')
    await folderWith(join(real, 'holiday-2024'), 'photo.jpg')
    await writeFile(join(real, FRAMES_MARKER), 'x')
    const link = join(dir, 'frames')
    try {
      await symlink(real, link, 'dir')
    } catch {
      return // a locked-down Windows account cannot make one
    }

    expect(await clearFrames(link)).toEqual({ refused: 'a link' })
    expect(await readdir(join(real, 'holiday-2024'))).toEqual(['photo.jpg'])
  })

  // The removal's own behaviour, which this module leans on: `rm` unlinks a
  // link rather than following it, so a link inside a folder the app does
  // own cannot carry the removal out of it.
  it('unlinks a link inside the folder without touching what it points at', async () => {
    const root = join(dir, 'frames')
    await claimFramesRoot(root)
    const elsewhere = join(dir, 'elsewhere')
    await folderWith(elsewhere, 'keep-me.txt')
    try {
      await symlink(elsewhere, join(root, 'looks-like-a-token'), 'dir')
    } catch {
      return // a locked-down Windows account cannot make one
    }

    expect(await clearFrames(root)).toEqual({ swept: 1 })
    expect(await readdir(root)).toEqual([FRAMES_MARKER])
    expect(await readdir(elsewhere)).toEqual(['keep-me.txt'])
  })
})

describe('describeSweep', () => {
  const cases: [FramesSweep, RegExp][] = [
    [{ swept: 0 }, /nothing to clear/],
    [{ swept: 1 }, /1 left-over export folder$/],
    [{ swept: 3 }, /3 left-over export folders$/],
    [{ swept: 2, failed: 'EACCES' }, /some would not go \(EACCES\)/],
    [{ refused: 'no marker' }, /not one the app made/],
    [{ refused: 'a link' }, /symbolic link/],
    [{ refused: 'not a folder' }, /could not be read/],
  ]

  it('says what happened without naming a path', () => {
    for (const [sweep, expected] of cases) {
      const said = describeSweep(sweep)
      expect(said, JSON.stringify(sweep)).toMatch(expected)
      expect(said).not.toMatch(/[/\\]/)
    }
  })
})
