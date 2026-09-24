// Cell 04, Style (A5.5-17): what its collapsed row says, and the one
// sentence it says instead of a control it cannot honestly offer.
//
// Rendered to static markup, as the cell's own test is: what is asserted is
// what the adapter draws. The theme switch's behaviour - the write, the
// press kept during one, the disabling while a run holds the page - is
// `tests/unit/theme-writes.test.ts` and `tests/e2e/theme.spec.ts`, and
// neither moved for this.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { themeWord } from '../../src/renderer/src/ThemeSwitch'
import { ProjectProvider } from '../../src/renderer/src/notebook/context'
import StyleCell from '../../src/renderer/src/notebook/cells/StyleCell'
import type { ProjectState } from '../../src/renderer/src/notebook/useProjectState'
import { CELL_LIST } from '../../src/renderer/src/runGraph'
import { THEMES, type ProjectRecord } from '../../src/shared/project'

const CELL = CELL_LIST[3]

const record: ProjectRecord = {
  version: 1,
  id: 'kq7x2mzp4dna',
  name: 'Los Angeles',
  feed: 'la-metro-rail',
  mode: 'all',
  agency: null,
  date: '2026-09-12',
  service: { start: '2026-01-01', end: '2026-12-31', busiest: '2026-09-12', anchor: '2026-09-08' },
  style: { lineWidth: 10, stationRadius: 8, interchangeRadius: 11, labelSize: 26 },
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

describe('cell 04, Style', () => {
  it('names the theme in the map’s own words, not the interface’s', () => {
    expect(draw({ project: record })).toContain('Warm dark')
    expect(draw({ project: { ...record, theme: 'sepia' } })).toContain('Sepia')
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
    // No disabled stand-in for the fields the engine cannot take: the only
    // controls in the cell are the two themes, and they are not disabled
    // while nothing holds the page.
    expect(drawn).not.toContain('disabled')
  })

  it('says it on a read-only project too, where the engine is the reason and not the record', () => {
    const drawn = draw({ project: record, readOnly: true })
    expect(drawn).toContain('its theme cannot be changed here')
    expect(drawn).toContain('Line width, station size and label size are the engine')
    // Its theme is still the map's, and still named in the row.
    expect(drawn).toContain('Warm dark')
  })
})
