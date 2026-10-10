// Cell 04's Look (issue 391, spec 034 FR-001): reading the engine's looks,
// what the select shows for a style, what it offers, and what choosing does.
//
// The answer below is the engine's own at v0.15.0 (`style.presets`, which is
// `render.PRESETS` through `preset_style`), restated here as a test's data so
// the app's source copies no number of it. Each test was watched failing
// under the mutation named beside it.

import { describe, expect, it } from 'vitest'
import {
  chooseLook,
  chooseValue,
  CUSTOM,
  ENGINE_OWN,
  forgetLooks,
  LOOK_SENTENCE,
  lookOf,
  lookOptions,
  looksFor,
  LOOKS_FAILED,
  looksOf,
  looksSentence,
  LOOKS_WAITING,
  matchLook,
  offeredLooks,
  withLook,
  type Look,
  type LooksClient,
} from '../../src/renderer/src/looks'
import { draftsOf, viewOf } from '../../src/renderer/src/styleRules'
import { DEFAULT_STYLE, styleRangeSentence, type ProjectStyle } from '../../src/shared/project'
import type { StylePresets } from '../../src/shared/protocol'

/** `style.presets` as engine v0.15.0 answers it. */
const ANSWER: StylePresets = {
  presets: [
    {
      name: 'beck',
      style: {
        line_width: 6,
        line_gap: 1.33,
        station_radius: 3.6,
        interchange_radius: 7.5,
        station_stroke: 3,
        label_size: 11,
        label_offset: 10,
        padding: 24,
        station_shape: 'tick',
      },
    },
    {
      name: 'blueprint',
      style: {
        line_width: 4,
        line_gap: 2,
        station_radius: 3,
        interchange_radius: 4.5,
        station_stroke: 1.5,
        label_size: 10,
        label_offset: 8,
        padding: 32,
      },
    },
    {
      name: 'paper',
      style: {
        line_width: 6,
        line_gap: 1.6,
        station_radius: 3.6,
        interchange_radius: 5.5,
        station_stroke: 1.8,
        label_size: 12,
        label_offset: 10,
        padding: 28,
      },
    },
  ],
}

const LOOKS = looksOf(ANSWER)
const look = (name: string): Look => LOOKS.find((found) => found.name === name) as Look

/** Beck's fields as the record keeps them: none at the engine's own number. */
const BECK: ProjectStyle = {
  lineWidth: 6,
  lineGap: 1.33,
  stationRadius: 3.6,
  interchangeRadius: 7.5,
  stationStroke: 3,
  labelOffset: 10,
  stationShape: 'tick',
}

describe('the engine’s looks, read', () => {
  it('reads the three in the engine’s order, each by its name with a first capital', () => {
    expect(LOOKS.map((found) => [found.name, found.label])).toEqual([
      ['beck', 'Beck'],
      ['blueprint', 'Blueprint'],
      ['paper', 'Paper'],
    ])
  })

  it('reads a look’s fields in the app’s names, none kept at the engine’s own number', () => {
    // Beck's label size, 11, and margin, 24, are the engine's own: no choice.
    expect(look('beck').style).toEqual(BECK)
    expect(look('blueprint').style).toEqual({
      lineWidth: 4,
      lineGap: 2,
      stationRadius: 3,
      interchangeRadius: 4.5,
      stationStroke: 1.5,
      labelSize: 10,
      labelOffset: 8,
      padding: 32,
    })
  })

  it('leaves out a look it could not write, and keeps the rest', () => {
    const beck = ANSWER.presets[0]
    const refused = [
      { ...beck, style: { ...beck.style, background: '#000000' } },
      // A look carries no face: a field that is not a look's is not taken.
      { ...beck, style: { ...beck.style, label_font: 'inter' } },
      { ...beck, style: { ...beck.style, line_width: 99 } },
      { ...beck, style: { ...beck.style, interchange_shape: 'tick' } },
      { ...beck, style: { ...beck.style, station_radius: 9 } },
      { ...beck, name: '' },
      { ...beck, name: CUSTOM },
      { ...beck, name: ENGINE_OWN },
      { name: 'loose' },
      null,
    ]
    for (const preset of refused) expect(lookOf(preset), JSON.stringify(preset)).toBeNull()
    expect(
      looksOf({ presets: [...refused, ANSWER.presets[2]] }).map((found) => found.name),
    ).toEqual(['paper'])
    expect(looksOf({ presets: [ANSWER.presets[1], ANSWER.presets[1]] })).toHaveLength(1)
    expect(looksOf(null)).toEqual([])
    expect(looksOf({ presets: 'beck' })).toEqual([])
  })
})

