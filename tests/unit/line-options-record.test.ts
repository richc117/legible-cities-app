// A line's options in the record and on the wire (issue 394, spec 036): what
// the engine takes of each, held to the committed schema; the engine's own
// sentences for what it refuses; what is kept, what a hand-edited record
// reads as, what a draw remembers, and exactly what `map.build` is sent.
//
// Each test was watched failing under a mutation of the rule it holds; the
// mutation is named beside it.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { linesParams } from '../../src/renderer/src/lineOptions'
import {
  CASING_WIDTH_RANGE,
  DEFAULT_CASING_COLOR,
  DEFAULT_LINE,
  drawnFrom,
  isLineName,
  LINE_DASHES,
  LINE_NAME_MAX,
  LINE_WIDTH_RANGE,
  lineNameSentence,
  linesAreSet,
  linesSent,
  parseRecord,
  pythonRepr,
  RECORD_VERSION,
  readLines,
  sameLines,
  settledLine,
  validateLineChoice,
  validateLines,
  type ProjectRecord,
} from '../../src/shared/project'

const ID = 'kq7x2mzp4dna'
const LAYOUT = 'a'.repeat(64)

const read = (json: Record<string, unknown>): ProjectRecord => {
  const parsed = parseRecord({
    version: RECORD_VERSION,
    id: ID,
    name: 'Los Angeles',
    feed: 'la-metro-rail',
    ...json,
  })
  if (!('record' in parsed)) throw new Error(parsed.error)
  return parsed.record
}

/** A line break of each kind the engine refuses, built from its code so no source holds one. */
const BREAKS = [0x0d, 0x0a, 0x2028, 0x2029].map((code) => String.fromCodePoint(code))

describe('what the engine takes of a line, from the committed schema', () => {
  const schema = JSON.parse(
    readFileSync(resolve(__dirname, '../../vendor/protocol.schema.json'), 'utf8'),
  ) as {
    $defs: Record<
      string,
      {
        properties: Record<
          string,
          {
            minimum?: number
            maximum?: number
            minLength?: number
            maxLength?: number
            pattern?: string
            enum?: string[]
            default?: unknown
          }
        >
        required?: string[]
        additionalProperties?: boolean
      }
    >
  }
  const options = schema.$defs.LineOptions
  const casing = schema.$defs.LineCasing

  it('has the five fields and no other, the casing exactly two', () => {
    // Mutation: `dash` left off the list of fields - a dashed line would then
    // be refused here and taken by the engine.
    expect(Object.keys(options.properties)).toEqual(['name', 'hidden', 'width', 'casing', 'dash'])
    expect(options.additionalProperties).toBe(false)
    for (const field of Object.keys(options.properties)) {
      const value =
        field === 'name'
          ? 'Alpha'
          : field === 'hidden'
            ? true
            : field === 'width'
              ? 1.25
              : field === 'casing'
                ? { width: 0.5, color: '#112233' }
                : 'dashed'
      expect(validateLineChoice('A', { [field]: value }), field).toBeNull()
    }
    expect(Object.keys(casing.properties).sort()).toEqual(['color', 'width'])
    expect([...(casing.required ?? [])].sort()).toEqual(['color', 'width'])
  })

  it('is the engine’s own length and pattern for a name', () => {
    // Mutation: LINE_NAME_MAX 64 (a label's bound) in place of 40.
    expect(options.properties.name.minLength).toBe(1)
    expect(options.properties.name.maxLength).toBe(LINE_NAME_MAX)
    const pattern = new RegExp(options.properties.name.pattern as string, 'u')
    for (const name of ['A', 'Airport Express', 'x'.repeat(40), ...BREAKS.map((b) => `a${b}b`)])
      expect(isLineName(name), JSON.stringify(name)).toBe(
        pattern.test(name) && [...name].length >= 1 && [...name].length <= 40,
      )
    expect(isLineName('x'.repeat(41))).toBe(false)
    expect(isLineName('')).toBe(false)
  })

  it('counts a name in code points, as the engine does', () => {
    // Mutation: `value.length` (UTF-16 units) - forty trains, each two units,
    // would then be refused here and taken by the engine.
    const train = String.fromCodePoint(0x1f686)
    expect(isLineName(train.repeat(40))).toBe(true)
    expect(isLineName(train.repeat(41))).toBe(false)
  })

  it('refuses a very long name without reading it character by character', () => {
    // Mutation: the length bound before the spread removed - the main
    // process would allocate an array of the renderer's whole string, one
    // entry per character, before it said no.
    const huge = 'x'.repeat(LINE_NAME_MAX * 2 + 1)
    const iterate = vi.spyOn(String.prototype, Symbol.iterator)
    try {
      expect(isLineName(huge)).toBe(false)
      expect(iterate).not.toHaveBeenCalled()
    } finally {
      iterate.mockRestore()
    }
    // At the bound itself it is still counted in code points.
    expect(isLineName('x'.repeat(LINE_NAME_MAX * 2))).toBe(false)
    expect(isLineName(String.fromCodePoint(0x1f686).repeat(LINE_NAME_MAX))).toBe(true)
  })

  it('is the engine’s own range for a width and a casing, and its dashes', () => {
    // Mutation: LINE_WIDTH_RANGE's high 3, the issue's first range - the
    // engine refuses anything past 1.5 since v0.16.0.
    expect([options.properties.width.minimum, options.properties.width.maximum]).toEqual([
      LINE_WIDTH_RANGE.low,
      LINE_WIDTH_RANGE.high,
    ])
    expect(options.properties.width.default).toBe(DEFAULT_LINE.width)
    expect([casing.properties.width.minimum, casing.properties.width.maximum]).toEqual([
      CASING_WIDTH_RANGE.low,
      CASING_WIDTH_RANGE.high,
    ])
    expect(options.properties.dash.enum).toEqual([...LINE_DASHES])
    expect(options.properties.dash.default).toBe(DEFAULT_LINE.dash)
  })

  it('draws a casing white until a colour is chosen', () => {
    // Mutation: the default black - a casing chosen on a dark map would then
    // start as a colour that does not read on it.
    expect(DEFAULT_CASING_COLOR).toBe('#ffffff')
  })
})

