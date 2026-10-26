// The store against a temporary engine home: nothing here touches the
// developer's own data, and every root is removed afterwards.

import { createHash } from 'node:crypto'
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isValidProjectId } from '../../src/main/paths'
import { newId, ProjectStore } from '../../src/main/projects'
import {
  RENAME_RETRY_DELAYS_MS,
  WINDOWS_RETRY_CODES,
  type Rename,
  type Wait,
} from '../../src/main/replace-file'
import { RECORD_VERSION } from '../../src/main/record/parse'
import { ID_PATTERN } from '../../src/main/record/validate'
import { drawnDate } from '../../src/shared/project/helpers'
import {
  DEFAULT_COLOR,
  DEFAULT_THEME,
  type ProjectRecord,
  type SentSet,
} from '../../src/shared/project/types'
import { drawsOn, sentOf } from '../support/sent'

let home: string
let root: string
let lines: string[]
let store: ProjectStore

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'legible-cities-store-'))
  root = join(home, 'projects')
  lines = []
  store = new ProjectStore(home, (message) => lines.push(message))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

const A = 'aaaaaaaaaaaa'
const B = 'bbbbbbbbbbbb'

function record(id: string, overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    version: RECORD_VERSION,
    id,
    name: 'Seed',
    feed: 'la-metro-rail',
    mode: 'all',
    agency: null,
    date: null,
    service: null,
    style: {},
    colors: {},
    defaultColor: DEFAULT_COLOR,
    lineOrder: [],
    theme: DEFAULT_THEME,
    export: { preset: 'instagram-reel', options: {} },
    destination: null,
    layout: null,
    made: null,
    drawn: null,
    built: null,
    opened: null,
    created: '2026-09-01T00:00:00.000Z',
    modified: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

/** Write a record, or raw text, where the store expects one. */
async function seed(id: string, content: unknown): Promise<void> {
  await mkdir(join(root, id), { recursive: true })
  const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n'
  await writeFile(join(root, id, 'project.json'), text)
}

async function readRecord(id: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(root, id, 'project.json'), 'utf8'))
}

/** Every path under a directory with a hash of each file, so two trees compare byte for byte. */
async function snapshot(dir: string, base = dir): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    const key = relative(base, path).split(sep).join('/')
    if (entry.isDirectory()) {
      out[`${key}/`] = 'directory'
      Object.assign(out, await snapshot(path, base))
    } else {
      out[key] = createHash('sha256')
        .update(await readFile(path))
        .digest('hex')
    }
  }
  return out
}

describe('newId', () => {
  it('generates identifiers the origin accepts, and never the same one twice', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 200; i += 1) {
      const id = newId()
      expect(id).toMatch(ID_PATTERN)
      expect(isValidProjectId(id), id).toBe(true)
      ids.add(id)
    }
    expect(ids.size).toBe(200)
  })
})

describe('create', () => {
  it('writes the record from contracts/record.md, pretty-printed, with one timestamp', async () => {
    const created = await store.create({ name: '  Los Angeles ', feed: 'la-metro-rail' })
    expect(created.id).toMatch(ID_PATTERN)
    expect(isValidProjectId(created.id)).toBe(true)
    expect(created.created).toBe(created.modified)

    const text = await readFile(join(root, created.id, 'project.json'), 'utf8')
    // Field order and layout are the contract's: built here in that order
    // so the comparison covers both.
    const expected = {
      version: RECORD_VERSION,
      id: created.id,
      name: 'Los Angeles',
      feed: 'la-metro-rail',
      mode: 'all',
      agency: null,
      date: null,
      service: null,
      // A new project has chosen nothing: every size is the engine's own
      // until a person sets one (issue 350).
      style: {},
      colors: {},
      defaultColor: '#888888',
      lineOrder: [],
      theme: 'warm-dark',
      export: { preset: 'instagram-reel', options: {} },
      destination: null,
      layout: null,
      made: null,
      drawn: null,
      built: null,
      opened: null,
      created: created.created,
      modified: created.modified,
      // The record's first write (spec 037, FR-001).
      revision: 1,
    }
    expect(text).toBe(JSON.stringify(expected, null, 2) + '\n')
    expect(text.endsWith('\n')).toBe(true)
    expect(created).toEqual(expected)
    // The temporary file is gone once the rename lands.
    expect(await readdir(join(root, created.id))).toEqual(['project.json'])
    expect(lines).toEqual([])
  })
  it('creates the projects folder on demand', async () => {
    expect(await store.list()).toEqual([])
    await store.create({ name: 'First', feed: 'la-metro-rail' })
    expect((await readdir(root)).length).toBe(1)
  })
  it('takes mode and agency, trimmed, with an empty agency as none', async () => {
    const a = await store.create({ name: 'A', feed: 'x', mode: 'rail', agency: '  Metro ' })
    expect(a.mode).toBe('rail')
    expect(a.agency).toBe('Metro')
    const b = await store.create({ name: 'B', feed: 'x', agency: '   ' })
    expect(b.mode).toBe('all')
    expect(b.agency).toBeNull()
  })
  it('refuses a bad input with the contract message and writes nothing', async () => {
    await expect(store.create({ name: '  ', feed: 'la-metro-rail' })).rejects.toThrow(
      'Give the project a name.',
    )
    await expect(store.create({ name: 'x'.repeat(121), feed: 'la-metro-rail' })).rejects.toThrow(
      'Shorten the name to 120 characters or fewer.',
    )
    await expect(store.create({ name: 'LA', feed: 'LA Metro' })).rejects.toThrow(
      'feed key must be lowercase letters, digits and hyphens',
    )
    await expect(store.create({ name: 'LA', feed: 'la', mode: 'Rail' })).rejects.toThrow(
      'mode must be one or more of the modes LOOM knows',
    )
    await expect(store.create({ name: 'LA', feed: 'la', agency: 'x'.repeat(65) })).rejects.toThrow(
      'agency is too long',
    )
    expect(await store.list()).toEqual([])
  })
  it('gives two projects with the same name two identities', async () => {
    const first = await store.create({ name: 'Twin', feed: 'la-metro-rail' })
    const second = await store.create({ name: 'Twin', feed: 'la-metro-rail' })
    expect(first.id).not.toBe(second.id)
    const ids = (await store.list()).map((s) => s.id)
    expect(ids.sort()).toEqual([first.id, second.id].sort())
  })
})

describe('list', () => {
  it('is empty before the projects folder exists, without a word in the log', async () => {
    expect(await store.list()).toEqual([])
    expect(lines).toEqual([])
  })
  it('returns summaries newest first and skips what is not a project, naming the folder', async () => {
    // Neither has been opened, so they order by when they were made (A5.6-04).
    await seed(A, record(A, { name: 'Older', created: '2026-09-01T00:00:00.000Z' }))
    await seed(B, record(B, { name: 'Newer', created: '2026-09-02T00:00:00.000Z' }))
    await mkdir(join(root, 'cccccccccccc')) // a folder with no record
    await seed('dddddddddddd', '{ "version": 1, ') // invalid JSON
    await seed('eeeeeeeeeeee', { version: 1, name: 'No id', feed: 'x' })
    await seed('ffffffffffff', record(A)) // a record copied under another folder
    await writeFile(join(root, '.DS_Store'), '') // a stray file is not a folder

    const summaries = await store.list()
    expect(summaries.map((s) => s.id)).toEqual([B, A])
    expect(summaries[0]).toMatchObject({
      id: B,
      name: 'Newer',
      feed: 'la-metro-rail',
      date: null,
      opened: null,
      created: '2026-09-02T00:00:00.000Z',
      readOnly: false,
    })
    expect(lines.sort()).toEqual([
      'projects/cccccccccccc: no record',
      'projects/dddddddddddd: invalid JSON',
      'projects/eeeeeeeeeeee: missing or invalid id',
      'projects/ffffffffffff: record id does not match its folder',
    ])
  })
  it('marks a record from a later version read-only', async () => {
    await seed(A, record(A, { version: RECORD_VERSION + 1 }))
    expect((await store.list())[0]).toMatchObject({ id: A, readOnly: true })
  })
  it('orders by when a project was last opened, not when it was last changed', async () => {
    await seed(A, record(A, { name: 'Edited', modified: '2026-09-20T00:00:00.000Z' }))
    await seed(
      B,
      record(B, {
        name: 'Opened',
        modified: '2026-09-01T00:00:00.000Z',
        opened: '2026-09-10T00:00:00.000Z',
      }),
    )
    // A made after B was opened, and never opened, still comes after B:
    // made on the 5th against opened on the 10th.
    await seed(
      'cccccccccccc',
      record('cccccccccccc', { name: 'Made', created: '2026-09-05T00:00:00.000Z' }),
    )
    expect((await store.list()).map((s) => s.name)).toEqual(['Opened', 'Made', 'Edited'])
  })
})

// Issue 206. What Settings asks before it takes a folder for the engine's
// data and before a reset: where each project exports, from the records
// under the home this store was built on and from nowhere else.
describe('destinations', () => {
  const videos = (...more: string[]): string => join(tmpdir(), 'legible-cities-videos', ...more)

  it('is empty before the projects folder exists, without a word in the log', async () => {
    expect(await store.destinations()).toEqual([])
    expect(lines).toEqual([])
  })

  it('answers the id, the name and the folder of each project that chose one, by name, and leaves out the rest', async () => {
    await seed(A, record(A, { name: 'Metra', destination: videos('metra') }))
    await seed(B, record(B, { name: 'Bart', destination: videos() }))
    await seed('cccccccccccc', record('cccccccccccc', { name: 'Caltrain', destination: null }))
    expect(await store.destinations()).toEqual([
      { id: B, name: 'Bart', destination: videos() },
      { id: A, name: 'Metra', destination: videos('metra') },
    ])
    expect(lines).toEqual([])
  })

  it('answers the folder as the record holds it, through the store’s own writer', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    expect(await store.destinations(), 'a new project exports to the app’s folder').toEqual([])
    await store.setDestination(project.id, videos('la'))
    expect(await store.destinations()).toEqual([
      { id: project.id, name: 'LA', destination: videos('la') },
    ])
    await store.setDestination(project.id, null)
    expect(await store.destinations()).toEqual([])
  })

  it('skips what is not a project exactly as list does, naming the folder', async () => {
    await seed(A, record(A, { name: 'Kept', destination: videos('kept') }))
    await mkdir(join(root, 'cccccccccccc')) // a folder with no record
    await seed('dddddddddddd', '{ "version": 1, ') // invalid JSON
    await seed('eeeeeeeeeeee', { version: 1, name: 'No id', destination: videos('no-id') })
    await seed('ffffffffffff', record(A, { destination: videos('copied') })) // copied by hand
    await seed('not-an-id', record(A, { destination: videos('stray') }))
    await writeFile(join(root, 'notes.json'), JSON.stringify({ destination: videos('notes') }))

    expect(await store.destinations()).toEqual([
      { id: A, name: 'Kept', destination: videos('kept') },
    ])
    const said = [...lines].sort()
    lines.length = 0
    await store.list()
    expect(said, 'the same folders, for the same reasons').toEqual([...lines].sort())
    expect(said).toEqual([
      'projects/cccccccccccc: no record',
      'projects/dddddddddddd: invalid JSON',
      'projects/eeeeeeeeeeee: missing or invalid id',
      'projects/ffffffffffff: record id does not match its folder',
      'projects/not-an-id: not a project identifier',
    ])
  })

  // Two failures that end differently on purpose (issue 206). A folder
  // that cannot be listed hides every project, so whoever asked must be
  // told; the list, which the front door reads, still answers.
  it('rejects when the projects folder cannot be listed, by the failure’s code and never its path, where the list still answers', async () => {
    // A file where the folder should be: the same failure on every platform.
    await writeFile(root, 'not a folder')
    const failure = await store.destinations().then(
      () => null,
      (error: unknown) => error as NodeJS.ErrnoException,
    )
    expect(failure, 'it did not answer "none"').not.toBeNull()
    expect(failure?.code).toBe('ENOTDIR')
    expect(failure?.message).toBe('the projects folder could not be listed')
    expect(failure?.message, 'a message for the screen names no folder').not.toContain(home)
    expect(lines).toEqual(['projects: cannot list (ENOTDIR)'])

    lines.length = 0
    expect(await store.list(), 'the front door still opens').toEqual([])
    expect(lines).toEqual(['projects: cannot list (ENOTDIR)'])
  })

  it('skips a record it cannot read, by its folder and the failure’s code, and answers the rest', async () => {
    await seed(A, record(A, { name: 'Kept', destination: videos('kept') }))
    // A folder where the record should be: it can be found and not read.
    await mkdir(join(root, B, 'project.json'), { recursive: true })
    expect(await store.destinations()).toEqual([
      { id: A, name: 'Kept', destination: videos('kept') },
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^projects\/bbbbbbbbbbbb: unreadable \(E[A-Z]+\)$/)
    expect(lines[0], 'and the line names no path').not.toContain(home)
  })

  it('counts a project a newer version of the app made, which is read-only here', async () => {
    await seed(
      A,
      record(A, { version: RECORD_VERSION + 1, name: 'Newer', destination: videos('newer') }),
    )
    expect((await store.get(A)).readOnly).toBe(true)
    expect(await store.destinations()).toEqual([
      { id: A, name: 'Newer', destination: videos('newer') },
    ])
  })

  it('leaves out a folder the record could never have stored', async () => {
    await seed(A, { ...record(A), destination: 'relative/folder' })
    await seed(B, { ...record(B), destination: 42 })
    expect(await store.destinations()).toEqual([])
  })

  it('does not see a record left behind in a previous home: it reads the home it was built on and no other', async () => {
    const previous = await mkdtemp(join(tmpdir(), 'legible-cities-store-before-'))
    try {
      const before = new ProjectStore(previous, (message) => lines.push(message))
      const left = await before.create({ name: 'Left behind', feed: 'la-metro-rail' })
      await before.setDestination(left.id, home)
      expect(await store.destinations(), 'this home holds no record of it').toEqual([])
      expect(await before.destinations(), 'which is still where it was').toEqual([
        { id: left.id, name: 'Left behind', destination: home },
      ])
    } finally {
      await rm(previous, { recursive: true, force: true })
    }
  })
})

