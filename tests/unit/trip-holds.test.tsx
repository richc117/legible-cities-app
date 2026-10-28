// @vitest-environment jsdom
// Cell 03's trip, rendered (issue 433, part c): a choice refused while a
// run holds the page leaves its sentence beside the picker until the hold
// ends, and only that sentence goes then; a refusal of another kind stays.
// The hold's sentences used to be filtered out from an effect, and are now
// filtered in the render that sees the hold end.
//
// Drawn through `tests/support/render.tsx` (ADR-059), the kit real; a
// station is chosen as a person chooses one, by typing its name into the
// picker and pressing its option. The test names the mutations it was
// watched failing under, each an entry in `trip-holds.mutations.json`.

import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { SAME_STATION, tripRefusal } from '../../src/renderer/src/tripWords'
import type { ProjectRecord } from '../../src/shared/project/types'
import { answered, BASE, byName, cleanup, renderCell } from '../support/render'
import { pending } from '../support/project-state'
import { drawnOf } from '../support/sent'
import { StandInRun } from '../support/stand-in-run'

afterEach(cleanup)

/** The run as cell 03 reads it: the stand-in, with no job and a hook for the day's write. */
class FrameRun extends StandInRun {
  job(): null {
    return null
  }
  beforeStart(): () => void {
    return () => undefined
  }
}

/** The page takes every ask and answers none: the transport stays undrawn. */
const page = { viewer: { call: () => pending<unknown>() } }

const STATIONS = [
  { id: 'n1', name: 'Union Station' },
  { id: 'n2', name: 'Pershing Square' },
]

/** Laid out and drawn, with the map's two stations kept. */
const PROJECT: ProjectRecord & { readOnly: boolean } = {
  ...BASE,
  readOnly: false,
  drawn: { ...(drawnOf(BASE) as NonNullable<ProjectRecord['drawn']>), stations: STATIONS },
}

const HELD = tripRefusal({ laying: true, exporting: false })

/** The station named `name` chosen in the picker named `picker`. */
function pick(picker: string, name: string): void {
  const field = byName('combobox', picker) as HTMLInputElement
  act(() => {
    field.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, name)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (each) => each.textContent === name,
  )
  if (option === undefined) throw new Error(`no option "${name}" under ${picker}`)
  act(() => {
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  })
}

/** The sentence beside the picker named `picker`. */
const said = (picker: string): string =>
  byName('combobox', picker).closest('.combobox')?.querySelector('[role="alert"]')?.textContent ??
  ''

describe('the trip’s refusals as a hold ends', () => {
  it('drops the hold’s sentence when the run ends, and keeps a refusal of another kind', async () => {
    // Mutations: the reset filtering every refusal (the same-station one
    // goes with the hold's), and the reset removed (the hold's sentence
    // stays after the run).
    const view = renderCell('frame', { project: PROJECT }, { run: new FrameRun(), api: page })
    await answered()

    pick('Start', 'Union Station')
    pick('End', 'Union Station')
    expect(said('End'), 'the same station twice').toBe(SAME_STATION)

    view.rerender({ layingOut: true })
    pick('Start', 'Pershing Square')
    expect(said('Start'), 'refused while a run holds the page').toBe(HELD)
    expect(said('End')).toBe(SAME_STATION)

    view.rerender({ layingOut: false })
    expect(said('Start'), 'gone with the hold').toBe('')
    expect(said('End'), 'not the hold’s, so it stays').toBe(SAME_STATION)
  })
})
