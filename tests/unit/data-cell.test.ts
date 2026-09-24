// The sentence cell 01 carries while it is collapsed (A5.5-09): the feed,
// what LOOM keeps, whose routes, and the stop count.
//
// It is a pure function beside its cell, so what it says about a feed with
// no name, a mode of several words, an operator the feed does not list and
// a single stop is a table here rather than four states of a running app.

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
    // Not an empty sentence and not the feed's key on its own: the stop
    // count is not known yet, and a row with a hole in it is worse than a
    // row with nothing in it.
    expect(dataSummary({ feed: 'la-metro-rail', mode: 'all', agency: null }, null)).toBeNull()
  })

  it('names the feed, the mode, the operator and the stop count', () => {
    expect(dataSummary({ feed: 'la-metro-rail', mode: 'subway', agency: 'LACMTA' }, LA)).toBe(
      `LA Metro Rail, subway, Los Angeles County MTA, ${(110).toLocaleString()} stops`,
    )
  })

  it("says the engine's own word for every type as the Mode control says it", () => {
    expect(dataSummary({ feed: 'la-metro-rail', mode: 'all', agency: null }, LA)).toBe(
      `LA Metro Rail, every type, every operator, ${(110).toLocaleString()} stops`,
    )
  })

  it('reads a comma-joined mode as prose, in the order it was typed', () => {
    expect(dataSummary({ feed: 'la-metro-rail', mode: 'rail,subway', agency: null }, LA)).toContain(
      'rail and subway',
    )
    expect(
      dataSummary({ feed: 'la-metro-rail', mode: 'rail, subway ,tram', agency: null }, LA),
    ).toContain('rail, subway and tram')
  })

  it('keeps a route_type number as the number the person typed', () => {
    expect(dataSummary({ feed: 'la-metro-rail', mode: '1', agency: null }, LA)).toContain(
      'LA Metro Rail, 1, every operator',
    )
  })

  it('names an operator the feed does not list by its id, as the control does', () => {
    expect(dataSummary({ feed: 'la-metro-rail', mode: 'subway', agency: 'GONE' }, LA)).toContain(
      'subway, GONE,',
    )
  })

  it('falls back to the feed key when the feed has no name of its own', () => {
    expect(dataSummary({ feed: 'my-feed', mode: 'subway', agency: null }, feed({ name: '' }))).toBe(
      `my-feed, subway, every operator, ${(110).toLocaleString()} stops`,
    )
  })

  it('counts one stop as one stop', () => {
    const one = feed({
      stops: { stops: 1, stations: 0, entrances: 0, generic_nodes: 0, boarding_areas: 0, total: 1 },
    })
    expect(dataSummary({ feed: 'tiny', mode: 'subway', agency: null }, one)).toBe(
      'LA Metro Rail, subway, every operator, 1 stop',
    )
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
    expect(dataSummary({ feed: 'big', mode: 'all', agency: null }, many)).toContain(
      `${(2400).toLocaleString()} stops`,
    )
  })
})
