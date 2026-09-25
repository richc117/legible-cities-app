// The project screen's heading outline (issue 197).
//
// A screen reader walks a long document by heading, and the notebook is a
// long document: its six cells are the second-level headings, and their rows
// are what the rail moves focus to (DESIGN.md 8.2, "The cell"). A panel that
// A5.5-08 moved inside a cell and that kept an `h2` of its own was a sibling
// of the cell's heading and not a child, so the outline promised ten
// sections where there were six and the cell boundaries were invisible in a
// heading list.
//
// The rule this file holds is not "no heading inside a cell" - cell 05 keeps
// two on purpose (A5.5-18), because one cell called Lines cannot say where
// the colours end and the order begins. It is: **a heading inside a cell is
// a level below the cell's**, so that a cell is exactly one `h2` and
// everything under it nests.
//
// Rendered to static markup, as the cell's own test and the diagnostics
// panel's are: what is asserted is what the components draw. The walk
// through a running app - every `h2` on the project screen, in order, being
// the six cells' rows - is `tests/e2e/notebook-a11y.spec.ts`, which is the
// half of this that needs a browser.

import type { JSX } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DiagnosticsReport } from '../../src/renderer/src/Diagnostics'
import Inspect from '../../src/renderer/src/Inspect'
import StageView from '../../src/renderer/src/StageView'
import Cell from '../../src/renderer/src/notebook/Cell'
import type { RunReport } from '../../src/renderer/src/engine/layoutRun'
import { DEFAULT_STYLE, type ProjectRecord } from '../../src/shared/project'

const record: ProjectRecord = {
  version: 1,
  id: 'kq7x2mzp4dna',
  name: 'Los Angeles',
  feed: 'la-metro-rail',
  mode: 'all',
  agency: null,
  date: '2026-09-12',
  service: { start: '2026-01-01', end: '2026-12-31', busiest: '2026-09-12', anchor: '2026-09-08' },
  style: { ...DEFAULT_STYLE },
  colors: {},
  defaultColor: '#888888',
  lineOrder: [],
  theme: 'warm-dark',
  export: { preset: 'instagram-reel', options: {} },
  destination: null,
  layout: 'a'.repeat(64),
  made: '2026-09-10T12:00:00+00:00',
  drawn: null,
  built: { mode: 'all', agency: null },
  created: '2026-09-07T20:00:00.000Z',
  modified: '2026-09-07T20:00:00.000Z',
}

const report: RunReport = {
  date: '2026-09-15',
  diagnostics: {
    stations: 114,
    junctions: 8,
    edges: 121,
    lines: ['A', 'B', 'C'],
    octilinear: 0.9938,
    stops: {
      matched: 112,
      total: 116,
      by: { station_id: 100, parent_station: 10, name: 2 },
      unmatched: ['80122', '80123'],
    },
    trips: { total: 135, paths: 40, unrouted: 3 },
    degraded: { skipped_calls: 12, borrowed_track: 26 },
    labels_dropped: 2,
    peak_concurrent: 19,
  },
  caveats: ['4 of 116 stops could not be placed on the map'],
  issues: 0.2137,
}

/**
 * The three panels that sit inside a cell and name themselves: the panel,
 * the cell it was moved into, and the name its region carries - which is
 * what `tests/support/project.ts`, the acceptance checklist and the
 * screen-reader walkthrough all reach it by.
 */
const PANELS: {
  name: string
  cell: { number: number; name: string }
  id: string
  panel: JSX.Element
}[] = [
  {
    name: 'In the feed',
    cell: { number: 1, name: 'Data' },
    id: 'inspect-heading',
    panel: (
      <Inspect
        project={record}
        engine={null}
        inspect={async () => {
          throw new Error('not asked while the engine is away')
        }}
        onInputs={async () => {}}
      />
    ),
  },
  {
    name: 'Where the routes run',
    cell: { number: 1, name: 'Data' },
    id: 'stage-heading',
    panel: (
      <StageView
        project={record}
        engine={null}
        read={async () => {
          throw new Error('not asked while the engine is away')
        }}
      />
    ),
  },
  {
    name: 'What the build had to fudge',
    cell: { number: 2, name: 'Process' },
    id: 'diagnostics-heading',
    panel: <DiagnosticsReport name="Los Angeles" report={report} />,
  },
]

/** A panel drawn where it lives: inside an open cell of the notebook. */
const inCell = (panel: JSX.Element, cell: { number: number; name: string }): string =>
  renderToStaticMarkup(
    <Cell number={cell.number} name={cell.name} state="ready" open onToggle={() => {}}>
      {panel}
    </Cell>,
  )

/** Every heading of one level in some markup, by what it contains. */
const headings = (html: string, level: 2 | 3): string[] =>
  [...html.matchAll(new RegExp(`<h${level}\\b[^>]*>(.*?)</h${level}>`, 'gs'))].map((m) => m[1])

describe('a panel inside a cell', () => {
  for (const { name, cell, id, panel } of PANELS) {
    describe(name, () => {
      it('leaves the cell exactly one second-level heading: the cell’s own row', () => {
        const html = inCell(panel, cell)
        // One `h2`, and it is the disclosure's row rather than the panel's:
        // asserted as the row's own contents, so that a panel drawing an
        // `h2` in place of the cell's would not pass this by arithmetic.
        const second = headings(html, 2)
        expect(second).toHaveLength(1)
        expect(second[0]).toContain('class="cell-name"')
        expect(second[0]).toContain(cell.name)
        // And the panel's own name is not among them.
        expect(second[0]).not.toContain(name)
      })

      it('names itself a level below, as cell 05’s two sections do', () => {
        const html = inCell(panel, cell)
        expect(headings(html, 3)).toContain(name)
      })

      it('is still what names the panel’s region, so nothing loses its name', () => {
        // The region's name is the heading, through `aria-labelledby`, and
        // the three names are quoted in `tests/support/project.ts`, the
        // acceptance checklist and the screen-reader walkthrough. A heading
        // that moved level must not have moved its id.
        //
        // Matched rather than compared whole, so that an attribute the
        // heading may want later - a `tabIndex`, were cell 01 ever given the
        // handback it has not got - is not forbidden by a test about a name.
        const html = renderToStaticMarkup(panel)
        expect(html).toContain(`aria-labelledby="${id}"`)
        expect(html).toMatch(new RegExp(`<h3\\b[^>]*\\bid="${id}"[^>]*>${name}</h3>`))
      })

      it('draws that one heading and no other level, so the outline has no hole', () => {
        // Not an `h2`, which is the cell's own level and the whole of issue
        // 197, and not an `h4`, which skips a level and reads as a hole to
        // anyone walking the outline. A check that counted `h2`s would pass
        // an `h4` without a word, which is half a rule.
        const html = renderToStaticMarkup(panel)
        expect([...html.matchAll(/<(h[1-6])\b/g)].map((m) => m[1])).toEqual(['h3'])
      })
    })
  }
})
