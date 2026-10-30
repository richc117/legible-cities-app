import { useRef, type JSX } from 'react'
import Button from './kit/Button'
import { useFocusHandback } from './focusHandback'
import Icon from './icons/Icon'
import ProgressLine from './ProgressLine'
import type { EngineState } from '../../shared/engine'
import type { ExportChoice } from '../../shared/export'
import type { ProjectRecord } from '../../shared/project/types'
import type { ExportRun as Run } from './engine/exportRun'
import type { Stage } from './ProgressLine'
import Time from './notebook/Time'
import { useOutputs } from './notebook/useOutputs'
import { KEEP_BOTH, replacedBy } from './notebook/outputWords'
import { useSnapshot } from './useSnapshot'

// The export on screen: the three stages on the progress line as the main
// process reports them, the last sentence, a way to stop, and when it is
// done the file's name and a way to see it. The design document puts the
// progress line on the export screen (section 10) and makes cancel a text
// button beside it; a finished export is a deliverable (section 8.2): its
// name in prose and "Reveal", never its path.
//
// Beside Export, while a file the folder still holds has the name the next
// export will write, one line says so (issue 563): what would be replaced,
// when it was made, and that a filename tag keeps both. The names are
// deterministic on purpose, so a second export of one choice replaces the
// first, and a dialog on a step that is usually meant would be asked every
// time; the sentence sits where the press is and leaves the press alone.

/** The sentence's id, which Export's description names. One export run is drawn at a time. */
const REPLACES_ID = 'export-replaces'

export default function ExportRun({
  run,
  project,
  engine,
  choice,
  planned = null,
  disabled = false,
}: {
  run: Run
  project: ProjectRecord
  engine: EngineState | null
  /** What to export, as the export tab holds it at the moment of the press (A5-01). */
  choice: ExportChoice
  /**
   * The file an export of `choice` would write, from the preview's plan for
   * it as it is now; null while none has answered, or the engine refused.
   */
  planned?: string | null
  /**
   * True while something else, such as a layout run, is changing the
   * project, or while the choice is one the engine has refused.
   */
  disabled?: boolean
}): JSX.Element {
  const { state, stages, message, announced, error, file, left, refused } = useSnapshot(run)
  const begin = (): void => run.start(project, engine, choice)
  const { rows } = useOutputs(project.id, state)
  const replaced = replacedBy(rows, planned)
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
  // One call to action on a screen (DESIGN.md section 8.2): Export is the
  // primary button before a run and when a run has ended without a file.
  // Once a file is written there is none: Reveal and Export are both the
  // default button, so neither competes with the other.
  const exportButton = (
    <Button
      variant={state === 'done' ? 'secondary' : 'primary'}
      ref={exportRef}
      onClick={begin}
      disabled={disabled}
      aria-describedby={replaced === undefined ? undefined : REPLACES_ID}
    >
      <Icon name="export" />
      Export
    </Button>
  )
  // Shown, not spoken: it is the button's description, read when a person
  // reaches Export, and not a live region, which would say it unprompted
  // each time a plan answered.
  const replaces = replaced !== undefined && (
    <p id={REPLACES_ID} className="message export-replaces">
      Exporting replaces {replaced.file}, made <Time iso={replaced.made} />. {KEEP_BOTH}
    </p>
  )

  if (state === 'idle') {
    return (
      <div className="focus-region" ref={region}>
        {replaces}
        <div className="toolbar">{exportButton}</div>
      </div>
    )
  }

  return (
    <div className="focus-region" ref={region}>
      <section className="export-run" aria-label="Export run">
        <ProgressLine fill stages={stages} ariaLabel={describe(state, message)} />
        <div className="export-run-foot">
          {/* The line the eye follows changes with every frame, so it is not
              a live region; the one a screen reader follows changes at a
              stage and at each tenth of the frames (`announcement`). */}
          <p className="progress-message" aria-live="off">
            {error ?? message ?? 'Starting the export.'}
          </p>
          <p className="visually-hidden" role="status" aria-live="polite">
            {error ?? announced ?? 'Starting the export.'}
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
              {unfinishedSentence(state, left, stages, refused)}
            </p>
            {replaces}
            <div className="toolbar">{exportButton}</div>
          </>
        )}
        {state === 'done' && (
          <>
            {/* Shown, not spoken: a live region inserted with its text
                already in it is not reliably announced, and the finish is
                said once, with the file's name, by the job's end sentence
                on every screen (`endSentence`, issue 570). */}
            <p className="prose">Exported {file}.</p>
            {replaces}
            <div className="toolbar">
              <Button ref={revealRef} onClick={() => run.reveal()}>
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

/**
 * What a failure during the encode says (engine v0.18.0, its issue 79). The
 * file and its sidecar are written as `.part` files and moved into place,
 * the file first; a failure before the moves leaves the folder as it was,
 * but a failure of the sidecar's own move leaves the new file beside the
 * sidecar the folder had. The app cannot tell which from here, and the
 * engine's own sentence, above, says which it was.
 */
export const ENCODE_UNFINISHED =
  'Export again to write the file and its sidecar together. Nothing was written, unless the file reached its folder before its sidecar could.'

/**
 * What an export that did not finish says under its line. A cancel, and a
 * failure before the encode, wrote nothing; so did a request the engine
 * refused with its params error (`refused`), which it judges before its job
 * starts, though the encode stage is the one running when the refusal
 * comes back - a destination that is its own source among them, where
 * "export again" would only be refused again. The engine stopping while it
 * encoded may leave its `.part` files for the next export to write over;
 * and any other failure while it encoded is `ENCODE_UNFINISHED`.
 */
export function unfinishedSentence(
  state: 'cancelled' | 'failed',
  left: boolean,
  stages: readonly Pick<Stage, 'id' | 'state'>[],
  refused = false,
): string {
  if (state === 'cancelled') return 'The export was cancelled. Nothing was written.'
  if (left)
    return 'The engine stopped while writing the file. Export again to replace whatever it left.'
  if (refused) return 'Nothing was written.'
  return stages.some((stage) => stage.id === 'encode' && stage.state === 'failed')
    ? ENCODE_UNFINISHED
    : 'Nothing was written.'
}
