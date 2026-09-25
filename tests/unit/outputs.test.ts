// What a project has produced, read from disk (A5.5-21): the Outputs list
// and the reveal beside each row, against a temporary folder holding real
// sidecars.
//
// Two of these are the feature rather than its decoration. A restart is the
// whole point: the list has to come from the sidecars the engine already
// wrote and never from what a session remembers, so every test here starts
// from files and no export has ever run. And a file moved or deleted since
// has to read as gone rather than fail on a press, because a person's own
// export folder is theirs to tidy.
//
// The guards are here too. The page names a file and never a folder, so a
// name that is a path must resolve to nothing at all.

import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Outputs, SCAN_MAX, SIDECAR_MAX, registerOutputHandlers } from '../../src/main/outputs'
import { CHANNELS } from '../../src/shared/api'
import { OUTPUTS_MAX } from '../../src/shared/export'
import type { ProjectRecord } from '../../src/shared/project'

/** An `ipcMain.handle` handler, as this file calls one back. */
type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'legible-cities-outputs-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const PROJECT = {
  id: 'kq7x2mzp4dna',
  name: 'Los Angeles',
  destination: null,
  readOnly: false,
} as unknown as ProjectRecord & { readOnly: boolean }

/** The folder the exporter writes into: the app's, then the project's name. */
const folder = (): string => join(root, 'Los Angeles')

/**
 * One finished export as the engine leaves it: the deliverable, and the
 * sidecar beside it named for the file. `made` is the sidecar's own
 * modification time, which is when the encode finished.
 */
async function wrote(
  file: string,
  preset: string,
  made: string,
  { keepFile = true }: { keepFile?: boolean } = {},
): Promise<void> {
  await mkdir(folder(), { recursive: true })
  const sidecar = join(folder(), `${file}.json`)
  await writeFile(sidecar, JSON.stringify({ file, preset, bytes: 3, alt: 'a map' }))
  const when = new Date(made)
  await utimes(sidecar, when, when)
  if (keepFile) await writeFile(join(folder(), file), 'x')
}

function outputs(overrides: Partial<ConstructorParameters<typeof Outputs>[0]> = {}): {
  outputs: Outputs
  shown: string[]
  logged: string[]
} {
  const shown: string[] = []
  const logged: string[] = []
  return {
    shown,
    logged,
    outputs: new Outputs({
      projects: { get: async () => PROJECT },
      exportFolder: () => root,
      show: (path) => shown.push(path),
      log: (message) => logged.push(message),
      ...overrides,
    }),
  }
}

