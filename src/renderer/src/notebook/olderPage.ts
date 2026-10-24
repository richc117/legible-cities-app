import type { EngineState } from '../../../shared/engine'
import { drawnDate, serviceDayRefusal, type ProjectRecord } from '../../../shared/project'
import type { LayoutRun } from '../engine/layoutRun'
import type { RunAllPlan } from '../runAll'

// A project whose stored page an older engine drew is redrawn when it opens
// (issue 465, decided 24 Oct 2026): a `map.build` from the stored layout,
// never a re-layout (ADR-023), with the record's own colours, order, style
// and line options, for the day the map already shows. Which pages are older
// is the page's own seam's to say (`isOlderPage` in `src/shared/viewer.ts`);
// whether to redraw one, and when, is this file's, with no React in it so the
// rule is a table in a unit test (.claude/rules/renderer.md).
//
// The redraw is the rebuild cell 03 already makes for a day, asked for the
// day the record holds and the map already shows, so it is drawn and shown
// as that rebuild always is - cell 03 running, then cell 02's "Drawn for
// <day> from the stored layout", or cell 03's own failure where it fails -
// and its write is the rebuild's own, which moves the day to the day it
// already was. Nothing new is written and no new sentence is said.
//
// It is started through Run all's machinery and not by a press on cell 03's
// rebuild (`redrawPageOnOpen`), because the day it draws has to be decided
// from the record as the writes on their way leave it (issue 407). A start
// flushes cell 03's held day first; a rebuild started for the day the screen
// held would wait for that write and then draw the old day and write it back
// over the one just chosen. Run all waits, makes the plan again from the
// record the writes left (`openPlanOf`), and where that plan is nothing - the
// day is now one a person chose and has not drawn - withdraws without a
// trace.
//
// What it never does is draw anything the map did not already show but the
// engine it was drawn by. So no redraw where the record's day is one a person
// chose and has not drawn (that rebuild is a press of theirs, and a redraw
// for the old day would write the old day back over their choice), where the
// record names a layout the map was not drawn from, where the store would
// refuse the day, or where the record is not this build's to write. Each of
// those is today's behaviour: the page as it stands, a theme taken through
// its address and a trip refused with the old page's sentence.

/** What the screen knows as it decides. */
export interface OnOpenFacts {
  /**
   * What the first page the screen loaded said about its seam: true for a
   * page an older engine drew, false for a current one, null where it did not
   * say (`isOlderPage`).
   */
  older: boolean | null
  project: Pick<ProjectRecord, 'layout' | 'made' | 'date' | 'drawn' | 'service'> & {
    readOnly: boolean
  }
  /** The engine is running and answered its handshake. */
  engineReady: boolean
  /** A layout run or a rebuild, or an export, is going, or a finished run's record is being read back. */
  busy: boolean
  /** How many runs have drawn the page while this screen has been open. */
  drawnHere: number
}

/**
 * What to do about the page the screen opened on: redraw it for this day,
 * wait (the engine is not ready, or the page is held by something else), or
 * nothing, ever, for this screen.
 */
export type OnOpen = { kind: 'redraw'; date: string } | { kind: 'wait' } | { kind: 'never' }

const NEVER: OnOpen = { kind: 'never' }
const WAIT: OnOpen = { kind: 'wait' }

export function redrawOnOpen(facts: OnOpenFacts): OnOpen {
  const { older, project, engineReady, busy, drawnHere } = facts
  if (older !== true) return NEVER
  // A run has drawn the page since the screen opened: the page on screen is
  // the pinned engine's now, whatever the first one was.
  if (drawnHere > 0) return NEVER
  if (project.readOnly) return NEVER
  const { layout, date, drawn } = project
  if (layout === null || date === null) return NEVER
  // A day chosen and not drawn yet: cell 03 says so, and drawing it is a
  // press of the person's. Redrawing the day the map shows would write that
  // day back over the one they chose.
  if (drawnDate(project) !== date) return NEVER
  // A record from before `drawn` existed cannot say what the map was drawn
  // from, so a draw cannot be shown to draw the same map: it keeps today's
  // behaviour, the theme by its address and the trip's sentence.
  if (drawn === null) return NEVER
  // The record names a layout the map was not drawn from, or the same layout
  // made again since: a draw would move the map to it, and cell 02 says so.
  if (drawn.layout !== layout || drawn.made !== project.made) return NEVER
  // A day the store would refuse to write: the map would be drawn, and the
  // record would not keep it.
  if (serviceDayRefusal(project, date) !== null) return NEVER
  if (!engineReady || busy) return WAIT
  return { kind: 'redraw', date }
}

/**
 * The plan Run all's machinery is handed for the redraw (`LayoutRun.runAll`):
 * made from whichever record it reads - the screen's at the start, and the
 * one the writes on their way leave once they have landed - so the day is
 * the record's as it then stands. A rebuild for that day where the rule
 * still answers a redraw, and nothing otherwise, which Run all withdraws
 * without a job ending or a cell saying anything. The engine and the page
 * were judged ready when the redraw was asked for, and Run all refuses a
 * start itself where they are not.
 */
export function openPlanOf(
  facts: Pick<OnOpenFacts, 'older' | 'drawnHere'>,
  readOnly: boolean,
): (record: ProjectRecord) => RunAllPlan {
  return (record) => {
    const now = redrawOnOpen({
      older: facts.older,
      project: { ...record, readOnly },
      engineReady: true,
      busy: false,
      drawnHere: facts.drawnHere,
    })
    return now.kind === 'redraw' ? { kind: 'rebuild', date: now.date } : { kind: 'none' }
  }
}

/**
 * Start the redraw of the page a project opened on, once `redrawOnOpen` has
 * answered a redraw for the screen's record: through Run all, so the day is
 * decided after the writes on their way have landed (see the top of this
 * file). With nothing on its way it is cell 03's rebuild for that day, started
 * in this turn, with its job, its progress line and its sentences.
 */
export function redrawPageOnOpen(
  run: Pick<LayoutRun, 'runAll'>,
  project: ProjectRecord & { readOnly: boolean },
  engine: EngineState | null,
  facts: Pick<OnOpenFacts, 'older' | 'drawnHere'>,
): void {
  run.runAll(project, engine, openPlanOf(facts, project.readOnly))
}