describe('markOpened', () => {
  it('writes when the project was opened, and not that it was changed', async () => {
    const before = record(A, { modified: '2026-09-01T00:00:00.000Z' })
    await seed(A, before)
    const after = await store.markOpened(A)
    expect(after.opened).not.toBeNull()
    expect(Number.isNaN(Date.parse(after.opened as string))).toBe(false)
    const written = await readRecord(A)
    expect(written.opened).toBe(after.opened)
    expect(written.modified, 'an opening is not an edit').toBe('2026-09-01T00:00:00.000Z')
    // Though it is a write, which the record's count says (spec 037).
    expect(written.revision, 'a write raises the revision').toBe(1)
    expect(after.revision, 'and the answer carries it').toBe(1)
    expect({ ...written, opened: null, revision: undefined }).toEqual(before)
  })

  it('writes onto the record as stored, not as this build reads it', async () => {
    // A field this build does not know, and an export choice it does not
    // offer: an opening must leave both exactly as they were, where an edit
    // would write its own reading of them (review of A5.6-04).
    const stored = {
      ...record(A),
      export: { preset: 'a-preset-from-a-later-build', options: {} },
      somethingNewer: { kept: true },
    }
    await seed(A, stored)
    await store.markOpened(A)
    const written = await readRecord(A)
    expect(written.export).toEqual(stored.export)
    expect(written.somethingNewer).toEqual({ kept: true })
    expect(typeof written.opened).toBe('string')
    expect(written.revision, 'a write, counted').toBe(1)
    const rest: Record<string, unknown> = { ...written }
    delete rest.opened
    delete rest.revision
    const before: Record<string, unknown> = { ...stored }
    delete before.opened
    expect(rest, 'everything but the opening, as stored').toEqual(before)
    // In the contract's place, before `created`, as a record written whole has it.
    const keys = Object.keys(written)
    expect(keys.indexOf('opened')).toBe(keys.indexOf('created') - 1)
  })

  it('leaves a project a newer build made exactly as it was', async () => {
    await seed(A, record(A, { version: RECORD_VERSION + 1 }))
    const before = await readFile(join(root, A, 'project.json'), 'utf8')
    await store.markOpened(A)
    expect(await readFile(join(root, A, 'project.json'), 'utf8')).toBe(before)
  })

  it('reads a record without the field, or with one that is not a moment, as never opened', async () => {
    const older: Record<string, unknown> = { ...record(A) }
    delete older.opened
    await seed(A, older)
    expect((await store.get(A)).opened).toBeNull()
    await seed(B, { ...record(B), opened: 'last Tuesday' })
    expect((await store.get(B)).opened).toBeNull()
    // A date alone parses, but would sort among full moments as a string
    // in the wrong place, so it is not one.
    await seed(B, { ...record(B), opened: '2026-09-10' })
    expect((await store.get(B)).opened).toBeNull()
  })
})

describe('get', () => {
  it('returns the record with readOnly false, or true for a later version', async () => {
    await seed(A, record(A, { name: 'Current' }))
    await seed(B, record(B, { name: 'Future', version: RECORD_VERSION + 1 }))
    expect(await store.get(A)).toEqual({ ...record(A, { name: 'Current' }), readOnly: false })
    const future = await store.get(B)
    expect(future.readOnly).toBe(true)
    expect(future.version).toBe(RECORD_VERSION + 1)
    expect(future.name).toBe('Future')
  })
  it('rejects an unknown or malformed identifier without a path', async () => {
    await expect(store.get('zzzzzzzzzzzz')).rejects.toThrow(/^not found$/)
    for (const id of ['', '..', 'con', 'Zzzzzzzzzzzz', 'a/b', 'zzzzzzzzzzz']) {
      await expect(store.get(id), JSON.stringify(id)).rejects.toThrow(/^invalid id$/)
    }
    expect(lines).toEqual([])
  })
})

describe('a leftover project.json.tmp', () => {
  it('is ignored by list and get', async () => {
    await seed(A, record(A, { name: 'Whole' }))
    await writeFile(join(root, A, 'project.json.tmp'), '{ "version": 1, "name": "half-writ')
    expect((await store.list()).map((s) => s.name)).toEqual(['Whole'])
    expect((await store.get(A)).name).toBe('Whole')
    expect(lines).toEqual([])
  })
  it('does not make a folder a project on its own', async () => {
    await mkdir(join(root, A), { recursive: true })
    await writeFile(join(root, A, 'project.json.tmp'), '{}')
    expect(await store.list()).toEqual([])
    expect(lines).toEqual([`projects/${A}: no record`])
  })
})

describe('rename', () => {
  it('changes exactly name and modified', async () => {
    await seed(A, record(A, { name: 'Before', agency: 'Metro', date: '2026-09-01' }))
    const before = await readRecord(A)
    const returned = await store.rename(A, '  After ')
    const after = await readRecord(A)

    expect(after.name).toBe('After')
    expect(after.modified).not.toBe(before.modified)
    expect(String(after.modified) > String(before.modified)).toBe(true)
    expect(after.created).toBe(before.created)
    // The same keys in the same order, the revision a record from before it
    // was kept gains at its first write after them (spec 037), and every
    // other value untouched.
    expect(Object.keys(after)).toEqual([...Object.keys(before), 'revision'])
    expect(after.revision).toBe(1)
    const rest = (r: Record<string, unknown>): Record<string, unknown> => {
      const copy = { ...r }
      delete copy.name
      delete copy.modified
      delete copy.revision
      return copy
    }
    expect(rest(after)).toEqual(rest(before))
    expect(returned).toEqual(after)
    expect(await readdir(join(root, A))).toEqual(['project.json'])
  })
  it('refuses a record from a later version and leaves it as it was', async () => {
    await seed(A, record(A, { version: RECORD_VERSION + 1, name: 'Future' }))
    const before = await readFile(join(root, A, 'project.json'), 'utf8')
    await expect(store.rename(A, 'Renamed')).rejects.toThrow(/^read-only$/)
    expect(await readFile(join(root, A, 'project.json'), 'utf8')).toBe(before)
  })
  it('validates the name and the identifier', async () => {
    await seed(A, record(A))
    await expect(store.rename(A, '   ')).rejects.toThrow(/^Give the project a name\.$/)
    await expect(store.rename(A, 'x'.repeat(121))).rejects.toThrow(
      /^Shorten the name to 120 characters or fewer\.$/,
    )
    await expect(store.rename(B, 'Fine')).rejects.toThrow(/^not found$/)
    await expect(store.rename('nope', 'Fine')).rejects.toThrow(/^invalid id$/)
    expect((await store.get(A)).name).toBe('Seed')
  })
})

describe('delete', () => {
  it('removes the project and its output and leaves every other folder byte-identical', async () => {
    const keep = await store.create({ name: 'Keep', feed: 'la-metro-rail' })
    const gone = await store.create({ name: 'Gone', feed: 'la-metro-rail' })
    await mkdir(join(home, 'out', gone.id, 'nested'), { recursive: true })
    await writeFile(join(home, 'out', gone.id, 'index.html'), '<title>gone</title>')
    await writeFile(join(home, 'out', gone.id, 'nested', 'app.js'), 'export {}')
    await mkdir(join(home, 'out', keep.id), { recursive: true })
    await writeFile(join(home, 'out', keep.id, 'index.html'), '<title>keep</title>')
    await mkdir(join(home, 'feeds', 'la-metro-rail'), { recursive: true })
    await writeFile(join(home, 'feeds', 'la-metro-rail', 'feed.zip'), 'PK')

    const before = await snapshot(home)
    expect(await store.delete(gone.id)).toEqual({ removed: ['project', 'output'], failed: [] })
    const after = await snapshot(home)

    const survivors = Object.fromEntries(
      Object.entries(before).filter(
        ([path]) => !path.startsWith(`projects/${gone.id}/`) && !path.startsWith(`out/${gone.id}/`),
      ),
    )
    expect(Object.keys(survivors).length).toBe(Object.keys(before).length - 6)
    expect(after).toEqual(survivors)
    expect((await store.list()).map((s) => s.id)).toEqual([keep.id])
    expect(lines).toEqual([])
  })
  it('succeeds with nothing failed when the output folder does not exist', async () => {
    const project = await store.create({ name: 'No output', feed: 'la-metro-rail' })
    expect(await store.delete(project.id)).toEqual({ removed: ['project'], failed: [] })
    expect(await store.list()).toEqual([])
    await expect(store.get(project.id)).rejects.toThrow(/^not found$/)
  })
  it('rejects an unknown or malformed identifier', async () => {
    await expect(store.delete(A)).rejects.toThrow(/^not found$/)
    await expect(store.delete('../feeds')).rejects.toThrow(/^invalid id$/)
    await expect(store.delete('Con')).rejects.toThrow(/^invalid id$/)
  })
})

describe('delete when a folder cannot be removed', () => {
  it.skipIf(process.platform === 'win32')(
    'reports the output folder by role and still removes the project',
    async () => {
      const record = await store.create({ name: 'Stuck', feed: 'la-metro-rail' })
      const outParent = join(home, 'out')
      await mkdir(join(outParent, record.id), { recursive: true })
      await writeFile(join(outParent, record.id, 'index.html'), 'x')
      // A read-and-execute-only parent cannot have a child unlinked from it.
      await chmod(outParent, 0o500)
      try {
        const result = await store.delete(record.id)
        expect(result.removed).toEqual(['project'])
        expect(result.failed).toHaveLength(1)
        expect(result.failed[0].folder).toBe('output')
        expect(result.failed[0].reason).toMatch(/^[A-Z]+$/)
      } finally {
        await chmod(outParent, 0o700)
      }
      expect(await readdir(root)).toEqual([])
    },
  )
})

const WINDOW = {
  start: '2026-01-01',
  end: '2026-12-31',
  busiest: '2026-09-15',
  anchor: '2026-09-08',
}
const MADE = '2026-09-10T12:00:00+00:00'
const BUILT = { mode: 'all', agency: null }
const LATER = '2026-09-11T08:30:00+00:00'

