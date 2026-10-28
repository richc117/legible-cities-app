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
import { freshStages, type RunSnapshot } from '../../src/renderer/src/engine/layoutRun'
import type { RenderStageResult, StageName } from '../../src/shared/protocol'
import { answered, BASE, byName, cleanup, press, renderCell } from '../support/render'
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

describe('a reveal that ends', () => {
  /** A layout run of the layout `b…b` going, with `done` reported. */
  const going = (done: StageName[]): RunSnapshot => ({
    ...snap('running'),
    layout: 'b'.repeat(64),
    stages: freshStages().map((s) => ({
      ...s,
      state: done.includes(s.id as StageName) ? ('done' as const) : ('pending' as const),
    })),
  })

  /** Whether the stage button named `name` is drawn pressed. */
  const isPressed = (name: string): string | null =>
    byName('button', name).getAttribute('aria-pressed')

  it('leaves nothing it drew or pressed to the next run’s pane', async () => {
    // Mutation: the press read without asking whose run it was made in
    // (the next run's pane shows the stage pressed in the last one, not its
    // own latest).
    const run = new JobRun()
    const reads = heldReads()
    const answer = (made: string): void =>
      act(() => {
        for (const ask of reads.asks.filter((a) => a.made === made)) ask.answer()
      })
    renderCell('data', { inspect: () => pending(), readStage: reads.readStage }, { run })
    await answered()

    run.id = 'job-A'
    act(() => run.move(going(['gtfs2graph', 'topo'])))
    await answered()
    answer('run job-A')
    await answered()
    expect(pictured(), 'the run’s latest stage').toContain('run job-A topo')
    press('gtfs2graph')
    expect(pictured(), 'the stage pressed').toContain('run job-A gtfs2graph')
    expect(isPressed('gtfs2graph')).toBe('true')

    // A ends, its record read back; then the next run, B, starts.
    act(() => run.move({ ...snap('done'), layout: 'b'.repeat(64) }))
    await answered()
    run.id = 'job-B'
    act(() => run.move(going([])))
    await answered()
    expect(pictured(), 'nothing of A’s drawings').toBeNull()
    expect(isPressed('gtfs2graph'), 'nor A’s press').toBe('false')

    act(() => run.move(going(['gtfs2graph', 'topo'])))
    await answered()
    answer('run job-B')
    await answered()
    expect(pictured(), 'B’s own latest stage').toContain('run job-B topo')
    expect(isPressed('gtfs2graph'), 'A’s press is not B’s').toBe('false')
  })

  it('shows nothing of a run that the next one follows with no render between', async () => {
    // A's end and B's start are drawn in one render, so nothing sees no run
    // revealing and the drawings are not let go: B's pane is kept from A's
    // by the job id alone. Mutation: the reveal's drawings read without
    // asking whose run they are of (B's pane draws A's latest stage).
    //
    // That the drawings are let go once no run reveals cannot be seen in
    // the document: nothing reads them then. With that reset removed every
    // assertion in this file holds, so it has no mutation entry.
    const run = new JobRun()
    const reads = heldReads()
    renderCell('data', { inspect: () => pending(), readStage: reads.readStage }, { run })
    await answered()

    run.id = 'job-A'
    act(() => run.move(going(['gtfs2graph', 'topo'])))
    await answered()
    act(() => {
      for (const ask of reads.asks.filter((a) => a.made === 'run job-A')) ask.answer()
    })
    await answered()
    expect(pictured(), 'A’s latest stage').toContain('run job-A topo')

    act(() => {
      run.move({ ...snap('done'), layout: 'b'.repeat(64) })
      run.id = 'job-B'
      run.move(going([]))
    })
    await answered()
    expect(pictured(), 'nothing of A’s drawings in B’s pane').toBeNull()
  })
})
