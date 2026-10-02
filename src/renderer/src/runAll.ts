import type { ProjectRecord } from '../../shared/project'
import {
  CELL_LIST,
  cellOfRun,
  stalenessOf,
  type CellId,
  type CellStatus,
  type RunFacts,
} from './runGraph'

// Run all, and the one sentence the project's header says about the whole
// notebook (A5.5-22, ADR-045, DESIGN.md 8.2, "The project's header").
//
// Run all brings the map up to date with cells 01 to 05, and it does that
// with the two runs the notebook already has rather than a sequence of its
// own. A layout run is "lay out, then draw the day" already: `start` asks
// `graph.build`, then `feeds.service`, then draws `project.date` from the
// layout it was just answered - so where cell 01 or 02 is behind, one
// layout run is the whole of Run all, and it stops at its own first failure
// with that failure on cell 02, exactly as a press of "Lay out" does.
// Where only the day is behind, the rebuild cell 03 already offers is.
// Either way nothing runs that a person could not have started by hand, so
// the jobs inspector, Stop, the handbacks and the stopped sentences are the
// ones those runs already have.
//
// **It never runs cell 06.** An export writes a named file to a person's
// disk and can take minutes; a button that promises "everything" must not
// do that as a side effect, and the header says so beside it.
//
// Pure, as the run graph is: a table of records in a unit test.

/** What a press of Run all would start, or that nothing needs to. */
export type RunAllPlan =
  /** A layout run, unforced: cell 01 or 02 is behind, or nothing is laid out. */
  | { kind: 'layout' }
  /** A rebuild for the record's day from the stored layout: only the map is behind. */
  | { kind: 'rebuild'; date: string }
  /** The map is drawn from everything above the export. */
  | { kind: 'none' }

/**
 * What Run all does for this record and this run. The run is read for two
 * things the record cannot hold: a failure, which leaves a cell in error
 * until something runs it again, and a re-layout stopped after it had
 * replaced the stored set (`replaced`, A3-05).
 *
 * Never a re-layout. "Re-layout" is behind a warning because it lays out
 * inputs that already have a layout and may move every station (ADR-033);
 * Run all lays out only what has no current layout, which the engine names
 * by its inputs and answers from what it has.
 */
export function runAllPlan(record: ProjectRecord, run: RunFacts | null): RunAllPlan {
  if (record.layout === null) return { kind: 'layout' }
  const failed = run !== null && run.state === 'failed' ? cellOfRun(run) : null
  const sources = stalenessOf(record, run)
  // A run that failed at its feed's download (cell 01, issue 178) laid
  // nothing out, so Run all lays out, as it does after a layout that failed.
  if (
    failed === 'data' ||
    failed === 'process' ||
    sources.some((s) => s.cell === 'data' || s.cell === 'process')
  )
    return { kind: 'layout' }
  // A failed rebuild, recolour or reorder may have left the page half
  // written ("the map on screen may be the old one until the next build"),
  // and a day chosen and not drawn is behind by definition. The rebuild
  // draws the record's day, colours and order, which is all of 03 to 05.
  const behind = failed === 'frame' || failed === 'lines' || sources.some((s) => s.cell === 'frame')
  if (behind && record.date !== null) return { kind: 'rebuild', date: record.date }
  return { kind: 'none' }
}

/**
 * Whether Run all can be pressed. Not while anything runs, nor while the
 * record a finished run wrote is still being read back (`settling`), when
 * the plan would be made from the record as it was before the run and a
 * second press would start the same run again.
 */
export function runAllOffered(
  plan: RunAllPlan,
  busy: { readOnly: boolean; running: boolean; settling: boolean; exporting: boolean },
): boolean {
  if (busy.readOnly || busy.running || busy.settling || busy.exporting) return false
  return plan.kind !== 'none'
}

/**
 * What the header says, assertively, when a cell has failed: the same words
 * as the sentence above, or null while nothing has. It is the text of an
 * alert region of its own, because the sentence's line is a polite status
 * and a failure is the one thing a person must not miss (FR-017).
 */
export function failureSentence(states: Record<CellId, CellStatus>): string | null {
  const failed = CELL_LIST.find((cell) => states[cell.id].state === 'error')
  if (failed === undefined) return null
  return `${String(failed.number).padStart(2, '0')} ${failed.name} failed.`
}

/**
 * The header's one sentence about the notebook as a whole: which cell is
 * running, which failed, or how many are not drawn yet. One sentence and
 * never more, because it is a polite live region and every change to it is
 * read out; the cells say the particulars.
 */
export function notebookSentence(
  record: Pick<ProjectRecord, 'layout' | 'drawn'>,
  states: Record<CellId, CellStatus>,
): string {
  // Written as the rail and the cell rows write it (`cellLabel` in
  // `notebook/Cell.tsx`), which this pure module does not import: that file
  // brings the kit with it.
  const named = (id: CellId): string => {
    const cell = CELL_LIST.find((c) => c.id === id) as (typeof CELL_LIST)[number]
    return `${String(cell.number).padStart(2, '0')} ${cell.name}`
  }
  const inState = (state: CellStatus['state']): CellId[] =>
    CELL_LIST.filter((cell) => states[cell.id].state === state).map((cell) => cell.id)

  const running = inState('running')
  if (running.length > 0) return `${named(running[0])} is running.`
  const failed = failureSentence(states)
  if (failed !== null) return failed
  if (record.layout === null) return 'Nothing has been laid out yet.'
  const stale = inState('stale')
  // A record from before `drawn` existed reads ready, which is "we cannot
  // prove this map is current" and not a proof that it is (run-graph
  // contract), so it is not told its map is drawn from every cell.
  if (stale.length === 0)
    return record.drawn === null ? 'Every cell is ready.' : 'The map is drawn from every cell.'
  if (stale.length === 1) return `${named(stale[0])} is not drawn yet.`
  // Always a range, down to 06: a source marks every cell below it, and
  // the only cells that break the run are a running or a failed one, which
  // this sentence has already named above.
  return `${named(stale[0])} to ${named(stale[stale.length - 1])} are not drawn yet.`
}
