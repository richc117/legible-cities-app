import type { JSX } from 'react'
import Inspect from '../../Inspect'
import StageView from '../../StageView'
import Cell from '../Cell'
import type { CellViewProps } from '../cells'
import { useProject } from '../context'

// Cell 01, Data: what the project is made of (ADR-045).
//
// The feed, the mode and the operator the layout was built with, the
// Inspect view that chooses the last two (A2-02), and the geographic view
// of the stages the engine ran (A2-03). The three fields come from the
// `<dl class="fields">` the project screen carried whole; it is split at
// placement rather than left for three branches to share.
//
// Nothing here is re-authored: `Inspect` and `StageView` are the panels
// that were on the screen before, with the props they had.

export default function DataCell({ cell, state, open, onToggle }: CellViewProps): JSX.Element {
  const { project, engine, inspect, setInputs, registry, readStage, layingOut, exporting } =
    useProject()
  return (
    <Cell number={cell.number} name={cell.name} state={state} open={open} onToggle={onToggle}>
      {project !== null && (
        <>
          <dl className="fields">
            <dt>Feed</dt>
            <dd>{project.feed}</dd>
            <dt>Mode</dt>
            <dd>{project.mode}</dd>
            <dt>Agency</dt>
            <dd>{project.agency ?? 'none'}</dd>
          </dl>
          {!project.readOnly && (
            <Inspect
              project={project}
              engine={engine}
              inspect={inspect}
              onInputs={setInputs}
              registry={registry}
              disabled={layingOut || exporting}
            />
          )}
          {project.layout !== null && (
            <StageView project={project} engine={engine} read={readStage} />
          )}
        </>
      )}
    </Cell>
  )
}
