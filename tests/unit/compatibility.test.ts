// What docs/compatibility.md ("What 1.0 keeps") says, held to the code that
// does it, so that changing the behaviour changes the document in the same
// pull request.
//
// The document's promise that a record from a later version opens read-only
// and is never written is held where the store is tested, and
// `compatibility.mutations.json` runs those tests against the guards
// (`readOnly: version > RECORD_VERSION` in `src/main/record/parse.ts` and
// `markOpened`'s return for a read-only record):
//   - projects-store.test.ts, "marks a record from a later version read-only"
//   - projects-store.test.ts, "refuses a record from a later version and
//     leaves it as it was"
//   - projects-store.test.ts, "leaves a project a newer build made exactly
//     as it was"
// What an earlier build keeps of a record's unknown keys is
// record-carries.test.ts. What this file adds is the rule that makes the
// same-version promise true: a value the reader accepts is never added
// without moving the version.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OPENED_PATTERN, parseRecord, RECORD_VERSION } from '../../src/main/record/parse'
import { MADE_MAX, MADE_PATTERN } from '../../src/main/record/validate'
import { SETTINGS_FILE, SettingsStore } from '../../src/main/settings'
import { VIEWS } from '../../src/shared/capture'
import {
  ALT_MAX,
  CAPTION_MAX,
  CLOCK_CORNERS,
  CLOCK_PATTERN,
  DEFAULT_CHOICE,
  OFFERED_PRESETS,
  QUALITIES,
  STORYBOARD_NAMES,
  TAG_PATTERN,
} from '../../src/shared/export'
import { LAYOUT_ID_PATTERN } from '../../src/shared/layout'
import { CARD_SECONDS, DRAW_IN_SECONDS, OPENINGS } from '../../src/shared/opening'
import {
  CASING_WIDTH_RANGE,
  DEFAULT_COLOR,
  DEFAULT_LINE,
  DEFAULT_MODE,
  DEFAULT_STYLE,
  DEFAULT_THEME,
  DEFAULT_TUNING,
  GRIDS,
  LINE_DASHES,
  LINE_NAME_MAX,
  LINE_WIDTH_RANGE,
  type ProjectRecord,
  STYLE_CHOICES,
  THEMES,
  TUNING_RANGES,
} from '../../src/shared/project/types'
import {
  COLORS_MAX,
  FEED_PATTERN,
  HEX_COLOR_PATTERN,
  LABEL_MAX,
  MODE_PATTERN,
  SERVICE_DATE_PATTERN,
} from '../../src/shared/project/validate'
import { ID_PATTERN } from '../../src/main/record/validate'
import { ABSOLUTE, FOLDER_MAX, parseSettings } from '../../src/shared/settings'

// Keys no build has: stand-ins for whatever a later 1.x adds to settings.json.
const LATER = { sidebar: { open: true }, density: 'compact' }

describe('the settings file, as "Your settings" describes it', () => {
  it('reads the settings it knows and none that it does not', () => {
    const read = parseSettings({ version: 1, theme: 'sepia', ...LATER })
    expect(Object.keys(read).sort()).toEqual(
      ['engineFolder', 'exportFolder', 'theme', 'version', 'window'].sort(),
    )
    expect(read.theme).toBe('sepia')
  })

  describe('on disk', () => {
    let dir: string
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'legible-cities-compat-'))
    })
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true })
    })

    it('leaves out a setting it does not know when it saves, and keeps the ones it does', async () => {
      const file = join(dir, SETTINGS_FILE)
      await writeFile(file, JSON.stringify({ version: 1, theme: 'sepia', ...LATER }))
      const store = new SettingsStore(dir, () => undefined)
      await store.update((stored) => ({ ...stored, engineFolder: null, theme: 'warm-dark' }))
      const written = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
      expect(Object.keys(written).sort()).toEqual(
        ['engineFolder', 'exportFolder', 'theme', 'version', 'window'].sort(),
      )
      expect(written.theme).toBe('warm-dark')
    })
  })
})

// ---- The values a record's reader accepts

