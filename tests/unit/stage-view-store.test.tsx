// @vitest-environment jsdom
// Cell 01's stage view, rendered (issue 433, part c, issue 382): what the
// pane holds of the store's drawings around a toggle and a reveal's
// hand-back. The pane's request used to reset its answer and set a loading
// flag from an effect; the answer now carries what it was asked for, the
// reset is made in the render that sees the pane stop being the store's,
// and the loading is derived.
//
// Drawn through `tests/support/render.tsx` (ADR-059), the kit real, the
// stage buttons pressed with a real click. The engine's drawings are
// stand-ins whose SVG names the set and the stage they are of, and every
// read waits until the test answers it. Each test names the mutations it
// was watched failing under, each an entry in
// `stage-view-store.mutations.json`.

import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { RenderStageResult, StageName } from '../../src/shared/protocol'
import { answered, BASE, cleanup, press, renderCell } from '../support/render'
import { pending } from '../support/project-state'
import { snap, StandInRun } from '../support/stand-in-run'

afterEach(cleanup)

/** The run as cell 01 reads it: the stand-in, with the job a test names. */
class JobRun extends StandInRun {
  id: string | null = null
  job(): { id: string } | null {
    return this.id === null ? null : { id: this.id }
  }
}

/** A drawing of `stage` from the set `made`, its SVG naming both. */
const drawingOf = (made: string | null, stage: StageName): RenderStageResult =>
  ({
    layout: BASE.layout,
    stage,
    svg: `<svg>${made ?? 'no set'} ${stage}</svg>`,
    width: 100,
    height: 100,
    counts: { nodes: 1, stations: 1, junctions: 0, edges: 1, lines: [] },
  }) as unknown as RenderStageResult

/** The engine's stage reads, each held until the test answers it. */
function heldReads(): {
  asks: { made: string | null; stage: StageName; answer: () => void }[]
  readStage: (
    key: string,
    layout: string,
    made: string | null,
    stage: StageName,
  ) => Promise<RenderStageResult>
} {
  const asks: { made: string | null; stage: StageName; answer: () => void }[] = []
  return {
    asks,
    readStage: (_key, _layout, made, stage) =>
      new Promise((resolve) => {
        asks.push({ made, stage, answer: () => resolve(drawingOf(made, stage)) })
      }),
  }
}

/** What the pane's frame draws, or null where the pane holds no drawing. */
const pictured = (): string | null =>
  document.querySelector('.stage-pane iframe')?.getAttribute('srcdoc') ?? null

/** The view's status sentence beside the pane, or null. */
const status = (): string | null =>
  document.querySelector('.stage-view p.hint[role="status"]')?.textContent ?? null

describe('the stored stage’s drawing', () => {
  it('stays while a toggle is read, busy, and is gone while a reveal hands back', async () => {
    // Mutations: the reset only when the engine is not ready (the stored
    // drawing shows while a reveal hands back, which issue 382 forbids),
    // and the loading derived without what the answer was asked for (a
    // toggle reads as done while the next stage is still on its way).
    const run = new JobRun()
    const reads = heldReads()
    const view = renderCell(
      'data',
      { inspect: () => pending(), readStage: reads.readStage },
      { run },
    )
    await answered()
    expect(reads.asks.map((a) => a.stage)).toEqual(['gtfs2graph'])
    act(() => reads.asks[0].answer())
    await answered()
    expect(pictured()).toContain(`${BASE.made} gtfs2graph`)
    expect(status(), 'drawn, so nothing is said').toBeNull()

    press('loom')
    await answered()
    expect(reads.asks.map((a) => a.stage)).toEqual(['gtfs2graph', 'loom'])
    expect(pictured(), 'the last drawing stays while the next is read').toContain(
      `${BASE.made} gtfs2graph`,
    )
    expect(status(), 'busy while the next is read').toBe('Drawing the stage…')

    // A layout run has finished, and its record is being read back.
    run.id = 'job-7'
    act(() => run.move({ ...snap('done'), layout: 'b'.repeat(64) }))
    view.rerender({ settling: true })
    await answered()
    expect(pictured(), 'nothing while the reveal hands back').toBeNull()
    expect(status()).toBe('Drawing the stage…')
  })
})
