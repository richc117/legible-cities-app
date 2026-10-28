// @vitest-environment jsdom
// Cell 01's Inspect panel, rendered (issue 433, part c): what it shows
// while the engine is away and comes back, and how its mode and operator
// follow the record. Both used to be state set from an effect, and are now
// set in the render that sees the change; these hold what a person sees.
//
// Drawn through `tests/support/render.tsx` (ADR-059), the kit real. Each
// test names the mutation it was watched failing under, and each is an
// entry in `inspect-follows.mutations.json`.

import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { EngineState } from '../../src/shared/engine'
import type { ProjectInputs, ProjectRecord } from '../../src/shared/project/types'
import type { Inspection } from '../../src/shared/protocol'
import { answered, BASE, byName, cleanup, READY, renderCell } from '../support/render'
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

/** A feed of two operators and three routes, in the whole shape `Inspect` draws. */
const FEED = {
  key: 'la-metro-rail',
  name: 'LA Metro Rail',
  tables: [],
  agencies: [
    { agency_id: 'M', agency_name: 'Metro' },
    { agency_id: 'S', agency_name: 'Metrolink' },
  ],
  routes: ['A', 'B', 'C'].map((label) => ({
    route_id: label,
    agency_id: label === 'C' ? 'S' : 'M',
    short_name: label,
    long_name: '',
    label,
    route_type: label === 'C' ? 2 : 1,
    color: null,
    text_color: null,
    trips: 1,
  })),
  route_types: [
    { route_type: 1, name: 'subway', mode: 'subway', modes: ['subway'], routes: 2, trips: 2 },
    { route_type: 2, name: 'rail', mode: 'rail', modes: ['rail'], routes: 1, trips: 1 },
  ],
  stops: { stops: 3, stations: 0, entrances: 0, generic_nodes: 0, boarding_areas: 0, total: 3 },
  trips: 3,
  frequency_trips: 0,
  service: null,
  suggested_mode: 'subway',
  warnings: [],
} as unknown as Inspection

const read = (): Promise<Inspection> => Promise.resolve(FEED)

/** The rows of the routes table, as drawn. */
const routeRows = (): Element[] => [...document.querySelectorAll('table.routes tbody tr')]

/** The select named `name`: the platform's own, inside the kit's dropdown. */
const select = (name: string): HTMLSelectElement => byName('combobox', name) as HTMLSelectElement

/** A choice made on the select named `name`, as a person makes it. */
function choose(name: string, value: string): void {
  const element = select(name)
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(element, value)
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** What the kit's dropdown named `name` holds as its value. */
const shown = (name: string): string | null =>
  select(name).closest('fig-dropdown')?.getAttribute('value') ?? null

describe('the inspection while the engine is away', () => {
  it('shows no row of the old inspection once the engine restarts, nor when it is back and asking again', async () => {
    // Mutation: the guarded reset removed. The engine's restart leaves the
    // inspection it read before on screen, rows and all.
    const view = renderCell('data', { inspect: read }, { run: new JobRun() })
    await answered()
    expect(routeRows(), 'the feed read').toHaveLength(3)

    view.rerender({ engine: RESTARTING })
    await answered()
    expect(routeRows(), 'nothing of it while the engine is away').toHaveLength(0)

    view.rerender({ engine: READY, inspect: () => pending() })
    await answered()
    expect(routeRows(), 'nothing of it while the feed is read again').toHaveLength(0)
  })
})

describe('the mode and the operator follow the record', () => {
  /** What `setInputs` was sent, and an answer the test never gives: the write is held. */
  function held(): {
    sent: Partial<ProjectInputs>[]
    setInputs: (i: Partial<ProjectInputs>) => Promise<void>
  } {
    const sent: Partial<ProjectInputs>[] = []
    return {
      sent,
      setInputs: (inputs) => {
        sent.push(inputs)
        return pending()
      },
    }
  }

  it('keeps a mode chosen while its write is on its way, and moves when the record is read again', async () => {
    // Mutations: the mirror applied on every render (the chosen mode snaps
    // back to the record's before its write answers), and the mirror
    // removed (a record read again does not move the select).
    const store = held()
    const project: ProjectRecord & { readOnly: boolean } = { ...BASE, readOnly: false }
    const view = renderCell(
      'data',
      { project, inspect: read, setInputs: store.setInputs },
      { run: new JobRun() },
    )
    await answered()
    expect(shown('Mode')).toBe('all')

    choose('Mode', 'rail')
    await answered()
    expect(store.sent).toEqual([{ mode: 'rail', agency: null }])
    expect(shown('Mode'), 'the choice shown while its write is held').toBe('rail')

    // Something else draws the screen while the write is held: the record
    // has not moved, and the choice stays.
    view.rerender({ settling: true })
    await answered()
    expect(shown('Mode'), 'still the choice after a render of the screen').toBe('rail')

    // The record read again, by Run all or a reopening, holds another mode.
    view.rerender({ project: { ...project, mode: 'subway', agency: 'M' } })
    await answered()
    expect(shown('Mode'), 'the record’s mode').toBe('subway')
    expect(shown('Operator'), 'the record’s operator').toBe('M')
  })
})
