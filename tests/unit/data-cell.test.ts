// The sentence cell 01 carries while it is collapsed (A5.5-09, cut to one
// fact in issue 279): how many stops the engine counted in the feed.
//
// It is a pure function beside its cell, so what it says about a single
// stop and a count in the thousands is a table here rather than two states
// of a running app.

import { describe, expect, it } from 'vitest'
import { dataSummary } from '../../src/renderer/src/notebook/cells/DataCell'
import type { Inspection } from '../../src/shared/protocol'

const LA: Inspection = {
  key: 'la-metro-rail',
  name: 'LA Metro Rail',
  tables: ['agency', 'calendar', 'routes', 'stop_times', 'stops', 'trips'],
  agencies: [{ agency_id: 'LACMTA', agency_name: 'Los Angeles County MTA' }],
  routes: [],
  route_types: [],
  stops: { stops: 105, stations: 5, entrances: 0, generic_nodes: 0, boarding_areas: 0, total: 110 },
  trips: 1160,
  frequency_trips: 0,
  service: null,
  suggested_mode: 'all',
  warnings: [],
}

const feed = (over: Partial<Inspection> = {}): Inspection => ({ ...LA, ...over })

describe('what cell 01 says while it is collapsed', () => {
  it('says nothing at all before the inspection has arrived', () => {
    // Not an empty sentence: the stop count is not known yet, and a row
    // with a hole in it is worse than a row with nothing in it.
    expect(dataSummary(null)).toBeNull()
  })

  it('says how many stops the feed has, and nothing else', () => {
    // Not the feed, the mode or the operator (issue 279): the open cell and
    // the footer carry those, and the row was cut before the count.
    expect(dataSummary(LA)).toBe('110 stops in the feed')
  })

  it('counts one stop as one stop', () => {
    const one = feed({
      stops: { stops: 1, stations: 0, entrances: 0, generic_nodes: 0, boarding_areas: 0, total: 1 },
    })
    expect(dataSummary(one)).toBe('1 stop in the feed')
  })

  it('writes the stop count as a person reads numbers, as every other count is written', () => {
    const many = feed({
      stops: {
        stops: 2400,
        stations: 0,
        entrances: 0,
        generic_nodes: 0,
        boarding_areas: 0,
        total: 2400,
      },
    })
    // The literal, not `toLocaleString()` on both sides: that asserts only
    // that the test and the code call the same function.
    expect(dataSummary(many)).toBe('2,400 stops in the feed')
  })
})