// A run that finished: the layout, the window, the day and the modification
// time go in together or not at all, and the day a project already has is kept.
describe('completeLayout', () => {
  const LAYOUT = 'a'.repeat(64)
  const OTHER = 'b'.repeat(64)

  it('writes the layout, the day and the time together', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    expect(project.layout).toBeNull()
    expect(project.date).toBeNull()
    const { record, changed } = await drawsOn(store).completeLayout(project.id, {
      date: '2026-09-02',
      layout: LAYOUT,
      service: WINDOW,
      made: MADE,
      built: BUILT,
    })
    expect(record.layout, "the engine's id, as answered").toBe(LAYOUT)
    expect(record.made, 'when the engine made it').toBe(MADE)
    expect(record.built, 'what the engine made it with').toEqual(BUILT)
    expect(record.date).toBe('2026-09-02')
    expect(record.service, "the engine's window and day, as answered").toEqual(WINDOW)
    expect(record.modified >= project.modified).toBe(true)
    expect(changed, 'a first layout has nothing to differ from').toBe(false)
    const onDisk = await store.get(project.id)
    expect(onDisk.layout).toBe(LAYOUT)
    expect(onDisk.date).toBe('2026-09-02')
  })

  it('keeps a service day the project already has', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await drawsOn(store).completeLayout(project.id, {
      date: '2026-09-02',
      layout: LAYOUT,
      service: WINDOW,
      made: MADE,
      built: BUILT,
    })
    const second = await drawsOn(store).completeLayout(project.id, {
      date: '2026-12-25',
      layout: LAYOUT,
      service: WINDOW,
      made: MADE,
      built: BUILT,
    })
    expect(second.record.date, 'the day is resolved once (ADR-023)').toBe('2026-09-02')
  })

  it('stores an empty built agency as none, as the record does its own', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const { record } = await drawsOn(store).completeLayout(project.id, {
      date: '2026-09-02',
      layout: LAYOUT,
      service: WINDOW,
      made: MADE,
      built: { mode: 'all', agency: ' ' },
    })
    expect(record.built).toEqual({ mode: 'all', agency: null })
  })

  it('reports a layout laid out again since, by the same id and a later made', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const done = (made: string) => ({
      date: '2026-09-02',
      layout: LAYOUT,
      service: WINDOW,
      made,
      built: BUILT,
    })
    const first = await drawsOn(store).completeLayout(project.id, done(MADE))
    expect(first.relaid, 'nothing to differ from').toBe(false)
    const same = await drawsOn(store).completeLayout(project.id, done(MADE))
    expect(same.relaid, 'the same set').toBe(false)
    const later = await drawsOn(store).completeLayout(project.id, done(LATER))
    expect(later).toMatchObject({ changed: false, relaid: true })
    expect(later.record.made).toBe(LATER)
    // A different id says more than a different time.
    const other = await drawsOn(store).completeLayout(project.id, { ...done(MADE), layout: OTHER })
    expect(other).toMatchObject({ changed: true, relaid: false })
  })

  it('treats a record from before, without made, as unchanged on its first run', async () => {
    await seed(A, record(A, { layout: LAYOUT, date: '2026-09-02' }))
    const run = await drawsOn(store).completeLayout(A, {
      date: '2026-09-02',
      layout: LAYOUT,
      service: WINDOW,
      made: LATER,
      built: BUILT,
    })
    expect(run).toMatchObject({ changed: false, relaid: false })
    expect(run.record.made).toBe(LATER)
  })

  it('reports a layout that differs from the one the project was drawn from', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const first = await drawsOn(store).completeLayout(project.id, {
      date: '2026-09-02',
      layout: LAYOUT,
      service: WINDOW,
      made: MADE,
      built: BUILT,
    })
    expect(first.changed).toBe(false)
    const same = await drawsOn(store).completeLayout(project.id, {
      date: '2026-09-02',
      layout: LAYOUT,
      service: WINDOW,
      made: MADE,
      built: BUILT,
    })
    expect(same.changed, 'the same id is the same layout').toBe(false)
    const second = await drawsOn(store).completeLayout(project.id, {
      date: '2026-09-02',
      layout: OTHER,
      service: WINDOW,
      made: MADE,
      built: BUILT,
    })
    expect(second.changed).toBe(true)
    expect(second.record.layout).toBe(OTHER)
  })

  it('replaces the window on a later run, keeping the day', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await drawsOn(store).completeLayout(project.id, {
      date: '2026-09-02',
      layout: LAYOUT,
      service: WINDOW,
      made: MADE,
      built: BUILT,
    })
    const fresh = { ...WINDOW, end: '2027-06-30', busiest: '2026-09-22', anchor: '2026-09-20' }
    const second = await drawsOn(store).completeLayout(project.id, {
      date: '2026-09-22',
      layout: LAYOUT,
      service: fresh,
      made: MADE,
      built: BUILT,
    })
    expect(second.record.service, 'a fresh feed may carry a fresh calendar').toEqual(fresh)
    expect(second.record.date).toBe('2026-09-02')
  })

  it('refuses a day, an id or a window that is not the right shape, and writes nothing', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    for (const done of [
      { date: '2026-13-01', layout: LAYOUT, service: WINDOW, made: MADE, built: BUILT },
      { date: 'yesterday', layout: LAYOUT, service: WINDOW, made: MADE, built: BUILT },
      { date: '2026-09-02', layout: 'abc', service: WINDOW, made: MADE, built: BUILT },
      { date: '2026-09-02', layout: 'A'.repeat(64), service: WINDOW, made: MADE, built: BUILT },
      { date: '2026-09-02', layout: '/etc/passwd', service: WINDOW, made: MADE, built: BUILT },
      { date: '2026-09-02', layout: LAYOUT, service: { ...WINDOW, end: '2025-12-31' }, made: MADE },
      { date: '2026-09-02', layout: LAYOUT, service: { ...WINDOW, anchor: 'today' }, made: MADE },
      { date: '2026-09-02', layout: LAYOUT, service: { start: '2026-01-01' }, made: MADE },
      { date: '2026-09-02', layout: LAYOUT, service: null },
      { date: '2026-09-02', layout: LAYOUT },
      { date: '2026-09-02', layout: LAYOUT, service: WINDOW },
      { date: '2026-09-02', layout: LAYOUT, service: WINDOW, made: 'yesterday' },
      { date: '2026-09-02', layout: LAYOUT, service: WINDOW, made: 'x'.repeat(65) },
      { date: '2026-09-02', layout: LAYOUT, service: WINDOW, made: 1726000000 },
      { date: '2026-09-02', layout: LAYOUT, service: WINDOW, made: MADE },
      {
        date: '2026-09-02',
        layout: LAYOUT,
        service: WINDOW,
        made: MADE,
        built: { mode: 'Rail!', agency: null },
      },
    ]) {
      await expect(
        drawsOn(store).completeLayout(project.id, done as never),
        JSON.stringify(done),
      ).rejects.toThrow()
    }
    expect((await store.get(project.id)).layout).toBeNull()
  })

  it('refuses a read-only project', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const file = join(home, 'projects', project.id, 'project.json')
    await writeFile(file, JSON.stringify({ ...project, version: 99 }), 'utf8')
    await expect(
      drawsOn(store).completeLayout(project.id, {
        date: '2026-09-02',
        layout: LAYOUT,
        service: WINDOW,
        made: MADE,
        built: BUILT,
      }),
    ).rejects.toThrow('read-only')
  })
})

// A day a person chose, after the map was drawn for it: written only inside
// the window the engine answered, and only for a project with a layout.
describe('completeRebuild', () => {
  const LAYOUT = 'a'.repeat(64)

  async function laidOut(): Promise<ProjectRecord> {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await drawsOn(store).completeLayout(project.id, {
      date: '2026-09-15',
      layout: LAYOUT,
      service: WINDOW,
      made: MADE,
      built: BUILT,
    })
    return project
  }

  it('writes the day and the time, and nothing else', async () => {
    const project = await laidOut()
    const before = await store.get(project.id)
    const after = await drawsOn(store).completeRebuild(project.id, { date: '2026-09-12' })
    expect(after.date).toBe('2026-09-12')
    expect(after.layout).toBe(LAYOUT)
    expect(after.service).toEqual(WINDOW)
    expect(after.modified >= before.modified).toBe(true)
    expect(await store.get(project.id)).toEqual({ ...after, readOnly: false })
  })

  it("accepts the window's first and last day", async () => {
    const project = await laidOut()
    expect((await drawsOn(store).completeRebuild(project.id, { date: '2026-01-01' })).date).toBe(
      '2026-01-01',
    )
    expect((await drawsOn(store).completeRebuild(project.id, { date: '2026-12-31' })).date).toBe(
      '2026-12-31',
    )
  })

  it('refuses a day outside the window, naming the window, and writes nothing', async () => {
    const project = await laidOut()
    for (const date of ['2025-12-31', '2027-01-01']) {
      await expect(drawsOn(store).completeRebuild(project.id, { date })).rejects.toThrow(
        'the feed covers 2026-01-01 to 2026-12-31',
      )
    }
    expect((await store.get(project.id)).date).toBe('2026-09-15')
  })

  it('refuses a malformed day', async () => {
    const project = await laidOut()
    for (const date of ['2026-02-30', 'Saturday', '']) {
      await expect(drawsOn(store).completeRebuild(project.id, { date })).rejects.toThrow()
    }
  })

  it('refuses a project without a layout, or without a window', async () => {
    const fresh = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await expect(drawsOn(store).completeRebuild(fresh.id, { date: '2026-09-12' })).rejects.toThrow(
      'lay the project out first',
    )
    // A record from before the window was stored: a layout and a day, no window.
    await seed(A, record(A, { layout: LAYOUT, date: '2026-09-02' }))
    await expect(drawsOn(store).completeRebuild(A, { date: '2026-09-12' })).rejects.toThrow(
      /lay the project out again/,
    )
  })

  it('refuses a read-only project', async () => {
    const project = await laidOut()
    const file = join(home, 'projects', project.id, 'project.json')
    const current = await store.get(project.id)
    await writeFile(file, JSON.stringify({ ...current, version: 99 }), 'utf8')
    await expect(
      drawsOn(store).completeRebuild(project.id, { date: '2026-09-12' }),
    ).rejects.toThrow('read-only')
  })
})

// The day a person chose, written the moment it is chosen and drawing
// nothing (A5.5-15). The one writer of `date` that leaves `drawn` alone,
// which is what makes cell 03's staleness reachable at all
// (specs/028-the-notebook/contracts/run-graph.md).
describe('setDate', () => {
  const LAYOUT = 'a'.repeat(64)
  const OTHER = 'b'.repeat(64)

  async function laidOut(): Promise<ProjectRecord> {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await drawsOn(store).completeLayout(project.id, {
      date: '2026-09-15',
      layout: LAYOUT,
      service: WINDOW,
      made: MADE,
      built: BUILT,
    })
    return project
  }

  it('writes the day and the time, and every other field is the one it read', async () => {
    const project = await laidOut()
    const before = await store.get(project.id)
    const after = await store.setDate(project.id, '2026-09-12')
    expect(after.date).toBe('2026-09-12')
    // Field by field against what was there, so "nothing else" is checked
    // rather than asserted about the three fields that came to mind.
    expect(after.revision, 'a write, counted').toBe((before.revision ?? 0) + 1)
    expect({
      ...after,
      date: before.date,
      modified: before.modified,
      revision: before.revision,
    }).toEqual({
      ...before,
      readOnly: undefined,
    })
    expect(await store.get(project.id), 'and it is on disk').toEqual({
      ...after,
      readOnly: false,
    })
  })

  it('moves the modification time', async () => {
    // Against a record whose time is years old, not against one written in
    // the same millisecond: `modified >= before` is satisfied by a write
    // that never touched it, which is no assertion at all.
    await seed(
      A,
      record(A, {
        layout: LAYOUT,
        date: '2026-09-15',
        service: WINDOW,
        modified: '2020-01-01T00:00:00.000Z',
      }),
    )
    const after = await store.setDate(A, '2026-09-12')
    expect(after.modified > '2024-01-01T00:00:00.000Z').toBe(true)
  })

  it('leaves `drawn` exactly where it was, so the map is known to be behind', async () => {
    const project = await laidOut()
    const drawn = (await store.get(project.id)).drawn
    const after = await store.setDate(project.id, '2026-09-12')
    expect(after.drawn, 'only a draw may move it').toEqual(drawn)
    expect(after.drawn?.date, 'the day the map was drawn for').toBe('2026-09-15')
    expect(after.date, 'against the day it is set to').toBe('2026-09-12')
  })

  it('and the rebuild that follows closes the gap', async () => {
    const project = await laidOut()
    await store.setDate(project.id, '2026-09-12')
    const after = await drawsOn(store).completeRebuild(project.id, { date: '2026-09-12' })
    expect(after.drawn?.date).toBe('2026-09-12')
    expect(after.date).toBe('2026-09-12')
  })

  it("accepts the window's first and last day", async () => {
    const project = await laidOut()
    expect((await store.setDate(project.id, '2026-01-01')).date).toBe('2026-01-01')
    expect((await store.setDate(project.id, '2026-12-31')).date).toBe('2026-12-31')
  })

  it('refuses a day outside the window, naming the window, and writes nothing', async () => {
    const project = await laidOut()
    for (const date of ['2025-12-31', '2027-01-01']) {
      await expect(store.setDate(project.id, date)).rejects.toThrow(
        'the feed covers 2026-01-01 to 2026-12-31',
      )
    }
    const after = await store.get(project.id)
    expect(after.date, 'the day a person can still see is the day stored').toBe('2026-09-15')
    expect(after.drawn?.date).toBe('2026-09-15')
  })

  it('refuses a malformed day', async () => {
    const project = await laidOut()
    for (const date of ['2026-02-30', 'Saturday', '', '2026-9-2']) {
      await expect(store.setDate(project.id, date)).rejects.toThrow()
    }
    expect((await store.get(project.id)).date).toBe('2026-09-15')
  })

  it('refuses a project without a layout, or without a window', async () => {
    const fresh = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await expect(store.setDate(fresh.id, '2026-09-12')).rejects.toThrow('lay the project out first')
    // A record from before the window was stored: a layout and a day, no window.
    await seed(A, record(A, { layout: LAYOUT, date: '2026-09-02' }))
    await expect(store.setDate(A, '2026-09-12')).rejects.toThrow(/lay the project out again/)
  })

  it('refuses a read-only project', async () => {
    const project = await laidOut()
    const file = join(home, 'projects', project.id, 'project.json')
    const current = await store.get(project.id)
    await writeFile(file, JSON.stringify({ ...current, version: 99 }), 'utf8')
    await expect(store.setDate(project.id, '2026-09-12')).rejects.toThrow('read-only')
  })

  it('writes nothing for the day the project is already set to', async () => {
    const project = await laidOut()
    const before = await readRecord(project.id)
    const after = await store.setDate(project.id, '2026-09-15')
    expect(after.date).toBe('2026-09-15')
    expect(await readRecord(project.id), 'not even the time moved').toEqual(before)
  })

  it('takes a day on a record written before `drawn` existed, and invents no `drawn`', async () => {
    // A record from v0.1.0-rc.4: laid out, with a window, and with no idea
    // what its map was drawn from. Unknown is not stale, so the day is
    // taken and the map is still not claimed to be behind.
    const old: Record<string, unknown> = {
      ...record(A, { layout: OTHER, made: MADE, built: BUILT, date: '2026-09-15' }),
      service: WINDOW,
    }
    delete old.drawn
    await seed(A, old)
    expect((await store.get(A)).drawn).toBeNull()
    const after = await store.setDate(A, '2026-09-12')
    expect(after.date).toBe('2026-09-12')
    expect(after.drawn, 'still unknown, never invented').toBeNull()
    expect(after.layout, 'and the layout is kept').toBe(OTHER)
  })
})

