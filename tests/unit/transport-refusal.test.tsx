// @vitest-environment jsdom
// Cell 03's transport, rendered (issue 433, part c): the sentence a press
// is refused with while a run holds the page goes when the hold does, and
// does not come back at the next hold with nobody pressing. It used to be
// cleared from an effect, and is now cleared in the render that sees the
// hold end.
//
// Drawn through `tests/support/render.tsx` (ADR-059), the kit real, "Pause"
// pressed with a real click (the page plays its day from the start). The
// page is a stand-in that answers its day and its clock, so the transport
// draws. The test names the mutations it was watched failing under, each
// an entry in `transport-refusal.mutations.json`.

import { afterEach, describe, expect, it } from 'vitest'
import { transportRefusal } from '../../src/renderer/src/transportState'
import { answered, cleanup, press, renderCell } from '../support/render'
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

/** The map's page: a day from midnight to midnight, its clock at one in the morning. */
const page = {
  viewer: {
    call: async (_frame: string, method: string): Promise<unknown> =>
      method === 'bounds'
        ? { t0: 0, t1: 86_400 }
        : method === 'state'
          ? { now: 3_600, clock: '01:00' }
          : undefined,
  },
}

const HELD = transportRefusal({ laying: true, exporting: false })

/** The sentence under the transport's controls, or null where none is drawn. */
const refusal = (): string | null =>
  document.querySelector('section.transport [role="alert"]')?.textContent ?? null

describe('the transport’s refusal', () => {
  it('goes when the hold ends, and is not back at the next hold', async () => {
    // Mutations: the reset removed (the sentence stays after the run), and
    // the sentence derived from the hold instead of reset (it comes back at
    // the next run with nobody pressing).
    const view = renderCell('frame', {}, { run: new FrameRun(), api: page })
    await answered()
    expect(document.querySelector('section.transport'), 'the page said its day').not.toBeNull()

    view.rerender({ layingOut: true })
    press('Pause')
    expect(refusal(), 'refused while a run holds the page').toBe(HELD)

    view.rerender({ layingOut: false })
    expect(refusal(), 'gone with the hold').toBeNull()

    view.rerender({ layingOut: true })
    expect(refusal(), 'not back at the next hold').toBeNull()
  })
})
