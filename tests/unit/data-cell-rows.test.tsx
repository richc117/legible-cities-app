// @vitest-environment jsdom
// Cell 01's field list beside the pickers, rendered (issue 560): the Mode
// and Operator rows go where `Inspect` draws their pickers, and only there,
// so the stored mode and operator are always said somewhere. That holds
// only while the cell's reading of the feed is the panel's, and while the
// pickers show what is stored: across an engine restart, after a refused
// read, and while a refused choice's sentence is up.
//
// Drawn through `tests/support/render.tsx` (ADR-059), the kit real. Each
// test was watched failing under its mutation in
// `data-cell-rows.mutations.json`.

import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { EngineState } from '../../src/shared/engine'
import type { Inspection } from '../../src/shared/protocol'
import { answered, byName, cleanup, READY, renderCell } from '../support/render'
import { pending } from '../support/project-state'
import { StandInRun } from '../support/stand-in-run'

afterEach(cleanup)

/** The run as cell 01 reads it: the stand-in, with no job yet. */
class JobRun extends StandInRun {
  job(): null {
    return null
  }
}

const RESTARTING: EngineState = { state: 'restarting', attempt: 1, reason: 'it stopped' }

/** A feed of two operators, in the whole shape `Inspect` draws, so both pickers are offered. */
const FEED = {
  key: 'la-metro-rail',
  name: 'LA Metro Rail',
  tables: [],
  agencies: [
    { agency_id: 'M', agency_name: 'Metro' },
    { agency_id: 'S', agency_name: 'Metrolink' },
  ],
  routes: [
    {
      route_id: 'A',
      agency_id: 'M',
      short_name: 'A',
      long_name: '',
      label: 'A',
      route_type: 1,
      color: null,
      text_color: null,
      trips: 1,
    },
  ],
  route_types: [
    { route_type: 1, name: 'subway', mode: 'subway', modes: ['subway'], routes: 1, trips: 1 },
  ],
  stops: { stops: 1, stations: 0, entrances: 0, generic_nodes: 0, boarding_areas: 0, total: 1 },
  trips: 1,
  frequency_trips: 0,
  service: null,
  suggested_mode: 'subway',
  warnings: [],
} as unknown as Inspection

const read = (): Promise<Inspection> => Promise.resolve(FEED)

/** The terms of cell 01's own field list, not the panel's. */
const terms = (): string[] =>
  [...document.querySelectorAll('.cell-body > dl.fields > dt')].map((dt) => dt.textContent ?? '')

/** A choice made on the select named `name`, as a person makes it. */
function choose(name: string, value: string): void {
  const element = byName('combobox', name) as HTMLSelectElement
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(element, value)
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe("cell 01's field list as the feed's reading comes and goes", () => {
  it('lists the mode and the operator again while the engine is back and the feed is read again', async () => {
    const view = renderCell('data', { inspect: read }, { run: new JobRun() })
    await answered()
    expect(terms(), 'the feed read: the pickers say both').toEqual(['Feed'])

    view.rerender({ engine: RESTARTING })
    await answered()
    expect(terms(), 'the engine away').toEqual(['Feed', 'Mode', 'Operator'])

    view.rerender({ engine: READY, inspect: () => pending() })
    await answered()
    expect(terms(), 'back, and reading the feed again').toEqual(['Feed', 'Mode', 'Operator'])
  })

  it('lists them again once a read of the feed is refused', async () => {
    const view = renderCell('data', { inspect: read }, { run: new JobRun() })
    await answered()
    expect(terms()).toEqual(['Feed'])

    view.rerender({ inspect: () => Promise.reject(new Error('the feed is gone')) })
    await answered()
    expect(terms(), 'the read refused').toEqual(['Feed', 'Mode', 'Operator'])
  })

  it('lists the stored mode and operator while a refused choice is said', async () => {
    const refuse = (): Promise<void> => Promise.reject(new Error('the store said no'))
    renderCell('data', { inspect: read, setInputs: refuse }, { run: new JobRun() })
    await answered()
    expect(terms()).toEqual(['Feed'])

    choose('Mode', 'subway')
    await answered()
    expect(terms(), 'the refusal is up').toEqual(['Feed', 'Mode', 'Operator'])
    const values = [...document.querySelectorAll('.cell-body > dl.fields > dd')].map(
      (dd) => dd.textContent,
    )
    expect(values, 'the record’s values, not the choice').toEqual([
      'la-metro-rail',
      'all',
      'every operator',
    ])
  })
})
