// Cell 05's line options (issue 394, spec 036): the rules the disclosure
// follows, without rendering, and the markup it draws. Rendered to static
// markup, as the other cells' tests are, which runs no effects: the kit's
// select takes its value, its field its placeholder and its button its
// `disabled` in one, so those are the end-to-end suite's
// (`tests/e2e/line-options.spec.ts`), and what is asserted here is what the
// markup itself carries - the names, the descriptions, the options, the
// switch's state and the closed disclosure.
//
// Each test was watched failing under a mutation of the rule it holds; the
// mutation is named beside it.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import LineOptions, { type LineOptionsProps } from '../../src/renderer/src/LineOptionsDisclosure'
import {
  CASING_COLOUR_SENTENCE,
  CASING_SENTENCE,
  casingOptions,
  DASH_SENTENCE,
  hidesEveryLine,
  isHidden,
  lineIsSet,
  linesWith,
  nameSentence,
  nextLinesStep,
  optionsSummary,
  readName,
  SHOWN_SENTENCE,
  WIDTH_SENTENCE,
  widthOptions,
  withCasingColour,
  withCasingWidth,
  withDash,
  withName,
  withShown,
  withWidth,
} from '../../src/renderer/src/lineOptions'
import { DEFAULT_CASING_COLOR } from '../../src/shared/project'

describe('what a collapsed row says', () => {
  it('says Default for a line that holds nothing, or only the engine’s own', () => {
    // Mutation: the summary counts fields held rather than fields kept - a
    // line shown again (`hidden: false`) would then read "Hidden".
    expect(optionsSummary('A', undefined)).toBe('Default')
    expect(optionsSummary('A', {})).toBe('Default')
    expect(optionsSummary('A', { hidden: false, width: 1, dash: 'solid', name: 'A' })).toBe(
      'Default',
    )
  })

  it('names what is set, in one order, the first word capitalised', () => {
    // Mutation: the words in the order the fields were set - the issue's
    // own example would then not read as it does.
    expect(optionsSummary('A', { name: 'Airport Express', dash: 'dashed', width: 1.25 })).toBe(
      'Bold, dashed, renamed',
    )
    expect(
      optionsSummary('A', {
        dash: 'dotted',
        casing: { width: 0.25, color: '#112233' },
        hidden: true,
        width: 0.75,
      }),
    ).toBe('Hidden, thin, cased, dotted')
    expect(optionsSummary('A', { width: 1.5 })).toBe('Heavy')
    expect(optionsSummary('A', { casing: { width: 1, color: '#ffffff' } })).toBe('Cased')
  })

  it('says thinner or wider for a width that is none of the four', () => {
    // Mutation: the two words swapped.
    expect(optionsSummary('A', { width: 0.9 })).toBe('Thinner')
    expect(optionsSummary('A', { width: 1.1 })).toBe('Wider')
  })
})

describe('a name, as committed', () => {
  it('is trimmed, and empty or the line’s own label is no name', () => {
    // Mutation: the text kept untrimmed - "  A  " would then be a name.
    expect(readName('A', '  Airport Express ')).toEqual({ name: 'Airport Express' })
    expect(readName('A', '')).toEqual({ name: undefined })
    expect(readName('A', '   ')).toEqual({ name: undefined })
    expect(readName('A', ' A ')).toEqual({ name: undefined })
  })

  it('is refused past 40 characters, in the engine’s own sentence', () => {
    // Mutation: the bound read as 64, a label's - a name of 41 would then be
    // sent and refused by the engine on the draw.
    expect(readName('A', 'x'.repeat(40))).toEqual({ name: 'x'.repeat(40) })
    expect(readName('A', 'x'.repeat(41))).toEqual({
      refused: "lines['A'].name must be from 1 to 40 characters with no line break",
    })
    // A line break of the kind a field can be pasted, refused alike.
    expect(readName('A', `a${String.fromCodePoint(0x2028)}b`)).toHaveProperty('refused')
  })
})

