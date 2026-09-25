import { useRef, type JSX } from 'react'
import { DEFAULT_COLOR, type ProjectRecord } from '../../../../shared/project'
import LineColours from '../../LineColours'
import LineOrderPanel from '../../LineOrder'
import Cell from '../Cell'
import type { CellViewProps } from '../cells'
import { useProject } from '../context'

// Cell 05, Lines: each line's colour and where it sits in the stack
// (ADR-045).
//
// One cell of two sections, `LineColours` (A4-01) and `LineOrder` (A4-02),
// each named by a heading of its own a level below the cell's: the cell is
// called Lines, and one heading cannot say where the colours end and the
// order begins. Nothing either section does was re-authored here (A5.5-18);
// what they carry was paid for twice over, once when they were built and
// again when a drag that ended outside its row was found to close the
// picker it began in (issue 87).
//
// Both hand focus back to this cell's heading when a control that held it
// disables itself - not to the toggle inside it, which a reflexive Space
// after "Back to alphabetical" would collapse, and not to the section's own
// heading, which is not a thing a person can put focus on.
//
// Neither is disabled while another run reads the project's page: the
// change waits and builds once the way is clear, which is the rule A4-01
// and A4-02 were built to keep. The cell reads running rather than stale
// while a redraw goes, because a colour and an order are the cheap edits
// ADR-045 exempts: they redraw themselves, and `cellOfRun` answers `lines`
// for both.

/**
 * What the collapsed cell says it holds: how many lines carry a colour of
 * their own, whether the default has moved, and whether the lines are drawn
 * in an order a person chose (DESIGN.md 8.2, "The cell").
 *
 * The record alone answers it. The feed is not read for this: a summary
 * that waited on an inspection would be blank on the row while the cell
 * beneath it showed its lines, and every figure here is of what the project
 * carries rather than of what the feed offers.
 *
 * Null before the project has been laid out, where the cell says instead
 * that the lines arrive with the map: a count of overrides on a project
 * with no lines yet describes nothing.
 */
export function linesSummary(
  project: Pick<ProjectRecord, 'layout' | 'colors' | 'defaultColor' | 'lineOrder'>,
): string | null {
  if (project.layout === null) return null
  // `hasOwnProperty` is what `colours.ts` counts an override by; the keys of
  // a record's own colours are that same set, and a label the store would
  // not hold never reached it.
  const overridden = Object.keys(project.colors).length
  const parts = [
    overridden === 0
      ? 'no line recoloured'
      : `${overridden} line${overridden === 1 ? '' : 's'} recoloured`,
  ]
  // The one default is for the lines the feed leaves blank, and it is
  // chosen in this cell, so a cell that named only the overrides would be
  // silent about a change a person made in it.
  if (project.defaultColor !== DEFAULT_COLOR) parts.push('a default of your own')
  // An empty `lineOrder` is the engine's own order, which is what "Back to
  // alphabetical" stores: the panel keeps it empty rather than naming every
  // line to say nothing (A4-02).
  parts.push(project.lineOrder.length === 0 ? 'alphabetical order' : 'an order you chose')
  return parts.join(', ')
}

export default function LinesCell({ cell, state, open, onToggle }: CellViewProps): JSX.Element {
  const { project, engine, run, exporter, inspect, exporting } = useProject()
  const heading = useRef<HTMLHeadingElement>(null)
  const busyNow = (): boolean => exporter.snapshot.state === 'running'
  return (
    <Cell
      number={cell.number}
      name={cell.name}
      state={state}
      // Null while the record is being read, and until there is a map:
      // a cell with nothing true to say says nothing. A read-only project
      // still names what its lines carry, which is drawn on the map whether
      // or not it can be changed here.
      summary={project === null ? null : linesSummary(project)}
      open={open}
      onToggle={onToggle}
      headingRef={heading}
    >
      {project !== null &&
        (project.readOnly ? (
          // One sentence rather than an empty box, as cell 04 says it
          // (DESIGN.md 8.2).
          <p className="prose">
            This project was made by a newer version of the app, so its lines cannot be changed
            here.
          </p>
        ) : project.layout === null ? (
          <p className="prose">
            The lines are the map&rsquo;s. Lay the project out, and each one is listed here with the
            colour its feed publishes and its place in the stack.
          </p>
        ) : (
          <>
            <LineColours
              run={run}
              project={project}
              engine={engine}
              inspect={inspect}
              disabled={exporting}
              busyNow={busyNow}
              handback={heading}
            />
            <LineOrderPanel
              run={run}
              project={project}
              engine={engine}
              inspect={inspect}
              disabled={exporting}
              busyNow={busyNow}
              handback={heading}
            />
          </>
        ))}
    </Cell>
  )
}
