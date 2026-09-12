// The settings store, the folder walk and the reset, against a temporary
// user-data folder: nothing here touches the developer's own profile, and
// every root is removed afterwards.

import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  folderSize,
  refuseReset,
  resetFolder,
  SETTINGS_FILE,
  SettingsStore,
} from '../../src/main/settings'
import { DEFAULT_SETTINGS, SETTINGS_VERSION } from '../../src/shared/settings'

let dir: string
let lines: string[]
let store: SettingsStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'legible-cities-settings-'))
  lines = []
  store = new SettingsStore(dir, (message) => lines.push(message))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const file = (): string => join(dir, SETTINGS_FILE)

describe('SettingsStore', () => {
  it('starts at the defaults with no file, and says nothing about it', async () => {
    expect(await store.load()).toEqual(DEFAULT_SETTINGS)
    expect(lines, 'a first run is not a fault').toEqual([])
  })

  it('writes and reads back, keeping nothing else in the folder', async () => {
    await store.load()
    const chosen = join(dir, 'exports')
    await store.write({ ...DEFAULT_SETTINGS, theme: 'sepia', exportFolder: chosen })
    expect(await readdir(dir)).toEqual([SETTINGS_FILE])
    const again = new SettingsStore(dir, (m) => lines.push(m))
    expect(await again.load()).toEqual({
      version: SETTINGS_VERSION,
      engineFolder: null,
      exportFolder: chosen,
      theme: 'sepia',
    })
  })

  it('writes the version in force, whatever the caller passed', async () => {
    await store.write({ ...DEFAULT_SETTINGS, version: 99 })
    const written: unknown = JSON.parse(await readFile(file(), 'utf8'))
    expect(written).toMatchObject({ version: SETTINGS_VERSION })
  })

  it('falls back to the defaults for a file that is not JSON, and says so', async () => {
    await writeFile(file(), '{ half writ')
    expect(await store.load()).toEqual(DEFAULT_SETTINGS)
    expect(lines.join(' ')).toMatch(/not JSON/)
  })

  it('falls back to the defaults for JSON that is not an object', async () => {
    await writeFile(file(), '[1, 2, 3]')
    expect(await store.load()).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps the good fields of a file with a bad one, and names what it dropped', async () => {
    const good = join(dir, 'exports')
    await writeFile(
      file(),
      JSON.stringify({ version: 1, engineFolder: 'relative', exportFolder: good, theme: 'sepia' }),
    )
    const read = await store.load()
    expect(read.engineFolder).toBeNull()
    expect(read.exportFolder).toBe(good)
    expect(read.theme).toBe('sepia')
    expect(lines.join(' ')).toMatch(/engineFolder/)
    expect(lines.join(' '), 'the value is a path and never goes in the log').not.toContain(
      'relative',
    )
  })

  it('leaves the previous file whole when a write cannot finish', async () => {
    await store.write({ ...DEFAULT_SETTINGS, theme: 'sepia' })
    const broken = new SettingsStore(join(dir, 'gone', 'deeper'), (m) => lines.push(m))
    // A folder the store can make is made; a path whose parent is a *file*
    // cannot be, so the write fails where the rename would have been.
    await writeFile(join(dir, 'blocked'), 'not a folder')
    const blocked = new SettingsStore(join(dir, 'blocked'), (m) => lines.push(m))
    await expect(blocked.write({ ...DEFAULT_SETTINGS })).rejects.toThrow(/could not be saved/)
    expect(await store.load(), 'the earlier file survived').toMatchObject({ theme: 'sepia' })
    // The broken store answers defaults rather than throwing on a read.
    expect(await broken.load()).toEqual(DEFAULT_SETTINGS)
  })

  it('never lets a filesystem message, which names a path, reach the caller', async () => {
    await writeFile(join(dir, 'blocked'), 'not a folder')
    const blocked = new SettingsStore(join(dir, 'blocked'), (m) => lines.push(m))
    const failure = await blocked.write({ ...DEFAULT_SETTINGS }).catch((error: Error) => error)
    expect((failure as Error).message).toBe('the settings could not be saved')
  })
})