// The two inputs a person chose with the feed in view (A2-02): validated
// with the record's rules, written only when they differ.
describe('setInputs', () => {
  it('writes mode and agency and the time, trims an empty agency to none', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const updated = await store.setInputs(project.id, { mode: 'tram,subway', agency: ' METRO ' })
    expect(updated).toMatchObject({ mode: 'tram,subway', agency: 'METRO' })
    expect(updated.modified >= project.modified).toBe(true)
    expect(await store.get(project.id)).toMatchObject({ mode: 'tram,subway', agency: 'METRO' })
    const none = await store.setInputs(project.id, { mode: 'all', agency: '  ' })
    expect(none.agency).toBeNull()
  })

  it('writes nothing when nothing differs', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const same = await store.setInputs(project.id, { mode: 'all', agency: null })
    expect(same.modified).toBe(project.modified)
  })

  it('refuses a mode or an agency the engine would, and a read-only record', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await expect(store.setInputs(project.id, { mode: 'Zeppelin!', agency: null })).rejects.toThrow(
      /mode/,
    )
    await expect(
      store.setInputs(project.id, { mode: 'all', agency: 'x'.repeat(65) }),
    ).rejects.toThrow(/agency/)
    const file = join(home, 'projects', project.id, 'project.json')
    const current = await store.get(project.id)
    await writeFile(file, JSON.stringify({ ...current, version: 99 }), 'utf8')
    await expect(store.setInputs(project.id, { mode: 'tram', agency: null })).rejects.toThrow(
      'read-only',
    )
  })
})

// The line colours a person chose (A4-01), written once the map has been
// drawn with them, as a chosen day is.
describe('completeColors', () => {
  const LAYOUT = 'a'.repeat(64)

  async function laidOut(): Promise<ProjectRecord> {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await drawsOn(store).completeLayout(project.id, {
      date: '2026-09-15',
      layout: LAYOUT,
      service: WINDOW,
      made: MADE,
      built: BUILT,
    })
    return project
  }

  it('writes the palette and the time, and nothing else', async () => {
    const project = await laidOut()
    const before = await store.get(project.id)
    const after = await drawsOn(store).completeColors(project.id, {
      colors: { A: '#0072bc', 'Rapid 720': '#FFFFFF' },
      defaultColor: '#112233',
    })
    expect(after.colors).toEqual({ A: '#0072bc', 'Rapid 720': '#FFFFFF' })
    expect(after.defaultColor).toBe('#112233')
    expect(after.layout, 'a colour is a render, never a layout').toBe(LAYOUT)
    expect(after.date).toBe(before.date)
    expect(after.service).toEqual(before.service)
    expect(after.modified >= before.modified).toBe(true)
    expect(await store.get(project.id), 'and it is on disk').toEqual({ ...after, readOnly: false })
  })

  it('reads the same palette back on the next open, which is the whole point', async () => {
    const project = await laidOut()
    await drawsOn(store).completeColors(project.id, {
      colors: { A: '#0072bc' },
      defaultColor: '#112233',
    })
    const fresh = new ProjectStore(home, (message) => lines.push(message))
    const reopened = await fresh.get(project.id)
    expect(reopened.colors).toEqual({ A: '#0072bc' })
    expect(reopened.defaultColor).toBe('#112233')
  })

  it('replaces the palette rather than merging it, so a reset really resets', async () => {
    const project = await laidOut()
    await drawsOn(store).completeColors(project.id, {
      colors: { A: '#0072bc', B: '#e3131b' },
      defaultColor: '#112233',
    })
    const reset = await drawsOn(store).completeColors(project.id, {
      colors: {},
      defaultColor: DEFAULT_COLOR,
    })
    expect(reset.colors).toEqual({})
    expect(reset.defaultColor).toBe(DEFAULT_COLOR)
  })

  it('keeps no reference to the palette it was handed', async () => {
    const project = await laidOut()
    const palette = { colors: { A: '#0072bc' }, defaultColor: DEFAULT_COLOR }
    const after = await drawsOn(store).completeColors(project.id, palette)
    palette.colors.A = '#ffffff'
    expect(after.colors.A).toBe('#0072bc')
    expect((await store.get(project.id)).colors.A).toBe('#0072bc')
  })

  it('refuses a colour or a label the record could not hold', async () => {
    const project = await laidOut()
    for (const palette of [
      { colors: {}, defaultColor: 'grey' },
      { colors: { A: '0072bc' }, defaultColor: DEFAULT_COLOR },
      { colors: { '': '#0072bc' }, defaultColor: DEFAULT_COLOR },
      { colors: { ['a'.repeat(65)]: '#0072bc' }, defaultColor: DEFAULT_COLOR },
    ]) {
      await expect(
        drawsOn(store).completeColors(project.id, palette as never),
        JSON.stringify(palette),
      ).rejects.toThrow()
    }
    expect((await store.get(project.id)).colors, 'nothing was written').toEqual({})
  })

  it('refuses a project with no layout: there is nothing to draw the colours on', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await expect(
      drawsOn(store).completeColors(project.id, { colors: {}, defaultColor: '#112233' }),
    ).rejects.toThrow('lay the project out first')
  })

  it('refuses a record a newer version of the app wrote', async () => {
    const project = await laidOut()
    const file = join(home, 'projects', project.id, 'project.json')
    const current = await store.get(project.id)
    await writeFile(file, JSON.stringify({ ...current, version: 99 }), 'utf8')
    await expect(
      drawsOn(store).completeColors(project.id, { colors: {}, defaultColor: '#112233' }),
    ).rejects.toThrow('read-only')
  })
})

// The order a person arranged the lines in (A4-02), written once the map
// has been drawn in it, as the colours are.
describe('completeOrder', () => {
  const LAYOUT = 'a'.repeat(64)

  async function laidOut(): Promise<ProjectRecord> {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await drawsOn(store).completeLayout(project.id, {
      date: '2026-09-15',
      layout: LAYOUT,
      service: WINDOW,
      made: MADE,
      built: BUILT,
    })
    return project
  }

  it('writes the order and the time, and nothing else', async () => {
    const project = await laidOut()
    const before = await store.get(project.id)
    const after = await drawsOn(store).completeOrder(project.id, ['K', 'A'])
    expect(after.lineOrder).toEqual(['K', 'A'])
    expect(after.layout, 'an order is a render, never a layout').toBe(LAYOUT)
    expect(after.date).toBe(before.date)
    expect(after.colors).toEqual(before.colors)
    expect(after.modified >= before.modified).toBe(true)
    expect(await store.get(project.id), 'and it is on disk').toEqual({ ...after, readOnly: false })
  })

  it('reads the same order back on the next open, which is the whole point', async () => {
    const project = await laidOut()
    await drawsOn(store).completeOrder(project.id, ['K', 'A'])
    const fresh = new ProjectStore(home, (message) => lines.push(message))
    expect((await fresh.get(project.id)).lineOrder).toEqual(['K', 'A'])
  })

  it('replaces the order rather than merging it, so the way back really goes back', async () => {
    const project = await laidOut()
    await drawsOn(store).completeOrder(project.id, ['K', 'A'])
    expect((await drawsOn(store).completeOrder(project.id, [])).lineOrder).toEqual([])
  })

  it('keeps no reference to the order it was handed', async () => {
    const project = await laidOut()
    const order = ['K', 'A']
    const after = await drawsOn(store).completeOrder(project.id, order)
    order[0] = 'B'
    expect(after.lineOrder[0]).toBe('K')
    expect((await store.get(project.id)).lineOrder[0]).toBe('K')
  })

  it('refuses a label the record could not hold, and the same line twice', async () => {
    const project = await laidOut()
    for (const order of [
      'A',
      [''],
      ['a'.repeat(65)],
      ['__proto__'],
      ['A', 'A'],
      [1],
      ['A\u0007'],
    ]) {
      await expect(
        drawsOn(store).completeOrder(project.id, order as never),
        JSON.stringify(order),
      ).rejects.toThrow()
    }
    expect((await store.get(project.id)).lineOrder, 'nothing was written').toEqual([])
  })

  it('refuses a project with no layout: there is nothing to draw in that order', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await expect(drawsOn(store).completeOrder(project.id, ['A'])).rejects.toThrow(
      'lay the project out first',
    )
  })

  it('refuses a record a newer version of the app wrote', async () => {
    const project = await laidOut()
    const file = join(home, 'projects', project.id, 'project.json')
    const current = await store.get(project.id)
    await writeFile(file, JSON.stringify({ ...current, version: 99 }), 'utf8')
    await expect(drawsOn(store).completeOrder(project.id, ['A'])).rejects.toThrow('read-only')
  })
})

// The sizes a person chose (issue 350, ADR-049), written once the map has
// been drawn with them, as the colours and the order are.
describe('completeStyle', () => {
  const LAYOUT = 'a'.repeat(64)

  async function laidOut(): Promise<ProjectRecord> {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await drawsOn(store).completeLayout(project.id, {
      date: '2026-09-15',
      layout: LAYOUT,
      service: WINDOW,
      made: MADE,
      built: BUILT,
    })
    return project
  }

  it('writes the style and the time, and nothing else', async () => {
    const project = await laidOut()
    const before = await store.get(project.id)
    expect(before.style, 'a new project has chosen nothing').toEqual({})
    const after = await drawsOn(store).completeStyle(project.id, { lineWidth: 12, labelSize: 20 })
    expect(after.style).toEqual({ lineWidth: 12, labelSize: 20 })
    expect(after.layout, 'a size is a render, never a layout').toBe(LAYOUT)
    expect(after.date).toBe(before.date)
    expect(after.colors).toEqual(before.colors)
    expect(after.lineOrder).toEqual(before.lineOrder)
    expect(after.modified >= before.modified).toBe(true)
    expect(await store.get(project.id), 'and it is on disk').toEqual({ ...after, readOnly: false })
  })

  it('records what the map was drawn with, and keeps the day the map showed', async () => {
    const project = await laidOut()
    await store.setDate(project.id, '2026-09-12')
    const after = await drawsOn(store).completeStyle(project.id, { stationRadius: 5 })
    expect(after.drawn?.style, 'both radii go together').toEqual({
      stationRadius: 5,
      interchangeRadius: 6,
    })
    expect(after.drawn?.date, 'a size is a redraw of the same day').toBe('2026-09-15')
    expect(after.date, 'and the day a person chose is still waiting').toBe('2026-09-12')
  })

  it('replaces the style rather than merging it, so a reset really resets', async () => {
    const project = await laidOut()
    await drawsOn(store).completeStyle(project.id, { lineWidth: 12 })
    const after = await drawsOn(store).completeStyle(project.id, {})
    expect(after.style).toEqual({})
    expect(after.drawn?.style).toEqual({})
  })

  it('keeps nothing at the engine’s own number, which is no choice', async () => {
    const project = await laidOut()
    const after = await drawsOn(store).completeStyle(project.id, { lineWidth: 7, padding: 40 })
    expect(after.style).toEqual({ padding: 40 })
  })

  it('reads the same style back on the next open, which is the whole point', async () => {
    const project = await laidOut()
    await drawsOn(store).completeStyle(project.id, { lineWidth: 12, padding: 0 })
    const fresh = new ProjectStore(home, (message) => lines.push(message))
    expect((await fresh.get(project.id)).style).toEqual({ lineWidth: 12, padding: 0 })
  })

  it('refuses what the engine would, and writes nothing', async () => {
    const project = await laidOut()
    for (const style of [
      { lineWidth: 25 },
      { lineGap: 0.5 },
      { padding: -1 },
      { labelSize: '12' },
      { lineWidth: Infinity },
      // The pair of radii, judged as the engine judges it.
      { stationRadius: 8 },
      { stationRadius: 5, interchangeRadius: 4 },
      // Nothing the engine takes that is not one of the eight.
      { background: '#000000' },
      'big',
      null,
    ]) {
      await expect(
        drawsOn(store).completeStyle(project.id, style as never),
        JSON.stringify(style),
      ).rejects.toThrow()
    }
    expect((await store.get(project.id)).style, 'nothing was written').toEqual({})
  })

  it('says the engine’s sentence for a number out of range', async () => {
    const project = await laidOut()
    await expect(drawsOn(store).completeStyle(project.id, { lineWidth: 30 })).rejects.toThrow(
      "style.line_width must be from 1 to 24, in SVG user units at the map's width",
    )
  })

  // Issue 391 (spec 034, FR-008): the markers, the face and the trains live
  // in the style, under the same writer, the same rules and the same checks.
  it('writes the markers, the face and the trains, and keeps none at the engine’s own', async () => {
    const project = await laidOut()
    const after = await drawsOn(store).completeStyle(project.id, {
      stationShape: 'tick',
      interchangeShape: 'circle',
      labelFont: 'inter',
      dotRadius: 8,
      trail: 0,
    })
    expect(after.style).toEqual({ stationShape: 'tick', labelFont: 'inter', dotRadius: 8 })
    expect(after.drawn?.style).toEqual({ stationShape: 'tick', labelFont: 'inter', dotRadius: 8 })
    const fresh = new ProjectStore(home, (message) => lines.push(message))
    expect((await fresh.get(project.id)).style, 'and reads back').toEqual(after.style)
    expect(after.version, 'without moving the version').toBe(2)
  })

  it('refuses a marker, a face or a train number the engine would, in its sentence', async () => {
    const project = await laidOut()
    await expect(
      drawsOn(store).completeStyle(project.id, { stationShape: 'triangle' } as never),
    ).rejects.toThrow('style.station_shape must be circle, tick or square')
    await expect(
      drawsOn(store).completeStyle(project.id, { interchangeShape: 'tick' } as never),
    ).rejects.toThrow('style.interchange_shape must be circle or square')
    await expect(
      drawsOn(store).completeStyle(project.id, { labelFont: 'comic-sans' } as never),
    ).rejects.toThrow('style.label_font must be system, inter or atkinson-hyperlegible-next')
    await expect(drawsOn(store).completeStyle(project.id, { dotRadius: 1 })).rejects.toThrow(
      "dot_radius must be from 2 to 12, in SVG user units at the map's width",
    )
    await expect(drawsOn(store).completeStyle(project.id, { trail: 4 })).rejects.toThrow(
      'trail must be from 0 to 3, in seconds of playback',
    )
    await expect(
      drawsOn(store).completeStyle(project.id, { preset: 'beck' } as never),
    ).rejects.toThrow('the style does not take preset')
    expect((await store.get(project.id)).style, 'nothing was written').toEqual({})
  })

  it('refuses a project with no layout: there is nothing to draw in those sizes', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await expect(drawsOn(store).completeStyle(project.id, { lineWidth: 12 })).rejects.toThrow(
      'lay the project out first',
    )
  })

  it('refuses a record a newer version of the app wrote', async () => {
    const project = await laidOut()
    const file = join(home, 'projects', project.id, 'project.json')
    const current = await store.get(project.id)
    await writeFile(file, JSON.stringify({ ...current, version: 99 }), 'utf8')
    await expect(drawsOn(store).completeStyle(project.id, { lineWidth: 12 })).rejects.toThrow(
      'read-only',
    )
  })
})