describe('the engine’s sentences for what it refuses', () => {
  // `serve._lines` at v0.16.0, word for word, the label in Python's repr.
  const cases: [unknown, string][] = [
    [7, "lines['A'] must be an object of name, hidden, width, casing and dash"],
    [{ name: '' }, "lines['A'].name must be from 1 to 40 characters with no line break"],
    [
      { name: 'x'.repeat(41) },
      "lines['A'].name must be from 1 to 40 characters with no line break",
    ],
    [{ name: 7 }, "lines['A'].name must be from 1 to 40 characters with no line break"],
    [{ hidden: 'yes' }, "lines['A'].hidden must be true or false"],
    [{ width: 2 }, "lines['A'].width must be from 0.75 to 1.5, as a multiple of line_width"],
    [{ width: 0.5 }, "lines['A'].width must be from 0.75 to 1.5, as a multiple of line_width"],
    [{ width: true }, "lines['A'].width must be from 0.75 to 1.5, as a multiple of line_width"],
    [{ casing: 0.5 }, "lines['A'].casing must be an object of width and color"],
    [
      { casing: { width: 0.5, color: '#ffffff', dash: 1 } },
      "lines['A'].casing must be an object of width and color",
    ],
    [{ casing: { width: 0.5 } }, "lines['A'].casing must have both width and color"],
    [
      { casing: { width: 2, color: '#ffffff' } },
      "lines['A'].casing.width must be from 0 to 1, as a multiple of line_width on each side",
    ],
    [
      { casing: { width: 0.5, color: 'white' } },
      "lines['A'].casing.color must be a colour written #rrggbb",
    ],
    [{ dash: 'wavy' }, "lines['A'].dash must be solid, dashed or dotted"],
    [{ colour: '#ff0000', alias: 'x' }, "lines['A'] does not take alias, colour"],
  ]

  it('refuses each in its own sentence, in the engine’s order', () => {
    // Mutation: the dash judged before the width - a line refused for both
    // would then name its dash where the engine names its width.
    for (const [choice, sentence] of cases)
      expect(validateLineChoice('A', choice), JSON.stringify(choice)).toBe(sentence)
    expect(validateLineChoice('A', { width: 2, dash: 'wavy' }), 'the width first').toBe(
      "lines['A'].width must be from 0.75 to 1.5, as a multiple of line_width",
    )
  })

  it('takes the whole of each field’s range, and every field at once', () => {
    // Mutation: the width's top end exclusive - Heavy, 1.5, would then be
    // refused here and taken by the engine.
    for (const width of [0.75, 1, 1.1, 1.5])
      expect(validateLineChoice('A', { width }), String(width)).toBeNull()
    for (const width of [0, 0.25, 1])
      expect(validateLineChoice('A', { casing: { width, color: '#000000' } })).toBeNull()
    expect(
      validateLineChoice('A', {
        name: 'Airport Express',
        hidden: false,
        width: 1.25,
        casing: { width: 0.5, color: '#112233' },
        dash: 'dotted',
      }),
    ).toBeNull()
  })

  it('reads a field given as undefined as one not given, as the style’s validator does', () => {
    // Mutation: a field judged by `in` - a cleared name sent as undefined over
    // the bridge would then be refused.
    expect(validateLineChoice('A', { name: undefined, width: 1.25 })).toBeNull()
  })

  it('refuses the options as a whole where the engine does, and a label the record cannot hold', () => {
    // Mutation: `validateLines` checks the entries and not the labels - a
    // label of `__proto__` would be written and never read back.
    expect(validateLines([])).toBe(
      "lines must be an object of line label to the line's name, hidden, width, casing and dash",
    )
    expect(validateLines(null)).toBe(
      "lines must be an object of line label to the line's name, hidden, width, casing and dash",
    )
    expect(validateLines({})).toBeNull()
    expect(validateLines({ A: { hidden: true }, B: { width: 1.5 } })).toBeNull()
    expect(validateLines(JSON.parse('{"__proto__": {"hidden": true}}'))).toBe(
      'a line cannot be called __proto__',
    )
    expect(validateLines({ '': { hidden: true } })).toBe('a line needs a label')
    expect(validateLines({ ['x'.repeat(65)]: { hidden: true } })).toMatch(/too long/)
    expect(validateLines({ B: { dash: 'wavy' } })).toBe(
      "lines['B'].dash must be solid, dashed or dotted",
    )
    const many = Object.fromEntries(
      Array.from({ length: 513 }, (_unused, i) => [`line-${i}`, { hidden: true }]),
    )
    expect(validateLines(many)).toBe('that is more than 512 lines')
  })

  it('writes a label as Python’s repr does', () => {
    // Mutation: the label in plain single quotes - "it's" then reads
    // lines['it's'], which is not the engine's sentence.
    expect(pythonRepr('A')).toBe("'A'")
    expect(pythonRepr("it's")).toBe(`"it's"`)
    expect(pythonRepr('say "hi"')).toBe(`'say "hi"'`)
    expect(pythonRepr(`a'b"c`)).toBe(`'a\\'b"c'`)
    expect(pythonRepr('a\\b')).toBe(`'a\\\\b'`)
    expect(pythonRepr(`x${String.fromCodePoint(0xa0)}y`)).toBe(`'x\\xa0y'`)
    expect(pythonRepr(`x${String.fromCodePoint(0x200b)}y`)).toBe(`'x\\u200by'`)
    expect(pythonRepr(`x${String.fromCodePoint(0xe0001)}y`)).toBe(`'x\\U000e0001y'`)
    expect(pythonRepr('Línea 1')).toBe("'Línea 1'")
    expect(lineNameSentence("it's")).toBe(
      `lines["it's"].name must be from 1 to 40 characters with no line break`,
    )
  })
})

