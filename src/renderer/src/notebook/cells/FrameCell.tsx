import { useRef, type JSX } from 'react'
import type { ProjectRecord } from '../../../../shared/project'
import ServiceDay, { dayUndrawn } from '../../ServiceDay'
import Transport from '../../Transport'
import Trip from '../../Trip'
import Cell from '../Cell'
import { frameFooter } from '../CellFooter'
import type { CellViewProps } from '../cells'
import { useProject } from '../context'
import { runRowStatus } from '../runRow'

// Cell 03, Frame and service day: the day the map is drawn for (ADR-045).
//
// The day itself is the footer strip's to say (`frameFooter`, A5.5-11), and
// nothing above the strip states it as a field again (issue 209, DESIGN.md
// 8.2): the field list the project screen carried whole is gone from this
// cell. The strip draws nothing until a layout run has answered a window:
// before a layout the sentence below says the day is the engine's to
// choose, and over a layout from before the window was kept `ServiceDay`
// says the day the map was drawn for. The control is `ServiceDay` (A3-04,
// A5.5-15) - drawn headless, since this cell's heading is the section's
// heading now, and that heading is where its focus handback lands. The
// heading and not the toggle inside it: a reflexive Enter after "Draw for
// this day" would otherwise collapse the cell a person is working in.
//
// The cell is named for the frame as well, and holds none of it. The frame's
// margin is a size and is set in cell 04 (issue 350); the frame is padded and
// never cropped or rotated (ADR-050); a clip mask waits on a designer's
// intent. So none of them is drawn here as a control, disabled or not: a
// control with nowhere to send its value teaches a person a lie (ADR-045).
// One sentence says where the margin is and what the frame will not do.
//
// The cell holds two sections now (A5.5-16). Below the day is the
// transport - the scrub, Play day and the speed - which drives the engine's
// own page through the seam the app already has, and is therefore about the
// map on screen rather than about anything the project keeps: it writes no
// record, asks the engine nothing and marks no cell stale. It names itself
// with an `h3` while the day is named by this cell's own heading and an
// `aria-label`: a panel takes one form or the other and never an `h2`, and
// which one is a judgement about the panel (lane 197's rule). The reasoning
// for each of the two is where the second one is drawn, in `Transport.tsx`.
//
// The third section is the trip (issue 272, spec 030, ADR-048): a start
// and an end station, the map faded around the trip between them, and the
// steps in words. It drives the page as the transport does and keeps
// nothing, and it names itself with an `h3` for the transport's reason: it
// is about the map on screen, which nothing above names.
//
// It is offered to a read-only project as well as a writable one, and that
// is deliberate: looking is not editing, and a project this build may not
// write still has a map worth watching. The trip too: viewing is not editing.

/**
 * What the cell says on its collapsed row: the day the project is set to,
 * and whether the map has been drawn for it. The engine's busiest weekday
 * was beside it until issue 279 cut the row to one fact; it is the open
 * cell's own button and a fact in its strip now.
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
 * So the row says the day and never whose it is, and the engine's own
 * answer is drawn as itself under the open cell, where a person who wants
 * to know whose day it is reads the two. That is the fix #163 made to the
 * provenance strip, which `frameFacts` in `CellFooter.tsx` carries.
 *
 * "Not drawn yet" is the cell's own business and not its state: the day is
 * cell 03's, so a day that has moved marks the cells *below* stale and
 * leaves this one ready (contracts/run-graph.md). Without the summary the
 * cell that holds the change would be the one cell saying nothing about it.
 * It sits against the day, because it is the day that has not been drawn
 * and never the engine's answer.
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
  // The busiest weekday is the open cell's button, not the row's sentence.
  return `${project.date}${undrawn}`
}

export default function FrameCell({ cell, state, open, onToggle }: CellViewProps): JSX.Element {
  const { project, engine, run, runSnapshot, setDate, exporting, layingOut, drawn } = useProject()
  const heading = useRef<HTMLHeadingElement>(null)
  // Whether there is a strip under this cell, asked of the builder that
  // draws it and not restated here: the two would otherwise have to be kept
  // in step, and the day below is said exactly where the strip is not.
  const hasStrip = frameFooter(project) !== undefined
  return (
    <Cell
      number={cell.number}
      name={cell.name}
      state={state}
      summary={frameSummary(project)}
      progress={runRowStatus(runSnapshot, cell.id)}
      open={open}
      onToggle={onToggle}
      headingRef={heading}
      footer={frameFooter(project)}
    >
      {project !== null && (
        <>
          {project.readOnly ? (
            <>
              {/* The day of a read-only project whose record holds a day
                  and no strip to say it (issue 209). The strip needs the
                  window as well as the day (`frameFacts`), `ServiceDay` is
                  not drawn in this branch, and the field that said the day
                  regardless is gone, so without this the open cell would
                  state the day nowhere and only the collapsed row would.
                  Where the strip draws nothing the cell says what there is
                  to say in a sentence (DESIGN.md 8.2), and this is that
                  sentence; with a strip it is not drawn, since the strip's
                  first row says the same.

                  No record this version writes can reach it. A day reaches
                  a record with its window, in the one write
                  `completeLayout` makes, and every later write of a day is
                  refused where there is no window (`serviceDayRefusal`).
                  So the only records with a day and no window are from
                  before the window was kept (A3-04), and those are this
                  version's own, which it may write: over their layout
                  `ServiceDay` says "Drawn for <day>.". But this branch is
                  for a record a later version wrote, and a window kept in
                  a shape `readServiceWindow` refuses whole is a plausible
                  thing for a later version to have done - which is the
                  record that lands here.

                  The record's day and not `drawnDate`, as the strip's row
                  is: what the project is set to. */}
              {!hasStrip && project.date !== null && (
                <p className="prose">The service day is {project.date}.</p>
              )}
              {/* A cell with nothing to offer says so in one sentence and
                  offers no disabled stand-in, as cells 04 and 05 do
                  (DESIGN.md 8.2). */}
              <p className="prose">
                This project was made by a newer version of the app, so its service day cannot be
                changed here.
              </p>
            </>
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
            The frame&rsquo;s margin is one of the sizes in cell 04; the frame is padded and never
            cropped or rotated, and a clip mask waits on a designer&rsquo;s intent, so this cell
            holds the day alone.
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
            />
          )}
          {/* The trip (issue 272), after the transport. Drawn whatever the
              page can do: before a layout it is one sentence and no
              control, and over a record that kept no stations it says the
              map has to be drawn again. Its stations are the ones the map
              on disk was drawn with, from the record's `drawn`. */}
          <Trip
            hasLayout={project.layout !== null}
            stations={project.drawn?.stations ?? null}
            laying={layingOut}
            exporting={exporting}
          />
        </>
      )}
    </Cell>
  )
}
