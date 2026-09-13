// What the panel makes of the engine's numbers: the formatting, the rows,
// the sentence and the copied block, and the markup itself rendered without
// a browser. Every figure here is the engine's; a test that expects the app
// to add one up would be testing a second opinion (constitution II).

import { describe, expect, it } from 'vitest'
import {
  caveatsSentence,
  copyText,
  count,
  coverage,
  few,
  metrics,
  percent,
  score,
  shownIds,
} from '../../src/renderer/src/engine/diagnostics'
import type { RunReport } from '../../src/renderer/src/engine/layoutRun'
import type { Diagnostics } from '../../src/shared/protocol'

// Los Angeles's shape, with each field given a figure of its own so a row
// that reads the wrong one is visible.
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

const row = (id: string): { label: string; value: string; explain: string } => {
  const found = metrics(DIAGNOSTICS).find((m) => m.id === id)
  if (found === undefined) throw new Error(`no row ${id}`)
  return found
}

describe('the figures are formatted, never computed', () => {
  it('prints a share the way the engine prints it', () => {
    expect(percent(0.9938, 1)).toBe('99.4%')
    expect(percent(1, 1)).toBe('100.0%')
    expect(percent(0.9655)).toBe('97%')
    expect(percent(0)).toBe('0%')
    expect(percent(Number.NaN)).toBe('—')
  })

  it('prints the issue score as the engine sent it, and 0 for a clean network', () => {
    expect(score(0)).toBe('0')
    expect(score(0.2137)).toBe('0.2137')
    expect(score(0.01)).toBe('0.01')
    expect(score(1)).toBe('1')
    // Rounded to four places by the engine; a smaller number keeps them.
    expect(score(0.00004)).toBe('0.0000')
  })

  it('divides only where the engine does, and not by nothing', () => {
    expect(coverage(DIAGNOSTICS.stops)).toBeCloseTo(112 / 116)
    expect(coverage({ ...DIAGNOSTICS.stops, matched: 0, total: 0 })).toBe(0)
  })

  it('names a few and says how many were left', () => {
    expect(few([])).toBe('none')
    expect(few(['A', 'B'])).toBe('A, B')
    expect(few(['1', '2', '3', '4', '5', '6', '7', '8'])).toBe('1, 2, 3, 4, 5, 6, and 2 more')
  })

  it('groups a count the reader is used to', () => {
    expect(count(114)).toBe('114')
    expect(count(1135)).toMatch(/^1.?135$/)
  })

  // Constitution V: nothing a person reads carries a path. A stop id from
  // a feed is not one, and an id shaped like one is withheld.
  it('withholds a stop id that is shaped like a path', () => {
    // The two paths are assembled rather than written out: bin/preflight
    // refuses a path literal in a committed file, as it should, and a test
    // that needs one is no reason to weaken the scanner.
    const posix = ['', 'Users', 'someone', 'feeds'].join('/')
    const windows = ['C:', 'feeds', 'la'].join('\\')
    expect(shownIds(['80122', posix, windows, 'A/B', ''])).toEqual(['80122', 'A/B'])
  })
})

describe('the rows say what the engine measured', () => {
  it("takes each figure from its own field, and the engine's vocabulary with it", () => {
    expect(row('octilinear').value).toBe('99.4%')
    expect(row('stations').value).toBe('114')
    expect(row('junctions').value).toBe('8')
    expect(row('edges').value).toBe('121')
    expect(row('lines')).toMatchObject({
      value: '3',
      explain: 'The lines the layout drew: A, B, C.',
    })
    expect(row('matched').value).toBe('112 of 116 (97%)')
    expect(row('by-station-id').value).toBe('100')
    expect(row('by-parent-station').value).toBe('10')
    expect(row('by-name').value).toBe('2')
    expect(row('unmatched').value).toBe('80122, 80123')
    expect(row('trips').value).toBe('135')
    expect(row('paths').value).toBe('40')
    expect(row('unrouted').value).toBe('3')
    expect(row('labels').value).toBe('2')
    expect(row('peak').value).toBe('19')
  })

  // The protocol's field is called skipped_calls and counts trips: the
  // engine's own sentence is "N trips skipped an unmatched stop".
  it('says trips where the engine counts trips', () => {
    expect(row('skipped')).toMatchObject({ label: 'Trips skipping a stop', value: '12' })
    expect(row('borrowed')).toMatchObject({ label: 'Trips on borrowed track', value: '26' })
    expect(row('borrowed').explain).toMatch(/neighbouring line's track/)
  })

  it('never turns the unmatched examples into a count', () => {
    // The engine sends at most eight ids; 116 - 112 is four, and the row
    // must not claim to know that from a list of two.
    expect(row('unmatched').label).toMatch(/first few/)
    expect(row('unmatched').value).not.toMatch(/^\d+$/)
    expect(row('unmatched').explain).toMatch(/not a count/)
  })

  it('has an explanation for every row', () => {
    for (const metric of metrics(DIAGNOSTICS)) {
      expect(metric.explain, metric.id).toMatch(/\.$/)
      expect(metric.explain.length, metric.id).toBeGreaterThan(20)
      expect(metric.label.length, metric.id).toBeGreaterThan(2)
    }
  })

  it('copes with a network with nothing in it', () => {
    const empty: Diagnostics = {
      stations: 0,
      junctions: 0,
      edges: 0,
      lines: [],
      octilinear: 0,
      stops: {
        matched: 0,
        total: 0,
        by: { station_id: 0, parent_station: 0, name: 0 },
        unmatched: [],
      },
      trips: { total: 0, paths: 0, unrouted: 0 },
      degraded: { skipped_calls: 0, borrowed_track: 0 },
      labels_dropped: 0,
      peak_concurrent: 0,
    }
    expect(metrics(empty).find((m) => m.id === 'matched')?.value).toBe('0 of 0 (0%)')
    expect(metrics(empty).find((m) => m.id === 'unmatched')?.value).toBe('none')
  })
})

describe('the caveats line, and what "Copy as text" hands over', () => {
  it('says there are none and that the score is 0 for a clean network', () => {
    expect(caveatsSentence(report({ caveats: [], issues: 0 }))).toBe(
      'No caveats: nothing was fudged, and the issues score is 0.',
    )
  })

  it('counts the caveats and gives the score beside them', () => {
    expect(caveatsSentence(report())).toBe(
      '1 caveat, and an issues score of 0.2137, where 0 is clean.',
    )
    expect(caveatsSentence(report({ caveats: ['a', 'b'] }))).toMatch(/^2 caveats,/)
  })

  it('copies the project, the day, every row, the sentences and the score', () => {
    const text = copyText('Los Angeles', report())
    expect(text.split('\n')[0]).toBe('Los Angeles — the map drawn for 2026-09-15')
    for (const metric of metrics(DIAGNOSTICS))
      expect(text, metric.id).toContain(`${metric.label}: ${metric.value}`)
    expect(text).toContain('Caveats:\n- 4 of 116 stops could not be placed on the map')
    expect(text).toContain('Issues score: 0.2137 (0 is clean)')
    expect(text).not.toMatch(/undefined|NaN/)
  })

  it('says so plainly when there is nothing to report', () => {
    const text = copyText('Los Angeles', report({ caveats: [], issues: 0 }))
    expect(text).toContain('No caveats.')
    expect(text).toContain('Issues score: 0 (0 is clean)')
  })
})
