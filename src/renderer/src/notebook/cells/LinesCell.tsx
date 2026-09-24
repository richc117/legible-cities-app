import { useRef, type JSX } from 'react'
import LineColours from '../../LineColours'
import LineOrderPanel from '../../LineOrder'
import Cell from '../Cell'
import type { CellViewProps } from '../cells'
import { useProject } from '../context'

// Cell 05, Lines: each line's colour and where it sits in the stack
// (ADR-045).
//
// Two panels today, `LineColours` (A4-01) and `LineOrder` (A4-02), both
// drawn headless because this cell's heading is the section's heading now.
// Each keeps the name its own heading gave it, so the two sections are
// still told apart; both hand focus back to that heading - not to the
// toggle inside it, which a reflexive Space after "Back to alphabetical"
// would collapse. Making them one section is A5.5-18's.
//
// Neither is disabled while another run reads the project's page: the
// change waits and builds once the way is clear, which is the rule A4-01
// and A4-02 were built to keep.

export default function LinesCell({ cell, state, open, onToggle }: CellViewProps): JSX.Element {
  const { project, engine, run, exporter, inspect, exporting } = useProject()
  const heading = useRef<HTMLHeadingElement>(null)
  const busyNow = (): boolean => exporter.snapshot.state === 'running'
  return (
    <Cell
      number={cell.number}
      name={cell.name}
      state={state}
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
