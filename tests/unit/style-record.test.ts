// The record's sizes (issue 350, ADR-049): how a record that holds them is
// read, the ranges and sentences the engine's own are held to, and exactly
// which fields a style sends.
//
// The reader's rule is the one that keeps every existing project's map where
// it is: a version-1 record stored `10, 8, 11, 26`, which the app never sent
// and which are not the engine's, and sending them would redraw every project
// anyone has made. Each test below was watched failing under a mutation of the
// rule it holds; the mutation is named beside it.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STYLE,
  drawnFrom,
  inStyleRange,
  parseRecord,
  RECORD_VERSION,
  sameStyle,
  settledStyle,
  STYLE_KEYS,
  STYLE_RANGES,
  styleIsSet,
  styleRangeSentence,
  styleRefusals,
  styleSent,
  validateStyle,
  type ProjectRecord,
  type ProjectStyle,
} from '../../src/shared/project'

const ID = 'kq7x2mzp4dna'

/** What a version-1 record stored for the four numbers it had. */
const OLD = { lineWidth: 10, stationRadius: 8, interchangeRadius: 11, labelSize: 26 }

const read = (json: Record<string, unknown>): ProjectRecord => {
  const parsed = parseRecord({ id: ID, name: 'Los Angeles', feed: 'la-metro-rail', ...json })
  if (!('record' in parsed)) throw new Error(parsed.error)
  return parsed.record
}

describe('reading a record from before the sizes were the engine’s (version 1)', () => {
  it('reads the four numbers every old project holds as nothing chosen', () => {
    // Mutation: the equal-to-old-defaults rule removed from `readStyle`.
    // Every old project would then read as having set four numbers, and
    // would send them: the map of every existing project would change.
    expect(read({ version: 1, style: OLD }).style).toEqual({})
  })

  it('reads a record with no style, or part of one, as the same', () => {
    expect(read({ version: 1 }).style).toEqual({})
    expect(read({ version: 1, style: {} }).style).toEqual({})
    // A number missing was filled by the old reader with its old default,
    // so the rest being old defaults still sets nothing.
    expect(read({ version: 1, style: { lineWidth: 10, labelSize: 26 } }).style).toEqual({})
    // And a number that is not one counts as missing.
    expect(read({ version: 1, style: { ...OLD, labelSize: 'big' } }).style).toEqual({})
  })

  it('keeps any other number as one that was set, and only that one', () => {
    // If anyone ever wrote one by hand, it is theirs and it is kept. It is
    // read field by field: the three old defaults beside it are still unset,
    // and are not sent as choices (8, 11 and 26 are not the engine's).
    // Mutation: the all-or-nothing reading, which keeps all four.
    expect(read({ version: 1, style: { ...OLD, lineWidth: 12 } }).style).toEqual({
      lineWidth: 12,
    })
    expect(read({ version: 1, style: { ...OLD, labelSize: 27 } }).style).toEqual({
      labelSize: 27,
    })
    expect(read({ version: 1, style: { ...OLD, stationRadius: 5 } }).style).toEqual({
      stationRadius: 5,
    })
    expect(read({ version: 1, style: { lineWidth: 12 } }).style).toEqual({ lineWidth: 12 })
    // Every one changed: every one kept.
    expect(
      read({
        version: 1,
        style: { lineWidth: 11, stationRadius: 9, interchangeRadius: 12, labelSize: 27 },
      }).style,
    ).toEqual({ lineWidth: 11, stationRadius: 9, interchangeRadius: 12, labelSize: 27 })
  })

  it('keeps a field the old build could not have written, even beside the four', () => {
    expect(read({ version: 1, style: { ...OLD, lineGap: 2 } }).style).toEqual({ lineGap: 2 })
  })
})

