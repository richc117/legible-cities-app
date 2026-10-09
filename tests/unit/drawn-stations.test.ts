// The stations a map was drawn with, kept in the record's `drawn` (issue
// 272, spec 030 FR-004): cell 03's Trip section offers `map.build`'s own
// list and nothing the app derives, and a project opened again shows its map
// from the stored files without a build, so the list has to outlive the
// build that answered it.
//
// What is held here: a layout run and a rebuild write the list their build
// answered; a recolour, a reorder and a resize keep it, because they draw
// the same stations from the same layout; a map drawn from another layout,
// or the same id laid out again, does not inherit a list that was not its
// own; an older record has none; a list that does not read whole is no list
// and leaves the rest of the block alone; the bridge drops a list it cannot
// read rather than failing the run; and the front door's summaries carry
// none.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerProjectHandlers } from '../../src/main/ipc'
import { LayoutRun, type RunClient } from '../../src/renderer/src/engine/layoutRun'
import type { EngineState } from '../../src/shared/engine'
import { ProjectStore } from '../../src/main/projects'
import { CHANNELS } from '../../src/shared/api'
import {
  drawnFrom,
  parseRecord,
  summarise,
  withStations,
  type ProjectRecord,
} from '../../src/shared/project'
import type { Station } from '../../src/shared/trip'

const WINDOW = {
  start: '2026-01-01',
  end: '2026-12-31',
  busiest: '2026-09-15',
  anchor: '2026-09-08',
}
const MADE = '2026-09-10T12:00:00+00:00'
const LATER = '2026-09-11T08:30:00+00:00'
const BUILT = { mode: 'all', agency: null }
const LAYOUT = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

/** The stand-in engine's three, as its `map.build` lists them: by name, then by id. */
const STATIONS: Station[] = [
  { id: '0x6000036f4a40', name: 'Alpha' },
  { id: '0x6000036f4c80', name: 'Bravo' },
  { id: '0x6000036f4010', name: 'Charlie' },
]
/** What a layout that dropped Bravo lists. */
const WITHOUT_BRAVO: Station[] = [STATIONS[0], STATIONS[2]]

let home: string
let store: ProjectStore

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'legible-cities-stations-'))
  store = new ProjectStore(home, () => undefined)
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

const done = (overrides: Record<string, unknown> = {}) => ({
  date: '2026-09-02',
  layout: LAYOUT,
  service: WINDOW,
  made: MADE,
  built: BUILT,
  ...overrides,
})

/** A project laid out once, its map drawn with the three stations. */
async function laidOut(): Promise<string> {
  const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
  await store.completeLayout(project.id, done({ stations: STATIONS }))
  return project.id
}

const onDisk = async (id: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(join(home, 'projects', id, 'project.json'), 'utf8'))