describe('folderSize', () => {
  it('says a folder that is not there is missing, not broken', async () => {
    expect(await folderSize(join(dir, 'nope'))).toEqual({
      bytes: 0,
      files: 0,
      partial: false,
      missing: true,
    })
  })

  it('counts files through every level', async () => {
    await mkdir(join(dir, 'engine', 'projects', 'p1'), { recursive: true })
    await writeFile(join(dir, 'engine', 'a.txt'), 'abcde')
    await writeFile(join(dir, 'engine', 'projects', 'p1', 'b.txt'), 'fg')
    const size = await folderSize(join(dir, 'engine'))
    expect(size).toEqual({ bytes: 7, files: 2, partial: false, missing: false })
  })

  it('never follows a symbolic link out of the folder', async () => {
    await mkdir(join(dir, 'engine'), { recursive: true })
    await writeFile(join(dir, 'outside.bin'), 'x'.repeat(100))
    try {
      await symlink(join(dir, 'outside.bin'), join(dir, 'engine', 'link.bin'), 'file')
    } catch {
      // A locked-down Windows account cannot make one; with no link there
      // is nothing to follow and the folder is empty either way.
    }
    const size = await folderSize(join(dir, 'engine'))
    expect(size.bytes).toBe(0)
    expect(size.files).toBe(0)
  })

  it('stops at the cap and says the count is a floor', async () => {
    await mkdir(join(dir, 'many'), { recursive: true })
    for (let i = 0; i < 5; i += 1) await writeFile(join(dir, 'many', `f${i}`), 'ab')
    const size = await folderSize(join(dir, 'many'), 3)
    expect(size.partial).toBe(true)
    expect(size.files).toBeLessThan(5)
  })
})

// refuseReset is pure, so these folders need not exist: they are built
// under the platform's temporary directory at run time rather than written
// out, because a literal that reads as somebody's machine path is what
// bin/preflight refuses, and rightly.
describe('refuseReset', () => {
  const above = join(tmpdir(), 'legible-cities-people')
  const person = join(above, 'someone')
  const guards = { userData: join(person, 'profile', 'App'), homeDir: person }

  it('allows the engine home under the user-data folder, which is the default', () => {
    expect(refuseReset(join(guards.userData, 'engine'), guards)).toBeNull()
  })

  it('allows a folder a person chose somewhere else entirely', () => {
    expect(refuseReset(join(tmpdir(), 'legible-cities-disk', 'engine'), guards)).toBeNull()
  })

  it('refuses a relative folder', () => {
    expect(refuseReset('engine', guards)).toMatch(/not a folder/)
  })

  it('refuses the whole disk', () => {
    expect(refuseReset(parse(process.cwd()).root, guards)).toMatch(/whole disk/)
  })

  it('refuses the home folder itself and anything above it', () => {
    expect(refuseReset(guards.homeDir, guards)).toMatch(/your home folder/)
    expect(refuseReset(above, guards)).toMatch(/home folder/)
  })

  it("refuses a folder that holds the app's own settings", () => {
    expect(refuseReset(guards.userData, guards)).toMatch(/settings/)
    expect(refuseReset(join(person, 'profile'), guards)).toMatch(/settings/)
  })
})

describe('resetFolder', () => {
  it('removes everything under the folder and leaves it there, empty', async () => {
    const home = join(dir, 'engine')
    await mkdir(join(home, 'projects', 'p1'), { recursive: true })
    await writeFile(join(home, 'projects', 'p1', 'project.json'), '{}')
    await writeFile(join(dir, 'keep.txt'), 'untouched')
    await resetFolder(home)
    expect(await readdir(home)).toEqual([])
    expect(await readFile(join(dir, 'keep.txt'), 'utf8'), 'nothing outside was touched').toBe(
      'untouched',
    )
  })

  it('makes the folder when it was not there', async () => {
    const home = join(dir, 'never-existed')
    await resetFolder(home)
    expect(await readdir(home)).toEqual([])
  })
})
