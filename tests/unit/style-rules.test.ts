// The map's sizes (issue 350, ADR-049): exactly what `map.build` is sent for
// a project's style, in the engine's names, and what cell 04's fields make of
// what is typed.
//
// What a style sends is decided beside the record and tested there
// (`style-record.test.ts`); this holds the translation, and the one property
// that matters most of it: a project nobody has sized sends no `style`, so
// its map is the map it always was. Then the fields: what a commit reads,
// refuses and applies, before anything is sent.

import { describe, expect, it } from 'vitest'
import {
  commitDrafts,
  describeField,
  draftsOf,
  fieldText,
  nextStyleStep,
  parseFigure,
  sizesWords,
  mapStyle,
  styleParams,
  type Drafts,
} from '../../src/renderer/src/styleRules'
import {
  DEFAULT_STYLE,
  styleRangeSentence,
  type ProjectStyle,
  type StyleKey,
} from '../../src/shared/project'

const COLOURS = ['background', 'station_fill', 'station_stroke_color', 'label_color']

describe('the style map.build is sent', () => {
  it('is none at all for a project nobody has sized: not an empty object, no key', () => {
    // Mutation: `styleParams` returns `{ style: {} }` for no style. The
    // engine would take it, but the request would no longer be the one every
    // existing project has always sent.
    expect(mapStyle({})).toBeNull()
    expect(styleParams({})).toEqual({})
    expect('style' in styleParams({})).toBe(false)
  })

  it('is none for sizes that are all the engine’s own', () => {
    expect(styleParams({ ...DEFAULT_STYLE })).toEqual({})
    expect(styleParams({ lineWidth: 7, labelSize: 11 })).toEqual({})
  })

  it('carries a size a person set, in the engine’s name, and nothing else', () => {
    expect(styleParams({ lineWidth: 12 })).toEqual({ style: { line_width: 12 } })
    expect(styleParams({ labelSize: 20 })).toEqual({ style: { label_size: 20 } })
    expect(styleParams({ padding: 0 })).toEqual({ style: { padding: 0 } })
    expect(styleParams({ lineGap: 2.5 })).toEqual({ style: { line_gap: 2.5 } })
  })

  it('does not send a field that is unset, or at the engine’s own number, beside one that is set', () => {
    expect(
      styleParams({ lineWidth: 12, labelSize: DEFAULT_STYLE.labelSize, padding: undefined }),
    ).toEqual({ style: { line_width: 12 } })
  })

  it('carries both radii whenever either is set', () => {
    // Mutation: one radius sent alone. The engine judges the pair on the
    // values the map would be drawn with, and refuses a station radius above
    // 6 against the interchange radius's default.
    expect(styleParams({ stationRadius: 5 })).toEqual({
      style: { station_radius: 5, interchange_radius: DEFAULT_STYLE.interchangeRadius },
    })
    expect(styleParams({ interchangeRadius: 9 })).toEqual({
      style: { station_radius: DEFAULT_STYLE.stationRadius, interchange_radius: 9 },
    })
    expect(styleParams({ stationRadius: 8, interchangeRadius: 9 })).toEqual({
      style: { station_radius: 8, interchange_radius: 9 },
    })
  })

  it('carries a station radius above 6 with the interchange radius that goes with it', () => {
    expect(styleParams({ stationRadius: 8, interchangeRadius: 8 })).toEqual({
      style: { station_radius: 8, interchange_radius: 8 },
    })
  })

  it('is none for a style the engine would refuse, rather than a request it would refuse', () => {
    expect(styleParams({ stationRadius: 8 })).toEqual({})
    expect(styleParams({ lineWidth: 99, labelSize: 20 })).toEqual({})
  })

  it('never carries one of the four colours, whatever it is handed', () => {
    // ADR-049's criterion: the page's theme owns the furniture. `ProjectStyle`
    // has no such field; a value handed one anyway sends none of them.
    const everything: ProjectStyle = {
      lineWidth: 12,
      lineGap: 2,
      stationRadius: 5,
      interchangeRadius: 9,
      stationStroke: 3,
      labelSize: 20,
      labelOffset: 12,
      padding: 40,
    }
    const handed = {
      ...everything,
      background: '#000000',
      station_fill: '#ffffff',
      station_stroke_color: '#111111',
      label_color: '#111111',
      stationFill: '#ffffff',
      labelColor: '#111111',
    } as ProjectStyle
    const sent = mapStyle(handed) as Record<string, unknown>
    expect(Object.keys(sent).sort()).toEqual(
      [
        'line_width',
        'line_gap',
        'station_radius',
        'interchange_radius',
        'station_stroke',
        'label_size',
        'label_offset',
        'padding',
      ].sort(),
    )
    for (const colour of COLOURS) expect(sent, colour).not.toHaveProperty(colour)
  })
})