// The theme a project's map is drawn in (A4-03), written the moment it is
// pressed: it is neither a layout nor a render, so there is nothing to wait
// for and no project needs a layout to have one.
describe('setTheme', () => {
  it('writes the theme and the time, and nothing else', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const before = await store.get(project.id)
    expect(before.theme, 'every project starts in the engine’s own default').toBe('warm-dark')
    const after = await store.setTheme(project.id, 'sepia')
    expect(after.theme).toBe('sepia')
    expect(after.colors).toEqual(before.colors)
    expect(after.lineOrder).toEqual(before.lineOrder)
    expect(after.layout, 'a theme is not a build of any kind').toBe(before.layout)
    expect(after.modified >= before.modified).toBe(true)
    expect(await store.get(project.id), 'and it is on disk').toEqual({ ...after, readOnly: false })
  })

  it('needs no layout: there is nothing to draw yet and the theme still holds', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    expect((await store.setTheme(project.id, 'sepia')).layout).toBeNull()
    const fresh = new ProjectStore(home, (message) => lines.push(message))
    expect((await fresh.get(project.id)).theme).toBe('sepia')
  })

  it('refuses a theme the page does not draw', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    for (const theme of ['dark', 'light', 'system', '', 42, null]) {
      await expect(
        store.setTheme(project.id, theme as never),
        JSON.stringify(theme) ?? 'undefined',
      ).rejects.toThrow(/warm-dark or sepia/)
    }
    expect((await store.get(project.id)).theme, 'nothing was written').toBe('warm-dark')
  })

  it('refuses a record a newer version of the app wrote', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const file = join(home, 'projects', project.id, 'project.json')
    const current = await store.get(project.id)
    await writeFile(file, JSON.stringify({ ...current, version: 99 }), 'utf8')
    await expect(store.setTheme(project.id, 'sepia')).rejects.toThrow('read-only')
  })
})

// What a project was last set to export (A5-01), written the moment it is
// chosen, as the theme is, and read back with the reel for a record from
// before the export tab.
describe('setExport', () => {
  const LINKEDIN = {
    preset: 'linkedin-video',
    storyboard: 'day',
    options: { clock: false, at: '07:30', lines: ['A', 'B'], quality: 'draft', tag: 'draft-1' },
  } as const

  it('writes the choice and the time, and nothing else', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const before = await store.get(project.id)
    expect(before.export, 'every project starts on the reel').toEqual({
      preset: 'instagram-reel',
      options: {},
    })
    const after = await store.setExport(project.id, {
      ...LINKEDIN,
      options: { ...LINKEDIN.options, lines: [...LINKEDIN.options.lines] },
    })
    expect(after.export).toEqual(LINKEDIN)
    expect(after.theme).toBe(before.theme)
    expect(after.layout, 'a choice is not a build of any kind').toBe(before.layout)
    expect(after.modified >= before.modified).toBe(true)
    const fresh = new ProjectStore(home, (message) => lines.push(message))
    expect((await fresh.get(project.id)).export, 'and it is on disk').toEqual(LINKEDIN)
  })

  it('refuses a choice the engine would refuse, and writes nothing', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    for (const choice of [
      null,
      { preset: 'portfolio-mp4', options: {} },
      { preset: 'linkedin-video', storyboard: 'nope', options: {} },
      { preset: 'linkedin-video', options: { safe: true } },
      { preset: 'linkedin-video', options: { tag: 'has space' } },
      { preset: 'linkedin-video', options: { at: '7.30' } },
    ]) {
      await expect(
        store.setExport(project.id, choice as never),
        JSON.stringify(choice),
      ).rejects.toThrow()
    }
    expect((await store.get(project.id)).export, 'nothing was written').toEqual({
      preset: 'instagram-reel',
      options: {},
    })
  })

  it('reads a record from before the export tab, or with a broken choice, as the reel', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const file = join(home, 'projects', project.id, 'project.json')
    const current = await store.get(project.id)
    const { export: _dropped, readOnly: _readOnly, ...older } = current
    void _dropped
    void _readOnly
    await writeFile(file, JSON.stringify(older), 'utf8')
    expect((await store.get(project.id)).export).toEqual({ preset: 'instagram-reel', options: {} })
    await writeFile(
      file,
      JSON.stringify({ ...older, export: { preset: 'portfolio-mp4', options: { clock: false } } }),
      'utf8',
    )
    expect((await store.get(project.id)).export).toEqual({ preset: 'instagram-reel', options: {} })
  })

  it('refuses a record a newer version of the app wrote', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const file = join(home, 'projects', project.id, 'project.json')
    const current = await store.get(project.id)
    await writeFile(file, JSON.stringify({ ...current, version: 99 }), 'utf8')
    await expect(store.setExport(project.id, LINKEDIN as never)).rejects.toThrow('read-only')
  })
})

// Where this project's exports go (A5.5-19): a folder the main process's
// own dialog answered, or none, in which case the app's export folder is
// used. It is not part of any plan, so nothing is built for it.
describe('setDestination', () => {
  const MINE = '/videos/legible-cities'

  it('writes the folder and the time, and takes it back again', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const before = await store.get(project.id)
    expect(before.destination, "every project starts on the app's folder").toBeNull()

    const after = await store.setDestination(project.id, MINE)
    expect(after.destination).toBe(MINE)
    expect(after.export, 'a folder is not a choice about the file').toEqual(before.export)
    expect(after.layout, 'nor a build of any kind').toBe(before.layout)
    expect(after.modified >= before.modified).toBe(true)
    const fresh = new ProjectStore(home, (message) => lines.push(message))
    expect((await fresh.get(project.id)).destination, 'and it is on disk').toBe(MINE)

    expect((await store.setDestination(project.id, null)).destination).toBeNull()
  })

  it('refuses anything that is not a folder a dialog answered, and writes nothing', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await store.setDestination(project.id, MINE)
    for (const folder of ['', 'relative/folder', 42, ['/tmp'], undefined])
      await expect(
        store.setDestination(project.id, folder as never),
        JSON.stringify(folder) ?? 'undefined',
      ).rejects.toThrow(/chosen in the app/)
    expect((await store.get(project.id)).destination, 'nothing was written').toBe(MINE)
  })

  it('refuses a record a newer version of the app wrote', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const file = join(home, 'projects', project.id, 'project.json')
    const current = await store.get(project.id)
    await writeFile(file, JSON.stringify({ ...current, version: 99 }), 'utf8')
    await expect(store.setDestination(project.id, MINE)).rejects.toThrow('read-only')
  })
})

// What the page on screen was drawn from (A5.5-04, ADR-045): written by the
// four handlers that already write the record at the end of a draw, and by
// nobody else, so a change the map has not taken up leaves `drawn` behind.
describe('drawn', () => {
  const LAYOUT = 'a'.repeat(64)
  const OTHER = 'b'.repeat(64)

  async function laidOut(): Promise<ProjectRecord> {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await drawsOn(store).completeLayout(project.id, {
      date: '2026-09-15',
      layout: LAYOUT,
      service: WINDOW,
      made: MADE,
      built: BUILT,
    })
    return project
  }

  it('is null on a project that has drawn nothing', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    expect(project.drawn).toBeNull()
    expect(await readRecord(project.id)).toMatchObject({ drawn: null })
  })

  it('is the whole of what the layout run drew', async () => {
    const project = await laidOut()
    const after = await store.get(project.id)
    expect(after.drawn).toEqual({
      layout: LAYOUT,
      made: MADE,
      date: '2026-09-15',
      colors: {},
      defaultColor: DEFAULT_COLOR,
      lineOrder: [],
      theme: DEFAULT_THEME,
      style: {},
    })
  })

  it('takes the new day from a rebuild, and nothing else', async () => {
    const project = await laidOut()
    const after = await drawsOn(store).completeRebuild(project.id, { date: '2026-09-12' })
    expect(after.drawn).toMatchObject({ date: '2026-09-12', layout: LAYOUT, made: MADE })
  })

  it('takes the palette from a recolour and the order from a reorder', async () => {
    const project = await laidOut()
    const colours = await drawsOn(store).completeColors(project.id, {
      colors: { A: '#0072bc' },
      defaultColor: '#112233',
    })
    expect(colours.drawn).toMatchObject({ colors: { A: '#0072bc' }, defaultColor: '#112233' })
    const order = await drawsOn(store).completeOrder(project.id, ['K', 'A'])
    expect(order.drawn).toMatchObject({ lineOrder: ['K', 'A'], colors: { A: '#0072bc' } })
  })

  it('keeps the drawn day through a recolour and a reorder, whatever the record says', async () => {
    // A recolour draws the day the map already showed, so a day chosen and
    // waiting (A5.5-15) must not be closed by dragging a colour - and must
    // never be stamped on a picture that was drawn for another day, which
    // is what a `setDate` landing between the debounce and this write would
    // otherwise do.
    const project = await laidOut()
    await store.setDate(project.id, '2026-09-12')
    const colours = await drawsOn(store).completeColors(project.id, {
      colors: { A: '#0072bc' },
      defaultColor: '#112233',
    })
    expect(colours.date, 'the choice stands').toBe('2026-09-12')
    expect(colours.drawn?.date, 'and the map is still the day it was drawn for').toBe('2026-09-15')
    expect(colours.drawn?.colors, 'while the colours did move').toEqual({ A: '#0072bc' })
    const order = await drawsOn(store).completeOrder(project.id, ['K', 'A'])
    expect(order.drawn?.date).toBe('2026-09-15')
    expect(order.drawn?.lineOrder).toEqual(['K', 'A'])
    // And the rebuild is still the only thing that closes it.
    const rebuilt = await drawsOn(store).completeRebuild(project.id, { date: '2026-09-12' })
    expect(rebuilt.drawn).toMatchObject({
      date: '2026-09-12',
      colors: { A: '#0072bc' },
      lineOrder: ['K', 'A'],
    })
  })

  it("fills a recolour's drawn block on a record that had none", async () => {
    // Nothing to keep: the redraw drew the record's day, which is what
    // `drawnDate` answers for a record with no block.
    const old: Record<string, unknown> = {
      ...record(A, { layout: LAYOUT, made: MADE, built: BUILT, date: '2026-09-15' }),
    }
    delete old.drawn
    await seed(A, old)
    const after = await drawsOn(store).completeColors(A, { colors: {}, defaultColor: '#112233' })
    expect(after.drawn).toMatchObject({ date: '2026-09-15', defaultColor: '#112233' })
  })

  it('stays where it was when nothing was drawn', async () => {
    const project = await laidOut()
    const drawn = (await store.get(project.id)).drawn
    // The inputs, the theme and the export choice are all written without
    // anything being redrawn, which is exactly what a stale cell reports.
    await store.setInputs(project.id, { mode: 'subway', agency: 'LACMTA' })
    await store.setTheme(project.id, 'sepia')
    await store.setExport(project.id, {
      preset: 'linkedin-video',
      storyboard: 'day',
      options: { clock: false },
    } as never)
    await store.rename(project.id, 'Los Angeles')
    const after = await store.get(project.id)
    expect(after.drawn).toEqual(drawn)
    expect(after.mode, 'the record moved, the map did not').toBe('subway')
    expect(after.theme).toBe('sepia')
    expect(after.export.preset).toBe('linkedin-video')
  })

  it('is on disk, so what the map was drawn from survives a relaunch', async () => {
    const project = await laidOut()
    await drawsOn(store).completeRebuild(project.id, { date: '2026-09-12' })
    const fresh = new ProjectStore(home, (message) => lines.push(message))
    expect((await fresh.get(project.id)).drawn).toMatchObject({ date: '2026-09-12' })
  })

  it('fills on the first draw of a record written before the field existed', async () => {
    // A record from v0.1.0-rc.4: laid out, and with no idea what it drew.
    const old: Record<string, unknown> = {
      ...record(A, { layout: OTHER, made: MADE, built: BUILT, date: '2026-09-15' }),
    }
    delete old.drawn
    await seed(A, old)
    const opened = await store.get(A)
    expect(opened.drawn, 'unknown, which is not the same as stale').toBeNull()
    expect(opened.layout, 'and the layout is kept').toBe(OTHER)
    const after = await drawsOn(store).completeLayout(A, {
      date: '2026-09-15',
      layout: LAYOUT,
      service: WINDOW,
      made: MADE,
      built: BUILT,
    })
    expect(after.record.drawn).toMatchObject({ layout: LAYOUT, made: MADE })
  })
})

