import { useRef, type JSX } from 'react'
import type { ProjectRecord } from '../../../../shared/project'
import ServiceDay, { dayUndrawn } from '../../ServiceDay'
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
// The slot below is where the page's own transport - the scrub, Play day
// and the speed, already on the engine page's seam - arrives as one new
// file (A5.5-16), so that branch never rewrites this one.

/**
 * What the cell says on its collapsed row: the day the project is set to,
 * whose choice it was, and whether the map has been drawn for it.
 *
 * Whose choice it was is read from the window rather than recorded: the
 * engine's own answer at the first layout is the busiest weekday (ADR-031),
 * so a day that is not it is one a person picked. A person who picks the
 * busiest weekday themselves is credited to the engine, which is a
 * difference the record does not hold and nothing here turns on.
 *
 * "Not drawn yet" is the cell's own business and not its state: the day is
 * cell 03's, so a day that has moved marks the cells *below* stale and
 * leaves this one ready (contracts/run-graph.md). Without the summary the
 * cell that holds the change would be the one cell saying nothing about it.
 */
export function frameSummary(project: ProjectRecord | null): string | null {
  if (project === null || project.date === null) return null
  const undrawn = dayUndrawn(project) ? ', not drawn yet' : ''
  if (project.service === null) return `${project.date}${undrawn}`
  const whose =
    project.service.busiest === project.date ? 'the busiest weekday' : 'the day you chose'
  return `${project.date}, ${whose}${undrawn}`
}

export default function FrameCell({ cell, state, open, onToggle }: CellViewProps): JSX.Element {
  const { project, engine, run, setDate, exporting } = useProject()
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
          {/* Slot: the page's own transport - scrub, Play day and speed (A5.5-16). */}
        </>
      )}
    </Cell>
  )
}
