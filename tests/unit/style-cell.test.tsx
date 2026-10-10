// Cell 04, Style (A5.5-17, issue 350): what its collapsed row says, and the
// controls it draws.
//
// Rendered to static markup, as the cell's own test is: what is asserted is
// what the adapter draws. The theme switch's behaviour - the write, the
// choice kept during one, a choice made as one lands - is
// `tests/unit/theme-chooser.test.ts`, over the pieces `theme-writes.test.ts`
// holds, and the disabling while a run holds the page and the keyboard are
// `tests/e2e/theme.spec.ts`; what is asserted here of the switch is the
// markup it draws. What the fields do when a figure is typed is
// `tests/unit/style-rules.test.ts` and `tests/e2e/style.spec.ts`; what is asserted
// here is what the cell draws.
//
// Two things this file was corrected on. A collapsed cell keeps its
// controls in the document, so both theme words are in the markup whatever
// the record says: a summary has to be asserted as the span it is drawn in,
// or the assertion passes with the summary deleted. And `renderToStaticMarkup`
// runs no effects, while `kit/Button.tsx` writes `disabled` onto its host in
// one - so "no disabled kit button" cannot be read from this markup at all,
// and what is asserted instead is the positive: the controls that are drawn,
// by name, and nothing else. The theme's radios are native and carry their
// state in the markup (A7-13), so theirs is read off it.

import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { themeWord } from '../../src/renderer/src/ThemeSwitch'
import { LOOKS_WAITING } from '../../src/renderer/src/looks'
import {
  CHOICE_FIELDS,
  FRAME_SENTENCE,
  STYLE_FIELDS,
  TICK_SENTENCE,
  TRAIL_SENTENCE,
  TRAINS_SENTENCE,
  UNIT_SENTENCE,
} from '../../src/renderer/src/styleRules'
import { ProjectProvider } from '../../src/renderer/src/notebook/context'
import StyleCell, { styleSummary } from '../../src/renderer/src/notebook/cells/StyleCell'
import type { ProjectState } from '../../src/renderer/src/notebook/useProjectState'
import { CELL_LIST, type Cell } from '../../src/renderer/src/runGraph'
import {
  DEFAULT_STYLE,
  STYLE_CHOICES,
  THEMES,
  type ProjectRecord,
  type ProjectStyle,
  type Theme,
} from '../../src/shared/project'

const CELL = CELL_LIST.find((cell) => cell.id === 'style') as Cell

const record: ProjectRecord = {
  version: 2,
  id: 'kq7x2mzp4dna',
  name: 'Los Angeles',
  feed: 'la-metro-rail',
  mode: 'all',
  agency: null,
  date: '2026-09-12',
  service: { start: '2026-01-01', end: '2026-12-31', busiest: '2026-09-12', anchor: '2026-09-08' },
  // Nothing chosen: every size is the engine's own.
  style: {},
  colors: { A: '#0072bc' },
  defaultColor: '#888888',
  lineOrder: ['A', 'K'],
  theme: 'warm-dark',
  export: { preset: 'instagram-reel', options: {} },
  destination: null,
  opened: null,
  layout: 'a'.repeat(64),
  made: '2026-09-10T12:00:00+00:00',
  drawn: null,
  built: { mode: 'all', agency: null },
  created: '2026-09-07T20:00:00.000Z',
  modified: '2026-09-07T20:00:00.000Z',
}

/**
 * The cell reads a handful of things from the screen's state and nothing
 * else, so the rest of it is not built: a fuller stand-in would only say
 * that the context has many fields, which `useProjectState` already says.
 */
function draw({
  project,
  readOnly = false,
  exporting = false,
  layingOut = false,
}: {
  project: ProjectRecord | null
  readOnly?: boolean
  exporting?: boolean
  layingOut?: boolean
}): string {
  const runSnapshot = { state: 'idle', recoloured: false, reordered: false, restyled: false }
  const state = {
    project: project === null ? null : { ...project, readOnly },
    engine: null,
    // A run is something with a current snapshot and a way to hear it change.
    run: { snapshot: runSnapshot, subscribe: () => () => {} },
    exporter: { snapshot: { state: 'idle' } },
    setTheme: async () => {},
    exporting,
    layingOut,
    runSnapshot,
  } as unknown as ProjectState
  return renderToStaticMarkup(
    <ProjectProvider value={state}>
      <StyleCell cell={CELL} state="ready" open={false} onToggle={() => {}} />
    </ProjectProvider>,
  )
}

