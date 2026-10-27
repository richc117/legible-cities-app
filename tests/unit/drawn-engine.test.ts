// Which engine drew a map, kept in the record's `drawn` (issue 494): issue
// 465 redraws a page an older engine drew as its project opens, and until
// this the page's seam was the only sign of one, so a page drawn by engine
// v0.15.0 to v0.18.x, which has every seam, counted as current though the
// engine had changed what it draws since.
//
// What is held here: the reader keeps a version and drops anything else,
// leaving the rest of the block as it was, and a record without one reads as
// it always did; the store stamps the version of the engine that answers
// draws at every draw - a layout run, a rebuild and the four cheap edits -
// from main's own source and nothing the renderer sent, renews it with each
// draw and never carries it from the block before, and leaves it alone where
// nothing is drawn; and the comparison says below, the same or above, or
// nothing for a version either side it cannot read.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../../src/main/projects'
import { drawnFromSent } from '../../src/main/record/drawn'
import { parseRecord } from '../../src/main/record/parse'
import { engineBefore } from '../../src/renderer/src/record'
import { type SentSet } from '../../src/shared/project/types'
import { isEngineVersion } from '../../src/shared/project/validate'
import { drawsOn } from '../support/sent'

const WINDOW = {
  start: '2026-01-01',
  end: '2026-12-31',
  busiest: '2026-09-15',
  anchor: '2026-09-08',
}
const MADE = '2026-09-10T12:00:00+00:00'
const LAYOUT = 'a'.repeat(64)

let home: string
/** The version the store is told answers its draws, as main's supervisor would say it. */
let answering: string | null
let store: ProjectStore

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'legible-cities-drawn-engine-'))
  answering = '0.19.0'
  store = new ProjectStore(
    home,
    () => undefined,
    {},
    undefined,
    () => answering,
  )
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

const done = (overrides: Record<string, unknown> = {}) => ({
  date: '2026-09-02',
  layout: LAYOUT,
  service: WINDOW,
  made: MADE,
  built: { mode: 'all', agency: null },
  ...overrides,
})

async function laidOut(): Promise<string> {
  const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
  await drawsOn(store).completeLayout(project.id, done())
  return project.id
}

const file = (id: string): string => join(home, 'projects', id, 'project.json')
const onDisk = async (id: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(file(id), 'utf8'))
const drawnOnDisk = async (id: string): Promise<Record<string, unknown>> =>
  (await onDisk(id)).drawn as Record<string, unknown>

describe('the record reads the engine that drew its map', () => {
  it('keeps a version, and reads it back', async () => {
    // Mutation: `readDrawn` not reading the field - the version is lost on
    // every read, and every page is judged by its seam alone again.
    const id = await laidOut()
    expect((await drawnOnDisk(id)).engine).toBe('0.19.0')
    expect((await store.get(id)).drawn?.engine).toBe('0.19.0')
  })

  it('reads a record drawn before the field as having none, and its block as it was', async () => {
    const id = await laidOut()
    const raw = await onDisk(id)
    const drawn = { ...(raw.drawn as Record<string, unknown>) }
    delete drawn.engine
    const parsed = parseRecord({ ...raw, drawn })
    if ('error' in parsed) throw new Error(parsed.error)
    expect(parsed.record.drawn).not.toBeNull()
    expect(parsed.record.drawn?.layout).toBe(LAYOUT)
    expect(parsed.record.drawn).not.toHaveProperty('engine')
  })

  it('drops a value that is not a version, and leaves the rest of the block alone', async () => {
    // Mutation: the reader keeping any string - a value no comparison can
    // read reaches the screen as if it were one; or refusing the block for
    // it - the map then cannot be proved current, and cell 02 to 06 lose it.
    const id = await laidOut()
    const raw = await onDisk(id)
    for (const engine of [
      'v0.19.0',
      '0.19',
      '0.19.0.1',
      '0.19.0rc1',
      '0.20.0.dev0',
      '0.19.0+local',
      '01.19.0',
      ' 0.19.0',
      '0.19.0\n',
      '0.1234567890.0',
      19,
      null,
      ['0.19.0'],
    ]) {
      const parsed = parseRecord({ ...raw, drawn: { ...(raw.drawn as object), engine } })
      if ('error' in parsed) throw new Error(parsed.error)
      expect(parsed.record.drawn, JSON.stringify(engine)).not.toBeNull()
      expect(parsed.record.drawn?.layout, JSON.stringify(engine)).toBe(LAYOUT)
      expect(parsed.record.drawn, JSON.stringify(engine)).not.toHaveProperty('engine')
    }
  })
})