describe('the outputs a project has', () => {
  it('lists what is on disk, newest first, with no export having run', async () => {
    // The gap the feature fills: nothing here has a session behind it.
    await wrote('la-reel.mp4', 'instagram-reel', '2026-09-20T10:00:00.000Z')
    await wrote('la-square.png', 'instagram-square', '2026-09-22T10:00:00.000Z')
    const rows = await outputs().outputs.list(PROJECT.id)
    expect(rows.map((r) => r.file)).toEqual(['la-square.png', 'la-reel.mp4'])
    expect(rows.map((r) => r.preset)).toEqual(['instagram-square', 'instagram-reel'])
    expect(rows.every((r) => r.present)).toBe(true)
    expect(rows[0].made).toBe('2026-09-22T10:00:00.000Z')
  })

  it('reads a file moved or deleted since as gone, and keeps its row', async () => {
    await wrote('la-reel.mp4', 'instagram-reel', '2026-09-20T10:00:00.000Z', { keepFile: false })
    const rows = await outputs().outputs.list(PROJECT.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].present).toBe(false)
    // What was made is still worth saying; only the press goes.
    expect(rows[0].preset).toBe('instagram-reel')
  })

  it('answers nothing for a project that has exported nothing', async () => {
    // The folder does not exist at all, which is not a failure.
    expect(await outputs().outputs.list(PROJECT.id)).toEqual([])
  })

  it('passes over whatever else is in a folder a person chose', async () => {
    await mkdir(folder(), { recursive: true })
    // A sidecar naming a file it does not sit beside, and a JSON file of
    // somebody else's: neither is an export of ours.
    await writeFile(join(folder(), 'notes.json'), JSON.stringify({ file: 'something-else.mp4' }))
    await writeFile(join(folder(), 'half.json'), '{ not json')
    await writeFile(join(folder(), 'plain.json'), '[]')
    await wrote('la-reel.mp4', 'instagram-reel', '2026-09-20T10:00:00.000Z')
    expect((await outputs().outputs.list(PROJECT.id)).map((r) => r.file)).toEqual(['la-reel.mp4'])
  })

  it('names the file but never the folder it is in', async () => {
    await wrote('la-reel.mp4', 'instagram-reel', '2026-09-20T10:00:00.000Z')
    const rows = await outputs().outputs.list(PROJECT.id)
    expect(JSON.stringify(rows)).not.toContain(root)
    expect(Object.keys(rows[0]).sort()).toEqual(['file', 'made', 'present', 'preset'])
  })

  it('lists at most the newest OUTPUTS_MAX', async () => {
    for (let i = 0; i < OUTPUTS_MAX + 3; i++) {
      // Newest last, so the cut has to be made by date and not by order.
      await wrote(`f${i}.png`, 'x', `2026-09-01T00:00:${String(i).padStart(2, '0')}.000Z`)
    }
    const rows = await outputs().outputs.list(PROJECT.id)
    expect(rows).toHaveLength(OUTPUTS_MAX)
    expect(rows[0].file).toBe(`f${OUTPUTS_MAX + 2}.png`)
  })

  it('reads the project’s own destination over the app’s folder', async () => {
    const chosen = await mkdtemp(join(tmpdir(), 'legible-cities-chosen-'))
    try {
      await mkdir(join(chosen, 'Los Angeles'), { recursive: true })
      await writeFile(
        join(chosen, 'Los Angeles', 'own.mp4.json'),
        JSON.stringify({ file: 'own.mp4', preset: 'linkedin-video' }),
      )
      await writeFile(join(chosen, 'Los Angeles', 'own.mp4'), 'x')
      await wrote('la-reel.mp4', 'instagram-reel', '2026-09-20T10:00:00.000Z')
      const { outputs: o } = outputs({
        projects: { get: async () => ({ ...PROJECT, destination: chosen }) },
      })
      expect((await o.list(PROJECT.id)).map((r) => r.file)).toEqual(['own.mp4'])
    } finally {
      await rm(chosen, { recursive: true, force: true })
    }
  })

  it('never opens a sidecar too big to be one, however new it is', async () => {
    // The freeze this bounds: a person points a project's destination at a
    // folder they already use, and one large .json in it gets read whole and
    // parsed on the process that owns the engine's framing, the window and
    // any running export.
    //
    // Asserted from the answer rather than by watching the reads. This file
    // is a *valid* sidecar beside a file that is really there, and the
    // newest thing in the folder - so the only thing that can keep it out of
    // the list is that its size was looked at before its contents.
    await mkdir(folder(), { recursive: true })
    const huge = join(folder(), 'huge.mp4.json')
    await writeFile(
      huge,
      JSON.stringify({ file: 'huge.mp4', preset: 'x', pad: 'y'.repeat(SIDECAR_MAX) }),
    )
    await writeFile(join(folder(), 'huge.mp4'), 'x')
    const later = new Date('2030-01-01T00:00:00.000Z')
    await utimes(huge, later, later)
    await wrote('la-reel.mp4', 'instagram-reel', '2026-09-20T10:00:00.000Z')

    expect((await outputs().outputs.list(PROJECT.id)).map((r) => r.file)).toEqual(['la-reel.mp4'])
  })

  it('opens at most SCAN_MAX sidecars, whatever else the folder holds', async () => {
    // A folder of somebody else's JSON, every file of it newer than the one
    // export: the cap has to bound the reading and not only the answer, or a
    // person's own folder decides how long the main process is busy.
    //
    // Again from the answer: bounded, the walk stops before it reaches the
    // export and the list is empty. Unbounded, it reads every one of them
    // and the export is there at the end of it - which is the reading this
    // is here to refuse.
    await wrote('la-reel.mp4', 'instagram-reel', '2026-01-01T00:00:00.000Z')
    await mkdir(folder(), { recursive: true })
    for (let i = 0; i < SCAN_MAX + 20; i++) {
      const theirs = join(folder(), `theirs-${String(i).padStart(4, '0')}.json`)
      await writeFile(theirs, '{"note":"not an export"}')
      const later = new Date('2030-01-01T00:00:00.000Z')
      await utimes(theirs, later, later)
    }
    const { outputs: o, logged } = outputs()
    expect(await o.list(PROJECT.id)).toEqual([])
    // And says so where a person can find it. The trade is right - a fast
    // incomplete answer beats a multi-second freeze - but an incomplete one
    // *looks* right: the rail says "Nothing exported yet." while the
    // exports are sitting in the folder, and without this line "Copy
    // diagnostics" would not mention it either.
    expect(logged.join(' ')).toContain('not read to the end')
    expect(logged.join(' '), 'and how far it got').toContain(String(SCAN_MAX))
  })

  it('passes over anything in the folder that is not a file', async () => {
    // A directory named like a sidecar is the harmless case. The one this
    // check is really for cannot be tested without hanging rather than
    // failing: a named pipe would send `readFile` to block one of libuv's
    // four threads until something writes to it, with no timeout and no way
    // back. `outputs.ts` says so where the check is.
    await mkdir(join(folder(), 'a-folder.json'), { recursive: true })
    await wrote('la-reel.mp4', 'instagram-reel', '2026-09-20T10:00:00.000Z')
    expect((await outputs().outputs.list(PROJECT.id)).map((r) => r.file)).toEqual(['la-reel.mp4'])
  })

  it('refuses to read anything while the engine’s home is being removed', async () => {
    const { outputs: o } = outputs({ blocked: () => 'a reset is running' })
    await expect(o.list(PROJECT.id)).rejects.toThrow('a reset is running')
  })
})