// A key a build does not know is carried back to the file (ADR-056), but a
// value it does not know in a key it does know is read as that key's default
// and written so: an export choice with a preset it does not offer is given
// up whole for the reel. That is why a widened set moves the version
// (contracts/run-graph.md, "A known field's value the older build cannot
// read"), and this is the rule made a check: the sets below are written out,
// keyed to the version they are the sets of, and a change to one fails here
// until the version moves and its snapshot is added, or the change is shown
// to be no widening.
//
// In: every closed list, pattern and range the record's readers
// (`readRecord`, `readStoredChoice`, `readTuning`, `readLines`,
// `readOpeningFields`) take a value by and whose refusal gives the field up;
// the defaults a read compares a value against, or supplies for one it
// refuses, since moving one changes what a stored value means; and the
// shapes of the fields no draw renews (`layout`, `made`, `date`,
// `destination`, `opened`), where a record that holds a value of the new
// shape would be read by an earlier build as having none. The patterns are
// held as `String(re)`, flags included.
//
// In, with a harsher failure: the feed key and the identifier. A record
// whose id, name or feed an earlier build refuses is skipped before its
// version is read, so a widening hides the project from that build outright.
//
// Out, and why: the style's and the trains' ranges (`STYLE_RANGES`,
// `TRAIN_RANGES`), which the reader keeps whatever number it finds; the
// facts a draw or a layout run renews whole (`service`, `built`, `drawn`,
// `laidOutWith`), which nothing a person chose lives in; the rules that sit
// inside a validator rather than in a constant are the table below's.
const HIDING = ['feedPattern', 'idPattern']

const sets = (): Record<string, unknown> => ({
  presets: [...OFFERED_PRESETS],
  storyboards: [...STORYBOARD_NAMES],
  views: [...VIEWS],
  qualities: [...QUALITIES],
  clockCorners: [...CLOCK_CORNERS],
  openings: [...OPENINGS],
  cardSeconds: { low: CARD_SECONDS.low, high: CARD_SECONDS.high },
  drawInSeconds: { low: DRAW_IN_SECONDS.low, high: DRAW_IN_SECONDS.high },
  stationShapes: [...STYLE_CHOICES.stationShape.options],
  interchangeShapes: [...STYLE_CHOICES.interchangeShape.options],
  labelFonts: [...STYLE_CHOICES.labelFont.options],
  lineDashes: [...LINE_DASHES],
  lineWidth: { ...LINE_WIDTH_RANGE },
  casingWidth: { ...CASING_WIDTH_RANGE },
  grids: [...GRIDS],
  tuning: Object.fromEntries(
    Object.entries(TUNING_RANGES).map(([key, { low, high }]) => [key, { low, high }]),
  ),
  themes: [...THEMES],
  modePattern: String(MODE_PATTERN),
  clockPattern: String(CLOCK_PATTERN),
  tagPattern: String(TAG_PATTERN),
  hexColorPattern: String(HEX_COLOR_PATTERN),
  layoutIdPattern: String(LAYOUT_ID_PATTERN),
  madePattern: String(MADE_PATTERN),
  serviceDatePattern: String(SERVICE_DATE_PATTERN),
  openedPattern: String(OPENED_PATTERN),
  absolutePattern: String(ABSOLUTE),
  limits: { ALT_MAX, CAPTION_MAX, LABEL_MAX, LINE_NAME_MAX, COLORS_MAX, MADE_MAX, FOLDER_MAX },
  defaultTuning: { ...DEFAULT_TUNING },
  defaultLine: { ...DEFAULT_LINE },
  defaultStyle: { ...DEFAULT_STYLE },
  defaultColor: DEFAULT_COLOR,
  defaultTheme: DEFAULT_THEME,
  defaultMode: DEFAULT_MODE,
  defaultChoice: structuredClone(DEFAULT_CHOICE),
  feedPattern: String(FEED_PATTERN),
  idPattern: String(ID_PATTERN),
})

/** Lists are sets: a reorder alone is no change, so every list is compared sorted. */
const settled = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(settled).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    : typeof value === 'object' && value !== null
      ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, settled(inner)]))
      : value

