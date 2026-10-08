// Cell 04, Style (A5.5-17, issue 350): what its collapsed row says, and the
// controls it draws.
//
// Rendered to static markup, as the cell's own test is: what is asserted is
// what the adapter draws. The theme switch's behaviour - the write, the
// press kept during one, the disabling while a run holds the page - is
// `tests/unit/theme-writes.test.ts` and `tests/e2e/theme.spec.ts`, and
// neither moved for this. What the fields do when a figure is typed is
// `tests/unit/style-rules.test.ts` and `tests/e2e/style.spec.ts`; what is asserted
// here is what the cell draws.
//
// Two things this file was corrected on. A collapsed cell keeps its
// controls in the document, so both theme words are in the markup whatever
// the record says: a summary has to be asserted as the span it is drawn in,
// or the assertion passes with the summary deleted. And `renderToStaticMarkup`
// runs no effects, while `kit/Button.tsx` writes `disabled` onto its host in
// one - so "no disabled control" cannot be read from this markup at all, and
// what is asserted instead is the positive: the controls that are drawn,
// by name, and nothing else.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { themeWord } from '../../src/renderer/src/ThemeSwitch'
import { FRAME_SENTENCE, STYLE_FIELDS, UNIT_SENTENCE } from '../../src/renderer/src/styleRules'
import { ProjectProvider } from '../../src/renderer/src/notebook/context'
import StyleCell, { styleSummary } from '../../src/renderer/src/notebook/cells/StyleCell'
import type { ProjectState } from '../../src/renderer/src/notebook/useProjectState'
import { CELL_LIST, type Cell } from '../../src/renderer/src/runGraph'
import {
  DEFAULT_STYLE,
  THEMES,
  type ProjectRecord,
  type ProjectStyle,
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
}: {
  project: ProjectRecord | null
  readOnly?: boolean
}): string {
  const runSnapshot = { state: 'idle', recoloured: false, reordered: false, restyled: false }
  const state = {
    project: project === null ? null : { ...project, readOnly },
    engine: null,
    // A run is something with a current snapshot and a way to hear it change.
    run: { snapshot: runSnapshot, subscribe: () => () => {} },
    exporter: { snapshot: { state: 'idle' } },
    setTheme: async () => {},
    exporting: false,
    layingOut: false,
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

/** Every control the cell draws, by its label and in its order. */
const controls = (drawn: string): string[] =>
  [...drawn.matchAll(/<fig-button[^>]*>([^<]*)<\/fig-button>/g)].map((found) => found[1])

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
    expect(labels).toEqual([
      'Line width',
      'Line gap',
      'Station radius',
      'Interchange radius',
      'Station outline',
      'Label size',
      'Label offset',
      'Margin',
    ])
    expect(STYLE_FIELDS.map((field) => field.label)).toEqual(labels)
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

  it('draws the theme’s two buttons and one more, to go back to the engine’s own sizes', () => {
    // By name, and nothing else: no disabled stand-in for a control that
    // does not exist.
    expect(controls(draw({ project: record }))).toEqual([
      'Warm dark',
      'Sepia',
      'Reset to the engine’s sizes',
    ])
  })

  it('says it on a read-only project too, but offers nothing', () => {
    const drawn = draw({ project: record, readOnly: true })
    expect(drawn).toContain('its theme and its sizes cannot be changed here')
    // Its theme is still the map's, and still named in the row.
    expect(drawn).toContain(summary('Warm dark'))
    // And the switch and the fields are absent rather than disabled.
    expect(controls(drawn)).toEqual([])
    expect(drawn).not.toContain('<label')
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