describe('the store stamps the engine that answered each draw', () => {
  it('at a layout run, a rebuild and each of the four cheap edits', async () => {
    // Mutation: any one writer passing no version to `drew` - that draw's
    // map then reads as drawn by no engine, and is judged by its seam.
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const draws = drawsOn(store)
    const steps: [string, () => Promise<unknown>][] = [
      ['a layout run', () => draws.completeLayout(project.id, done())],
      ['a rebuild', () => draws.completeRebuild(project.id, { date: '2026-09-12' })],
      [
        'a recolour',
        () =>
          draws.completeColors(project.id, { colors: { A: '#0072bc' }, defaultColor: '#888888' }),
      ],
      ['a reorder', () => draws.completeOrder(project.id, ['A'])],
      ['a resize', () => draws.completeStyle(project.id, { lineWidth: 9 })],
      ['a line’s options', () => draws.completeLines(project.id, { A: { hidden: true } })],
    ]
    let version = 10
    for (const [what, step] of steps) {
      // A different version each time, so a writer that carried the last
      // one rather than stamping its own is seen too.
      answering = `0.${version}.0`
      await step()
      expect((await drawnOnDisk(project.id)).engine, what).toBe(answering)
      version += 1
    }
  })

  it('renews it with the draw: a map an older engine drew, drawn again, names the engine that drew it now', async () => {
    // What the redraw on open relies on to happen once (issue 465): its
    // rebuild's write names the running engine, so the next opening finds
    // the page current.
    answering = '0.18.1'
    const id = await laidOut()
    expect((await store.get(id)).drawn?.engine).toBe('0.18.1')
    answering = '0.19.0'
    const day = (await store.get(id)).drawn?.date as string
    await drawsOn(store).completeRebuild(id, { date: day })
    expect((await store.get(id)).drawn?.engine).toBe('0.19.0')
  })

  it('stamps nothing where it was told no version, or one it cannot read, and carries none from before', async () => {
    // Mutation (mutations.json): `drawnFromSent` keeping the version the block
    // before had - the map drawn now would be said to be the older engine's.
    const id = await laidOut()
    expect((await drawnOnDisk(id)).engine).toBe('0.19.0')
    answering = null
    await drawsOn(store).completeOrder(id, ['A'])
    expect(await drawnOnDisk(id)).not.toHaveProperty('engine')
    answering = '0.19.0'
    await drawsOn(store).completeOrder(id, ['B'])
    answering = 'not a version'
    await drawsOn(store).completeOrder(id, ['A'])
    expect(await drawnOnDisk(id)).not.toHaveProperty('engine')
  })

  it('leaves it alone where nothing is drawn: a day, a theme, a name', async () => {
    // Mutation: a writer that draws nothing renewing `drawn` - it would name
    // the running engine on a page it never drew.
    answering = '0.18.1'
    const id = await laidOut()
    answering = '0.19.0'
    await store.setDate(id, '2026-09-20')
    await store.setTheme(id, 'sepia')
    await store.rename(id, 'Los Angeles')
    expect((await drawnOnDisk(id)).engine).toBe('0.18.1')
  })

  it('takes the version from main alone, never from what the run sent', async () => {
    // The sent set comes from the renderer; a version riding on it is not
    // read, and the store's own is what is written.
    const id = await laidOut()
    const record = await store.get(id)
    const sent = {
      layout: LAYOUT,
      made: MADE,
      date: record.drawn?.date as string,
      colors: {},
      defaultColor: '#888888',
      lineOrder: ['A'],
      style: {},
      engine: '9.9.9',
    } as SentSet
    await store.completeOrder(id, ['A'], sent)
    expect((await drawnOnDisk(id)).engine).toBe('0.19.0')
  })

  it('is kept by a store told nothing, which stamps nothing', async () => {
    const plain = new ProjectStore(home, () => undefined)
    const project = await plain.create({ name: 'Plain', feed: 'la-metro-rail' })
    await drawsOn(plain).completeLayout(project.id, done())
    expect(await drawnOnDisk(project.id)).not.toHaveProperty('engine')
  })

  it('reads back a record whose version was written by hand as the store wrote it', async () => {
    const id = await laidOut()
    const raw = await onDisk(id)
    await writeFile(
      file(id),
      JSON.stringify({ ...raw, drawn: { ...(raw.drawn as object), engine: '0.18.1' } }),
    )
    expect((await store.get(id)).drawn?.engine).toBe('0.18.1')
  })
})