const SNAPSHOTS: Record<number, Record<string, unknown>> = {
  2: {
    presets: [
      'instagram-post',
      'instagram-square',
      'instagram-story',
      'instagram-reel',
      'instagram-reel-gif',
      'linkedin',
      'linkedin-link',
      'linkedin-video',
      'linkedin-gif',
      'bluesky',
      'bluesky-video',
      'bluesky-gif',
      'x',
    ],
    storyboards: [
      'transform',
      'transform-loop',
      'essay-loop',
      'tour',
      'reveal',
      'morph',
      'day',
      'run',
    ],
    views: ['geographic', 'map', 'linear', 'time'],
    qualities: ['draft', 'standard', 'high'],
    clockCorners: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
    openings: ['card', 'draw-in', 'card-then-draw-in'],
    cardSeconds: { low: 1, high: 10 },
    drawInSeconds: { low: 2, high: 20 },
    stationShapes: ['circle', 'tick', 'square'],
    interchangeShapes: ['circle', 'square'],
    labelFonts: ['system', 'inter', 'atkinson-hyperlegible-next'],
    lineDashes: ['solid', 'dashed', 'dotted'],
    lineWidth: { low: 0.75, high: 1.5 },
    casingWidth: { low: 0, high: 1 },
    grids: ['octilinear', 'ortholinear', 'orthoradial', 'hexalinear'],
    tuning: {
      mergeDistance: { low: 5, high: 500 },
      gridSize: { low: 25, high: 400 },
      deg45: { low: 0, high: 10 },
      deg90: { low: 0, high: 10 },
      deg135: { low: 0, high: 10 },
      deg180: { low: 0, high: 10 },
      diagonal: { low: 0, high: 10 },
    },
    themes: ['warm-dark', 'sepia'],
    modePattern: String.raw`/^[a-z0-9-]+(,[a-z0-9-]+)*$/`,
    clockPattern: String.raw`/^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?$/`,
    tagPattern: String.raw`/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/`,
    hexColorPattern: String.raw`/^#[0-9a-fA-F]{6}$/`,
    layoutIdPattern: String.raw`/^[0-9a-f]{64}$/`,
    madePattern: String.raw`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/`,
    serviceDatePattern: String.raw`/^\d{4}-\d{2}-\d{2}$/`,
    openedPattern: String.raw`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`,
    absolutePattern: String.raw`/^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\/])/`,
    limits: {
      ALT_MAX: 1000,
      CAPTION_MAX: 80,
      LABEL_MAX: 64,
      LINE_NAME_MAX: 40,
      COLORS_MAX: 512,
      MADE_MAX: 64,
      FOLDER_MAX: 4096,
    },
    defaultTuning: {
      mergeDistance: 50,
      grid: 'octilinear',
      gridSize: 100,
      deg45: 2,
      deg90: 1.5,
      deg135: 1,
      deg180: 0,
      diagonal: 0.5,
    },
    defaultLine: { width: 1, casingWidth: 0, dash: 'solid' },
    defaultStyle: {
      lineWidth: 7,
      lineGap: 1.6,
      stationRadius: 4.2,
      interchangeRadius: 6,
      stationStroke: 2.2,
      labelSize: 11,
      labelOffset: 9,
      padding: 24,
      stationShape: 'circle',
      interchangeShape: 'circle',
      labelFont: 'system',
      dotRadius: 5,
      trail: 0,
    },
    defaultColor: '#888888',
    defaultTheme: 'warm-dark',
    defaultMode: 'all',
    defaultChoice: { preset: 'instagram-reel', options: {} },
    feedPattern: String.raw`/^[a-z0-9][a-z0-9-]{0,63}$/`,
    idPattern: String.raw`/^[a-z][a-z0-9]{11}$/`,
  },
}

