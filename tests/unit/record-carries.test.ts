// The record keeps the keys it does not know (issue 425, ADR-056; the
// codebase review's R6-01). A record written by a build that knows fields
// this one does not - at the top level, inside the style, inside the export
// choice and its options, and inside every other object the parser rebuilds
// from the keys it knows - comes back, field for field, after any writer of
// this build has written it. The one exception is the four blocks that record
// a fact (`RECORD_FACTS`): a writer that records a new one renews its block
// whole. None of those keys ever reaches the renderer.
//
// Each test was watched failing under a mutation of the rule it holds; the
// mutation is named beside it.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerProjectHandlers } from '../../src/main/ipc'
import { ProjectStore } from '../../src/main/projects'
import { CHANNELS } from '../../src/shared/api'
import {
  parseRecord,
  RECORD_FACTS,
  RECORD_VERSION,
  type RecordFact,
} from '../../src/shared/project'

let home: string
let store: ProjectStore

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'legible-cities-carries-'))
  store = new ProjectStore(home, () => undefined)
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

const A = 'aaaaaaaaaaaa'
const LAYOUT = 'a'.repeat(64)
const RELAID = 'b'.repeat(64)
const MADE = '2026-09-10T12:00:00+00:00'
const WINDOW = {
  start: '2026-01-01',
  end: '2026-12-31',
  busiest: '2026-09-15',
  anchor: '2026-09-08',
}

/**
 * A record a later build wrote, at this build's version: every field this
 * build knows, each valid, and beside them, at every depth the parser
 * rebuilds an object from the keys it knows, a field this build does not.
 */
function later(): Record<string, unknown> {
  return {
    version: RECORD_VERSION,
    id: A,
    name: 'Los Angeles',
    feed: 'la-metro-rail',
    mode: 'all',
    agency: null,
    date: '2026-09-15',
    service: { ...WINDOW, holidays: ['2026-12-25'] },
    style: { lineWidth: 9, haloWidth: 2 },
    colors: { A: '#0072bc' },
    defaultColor: '#888888',
    lineOrder: ['A', 'K'],
    lines: {
      A: {
        name: 'Airport',
        casing: { width: 0.5, color: '#112233', pattern: 'double' },
        opacity: 0.5,
      },
    },
    theme: 'warm-dark',
    export: { preset: 'linkedin-video', options: { clock: false, subtitles: 'en' }, loop: 3 },
    destination: null,
    tuning: { gridSize: 120, smoothing: 0.4 },
    layout: LAYOUT,
    built: { mode: 'all', agency: null, routeTypes: [1, 2] },
    laidOutWith: { gridSize: 120, smoothing: 0.4 },
    made: MADE,
    drawn: {
      layout: LAYOUT,
      made: MADE,
      date: '2026-09-15',
      colors: { A: '#0072bc' },
      defaultColor: '#888888',
      lineOrder: ['A', 'K'],
      theme: 'warm-dark',
      style: { lineWidth: 9, haloWidth: 2 },
      lines: { A: { name: 'Airport', opacity: 0.5 } },
      stations: [
        { id: 's1', name: 'Union Station', platforms: 4 },
        { id: 's2', name: 'Pershing Square' },
      ],
      labelHalo: 1,
    },
    opened: '2026-10-01T09:00:00.000Z',
    created: '2026-09-01T00:00:00.000Z',
    modified: '2026-09-01T00:00:00.000Z',
    fromALaterBuild: { kept: true, list: [1, 'two'] },
  }
}

