import type { EngineState } from '../../../shared/engine'
import { screenPaths } from '../../../shared/jobs'
import { drawnDate, serviceDayRefusal, type ProjectRecord } from '../../../shared/project'
import type { LayoutRun, RunSnapshot } from '../engine/layoutRun'
import type { RunAllPlan } from '../runAll'
import { cellOfRun, type RunFacts } from '../runGraph'

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
// already was. Nothing new is written.
//
// One sentence is new, and it is cell 03's (issue 517, decided 25 Oct 2026):
// where the redraw fails, the person pressed nothing, so the words a rebuild
// they asked for would get ("The map was not drawn for that day") do not fit.
// Cell 03 says instead that the map was drawn by an older engine and could
// not be redrawn as the project opened, the engine's reason, and what still
// holds: the map as it stands, a theme by its address, no trip
// (`openingRedrawFailure`, `OPENING_REDRAW_FAILED`). Which failure is the
// opening's is derived, as a cell's state is: the screen knows which job its
// redraw started (`redrawPageOnOpen` answers it), and the run says which job
// its latest attempt is. A later press of Run all is a job of its own, and
// gets the rebuild's ordinary words.
//
// It is started through Run all's machinery and not by a press on cell 03's
// rebuild (`redrawPageOnOpen`), because the day it draws has to be decided
// from the record the store holds after the press (issue 407, spec 037). A
// start flushes cell 03's held day first, so its write is sent before the
// run's read; a rebuild started for the day the screen held would read the
// record with the new day and then draw the old one and write it back over
// the one just chosen. Run all reads the store, makes the plan again from the
// record it read (`openPlanOf`), and where that plan is nothing - the day is
// now one a person chose and has not drawn - withdraws: no job ends, and
// nothing is drawn or written. It is not unseen, though. For the round trip
// of its read, the run reads running as cell 03's rebuild,
// its job is listed and cell 03's controls are out of reach; and the person
// has just picked a day, so focus is in one of them. Focus is therefore handed
// to the cell's heading before the redraw is asked for (`keepFocusInCell`),
// as cell 03's own rebuild hands it.
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
 * one the store answers its read with after the press - so the day is
 * the record's as it then stands. A rebuild for that day where the rule
 * still answers a redraw, and nothing otherwise, which Run all withdraws: no
 * job ends, and nothing is drawn or written. The engine and the page
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
 * decided from the record the store holds after the press (see the top of
 * this file). Where that record still answers a redraw it is cell 03's
 * rebuild for that day, going from this turn, with its job, its progress line
 * and its sentences.
 *
 * Answers the id of the job it started, which is how cell 03 later knows a
 * failure is the opening's (`openingRedrawFailure`); null where the press
 * started no job of its own, as Run all does not while a run is going.
 */
export function redrawPageOnOpen(
  run: Pick<LayoutRun, 'runAll' | 'job'>,
  project: ProjectRecord & { readOnly: boolean },
  engine: EngineState | null,
  facts: Pick<OnOpenFacts, 'older' | 'drawnHere'>,
): string | null {
  const before = run.job()?.id ?? null
  run.runAll(project, engine, openPlanOf(facts, project.readOnly))
  const after = run.job()?.id ?? null
  return after === before ? null : after
}

/**
 * What cell 03 says first where the redraw a project's opening asked for
 * failed (issue 517), before the engine's reason. A person pressed nothing,
 * so it says what was tried and why, not that a day they chose was not drawn.
 */
export const OPENING_REDRAW_FAILED =
  'This map was drawn by an older version of the engine and could not be redrawn as the project opened.'

/**
 * What it says after the reason: what still holds. The map is the page as it
 * stands, so a theme reaches it by loading it again at an address carrying
 * the theme, and a trip is refused with the old page's sentence (`OLD_PAGE`
 * in `tripWords.ts`). Both are the fallback issue 465 kept, unchanged.
 */
export const OPENING_REDRAW_FALLBACK =
  'The map stays as it was: a theme chosen for it loads the map again in that theme, and a trip cannot be shown on it.'

/** The error's first paragraph: what was tried, then the engine's reason where there is one. */
export const openingRedrawFailedSentence = (reason: string | null): string =>
  reason === null || reason === '' ? OPENING_REDRAW_FAILED : `${OPENING_REDRAW_FAILED} ${reason}`

/** What `openingRedrawFailure` reads: the job the opening started, and the run as it stands. */
export interface OpeningFailureFacts {
  /** The job the screen's redraw on open started (`redrawPageOnOpen`); null where it started none. */
  asked: string | null
  /** The id of the run's latest attempt (`LayoutRun.job()`); null where it has none. */
  job: string | null
  run: RunFacts & Pick<RunSnapshot, 'error' | 'unkept'>
}

/**
 * Whether cell 03 says the redraw on open failed, and with what reason (the
 * engine's hint, its paths taken out, as the jobs inspector shows it); null
 * where it says nothing of the kind.
 *
 * Derived each time from the run, never stored as a flag: it is the opening's
 * failure only while the run's latest attempt is the job the opening started,
 * that attempt failed, and it failed as cell 03's (a rebuild - Run all can
 * make a layout of a press, under the same job, where the record it read has
 * no layout). A failed rebuild whose map was drawn and whose record then
 * refused to keep it (`unkept`, issue 399) is not one: the map *was* redrawn,
 * and cell 02 says what happened in its own words.
 */
export function openingRedrawFailure(facts: OpeningFailureFacts): { reason: string | null } | null {
  const { asked, job, run } = facts
  if (asked === null || job !== asked) return null
  if (run.state !== 'failed') return null
  if (cellOfRun(run) !== 'frame') return null
  if (run.unkept) return null
  return { reason: screenPaths(run.error) }
}

/** What `keepFocusInCell` reads of the focused element: where it sits. */
export type FocusedElement = Pick<Element, 'closest'>

/** What it hands focus to: a cell's heading. */
export type CellHeading = Pick<HTMLElement, 'focus'>

/**
 * Hand focus to the heading of the cell it is in, when it is in one, before
 * the redraw is asked for: a run disables the controls of the cell it belongs
 * to and Chromium blurs a disabled element, which would leave focus on the
 * body - and the redraw can start while a person is in a control, since the
 * day they have just picked is what makes it wait (A6-07). It is the handback
 * cell 03's own rebuild makes (`ServiceDay.tsx`), made for whichever cell
 * holds focus, since a redraw that waits reads running in cell 03 and one that
 * goes holds the page every cell drives. Focus on the heading already, or
 * anywhere outside a cell, is left where it is. Answers whether it moved focus.
 */
export function keepFocusInCell(active: FocusedElement | null): boolean {
  if (active === null) return false
  const cell = active.closest('.cell')
  if (cell === null) return false
  const heading = cell.querySelector<HTMLElement>('.disclosure-heading')
  if (heading === null || heading === active) return false
  ;(heading as CellHeading).focus({ preventScroll: true })
  return true
}
