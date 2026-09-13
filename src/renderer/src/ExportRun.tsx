import { useRef, type JSX } from 'react'
import Button from './kit/Button'
import { useFocusHandback } from './focusHandback'
import Icon from './icons/Icon'
import ProgressLine from './ProgressLine'
import type { EngineState } from '../../shared/engine'
import type { ExportChoice } from '../../shared/export'
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
  choice,
  disabled = false,
}: {
  run: Run
  project: ProjectRecord
  engine: EngineState | null
  /** What to export, as the export tab holds it at the moment of the press (A5-01). */
  choice: ExportChoice
  /**
   * True while something else, such as a layout run, is changing the
   * project, or while the choice is one the engine has refused.
   */
  disabled?: boolean
}): JSX.Element {
  const { state, stages, message, error, file, left } = useSnapshot(run)
  const begin = (): void => run.start(project, engine, choice)
  // "Export" gives way to Cancel, and Cancel to "Reveal" or "Export" again
  // when the export ends; focus on the one that went goes to the one that
  // came (A6-07).
  const region = useRef<HTMLDivElement>(null)
  const exportRef = useRef<HTMLElement>(null)
  const cancelRef = useRef<HTMLElement>(null)
  const revealRef = useRef<HTMLElement>(null)
  useFocusHandback(
    region,
    () =>
      state === 'running'
        ? cancelRef.current
        : state === 'done'
          ? revealRef.current
          : exportRef.current,
    state,
  )
  const exportButton = (
    <Button variant="primary" ref={exportRef} onClick={begin} disabled={disabled}>
      <Icon name="export" />
      Export
    </Button>
  )

  if (state === 'idle') {
    return (
      <div className="focus-region" ref={region}>
        <div className="toolbar">{exportButton}</div>
      </div>
    )
  }

  return (
    <div className="focus-region" ref={region}>
      <section className="export-run" aria-label="Export">
        <ProgressLine stages={stages} ariaLabel={describe(state, message)} />
        <div className="export-run-foot">
          <p className="progress-message" role="status" aria-live="polite">
            {error ?? message ?? 'Starting the export.'}
          </p>
          {state === 'running' && (
            <Button ref={cancelRef} onClick={() => run.cancel()}>
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
              <Button variant="primary" ref={revealRef} onClick={() => run.reveal()}>
                <Icon name="forward" />
                Reveal
              </Button>
              {exportButton}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

/** One sentence for the whole line, for a screen reader. */
function describe(state: string, message: string | null): string {
  if (state === 'failed') return 'The export failed.'
  if (state === 'cancelled') return 'The export was cancelled.'
  if (state === 'done') return 'The export finished.'
  return message === null ? 'The export is starting.' : `Running: ${message}`
}
