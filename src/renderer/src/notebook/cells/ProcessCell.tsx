import type { JSX } from 'react'
import { shortLayoutId } from '../../../../shared/layout'
import DiagnosticsView from '../../Diagnostics'
import LayoutRunView from '../../LayoutRun'
import Cell from '../Cell'
import type { CellViewProps } from '../cells'
import { useProject } from '../context'
import Time from '../Time'

// Cell 02, Process: the layout the map is drawn from, and the run that
// made it (ADR-045).
//
// The layout's id and when it was made come from the `<dl class="fields">`
// the project screen carried whole (A3-05, A3-06); the run's own panel is
// `LayoutRun` unchanged, and the diagnostics are the panel A3-03 built.
//
// The three slots below are where the branches that follow put their one
// new file each, so none of them opens this file for more than an import
// line and none of them meets another in it.

export default function ProcessCell({ cell, state, open, onToggle }: CellViewProps): JSX.Element {
  const { project, engine, run, exporting } = useProject()
  return (
    <Cell number={cell.number} name={cell.name} state={state} open={open} onToggle={onToggle}>
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
          {/* Slot: the stages drawn as the engine finishes them (A5.5-14). */}
          {/* Slot: the engine's log for the run that is going (A5.5-13). */}
          {/* Slot: what the build had to fudge (A5.5-16). The panel draws
              nothing until a map has been drawn in this session, and the
              numbers are never stored (A3-03, specs/017). */}
          {!project.readOnly && <DiagnosticsView run={run} project={project} />}
        </>
      )}
    </Cell>
  )
}