const RANGE = (key: StyleKey): string => styleRangeSentence(key)
const PAIR = (interchange: number, station: number): string =>
  `style.interchange_radius (${interchange}) must not be below style.station_radius (${station}); ` +
  'a field left out counts as its default, so send both'

/** The fields showing a style, with some of them typed over. */
const typed = (style: ProjectStyle, over: Partial<Drafts>): Drafts => ({
  ...draftsOf(style),
  ...over,
})

describe('what a field shows and takes', () => {
  it('shows the engine’s own number for a size nobody set, and the number for one that was', () => {
    expect(fieldText({}, 'lineWidth')).toBe('7')
    expect(fieldText({}, 'lineGap')).toBe('1.6')
    expect(fieldText({ lineWidth: 12, padding: 0 }, 'lineWidth')).toBe('12')
    expect(fieldText({ lineWidth: 12, padding: 0 }, 'padding')).toBe('0')
    expect(draftsOf({ labelSize: 20 })).toEqual({
      lineWidth: '7',
      lineGap: '1.6',
      stationRadius: '4.2',
      interchangeRadius: '6',
      stationStroke: '2.2',
      labelSize: '20',
      labelOffset: '9',
      padding: '24',
    })
  })

  it('says the engine’s range under it, and the gap’s as a multiple', () => {
    expect(describeField('lineWidth')).toBe('1 to 24. The engine’s own is 7.')
    expect(describeField('lineGap')).toBe('1 to 3, times the line width. The engine’s own is 1.6.')
    expect(describeField('padding')).toBe('0 to 200. The engine’s own is 24.')
  })

  it('reads a decimal number as a person writes one, and nothing else', () => {
    for (const [text, figure] of [
      ['12', 12],
      [' 7 ', 7],
      ['12.5', 12.5],
      ['+3', 3],
      ['.5', 0.5],
      ['3.', 3],
      ['0', 0],
    ] as const)
      expect(parseFigure(text), text).toBe(figure)
    for (const text of [
      '',
      ' ',
      'abc',
      '1e3',
      '0x10',
      '1,5',
      '--1',
      '12px',
      'Infinity',
      'NaN',
      '1 2',
    ])
      expect(parseFigure(text), JSON.stringify(text)).toBeNull()
  })
})

