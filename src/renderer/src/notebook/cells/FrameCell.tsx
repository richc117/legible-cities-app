import { useRef, type JSX } from 'react'
import type { ProjectRecord } from '../../../../shared/project'
import ServiceDay, { dayUndrawn } from '../../ServiceDay'
import Transport from '../../Transport'
import Cell from '../Cell'
import { frameFooter } from '../CellFooter'
import type { CellViewProps } from '../cells'
import { useProject } from '../context'

// Cell 03, Frame and service day: the day the map is drawn for (ADR-045).
//
// The day itself comes from the `<dl class="fields">` the project screen
// carried whole, and the control is `ServiceDay` (A3-04, A5.5-15) - drawn
// headless, since this cell's heading is the section's heading now, and
// that heading is where its focus handback lands. The heading and not the
// toggle inside it: a reflexive Enter after "Draw for this day" would
// otherwise collapse the cell a person is working in.
//
// The cell is named for the frame as well, and holds none of it. Crop,
// rotate, margin and a clip mask are engine work that the protocol cannot
// take, so none of them is drawn as a disabled control: a control with
// nowhere to send its value teaches a person a lie (ADR-045). One sentence
// says what the cell will gain instead.
//
// The cell holds two sections now (A5.5-16). Below the day is the
// transport - the scrub, Play day and the speed - which drives the engine's
// own page through the seam the app already has, and is therefore about the
// map on screen rather than about anything the project keeps: it writes no
// record, asks the engine nothing and marks no cell stale. It names itself,
// because one heading cannot name two sections (the rule cell 05 settled in
// A5.5-18); the day keeps the cell's own heading, being what the cell is
// called for, and keeps the focus handback with it.
//
// It is offered to a read-only project as well as a writable one, and that
// is deliberate: looking is not editing, and a project this build may not
// write still has a map worth watching.

/**
 * What the cell says on its collapsed row: the day the project is set to,
 * whether the map has been drawn for it, and the engine's own answer beside
 * it.
 *
 * **It does not say whose choice the day was, and must not** (issue 210).
 * That looks like `service.busiest === date`, and it is not: every layout
 * run asks `feeds.service` again with today as the anchor and writes the
 * fresh window while deliberately keeping the day (`engine/layoutRun.ts`,
 * `tests/unit/projects-store.test.ts` "replaces the window on a later run,
 * keeping the day"), so a project laid out a second time a week later holds
 * a day the **engine** chose beside a busiest weekday that has moved off
 * it - and the inference then told a person they had picked a day they
 * never saw. The claim was wrong in the other direction too: a person who
 * picks the busiest weekday themselves was credited to the engine.
 *
 * So the engine's own answer is drawn as itself and the day above it, and a
 * person who wants to know whose day it is reads the two. That is the fix
 * #163 made to the provenance strip, which `frameFacts` in `CellFooter.tsx`
 * now carries under the open cell - this is the same rule for the row a
 * collapsed cell shows instead.
 *
 * "Not drawn yet" is the cell's own business and not its state: the day is
 * cell 03's, so a day that has moved marks the cells *below* stale and
 * leaves this one ready (contracts/run-graph.md). Without the summary the
 * cell that holds the change would be the one cell saying nothing about it.
 * It sits against the day and not at the end, because it is the day that
 * has not been drawn and never the engine's answer.
 *
 * A `Pick` and not the whole record, so the sample page can build its row
 * from this function over the same fixture its footer is built from
 * (`CellPreview.tsx`) rather than from a copy of the sentence that drifts.
 */
export function frameSummary(
  project: Pick<ProjectRecord, 'date' | 'service' | 'drawn'> | null,
): string | null {
  if (project === null || project.date === null) return null
  const undrawn = dayUndrawn(project) ? ', not drawn yet' : ''
  if (project.service === null) return `${project.date}${undrawn}`
  return `${project.date}${undrawn}; the engine’s busiest weekday is ${project.service.busiest}`
}

export default function FrameCell({ cell, state, open, onToggle }: CellViewProps): JSX.Element {
  const { project, engine, run, setDate, exporting, layingOut, preview, drawn } = useProject()
  const heading = useRef<HTMLHeadingElement>(null)
  return (
    <Cell
      number={cell.number}
      name={cell.name}
      state={state}
      summary={frameSummary(project)}
      open={open}
      onToggle={onToggle}
      headingRef={heading}
      footer={frameFooter(project)}
    >
      {project !== null && (
        <>
          <dl className="fields">
            <dt>Service day</dt>
            <dd>{project.date ?? 'not yet chosen'}</dd>
          </dl>
          {project.readOnly ? (
            // A cell with nothing to offer says so in one sentence and
            // offers no disabled stand-in, as cells 04 and 05 do
            // (DESIGN.md 8.2).
            <p className="prose">
              This project was made by a newer version of the app, so its service day cannot be
              changed here.
            </p>
          ) : project.layout === null ? (
            <p className="prose">
              The service day is the engine&rsquo;s own choice, made at the first layout from the
              days the feed covers. Lay the project out, and it is here to change.
            </p>
          ) : (
            <ServiceDay
              run={run}
              project={project}
              engine={engine}
              onDate={setDate}
              disabled={exporting}
              handback={heading}
            />
          )}
          <p className="prose">
            How the map is cropped, turned, margined and masked belongs in this cell too, and none
            of it is drawn: the engine takes no such setting yet, so the cell holds the day alone
            until it can.
          </p>
          {/* The page's own transport (A5.5-16). Only where there is a page
              to drive: a project with no layout has no frame on the screen
              at all, so there is nothing for a scrub to be a scrub of. It
              draws itself once the page has said what day it has, and
              nothing before. */}
          {project.layout !== null && (
            <Transport
              projectId={project.id}
              redraw={drawn}
              open={open}
              laying={layingOut}
              exporting={exporting}
              previewing={preview !== null}
            />
          )}
        </>
      )}
    </Cell>
  )
}