describe('reading a record the sizes of which are the engine’s (version 2)', () => {
  it('reads the numbers as written, the old defaults among them', () => {
    // Mutation: the old-defaults rule applied to every version, not only
    // version 1. A person who chose 10, 8, 11 and 26 in this build would
    // find them gone on the next open.
    expect(RECORD_VERSION).toBeGreaterThanOrEqual(2)
    expect(read({ version: RECORD_VERSION, style: OLD }).style).toEqual(OLD)
  })

  it('reads all eight fields, each optional', () => {
    const all: ProjectStyle = {
      lineWidth: 12,
      lineGap: 2,
      stationRadius: 5,
      interchangeRadius: 9,
      stationStroke: 3,
      labelSize: 20,
      labelOffset: 12,
      padding: 40,
    }
    expect(read({ version: RECORD_VERSION, style: all }).style).toEqual(all)
    expect(read({ version: RECORD_VERSION, style: { padding: 0 } }).style).toEqual({ padding: 0 })
    expect(read({ version: RECORD_VERSION }).style).toEqual({})
  })

  it('drops what is not a number, and a name that is not one of the eight', () => {
    const style = read({
      version: RECORD_VERSION,
      style: {
        lineWidth: '12',
        lineGap: null,
        stationRadius: true,
        interchangeRadius: Infinity,
        labelSize: 20,
        background: '#000000',
        themed: false,
      },
    }).style
    expect(style).toEqual({ labelSize: 20 })
  })

  it('keeps a number outside the engine’s range, and refuses it where it is shown', () => {
    // Kept and not clamped: the cell shows what the record says, with the
    // engine's sentence beside it, and nothing is sent until it is fixed.
    const record = read({ version: RECORD_VERSION, style: { lineWidth: 99, labelSize: 20 } })
    expect(record.style).toEqual({ lineWidth: 99, labelSize: 20 })
    expect(styleRefusals(record.style)).toEqual({
      lineWidth: "style.line_width must be from 1 to 24, in SVG user units at the map's width",
    })
    expect(styleSent(record.style), 'the other field waits with the refused one').toEqual({})
  })
})

describe('what a map drawn with a style remembers', () => {
  const drew: ProjectRecord = {
    ...read({ version: RECORD_VERSION }),
    layout: 'a'.repeat(64),
    made: '2026-09-10T12:00:00+00:00',
    date: '2026-09-12',
    style: { lineWidth: 12, stationRadius: 7, interchangeRadius: 9 },
  }

  it('is the style as it was sent', () => {
    expect(drawnFrom(drew)?.style).toEqual({
      lineWidth: 12,
      stationRadius: 7,
      interchangeRadius: 9,
    })
    expect(drawnFrom({ ...drew, style: { stationRadius: 5 } })?.style).toEqual({
      stationRadius: 5,
      interchangeRadius: DEFAULT_STYLE.interchangeRadius,
    })
    expect(drawnFrom({ ...drew, style: {} })?.style).toEqual({})
  })

  it('reads back as written, and a block from before the field drew with none', () => {
    const drawn = drawnFrom(drew)
    expect(read({ ...drew, drawn }).drawn).toEqual(drawn)
    const { style: _style, ...before } = drawn as NonNullable<typeof drawn>
    void _style
    expect(read({ ...drew, drawn: before }).drawn?.style).toEqual({})
  })
})

describe('what the engine accepts of each field', () => {
  const schema = JSON.parse(
    readFileSync(resolve(__dirname, '../../vendor/protocol.schema.json'), 'utf8'),
  ) as {
    $defs: {
      MapStyle: {
        properties: Record<string, { minimum?: number; maximum?: number; description: string }>
      }
    }
  }
  const wire = schema.$defs.MapStyle.properties

  it('is the engine’s own range and name for every field, from the committed schema', () => {
    for (const key of STYLE_KEYS) {
      const { wire: name, low, high } = STYLE_RANGES[key]
      expect(wire[name], key).toBeDefined()
      expect(wire[name].minimum, `${key} minimum`).toBe(low)
      expect(wire[name].maximum, `${key} maximum`).toBe(high)
    }
  })

  it('is the engine’s own number when a field is left out, from the schema’s words', () => {
    for (const key of STYLE_KEYS) {
      const said = /(\d+(?:\.\d+)?) when omitted/.exec(wire[STYLE_RANGES[key].wire].description)
      expect(said, key).not.toBeNull()
      expect(DEFAULT_STYLE[key], key).toBe(Number(said?.[1]))
    }
  })

  it('names no field the schema does not, and leaves out the four colours', () => {
    const named = new Set(STYLE_KEYS.map((key) => STYLE_RANGES[key].wire))
    const left = Object.keys(wire).filter((name) => !named.has(name))
    // The four colours the page's theme owns, and the four fields engine
    // v0.15.0 added that the app does not send yet (the named looks, the
    // two markers and the label face): each is an issue of its own, and
    // the one that sends it moves it out of this list.
    expect(left.sort()).toEqual([
      'background',
      'interchange_shape',
      'label_color',
      'label_font',
      'preset',
      'station_fill',
      'station_shape',
      'station_stroke_color',
    ])
  })

  it('says it in the engine’s sentence, word for word', () => {
    // `serve._style` at v0.12.0.
    expect(styleRangeSentence('lineWidth')).toBe(
      "style.line_width must be from 1 to 24, in SVG user units at the map's width",
    )
    expect(styleRangeSentence('lineGap')).toBe(
      'style.line_gap must be from 1 to 3, as a multiple of line_width',
    )
    expect(styleRangeSentence('padding')).toBe(
      "style.padding must be from 0 to 200, in SVG user units at the map's width",
    )
  })
})