describe('the record keeps the stations its map was drawn with', () => {
  it('writes the list a layout run answered into drawn, and reads it back', async () => {
    const id = await laidOut()
    expect((await store.get(id)).drawn?.stations).toEqual(STATIONS)
    const raw = await onDisk(id)
    expect((raw.drawn as { stations: unknown }).stations).toEqual(STATIONS)
    // A trip is view state: nothing of one is ever in the record (FR-001).
    expect(JSON.stringify(raw)).not.toMatch(/"trip"/)
  })

  it('keeps the list through a recolour, a reorder and a resize, which draw the same stations', async () => {
    const id = await laidOut()
    await store.completeColors(id, { colors: { A: '#0072bc' }, defaultColor: '#888888' })
    expect((await store.get(id)).drawn?.stations, 'after a recolour').toEqual(STATIONS)
    await store.completeOrder(id, ['A'])
    expect((await store.get(id)).drawn?.stations, 'after a reorder').toEqual(STATIONS)
    await store.completeStyle(id, { lineWidth: 9 })
    expect((await store.get(id)).drawn?.stations, 'after a resize').toEqual(STATIONS)
  })

  it('writes the list a rebuild answered, and keeps the one it had when it answered none', async () => {
    const id = await laidOut()
    await store.completeRebuild(id, { date: '2026-09-12' })
    expect((await store.get(id)).drawn?.stations, 'none answered').toEqual(STATIONS)
    await store.completeRebuild(id, { date: '2026-09-13', stations: WITHOUT_BRAVO })
    expect((await store.get(id)).drawn?.stations, 'the build’s own').toEqual(WITHOUT_BRAVO)
  })

  it('replaces the list when a layout run draws a new one, and drops one that is not its own', async () => {
    const id = await laidOut()
    // A run that replaced the layout writes the list its build answered.
    const replaced = await store.completeLayout(
      id,
      done({ layout: OTHER, stations: WITHOUT_BRAVO }),
    )
    expect(replaced.record.drawn?.stations).toEqual(WITHOUT_BRAVO)
    // One whose build answered none the bridge would take keeps nothing from
    // another layout: the map it drew may not draw those stations.
    const unread = await store.completeLayout(id, done({ layout: LAYOUT }))
    expect(unread.record.drawn?.stations).toBeUndefined()
    // Nor from the same id laid out again since.
    await store.completeLayout(id, done({ stations: STATIONS }))
    const relaid = await store.completeLayout(id, done({ made: LATER }))
    expect(relaid.record.drawn?.stations).toBeUndefined()
    // The same set drawn again, and answered nothing, keeps its own list.
    await store.completeLayout(id, done({ made: LATER, stations: STATIONS }))
    const again = await store.completeLayout(id, done({ made: LATER }))
    expect(again.record.drawn?.stations).toEqual(STATIONS)
  })

  it('reads a record drawn before the list was kept as having none, and its block as it was', async () => {
    const id = await laidOut()
    const raw = await onDisk(id)
    const drawn = { ...(raw.drawn as Record<string, unknown>) }
    delete drawn.stations
    await writeFile(join(home, 'projects', id, 'project.json'), JSON.stringify({ ...raw, drawn }))
    const read = await store.get(id)
    expect(read.drawn).not.toBeNull()
    expect(read.drawn?.layout).toBe(LAYOUT)
    expect(read.drawn?.stations).toBeUndefined()
  })

  it('reads a list that is not whole as none, and leaves the rest of the block alone', async () => {
    const id = await laidOut()
    const raw = await onDisk(id)
    for (const stations of [
      'Alpha',
      [{ id: 'a' }],
      [
        { id: 'a', name: 'One' },
        { id: 'a', name: 'Two' },
      ],
    ]) {
      const parsed = parseRecord({ ...raw, drawn: { ...(raw.drawn as object), stations } })
      if ('error' in parsed) throw new Error(parsed.error)
      expect(parsed.record.drawn, JSON.stringify(stations)).not.toBeNull()
      expect(parsed.record.drawn?.stations, JSON.stringify(stations)).toBeUndefined()
    }
  })

  it('lists projects without their stations', async () => {
    const id = await laidOut()
    const [summary] = await store.list()
    expect(summary.id).toBe(id)
    expect(summary.drawn).not.toBeNull()
    expect(summary.drawn).not.toHaveProperty('stations')
    const record = await store.get(id)
    expect(summarise(record, false).drawn).not.toHaveProperty('stations')
    // And a block that has none is handed on as it is.
    const bare = { ...record, drawn: drawnFrom({ ...record, drawn: null }) }
    expect(summarise(bare, false).drawn).toEqual(bare.drawn)
  })
})

describe('drawnFrom and withStations, the two halves of a draw’s block', () => {
  const base = (drawn: ProjectRecord['drawn'], overrides: Partial<ProjectRecord> = {}) =>
    ({
      layout: LAYOUT,
      made: MADE,
      date: '2026-09-02',
      colors: {},
      defaultColor: '#888888',
      lineOrder: [],
      theme: 'warm-dark',
      style: {},
      drawn,
      ...overrides,
    }) as unknown as ProjectRecord

  it('carries the last list only for the layout it was listed for', () => {
    const before = withStations(drawnFrom(base(null)), STATIONS)
    expect(drawnFrom(base(before))?.stations).toEqual(STATIONS)
    expect(drawnFrom(base(before, { layout: OTHER }))?.stations).toBeUndefined()
    expect(drawnFrom(base(before, { made: LATER }))?.stations).toBeUndefined()
    expect(drawnFrom(base(null))).not.toHaveProperty('stations')
  })

  it('puts a build’s list in, over whatever was carried, and leaves no block alone', () => {
    const carried = withStations(drawnFrom(base(null)), STATIONS)
    expect(withStations(carried, WITHOUT_BRAVO)?.stations).toEqual(WITHOUT_BRAVO)
    expect(withStations(carried, undefined)).toBe(carried)
    expect(withStations(null, STATIONS)).toBeNull()
  })
})

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