describe('what the select shows for a style', () => {
  it('is the engine’s own sizes for a style nobody set, or one of only the face and the trains', () => {
    expect(matchLook({}, LOOKS)).toBe(ENGINE_OWN)
    expect(matchLook({ ...DEFAULT_STYLE }, LOOKS)).toBe(ENGINE_OWN)
    expect(matchLook({ labelFont: 'inter', dotRadius: 8, trail: 2 }, LOOKS)).toBe(ENGINE_OWN)
  })

  it('is the look whose fields equal the style’s, a field at the engine’s own as absent', () => {
    expect(matchLook(BECK, LOOKS)).toBe('beck')
    expect(matchLook({ ...BECK, labelSize: 11, padding: 24 }, LOOKS)).toBe('beck')
    expect(matchLook(look('paper').style, LOOKS)).toBe('paper')
    // The face and the trains are not a look's.
    expect(matchLook({ ...BECK, labelFont: 'atkinson-hyperlegible-next', trail: 3 }, LOOKS)).toBe(
      'beck',
    )
  })

  it('compares the markers too: Beck’s numbers with a round station are not Beck', () => {
    // Mutation: the markers left out of the comparison (LOOK_KEYS the eight
    // sizes alone). The select would say Beck of a map that draws circles.
    const { stationShape: _tick, ...numbers } = BECK
    void _tick
    expect(matchLook(numbers, LOOKS)).toBe(CUSTOM)
    expect(matchLook({ ...BECK, interchangeShape: 'square' }, LOOKS)).toBe(CUSTOM)
    expect(matchLook({ ...look('paper').style, stationShape: 'tick' }, LOOKS)).toBe(CUSTOM)
  })

  it('is Custom once a size is typed over a look, and the look again once it is typed back', () => {
    expect(matchLook({ ...BECK, lineWidth: 7 }, LOOKS)).toBe(CUSTOM)
    expect(matchLook({ ...BECK, lineWidth: 6 }, LOOKS)).toBe('beck')
    expect(matchLook({ lineWidth: 12 }, LOOKS)).toBe(CUSTOM)
    // A number the record holds out of range is no look either.
    expect(matchLook({ lineWidth: 99 }, LOOKS)).toBe(CUSTOM)
  })

  it('is the engine’s own or Custom while there are no looks to compare with', () => {
    expect(matchLook({}, [])).toBe(ENGINE_OWN)
    expect(matchLook(BECK, []), 'Beck cannot be known without the engine').toBe(CUSTOM)
  })
})

describe('what the select offers', () => {
  const values = (style: ProjectStyle, looks: readonly Look[]): string[] =>
    lookOptions(style, looks).map((option) => option.value)

  it('offers the engine’s own sizes first, then the looks in the engine’s order', () => {
    expect(lookOptions({}, LOOKS)).toEqual([
      { value: ENGINE_OWN, label: 'The engine’s sizes' },
      { value: 'beck', label: 'Beck' },
      { value: 'blueprint', label: 'Blueprint' },
      { value: 'paper', label: 'Paper' },
    ])
  })

  it('offers Custom only while the style is Custom, and last', () => {
    // Mutation: Custom always offered.
    expect(values(BECK, LOOKS)).not.toContain(CUSTOM)
    expect(values({}, LOOKS)).not.toContain(CUSTOM)
    expect(lookOptions({ lineWidth: 12 }, LOOKS).at(-1)).toEqual({
      value: CUSTOM,
      label: 'Custom',
    })
  })

  it('offers only the engine’s own sizes, and Custom where the style is not them, without the engine', () => {
    expect(values({}, [])).toEqual([ENGINE_OWN])
    expect(values(BECK, [])).toEqual([ENGINE_OWN, CUSTOM])
  })

  it('says what a look does, or why there are none, in the select’s description', () => {
    expect(looksSentence({ status: 'ready', looks: LOOKS })).toBe(LOOK_SENTENCE)
    expect(LOOK_SENTENCE).toBe(
      'A look sets the sizes and the markers; the typeface and the trains stay as they are.',
    )
    expect(looksSentence({ status: 'waiting' })).toBe(
      'The looks come from the engine, and are offered once it is running.',
    )
    expect(LOOKS_WAITING).toBe(looksSentence({ status: 'waiting' }))
    expect(looksSentence({ status: 'failed' })).toBe(LOOKS_FAILED)
    expect(offeredLooks({ status: 'waiting' })).toEqual([])
    expect(offeredLooks({ status: 'failed' })).toEqual([])
    expect(offeredLooks({ status: 'ready', looks: LOOKS })).toBe(LOOKS)
  })
})

