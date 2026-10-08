// The map's sizes on the wire (issue 350, ADR-049): exactly what `map.build`
// is sent for a project's style, in the engine's names.
//
// What a style sends is decided beside the record and tested there
// (`style-record.test.ts`); this holds the translation, and the one property
// that matters most of it: a project nobody has sized sends no `style`, so
// its map is the map it always was.

import { describe, expect, it } from 'vitest'
import { mapStyle, styleParams } from '../../src/renderer/src/styleFields'
import { DEFAULT_STYLE, type ProjectStyle } from '../../src/shared/project'

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
