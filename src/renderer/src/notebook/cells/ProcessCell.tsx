import type { JSX } from 'react'
import { shortLayoutId } from '../../../../shared/layout'
import type { ProjectRecord } from '../../../../shared/project'
import DiagnosticsView from '../../Diagnostics'
import LayoutRunView from '../../LayoutRun'
import Cell from '../Cell'
import type { CellViewProps } from '../cells'
import { useProject } from '../context'
import EngineLog from '../EngineLog'
import Time from '../Time'

// Cell 02, Process: the layout the map is drawn from, and the run that
// made it (ADR-045).
//
// The layout's id and when it was made come from the `<dl class="fields">`
// the project screen carried whole (A3-05, A3-06); the run's own panel is
// `LayoutRun`, which since A5.5-10 draws the eight stages before the run
// starts as well as during it, and the diagnostics are the panel A3-03
// built.
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
 * The same two facts as the field list inside the open cell, and read the
 * same way - the moment in the person's own locale, as `Time` renders it -
 * because a row and the field below it saying the same thing differently
 * is a difference a person has to stop and resolve.
 *
 * A project with no layout says so rather than saying nothing: "not laid
 * out yet" is the most useful thing this cell can tell someone, and it is
 * what the field says too.
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
    >
      {project !== null && (
        <>
          <dl className="fields">
            <dt>Layout</dt>
            <dd>
              {project.layout === null ? (
                'not laid out yet'
              ) : project.made === null ? (
                shortLayoutId(project.layout)
              ) : (
                <>
                  {shortLayoutId(project.layout)}, made <Time iso={project.made} />
                </>
              )}
            </dd>
          </dl>
          {!project.readOnly && (
            <LayoutRunView run={run} project={project} engine={engine} disabled={exporting} />
          )}
          {/* The engine's log for the run that is going: a closed
              disclosure, and nothing at all until a run has begun. */}
          <EngineLog run={run} />
          {/* What the build had to fudge: the panel draws nothing until a
              map has been drawn in this session, and the numbers are never
              stored (A3-03, specs/017). */}
          {!project.readOnly && <DiagnosticsView run={run} project={project} />}
        </>
      )}
    </Cell>
  )
}