describe('what each control does to a line’s options', () => {
  it('keeps no field at the engine’s own, so nothing is left holding a default', () => {
    // Mutation: `withShown` writes `hidden: false` - a line shown again would
    // then keep a key the engine never needs.
    expect(withShown({ hidden: true }, true)).toEqual({})
    expect(withShown({}, false)).toEqual({ hidden: true })
    expect(withWidth({ width: 1.5 }, 1)).toEqual({})
    expect(withWidth({}, 1.25)).toEqual({ width: 1.25 })
    expect(withDash({ dash: 'dotted' }, 'solid')).toEqual({})
    expect(withName({ name: 'X' }, undefined)).toEqual({})
    expect(withName({}, 'X')).toEqual({ name: 'X' })
  })

  it('starts a casing white, keeps its colour across a width, and takes it away with None', () => {
    // Mutation: a casing chosen afresh with no colour - the engine refuses a
    // casing without both its fields.
    expect(withCasingWidth({}, 0.5)).toEqual({
      casing: { width: 0.5, color: DEFAULT_CASING_COLOR },
    })
    const coloured = withCasingColour(withCasingWidth({}, 0.5), '#112233')
    expect(coloured).toEqual({ casing: { width: 0.5, color: '#112233' } })
    expect(withCasingWidth(coloured, 1)).toEqual({ casing: { width: 1, color: '#112233' } })
    expect(withCasingWidth(coloured, 0)).toEqual({})
    expect(withCasingWidth(withCasingWidth(coloured, 0), 0.25)).toEqual({
      casing: { width: 0.25, color: DEFAULT_CASING_COLOR },
    })
    expect(withCasingColour({}, '#112233'), 'no casing, no colour').toEqual({})
  })

  it('replaces one line in the set, and drops a line left with nothing', () => {
    // Mutation: `linesWith` keeps an empty line - Reset line would then
    // leave `{ A: {} }` and the line would read as set.
    const lines = { A: { hidden: true }, B: { width: 1.5 } }
    expect(linesWith(lines, 'A', {})).toEqual({ B: { width: 1.5 } })
    expect(linesWith(lines, 'C', { dash: 'dashed' })).toEqual({ ...lines, C: { dash: 'dashed' } })
    expect(linesWith(lines, 'A', { hidden: false })).toEqual({ B: { width: 1.5 } })
    expect(lines, 'the set it was given is left alone').toEqual({
      A: { hidden: true },
      B: { width: 1.5 },
    })
    expect(lineIsSet(lines, 'A')).toBe(true)
    expect(lineIsSet(lines, 'C')).toBe(false)
    expect(lineIsSet(lines, 'constructor'), 'a label that is a prototype’s name').toBe(false)
    expect(isHidden(lines, 'A')).toBe(true)
    expect(isHidden(lines, 'B')).toBe(false)
  })

  it('refuses to hide the last line the cell lists as drawn', () => {
    // Mutation: the line being hidden left out of the count - the last line
    // could then be hidden, and the engine refuses the map.
    expect(hidesEveryLine({ B: { hidden: true } }, ['A', 'B'], 'A')).toBe(true)
    expect(hidesEveryLine({}, ['A', 'B'], 'A')).toBe(false)
    expect(hidesEveryLine({ C: { hidden: true } }, ['A', 'B', 'C'], 'B')).toBe(false)
    expect(hidesEveryLine({}, ['A'], 'A')).toBe(true)
  })

  it('builds a change, waits while the page is held, and does nothing for no change', () => {
    // Mutation: a change compared as written rather than as it would be sent
    // - a line shown again (`hidden: false`) would then build for nothing.
    expect(nextLinesStep({ A: { hidden: true } }, undefined, false)).toBe('build')
    expect(nextLinesStep({ A: { hidden: true } }, undefined, true)).toBe('wait')
    expect(nextLinesStep({ A: { hidden: false } }, undefined, false)).toBe('none')
    expect(nextLinesStep({}, { A: { width: 1 } }, true)).toBe('none')
  })
})

describe('what each select offers', () => {
  it('offers the four widths and the four casings, by their words', () => {
    // Mutation: Regular's value 1.25 - the engine's own width would then be
    // sent as a choice.
    expect(widthOptions({})).toEqual([
      { value: '0.75', label: 'Thin' },
      { value: '1', label: 'Regular' },
      { value: '1.25', label: 'Bold' },
      { value: '1.5', label: 'Heavy' },
    ])
    expect(casingOptions({})).toEqual([
      { value: '0', label: 'None' },
      { value: '0.25', label: 'Thin' },
      { value: '0.5', label: 'Regular' },
      { value: '1', label: 'Wide' },
    ])
  })

  it('offers a held number that is none of the steps as one more option, saying the number', () => {
    // Mutation: the extra option left out - the select would then show Thin
    // for a line drawn 1.1 wide, and a press elsewhere would send Thin.
    expect(widthOptions({ width: 1.1 }).at(-1)).toEqual({
      value: '1.1',
      label: '1.1 times the line width',
    })
    expect(casingOptions({ casing: { width: 0.75, color: '#000000' } }).at(-1)).toEqual({
      value: '0.75',
      label: '0.75 times the line width on each side',
    })
    expect(widthOptions({ width: 1.25 })).toHaveLength(4)
  })
})

// ---- the markup