describe('the values a record accepts, for the version it is', () => {
  it('has a snapshot for this RECORD_VERSION', () => {
    expect(
      Object.keys(SNAPSHOTS).map(Number),
      `RECORD_VERSION is ${RECORD_VERSION}: add its snapshot of the value sets to SNAPSHOTS, ` +
        'taken from the sets in force (run-graph.md, "A known field\'s value")',
    ).toContain(RECORD_VERSION)
  })

  it('has not widened or changed a set without moving RECORD_VERSION', () => {
    const snapshot = SNAPSHOTS[RECORD_VERSION] ?? {}
    const current = sets()
    for (const name of Object.keys(current)) {
      const consequence = HIDING.includes(name)
        ? 'a widening hides the project from every earlier 1.x; the read-only promise does ' +
          'not survive it, and moving RECORD_VERSION does not help'
        : 'a widened value set moves RECORD_VERSION (run-graph.md, "A known field\'s value"): ' +
          'move it and add a snapshot for the new version'
      expect(
        settled(current[name]),
        `${name} is not what version ${RECORD_VERSION} accepted: ${consequence}. ` +
          'A value removed must still be read by this build (mapped, as readStyle maps ' +
          'version 1), with a test of a record that holds it. If the change is neither, ' +
          "update this version's snapshot in the same change and say why",
      ).toEqual(settled(snapshot[name]))
    }
    expect(Object.keys(snapshot).sort(), 'a set was added or removed').toEqual(
      Object.keys(current).sort(),
    )
  })
})

// ---- Rules inside the validators

// Not every rule the readers apply is a constant. These are inputs that
// every version-2 reader refuses, or drops, and that a later 1.x must go on
// finding refused: a rule loosened inside a function changes what an earlier
// build misreads just as a widened list does. Each is read through
// `parseRecord`, the one door, beside a record that holds the same field
// validly, so a refusal is not a record that failed for another reason.
const GOOD = {
  version: 2,
  id: 'aaaaaaaaaaaa',
  name: 'Kept',
  feed: 'a-feed',
}
const read = (over: Record<string, unknown>): ProjectRecord => {
  const parsed = parseRecord({ ...GOOD, ...over })
  if ('error' in parsed) throw new Error(parsed.error)
  return parsed.record
}
const choice = (options: Record<string, unknown>, more: Record<string, unknown> = {}) => ({
  preset: 'linkedin',
  options,
  ...more,
})