// Every writer reads the record, changes its field and writes the whole
// record back. Two on one project at once would each put the other's field
// back as it was, so they take turns, per project.
describe('writes to one project take turns', () => {
  const choice = { preset: 'linkedin-video', storyboard: 'day', options: { clock: false } } as const
  const done = {
    date: '2026-09-15',
    layout: 'c'.repeat(64),
    service: {
      start: '2026-01-01',
      end: '2026-12-31',
      busiest: '2026-09-15',
      anchor: '2026-09-08',
    },
    made: '2026-09-10T12:00:00+00:00',
    built: { mode: 'all', agency: null },
  }

  it('keeps both a choice of export and a layout written at the same moment', async () => {
    for (let round = 0; round < 5; round++) {
      const project = await store.create({ name: `LA ${round}`, feed: 'la-metro-rail' })
      const writes =
        round % 2 === 0
          ? [
              store.setExport(project.id, choice as never),
              drawsOn(store).completeLayout(project.id, done),
            ]
          : [
              drawsOn(store).completeLayout(project.id, done),
              store.setExport(project.id, choice as never),
            ]
      await Promise.all(writes)
      const after = await store.get(project.id)
      expect(after.export, `round ${round}`).toEqual(choice)
      expect(after.layout, `round ${round}`).toBe(done.layout)
      expect(after.made, `round ${round}`).toBe(done.made)
      expect(after.built, `round ${round}`).toEqual(done.built)
    }
  })

  it('counts a write that is waiting its turn, so the reset sees it', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const first = store.setTheme(project.id, 'sepia')
    const second = store.setExport(project.id, choice as never)
    expect(store.writing, 'one writing and one waiting behind it').toBe(2)
    await Promise.all([first, second])
    expect(store.writing).toBe(0)
  })

  it('refuses a write queued behind a delete, and writes nothing', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const removed = store.delete(project.id)
    const late = store.setExport(project.id, choice as never)
    await expect(removed).resolves.toMatchObject({ failed: [] })
    await expect(late).rejects.toThrow('not found')
    await expect(stat(join(root, project.id)), 'no folder was made again').rejects.toThrow()
    expect(store.writing).toBe(0)
  })

  it('keeps every field when every writer lands at once, and a failure does not stop the next', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    // Every write sent at once, each with what its draw would have sent: the
    // layout run's, and the redraws of the map it draws.
    const drawn = { layout: done.layout, made: done.made, date: done.date }
    const palette = { colors: { A: '#0072bc' }, defaultColor: '#112233' }
    const results = await Promise.allSettled([
      store.completeLayout(project.id, { ...done, sent: sentOf({}, drawn) }),
      store.setTheme(project.id, 'sepia'),
      store.setExport(project.id, { preset: 'portfolio-svg', options: {} } as never),
      store.completeColors(project.id, palette, sentOf({}, { ...drawn, ...palette })),
      store.completeOrder(
        project.id,
        ['K', 'A'],
        sentOf({}, { ...drawn, ...palette, lineOrder: ['K', 'A'] }),
      ),
      store.setExport(project.id, choice as never),
      store.rename(project.id, 'Los Angeles'),
      store.setInputs(project.id, { mode: 'subway', agency: null }),
    ])
    expect(results.map((r) => r.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'rejected',
      'fulfilled',
      'fulfilled',
      'fulfilled',
      'fulfilled',
      'fulfilled',
    ])
    expect(await store.get(project.id)).toMatchObject({
      name: 'Los Angeles',
      mode: 'subway',
      theme: 'sepia',
      layout: done.layout,
      colors: { A: '#0072bc' },
      defaultColor: '#112233',
      lineOrder: ['K', 'A'],
      export: choice,
    })
  })
})

// Both folders are under the engine's home, so the settings screen asks
// before it removes that home's contents: a record being renamed into place
// is a write the reset must not walk through (A1-04).
describe('writes in flight', () => {
  it('counts nothing when the store is idle', () => {
    expect(store.writing).toBe(0)
  })

  it('counts a create from the folder it makes to the record it writes', async () => {
    const during: number[] = []
    const creating = store.create({ name: 'Los Angeles', feed: 'la-metro-rail' })
    during.push(store.writing)
    await creating
    expect(during[0], 'counted while it was happening').toBeGreaterThan(0)
    expect(store.writing, 'and released when it finished').toBe(0)
  })

  it('counts a rename, and releases it even when the write fails', async () => {
    const project = await store.create({ name: 'Los Angeles', feed: 'la-metro-rail' })
    const renaming = store.rename(project.id, 'LA Metro')
    expect(store.writing).toBeGreaterThan(0)
    await renaming
    expect(store.writing).toBe(0)

    await rm(join(root, project.id), { recursive: true, force: true })
    await expect(store.rename(project.id, 'Gone')).rejects.toThrow()
    expect(store.writing, 'a failure releases the count too').toBe(0)
  })

  it('counts a delete', async () => {
    const project = await store.create({ name: 'Los Angeles', feed: 'la-metro-rail' })
    const deleting = store.delete(project.id)
    expect(store.writing).toBeGreaterThan(0)
    await deleting
    expect(store.writing).toBe(0)
  })
})

// On Windows a rename over project.json is refused while another handle has
// it open - a scanner looking at the record just renamed into place, or a
// preview reading it. That is the suspected, unproven cause of issue 93, and
// the retry is a defence against it. The refusal and the Windows codes are
// given here through the store's seam, so this runs on every platform.
describe('a record the platform holds', () => {
  const choice = { preset: 'linkedin-video', storyboard: 'day', options: {} } as const

  /** A store whose renames of project.json are refused while `held()` answers a code. */
  function heldStore(held: () => string | null, wait: Wait = async () => undefined) {
    let renames = 0
    const rename_: Rename = async (from, to) => {
      renames += 1
      const code = held()
      if (code !== null) throw Object.assign(new Error(`${code}: held, rename '${to}'`), { code })
      await rename(from, to)
    }
    const held_ = new ProjectStore(home, (message) => lines.push(message), {
      rename: rename_,
      wait,
      codes: WINDOWS_RETRY_CODES,
    })
    return { store: held_, renames: () => renames }
  }

  const leftovers = async (id: string): Promise<string[]> =>
    (await readdir(join(root, id))).filter((name) => name !== 'project.json')

  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    it(`writes the choice once the record is let go (${code}), and says it waited`, async () => {
      const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
      let refusals = 3
      const waits: number[] = []
      const held = heldStore(
        () => (refusals-- > 0 ? code : null),
        async (ms) => void waits.push(ms),
      )
      const after = await held.store.setExport(project.id, choice as never)
      expect(after.export).toEqual(choice)
      expect(held.renames()).toBe(4)
      expect(waits, 'within the bound').toEqual(RENAME_RETRY_DELAYS_MS.slice(0, 3))
      expect((await store.get(project.id)).export, 'and it is on disk').toEqual(choice)
      expect(await leftovers(project.id), 'no temporary file is left').toEqual([])
      expect(lines).toContain(`projects/${project.id}: saved after 4 attempts (${code})`)
      expect(held.store.writing).toBe(0)
    })
  }

  it('lands on the last attempt the bound allows', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    let refusals = RENAME_RETRY_DELAYS_MS.length
    const held = heldStore(() => (refusals-- > 0 ? 'EPERM' : null))
    await held.store.setInputs(project.id, { mode: 'subway', agency: 'SUB' })
    expect(await store.get(project.id)).toMatchObject({ mode: 'subway', agency: 'SUB' })
    expect(held.renames()).toBe(RENAME_RETRY_DELAYS_MS.length + 1)
  })

  it('gives up after the bound: the previous record stays, the temporary file goes, and the log says why', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const waits: number[] = []
    const held = heldStore(
      () => 'EPERM',
      async (ms) => void waits.push(ms),
    )
    const failure = await held.store
      .setExport(project.id, choice as never)
      .catch((error: Error) => error)
    expect((failure as Error).message, 'no path in what the screen shows').toBe(
      'the project could not be saved',
    )
    expect(held.renames()).toBe(RENAME_RETRY_DELAYS_MS.length + 1)
    expect(waits).toEqual([...RENAME_RETRY_DELAYS_MS])
    expect((await store.get(project.id)).export, 'the earlier record is whole').toEqual({
      preset: 'instagram-reel',
      options: {},
    })
    expect(await leftovers(project.id)).toEqual([])
    expect(lines).toContain(`projects/${project.id}: write failed (EPERM, 8 attempts)`)
    expect(held.store.writing, 'the count is released').toBe(0)
  })

  it('says the attempts, removes the temporary file and keeps the record when a wait fails', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const held = heldStore(
      () => 'EBUSY',
      async () => {
        throw new Error('the wait was cut short')
      },
    )
    await expect(held.store.setTheme(project.id, 'sepia')).rejects.toThrow(
      'the project could not be saved',
    )
    expect(held.renames()).toBe(1)
    expect(lines).toContain(`projects/${project.id}: write failed (EBUSY, 1 attempt)`)
    expect(await leftovers(project.id)).toEqual([])
    expect((await store.get(project.id)).theme).toBe(DEFAULT_THEME)
    expect(held.store.writing).toBe(0)
  })

  it('does not wait for a failure other than a held file', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    for (const code of ['ENOENT', 'EXDEV', 'ENOSPC']) {
      const waits: number[] = []
      const held = heldStore(
        () => code,
        async (ms) => void waits.push(ms),
      )
      await expect(held.store.setTheme(project.id, 'sepia')).rejects.toThrow(
        'the project could not be saved',
      )
      expect(held.renames(), code).toBe(1)
      expect(waits, code).toEqual([])
      expect(await leftovers(project.id)).toEqual([])
      expect(lines).toContain(`projects/${project.id}: write failed (${code}, 1 attempt)`)
    }
  })

  it.skipIf(process.platform === 'win32')(
    'does not try a failed write of the temporary file again, and never reaches the rename',
    async () => {
      const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
      const held = heldStore(() => null)
      // A read-and-execute-only folder: the record can be read, and no
      // temporary file can be made beside it.
      await chmod(join(root, project.id), 0o500)
      try {
        await expect(held.store.setTheme(project.id, 'sepia')).rejects.toThrow(
          'the project could not be saved',
        )
      } finally {
        await chmod(join(root, project.id), 0o700)
      }
      expect(held.renames()).toBe(0)
      expect(lines).toContain(`projects/${project.id}: write failed (EACCES)`)
    },
  )

  it('answers a read made while the rename waits with the previous record, whole', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    let refusals = 2
    const seen: { export: unknown; tmp: string[]; listed: number }[] = []
    const held: ReturnType<typeof heldStore> = heldStore(
      () => (refusals-- > 0 ? 'EBUSY' : null),
      async () => {
        // Mid-write: the new record is on disk under its temporary name. Read
        // by another store over the same home, since this store's own read
        // waits behind its writes (spec 037, FR-006) and would wait for this
        // one: what is held here is the file, read whole while it is renamed.
        const reading = await store.get(project.id)
        const listed = await store.list()
        seen.push({
          export: reading.export,
          tmp: (await leftovers(project.id)).filter((name) => name.endsWith('.tmp')),
          listed: listed.length,
        })
      },
    )
    await held.store.setExport(project.id, choice as never)
    expect(seen).toHaveLength(2)
    for (const reading of seen) {
      expect(reading.tmp, 'the write was part-way through').toHaveLength(1)
      expect(reading.export, 'the reader saw the record before it').toEqual({
        preset: 'instagram-reel',
        options: {},
      })
      expect(reading.listed, 'and the list still has the project').toBe(1)
    }
    expect((await store.get(project.id)).export).toEqual(choice)
  })
})

