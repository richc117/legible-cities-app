// The store against a temporary engine home: nothing here touches the
// developer's own data, and every root is removed afterwards.

import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isValidProjectId } from '../../src/main/paths'
import { newId, ProjectStore } from '../../src/main/projects'
import {
  DEFAULT_COLOR,
  DEFAULT_STYLE,
  DEFAULT_THEME,
  ID_PATTERN,
  type ProjectRecord,
} from '../../src/shared/project'

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
    version: 1,
    id,
    name: 'Seed',
    feed: 'la-metro-rail',
    mode: 'all',
    agency: null,
    date: null,
    style: { ...DEFAULT_STYLE },
    colors: {},
    defaultColor: DEFAULT_COLOR,
    lineOrder: [],
    theme: DEFAULT_THEME,
    layout: null,
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
      version: 1,
      id: created.id,
      name: 'Los Angeles',
      feed: 'la-metro-rail',
      mode: 'all',
      agency: null,
      date: null,
      style: { lineWidth: 10, stationRadius: 8, interchangeRadius: 11, labelSize: 26 },
      colors: {},
      defaultColor: '#888888',
      lineOrder: [],
      theme: 'warm-dark',
      layout: null,
      created: created.created,
      modified: created.modified,
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
      'name is required',
    )
    await expect(store.create({ name: 'x'.repeat(121), feed: 'la-metro-rail' })).rejects.toThrow(
      'name is too long',
    )
    await expect(store.create({ name: 'LA', feed: 'LA Metro' })).rejects.toThrow(
      'feed key must be lowercase letters, digits and hyphens',
    )
    await expect(store.create({ name: 'LA', feed: 'la', mode: 'Rail' })).rejects.toThrow(
      'mode must be a short lowercase word',
    )
    await expect(store.create({ name: 'LA', feed: 'la', agency: 'x'.repeat(121) })).rejects.toThrow(
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
    await seed(A, record(A, { name: 'Older', modified: '2026-09-01T00:00:00.000Z' }))
    await seed(B, record(B, { name: 'Newer', modified: '2026-09-02T00:00:00.000Z' }))
    await mkdir(join(root, 'cccccccccccc')) // a folder with no record
    await seed('dddddddddddd', '{ "version": 1, ') // invalid JSON
    await seed('eeeeeeeeeeee', { version: 1, name: 'No id', feed: 'x' })
    await seed('ffffffffffff', record(A)) // a record copied under another folder
    await writeFile(join(root, '.DS_Store'), '') // a stray file is not a folder

    const summaries = await store.list()
    expect(summaries).toEqual([
      {
        id: B,
        name: 'Newer',
        feed: 'la-metro-rail',
        date: null,
        modified: '2026-09-02T00:00:00.000Z',
        readOnly: false,
      },
      {
        id: A,
        name: 'Older',
        feed: 'la-metro-rail',
        date: null,
        modified: '2026-09-01T00:00:00.000Z',
        readOnly: false,
      },
    ])
    expect(lines.sort()).toEqual([
      'projects/cccccccccccc: no record',
      'projects/dddddddddddd: invalid JSON',
      'projects/eeeeeeeeeeee: missing or invalid id',
      'projects/ffffffffffff: record id does not match its folder',
    ])
  })
  it('marks a record from a later version read-only', async () => {
    await seed(A, record(A, { version: 2 }))
    expect((await store.list())[0]).toMatchObject({ id: A, readOnly: true })
  })
})

describe('get', () => {
  it('returns the record with readOnly false, or true for a later version', async () => {
    await seed(A, record(A, { name: 'Current' }))
    await seed(B, record(B, { name: 'Future', version: 2 }))
    expect(await store.get(A)).toEqual({ ...record(A, { name: 'Current' }), readOnly: false })
    const future = await store.get(B)
    expect(future.readOnly).toBe(true)
    expect(future.version).toBe(2)
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
    // The same keys in the same order, and every other value untouched.
    expect(Object.keys(after)).toEqual(Object.keys(before))
    const rest = (r: Record<string, unknown>): Record<string, unknown> => {
      const copy = { ...r }
      delete copy.name
      delete copy.modified
      return copy
    }
    expect(rest(after)).toEqual(rest(before))
    expect(returned).toEqual(after)
    expect(await readdir(join(root, A))).toEqual(['project.json'])
  })
  it('refuses a record from a later version and leaves it as it was', async () => {
    await seed(A, record(A, { version: 2, name: 'Future' }))
    const before = await readFile(join(root, A, 'project.json'), 'utf8')
    await expect(store.rename(A, 'Renamed')).rejects.toThrow(/^read-only$/)
    expect(await readFile(join(root, A, 'project.json'), 'utf8')).toBe(before)
  })
  it('validates the name and the identifier', async () => {
    await seed(A, record(A))
    await expect(store.rename(A, '   ')).rejects.toThrow(/^name is required$/)
    await expect(store.rename(A, 'x'.repeat(121))).rejects.toThrow(/^name is too long/)
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
