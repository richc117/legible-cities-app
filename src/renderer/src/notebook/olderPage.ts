import type { EngineState } from '../../../shared/engine'
import type { PageSeam } from '../../../shared/protocol'
import { screenPaths } from '../../../shared/jobs'
import { drawnDate, serviceDayRefusal } from '../../../shared/project/helpers'
import { type ProjectRecord } from '../../../shared/project/types'
import { isEngineVersion } from '../../../shared/project/validate'
import { engineBefore } from '../record'
import type { LayoutRun, RunSnapshot } from '../engine/layoutRun'
import type { RunAllPlan } from '../runAll'
import { cellOfRun, type RunFacts } from '../runGraph'

// A project whose stored page an older engine drew is redrawn when it opens
// (issue 465, decided 24 Oct 2026): a `map.build` from the stored layout,
// never a re-layout (ADR-023), with the record's own colours, order, style
// and line options, for the day the map already shows. A page is older where
// the record says an engine below the running one drew it (`drawn.engine`,
// issue 494, compared by `engineBefore`), where its `drawn` names no engine at
// all, or where it lacks a seam the pinned engine's page has (`isOlderPage` in
// `src/shared/viewer.ts`); whether to redraw one, and when, is this file's,
// with no React in it so the rule is a table in a unit test
// (.claude/rules/renderer.md).
//
// A `drawn` that names no engine counts as older (decided by the maintainer,
// 25 Oct 2026): every record drawn before issue 494 is one, and among them
// are pages that have every seam (each arrived by the version
// `PAGE_SEAM_SINCE` names) and draw what the engine has since changed (engine
// issue 76's label face). So
// every such project is redrawn once, the first time it opens after the
// update, and its redraw's write then names the running engine. A value the
// record's reader would not take (`isEngineVersion`) is dropped as it is
// read, so by the time it reaches here it is the same as none, and is judged
// the same: there is no way to tell the two apart after `readDrawn`, and a
// value no engine of ours would write is no better evidence of a current
// page than none. A running version this build does not read says nothing,
// and the seam decides.
//
// The version is measured against the running engine's, from its handshake
// (`EngineState`'s ready `version`), since that is the engine a redraw would
// ask; the supervisor holds it equal to the pin's. A page older by version
// alone has every seam, so where its redraw fails cell 03 says neither the
// theme's nor the trip's sentence (`pageLacks`): it takes both in place.
//
// The redraw is the rebuild cell 03 already makes for a day, asked for the
// day the record holds and the map already shows, so it is drawn and shown
// as that rebuild always is - cell 03 running, then cell 02's "Drawn for
// <day> from the stored layout", or cell 03's own failure where it fails -
// and its write is the rebuild's own, which moves the day to the day it
// already was. Nothing new is written.
//
// Where the redraw fails, cell 03 says so (issue 517, decided 25 Oct 2026).
// The person pressed nothing, so the words a rebuild they asked for gets do
// not fit: cell 03 says the map was drawn by an older engine and could not be
// redrawn as the project opened, the engine's reason, and what still holds of
// the map on screen - built from the seams that page lacks, since a page
// lacking only the opening's two can take a theme and a trip like any other
// (`frameFailure`, `frameFailureWords`), and cell 02's run panel points at
// cell 03 rather than saying a day was not drawn (`processStoppedSentence`).
// Every other failed rebuild of cell 03's own - a Run all after it, a
// person's "Draw for this day", the same failure seen again after the screen
// was left - gets one plain sentence and its reason, in cell 03 too.
//
// Which failure is the opening's is derived, as a cell's state is: the
// screen knows which job its redraw started (`redrawPageOnOpen` answers it),
// and the run says which job its latest attempt is.
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
  /**
   * The running engine's version, as its handshake answered it (the ready
   * `EngineState`'s `version`); null while it is not ready. What the
   * record's `drawn.engine` is compared with (issue 494).
   */
  running: string | null
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
  const { older, running, project, engineReady, busy, drawnHere } = facts
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
  // Older by its seam, or by the engine the record says drew it (issue 494),
  // a record naming none being older (see the top of this file). Where
  // neither says so the page is current - except that the version cannot
  // speak until the engine has answered its handshake, so the page waits for
  // that rather than being judged by its seam alone, which would settle it
  // for this screen.
  const byVersion = !isEngineVersion(running)
    ? null
    : isEngineVersion(drawn.engine)
      ? engineBefore(drawn.engine, running)
      : true
  if (older !== true && byVersion !== true) return running === null ? WAIT : NEVER
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
  facts: Pick<OnOpenFacts, 'older' | 'running' | 'drawnHere'>,
  readOnly: boolean,
): (record: ProjectRecord) => RunAllPlan {
  return (record) => {
    const now = redrawOnOpen({
      older: facts.older,
      running: facts.running,
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
 * Answers the id of the job the press opened, which is how cell 03 later
 * knows a failure is the opening's (`frameFailure`); null where the press
 * opened no job of its own, as Run all does not while a run is going. A
 * press that withdraws once the record is read (`openPlanOf` answering
 * nothing) puts the run's attempt back as it was, after this has answered:
 * the id answered is then one the run never reports again, and since a job's
 * id is never reused it can match no failure later. That is read here only
 * as far as it can be at the press; the withdrawal comes after the read, so
 * it is `frameFailure`'s comparison with the run's latest job, made at every
 * render, that decides.
 */
export function redrawPageOnOpen(
  run: Pick<LayoutRun, 'runAll' | 'job'>,
  project: ProjectRecord & { readOnly: boolean },
  engine: EngineState | null,
  facts: Pick<OnOpenFacts, 'older' | 'running' | 'drawnHere'>,
): string | null {
  const before = run.job()?.id ?? null
  run.runAll(project, engine, openPlanOf(facts, project.readOnly))
  const after = run.job()?.id ?? null
  return after === before ? null : after
}

/**
 * Which of the seams a person reaches through cell 03 and cell 04 a page
 * lacks: a page drawn before the version each arrived at
 * (`PAGE_SEAM_SINCE.setTheme`, `PAGE_SEAM_SINCE.setTrip`).
 */
export interface PageLacks {
  /** No `setTheme`: a theme reaches it only by loading it again. */
  theme: boolean
  /** No `setTrip`: it cannot show a trip. */
  trip: boolean
}

/** The two by name, which must be the seam's (`PageSeam`) or the build fails. */
const THEME_SEAM = 'setTheme' satisfies keyof PageSeam
const TRIP_SEAM = 'setTrip' satisfies keyof PageSeam

/** What a page's seam lacks of the two, from the names it answered; nothing where it did not say. */
export function pageLacks(seams: readonly string[] | null): PageLacks {
  if (seams === null) return { theme: false, trip: false }
  return { theme: !seams.includes(THEME_SEAM), trip: !seams.includes(TRIP_SEAM) }
}

/**
 * A failed rebuild of cell 03's own, as cell 03 says it: the opening's
 * redraw, with what the page it opened on lacks, or any other, with the day
 * it was for. The reason is the engine's hint with its paths taken out, as
 * the jobs inspector shows it.
 */
export type FrameFailure =
  | { kind: 'opening'; reason: string | null; lacks: PageLacks }
  | { kind: 'rebuild'; reason: string | null; day: string | null }

/** What `frameFailure` reads: the job the opening started, the run as it stands, the page's seam. */
export interface FrameFailureFacts {
  /** The job the screen's redraw on open started (`redrawPageOnOpen`); null where it started none. */
  asked: string | null
  /** The id of the run's latest attempt (`LayoutRun.job()`); null where it has none. */
  job: string | null
  run: RunFacts & Pick<RunSnapshot, 'error' | 'unkept' | 'day'>
  /** The seam the first page the screen loaded answered; null where it did not say. */
  seams: readonly string[] | null
}

/**
 * What cell 03 says about a failed run of its own, or null while there is
 * none: the run failed, and as cell 03's (a rebuild - Run all can make a
 * layout of a press, under the same job, where the record it read has no
 * layout, and that failure is cell 02's).
 *
 * Nothing, too, where the map was drawn and the record then refused to keep
 * it (`unkept`, issue 399): that map *was* drawn, so neither "could not be
 * redrawn" nor "did not finish" is true, and cell 02's own sentence for it
 * is the one that is.
 *
 * It is the opening's only while the run's latest attempt is the job the
 * opening started. Derived each time, never stored as a flag, so a later Run
 * all, a person's own rebuild and the same failure met again after the
 * screen was left all take the plain words.
 */
export function frameFailure(facts: FrameFailureFacts): FrameFailure | null {
  const { asked, job, run, seams } = facts
  if (run.state !== 'failed') return null
  if (cellOfRun(run) !== 'frame') return null
  if (run.unkept) return null
  const reason = screenPaths(run.error)
  if (asked !== null && job === asked) return { kind: 'opening', reason, lacks: pageLacks(seams) }
  return { kind: 'rebuild', reason, day: run.day }
}

/**
 * What cell 03 says first where the redraw a project's opening asked for
 * failed (issue 517), before the engine's reason. A person pressed nothing,
 * so it says what was tried and why, not that a day they chose was not drawn.
 */
export const OPENING_REDRAW_FAILED =
  'This map was drawn by an older version of the engine and could not be redrawn as the project opened.'

/**
 * What it says after the reason, always. The map on screen and not the map:
 * a run that stopped at its deadline cannot know what the engine left on disk.
 */
export const ON_SCREEN_AS_IT_WAS = 'The map on screen stays as it was.'

/** Said after it for a page with no `setTheme`, which a theme reaches only by loading it again. */
export const THEME_BY_RELOAD =
  'It cannot change its theme where it stands, so choosing a theme loads the map again in that theme.'

/**
 * Said after it for a page with no `setTrip`: the condition, not a remedy.
 * What would draw the map again depends on the engine's reason - after "no
 * stored layout" only a layout does, and Run all would fail the same way - so
 * the reason before it is what a person acts on.
 */
export const NO_TRIP_ON_IT = 'It cannot show a trip until the map is drawn again.'

/** What still holds of the map on screen, for the seams the page lacks and no others. */
export function openingFallback(lacks: PageLacks): string {
  return [
    ON_SCREEN_AS_IT_WAS,
    ...(lacks.theme ? [THEME_BY_RELOAD] : []),
    ...(lacks.trip ? [NO_TRIP_ON_IT] : []),
  ].join(' ')
}

/** What cell 03 says first of any other failed rebuild of its own. */
export const rebuildFailed = (day: string | null): string =>
  day === null ? 'The rebuild did not finish.' : `The rebuild for ${day} did not finish.`

/**
 * The engine's hint as cell 03 says it: its words exactly as the jobs
 * inspector shows them, first character included - a hint that starts with a
 * feed's key starts with it as the engine spells it - and only a closing full
 * stop the app's, where the hint has none, so it ends as the sentences around
 * it do.
 */
export function engineReason(reason: string | null): string {
  const said = (reason ?? '').trim()
  if (said === '') return ''
  return /[.!?]$/.test(said) ? said : `${said}.`
}

/** The words cell 03 draws for a failure: the error, and what still holds where there is that to say. */
export function frameFailureWords(failure: FrameFailure): {
  error: string
  reason: string
  fallback: string | null
} {
  const reason = engineReason(failure.reason)
  return failure.kind === 'opening'
    ? { error: OPENING_REDRAW_FAILED, reason, fallback: openingFallback(failure.lacks) }
    : { error: rebuildFailed(failure.day), reason, fallback: null }
}

/**
 * What cell 02's run panel says once a run stopped (`LayoutRun.tsx`): its own
 * sentence, except for the opening's failed redraw, whose "The map was not
 * drawn for that day" was written for a day a person asked to draw. That one
 * points at cell 03, where its why is.
 */
export const OPENING_REDRAW_STOPPED =
  'The map was not redrawn as the project opened; cell 03 says why.'

export function processStoppedSentence(failure: FrameFailure | null, ordinary: string): string {
  return failure?.kind === 'opening' ? OPENING_REDRAW_STOPPED : ordinary
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