describe('a flush that fails (issue 432)', () => {
  it('fails the save, keeps the old record and leaves no temporary file', async () => {
    const created = await store.create({ name: 'Kept', feed: 'la-metro-rail' })
    const failing = new ProjectStore(home, (m) => lines.push(m), {
      // The temporary file is made and written; only its flush fails.
      open: (async (path: string, flags: string) => {
        const handle = await open(path, flags)
        handle.sync = async () => {
          throw Object.assign(new Error('EIO: i/o error, fsync'), { code: 'EIO' })
        }
        return handle
      }) as never,
    })
    await expect(failing.rename(created.id, 'Changed')).rejects.toThrow(
      /project could not be saved/,
    )
    const folder = await readdir(join(root, created.id))
    expect(folder).toEqual(['project.json'])
    expect((await store.get(created.id))?.name).toBe('Kept')
    expect(lines.some((l) => l.includes('write failed (EIO)'))).toBe(true)
  })
})

describe('a folder that cannot be flushed after the rename (issue 432)', () => {
  it('is a saved record, not a failed save, and the log has the code only', async () => {
    const created = await store.create({ name: 'Kept', feed: 'la-metro-rail' })
    const flaky = new ProjectStore(home, (m) => lines.push(m), {
      platform: 'linux',
      open: (async (path: string, flags: string) => {
        if (flags === 'r')
          throw Object.assign(new Error("EMFILE: too many open files, open '/private/place'"), {
            code: 'EMFILE',
          })
        return open(path, flags)
      }) as never,
    })
    await flaky.rename(created.id, 'Changed')
    expect((await store.get(created.id))?.name).toBe('Changed')
    expect(await readdir(join(root, created.id))).toEqual(['project.json'])
    const said = lines.filter((l) => l.includes('could not be flushed'))
    expect(said).toHaveLength(1)
    expect(said[0]).toContain('EMFILE')
    expect(said[0]).not.toContain('/private')
    expect(lines.some((l) => l.includes('write failed'))).toBe(false)
  })
})

// The record session (spec 037, part 1): a read waits behind the writes
// already queued for its project, so a run that reads its inputs after the
// press sees every write sent before it; and every write raises the record's
// revision by one.
describe('the record session', () => {
  /** A store whose renames of project.json wait until `open()` is called. */
  function gatedStore() {
    let open!: () => void
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    let waiting = 0
    const gated = new ProjectStore(home, (message) => lines.push(message), {
      rename: async (from, to) => {
        waiting += 1
        await gate
        await rename(from, to)
      },
    })
    return { store: gated, open: () => open(), waiting: () => waiting }
  }

  it('answers a read sent after a write with the write, however long the write takes', async () => {
    // Mutation: `get` outside the queue again - the read answers from the
    // file before the held rename lands, with the theme it had.
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const gated = gatedStore()
    const write = gated.store.setTheme(project.id, 'sepia')
    const read = gated.store.get(project.id)
    let answered = false
    void read.then(() => {
      answered = true
    })
    await expect.poll(() => gated.waiting(), { timeout: 5_000 }).toBe(1)
    // The write is held at its rename; the read has had every chance to
    // answer from the file, and has not.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(answered, 'the read waits behind the write').toBe(false)
    gated.open()
    await write
    expect((await read).theme, 'and answers with it').toBe('sepia')
  })

  /** Every writer of a record, each with a write a read after it must see. */
  const WRITERS: {
    name: string
    write: (s: ProjectStore, record: ProjectRecord) => Promise<unknown>
    sees: (record: ProjectRecord) => unknown
    is: unknown
  }[] = [
    {
      name: 'setInputs',
      write: (s, r) => s.setInputs(r.id, { agency: 'METRO' }),
      sees: (r) => r.agency,
      is: 'METRO',
    },
    {
      name: 'setTuning',
      write: (s, r) => s.setTuning(r.id, { gridSize: 150 }),
      sees: (r) => r.tuning,
      is: { gridSize: 150 },
    },
    {
      name: 'setDate',
      write: (s, r) => s.setDate(r.id, '2026-09-12'),
      sees: (r) => r.date,
      is: '2026-09-12',
    },
    {
      name: 'completeLayout',
      write: (s, r) =>
        s.completeLayout(r.id, {
          date: '2026-09-15',
          layout: 'b'.repeat(64),
          service: WINDOW,
          made: LATER,
          built: BUILT,
          sent: sentOf(r, { layout: 'b'.repeat(64), made: LATER, date: '2026-09-15' }),
        }),
      sees: (r) => r.layout,
      is: 'b'.repeat(64),
    },
    {
      name: 'completeRebuild',
      write: (s, r) => s.completeRebuild(r.id, { sent: sentOf(r, { date: '2026-09-12' }) }),
      sees: (r) => r.drawn?.date,
      is: '2026-09-12',
    },
    {
      name: 'completeColors',
      write: (s, r) => {
        const palette = { colors: { A: '#0072bc' }, defaultColor: '#888888' }
        return s.completeColors(r.id, palette, sentOf(r, { date: '2026-09-15', ...palette }))
      },
      sees: (r) => r.colors,
      is: { A: '#0072bc' },
    },
    {
      name: 'completeOrder',
      write: (s, r) =>
        s.completeOrder(r.id, ['K', 'A'], sentOf(r, { date: '2026-09-15', lineOrder: ['K', 'A'] })),
      sees: (r) => r.lineOrder,
      is: ['K', 'A'],
    },
    {
      name: 'completeStyle',
      write: (s, r) =>
        s.completeStyle(
          r.id,
          { lineWidth: 12 },
          sentOf(r, { date: '2026-09-15', style: { lineWidth: 12 } }),
        ),
      sees: (r) => r.style,
      is: { lineWidth: 12 },
    },
    {
      name: 'completeLines',
      write: (s, r) =>
        s.completeLines(
          r.id,
          { A: { hidden: true } },
          sentOf(r, { date: '2026-09-15', lines: { A: { hidden: true } } }),
        ),
      sees: (r) => r.lines,
      is: { A: { hidden: true } },
    },
    {
      name: 'setTheme',
      write: (s, r) => s.setTheme(r.id, 'sepia'),
      sees: (r) => r.theme,
      is: 'sepia',
    },
    {
      name: 'setExport',
      write: (s, r) => s.setExport(r.id, { preset: 'bluesky', options: {} } as never),
      sees: (r) => r.export.preset,
      is: 'bluesky',
    },
    {
      name: 'rename',
      write: (s, r) => s.rename(r.id, 'Renamed'),
      sees: (r) => r.name,
      is: 'Renamed',
    },
    {
      name: 'markOpened',
      write: (s, r) => s.markOpened(r.id),
      sees: (r) => r.opened !== null,
      is: true,
    },
    {
      name: 'setDestination',
      write: (s, r) => s.setDestination(r.id, '/videos/legible-cities'),
      sees: (r) => r.destination,
      is: '/videos/legible-cities',
    },
  ]

  it.each(WRITERS)(
    '$name: a read sent the moment after it waits for it, however long it takes',
    async ({ write, sees, is }) => {
      // Mutation: an `await` before `#serial` in this writer (`await
      // Promise.resolve()` at the top of the public method) - the read sent
      // after it reaches the queue first, and answers without the write.
      const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
      await drawsOn(store).completeLayout(project.id, {
        date: '2026-09-15',
        layout: 'a'.repeat(64),
        service: WINDOW,
        made: MADE,
        built: BUILT,
      })
      const before = await store.get(project.id)
      const gated = gatedStore()
      const written = write(gated.store, before)
      const read = gated.store.get(project.id)
      let answered = false
      void read.then(() => {
        answered = true
      })
      await expect.poll(() => gated.waiting(), { timeout: 5_000 }).toBe(1)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(answered, 'the read waits behind the write').toBe(false)
      gated.open()
      await written
      expect(sees(await read), 'and answers with it').toEqual(is)
    },
  )

  it('does not hold a read of another project behind this one’s write', async () => {
    const one = await store.create({ name: 'One', feed: 'la-metro-rail' })
    const two = await store.create({ name: 'Two', feed: 'la-metro-rail' })
    const gated = gatedStore()
    const write = gated.store.setTheme(one.id, 'sepia')
    await expect.poll(() => gated.waiting(), { timeout: 5_000 }).toBe(1)
    expect((await gated.store.get(two.id)).name).toBe('Two')
    gated.open()
    await write
  })

  it('answers writes and reads in the order they were asked, each with every write before it', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const answered: number[] = []
    const asks = [
      store.rename(project.id, 'One'),
      store.get(project.id),
      store.setTheme(project.id, 'sepia'),
      store.get(project.id),
      store.rename(project.id, 'Two'),
      store.get(project.id),
    ].map((ask, i) => ask.then((record) => (answered.push(i), record)))
    const records = await Promise.all(asks)
    expect(answered).toEqual([0, 1, 2, 3, 4, 5])
    expect(records.map((r) => [r.name, r.theme])).toEqual([
      ['One', 'warm-dark'],
      ['One', 'warm-dark'],
      ['One', 'sepia'],
      ['One', 'sepia'],
      ['Two', 'sepia'],
      ['Two', 'sepia'],
    ])
  })

  it('raises the revision by one on every write, and a read raises nothing', async () => {
    // Mutation: `#save` writes the record's own revision back - every write
    // after the first then answers and stores 1.
    const created = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    expect(created.revision, 'a new record is its first write').toBe(1)
    const renamed = await store.rename(created.id, 'Los Angeles')
    expect(renamed.revision).toBe(2)
    const themed = await store.setTheme(created.id, 'sepia')
    expect(themed.revision).toBe(3)
    const opened = await store.markOpened(created.id)
    expect(opened.revision, 'an opening is a write too').toBe(4)
    expect((await store.get(created.id)).revision, 'a read raises nothing').toBe(4)
    expect((await readRecord(created.id)).revision, 'and the file says so').toBe(4)
    // A write that changes nothing writes nothing, and counts nothing.
    expect((await store.setInputs(created.id, { mode: 'all', agency: null })).revision).toBe(4)
  })

  it('reads a record without one, or with one that is not a count, as 0, and its first write makes it 1', async () => {
    // Mutation: `isRevision` takes any number - the record holding 1.5 then
    // answers 2.5.
    await seed(A, record(A))
    expect((await store.get(A)).revision, 'absent is absent').toBeUndefined()
    expect((await store.rename(A, 'First')).revision).toBe(1)
    for (const bad of [-1, 1.5, '7', null, Number.MAX_SAFE_INTEGER + 2]) {
      await seed(A, { ...record(A), revision: bad })
      expect((await store.get(A)).revision, JSON.stringify(bad)).toBeUndefined()
      expect((await store.rename(A, 'Again')).revision, JSON.stringify(bad)).toBe(1)
    }
    await seed(A, { ...record(A), revision: 41 })
    expect((await store.rename(A, 'Later')).revision, 'raised from what was stored').toBe(42)
  })
})