describe('committing what was typed, before anything is sent', () => {
  it('changes nothing when nothing was typed over', () => {
    const done = commitDrafts({ lineWidth: 12 }, draftsOf({ lineWidth: 12 }), 'lineWidth')
    expect(done).toEqual({
      style: { lineWidth: 12 },
      problems: {},
      drafts: draftsOf({ lineWidth: 12 }),
    })
  })

  it('takes a figure in range, and shows it as the number it is', () => {
    const done = commitDrafts({}, typed({}, { lineWidth: ' 12.0 ' }), 'lineWidth')
    expect(done.style).toEqual({ lineWidth: 12 })
    expect(done.problems).toEqual({})
    expect(done.drafts.lineWidth).toBe('12')
  })

  it('refuses a figure outside the range in the engine’s sentence, beside its field, and applies nothing', () => {
    // Mutation: the range not checked here (left to the engine).
    for (const text of ['30', '0.5', '-1', '24.1']) {
      const done = commitDrafts({}, typed({}, { lineWidth: text }), 'lineWidth')
      expect(done.style, text).toEqual({})
      expect(done.problems, text).toEqual({ lineWidth: RANGE('lineWidth') })
      expect(done.drafts.lineWidth, 'left as it was typed, to be mended').toBe(text)
    }
    expect(RANGE('lineWidth')).toBe(
      "style.line_width must be from 1 to 24, in SVG user units at the map's width",
    )
  })

  it('takes either end of the range', () => {
    expect(commitDrafts({}, typed({}, { lineWidth: '1' }), 'lineWidth').style).toEqual({
      lineWidth: 1,
    })
    expect(commitDrafts({}, typed({}, { lineWidth: '24' }), 'lineWidth').style).toEqual({
      lineWidth: 24,
    })
    expect(commitDrafts({}, typed({}, { padding: '0' }), 'padding').style).toEqual({ padding: 0 })
  })

  it('refuses what is not a number in the same sentence', () => {
    for (const text of ['abc', '1e1', '12px', '0x10']) {
      const done = commitDrafts({}, typed({}, { labelSize: text }), 'labelSize')
      expect(done.problems, text).toEqual({ labelSize: RANGE('labelSize') })
    }
  })

  it('takes an empty field as a way back to the engine’s own number', () => {
    const done = commitDrafts(
      { lineWidth: 12 },
      typed({ lineWidth: 12 }, { lineWidth: '' }),
      'lineWidth',
    )
    expect(done.style).toEqual({})
    expect(done.drafts.lineWidth).toBe('7')
  })

  it('takes the engine’s own number as no choice at all', () => {
    const done = commitDrafts(
      { lineWidth: 12 },
      typed({ lineWidth: 12 }, { lineWidth: '7' }),
      'lineWidth',
    )
    expect(done.style).toEqual({})
    // And typing it over a size nobody set is not a change.
    expect(commitDrafts({}, typed({}, { lineWidth: '7.0' }), 'lineWidth').style).toEqual({})
  })

  it('refuses a station radius the interchange radius cannot match, beside the field just left', () => {
    // Mutation: the pair not judged, so the engine would refuse it.
    const done = commitDrafts({}, typed({}, { stationRadius: '8' }), 'stationRadius')
    expect(done.style).toEqual({})
    expect(done.problems).toEqual({ stationRadius: PAIR(6, 8) })
    expect(done.drafts.stationRadius, 'left on the screen to be mended').toBe('8')
  })

  it('refuses an interchange radius below the station radius, beside itself', () => {
    const done = commitDrafts({}, typed({}, { interchangeRadius: '3' }), 'interchangeRadius')
    expect(done.style).toEqual({})
    expect(done.problems).toEqual({ interchangeRadius: PAIR(3, 4.2) })
  })

  it('takes the refused radius the moment the other is set so that it can be, in one redraw', () => {
    // A station radius of 8 waits, refused, with its sentence. Setting the
    // interchange radius to 9 is what mends it, and both are applied.
    const waiting = commitDrafts({}, typed({}, { stationRadius: '8' }), 'stationRadius')
    const mended = commitDrafts(
      waiting.style,
      { ...waiting.drafts, interchangeRadius: '9' },
      'interchangeRadius',
    )
    expect(mended.style).toEqual({ stationRadius: 8, interchangeRadius: 9 })
    expect(mended.problems).toEqual({})
    expect(mended.drafts.stationRadius).toBe('8')
  })

  it('takes both radii typed together when they agree', () => {
    const done = commitDrafts(
      {},
      typed({}, { stationRadius: '8', interchangeRadius: '10' }),
      'interchangeRadius',
    )
    expect(done.style).toEqual({ stationRadius: 8, interchangeRadius: 10 })
    expect(done.problems).toEqual({})
  })

  it('refuses a pair that disagree beside the one just left, and applies the others', () => {
    const done = commitDrafts(
      {},
      typed({}, { stationRadius: '8', interchangeRadius: '7', labelSize: '20' }),
      'interchangeRadius',
    )
    expect(done.style, 'neither radius, and the label size').toEqual({ labelSize: 20 })
    expect(done.problems).toEqual({ interchangeRadius: PAIR(7, 8) })
    expect(done.drafts.labelSize).toBe('20')
    expect(done.drafts.stationRadius).toBe('8')
  })

  it('applies a figure that is in range beside one that is refused', () => {
    const done = commitDrafts({}, typed({}, { lineWidth: '30', labelSize: '20' }), 'labelSize')
    expect(done.style).toEqual({ labelSize: 20 })
    expect(done.problems).toEqual({ lineWidth: RANGE('lineWidth') })
    expect(done.drafts.lineWidth, 'the refused one waits as typed').toBe('30')
  })

  it('shows a number the record holds that the engine would refuse, and applies nothing until it is fixed', () => {
    const stored = { lineWidth: 99 }
    const other = commitDrafts(stored, typed(stored, { labelSize: '20' }), 'labelSize')
    expect(other.style, 'nothing a store would write').toEqual(stored)
    expect(other.problems).toEqual({ lineWidth: RANGE('lineWidth') })
    expect(other.drafts.labelSize, 'and the figure waits').toBe('20')
    // Fixing it is what lets the rest through.
    const fixed = commitDrafts(
      stored,
      typed(stored, { lineWidth: '12', labelSize: '20' }),
      'lineWidth',
    )
    expect(fixed.style).toEqual({ lineWidth: 12, labelSize: 20 })
    expect(fixed.problems).toEqual({})
  })
})

describe('what to do with a style a person has chosen', () => {
  it('is nothing for a style that is the one drawn, whichever way it was written', () => {
    expect(nextStyleStep({}, {}, false)).toBe('none')
    expect(nextStyleStep({}, { lineWidth: 7 }, false)).toBe('none')
    expect(nextStyleStep({ lineWidth: 12 }, { lineWidth: 12 }, true)).toBe('none')
  })

  it('is to draw it, or to wait for the page a run or an export is reading', () => {
    expect(nextStyleStep({ lineWidth: 12 }, {}, false)).toBe('build')
    expect(nextStyleStep({ lineWidth: 12 }, {}, true)).toBe('wait')
    expect(nextStyleStep({}, { lineWidth: 12 }, false)).toBe('build')
  })
})

describe('what the collapsed row adds to the theme', () => {
  it('is nothing until a size is set, and then that the sizes are a person’s own', () => {
    expect(sizesWords({})).toBeNull()
    expect(sizesWords({ ...DEFAULT_STYLE })).toBeNull()
    expect(sizesWords({ padding: 0 })).toBe('sizes of your own')
  })
})
