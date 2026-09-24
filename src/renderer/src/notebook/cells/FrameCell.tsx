import { useRef, type JSX } from 'react'
import ServiceDay from '../../ServiceDay'
import Cell from '../Cell'
import type { CellViewProps } from '../cells'
import { useProject } from '../context'

// Cell 03, Frame and service day: the day the map is drawn for (ADR-045).
//
// The day itself comes from the `<dl class="fields">` the project screen
// carried whole, and the control is `ServiceDay` unchanged (A3-04) - drawn
// headless, since this cell's heading row is the heading now, with its
// focus handback pointed at that row.
//
// The slot below is where the page's own transport - the scrub, Play day
// and the speed, already on the engine page's seam - arrives as one new
// file (A5.5-15), so that branch never rewrites this one.

export default function FrameCell({ cell, state, open, onToggle }: CellViewProps): JSX.Element {
  const { project, engine, run, exporting } = useProject()
  const heading = useRef<HTMLButtonElement>(null)
  return (
    <Cell
      number={cell.number}
      name={cell.name}
      state={state}
      open={open}
      onToggle={onToggle}
      headingRef={heading}
    >
      {project !== null && (
        <>
          <dl className="fields">
            <dt>Service day</dt>
            <dd>{project.date ?? 'not yet chosen'}</dd>
          </dl>
          {!project.readOnly && project.layout !== null && (
            <ServiceDay
              run={run}
              project={project}
              engine={engine}
              disabled={exporting}
              headless
              handback={heading}
            />
          )}
          {/* Slot: the page's own transport - scrub, Play day and speed (A5.5-15). */}
        </>
      )}
    </Cell>
  )
}
