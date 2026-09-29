import type { JSX } from 'react'
import { shortLayoutId } from '../../../../shared/layout'
import type { ProjectRecord } from '../../../../shared/project'
import DiagnosticsView from '../../Diagnostics'
import LayoutRunView from '../../LayoutRun'
import Cell from '../Cell'
import { processFooter } from '../CellFooter'
import type { CellViewProps } from '../cells'
import { useProject } from '../context'
import EngineLog from '../EngineLog'

// Cell 02, Process: the layout the map is drawn from, and the run that
// made it (ADR-045).
//
// The layout's id and when it was made are the footer strip's to say
// (`processFooter`, A5.5-11), and nothing above the strip says them again
// (issue 209, DESIGN.md 8.2): the field list the project screen carried
// whole (A3-05, A3-06) stated both five lines above the strip stating
// both, through the same `Time`. The strip draws nothing before there is a
// layout, so that is the one case the cell says in a line of its own. The
// run's own panel is `LayoutRun`, which since A5.5-10 draws the eight
// stages before the run starts as well as during it, and the diagnostics
// are the panel A3-03 built.
//
// Between the two sits the engine's own log for the run that is going
// (A5.5-13), which is where a run doing something inexplicable can be read
// beside the stage doing it. Both were slots once; neither is now, and no
// slot comment is left above a filled one, which is the thing those
// comments exist to prevent.

/**
 * What the cell says on its collapsed row: the layout the map is drawn
 * from, in the eight characters a screen shows it by, and when the engine
 * made it.
 *
 * The same two facts as the strip under the open cell, and read the same
 * way - the moment in the person's own locale, as `Time` renders it -
 * because a row and the strip below it saying the same thing differently
 * is a difference a person has to stop and resolve. The row is drawn only
 * while the cell is collapsed and the strip only while it is open, so the
 * two are never on the screen together (issue 209).
 *
 * A project with no layout says so rather than saying nothing: "not laid
 * out yet" is the most useful thing this cell can tell someone, and it is
 * what the open cell says too, as a sentence.
 */
export function processSummary(
  project: Pick<ProjectRecord, 'layout' | 'made'> | null,
): string | null {
  if (project === null) return null
  if (project.layout === null) return 'not laid out yet'
  const short = shortLayoutId(project.layout)
  if (project.made === null) return short
  const made = new Date(project.made)
  return `${short}, made ${Number.isNaN(made.getTime()) ? project.made : made.toLocaleString()}`
}

export default function ProcessCell({ cell, state, open, onToggle }: CellViewProps): JSX.Element {
  const { project, engine, run, exporting } = useProject()
  return (
    <Cell
      number={cell.number}
      name={cell.name}
      state={state}
      summary={processSummary(project)}
      open={open}
      onToggle={onToggle}
      footer={processFooter(project, engine)}
    >
      {project !== null && (
        <>
          {/* The one thing the strip cannot say, because it draws nothing
              until there is a layout to be the provenance of. A plain
              line, true of a project this version may not write as well,
              so it promises no button: the run's own panel is below it
              wherever there is one to press. */}
          {project.layout === null && <p className="prose">This project is not laid out yet.</p>}
          {!project.readOnly && (
            <LayoutRunView run={run} project={project} engine={engine} disabled={exporting} />
          )}
          {/* The engine's log for the run that is going: a closed
              disclosure, and nothing at all until a run has begun. */}
          <EngineLog run={run} projectName={project.name} />
          {/* What the build had to fudge: the panel draws nothing until a
              map has been drawn in this session, and the numbers are never
              stored (A3-03, specs/017). */}
          {!project.readOnly && <DiagnosticsView run={run} project={project} />}
        </>
      )}
    </Cell>
  )
}
