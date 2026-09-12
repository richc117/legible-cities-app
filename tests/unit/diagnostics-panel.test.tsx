// The panel's markup, rendered without a browser: what a person is offered
// for every row, and that no colour or size is written into a component
// (docs/DESIGN.md, section 8.2; tests/unit/no-literals.test.ts is the other
// half of that rule).

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { metrics } from '../../src/renderer/src/engine/diagnostics'
import type { RunReport } from '../../src/renderer/src/engine/layoutRun'
import { DiagnosticsReport } from '../../src/renderer/src/Diagnostics'
import type { Diagnostics } from '../../src/shared/protocol'

const DIAGNOSTICS: Diagnostics = {
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
}

const report = (over: Partial<RunReport> = {}): RunReport => ({
  date: '2026-09-15',
  diagnostics: DIAGNOSTICS,
  caveats: ['4 of 116 stops could not be placed on the map'],
  issues: 0.2137,
  ...over,
})

describe('the panel itself', () => {
  const markup = (over: Partial<RunReport> = {}): string =>
    renderToStaticMarkup(<DiagnosticsReport name="Los Angeles" report={report(over)} />)

  it('shows every caveat the engine sent, word for word', () => {
    const html = markup({ caveats: ['3 trips could not be traced', '2 names had nowhere to sit'] })
    expect(html).toContain('3 trips could not be traced')
    expect(html).toContain('2 names had nowhere to sit')
    expect(html).toContain('aria-label="Caveats"')
  })

  it('says there are no caveats, and the score, when the build was clean', () => {
    const html = markup({ caveats: [], issues: 0 })
    expect(html).toContain('No caveats')
    expect(html).toContain('the issues score is 0.')
    expect(html).not.toContain('aria-label="Caveats"')
  })

  it("is a real table with a caption, row headers and the engine's figures", () => {
    const html = markup()
    expect(html).toContain('<caption>')
    expect(html).toContain('What the engine measured drawing the map for')
    expect(html).toContain('2026-09-15')
    expect(html).toContain('<th scope="col">Measure</th>')
    expect(html.match(/<th scope="row">/g)?.length).toBe(metrics(DIAGNOSTICS).length)
    for (const metric of metrics(DIAGNOSTICS)) expect(html, metric.id).toContain(metric.value)
  })

  it('gives every row a focusable explanation that names itself and describes the row', () => {
    const html = markup()
    const triggers = html.match(/<button type="button" class="explain-trigger"/g) ?? []
    expect(triggers.length).toBe(metrics(DIAGNOSTICS).length)
    expect(html).toContain('aria-label="What octilinearity means"')
    expect(html).toContain('role="tooltip"')
    // Every trigger points at the tooltip beside it, so a screen reader
    // reads the explanation without a pointer.
    const described = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1])
    expect(described.length).toBe(triggers.length)
    for (const id of described) expect(html).toContain(`id="${id}"`)
  })

  it('writes no colour, size or duration into its markup', () => {
    const html = markup()
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(html).not.toMatch(/\d+px/)
    expect(html).not.toMatch(/style=/)
  })

  it('offers the copy, and shows nothing said until it is pressed', () => {
    expect(markup()).toContain('Copy as text')
    expect(markup()).toContain('class="message"')
  })
})
