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
    service: null,
    style: { ...DEFAULT_STYLE },
    colors: {},
    defaultColor: DEFAULT_COLOR,
    lineOrder: [],
    theme: DEFAULT_THEME,
    export: { preset: 'instagram-reel', options: {} },
    layout: null,
    made: null,
    built: null,
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
      service: null,
      style: { lineWidth: 10, stationRadius: 8, interchangeRadius: 11, labelSize: 26 },
      colors: {},
      defaultColor: '#888888',
      lineOrder: [],
      theme: 'warm-dark',
      export: { preset: 'instagram-reel', options: {} },
      layout: null,
      made: null,
      built: null,
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
    const { record, changed } = await store.completeLayout(project.id, {
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
    await store.completeLayout(project.id, {
      date: '2026-09-02',
      layout: LAYOUT,
      service: WINDOW,
      made: MADE,
      built: BUILT,
    })
    const second = await store.completeLayout(project.id, {
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
    const { record } = await store.completeLayout(project.id, {
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
    const first = await store.completeLayout(project.id, done(MADE))
    expect(first.relaid, 'nothing to differ from').toBe(false)
    const same = await store.completeLayout(project.id, done(MADE))
    expect(same.relaid, 'the same set').toBe(false)
    const later = await store.completeLayout(project.id, done(LATER))
    expect(later).toMatchObject({ changed: false, relaid: true })
    expect(later.record.made).toBe(LATER)
    // A different id says more than a different time.
    const other = await store.completeLayout(project.id, { ...done(MADE), layout: OTHER })
    expect(other).toMatchObject({ changed: true, relaid: false })
  })

  it('treats a record from before, without made, as unchanged on its first run', async () => {
    await seed(A, record(A, { layout: LAYOUT, date: '2026-09-02' }))
    const run = await store.completeLayout(A, {
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
    const first = await store.completeLayout(project.id, {
      date: '2026-09-02',
      layout: LAYOUT,
      service: WINDOW,
      made: MADE,
      built: BUILT,
    })
    expect(first.changed).toBe(false)
    const same = await store.completeLayout(project.id, {
      date: '2026-09-02',
      layout: LAYOUT,
      service: WINDOW,
      made: MADE,
      built: BUILT,
    })
    expect(same.changed, 'the same id is the same layout').toBe(false)
    const second = await store.completeLayout(project.id, {
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
    await store.completeLayout(project.id, {
      date: '2026-09-02',
      layout: LAYOUT,
      service: WINDOW,
      made: MADE,
      built: BUILT,
    })
    const fresh = { ...WINDOW, end: '2027-06-30', busiest: '2026-09-22', anchor: '2026-09-20' }
    const second = await store.completeLayout(project.id, {
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
        store.completeLayout(project.id, done as never),
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
      store.completeLayout(project.id, {
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
    await store.completeLayout(project.id, {
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
    const after = await store.completeRebuild(project.id, { date: '2026-09-12' })
    expect(after.date).toBe('2026-09-12')
    expect(after.layout).toBe(LAYOUT)
    expect(after.service).toEqual(WINDOW)
    expect(after.modified >= before.modified).toBe(true)
    expect(await store.get(project.id)).toEqual({ ...after, readOnly: false })
  })

  it("accepts the window's first and last day", async () => {
    const project = await laidOut()
    expect((await store.completeRebuild(project.id, { date: '2026-01-01' })).date).toBe(
      '2026-01-01',
    )
    expect((await store.completeRebuild(project.id, { date: '2026-12-31' })).date).toBe(
      '2026-12-31',
    )
  })

  it('refuses a day outside the window, naming the window, and writes nothing', async () => {
    const project = await laidOut()
    for (const date of ['2025-12-31', '2027-01-01']) {
      await expect(store.completeRebuild(project.id, { date })).rejects.toThrow(
        'the feed covers 2026-01-01 to 2026-12-31',
      )
    }
    expect((await store.get(project.id)).date).toBe('2026-09-15')
  })

  it('refuses a malformed day', async () => {
    const project = await laidOut()
    for (const date of ['2026-02-30', 'Saturday', '']) {
      await expect(store.completeRebuild(project.id, { date })).rejects.toThrow()
    }
  })

  it('refuses a project without a layout, or without a window', async () => {
    const fresh = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await expect(store.completeRebuild(fresh.id, { date: '2026-09-12' })).rejects.toThrow(
      'lay the project out first',
    )
    // A record from before the window was stored: a layout and a day, no window.
    await seed(A, record(A, { layout: LAYOUT, date: '2026-09-02' }))
    await expect(store.completeRebuild(A, { date: '2026-09-12' })).rejects.toThrow(
      /lay the project out again/,
    )
  })

  it('refuses a read-only project', async () => {
    const project = await laidOut()
    const file = join(home, 'projects', project.id, 'project.json')
    const current = await store.get(project.id)
    await writeFile(file, JSON.stringify({ ...current, version: 99 }), 'utf8')
    await expect(store.completeRebuild(project.id, { date: '2026-09-12' })).rejects.toThrow(
      'read-only',
    )
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
    await store.completeLayout(project.id, {
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
    const after = await store.completeColors(project.id, {
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
    await store.completeColors(project.id, { colors: { A: '#0072bc' }, defaultColor: '#112233' })
    const fresh = new ProjectStore(home, (message) => lines.push(message))
    const reopened = await fresh.get(project.id)
    expect(reopened.colors).toEqual({ A: '#0072bc' })
    expect(reopened.defaultColor).toBe('#112233')
  })

  it('replaces the palette rather than merging it, so a reset really resets', async () => {
    const project = await laidOut()
    await store.completeColors(project.id, {
      colors: { A: '#0072bc', B: '#e3131b' },
      defaultColor: '#112233',
    })
    const reset = await store.completeColors(project.id, {
      colors: {},
      defaultColor: DEFAULT_COLOR,
    })
    expect(reset.colors).toEqual({})
    expect(reset.defaultColor).toBe(DEFAULT_COLOR)
  })

  it('keeps no reference to the palette it was handed', async () => {
    const project = await laidOut()
    const palette = { colors: { A: '#0072bc' }, defaultColor: DEFAULT_COLOR }
    const after = await store.completeColors(project.id, palette)
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
        store.completeColors(project.id, palette as never),
        JSON.stringify(palette),
      ).rejects.toThrow()
    }
    expect((await store.get(project.id)).colors, 'nothing was written').toEqual({})
  })

  it('refuses a project with no layout: there is nothing to draw the colours on', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await expect(
      store.completeColors(project.id, { colors: {}, defaultColor: '#112233' }),
    ).rejects.toThrow('lay the project out first')
  })

  it('refuses a record a newer version of the app wrote', async () => {
    const project = await laidOut()
    const file = join(home, 'projects', project.id, 'project.json')
    const current = await store.get(project.id)
    await writeFile(file, JSON.stringify({ ...current, version: 99 }), 'utf8')
    await expect(
      store.completeColors(project.id, { colors: {}, defaultColor: '#112233' }),
    ).rejects.toThrow('read-only')
  })
})

// The order a person arranged the lines in (A4-02), written once the map
// has been drawn in it, as the colours are.
describe('completeOrder', () => {
  const LAYOUT = 'a'.repeat(64)

  async function laidOut(): Promise<ProjectRecord> {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await store.completeLayout(project.id, {
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
    const after = await store.completeOrder(project.id, ['K', 'A'])
    expect(after.lineOrder).toEqual(['K', 'A'])
    expect(after.layout, 'an order is a render, never a layout').toBe(LAYOUT)
    expect(after.date).toBe(before.date)
    expect(after.colors).toEqual(before.colors)
    expect(after.modified >= before.modified).toBe(true)
    expect(await store.get(project.id), 'and it is on disk').toEqual({ ...after, readOnly: false })
  })

  it('reads the same order back on the next open, which is the whole point', async () => {
    const project = await laidOut()
    await store.completeOrder(project.id, ['K', 'A'])
    const fresh = new ProjectStore(home, (message) => lines.push(message))
    expect((await fresh.get(project.id)).lineOrder).toEqual(['K', 'A'])
  })

  it('replaces the order rather than merging it, so the way back really goes back', async () => {
    const project = await laidOut()
    await store.completeOrder(project.id, ['K', 'A'])
    expect((await store.completeOrder(project.id, [])).lineOrder).toEqual([])
  })

  it('keeps no reference to the order it was handed', async () => {
    const project = await laidOut()
    const order = ['K', 'A']
    const after = await store.completeOrder(project.id, order)
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
        store.completeOrder(project.id, order as never),
        JSON.stringify(order),
      ).rejects.toThrow()
    }
    expect((await store.get(project.id)).lineOrder, 'nothing was written').toEqual([])
  })

  it('refuses a project with no layout: there is nothing to draw in that order', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await expect(store.completeOrder(project.id, ['A'])).rejects.toThrow(
      'lay the project out first',
    )
  })

  it('refuses a record a newer version of the app wrote', async () => {
    const project = await laidOut()
    const file = join(home, 'projects', project.id, 'project.json')
    const current = await store.get(project.id)
    await writeFile(file, JSON.stringify({ ...current, version: 99 }), 'utf8')
    await expect(store.completeOrder(project.id, ['A'])).rejects.toThrow('read-only')
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
          ? [store.setExport(project.id, choice as never), store.completeLayout(project.id, done)]
          : [store.completeLayout(project.id, done), store.setExport(project.id, choice as never)]
      await Promise.all(writes)
      const after = await store.get(project.id)
      expect(after.export, `round ${round}`).toEqual(choice)
      expect(after.layout, `round ${round}`).toBe(done.layout)
      expect(after.made, `round ${round}`).toBe(done.made)
      expect(after.built, `round ${round}`).toEqual(done.built)
    }
  })

  it('keeps every field when every writer lands at once, and a failure does not stop the next', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const results = await Promise.allSettled([
      store.completeLayout(project.id, done),
      store.setTheme(project.id, 'sepia'),
      store.setExport(project.id, { preset: 'portfolio-svg', options: {} } as never),
      store.completeColors(project.id, { colors: { A: '#0072bc' }, defaultColor: '#112233' }),
      store.completeOrder(project.id, ['K', 'A']),
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