describe('what is kept of a line’s options', () => {
  it('keeps only what is not the engine’s own', () => {
    // Mutation: `settledLine` keeps `hidden: false` - every line shown again
    // would then send it.
    expect(settledLine('A', { hidden: false, width: 1, dash: 'solid' })).toEqual({})
    expect(settledLine('A', { casing: { width: 0, color: '#112233' } })).toEqual({})
    expect(settledLine('A', { name: 'A' }), 'the line’s own label is no name').toEqual({})
    expect(
      settledLine('A', {
        dash: 'dashed',
        casing: { width: 0.5, color: '#112233' },
        width: 1.25,
        hidden: true,
        name: 'Airport Express',
      }),
      'in the engine’s order',
    ).toEqual({
      name: 'Airport Express',
      hidden: true,
      width: 1.25,
      casing: { width: 0.5, color: '#112233' },
      dash: 'dashed',
    })
    expect(
      Object.keys(settledLine('A', { dash: 'dashed', name: 'X', hidden: true })),
      'the keys in the engine’s order',
    ).toEqual(['name', 'hidden', 'dash'])
  })

  it('drops a line with nothing left, so a project that chose nothing keeps nothing', () => {
    // Mutation: `linesSent` keeps an empty entry - `{ A: {} }` would then be
    // written, and sent to the engine on every draw.
    expect(linesSent({ A: { hidden: false }, B: { width: 1.5 } })).toEqual({ B: { width: 1.5 } })
    expect(linesSent({ A: {} })).toEqual({})
    expect(linesSent(undefined)).toEqual({})
    expect(linesAreSet({ A: { dash: 'solid' } })).toBe(false)
    expect(linesAreSet({ A: { dash: 'dotted' } })).toBe(true)
  })

  it('compares two sets as they would be sent, whatever their order', () => {
    // Mutation: the labels compared in the order they were written.
    expect(
      sameLines(
        { A: { hidden: true }, B: { width: 1.5 } },
        { B: { width: 1.5 }, A: { hidden: true } },
      ),
    ).toBe(true)
    expect(sameLines(undefined, { A: { hidden: false } })).toBe(true)
    expect(sameLines({ A: { hidden: true } }, { A: { hidden: true, width: 1.25 } })).toBe(false)
  })
})

