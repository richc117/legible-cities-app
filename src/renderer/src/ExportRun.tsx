import type { JSX } from 'react'
import Button from './kit/Button'
import Icon from './icons/Icon'
import ProgressLine from './ProgressLine'
import type { EngineState } from '../../shared/engine'
import type { ProjectRecord } from '../../shared/project'
import type { ExportRun as Run } from './engine/exportRun'
import { useSnapshot } from './useSnapshot'

// The export on screen: the three stages on the progress line as the main
// process reports them, the last sentence, a way to stop, and when it is
// done the file's name and a way to see it. The design document puts the
// progress line on the export screen (section 10) and makes cancel a text
// button beside it; a finished export is a deliverable (section 8.2): its
// name in prose and "Reveal", never its path.

export default function ExportRun({
  run,
  project,
  engine,
  disabled = false,
}: {
  run: Run
  project: ProjectRecord
  engine: EngineState | null
  /** True while something else, such as a layout run, is changing the project. */
  disabled?: boolean
}): JSX.Element {
  const { state, stages, message, error, file, left } = useSnapshot(run)
  const begin = (): void => run.start(project, engine)
  const exportButton = (
    <Button variant="primary" onClick={begin} disabled={disabled}>
      <Icon name="export" />
      Export reel
    </Button>
  )

  if (state === 'idle') {
    return <div className="toolbar">{exportButton}</div>
  }

  return (
    <section className="export-run" aria-label="Export">
      <ProgressLine stages={stages} ariaLabel={describe(state, message)} />
      <div className="export-run-foot">
        <p className="progress-message" role="status" aria-live="polite">
          {error ?? message ?? 'Starting the export.'}
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
              ? 'The export was cancelled. Nothing was written.'
              : left
                ? 'The engine stopped while writing the file. Export again to replace whatever it left.'
                : 'Nothing was written.'}
          </p>
          <div className="toolbar">{exportButton}</div>
        </>
      )}
      {state === 'done' && (
        <>
          <p className="prose" role="status">
            Exported {file}.
          </p>
          <div className="toolbar">
            <Button variant="primary" onClick={() => run.reveal()}>
              <Icon name="forward" />
              Reveal
            </Button>
            {exportButton}
          </div>
        </>
      )}
    </section>
  )
}

/** One sentence for the whole line, for a screen reader. */
function describe(state: string, message: string | null): string {
  if (state === 'failed') return 'The export failed.'
  if (state === 'cancelled') return 'The export was cancelled.'
  if (state === 'done') return 'The export finished.'
  return message === null ? 'The export is starting.' : `Running: ${message}`
}