/** Where `later()` holds a field this build does not know, and the fact that holds it, if any. */
const UNKNOWN: { path: (string | number)[]; fact: RecordFact | null }[] = [
  { path: ['fromALaterBuild'], fact: null },
  { path: ['style', 'haloWidth'], fact: null },
  { path: ['export', 'loop'], fact: null },
  { path: ['export', 'options', 'subtitles'], fact: null },
  { path: ['tuning', 'smoothing'], fact: null },
  { path: ['lines', 'A', 'opacity'], fact: null },
  { path: ['lines', 'A', 'casing', 'pattern'], fact: null },
  { path: ['service', 'holidays'], fact: 'service' },
  { path: ['built', 'routeTypes'], fact: 'built' },
  { path: ['laidOutWith', 'smoothing'], fact: 'laidOutWith' },
  { path: ['drawn', 'labelHalo'], fact: 'drawn' },
  { path: ['drawn', 'style', 'haloWidth'], fact: 'drawn' },
  { path: ['drawn', 'lines', 'A', 'opacity'], fact: 'drawn' },
  { path: ['drawn', 'stations', 0, 'platforms'], fact: 'drawn' },
]

/**
 * Known fields an older reader gave up because of an unknown key beside
 * them: the whole export choice for one key it did not know, and a casing
 * for a third key in it. No writer below changes them.
 */
const KNOWN_BESIDE: (string | number)[][] = [
  ['export', 'preset'],
  ['export', 'options', 'clock'],
  ['lines', 'A', 'casing', 'width'],
  ['lines', 'A', 'casing', 'color'],
]

const UNKNOWN_NAMES = [
  'fromALaterBuild',
  'haloWidth',
  'loop',
  'subtitles',
  'smoothing',
  'opacity',
  'pattern',
  'holidays',
  'routeTypes',
  'labelHalo',
  'platforms',
]

function at(value: unknown, path: (string | number)[]): unknown {
  let here = value
  for (const step of path) {
    if (typeof here !== 'object' || here === null) return undefined
    here = (here as Record<string | number, unknown>)[step]
  }
  return here
}

/** Every unknown key's name that appears in what would cross the bridge. */
function leaks(answer: unknown): string[] {
  // The structured clone is what Electron's IPC sends.
  const text = JSON.stringify(structuredClone(answer)) ?? ''
  return UNKNOWN_NAMES.filter((name) => text.includes(`"${name}":`))
}

const file = (): string => join(home, 'projects', A, 'project.json')

async function seed(json: Record<string, unknown> = later()): Promise<string> {
  await mkdir(join(home, 'projects', A), { recursive: true })
  const text = JSON.stringify(json, null, 2) + '\n'
  await writeFile(file(), text, 'utf8')
  return text
}

const onDisk = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(file(), 'utf8')) as Record<string, unknown>

/**
 * Every writer of a record it has read, each with a change it makes to
 * `later()` that touches none of the paths above, and the facts it renews.
 * A new writer is a new row; one left out fails the test after this table.
 */
const WRITERS: {
  name: string
  write: (store: ProjectStore) => Promise<unknown>
  renews: readonly RecordFact[]
}[] = [
  { name: 'rename', write: (s) => s.rename(A, 'Renamed'), renews: [] },
  { name: 'setInputs', write: (s) => s.setInputs(A, { mode: 'subway', agency: null }), renews: [] },
  {
    name: 'completeLayout',
    write: (s) =>
      s.completeLayout(A, {
        date: '2026-09-15',
        layout: RELAID,
        made: '2026-10-01T00:00:00+00:00',
        built: { mode: 'all', agency: null },
        service: WINDOW,
        tuning: { gridSize: 120 },
      }),
    renews: RECORD_FACTS,
  },
  {
    name: 'completeRebuild',
    write: (s) => s.completeRebuild(A, { date: '2026-09-16' }),
    renews: ['drawn'],
  },
  { name: 'setDate', write: (s) => s.setDate(A, '2026-09-16'), renews: [] },
  {
    name: 'completeColors',
    write: (s) => s.completeColors(A, { colors: { A: '#ff0000' }, defaultColor: '#888888' }),
    renews: ['drawn'],
  },
  { name: 'completeOrder', write: (s) => s.completeOrder(A, ['K', 'A']), renews: ['drawn'] },
  { name: 'completeStyle', write: (s) => s.completeStyle(A, { lineWidth: 10 }), renews: ['drawn'] },
  {
    name: 'completeLines',
    write: (s) =>
      s.completeLines(A, {
        A: { name: 'Airport', casing: { width: 0.5, color: '#112233' }, dash: 'dashed' },
      }),
    renews: ['drawn'],
  },
  { name: 'markOpened', write: (s) => s.markOpened(A), renews: [] },
  { name: 'setTuning', write: (s) => s.setTuning(A, { gridSize: 150 }), renews: [] },
  { name: 'setTheme', write: (s) => s.setTheme(A, 'sepia'), renews: [] },
  {
    name: 'setExport',
    write: (s) =>
      s.setExport(A, { preset: 'linkedin-video', options: { clock: false, labels: false } }),
    renews: [],
  },
  {
    name: 'setDestination',
    write: (s) => s.setDestination(A, '/videos/legible-cities'),
    renews: [],
  },
]