describe('choosing a look', () => {
  it('writes the look’s fields and never its name', () => {
    const chosen = withLook({}, look('beck'))
    expect(chosen).toEqual(BECK)
    expect(JSON.stringify(chosen)).not.toMatch(/beck|preset/i)
  })

  it('replaces every field a look sets, so a marker the next look does not name goes back to the circle', () => {
    // Mutation: the look's fields laid over the style without clearing the
    // ten first - Blueprint after Beck would keep Beck's tick.
    expect(withLook(BECK, look('blueprint'))).toEqual(look('blueprint').style)
    expect(withLook({ ...BECK, interchangeShape: 'square' }, look('paper'))).toEqual(
      look('paper').style,
    )
  })

  it('leaves the label face and the trains as they are', () => {
    // Mutation: a look clears the whole style before it is written.
    const before: ProjectStyle = { lineWidth: 12, labelFont: 'inter', dotRadius: 8, trail: 1.5 }
    expect(withLook(before, look('beck'))).toEqual({
      ...BECK,
      labelFont: 'inter',
      dotRadius: 8,
      trail: 1.5,
    })
  })

  it('puts the ten back to the engine’s own for the engine’s sizes, and leaves the face and the trains', () => {
    const before: ProjectStyle = {
      ...BECK,
      interchangeShape: 'square',
      labelFont: 'inter',
      trail: 2,
    }
    expect(withLook(before, null)).toEqual({ labelFont: 'inter', trail: 2 })
    expect(withLook(BECK, null)).toEqual({})
  })

  it('shows the look’s numbers in the eight fields, and keeps a train figure refused and waiting', () => {
    const typed = viewOf({ trail: 1 })
    typed.drafts.trail = '9'
    typed.problems.trail = styleRangeSentence('trail')
    typed.drafts.lineWidth = '30'
    typed.problems.lineWidth = styleRangeSentence('lineWidth')
    const after = chooseLook(typed, look('beck'))
    expect(after.style).toEqual({ ...BECK, trail: 1 })
    expect(after.drafts).toEqual({ ...draftsOf({ ...BECK, trail: 1 }), trail: '9' })
    expect(after.problems).toEqual({ trail: styleRangeSentence('trail') })
  })

  it('takes a value from the select: a look, the engine’s own, and nothing for Custom or an unknown name', () => {
    const view = viewOf(BECK)
    expect(chooseValue(view, LOOKS, 'paper')?.style).toEqual(look('paper').style)
    expect(chooseValue(view, LOOKS, ENGINE_OWN)?.style).toEqual({})
    expect(chooseValue(view, LOOKS, CUSTOM)).toBeNull()
    expect(chooseValue(view, LOOKS, 'sketch')).toBeNull()
    expect(chooseValue(view, [], 'beck'), 'a look the select did not offer').toBeNull()
  })
})

describe('asking the engine for its looks', () => {
  /** A client that counts the requests it is sent, answering or refusing. */
  function client(answer: () => Promise<StylePresets>): LooksClient & { asked: number } {
    const stub = {
      asked: 0,
      request(method: 'style.presets') {
        expect(method).toBe('style.presets')
        stub.asked += 1
        return { result: answer() }
      },
    }
    return stub
  }

  it('asks once while an engine of one version answers, and every cell reads the same answer', async () => {
    // Mutation: no cache - every project opened would ask again.
    forgetLooks()
    const engine = client(() => Promise.resolve(ANSWER))
    const first = await looksFor(engine, '0.15.0')
    const second = await looksFor(engine, '0.15.0')
    expect(first.map((found) => found.name)).toEqual(['beck', 'blueprint', 'paper'])
    expect(second).toBe(first)
    expect(engine.asked).toBe(1)
  })

  it('asks again of an engine of another version, and after a refusal', async () => {
    // Mutation: a refusal kept, so the looks never came back; or the answer
    // kept whatever the version, so a restarted engine of another table
    // would be offered the first one's looks.
    forgetLooks()
    const refusing = client(() => Promise.reject(new Error('Method Not Found: style.presets')))
    await expect(looksFor(refusing, '0.14.0')).rejects.toThrow('Method Not Found')
    const answering = client(() => Promise.resolve(ANSWER))
    expect(await looksFor(answering, '0.14.0')).toHaveLength(3)
    await looksFor(answering, '0.14.0')
    expect(answering.asked).toBe(1)
    await looksFor(answering, '0.15.0')
    expect(answering.asked, 'another version is asked again').toBe(2)
  })
})