const props = (over: Partial<LineOptionsProps> = {}): LineOptionsProps => ({
  label: 'A',
  choice: {},
  onChoose: () => undefined,
  onFollow: () => undefined,
  onPanelClosed: () => undefined,
  onReset: () => undefined,
  lastShown: false,
  handback: { current: null },
  ...over,
})
const draw = (over: Partial<LineOptionsProps> = {}): string =>
  renderToStaticMarkup(<LineOptions {...props(over)} />)

/** The switch's own tag. */
const switchTag = (html: string): string => /<input id="[^"]+-shown"[^>]*\/>/.exec(html)?.[0] ?? ''

/** The text of the disclosure's own button. */
const toggleText = (html: string): string =>
  (/<button[^>]*class="line-options-toggle"[^>]*>(.*?)<\/button>/s.exec(html)?.[1] ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

describe('the disclosure', () => {
  it('is closed, named for its line, and says what the line holds', () => {
    // Mutation: the line's label left out of the button - every row's
    // toggle would then be read as the same "Line options, Default".
    const html = draw()
    expect(html).toMatch(/<button[^>]*class="line-options-toggle"[^>]*aria-expanded="false"/)
    expect(toggleText(html)).toBe('Line options for line A, Default')
    expect(html).toContain('<span class="visually-hidden"> for line A,</span>')
    expect(html).toMatch(/role="group" aria-label="Line options for line A" hidden=""/)
    expect(toggleText(draw({ choice: { width: 1.25, dash: 'dashed', name: 'X' } }))).toBe(
      'Line options for line A, Bold, dashed, renamed',
    )
  })

  it('holds the name, the switch, the three selects and Reset line, each described', () => {
    // Mutation: the switch drawn as a plain checkbox - it would then be read
    // as "checkbox, checked", which says nothing about the line being drawn.
    const html = draw({ label: 'K' })
    expect(html).toMatch(/<label for="[^"]+-name">Name<\/label>/)
    expect(html).toContain(nameSentence('K'))
    expect(html).toMatch(/<label for="[^"]+-shown">Shown<\/label>/)
    expect(switchTag(html)).toMatch(/ type="checkbox" role="switch" /)
    expect(switchTag(html), 'on, for a line that is drawn').toContain(' checked=""')
    expect(html).toContain(SHOWN_SENTENCE)
    for (const [name, words, sentence] of [
      ['Width', ['Thin', 'Regular', 'Bold', 'Heavy'], WIDTH_SENTENCE],
      ['Casing', ['None', 'Thin', 'Regular', 'Wide'], CASING_SENTENCE],
      ['Dash', ['Solid', 'Dashed', 'Dotted'], DASH_SENTENCE],
    ] as const) {
      const at = html.indexOf(`<fig-dropdown label="${name}"`)
      expect(at, name).toBeGreaterThan(-1)
      const select = html.slice(at, html.indexOf('</fig-dropdown>', at))
      expect([...select.matchAll(/<option [^>]*>([^<]*)<\/option>/g)].map((m) => m[1])).toEqual(
        words,
      )
      expect(html).toContain(sentence)
    }
    expect(html).toMatch(/aria-label="Reset line K’s options"[^>]*>Reset line</)
  })

  it('draws the switch off for a hidden line', () => {
    // Mutation: the switch's state read from `hidden !== false` - a line
    // that holds nothing would then read as hidden.
    expect(switchTag(draw({ choice: { hidden: true } }))).not.toContain('checked')
    expect(switchTag(draw({ choice: { width: 1.25 } }))).toContain(' checked=""')
  })

  it('draws the casing’s colour chip and its note only while there is a casing', () => {
    // Mutation: the chip drawn whatever the casing - a line with none would
    // then offer a colour that colours nothing.
    const none = draw()
    expect(none).not.toContain('Choose the casing colour of line A')
    expect(none).not.toContain(CASING_COLOUR_SENTENCE)
    const cased = draw({ choice: { casing: { width: 0.5, color: '#112233' } } })
    expect(cased).toMatch(
      /<button type="button" class="colour-chip" style="background:#112233"[^>]*aria-label="Choose the casing colour of line A"/,
    )
    expect(cased).toContain('aria-label="Casing colour for line A"')
    expect(cased).toContain(CASING_COLOUR_SENTENCE)
  })

  it('names every control after its line where it stands outside the group’s name', () => {
    // Mutation: as the first test's: the label left out of the toggle.
    const html = draw({ label: 'Metro E' })
    expect(toggleText(html)).toBe('Line options for line Metro E, Default')
    expect(html).toContain('aria-label="Reset line Metro E’s options"')
  })
})
