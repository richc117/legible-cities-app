// The opening's three fields in the record (issue 392, spec 035, FR-003):
// what an export choice may hold for the title card and the draw-in, what
// the store and the bridge refuse, how a stored one is read, and what is
// sent for a still. The fields sit beside `options`, as the alt text does,
// and none of them is an option of the engine's.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readExportChoice } from '../../src/main/ipc'
import { ProjectStore } from '../../src/main/projects'
import {
  copyChoice,
  readStoredChoice,
  sentChoice,
  validateExportChoice,
  type ExportChoice,
} from '../../src/shared/export'
import {
  CARD_REFUSED,
  CARD_SECONDS,
  DRAW_IN_REFUSED,
  DRAW_IN_SECONDS,
  OPENINGS,
} from '../../src/shared/opening'

const GIF: ExportChoice = { preset: 'linkedin-gif', options: {} }

describe('the choice’s opening fields', () => {
  it('takes the three openings and any duration inside its range, decimals included', () => {
    for (const opening of OPENINGS)
      expect(validateExportChoice({ ...GIF, opening }), opening).toBeNull()
    for (const cardSecs of [1, 2, 2.5, 10])
      expect(validateExportChoice({ ...GIF, cardSecs }), String(cardSecs)).toBeNull()
    for (const drawInSecs of [2, 6, 12.25, 20])
      expect(validateExportChoice({ ...GIF, drawInSecs }), String(drawInSecs)).toBeNull()
    expect(
      validateExportChoice({ ...GIF, opening: 'card-then-draw-in', cardSecs: 4, drawInSecs: 9 }),
    ).toBeNull()
  })

  it('holds the ranges the issue decided: 1 to 10 for a card, 2 to 20 for a draw-in', () => {
    expect(CARD_SECONDS).toEqual({ low: 1, high: 10, fallback: 2 })
    expect(DRAW_IN_SECONDS).toEqual({ low: 2, high: 20, fallback: 6 })
  })

  it('refuses none, an opening it does not know, and a duration outside its range, with a sentence', () => {
    // None is the absence of the key, never a value the record holds.
    for (const opening of ['none', 'title-card', '', null, 1])
      expect(validateExportChoice({ ...GIF, opening }), JSON.stringify(opening)).toMatch(
        /^the opening must be/,
      )
    for (const cardSecs of [0.99, 10.01, 0, -2, Number.NaN, Infinity, '2', null])
      expect(validateExportChoice({ ...GIF, cardSecs }), String(cardSecs)).toBe(CARD_REFUSED)
    for (const drawInSecs of [1.99, 20.01, Number.NaN, '6', null])
      expect(validateExportChoice({ ...GIF, drawInSecs }), String(drawInSecs)).toBe(DRAW_IN_REFUSED)
    expect(CARD_REFUSED).toBe('A title card lasts from 1 to 10 seconds.')
    expect(DRAW_IN_REFUSED).toBe('A draw-in lasts from 2 to 20 seconds.')
    // And still nothing else beside the options.
    expect(validateExportChoice({ ...GIF, cardSeconds: 2 })).toBe(
      'cardSeconds is not part of an export choice',
    )
  })

  it('copies the three, and a copy is never the caller’s object', () => {
    const choice: ExportChoice = { ...GIF, opening: 'draw-in', cardSecs: 3, drawInSecs: 8 }
    const copy = copyChoice(choice)
    expect(copy).toEqual(choice)
    expect(copy).not.toBe(choice)
    // A choice without them gains no key.
    expect(Object.keys(copyChoice(GIF)).sort()).toEqual(['options', 'preset'])
  })

  it('reads a stored opening, and each field that would be refused as not held, keeping the rest', () => {
    const kept = { ...GIF, storyboard: 'day', options: { clock: false } }
    expect(readStoredChoice({ ...kept, opening: 'card', cardSecs: 4 })).toEqual({
      ...kept,
      opening: 'card',
      cardSecs: 4,
    })
    expect(
      readStoredChoice({ ...kept, opening: 'sideways', cardSecs: 40, drawInSecs: 8 }),
      'only the bad fields go',
    ).toEqual({ ...kept, drawInSecs: 8 })
    expect(readStoredChoice({ ...kept, opening: 'none' }), 'none is no opening').toEqual(kept)
    // Nothing is filled in: a duration nobody set is not written as its default.
    expect(readStoredChoice({ ...kept, opening: 'card' })).not.toHaveProperty('cardSecs')
    expect(readStoredChoice(kept)).toEqual(kept)
  })

  it('gives the whole choice up for the reel when the rest of it is broken, opening and all', () => {
    expect(readStoredChoice({ preset: 'portfolio-mp4', options: {}, opening: 'card' })).toEqual({
      preset: 'instagram-reel',
      options: {},
    })
  })

  it('sends none of the three for a still, and all three for a video', () => {
    const choice: ExportChoice = {
      preset: 'instagram-post',
      options: {},
      opening: 'card-then-draw-in',
      cardSecs: 3,
      drawInSecs: 4,
    }
    const still = sentChoice(choice, { kind: 'still', format: 'png' })
    for (const key of ['opening', 'cardSecs', 'drawInSecs']) expect(still).not.toHaveProperty(key)
    expect(choice.opening, 'the caller’s choice keeps it').toBe('card-then-draw-in')
    const video = sentChoice(
      { ...choice, preset: 'linkedin-gif' },
      { kind: 'video', format: 'gif' },
    )
    expect(video).toMatchObject({ opening: 'card-then-draw-in', cardSecs: 3, drawInSecs: 4 })
  })

  it('is refused at the bridge as the store refuses it', () => {
    expect(() => readExportChoice({ ...GIF, cardSecs: 11 })).toThrow(CARD_REFUSED)
    expect(readExportChoice({ ...GIF, opening: 'card' })).toEqual({ ...GIF, opening: 'card' })
  })
})

describe('the store', () => {
  let home = ''
  let store: ProjectStore
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'legible-cities-opening-'))
    store = new ProjectStore(home, () => {})
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  it('writes an opening as it was chosen, and a new project has none', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const file = join(home, 'projects', project.id, 'project.json')
    const fresh = JSON.parse(await readFile(file, 'utf8')) as { export: Record<string, unknown> }
    expect(Object.keys(fresh.export).sort(), 'no key for a project that never chose').toEqual([
      'options',
      'preset',
    ])
    const choice: ExportChoice = { ...GIF, opening: 'card-then-draw-in', drawInSecs: 9 }
    const written = await store.setExport(project.id, choice)
    expect(written.export).toEqual(choice)
    const onDisk = JSON.parse(await readFile(file, 'utf8')) as { export: unknown }
    expect(onDisk.export).toEqual(choice)
  })

  it('refuses a duration outside its range, and writes nothing', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await expect(store.setExport(project.id, { ...GIF, cardSecs: 0.5 })).rejects.toThrow(
      CARD_REFUSED,
    )
    await expect(store.setExport(project.id, { ...GIF, drawInSecs: 21 })).rejects.toThrow(
      DRAW_IN_REFUSED,
    )
    expect((await store.get(project.id)).export).toEqual({ preset: 'instagram-reel', options: {} })
  })

  it('reads a hand-edited opening field by field', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const file = join(home, 'projects', project.id, 'project.json')
    const record = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    await writeFile(
      file,
      JSON.stringify({
        ...record,
        export: { ...GIF, opening: 'draw-in', cardSecs: 'two', drawInSecs: 30 },
      }),
      'utf8',
    )
    expect((await store.get(project.id)).export).toEqual({ ...GIF, opening: 'draw-in' })
  })
})