/** What the collapsed row says beside the number, the name and the state. */
const summary = (theme: string): string => `<span class="cell-summary">${theme}</span>`

/** Every kit button the cell draws, by its label and in its order. */
const controls = (drawn: string): string[] =>
  [...drawn.matchAll(/<fig-button[^>]*>([^<]*)<\/fig-button>/g)].map((found) => found[1])

/** The attributes of one start tag, a bare one (`checked`) as an empty string. */
function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const found of tag.matchAll(/\s([a-z][\w-]*)(?:="([^"]*)")?(?=[\s/>])/g))
    out[found[1]] = found[2] ?? ''
  return out
}

/** What the theme's section draws, and nothing else the cell holds. */
const themeSection = (drawn: string): string => {
  const start = drawn.indexOf('<section class="theme-switch"')
  expect(start, 'the cell draws the theme switch').toBeGreaterThanOrEqual(0)
  return drawn.slice(start, drawn.indexOf('</section>', start))
}

const pictures = resolve(__dirname, '../../src/renderer/src/pictures')

/** The engine's picture of a theme, as the file holds it. */
const picture = (theme: Theme): string =>
  readFileSync(resolve(pictures, `theme-${theme}.svg`), 'utf8')

/** An attribute's value as the markup wrote it, back to the characters it stands for. */
const unescaped = (value: string): string =>
  value
    .replaceAll('&#x27;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')

/**
 * The document an `<img>`'s `src` stands for: the file the address names.
 * The pictures are served as files, never inlined as a `data:` address
 * (`themePictures.ts`), and the address may carry a query (`?no-inline`
 * where Vite serves them), which is not part of the file's name.
 */
function fileBehind(src: string): string {
  const address = unescaped(src)
  expect(address, 'the picture is a file, not a data address').not.toMatch(/^data:/)
  return readFileSync(resolve(pictures, basename(address.split('?')[0])), 'utf8')
}