describe('what the version-2 readers go on refusing', () => {
  it('reads a record that holds each of the fields validly', () => {
    const record = read({
      layout: 'a'.repeat(64),
      made: '2026-10-01T12:00:00Z',
      date: '2026-09-02',
      destination: '/exports',
      opened: '2026-10-01T12:00:00.000Z',
      defaultColor: '#a1b2c3',
      colors: { A: '#a1b2c3' },
      lineOrder: ['A'],
      lines: { A: { name: 'Alpha', width: 1.2 } },
      export: choice({ at: '07:30', caption: 'One line' }, { alt: 'A map' }),
    })
    expect(record).toMatchObject({
      layout: 'a'.repeat(64),
      made: '2026-10-01T12:00:00Z',
      date: '2026-09-02',
      destination: '/exports',
      opened: '2026-10-01T12:00:00.000Z',
      defaultColor: '#a1b2c3',
      colors: { A: '#a1b2c3' },
      lines: { A: { name: 'Alpha', width: 1.2 } },
      export: { preset: 'linkedin', options: { at: '07:30', caption: 'One line' }, alt: 'A map' },
    })
  })

  it('gives up the whole export choice for a caption with a line break', () => {
    expect(read({ export: choice({ caption: 'one\ntwo' }) }).export).toEqual(DEFAULT_CHOICE)
  })

  it('gives up the whole export choice for a start time past the hour', () => {
    expect(read({ export: choice({ at: '07:60' }) }).export).toEqual(DEFAULT_CHOICE)
    expect(read({ export: choice({ at: '07:30:60' }) }).export).toEqual(DEFAULT_CHOICE)
  })

  it('drops an alt text that is blank as the engine trims it, and one that is too long', () => {
    // Python's strip() removes U+001C to U+001F, which JavaScript's trim() does not.
    expect(read({ export: choice({}, { alt: '\u001c\u001d' }) }).export.alt).toBeUndefined()
    expect(read({ export: choice({}, { alt: 'a'.repeat(1001) }) }).export.alt).toBeUndefined()
    expect(read({ export: choice({}, { alt: 'a'.repeat(1000) }) }).export.alt).toBeDefined()
  })

  it('drops a line, a colour and an order entry whose label holds a control character', () => {
    const record = read({
      colors: { 'A\u0001': '#112233' },
      lineOrder: ['A\u0001'],
      lines: { 'A\u0001': { width: 1.2 } },
    })
    expect(record.colors).toEqual({})
    expect(record.lineOrder).toEqual([])
    expect(record.lines).toBeUndefined()
  })

  it('drops the label __proto__, which a plain object could not hold', () => {
    const record = read(
      JSON.parse('{"colors":{"__proto__":"#112233"},"lines":{"__proto__":{"width":1.2}}}'),
    )
    expect(Object.keys(record.colors)).toEqual([])
    expect(record.lines).toBeUndefined()
  })

  it('drops a line name with a line break of any kind, and one that is too long', () => {
    for (const name of ['a\nb', 'a b', 'x'.repeat(41)])
      expect(read({ lines: { A: { name } } }).lines, JSON.stringify(name)).toBeUndefined()
  })

  it('reads a layout id that is not 64 hex digits as none', () => {
    for (const layout of ['abc', 'A'.repeat(64), 'a'.repeat(63)])
      expect(read({ layout }).layout, layout).toBeNull()
  })

  it('reads a colour that is not #rrggbb as the default, and drops it from the palette', () => {
    const record = read({ defaultColor: '#fff', colors: { A: '#fff', B: '112233' } })
    expect(record.defaultColor).toBe(DEFAULT_COLOR)
    expect(record.colors).toEqual({})
  })

  it('reads a destination that is not an absolute folder as the app’s own', () => {
    for (const destination of ['exports', '../exports', '', 'C:exports'])
      expect(read({ destination }).destination, destination).toBeNull()
  })

  it('reads a made, a day and an opened moment of the wrong shape as none', () => {
    const record = read({ made: '2026-10-01', date: '2026-9-2', opened: 'yesterday' })
    expect([record.made, record.date, record.opened]).toEqual([null, null, null])
  })

  it('reads a tuning number out of its range, and a line width out of its range, as not held', () => {
    expect(read({ tuning: { gridSize: 24 } }).tuning).toBeUndefined()
    expect(read({ lines: { A: { width: 1.6 } } }).lines).toBeUndefined()
  })

  it('refuses a record whose identifier or feed is not one, which hides it', () => {
    expect(parseRecord({ ...GOOD, id: 'ABC' })).toHaveProperty('error')
    expect(parseRecord({ ...GOOD, feed: 'Bad Feed' })).toHaveProperty('error')
  })
})

// ---- The document says what the code does

describe('docs/compatibility.md', () => {
  // The document is wrapped for reading; a sentence is found by its words.
  let text: string
  beforeEach(async () => {
    text = (
      await readFile(join(__dirname, '..', '..', 'docs', 'compatibility.md'), 'utf8')
    ).replace(/\s+/g, ' ')
  })

  it('still states the rules this file holds', () => {
    for (const sentence of [
      // The settings behaviour the two tests above pin.
      'A version also keeps only the settings it knows, and only the values it knows for them.',
      'when you change one, when you move or resize its window and when you close it, if it has moved',
      'A file that is not settings at all, such as one that is not valid JSON, starts the app with every setting at its default.',
      // The value-set rule the snapshot pins.
      'A new choice for a setting an earlier version already has raises the version number.',
      'A test holds this: it lists the choices a record can hold today, and the shapes its values must have',
      'that can mean the whole export choice (the fields of an opening are read one by one',
      'Two projects with the same name share a folder, and so do two whose names differ only in what the cleaning removes.',
      // The read-only promise the store's tests pin.
      'The earlier version opens it **read-only**',
    ])
      expect(text, `docs/compatibility.md no longer says: ${sentence}`).toContain(sentence)
  })
})
