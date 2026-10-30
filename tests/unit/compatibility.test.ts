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
import { RECORD_VERSION } from '../../src/main/record/parse'
import { SETTINGS_FILE, SettingsStore } from '../../src/main/settings'
import { VIEWS } from '../../src/shared/capture'
import {
  ALT_MAX,
  CAPTION_MAX,
  CLOCK_CORNERS,
  CLOCK_PATTERN,
  OFFERED_PRESETS,
  QUALITIES,
  STORYBOARD_NAMES,
  TAG_PATTERN,
} from '../../src/shared/export'
import { CARD_SECONDS, DRAW_IN_SECONDS, OPENINGS } from '../../src/shared/opening'
import {
  CASING_WIDTH_RANGE,
  GRIDS,
  LINE_DASHES,
  LINE_NAME_MAX,
  LINE_WIDTH_RANGE,
  STYLE_CHOICES,
  THEMES,
  TUNING_RANGES,
} from '../../src/shared/project/types'
import { COLORS_MAX, LABEL_MAX, MODE_PATTERN } from '../../src/shared/project/validate'
import { parseSettings } from '../../src/shared/settings'

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
// keyed to the version they are the sets of, and a widening fails here until
// the version moves and its snapshot is added, or the change is shown to be
// no widening.
//
// In: every closed list and pattern and every range that the record's readers
// (`readRecord`, `readStoredChoice`, `readTuning`, `readLines`,
// `readOpeningFields`) take a value by, and whose refusal gives the field up.
// Out, and why: the style's and the trains' ranges (`STYLE_RANGES`,
// `TRAIN_RANGES`), which the reader keeps whatever number it finds; the feed
// key, the identifier and the facts (`service`, `built`, `drawn`,
// `laidOutWith`), whose refusal makes the record unreadable or is renewed by
// the next draw, so nothing a person chose is rewritten; the colour pattern,
// which is the engine's own `#rrggbb`.
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
  modePattern: MODE_PATTERN.source,
  clockPattern: CLOCK_PATTERN.source,
  tagPattern: TAG_PATTERN.source,
  limits: { ALT_MAX, CAPTION_MAX, LABEL_MAX, LINE_NAME_MAX, COLORS_MAX },
})

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
    modePattern: '^[a-z0-9-]+(,[a-z0-9-]+)*$',
    clockPattern: '^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?$',
    tagPattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$',
    limits: { ALT_MAX: 1000, CAPTION_MAX: 80, LABEL_MAX: 64, LINE_NAME_MAX: 40, COLORS_MAX: 512 },
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
      expect(
        current[name],
        `${name} is not what version ${RECORD_VERSION} accepted: a widened value set moves ` +
          'RECORD_VERSION (run-graph.md, "A known field\'s value"). Move it and add a snapshot ' +
          'for the new version, or, if the change cannot make an earlier version misread a ' +
          "stored value, update this version's snapshot in the same change and say why",
      ).toEqual(snapshot[name])
    }
    expect(Object.keys(snapshot).sort(), 'a set was added or removed').toEqual(
      Object.keys(current).sort(),
    )
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
      'when you change one, when you move or resize its window and when you close it',
      'A file that is not settings at all, such as one that is not valid JSON, starts the app with every setting at its default.',
      // The value-set rule the snapshot pins.
      'A new choice for a setting an earlier version already has raises the version number.',
      'A test holds this: it lists the choices a record can hold today',
      // The read-only promise the store's tests pin.
      'The earlier version opens it **read-only**',
    ])
      expect(text, `docs/compatibility.md no longer says: ${sentence}`).toContain(sentence)
  })
})
