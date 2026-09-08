import { useEffect, useState, type JSX } from 'react'
import Button from './kit/Button'
import Icon from './icons/Icon'
import ProgressLine from './ProgressLine'
import type { EngineState } from '../../shared/engine'
import { shortLayoutId } from '../../shared/layout'
import type { ProjectRecord } from '../../shared/project'
import type { LayoutRun as Run, RunSnapshot } from './engine/layoutRun'

// The layout run on screen: the stages as the engine finishes them, the
// sentence it wrote for the last one, and a way to stop. The design
// document puts the progress line on the layout screen (section 10) and
// makes cancel a text button beside it (section 8.2), which is what this is
// until the jobs drawer generalises it (A1-03).

function useSnapshot(run: Run): RunSnapshot {
  const [snapshot, setSnapshot] = useState(run.snapshot)
  useEffect(() => {
    setSnapshot(run.snapshot)
    return run.subscribe(setSnapshot)
  }, [run])
  return snapshot
}

export default function LayoutRun({
  run,
  project,
  engine,
}: {
  run: Run
  project: ProjectRecord
  engine: EngineState | null
}): JSX.Element {
  const { state, stages, message, error, changed } = useSnapshot(run)
  const begin = (): void => run.start(project, engine)

  if (state === 'idle') {
    return (
      <>
        {project.layout !== null && (
          <p className="prose" role="status">
            Drawn from layout {shortLayoutId(project.layout)}
            {project.date === null ? '' : ` for ${project.date}`}.
          </p>
        )}
        <div className="toolbar">
          <Button variant="primary" onClick={begin}>
            <Icon name="map" />
            {project.layout === null ? 'Lay out' : 'Lay out again'}
          </Button>
        </div>
      </>
    )
  }

  return (
    <section className="layout-run" aria-label="Layout run">
      <ProgressLine stages={stages} ariaLabel={describe(state, stages.length, message)} />
      <div className="layout-run-foot">
        <p className="progress-message" role="status" aria-live="polite">
          {error ?? message ?? 'Starting the layout.'}
        </p>
        {state === 'running' && (
          <Button onClick={() => run.cancel()}>
            <Icon name="close" />
            Cancel
          </Button>
        )}
      </div>
      {(state === 'cancelled' || state === 'failed') && (
        <>
          <p className="prose" role="status">
            {state === 'cancelled'
              ? 'The run was cancelled. The project is as it was.'
              : 'Nothing was saved. The project is as it was.'}
          </p>
          <div className="toolbar">
            <Button variant="primary" onClick={begin}>
              <Icon name="map" />
              Lay out
            </Button>
          </div>
        </>
      )}
      {state === 'done' && (
        <p className="prose" role="status">
          {changed
            ? 'Laid out. The layout on disk had changed since this project was last drawn from it, so the project now names the new one.'
            : 'Laid out.'}
        </p>
      )}
    </section>
  )
}

/** One sentence for the whole line, for a screen reader. */
function describe(state: string, total: number, message: string | null): string {
  if (state === 'failed') return 'The layout run failed.'
  if (state === 'cancelled') return 'The layout run was cancelled.'
  if (state === 'done') return `The layout run finished all ${total} stages.`
  return message === null ? 'The layout run is starting.' : `Running: ${message}`
}