/** The colour of a picture's backdrop rectangle, which is its ground. */
const groundOf = (svg: string): string | null =>
  /<rect id=["']backdrop["'][^>]* fill=["'](#[0-9a-f]{6})["']/i.exec(svg)?.[1] ?? null

/** One theme card as the switch draws it: the label that wraps a radio, its picture and its word. */
interface Card {
  /** The label's own class. */
  label: string
  radio: Record<string, string>
  /** What follows the radio inside the label, tag by tag. */
  rest: string
  picture: Record<string, string>
  word: string
}

function cards(drawn: string): Card[] {
  return [...themeSection(drawn).matchAll(/<label ([^>]*)>(.*?)<\/label>/g)].map((found) => {
    const inside = found[2]
    const radio = /^<input ([^>]*?)\/?>/.exec(inside)
    expect(radio, `a label opens with its radio: ${inside}`).not.toBeNull()
    const rest = inside.slice((radio as RegExpExecArray)[0].length)
    const image = /<img ([^>]*?)\/?>/.exec(rest)
    expect(image, `a card holds a picture: ${rest}`).not.toBeNull()
    return {
      label: attributes(` ${found[1]} `).class,
      radio: attributes(` ${(radio as RegExpExecArray)[1]} `),
      rest,
      picture: attributes(` ${(image as RegExpExecArray)[1]} `),
      word: rest.replace(/<[^>]*>/g, ''),
    }
  })
}

describe('cell 04, Style', () => {
  it('names the theme in the map’s own words, not the interface’s', () => {
    // The span and not the word: both words are in the markup of a
    // collapsed cell, whose controls stay in the document.
    const warm = draw({ project: record })
    expect(warm).toContain(summary('Warm dark'))
    expect(warm).not.toContain(summary('Sepia'))
    const sepia = draw({ project: { ...record, theme: 'sepia' } })
    expect(sepia).toContain(summary('Sepia'))
    expect(sepia).not.toContain(summary('Warm dark'))
    // The split ADR-044 settled: Night and Parchment are what Settings
    // calls the *interface's* two themes, and this cell sets the map's.
    for (const theme of THEMES) {
      const drawn = draw({ project: { ...record, theme } })
      expect(drawn).not.toContain('Night')
      expect(drawn).not.toContain('Parchment')
    }
  })

  it('has a word for every theme the record can hold', () => {
    for (const theme of THEMES) expect(themeWord(theme)).not.toBe('')
  })

  it('says nothing at all while the record is being read', () => {
    // A cell with nothing true to say says nothing: the summary is null
    // rather than a sentence about an absent project.
    expect(draw({ project: null })).not.toContain('cell-summary')
  })

  it('draws a field for each of the eight sizes, in order, each named and with its range', () => {
    const drawn = draw({ project: record })
    const labels = [...drawn.matchAll(/<label for="[^"]*">([^<]*)<\/label>/g)].map((m) => m[1])
    // The eight sizes, then the trains' two (issue 391), each a labelled field.
    expect(labels).toEqual([
      'Line width',
      'Line gap',
      'Station radius',
      'Interchange radius',
      'Station outline',
      'Label size',
      'Label offset',
      'Margin',
      'Dot size',
      'Trail',
    ])
    expect(STYLE_FIELDS.map((field) => field.label)).toEqual(labels.slice(0, 8))
    // The engine's range in each field's description, and its own number.
    expect(drawn).toContain('1 to 24. The engine’s own is 7.')
    expect(drawn).toContain('1 to 3, times the line width. The engine’s own is 1.6.')
    expect(drawn).toContain('1 to 20. The engine’s own is 4.2.')
    expect(drawn).toContain('1 to 30. The engine’s own is 6.')
    expect(drawn).toContain('0 to 8. The engine’s own is 2.2.')
    expect(drawn).toContain('6 to 32. The engine’s own is 11.')
    expect(drawn).toContain('0 to 40. The engine’s own is 9.')
    expect(drawn).toContain('0 to 200. The engine’s own is 24.')
  })

  it('names the unit once, above the fields, and says why the margin is the frame’s one freedom', () => {
    // Markup writes an apostrophe as an entity; the sentence is the text.
    const drawn = draw({ project: record }).replaceAll('&#x27;', '’')
    expect(drawn.split(UNIT_SENTENCE)).toHaveLength(2)
    expect(drawn).toContain(
      'In the map’s own units: the map is drawn 1,800 wide, so a line width of 7 is seven of 1,800.',
    )
    expect(drawn.split(FRAME_SENTENCE)).toHaveLength(2)
    expect(drawn).toContain(
      'The frame is padded, never cropped or rotated: a station is never cut off, and a tighter frame is a smaller margin.',
    )
    // The sentence that said the engine could not be told is gone, and with
    // it the promise that the cell would one day take them.
    expect(drawn).not.toContain('are the engine')
    expect(drawn).not.toContain('once it can take them')
  })

  it('draws one button, to go back to the engine’s own sizes, and the theme as radios', () => {
    // By name, and nothing else: no disabled stand-in for a control that
    // does not exist. The theme is not a button any more (A7-13).
    const drawn = draw({ project: record })
    expect(controls(drawn)).toEqual(['Reset to the engine’s sizes'])
    expect(cards(drawn).map((card) => card.word)).toEqual(['Warm dark', 'Sepia'])
  })

  describe('the theme, as two radios each a card (A7-13)', () => {
    it('is a fieldset named for what it sets, holding exactly the two radios, one group', () => {
      const section = themeSection(draw({ project: record }))
      expect(section).toContain(
        '<legend class="visually-hidden">The theme this map is drawn in</legend>',
      )
      const radios = [...section.matchAll(/<input [^>]*>/g)].map((found) => attributes(found[0]))
      expect(radios).toHaveLength(2)
      for (const radio of radios) expect(radio.type).toBe('radio')
      // One name, so Tab enters the pair once and the arrow keys move the choice.
      const names = new Set(radios.map((radio) => radio.name))
      expect(names.size).toBe(1)
      expect([...names][0]).not.toBe('')
      // Nothing else in the section is a control of any kind.
      expect(section).not.toMatch(/<(button|select|textarea|fig-)/)
    })

    it('names each radio by its word, and gives each the value of the theme it sets', () => {
      // Mutation: the two values swapped.
      const found = cards(draw({ project: record })).map((card) => [card.word, card.radio.value])
      expect(found).toEqual([
        ['Warm dark', 'warm-dark'],
        ['Sepia', 'sepia'],
      ])
      // And the word is the whole of the label's text, so the radio's name is it.
      for (const card of cards(draw({ project: record })))
        expect(card.word).toBe(themeWord(card.radio.value as Theme))
    })

    it('has the map’s current theme checked and the other not, whichever it is', () => {
      for (const theme of THEMES) {
        const checked = cards(draw({ project: { ...record, theme } }))
          .filter((card) => 'checked' in card.radio)
          .map((card) => card.radio.value)
        expect(checked).toEqual([theme])
      }
    })

    it('puts the radio first in its label, the picture over the word, in the card’s own shape', () => {
      for (const card of cards(draw({ project: record }))) {
        expect(card.label).toBe('card theme-card')
        expect(card.radio.class).toBe('visually-hidden')
        expect(card.rest).toMatch(
          /^<span class="card-picture"><img [^>]*\/><\/span><span class="card-name">[^<]+<\/span>$/,
        )
      }
    })

    it('draws each picture as an image with no alternative text, of the engine’s file for its theme', () => {
      // Mutation: an alt with words, which the radio's name would then say twice.
      const found = cards(draw({ project: record }))
      for (const card of found) expect(card.picture.alt, 'alt is present and empty').toBe('')
      // Which file each one shows is read from its ground.
      const grounds = found.map((card) => groundOf(fileBehind(card.picture.src)))
      expect(grounds).toEqual(THEMES.map((theme) => groundOf(picture(theme))))
      expect(new Set(grounds).size, 'two pictures, not one twice').toBe(2)
    })

    it('draws no map of its own: two images, and no line or station in the markup', () => {
      const section = themeSection(draw({ project: record }))
      expect(section.match(/<img /g)).toHaveLength(2)
      expect(section).not.toMatch(/<(svg|circle|path|line|polyline|rect|canvas)[\s>]/)
    })

    it('is available when nothing holds the page, and radio by radio not while a run or an export does', () => {
      const open = themeSection(draw({ project: record }))
      expect(open).not.toContain('disabled')
      for (const held of [{ exporting: true }, { layingOut: true }]) {
        const section = themeSection(draw({ project: record, ...held }))
        // Each radio is disabled itself. Never the fieldset round them:
        // Chromium takes focus from a descendant of a disabled fieldset as the
        // attribute is written, before the handback can hand it on.
        expect(section).not.toMatch(/<fieldset[^>]* disabled/)
        const radios = [...section.matchAll(/<input [^>]*>/g)].map((found) => attributes(found[0]))
        expect(radios).toHaveLength(2)
        for (const radio of radios) expect(radio, 'a radio is disabled').toHaveProperty('disabled')
        // Said once, where the switch is.
        expect(section).toContain('The theme waits until the run that is going has finished')
      }
    })
  })

  it('says it on a read-only project too, but offers nothing', () => {
    const drawn = draw({ project: record, readOnly: true })
    expect(drawn).toContain('its theme and its sizes cannot be changed here')
    // Its theme is still the map's, and still named in the row.
    expect(drawn).toContain(summary('Warm dark'))
    // And the switch and the fields are absent rather than disabled.
    expect(controls(drawn)).toEqual([])
    expect(drawn).not.toContain('<label')
    expect(drawn).not.toContain('type="radio"')
    expect(drawn).not.toContain('<fieldset')
    expect(drawn, 'no look, marker or face either').not.toContain('<fig-dropdown')
  })
})

// ---- Issue 391 (spec 034): the look, the markers, the face and the trains,
// in the one group, as the cell draws them. What a choice does is
// `tests/unit/looks.test.ts` and `style-rules.test.ts`; that it reaches the
// engine is `tests/e2e/looks.spec.ts`.

/** The sizes' group, and nothing else the cell holds. */
const sizesGroup = (drawn: string): string => {
  const start = drawn.indexOf('<section class="style-fields"')
  expect(start, 'the cell draws the sizes').toBeGreaterThanOrEqual(0)
  return drawn.slice(start, drawn.indexOf('</section>', start))
}

/** Every control's name in the group, in the order it is drawn, and the sentences that head a part. */
const walk = (drawn: string): string[] =>
  [
    ...sizesGroup(drawn).matchAll(
      /<fig-dropdown label="([^"]*)"|<label for="[^"]*">([^<]*)<\/label>|<legend>([^<]*)<\/legend>|<fig-button[^>]*>([^<]*)<\/fig-button>|<p class="prose">/g,
    ),
  ].map((found) =>
    found[1] !== undefined
      ? `select ${found[1]}`
      : found[2] !== undefined
        ? found[2]
        : found[3] !== undefined
          ? `group ${found[3]}`
          : found[4] !== undefined
            ? `button ${found[4]}`
            : 'the unit',
  )

/** One select's row: the name drawn beside it, its options, and what is said under it. */
function selectRow(drawn: string, name: string) {
  const group = sizesGroup(drawn)
  const at = group.indexOf(`<fig-dropdown label="${name}"`)
  expect(at, `a select named ${name}`).toBeGreaterThanOrEqual(0)
  const rowStart = group.lastIndexOf('<div class="style-field">', at)
  const end = group.indexOf('</fig-dropdown>', at)
  const after = group.slice(end, group.indexOf('<div class="style-field">', end + 1))
  return {
    beside: group.slice(rowStart, at),
    options: [...group.slice(at, end).matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map(
      (found) => [found[1], found[2]],
    ),
    said: [...after.matchAll(/<p id="[^"]*" class="message">([^<]*)<\/p>/g)].map((m) => m[1]),
  }
}

describe('cell 04’s looks, markers, face and trains (issue 391)', () => {
  it('draws one group in the decided order: the look, the eight sizes, the markers, the face, the trains, one Reset', () => {
    // Mutation: the look drawn after the sizes, or the face before the markers.
    expect(walk(draw({ project: record }))).toEqual([
      'select Look',
      'the unit',
      'Line width',
      'Line gap',
      'Station radius',
      'Interchange radius',
      'Station outline',
      'Label size',
      'Label offset',
      'Margin',
      'select Station marker',
      'select Interchange marker',
      'select Label typeface',
      'group Trains',
      'Dot size',
      'Trail',
      'button Reset to the engine’s sizes',
    ])
  })

  it('names each select by its label, the name beside it drawn and hidden from the accessibility tree', () => {
    for (const name of ['Look', 'Station marker', 'Interchange marker', 'Label typeface'])
      expect(selectRow(draw({ project: record }), name).beside).toBe(
        `<div class="style-field"><span class="style-name" aria-hidden="true">${name}</span><div class="style-control">`,
      )
  })

  it('offers the engine’s own sizes alone, and says the looks come from the engine, while it is away', () => {
    // The markup is drawn with no engine: the looks are not asked.
    const own = selectRow(draw({ project: record }), 'Look')
    expect(own.options).toEqual([['engine-own', 'The engine’s sizes']])
    expect(own.said).toEqual([LOOKS_WAITING])
    expect(LOOKS_WAITING).toBe(
      'The looks come from the engine, and are offered once it is running.',
    )
    // A style of its own is Custom: no look can be known without the engine.
    const custom = selectRow(draw({ project: { ...record, style: { lineWidth: 6 } } }), 'Look')
    expect(custom.options).toEqual([
      ['engine-own', 'The engine’s sizes'],
      ['custom', 'Custom'],
    ])
    // Nothing else in the group waits on the engine.
    expect(sizesGroup(draw({ project: record }))).not.toMatch(/disabled/)
  })

  it('offers the engine’s markers and faces in its order, each by its word', () => {
    // Mutation: the interchange's circle called Circle, or an option dropped.
    const drawn = draw({ project: record })
    expect(selectRow(drawn, 'Station marker').options).toEqual([
      ['circle', 'Circle'],
      ['tick', 'Tick'],
      ['square', 'Square'],
    ])
    expect(selectRow(drawn, 'Interchange marker').options).toEqual([
      ['circle', 'Ring'],
      ['square', 'Square'],
    ])
    expect(selectRow(drawn, 'Label typeface').options).toEqual([
      ['system', 'System'],
      ['inter', 'Inter'],
      ['atkinson-hyperlegible-next', 'Atkinson Hyperlegible Next'],
    ])
    for (const [key, { options }] of Object.entries(CHOICE_FIELDS))
      expect(
        options.map((option) => option.value),
        key,
      ).toEqual(STYLE_CHOICES[key as keyof typeof STYLE_CHOICES].options)
  })

  it('glosses the tick under the station’s marker, and nowhere else', () => {
    // Mutation: the gloss left off the station's marker.
    const drawn = draw({ project: record })
    expect(selectRow(drawn, 'Station marker').said).toEqual([TICK_SENTENCE])
    expect(TICK_SENTENCE).toBe(
      'A tick stands on the side of the station’s name, as on the London diagram.',
    )
    expect(selectRow(drawn, 'Interchange marker').said).toEqual([])
    expect(selectRow(drawn, 'Label typeface').said).toEqual([])
  })

  it('draws the trains as a group of two fields in the sizes’ pattern, the trail’s note in its description', () => {
    // Mutation: the trail's note drawn but not in the field's description.
    const group = sizesGroup(draw({ project: record }))
    const trains = group.slice(
      group.indexOf('<fieldset class="style-trains">'),
      group.indexOf('</fieldset>'),
    )
    expect(trains).toContain('<legend>Trains</legend>')
    expect(trains).toContain(`<p class="message">${TRAINS_SENTENCE}</p>`)
    expect(TRAINS_SENTENCE).toBe(
      'How a train is drawn as the map plays; the map itself does not change.',
    )
    expect(trains).toContain('2 to 12. The engine’s own is 5.')
    expect(trains).toContain('0 to 3 seconds. The engine’s own is 0.')
    const trail = /<label for="([^"]*)">Trail<\/label>/.exec(trains)?.[1] as string
    const described = new RegExp(`aria-describedby="${trail}-range ${trail}-note"`)
    expect(trains).toMatch(described)
    expect(trains).toContain(`<p id="${trail}-note" class="message">${TRAIL_SENTENCE}</p>`)
    expect(TRAIL_SENTENCE).toBe(
      'There is no trail while a train stands at a station, in the Time view, or for a person who has asked for reduced motion.',
    )
  })
})

describe('what the collapsed row says of the sizes', () => {
  const row = (style: ProjectStyle, theme: ProjectRecord['theme'] = 'warm-dark'): string =>
    styleSummary({ theme, style })

  it('says nothing of them while none has been set', () => {
    // Mutation: the sizes' words always added.
    expect(row({})).toBe('Warm dark')
    expect(row({}, 'sepia')).toBe('Sepia')
  })

  it('says nothing of a size at the engine’s own number: that is no choice', () => {
    expect(row({ ...DEFAULT_STYLE })).toBe('Warm dark')
    expect(row({ lineWidth: DEFAULT_STYLE.lineWidth })).toBe('Warm dark')
  })

  it('says nothing of a look’s marker, the face or the trains: the row is about the sizes', () => {
    // Issue 391 (spec 034, FR-012): the row says what DESIGN.md 8.2 says it
    // says. Mutation: the row judged on the whole group (`styleIsSet`).
    expect(row({ labelFont: 'inter', trail: 2, dotRadius: 8, stationShape: 'tick' })).toBe(
      'Warm dark',
    )
    expect(row({ stationShape: 'tick', lineWidth: 6 })).toBe('Warm dark, sizes of your own')
  })

  it('says, after the theme, that the sizes are a person’s own once any has been set', () => {
    expect(row({ lineWidth: 12 })).toBe('Warm dark, sizes of your own')
    expect(row({ padding: 0 }, 'sepia')).toBe('Sepia, sizes of your own')
    expect(row({ ...DEFAULT_STYLE, labelSize: 20 })).toBe('Warm dark, sizes of your own')
  })

  it('is the row the cell draws, as the span it is drawn in', () => {
    expect(draw({ project: { ...record, style: { labelSize: 20 } } })).toContain(
      summary('Warm dark, sizes of your own'),
    )
    expect(draw({ project: record })).toContain(summary('Warm dark'))
  })
})