describe('the bridge', () => {
  function harness() {
    const handlers = new Map<string, Handler>()
    const ipc = {
      handle: (channel: string, h: Handler) => handlers.set(channel, h),
    } as unknown as IpcMain
    const calls: { method: string; args: unknown[] }[] = []
    const fake = new Proxy({} as ProjectStore, {
      get:
        (_t, method: string) =>
        async (...args: unknown[]) => {
          calls.push({ method, args })
          return { ok: method }
        },
    })
    registerProjectHandlers(
      ipc,
      fake,
      () => true,
      () => null,
    )
    const call = (channel: string, ...args: unknown[]) =>
      handlers.get(channel)!({} as IpcMainInvokeEvent, ...args)
    return { call, calls }
  }

  it('passes a whole list on with a finished run and a finished rebuild', async () => {
    const { call, calls } = harness()
    await call(CHANNELS.projectsCompleteLayout, 'abcdefghijk1', done({ stations: STATIONS }))
    await call(CHANNELS.projectsCompleteRebuild, 'abcdefghijk1', {
      date: '2026-09-12',
      stations: STATIONS,
    })
    expect((calls[0].args[1] as { stations: unknown }).stations).toEqual(STATIONS)
    expect(calls[1].args[1]).toEqual({ date: '2026-09-12', stations: STATIONS })
  })

  it('drops a list it cannot read, and still writes the run', async () => {
    const { call, calls } = harness()
    for (const stations of [
      'Alpha',
      [{ id: 7, name: 'Seven' }],
      [{ id: 'a', name: 'A', extra: 1 }],
    ]) {
      await call(CHANNELS.projectsCompleteLayout, 'abcdefghijk1', done({ stations }))
    }
    // The last is whole once its extra field is left behind: an entry is
    // read as its id and its name, as a palette is read as its two fields.
    expect(calls.map((c) => (c.args[1] as { stations?: unknown }).stations)).toEqual([
      undefined,
      undefined,
      [{ id: 'a', name: 'A' }],
    ])
    expect(calls.every((c) => c.method === 'completeLayout')).toBe(true)
  })
})

describe('the layout run hands the record its build’s stations', () => {
  const MAP = (stations: unknown) => ({
    layout: LAYOUT,
    date: '2026-09-15',
    files: {},
    stations,
    summary: '',
    diagnostics: null,
    caveats: [],
    issues: 0,
  })

  /** A client whose every request answers at once, `map.build` with the stations given. */
  function client(stations: unknown): RunClient {
    const answers: Record<string, unknown> = {
      'graph.build': {
        layout: LAYOUT,
        paths: {},
        meta: { made: MADE, mode: 'all', agency: null },
        stages: { octi: { lines: ['A'] } },
      },
      'feeds.service': {
        start: '2026-01-01',
        end: '2026-12-31',
        busiest_weekday: '2026-09-15',
        anchor: '2026-09-08',
      },
      'map.build': MAP(stations),
    }
    return {
      request: (method: string) =>
        ({
          result: Promise.resolve(answers[method]),
          onProgress: () => () => undefined,
          onLog: () => () => undefined,
          cancel: () => undefined,
        }) as never,
    } as RunClient
  }

  const project = {
    id: 'abcdefghijk1',
    feed: 'la-metro-rail',
    mode: 'all',
    agency: null,
    date: '2026-09-15',
    service: WINDOW,
    colors: {},
    defaultColor: '#888888',
    lineOrder: [],
    style: {},
    layout: LAYOUT,
    made: MADE,
    drawn: null,
  } as unknown as ProjectRecord

  const ended = (run: LayoutRun): Promise<string> =>
    new Promise((resolve) => {
      const off = run.subscribe((snapshot) => {
        if (snapshot.state !== 'running') {
          off()
          resolve(snapshot.state)
        }
      })
    })

  function made(stations: unknown) {
    const written: { method: string; done: unknown }[] = []
    const run = new LayoutRun({
      client: client(stations),
      complete: async (_id, done) => {
        written.push({ method: 'complete', done })
        return { changed: false, relaid: false }
      },
      completeRebuild: async (_id, done) => written.push({ method: 'completeRebuild', done }),
      completeColors: async () => written.push({ method: 'completeColors', done: null }),
      completeOrder: async () => undefined,
      completeStyle: async () => undefined,
      today: () => '2026-09-08',
    })
    return { run, written }
  }

  const READY = { state: 'ready' } as unknown as EngineState

  it('with a layout run, the list its map.build answered', async () => {
    const { run, written } = made(STATIONS)
    const end = ended(run)
    run.start(project, READY)
    expect(await end).toBe('done')
    expect(written).toHaveLength(1)
    expect((written[0].done as { stations: unknown }).stations).toEqual(STATIONS)
  })

  it('with a rebuild, the same', async () => {
    const { run, written } = made(STATIONS)
    const end = ended(run)
    run.rebuild(project, READY, '2026-09-16')
    expect(await end).toBe('done')
    expect(written).toEqual([
      { method: 'completeRebuild', done: { date: '2026-09-16', stations: STATIONS } },
    ])
  })

  it('and nothing at all where the build listed none it can read', async () => {
    for (const stations of [undefined, 'Alpha', [{ id: 'a' }]]) {
      const { run, written } = made(stations)
      const end = ended(run)
      run.start(project, READY)
      expect(await end).toBe('done')
      expect(written[0].done, JSON.stringify(stations)).not.toHaveProperty('stations')
    }
  })
})
