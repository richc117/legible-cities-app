import { useId, useRef, type JSX } from 'react'
import { useFocusHandback } from '../focusHandback'
import Icon from '../icons/Icon'
import Button from '../kit/Button'
import { EXPORT_NOTE, notebookSentence, runAllOffered, runAllPlan } from '../runAll'
import { cellOfRun, runGraph } from '../runGraph'
import { useProject } from './context'

// The project's own header, above the notebook (ADR-045, A5.5-22,
// DESIGN.md 8.2, "The project's header").
//
// Three things on it. The project's name, which is the screen's heading
// (the way back to the Library is in the window's header, issue 275). One
// `role="status"` line
// saying what the notebook is doing as a whole, no more than a sentence,
// because it is a polite live region and each change to it is read out.
// And Run all, which brings the map up to date with cells 01 to 05 using
// the runs those cells already have and never runs the export
// (`runAll.ts` says how and why); the sentence beside it says so.
//
// While the project's run goes, Run all gives way to Stop, which is the
// run's own cancel whichever cell started it, and focus on the one that
// went is handed to the one that came (A6-07), as cell 02's Cancel does.
// An export has its own Cancel in cell 06; here it only makes Run all
// unavailable.
//
// It is not the app's own header, which is the window's and knows no
// project (A1-03, ADR-036).

export default function ProjectHeader(): JSX.Element {
  const {
    project,
    error,
    headingRef,
    engine,
    run,
    runSnapshot,
    exportSnapshot,
    layingOut,
    settling,
    exporting,
  } = useProject()
  const noteId = useId()
  const region = useRef<HTMLDivElement>(null)
  const runAllRef = useRef<HTMLElement>(null)
  const stopRef = useRef<HTMLElement>(null)
  const stateRef = useRef<HTMLParagraphElement>(null)

  const states =
    project === null
      ? null
      : runGraph({ record: project, run: runSnapshot, exportRun: exportSnapshot })
  const plan = project === null ? null : runAllPlan(project, runSnapshot)
  const offered =
    project !== null &&
    plan !== null &&
    runAllOffered(plan, { readOnly: project.readOnly, running: layingOut, settling, exporting })

  // The sentence is held, not recomputed, in two beats. While a finished
  // run's record is read back it would be the record from before the run -
  // "Nothing has been laid out yet." between "running" and the truth - and
  // it is a live region, so that would be spoken. And while cell 05 redraws
  // itself: a colour or an order is a cheap edit that is never stale
  // (ADR-045), and a drag with pauses would otherwise have the header say
  // "running" and "drawn" once per redraw, beside the cell's own words.
  const held = useRef<string | null>(null)
  const holding =
    settling || (layingOut && cellOfRun(runSnapshot) === 'lines' && held.current !== null)
  const sentence =
    project === null || states === null
      ? null
      : holding && held.current !== null
        ? held.current
        : notebookSentence(project, states)
  if (!holding) held.current = sentence
  // Stop goes when the run ends, and Run all comes back - disabled, while
  // the record is read back or when the run left nothing to do, and
  // Chromium will not let a disabled button hold focus. The notebook's
  // sentence is where focus goes then: it says what the notebook now is.
  //
  // Watched on whether Run all is offered as well as on the run's state,
  // because the two move a beat apart: the run says it is done before the
  // record it wrote has been read back.
  useFocusHandback(
    region,
    () => (layingOut ? stopRef.current : offered ? runAllRef.current : stateRef.current),
    `${runSnapshot.state}/${offered}`,
  )
  const runAll = (): void => {
    if (project === null || plan === null || !offered) return
    if (plan.kind === 'layout') run.start(project, engine)
    else if (plan.kind === 'rebuild') run.rebuild(project, engine, plan.date)
  }

  return (
    <>
      <h1 id="project-heading" tabIndex={-1} ref={headingRef}>
        {project?.name ?? 'Project'}
      </h1>
      {project !== null && sentence !== null && !project.readOnly && (
        // The focus region wraps the row rather than sharing its element:
        // `.focus-region` is `display: contents`, and on one element the
        // row's flex would hold only by the order the stylesheets load in.
        <div className="focus-region" ref={region}>
          <div className="project-run">
            <p className="project-run-state" role="status" tabIndex={-1} ref={stateRef}>
              {sentence}
            </p>
            <div className="toolbar">
              {layingOut ? (
                <Button ref={stopRef} onClick={() => run.cancel()}>
                  <Icon name="close" />
                  Stop
                </Button>
              ) : (
                <Button
                  ref={runAllRef}
                  variant="primary"
                  disabled={!offered}
                  aria-describedby={noteId}
                  onClick={runAll}
                >
                  <Icon name="map" />
                  Run all
                </Button>
              )}
              <p id={noteId} className="project-run-note">
                {EXPORT_NOTE}
              </p>
            </div>
          </div>
        </div>
      )}
      {error !== null && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {project?.readOnly === true && (
        <p role="status">
          This project was made by a newer version of the app and is read-only here. It can still be
          deleted.
        </p>
      )}
    </>
  )
}