// User Story 1's matrix (spec 037, SC-001): every kind of run, with every
// field a run sends - and the others a person can write - written while it
// goes, between the run's read of the record and its completion. `drawn` is
// what the run sent, field by field, in every case, and the record keeps the
// write. Run all is a layout or a rebuild at the store, so it is those two.
describe('what a map was drawn from, with a write landing while it was drawn', () => {
  const LAYOUT = 'a'.repeat(64)
  const RELAID = 'b'.repeat(64)
  const RELAID_AT = '2026-10-01T00:00:00+00:00'
  const STARTED = { ...BUILT }
  /** A project laid out once, its map drawn for the 15th from the record as it stood. */
  async function laidOut(): Promise<string> {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await drawsOn(store).completeLayout(project.id, {
      date: '2026-09-15',
      layout: LAYOUT,
      service: WINDOW,
      made: MADE,
      built: STARTED,
    })
    return project.id
  }

  /** Each kind of run: what it sends from the record it read, and its completion. */
  const RUNS: {
    kind: string
    sends: (read: ProjectRecord) => SentSet
    complete: (id: string, sent: SentSet) => Promise<unknown>
  }[] = [
    {
      kind: 'layout',
      sends: (read) => sentOf(read, { layout: RELAID, made: RELAID_AT, date: read.date ?? '' }),
      complete: (id, sent) =>
        store.completeLayout(id, {
          date: sent.date,
          layout: sent.layout,
          made: sent.made as string,
          built: STARTED,
          service: WINDOW,
          sent,
        }),
    },
    {
      kind: 'rebuild',
      sends: (read) => sentOf(read, { date: '2026-09-12' }),
      complete: (id, sent) => store.completeRebuild(id, { sent }),
    },
    {
      kind: 'colours',
      sends: (read) =>
        sentOf(read, {
          date: drawnDate(read) ?? '',
          colors: { A: '#0072bc' },
          defaultColor: '#123456',
        }),
      complete: (id, sent) =>
        store.completeColors(id, { colors: sent.colors, defaultColor: sent.defaultColor }, sent),
    },
    {
      kind: 'order',
      sends: (read) => sentOf(read, { date: drawnDate(read) ?? '', lineOrder: ['K', 'A'] }),
      complete: (id, sent) => store.completeOrder(id, sent.lineOrder, sent),
    },
    {
      kind: 'sizes',
      sends: (read) => sentOf(read, { date: drawnDate(read) ?? '', style: { lineWidth: 12 } }),
      complete: (id, sent) => store.completeStyle(id, sent.style, sent),
    },
    {
      kind: 'options',
      sends: (read) =>
        sentOf(read, { date: drawnDate(read) ?? '', lines: { A: { name: 'Airport' } } }),
      complete: (id, sent) => store.completeLines(id, sent.lines ?? {}, sent),
    },
  ]

  /** Each write that can land while a run goes, and what the record then holds of it. */
  const WRITES: {
    field: string
    write: (id: string) => Promise<unknown>
    holds: (record: ProjectRecord) => unknown
    /** What the field holds after a run of this kind completes, where its completion writes it too. */
    after?: Record<string, (sent: SentSet) => unknown>
  }[] = [
    {
      field: 'the day',
      write: (id) => store.setDate(id, '2026-09-20'),
      holds: (r) => r.date,
      // A rebuild writes the day it drew, as it always has.
      after: { rebuild: (sent) => sent.date },
    },
    {
      field: 'the colours',
      write: (id) =>
        drawsOn(store).completeColors(id, { colors: { K: '#ff0000' }, defaultColor: '#654321' }),
      holds: (r) => r.colors,
      after: { colours: (sent) => sent.colors },
    },
    {
      field: 'the order',
      write: (id) => drawsOn(store).completeOrder(id, ['B']),
      holds: (r) => r.lineOrder,
      after: { order: (sent) => sent.lineOrder },
    },
    {
      field: 'the sizes',
      write: (id) => drawsOn(store).completeStyle(id, { lineWidth: 9 }),
      holds: (r) => r.style,
      after: { sizes: (sent) => sent.style },
    },
    {
      field: 'the line options',
      write: (id) => drawsOn(store).completeLines(id, { B: { hidden: true } }),
      holds: (r) => r.lines,
      after: { options: (sent) => sent.lines },
    },
    { field: 'the theme', write: (id) => store.setTheme(id, 'sepia'), holds: (r) => r.theme },
    {
      field: 'the tuning',
      write: (id) => store.setTuning(id, { gridSize: 150 }),
      holds: (r) => r.tuning,
    },
    {
      field: 'the inputs',
      write: (id) => store.setInputs(id, { mode: 'subway', agency: null }),
      holds: (r) => r.mode,
    },
    { field: 'the name', write: (id) => store.rename(id, 'Renamed'), holds: (r) => r.name },
    {
      field: 'the export',
      write: (id) => store.setExport(id, { preset: 'bluesky', options: {} } as never),
      holds: (r) => r.export.preset,
    },
  ]

  const SENT_FIELDS = [
    'layout',
    'made',
    'date',
    'colors',
    'defaultColor',
    'lineOrder',
    'style',
    'lines',
  ] as const

  for (const run of RUNS)
    for (const landed of WRITES)
      it(`${run.kind}, with ${landed.field} written while it drew`, async () => {
        // Mutation: `drew` makes `drawn` from the record about to be written
        // (`drawnOf(record)`, the old `drawnFrom`) - the day, the colours, the
        // order, the sizes and the options written meanwhile then show up in
        // `drawn` as if the map carried them.
        const id = await laidOut()
        const read = await store.get(id)
        const sent = run.sends(read)
        await landed.write(id)
        const between = landed.holds(await store.get(id))
        await run.complete(id, sent)
        const after = await store.get(id)
        const drawn = after.drawn
        expect(drawn, 'the map was drawn').not.toBeNull()
        for (const field of SENT_FIELDS)
          expect(drawn?.[field], `drawn.${field} is what the run sent`).toEqual(sent[field])
        expect(drawn?.theme, 'the theme the page was told').toBe(after.theme)
        const own = landed.after?.[run.kind]
        expect(landed.holds(after), `the record keeps ${landed.field}`).toEqual(
          own === undefined ? between : own(sent),
        )
      })

  it('R3-02: a day chosen while a layout runs is the record’s, and the map says it was not drawn for it', async () => {
    // The review's probe. Mutation: `completeLayout` writes `drawn.date` from
    // the record's day again (`record.date ?? done.date`) - the 20th is then
    // recorded as drawn, and cell 03 has nothing to say.
    const id = await laidOut()
    const read = await store.get(id)
    const sent = RUNS[0].sends(read)
    expect(sent.date, 'the run draws the day the record had').toBe('2026-09-15')
    await store.setDate(id, '2026-09-20')
    await RUNS[0].complete(id, sent)
    const after = await store.get(id)
    expect(after.date, 'the chosen day').toBe('2026-09-20')
    expect(after.drawn?.date, 'the day the map was drawn for').toBe('2026-09-15')
  })
})

// The store is the trusted layer and has callers of its own: what the bridge
// read of a sent set is read again here, as every other field is.
describe('a sent set the store refuses', () => {
  it('refuses each completion handed one it could not keep, and writes nothing', async () => {
    // Mutation: `check(validateSent(...))` taken out of one completion - its
    // row writes a `drawn` with a colour the record could never hold.
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await drawsOn(store).completeLayout(project.id, {
      date: '2026-09-15',
      layout: 'a'.repeat(64),
      service: WINDOW,
      made: MADE,
      built: BUILT,
    })
    const before = await readFile(join(root, project.id, 'project.json'), 'utf8')
    const good = sentOf(await store.get(project.id))
    const bad = { ...good, colors: { A: 'red' } }
    const palette = { colors: {}, defaultColor: '#888888' }
    const refusals = [
      store.completeLayout(project.id, {
        date: '2026-09-15',
        layout: 'a'.repeat(64),
        service: WINDOW,
        made: MADE,
        built: BUILT,
        sent: bad,
      }),
      store.completeRebuild(project.id, { sent: bad }),
      store.completeColors(project.id, palette, bad),
      store.completeOrder(project.id, [], bad),
      store.completeStyle(project.id, {}, bad),
      store.completeLines(project.id, {}, bad),
    ]
    for (const [i, refusal] of refusals.entries())
      await expect(refusal, String(i)).rejects.toThrow('must be written #rrggbb')
    // And a layout run whose set is of another draw than the run says it made.
    // Mutation: the check after `validateSent` in `completeLayout` taken out -
    // `drawn` names a layout, a time or a day the record does not.
    for (const other of [
      { layout: 'b'.repeat(64) },
      { made: '2026-10-01T00:00:00+00:00' },
      { date: '2026-09-16' },
    ])
      await expect(
        store.completeLayout(project.id, {
          date: '2026-09-15',
          layout: 'a'.repeat(64),
          service: WINDOW,
          made: MADE,
          built: BUILT,
          sent: { ...good, ...other },
        }),
        JSON.stringify(other),
      ).rejects.toThrow('the layout run did not say which layout it drew from')
    expect(await readFile(join(root, project.id, 'project.json'), 'utf8')).toBe(before)
  })
})

// A write is a patch of the fields it names (spec 037, FR-005): the inputs'
// writer takes the mode, the operator or both, and leaves the other as the
// writes before it left it, so an operator chosen a moment after a mode
// cannot put the old mode back (issue 407).
describe('the inputs, one of the two at a time', () => {
  it('writes the operator alone onto the mode the write before it left', async () => {
    // Mutation: `setInputs` taking the record's mode only when the patch has
    // none and the agency the same way (`?? record.mode` replaced by the
    // patch's own field) - the mode is lost, or the operator is.
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const mode = store.setInputs(project.id, { mode: 'subway', agency: null })
    const operator = store.setInputs(project.id, { agency: 'METRO' })
    await mode
    expect(await operator).toMatchObject({ mode: 'subway', agency: 'METRO' })
    expect(await store.setInputs(project.id, { mode: 'tram' })).toMatchObject({
      mode: 'tram',
      agency: 'METRO',
    })
    expect(await store.setInputs(project.id, { agency: null })).toMatchObject({
      mode: 'tram',
      agency: null,
    })
  })

  it('refuses a write that names neither, and each field by its own rule', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await expect(store.setInputs(project.id, {})).rejects.toThrow()
    await expect(store.setInputs(project.id, { mode: 'Rail!' })).rejects.toThrow()
    await expect(store.setInputs(project.id, { agency: 'x'.repeat(500) })).rejects.toThrow()
    expect(await store.get(project.id)).toMatchObject({ mode: 'all', agency: null })
  })
})

// What a rebuild or a redraw sent is held to the record it is written onto
// (spec 037): the stored layout and when it was made, the day the map
// already shows, and the redraw's own choice. A renderer, the less trusted
// process, could otherwise make `drawn` name a layout the record does not
// hold, a day the map was never drawn for, or a choice the map does not
// carry - and the export plans from `drawnDate`.
describe('a sent set that is not a draw of this record', () => {
  const LAYOUT = 'a'.repeat(64)
  const OTHER = 'b'.repeat(64)
  const palette = { colors: { A: '#0072bc' }, defaultColor: '#112233' }

  async function drawnFor15(): Promise<ProjectRecord> {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await drawsOn(store).completeLayout(project.id, {
      date: '2026-09-15',
      layout: LAYOUT,
      service: WINDOW,
      made: MADE,
      built: BUILT,
    })
    return store.get(project.id)
  }

  /** The four redraws, each with its own choice, as a run of the record would send it. */
  const REDRAWS: {
    name: string
    write: (id: string, sent: SentSet) => Promise<unknown>
    own: Partial<SentSet>
    otherwise: Partial<SentSet>
    sentence: string
  }[] = [
    {
      name: 'completeColors',
      write: (id, sent) => store.completeColors(id, palette, sent),
      own: palette,
      otherwise: { colors: { A: '#ff0000' } },
      sentence: 'the colours written are not the ones the map was drawn in',
    },
    {
      name: 'completeOrder',
      write: (id, sent) => store.completeOrder(id, ['K', 'A'], sent),
      own: { lineOrder: ['K', 'A'] },
      otherwise: { lineOrder: ['A', 'K'] },
      sentence: 'the order written is not the one the map was drawn in',
    },
    {
      name: 'completeStyle',
      write: (id, sent) => store.completeStyle(id, { lineWidth: 12 }, sent),
      own: { style: { lineWidth: 12 } },
      otherwise: { style: { lineWidth: 11 } },
      sentence: 'the sizes written are not the ones the map was drawn with',
    },
    {
      name: 'completeLines',
      write: (id, sent) => store.completeLines(id, { A: { hidden: true } }, sent),
      own: { lines: { A: { hidden: true } } },
      otherwise: { lines: { B: { hidden: true } } },
      sentence: 'the line options written are not the ones the map was drawn with',
    },
  ]

  for (const redraw of REDRAWS)
    it(`${redraw.name}: refuses another layout, another made, another day, or a choice it did not draw`, async () => {
      // Mutation: `check(redrawRefusal(...))` taken out of this writer, or
      // its choice's check - the row's refusal then writes a `drawn` that
      // says what the map does not carry.
      const record = await drawnFor15()
      const good = { ...sentOf(record, { date: '2026-09-15' }), ...redraw.own }
      const before = await readRecord(record.id)
      const rows: [Partial<SentSet>, string][] = [
        [{ layout: OTHER }, 'the map was drawn from another layout than the project holds'],
        [{ made: LATER }, 'the map was drawn from another layout than the project holds'],
        [{ made: null }, 'the map was drawn from another layout than the project holds'],
        [{ date: '2026-09-16' }, 'the map was redrawn for another day than it shows'],
        [redraw.otherwise, redraw.sentence],
        ...(redraw.name === 'completeColors'
          ? ([[{ defaultColor: '#000000' }, redraw.sentence]] as [Partial<SentSet>, string][])
          : []),
      ]
      for (const [change, sentence] of rows)
        await expect(
          redraw.write(record.id, { ...good, ...change }),
          JSON.stringify(change),
        ).rejects.toThrow(sentence)
      expect(await readRecord(record.id), 'nothing written').toEqual(before)
      // And the set a run of this record would send is taken.
      await expect(redraw.write(record.id, good)).resolves.toMatchObject({
        drawn: { layout: LAYOUT, made: MADE, date: '2026-09-15' },
      })
    })

  it('a redraw of a record with no drawn block draws the record’s own day, and no other', async () => {
    // Mutation: the day's check in `redrawRefusal` taken out - a redraw of an
    // old record writes any day it is sent as the day the map shows.
    const old: Record<string, unknown> = {
      ...record(A, { layout: LAYOUT, made: MADE, built: BUILT, date: '2026-09-15' }),
    }
    delete old.drawn
    await seed(A, old)
    const read = await store.get(A)
    await expect(
      store.completeColors(A, palette, { ...sentOf(read, { date: '2026-09-16' }), ...palette }),
    ).rejects.toThrow('the map was redrawn for another day than it shows')
    await expect(
      store.completeColors(A, palette, { ...sentOf(read), ...palette }),
    ).resolves.toMatchObject({ drawn: { date: '2026-09-15' } })
  })

  it('completeRebuild: refuses another layout or another made, and takes the day it drew', async () => {
    // Mutation: `check(layoutRefusal(...))` taken out of `completeRebuild` -
    // the rebuild's `drawn` names a layout the record does not hold.
    const record = await drawnFor15()
    const before = await readRecord(record.id)
    for (const change of [{ layout: OTHER }, { made: LATER }])
      await expect(
        store.completeRebuild(record.id, {
          sent: { ...sentOf(record, { date: '2026-09-12' }), ...change },
        }),
        JSON.stringify(change),
      ).rejects.toThrow('the map was drawn from another layout than the project holds')
    expect(await readRecord(record.id)).toEqual(before)
    await expect(
      store.completeRebuild(record.id, { sent: sentOf(record, { date: '2026-09-12' }) }),
    ).resolves.toMatchObject({ date: '2026-09-12', drawn: { date: '2026-09-12' } })
  })
})
