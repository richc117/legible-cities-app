// The panel's markup, rendered without a browser: what a person is offered
// for every row, and that no colour or size is written into a component
// (docs/DESIGN.md, section 8.2; tests/unit/no-literals.test.ts is the other
// half of that rule).

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { copyText, metrics } from '../../src/renderer/src/engine/diagnostics'
import type { RunReport } from '../../src/renderer/src/engine/layoutRun'
import {
  COPIED,
  DiagnosticsReport,
  NOT_COPIED,
  copyReport,
  explainedAfterEscape,
  explainedAfterLeaving,
  explainedAfterPress,
} from '../../src/renderer/src/Diagnostics'
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

  // A row's explanation answers a press as well as a pointer and the
  // keyboard: pressing is how a touch user asks, and the button says
  // whether the explanation it controls is showing.
  it('offers each explanation as a control that can be pressed', () => {
    const html = markup()
    const expanded = html.match(/aria-expanded="false"/g) ?? []
    expect(expanded.length).toBe(metrics(DIAGNOSTICS).length)
  })
})

// An explanation appears on hover and on focus, so it must be possible to
// send away without moving either (WCAG 1.4.13, A6-07): Escape hides every
// one showing, and each comes back when the pointer and the focus have
// left its row, or when its control is pressed.
describe('an explanation that can be dismissed', () => {
  const none = { asked: null, dismissed: [] as string[] }

  it('marks each row so Escape can tell which explanation is showing, none dismissed', () => {
    const html = renderToStaticMarkup(<DiagnosticsReport name="Los Angeles" report={report()} />)
    for (const metric of metrics(DIAGNOSTICS))
      expect(html, metric.id).toContain(`data-metric="${metric.id}"`)
    expect(html).not.toContain('data-dismissed')
  })

  it('sends away what is pointed at or focused, and what was pressed open', () => {
    const after = explainedAfterEscape({ asked: 'edges', dismissed: [] }, ['stations', 'edges'])
    expect(after.asked).toBeNull()
    expect([...after.dismissed].sort()).toEqual(['edges', 'stations'])
  })

  // Pressed open on one row, then an Escape elsewhere (a colour picker
  // closing): the explanation is put away, and not dismissed, since no
  // pointer or focus is left on its row to clear a dismissal by leaving.
  it('puts away one pressed open whose row nothing is on, without dismissing it', () => {
    const after = explainedAfterEscape({ asked: 'crossings', dismissed: [] }, [])
    expect(after).toEqual({ asked: null, dismissed: [] })
  })

  it('changes nothing it was not showing', () => {
    expect(explainedAfterEscape(none, [])).toEqual(none)
  })

  it('brings one back when the pointer and the focus have left its row', () => {
    const dismissed = { asked: null, dismissed: ['edges', 'stations'] }
    expect(explainedAfterLeaving(dismissed, 'edges').dismissed).toEqual(['stations'])
    expect(explainedAfterLeaving(none, 'edges')).toBe(none)
  })

  it('shows one again on a press, and a second press puts it away', () => {
    const pressed = explainedAfterPress({ asked: null, dismissed: ['edges'] }, 'edges')
    expect(pressed).toEqual({ asked: 'edges', dismissed: [] })
    expect(explainedAfterPress(pressed, 'edges')).toEqual({ asked: null, dismissed: [] })
  })
})

describe('the copy, which can be refused', () => {
  it('hands the clipboard what the panel shows, and says so', async () => {
    const written: string[] = []
    const said = await copyReport(
      async (text) => {
        written.push(text)
      },
      'Los Angeles',
      report(),
    )
    expect(said).toBe(COPIED)
    expect(written).toEqual([copyText('Los Angeles', report())])
  })

  // The clipboard is the platform's: it can refuse, and a refusal is a
  // sentence on the panel rather than an error thrown inside a click.
  it('says so when the clipboard refuses, and throws nothing', async () => {
    const said = await copyReport(
      () => Promise.reject(new Error('the clipboard is not available')),
      'Los Angeles',
      report(),
    )
    expect(said).toBe(NOT_COPIED)
  })
})