describe('what the engine would refuse', () => {
  it('takes either end of every range and refuses a step past it', () => {
    for (const key of STYLE_KEYS) {
      const { low, high } = STYLE_RANGES[key]
      expect(inStyleRange(key, low), `${key} at ${low}`).toBe(true)
      expect(inStyleRange(key, high), `${key} at ${high}`).toBe(true)
      for (const past of [low - 0.1, high + 0.1])
        expect(styleRefusals({ [key]: past })[key], `${key} at ${past}`).toBe(
          styleRangeSentence(key),
        )
    }
  })

  it('refuses what is not a number, in the same sentence', () => {
    for (const bad of [NaN, Infinity, '12', null, true] as unknown[])
      expect(styleRefusals({ lineWidth: bad as number }).lineWidth, String(bad)).toBe(
        styleRangeSentence('lineWidth'),
      )
  })

  it('judges the two radii together, on what the map would be drawn with', () => {
    const sentence = (i: number, s: number): string =>
      `style.interchange_radius (${i}) must not be below style.station_radius (${s}); ` +
      'a field left out counts as its default, so send both'
    // A station radius above the interchange radius's default of 6, sent
    // alone, is refused by the engine, and so here, before it is sent.
    expect(styleRefusals({ stationRadius: 8 })).toEqual({ interchangeRadius: sentence(6, 8) })
    expect(styleRefusals({ interchangeRadius: 3 })).toEqual({ interchangeRadius: sentence(3, 4.2) })
    expect(styleRefusals({ stationRadius: 8, interchangeRadius: 7 })).toEqual({
      interchangeRadius: sentence(7, 8),
    })
    // Equal is taken: "not below".
    expect(styleRefusals({ stationRadius: 8, interchangeRadius: 8 })).toEqual({})
    expect(styleRefusals({ stationRadius: 8, interchangeRadius: 9 })).toEqual({})
    expect(styleRefusals({ stationRadius: 6 })).toEqual({})
  })

  it('judges the range of a radius before the pair, as the engine does', () => {
    expect(styleRefusals({ stationRadius: 25 })).toEqual({
      stationRadius: styleRangeSentence('stationRadius'),
    })
  })

  it('is what a store is asked about before it writes', () => {
    expect(validateStyle({})).toBeNull()
    expect(validateStyle({ lineWidth: 12, padding: 0 })).toBeNull()
    expect(validateStyle({ lineWidth: 99 })).toBe(styleRangeSentence('lineWidth'))
    expect(validateStyle({ lineWidth: '12' })).toBe(styleRangeSentence('lineWidth'))
    expect(validateStyle({ stationRadius: 8 })).toMatch(/^style\.interchange_radius \(6\)/)
    expect(validateStyle({ background: '#000000' })).toBe('the style does not take background')
    expect(validateStyle(null)).toBe('the style must be an object')
    expect(validateStyle([1])).toBe('the style must be an object')
  })
})