describe('a folder that cannot be read', () => {
  // A folder the process may not list. Windows does not refuse a directory
  // listing on a mode bit, so there is nothing to make fail there; the guard
  // itself is the same on every platform.
  const unreadable = it.skipIf(process.platform === 'win32')

  unreadable('rejects with the code alone, never with the path Node puts in it', async () => {
    // It reaches no screen today, because the page turns a failed read into
    // an empty list - but the preload hands a rejection's message to the
    // page verbatim, and Node writes the path it failed on into that
    // message ("EACCES: permission denied, scandir '/Users/…'"). One future
    // `catch` that renders it would be a leak with no change here.
    await mkdir(folder(), { recursive: true })
    await chmod(folder(), 0o000)
    try {
      const message = await outputs()
        .outputs.list(PROJECT.id)
        .then(
          () => 'it did not reject',
          (error: unknown) => (error as Error).message,
        )
      expect(message).toBe('EACCES')
      expect(message).not.toContain(root)
      expect(message).not.toMatch(/[/\\]/)
    } finally {
      await chmod(folder(), 0o700)
    }
  })
})

describe('revealing one of them', () => {
  it('shows the file the row names, and nothing the page chose', async () => {
    await wrote('la-reel.mp4', 'instagram-reel', '2026-09-20T10:00:00.000Z')
    const { outputs: o, shown } = outputs()
    expect(await o.reveal(PROJECT.id, 'la-reel.mp4')).toBe(true)
    expect(shown).toEqual([join(folder(), 'la-reel.mp4')])
  })

  it('answers false for a file gone since the list was read, and shows nothing', async () => {
    // The race the page recovers from by reading the folder again: a press
    // must not fail, and must not reveal an empty folder as if it had.
    await wrote('la-reel.mp4', 'instagram-reel', '2026-09-20T10:00:00.000Z', { keepFile: false })
    const { outputs: o, shown } = outputs()
    expect(await o.reveal(PROJECT.id, 'la-reel.mp4')).toBe(false)
    expect(shown).toEqual([])
  })

  it('reveals a row the list’s cap left out, without walking the folder', async () => {
    // A press looks its one candidate up by name and opens that sidecar
    // alone, so it costs the same whichever row was pressed and is not
    // limited by what the list had room to show. If a press went through
    // `list`, this would answer false: the export is the oldest thing here
    // and the scan stops long before it.
    await wrote('la-reel.mp4', 'instagram-reel', '2026-01-01T00:00:00.000Z')
    await mkdir(folder(), { recursive: true })
    for (let i = 0; i < SCAN_MAX + 20; i++) {
      const theirs = join(folder(), `theirs-${String(i).padStart(4, '0')}.json`)
      await writeFile(theirs, '{"note":"not an export"}')
      const later = new Date('2030-01-01T00:00:00.000Z')
      await utimes(theirs, later, later)
    }
    const { outputs: o, shown } = outputs()
    expect(await o.list(PROJECT.id), 'the cap left it out').toEqual([])
    expect(await o.reveal(PROJECT.id, 'la-reel.mp4')).toBe(true)
    expect(shown).toEqual([join(folder(), 'la-reel.mp4')])
  })

  it('shows the folder it checked, even if the destination moved meanwhile', async () => {
    // The folder is resolved once and that one is shown. Resolved twice, a
    // destination changed between the check and the press would send the
    // platform to a file this never looked at.
    await wrote('la-reel.mp4', 'instagram-reel', '2026-09-20T10:00:00.000Z')
    const elsewhere = join(root, 'moved')
    let asked = 0
    const { outputs: o, shown } = outputs({
      projects: {
        get: async () => {
          asked += 1
          return asked === 1 ? PROJECT : { ...PROJECT, destination: elsewhere }
        },
      },
    })
    expect(await o.reveal(PROJECT.id, 'la-reel.mp4')).toBe(true)
    expect(shown).toEqual([join(folder(), 'la-reel.mp4')])
    expect(shown[0]).not.toContain(elsewhere)
  })

  it('reveals nothing for a name the folder does not hold', async () => {
    await wrote('la-reel.mp4', 'instagram-reel', '2026-09-20T10:00:00.000Z')
    const { outputs: o, shown } = outputs()
    for (const name of ['other.mp4', '../la-reel.mp4', 'la-reel.mp4.json']) {
      expect(await o.reveal(PROJECT.id, name)).toBe(false)
    }
    expect(shown).toEqual([])
  })
})

