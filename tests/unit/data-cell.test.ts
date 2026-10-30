// The sentence cell 01 carries while it is collapsed (A5.5-09, cut to one
// fact in issue 279): how many stops the engine counted in the feed.
//
// It is a pure function beside its cell, so what it says about a single
// stop and a count in the thousands is a table here rather than two states
// of a running app.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  DataFields,
  dataSummary,
  pickersDrawn,
  type Pickers,
} from '../../src/renderer/src/notebook/cells/DataCell'
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

// Issue 543. The field list named a project with no operator "Agency none",
// where the picker below it offers "every operator" for the same value and
// the facts beside it say "Operators": one value, one name on one screen.
describe("cell 01's field list", () => {
  const fields = (agency: string | null): string =>
    renderToStaticMarkup(createElement(DataFields, { feed: 'la-metro-rail', mode: 'all', agency }))

  it('says every operator for a project with no operator, as the picker does', () => {
    const html = fields(null)
    expect(html).toContain('<dt>Operator</dt><dd>every operator</dd>')
    expect(html).not.toContain('none')
    expect(html).not.toContain('Agency')
  })

  it('says the operator when the project names one', () => {
    expect(fields('LACMTA')).toContain('<dt>Operator</dt><dd>LACMTA</dd>')
  })

  it('keeps the feed and the mode as they were', () => {
    expect(fields(null)).toContain('<dt>Feed</dt><dd>la-metro-rail</dd><dt>Mode</dt><dd>all</dd>')
  })
})

// Issue 560. The mode and the operator were listed in the field list and
// again by their pickers just below it: one fact said twice. A row goes
// where its picker is drawn, and only there, so neither is ever said by
// nothing. Each test was watched failing under its mutation in
// `data-cell.mutations.json`.
describe("cell 01's field list beside the pickers", () => {
  const drawn = (pickers: Pickers): string =>
    renderToStaticMarkup(
      createElement(DataFields, { feed: 'la-metro-rail', mode: 'all', agency: 'LACMTA', pickers }),
    )
  const MANY: Inspection = {
    ...LA,
    agencies: [...LA.agencies, { agency_id: 'MTS', agency_name: 'San Diego MTS' }],
  }

  it('leaves out each row whose picker is drawn, and keeps the feed', () => {
    expect(drawn({ mode: true, operator: true })).toBe(
      '<dl class="fields"><dt>Feed</dt><dd>la-metro-rail</dd></dl>',
    )
    expect(drawn({ mode: true, operator: false })).toBe(
      '<dl class="fields"><dt>Feed</dt><dd>la-metro-rail</dd><dt>Operator</dt><dd>LACMTA</dd></dl>',
    )
  })

  it('draws the pickers once the feed is read with the engine ready, and never for a read-only project', () => {
    const facts = { readOnly: false, ready: true, inspection: LA, agency: null, refused: false }
    expect(pickersDrawn(facts)).toEqual({ mode: true, operator: false })
    expect(pickersDrawn({ ...facts, inspection: MANY })).toEqual({ mode: true, operator: true })
    expect(pickersDrawn({ ...facts, agency: 'LACMTA' }), 'a stored operator').toEqual({
      mode: true,
      operator: true,
    })
    const none = { mode: false, operator: false }
    const tuned = { ...facts, inspection: MANY, agency: 'LACMTA' }
    expect(pickersDrawn({ ...tuned, inspection: null }), 'the feed not read yet').toEqual(none)
    expect(pickersDrawn({ ...tuned, ready: false }), 'the engine away').toEqual(none)
    expect(pickersDrawn({ ...tuned, readOnly: true }), 'read-only').toEqual(none)
  })

  it('draws none while the panel says a choice was refused, so the stored values are listed', () => {
    const facts = { readOnly: false, ready: true, inspection: LA, agency: 'LACMTA', refused: true }
    expect(pickersDrawn(facts)).toEqual({ mode: false, operator: false })
  })
})
