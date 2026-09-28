import { useId, useRef, type JSX } from 'react'
import { useFocusHandback } from '../focusHandback'
import Icon from '../icons/Icon'
import Button from '../kit/Button'
import { EXPORT_NOTE, notebookSentence, runAllPlan, runAllRefusal } from '../runAll'
import { runGraph } from '../runGraph'
import { useProject } from './context'

// The project's own header, above the notebook (ADR-045, A5.5-22,
// DESIGN.md 8.2, "The project's header").
//
// Three things on it. The breadcrumb: the way back to the Library and the
// project's name, which is the screen's heading. One `role="status"` line
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
    onBack,
    engine,
    run,
    runSnapshot,
    exportSnapshot,
    layingOut,
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
  const refusal =
    project === null || plan === null
      ? null
      : runAllRefusal(plan, { readOnly: project.readOnly, running: layingOut, exporting })
  // Stop goes when the run ends, and Run all comes back - disabled, when
  // the run left nothing to do, which Chromium will not let hold focus. The
  // sentence saying why is where focus goes then: it is the answer to the
  // question the disabled button raises.
  //
  // Watched on the refusal as well as on the run's state, because the two
  // move a beat apart: the run says it is done before the record it wrote
  // has been read back, so Run all returns still enabled, takes the focus,
  // and is disabled only when the record lands - with no change of state
  // to hand focus on by then.
  useFocusHandback(
    region,
    () => (layingOut ? stopRef.current : refusal === null ? runAllRef.current : stateRef.current),
    `${runSnapshot.state}/${refusal === null}`,
  )
  const runAll = (): void => {
    if (project === null || plan === null || refusal !== null) return
    if (plan.kind === 'layout') run.start(project, engine)
    else if (plan.kind === 'rebuild') run.rebuild(project, engine, plan.date)
  }

  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <ol>
          <li>
            {/* "Library" on screen, "Back to Library" by name: the name
                holds what the eye reads (WCAG 2.5.3) and says what the
                press does, which a breadcrumb's bare word does not. */}
            <Button variant="ghost" aria-label="Back to Library" onClick={() => onBack()}>
              <Icon name="back" />
              Library
            </Button>
          </li>
          <li aria-current="page">
            <h1 id="project-heading" tabIndex={-1} ref={headingRef}>
              {project?.name ?? 'Project'}
            </h1>
          </li>
        </ol>
      </nav>
      {project !== null && states !== null && !project.readOnly && (
        <div className="project-run focus-region" ref={region}>
          <p className="project-run-state" role="status" tabIndex={-1} ref={stateRef}>
            {notebookSentence(project, states)}
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
                disabled={refusal !== null}
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