describe('the two handlers', () => {
  /** `ipcMain.handle`, remembered, with the top-frame check already passed. */
  function registered(source: { list: unknown; reveal: unknown }): Map<string, Handler> {
    const handlers = new Map<string, Handler>()
    const ipcMain = {
      handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
    }
    registerOutputHandlers(ipcMain as never, source as never, () => true)
    return handlers
  }

  it('refuses a project that is not one, before the folder is touched', async () => {
    const list = vi.fn()
    const handlers = registered({ list, reveal: vi.fn() })
    await expect(handlers.get(CHANNELS.exportOutputs)!({}, '../elsewhere')).rejects.toThrow()
    expect(list).not.toHaveBeenCalled()
  })

  it('refuses a name that is a path, before the folder is touched', async () => {
    const reveal = vi.fn()
    const handlers = registered({ list: vi.fn(), reveal })
    const call = handlers.get(CHANNELS.exportRevealOutput)!
    for (const name of ['../secret', 'sub/file.mp4', 'a\\b.mp4', '..', '', 'x'.repeat(300)]) {
      expect(await call({}, PROJECT.id, name)).toBe(false)
    }
    expect(reveal).not.toHaveBeenCalled()
  })

  it('passes a bare name through, and answers what the reveal answered', async () => {
    // The refusals above all hand in a source that reveals nothing, so a
    // handler that answered false unconditionally would satisfy every one
    // of them. This is the press that has to reach the folder.
    const reveal = vi.fn(async () => true)
    const list = vi.fn(async () => [])
    const handlers = registered({ list, reveal })
    expect(await handlers.get(CHANNELS.exportRevealOutput)!({}, PROJECT.id, 'la-reel.mp4')).toBe(
      true,
    )
    expect(reveal).toHaveBeenCalledWith(PROJECT.id, 'la-reel.mp4')
    expect(await handlers.get(CHANNELS.exportOutputs)!({}, PROJECT.id)).toEqual([])
    expect(list).toHaveBeenCalledWith(PROJECT.id)
  })

  it('refuses any frame but the interface’s own top one', async () => {
    const handlers = new Map<string, Handler>()
    registerOutputHandlers(
      { handle: (c: string, h: Handler) => handlers.set(c, h) } as never,
      { list: vi.fn(), reveal: vi.fn() } as never,
      () => false,
    )
    await expect(handlers.get(CHANNELS.exportOutputs)!({}, PROJECT.id)).rejects.toThrow('forbidden')
  })
})