describe('drawnFromSent and the engine', () => {
  const sent: SentSet = {
    layout: LAYOUT,
    made: MADE,
    date: '2026-09-02',
    colors: {},
    defaultColor: '#888888',
    lineOrder: [],
    style: {},
  }

  it('names the engine it is given, where that is a version, and never the one before', () => {
    const before = drawnFromSent(sent, 'warm-dark', null, undefined, '0.18.1')
    expect(before.engine).toBe('0.18.1')
    expect(drawnFromSent(sent, 'warm-dark', before, undefined, '0.19.0').engine).toBe('0.19.0')
    expect(drawnFromSent(sent, 'warm-dark', before)).not.toHaveProperty('engine')
    expect(drawnFromSent(sent, 'warm-dark', before, undefined, null)).not.toHaveProperty('engine')
    expect(drawnFromSent(sent, 'warm-dark', before, undefined, '0.19')).not.toHaveProperty('engine')
  })
})

describe('whether one engine is older than another', () => {
  it('is below where any part is lower, compared as numbers and not as text', () => {
    // Mutation (mutations.json): the parts compared as strings - "0.9.0" would
    // read above "0.10.0", and a page drawn by the older would be kept.
    expect(engineBefore('0.18.1', '0.19.0')).toBe(true)
    expect(engineBefore('0.19.0', '0.19.1')).toBe(true)
    expect(engineBefore('0.9.0', '0.10.0')).toBe(true)
    expect(engineBefore('0.19.9', '1.0.0')).toBe(true)
    expect(engineBefore('0.15.0', '0.19.0')).toBe(true)
  })

  it('is not below where it is the same', () => {
    // Mutation (mutations.json): `<=` for `<` - every page drawn at the pin
    // redrawn on every opening.
    expect(engineBefore('0.19.0', '0.19.0')).toBe(false)
  })

  it('is not below where it is above: a newer engine drew it', () => {
    expect(engineBefore('0.20.0', '0.19.0')).toBe(false)
    expect(engineBefore('0.19.1', '0.19.0')).toBe(false)
    expect(engineBefore('0.10.0', '0.9.0')).toBe(false)
    expect(engineBefore('1.0.0', '0.99.99')).toBe(false)
  })

  it('says nothing where either side is not a version it reads', () => {
    // Mutation: an unreadable side compared anyway - a pre-release or a
    // local build would be ordered by a guess.
    for (const [drawn, running] of [
      [undefined, '0.19.0'],
      ['0.18.0', null],
      ['0.18.0', '0.19.0rc1'],
      ['0.20.0.dev0', '0.19.0'],
      ['0.18.0+local', '0.19.0'],
      ['0.18', '0.19.0'],
      ['unknown', '0.19.0'],
      [18, '0.19.0'],
    ] as const)
      expect(engineBefore(drawn, running), `${String(drawn)} / ${String(running)}`).toBeNull()
  })

  it('reads the pin’s version as one', async () => {
    const pins = JSON.parse(
      await readFile(join(__dirname, '..', '..', 'vendor', 'pins.json'), 'utf8'),
    ) as { engine: { version: string } }
    expect(isEngineVersion(pins.engine.version)).toBe(true)
  })
})