describe('what a style sends', () => {
  it('sends nothing for a style nobody has set', () => {
    expect(styleIsSet({})).toBe(false)
    expect(styleSent({})).toEqual({})
  })

  it('sends only the fields that were set', () => {
    expect(styleSent({ lineWidth: 12 })).toEqual({ lineWidth: 12 })
    expect(styleSent({ labelSize: 20, padding: 0 })).toEqual({ labelSize: 20, padding: 0 })
  })

  it('does not send a field at the engine’s own number', () => {
    // Mutation: a field equal to its default sent anyway. It would draw
    // what is drawn without it, and make a project that chose nothing look
    // as if it had.
    expect(styleSent({ lineWidth: DEFAULT_STYLE.lineWidth })).toEqual({})
    expect(styleIsSet({ lineWidth: DEFAULT_STYLE.lineWidth })).toBe(false)
    expect(styleSent({ ...DEFAULT_STYLE })).toEqual({})
    expect(styleSent({ ...DEFAULT_STYLE, labelSize: 20 })).toEqual({ labelSize: 20 })
  })

  it('sends both radii whenever either is set, the one not set as the engine’s', () => {
    // Mutation: the unset radius left out. The engine judges the pair on
    // the values the map would be drawn with, and a client that raises one
    // sends the other.
    expect(styleSent({ stationRadius: 5 })).toEqual({
      stationRadius: 5,
      interchangeRadius: DEFAULT_STYLE.interchangeRadius,
    })
    expect(styleSent({ interchangeRadius: 9 })).toEqual({
      stationRadius: DEFAULT_STYLE.stationRadius,
      interchangeRadius: 9,
    })
    expect(styleSent({ stationRadius: 8, interchangeRadius: 9 })).toEqual({
      stationRadius: 8,
      interchangeRadius: 9,
    })
    // One at the engine's own number still goes with the other that is set.
    expect(styleSent({ stationRadius: DEFAULT_STYLE.stationRadius, interchangeRadius: 9 })).toEqual(
      { stationRadius: DEFAULT_STYLE.stationRadius, interchangeRadius: 9 },
    )
    // And neither goes when neither was chosen.
    expect(styleSent({ lineWidth: 12 })).not.toHaveProperty('stationRadius')
  })

  it('sends nothing at all of a style the engine would refuse', () => {
    expect(styleSent({ lineWidth: 99, labelSize: 20 })).toEqual({})
    expect(styleSent({ stationRadius: 8, labelSize: 20 })).toEqual({})
  })

  it('never carries one of the four colours', () => {
    // ADR-049's criterion: the page's theme owns the furniture. The type has
    // no such field, and a style handed one anyway sends none of them.
    const handed = {
      ...DEFAULT_STYLE,
      lineWidth: 12,
      background: '#000000',
      station_fill: '#ffffff',
      stationFill: '#ffffff',
      stationStrokeColor: '#111111',
      labelColor: '#111111',
      label_color: '#111111',
    } as ProjectStyle
    const sent = styleSent(handed)
    expect(Object.keys(sent)).toEqual(['lineWidth'])
    const everything = Object.fromEntries(
      STYLE_KEYS.map((key, i) => [key, STYLE_RANGES[key].high - (i % 2)]),
    ) as ProjectStyle
    for (const key of Object.keys(styleSent({ ...everything, interchangeRadius: 20 })))
      expect(STYLE_KEYS as readonly string[], key).toContain(key)
  })

  it('compares two styles by what they send, not by how they were written', () => {
    expect(sameStyle({}, {})).toBe(true)
    expect(sameStyle({}, { lineWidth: DEFAULT_STYLE.lineWidth })).toBe(true)
    expect(sameStyle({ lineWidth: 12 }, { lineWidth: 12 })).toBe(true)
    expect(sameStyle({ lineWidth: 12 }, {})).toBe(false)
    expect(sameStyle({ lineWidth: 12 }, { lineWidth: 13 })).toBe(false)
  })

  it('keeps what was chosen and drops the rest, refused numbers included', () => {
    expect(settledStyle({ lineWidth: 7, labelSize: 20, padding: undefined })).toEqual({
      labelSize: 20,
    })
    expect(settledStyle({ lineWidth: 99 })).toEqual({ lineWidth: 99 })
  })
})