describe('reading the options a record holds', () => {
  it('reads a record from before them as having none, and writes no key back', () => {
    // Mutation: `readLines` answers `{}` for nothing - a record that never chose
    // would then be written back with the key.
    expect(read({}).lines).toBeUndefined()
    expect('lines' in read({})).toBe(false)
    expect(read({ lines: {} }).lines).toBeUndefined()
    expect(read({ lines: 'none' }).lines).toBeUndefined()
  })

  it('reads them as written', () => {
    // Mutation: a casing read only with a third key - every casing a record
    // holds would then be dropped.
    const lines = {
      A: { name: 'Airport Express', width: 1.25 },
      B: { hidden: true, casing: { width: 1, color: '#ffffff' }, dash: 'dotted' },
    }
    expect(read({ lines }).lines).toEqual(lines)
  })

  it('reads a field the store would refuse as not held, field by field', () => {
    // Mutation: the reader keeps a width out of range (the sizes' rule) - a
    // width of 2 written by hand would then be sent and refused by the
    // engine on every draw, a colour change among them.
    expect(
      read({
        lines: {
          A: { name: 'x'.repeat(41), width: 2, dash: 'dashed' },
          B: { casing: { width: 0.5 }, hidden: 'yes' },
          C: { casing: { width: 0.5, color: '#112233', extra: 1 }, colour: '#ff0000' },
          D: { hidden: false, width: 1 },
          E: 7,
          F: { casing: { width: 0.25, color: '#112233' } },
        },
      }).lines,
    ).toEqual({ A: { dash: 'dashed' }, F: { casing: { width: 0.25, color: '#112233' } } })
    expect(readLines({ A: { name: `a${BREAKS[2]}b` } })).toBeUndefined()
  })

  it('reads no more lines than a record holds colours', () => {
    // Mutation: the reader's cap removed.
    const many = Object.fromEntries(
      Array.from({ length: 600 }, (_unused, i) => [`line-${i}`, { hidden: true }]),
    )
    expect(Object.keys(readLines(many) ?? {})).toHaveLength(512)
  })
})

describe('what a map drawn with line options remembers', () => {
  const drew: ProjectRecord = {
    ...read({}),
    layout: LAYOUT,
    made: '2026-09-10T12:00:00+00:00',
    date: '2026-09-12',
    lines: { B: { hidden: true }, A: { width: 1, dash: 'dashed' } },
  }

  it('is the options as they were sent, and no key for none', () => {
    // Mutation: `drawnFrom` leaves the lines out - the map's own options would
    // then never be in what it was drawn from.
    expect(drawnFrom(drew)?.lines).toEqual({ B: { hidden: true }, A: { dash: 'dashed' } })
    expect(drawnFrom({ ...drew, lines: undefined })).not.toHaveProperty('lines')
    expect(drawnFrom({ ...drew, lines: { A: { hidden: false } } })).not.toHaveProperty('lines')
  })

  it('reads back as written, and a block from before the field was drawn with none', () => {
    // Mutation: `readDrawn` leaves the lines out - the block would then not read
    // back as it was written.
    const drawn = drawnFrom(drew)
    expect(read({ ...drew, drawn }).drawn).toEqual(drawn)
    const { lines: _lines, ...before } = drawn as NonNullable<typeof drawn>
    void _lines
    const again = read({ ...drew, drawn: before }).drawn
    expect(again).not.toBeNull()
    expect(again).not.toHaveProperty('lines')
  })
})

describe('what map.build is sent', () => {
  it('is nothing at all for a project that chose none, or chose only the engine’s own', () => {
    // Mutation: `linesParams` answers `{ lines: {} }` for none - a request no
    // project ever sent before this feature.
    expect(linesParams(undefined)).toEqual({})
    expect(linesParams({})).toEqual({})
    expect(linesParams({ A: { hidden: false, width: 1, dash: 'solid' } })).toEqual({})
  })

  it('is the options as kept, by label, in the engine’s names, and never a hidden line sent false', () => {
    // Mutation: `settledLine` copies `hidden` as it is - a line shown again
    // then goes out as `hidden: false`.
    expect(
      linesParams({
        A: { name: 'Airport Express', hidden: false },
        B: { hidden: true, casing: { width: 0.5, color: '#112233' } },
        C: { hidden: false },
      }),
    ).toEqual({
      lines: {
        A: { name: 'Airport Express' },
        B: { hidden: true, casing: { width: 0.5, color: '#112233' } },
      },
    })
  })
})
