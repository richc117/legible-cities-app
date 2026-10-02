import { cellOfRun, type CellId, type RunFacts } from '../runGraph'
import type { RunSnapshot } from '../engine/layoutRun'
import { inWords } from '../stages'

// What a cell's collapsed row says while the run it owns is going, or once
// it has failed (ADR-046, specs/029 FR-017).
//
// A running cell does not open itself, move focus or scroll the page: with
// the map in the column after cell 02, a cell that opened as a run started
// would push the map down under the person looking at it. So the row says
// what the run is doing instead - the stage and its place among the stages,
// in the words the progress line and the jobs inspector use for them
// ("running collapse, 2 of 8") - and a failure says where it stopped
// ("failed at octilinear, 4 of 8") without opening the cell either. The
// header's status line says the same of the notebook as a whole
// (`notebookSentence` in `runAll.ts`).
//
// Pure, and in a file of its own, so the words are held to a unit test.

/** The row's words for `cell` while `run` is its run and is going or has failed; else null. */
export function runRowStatus(
  run: RunFacts & Pick<RunSnapshot, 'stages'>,
  cell: CellId,
): string | null {
  if (run.state !== 'running' && run.state !== 'failed') return null
  if (cellOfRun(run) !== cell) return null
  // Only a layout run has stages of its own to name. A rebuild or a redraw
  // is a single step, and the run's stage list is still the last layout's:
  // a rebuild that fails after a layout that failed would otherwise say
  // "failed at octilinear" on the day's row.
  const stages = cell === 'process' ? inWords(run.stages) : []
  if (run.state === 'running') {
    const at = stages.findIndex((s) => s.state === 'running')
    return at === -1 ? 'running' : `running ${stages[at].label}, ${at + 1} of ${stages.length}`
  }
  const at = stages.findIndex((s) => s.state === 'failed')
  return at === -1 ? 'failed' : `failed at ${stages[at].label}, ${at + 1} of ${stages.length}`
}
