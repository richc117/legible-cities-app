// @vitest-environment jsdom
// Cell 03's service day, rendered (issue 433, part c): how the date control
// follows the record's day, and what a rebuild that stopped puts back. Both
// used to be state set from an effect, and are now set in the render that
// sees the change; these hold what a person sees.
//
// Drawn through `tests/support/render.tsx` (ADR-059), the kit real, a day
// typed with a real `input` and "Draw for this day" pressed with a real
// click. Each test names the mutation it was watched failing under, and
// each is an entry in `service-day-follows.mutations.json`.

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectRecord } from '../../src/shared/project/types'
import { answered, BASE, cleanup, press, renderCell } from '../support/render'
import { pending } from '../support/project-state'
import { snap, StandInRun } from '../support/stand-in-run'

afterEach(cleanup)

/**
 * The run as cell 03 reads it: the stand-in, with no job, a hook for the
 * day's write to flush on, and a rebuild that starts as `LayoutRun`'s does.
 */
class DayRun extends StandInRun {
  job(): null {
    return null
  }
  beforeStart(): () => void {
    return () => undefined
  }
  readonly rebuild = vi.fn(() => this.move({ ...snap('running'), rebuilt: true }))
}

/** The page answers nothing: the transport stays undrawn, and the trip is never asked. */
const viewer = { viewer: { call: () => pending<unknown>() } }

const project = (patch: Partial<ProjectRecord> = {}): ProjectRecord & { readOnly: boolean } => ({
  ...BASE,
  readOnly: false,
  ...patch,
})

/** The date control, "Draw for another day". */
function dayField(): HTMLInputElement {
  const label = [...document.querySelectorAll('label')].find(
    (each) => each.textContent === 'Draw for another day',
  )
  const field = label === undefined ? null : document.getElementById(label.htmlFor)
  if (!(field instanceof HTMLInputElement)) throw new Error('no field named "Draw for another day"')
  return field
}

/** The sentence under the date control. */
const dayMessage = (): string =>
  document.getElementById(dayField().getAttribute('aria-describedby') ?? '')?.textContent ?? ''

/** A day typed into the control, as the platform reports one. */
function type(day: string): void {
  const field = dayField()
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, day)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('the control follows the record’s day', () => {
  it('moves to a day chosen elsewhere and drops its sentence, and keeps a day being typed', async () => {
    // Mutations: the control put back to the record's day on every render
    // where the two differ (nothing can be typed), the follow removed (a
    // day chosen elsewhere is not shown), and the follow keyed on the
    // record object (a rename puts back the day being typed).
    const view = renderCell('frame', { project: project() }, { run: new DayRun(), api: viewer })
    await answered()
    expect(dayField().value).toBe('2026-09-12')

    type('2027-03-01')
    expect(dayField().value, 'a day outside the window, typed').toBe('2027-03-01')
    expect(dayMessage()).toBe('The feed covers 1 January 2026 to 31 December 2026.')

    view.rerender({ project: project({ date: '2026-10-01' }) })
    expect(dayField().value, 'the record’s new day').toBe('2026-10-01')
    expect(dayMessage(), 'the sentence goes with the day it was about').toBe('')

    type('2026-11-02')
    view.rerender({ project: project({ date: '2026-10-01', name: 'Los Angeles, renamed' }) })
    view.rerender({ settling: true })
    expect(dayField().value, 'the day being typed, through a rename and a render').toBe(
      '2026-11-02',
    )
  })
})

describe('a rebuild that stopped puts the record’s day back', () => {
  it('puts the record’s day in the control as the rebuild stops, and keeps a day typed after', async () => {
    // Mutations: the day put back for as long as the run stays stopped (a
    // new day cannot be typed after a failed "Draw for this day"), and the
    // put-back removed (the control shows a day the record does not hold).
    const run = new DayRun()
    renderCell('frame', { project: project() }, { run, api: viewer })
    await answered()

    type('2026-10-05')
    press('Draw for this day')
    await answered()
    expect(run.rebuild, 'the rebuild for the day typed').toHaveBeenCalledTimes(1)

    act(() => run.move({ ...snap('cancelled'), rebuilt: true }))
    expect(dayField().value, 'the record’s day, as the rebuild stops').toBe('2026-09-12')

    type('2026-10-07')
    expect(dayField().value, 'a day typed after the stop').toBe('2026-10-07')
  })

  it('puts the record’s day back when a rebuild is refused after another run failed', async () => {
    // The run stays failed and only `rebuilt` moves: a layout run failed,
    // then a rebuild was refused at once. Mutation: the edge taken on the
    // state alone, which never sees this one.
    const run = new DayRun()
    renderCell('frame', { project: project() }, { run, api: viewer })
    await answered()
    act(() => run.move(snap('failed')))

    type('2026-10-05')
    expect(dayField().value, 'a layout run’s failure puts nothing back').toBe('2026-10-05')

    act(() => run.move({ ...snap('failed'), rebuilt: true }))
    expect(dayField().value, 'the record’s day, as the rebuild is refused').toBe('2026-09-12')
  })
})
