// Cell 04, Style (A5.5-17): what its collapsed row says, and the one
// sentence it says instead of a control it cannot honestly offer.
//
// Rendered to static markup, as the cell's own test is: what is asserted is
// what the adapter draws. The theme switch's behaviour - the write, the
// press kept during one, the disabling while a run holds the page - is
// `tests/unit/theme-writes.test.ts` and `tests/e2e/theme.spec.ts`, and
// neither moved for this.
//
// Two things this file was corrected on. A collapsed cell keeps its
// controls in the document, so both theme words are in the markup whatever
// the record says: a summary has to be asserted as the span it is drawn in,
// or the assertion passes with the summary deleted. And `renderToStaticMarkup`
// runs no effects, while `kit/Button.tsx` writes `disabled` onto its host in
// one - so "no disabled control" cannot be read from this markup at all, and
// what is asserted instead is the positive: the two theme buttons and
// nothing else.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { themeWord } from '../../src/renderer/src/ThemeSwitch'
import { ProjectProvider } from '../../src/renderer/src/notebook/context'
import StyleCell from '../../src/renderer/src/notebook/cells/StyleCell'
import type { ProjectState } from '../../src/renderer/src/notebook/useProjectState'
import { CELL_LIST, type Cell } from '../../src/renderer/src/runGraph'
import { DEFAULT_STYLE, THEMES, type ProjectRecord } from '../../src/shared/project'

const CELL = CELL_LIST.find((cell) => cell.id === 'style') as Cell

const record: ProjectRecord = {
  version: 1,
  id: 'kq7x2mzp4dna',
  name: 'Los Angeles',
  feed: 'la-metro-rail',
  mode: 'all',
  agency: null,
  date: '2026-09-12',
  service: { start: '2026-01-01', end: '2026-12-31', busiest: '2026-09-12', anchor: '2026-09-08' },
  // The engine's defaults at the pin, spread rather than written out: the
  // numbers are the engine's and move with it, and a copy of them here
  // would drift at the next bump with nothing failing.
  style: { ...DEFAULT_STYLE },
  colors: { A: '#0072bc' },
  defaultColor: '#888888',
  lineOrder: ['A', 'K'],
  theme: 'warm-dark',
  export: { preset: 'instagram-reel', options: {} },
  layout: 'a'.repeat(64),
  made: '2026-09-10T12:00:00+00:00',
  drawn: null,
  built: { mode: 'all', agency: null },
  created: '2026-09-07T20:00:00.000Z',
  modified: '2026-09-07T20:00:00.000Z',
}

/**
 * The cell reads four things from the screen's state and nothing else, so
 * the rest of it is not built: a fuller stand-in would only say that the
 * context has many fields, which `useProjectState` already says.
 */
function draw({
  project,
  readOnly = false,
}: {
  project: ProjectRecord | null
  readOnly?: boolean
}): string {
  const state = {
    project: project === null ? null : { ...project, readOnly },
    setTheme: async () => {},
    exporting: false,
    layingOut: false,
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

  it('says what it will hold when the engine can take a style, with nothing standing in', () => {
    const drawn = draw({ project: record })
    expect(drawn).toContain('Line width, station size and label size are the engine')
    expect(drawn).toContain('once it can take them')
    // Nothing stands in for the fields the engine cannot take: the cell's
    // controls are the two themes and no others.
    expect(controls(drawn)).toEqual(['Warm dark', 'Sepia'])
  })

  it('says it on a read-only project too, but promises nothing it cannot keep', () => {
    const drawn = draw({ project: record, readOnly: true })
    expect(drawn).toContain('its theme cannot be changed here')
    expect(drawn).toContain('Line width, station size and label size are the engine')
    // A record this version may not write will never have its style chosen
    // here, whatever the engine gains, so the sentence saying it will is
    // not said at all.
    expect(drawn).not.toContain('once it can take them')
    // Its theme is still the map's, and still named in the row.
    expect(drawn).toContain(summary('Warm dark'))
    // And the switch is absent rather than disabled.
    expect(controls(drawn)).toEqual([])
  })
})