/**
 * Every other member of the store, and why it is not a row: it writes no
 * record it has read. A method added to the store is one or the other.
 */
const NOT_WRITERS: Record<string, string> = {
  constructor: 'makes the store',
  writing: 'counts the writes in flight',
  dir: 'names a folder',
  file: 'names a file',
  outputDir: 'names a folder',
  checkId: 'checks an identifier',
  exists: 'asks the disk',
  read: 'reads a record',
  load: 'reads a record',
  writeAtomic: 'the write itself, which a writer reaches only through #save',
  claimFolder: 'makes the folder of a record not yet written',
  entries: 'lists the projects folder',
  readable: 'reads every record',
  list: 'reads every record',
  destinations: 'reads every record',
  get: 'reads a record',
  create: 'writes a new record, which no other build has written',
  delete: 'removes the record whole',
}

describe('what the parser carries', () => {
  it('reads none of the keys it does not know, and gives back the file exactly', () => {
    // Mutation: `keep` returns nothing for the export's options (the inner
    // shape removed) - `subtitles` is then missing from what is given back.
    const parsed = parseRecord(later())
    if (!('record' in parsed)) throw new Error(parsed.error)
    expect(leaks(parsed.record), 'the record holds none of them').toEqual([])
    expect(parsed.carried.empty).toBe(false)
    expect(parsed.carried.onto(parsed.record)).toEqual(later())
  })

  it('takes the known fields beside them, the export choice and the casing whole', () => {
    // Mutation: `readStoredChoice` judges the choice with its unknown keys -
    // the reel, with no options, comes back instead of LinkedIn.
    const parsed = parseRecord(later())
    if (!('record' in parsed)) throw new Error(parsed.error)
    expect(parsed.record.export).toEqual({ preset: 'linkedin-video', options: { clock: false } })
    expect(parsed.record.lines).toEqual({
      A: { name: 'Airport', casing: { width: 0.5, color: '#112233' } },
    })
    expect(parsed.record.style).toEqual({ lineWidth: 9 })
    expect(parsed.record.tuning).toEqual({ gridSize: 120 })
  })

  it('carries nothing under a known field’s name: a value this build refuses is that field’s', () => {
    // Mutation: `keep` treats a known key whose value the reader dropped as
    // unknown - the bad theme and the bad face then come back.
    const parsed = parseRecord({
      ...later(),
      theme: 'neon',
      style: { lineWidth: 9, labelFont: 'comic-sans', haloWidth: 2 },
    })
    if (!('record' in parsed)) throw new Error(parsed.error)
    const written = parsed.carried.onto(parsed.record)
    expect(written.theme).toBe('warm-dark')
    expect(written.style).toEqual({ lineWidth: 9, haloWidth: 2 })
  })

  it('carries nothing inside a fact the writer renews, and everything outside it', () => {
    // Mutation: `onto` ignores `renewed` - the old drawn block's keys come
    // back onto the new one.
    const parsed = parseRecord(later())
    if (!('record' in parsed)) throw new Error(parsed.error)
    const written = parsed.carried.onto(parsed.record, ['drawn'])
    expect(at(written, ['drawn', 'labelHalo'])).toBeUndefined()
    expect(at(written, ['drawn', 'stations', 0, 'platforms'])).toBeUndefined()
    expect(at(written, ['service', 'holidays'])).toEqual(['2026-12-25'])
    expect(at(written, ['style', 'haloWidth'])).toBe(2)
  })

  it('gives an object back where the writer left the key out, holding only what was carried', () => {
    // A tuning reset removes the key; what a later build kept in it stays,
    // and this build reads it as no tuning at all.
    // Mutation: `put` returns the writer's `undefined` as it is.
    const parsed = parseRecord(later())
    if (!('record' in parsed)) throw new Error(parsed.error)
    const reset = { ...parsed.record }
    delete reset.tuning
    const written = parsed.carried.onto(reset)
    expect(written.tuning).toEqual({ smoothing: 0.4 })
    const again = parseRecord(written)
    expect('record' in again && again.record.tuning).toBeUndefined()
  })

  it('carries no key named __proto__, and reads the record past one', () => {
    // `JSON.parse` makes such a key an own property; assigning it back would
    // set the written object's prototype instead.
    // Mutation: the `__proto__` skip removed from `keep` - the top level's
    // and the style's written objects then take the stored one as their
    // prototype.
    const text = JSON.stringify(later())
      .replace(/^\{/, '{"__proto__":{"polluted":true},')
      .replace('"style":{', '"style":{"__proto__":{"polluted":true},')
    const parsed = parseRecord(JSON.parse(text))
    if (!('record' in parsed)) throw new Error(parsed.error)
    const written = parsed.carried.onto(parsed.record)
    expect(Object.getPrototypeOf(written)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(written.style)).toBe(Object.prototype)
    expect(written).toEqual(later())
  })

  it('answers for any input and never throws: a record it cannot read whole is one that will not read', () => {
    // An object whose fields throw as they are read stands for whatever a
    // reader might one day fail on. The answer is the store's "skip it and
    // name it" error, never a throw that would reject a list of every
    // project, and never a record that would be written back without what
    // it carried.
    // Mutation: the `try` around `readRecord` in `parseRecord` removed - the
    // getter's error is then thrown out of it.
    const unknownTrap: Record<string, unknown> = later()
    Object.defineProperty(unknownTrap, 'fromALaterBuild', {
      enumerable: true,
      get() {
        throw new RangeError('trap')
      },
    })
    expect(parseRecord(unknownTrap)).toEqual({ error: 'could not be read (RangeError)' })
    const knownTrap: Record<string, unknown> = later()
    Object.defineProperty(knownTrap, 'style', {
      enumerable: true,
      get() {
        throw new TypeError('trap')
      },
    })
    expect(parseRecord(knownTrap)).toEqual({ error: 'could not be read (TypeError)' })
  })
})

describe('a value no copy could take', () => {
  // 200,000 levels: `JSON.parse` takes it; `structuredClone` and the store's
  // indented `JSON.stringify` overflow the stack at some thousands.
  const DEPTH = 200_000

  /** `later()` with an unknown key holding an array that deep, as text, since no indented stringify can make it. */
  function deepText(): string {
    const whole = JSON.stringify(later(), null, 2)
    const deep = '['.repeat(DEPTH) + ']'.repeat(DEPTH)
    return `${whole.slice(0, whole.lastIndexOf('}')).trimEnd()},\n  "deep": ${deep}\n}\n`
  }

  it('reads, lists and is counted by the reset’s question, and a writer refuses it whole', async () => {
    // Which of the two: the write fails, with the store's own sentence, and
    // the file is left exactly as it was. The store writes the record
    // indented (record.md), and the indented form recurses where the parser
    // did not; writing it compact would break that contract, and rewriting
    // the value would be reading it. So this build reads and lists such a
    // record and never writes it, and never loses it.
    // Mutation 1: `structuredClone` back on each carried value in `keep` -
    // the parse fails, the record is skipped and the list is empty.
    // Mutation 2: the serialisation moved back out of the write's `try` -
    // the writer rejects with the stack's RangeError instead.
    const said: string[] = []
    const logged = new ProjectStore(home, (line) => said.push(line))
    await mkdir(join(home, 'projects', A), { recursive: true })
    const text = deepText()
    await writeFile(file(), text, 'utf8')

    expect((await logged.list()).map((summary) => summary.id)).toEqual([A])
    expect((await logged.get(A)).name).toBe('Los Angeles')
    await expect(logged.destinations()).resolves.toEqual([])

    await expect(logged.rename(A, 'Renamed')).rejects.toThrow(/^the project could not be saved$/)
    expect(await readFile(file(), 'utf8'), 'the record as it was').toBe(text)
    expect(await readdir(join(home, 'projects', A)), 'and no temporary file').toEqual([
      'project.json',
    ])
    expect(logged.writing).toBe(0)
    expect(said).toEqual([`projects/${A}: could not be written as JSON (RangeError)`])
  })
})

describe('every writer carries what it does not know', () => {
  it.each(WRITERS)('$name', async ({ write, renews }) => {
    // Mutation: one writer hands `#save` `Carried.NONE` instead of what it
    // read (the old behaviour of every writer but markOpened) - its row fails
    // with every path below it missing.
    const before = await seed()
    const returned = await write(store)
    const text = await readFile(file(), 'utf8')
    expect(text, 'the writer wrote').not.toBe(before)
    const written = JSON.parse(text) as Record<string, unknown>
    const kept: string[] = []
    const lost: string[] = []
    for (const { path, fact } of UNKNOWN) {
      const value = at(written, path)
      if (fact !== null && renews.includes(fact)) {
        if (value !== undefined) kept.push(path.join('.'))
      } else if (JSON.stringify(value) !== JSON.stringify(at(later(), path))) {
        lost.push(path.join('.'))
      }
    }
    expect(lost, 'what a later build wrote, lost').toEqual([])
    expect(kept, 'what an old fact said, kept on a new one').toEqual([])
    for (const path of KNOWN_BESIDE)
      expect(at(written, path), path.join('.')).toEqual(at(later(), path))
    expect(leaks(returned), 'and none of it in what the writer answers').toEqual([])
  })

  it('names every member of the store, as a writer above or as one that writes no record it read', () => {
    // Mutation: a row removed from WRITERS - its method is then unnamed here.
    // It reads the store's prototype, so it sees every method but the
    // `#private` ones, which are reached only from the methods it sees.
    const members = Object.getOwnPropertyNames(ProjectStore.prototype)
    const named = [...WRITERS.map((w) => w.name), ...Object.keys(NOT_WRITERS)]
    expect(members.filter((m) => !named.includes(m)).sort(), 'unnamed').toEqual([])
    expect(named.filter((m) => !members.includes(m)).sort(), 'named but gone').toEqual([])
  })

  it('keeps what a later build kept in a block this build resets to nothing', async () => {
    // A reset removes this build's key; what a later build kept inside the
    // block stays, and this build reads it as nothing set.
    // Mutation: `put` returns the writer's `undefined` as it is - the later
    // build's tuning and line options go with the reset.
    await seed()
    await store.setTuning(A, {})
    await store.completeLines(A, {})
    const written = await onDisk()
    expect(written.tuning).toEqual({ smoothing: 0.4 })
    expect(written.lines).toEqual({ A: { casing: { pattern: 'double' }, opacity: 0.5 } })
    const read = await store.get(A)
    expect(read.tuning, 'and this build has no tuning').toBeUndefined()
    expect(read.lines, 'nor any line options').toBeUndefined()
  })

  it('puts back a line called toString, not the function every object inherits', async () => {
    // A line label is data, and a plain object answers to these names.
    // Mutation: `put` reads `out[key]` for a label the writer removed - it
    // gets `Object.prototype.toString`, which JSON then leaves out, and the
    // later build's options for the two lines are lost.
    await seed({
      ...later(),
      lines: { toString: { opacity: 0.5 }, constructor: { opacity: 0.25 } },
    })
    await store.completeLines(A, {})
    expect((await onDisk()).lines).toEqual({
      toString: { opacity: 0.5 },
      constructor: { opacity: 0.25 },
    })
  })

  it('raises a later build’s revision rather than carrying it beside its own', async () => {
    // `revision` is a field this build knows (spec 037, FR-001): read, raised
    // by one at the write, and never carried as a later build's key.
    // Mutation: `revision: true` taken out of the record's shape - the
    // parser then carries the stored 7 and writes it back over this build's 8.
    await seed({ ...later(), revision: 7 })
    const renamed = await store.rename(A, 'Renamed')
    expect(renamed.revision).toBe(8)
    expect((await onDisk()).revision).toBe(8)
  })

  it('carries them through every writer in turn', async () => {
    // Mutation: as for the rows above; this is the composition - what one
    // writer wrote, the next reads as unknown again and carries.
    await seed()
    for (const { write } of WRITERS) await write(store)
    const written = await onDisk()
    for (const { path, fact } of UNKNOWN) {
      if (fact !== null) continue
      expect(at(written, path), path.join('.')).toEqual(at(later(), path))
    }
    expect(written.name).toBe('Renamed')
  })
})

describe('the bridge', () => {
  type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

  function bridge(): (channel: string, ...args: unknown[]) => Promise<unknown> {
    const handlers = new Map<string, Handler>()
    const ipc = {
      handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
    } as unknown as IpcMain
    registerProjectHandlers(
      ipc,
      store,
      () => true,
      () => null,
    )
    return (channel, ...args) => handlers.get(channel)!({} as IpcMainInvokeEvent, ...args)
  }

  it('never shows the renderer a key this build does not know', async () => {
    // Mutation: `get` answers the record as written, `{ ...carried.onto(record),
    // readOnly }` - every unknown name is then in its answer.
    const call = bridge()
    const calls: [string, ...unknown[]][] = [
      [CHANNELS.projectsList],
      [CHANNELS.projectsGet, A],
      [CHANNELS.projectsRename, A, 'Renamed'],
      [CHANNELS.projectsSetInputs, A, { mode: 'subway', agency: null }],
      [
        CHANNELS.projectsCompleteLayout,
        A,
        {
          date: '2026-09-15',
          layout: RELAID,
          made: '2026-10-01T00:00:00+00:00',
          built: { mode: 'all', agency: null },
          service: WINDOW,
        },
      ],
      [CHANNELS.projectsCompleteRebuild, A, { date: '2026-09-16' }],
      [CHANNELS.projectsSetDate, A, '2026-09-16'],
      [CHANNELS.projectsCompleteColors, A, { colors: {}, defaultColor: '#112233' }],
      [CHANNELS.projectsCompleteOrder, A, ['K']],
      [CHANNELS.projectsCompleteStyle, A, { lineWidth: 10 }],
      [CHANNELS.projectsCompleteLines, A, { A: { dash: 'dotted' } }],
      [CHANNELS.projectsSetTheme, A, 'sepia'],
      [CHANNELS.projectsSetTuning, A, { gridSize: 150 }],
      [CHANNELS.projectsMarkOpened, A],
      [CHANNELS.projectsSetExport, A, { preset: 'bluesky', options: {} }],
    ]
    const leaked: Record<string, string[]> = {}
    for (const [channel, ...args] of calls) {
      // Each answer from the record a later build wrote, every key in place.
      await seed()
      const answer = await call(channel, ...args)
      expect(answer, channel).toBeDefined()
      const names = leaks(answer)
      if (names.length > 0) leaked[channel] = names
    }
    expect(leaked).toEqual({})
    // And the record on disk still has them all: they were carried, not dropped.
    expect(leaks(await onDisk())).toEqual(UNKNOWN_NAMES)
  })
})
