import { useState, type JSX } from 'react'
import Button from './kit/Button'
import Icon from './icons/Icon'
import ConfirmDialog from './ConfirmDialog'
import ProgressLine from './ProgressLine'
import type { EngineState } from '../../shared/engine'
import { shortLayoutId } from '../../shared/layout'
import type { ProjectRecord } from '../../shared/project'
import type { LayoutRun as Run } from './engine/layoutRun'
import { useSnapshot } from './useSnapshot'

// The layout run on screen: the stages as the engine finishes them, the
// sentence it wrote for the last one, and a way to stop. The design
// document puts the progress line on the layout screen (section 10) and
// makes cancel a text button beside it (section 8.2), which is what this is
// until the jobs drawer generalises it (A1-03).

export default function LayoutRun({
  run,
  project,
  engine,
  disabled = false,
}: {
  run: Run
  project: ProjectRecord
  engine: EngineState | null
  /** True while something else, such as an export, is reading the project's page. */
  disabled?: boolean
}): JSX.Element {
  const {
    state,
    stages,
    message,
    error,
    changed,
    relaid,
    forced,
    replaced,
    rebuilt,
    recoloured,
    day,
  } = useSnapshot(run)
  const [confirming, setConfirming] = useState(false)
  const begin = (): void => run.start(project, engine)
  // The re-layout, behind its warning: every stage runs again, and the
  // engine keeps the stored layout until the new one is whole (ADR-033).
  const relayout = async (): Promise<void> => {
    setConfirming(false)
    run.start(project, engine, { force: true })
  }
  const relayoutButton = project.layout !== null && (
    <Button onClick={() => setConfirming(true)} disabled={disabled}>
      <Icon name="route" />
      Re-layout
    </Button>
  )
  const warning = (
    <ConfirmDialog
      open={confirming}
      title="Lay this project out from scratch?"
      description="The layout engine is heuristic: a new layout may place stations differently. The stored layout stays until the new one is whole, and every project on this feed with the same settings draws from it, so their maps change too. Nothing changes if this is cancelled."
      confirmLabel="Re-layout"
      variant="primary"
      onConfirm={relayout}
      onCancel={() => setConfirming(false)}
    />
  )

  // The record's inputs have moved since the layout was made: the map on
  // screen is the old choice's until the next run draws the new (A2-02).
  const moved =
    project.built !== null &&
    (project.built.mode !== project.mode || project.built.agency !== project.agency)
  const movedNotice = moved && (
    <p className="prose" role="status">
      This layout was made with {describeInputs(project.built)}; the choice has changed since, so
      lay out to draw with {describeInputs(project)}.
    </p>
  )
  if (state === 'idle') {
    return (
      <>
        {project.layout !== null && (
          <p className="prose" role="status">
            Drawn from layout {shortLayoutId(project.layout)}
            {project.date === null ? '' : ` for ${project.date}`}.
          </p>
        )}
        {movedNotice}
        <div className="toolbar">
          <Button variant="primary" onClick={begin} disabled={disabled}>
            <Icon name="map" />
            {project.layout === null ? 'Lay out' : 'Lay out again'}
          </Button>
          {relayoutButton}
        </div>
        {warning}
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
            {stoppedSentence(state, replaced, rebuilt, recoloured)}
          </p>
          <div className="toolbar">
            <Button variant="primary" onClick={begin} disabled={disabled}>
              <Icon name="map" />
              Lay out
            </Button>
            {relayoutButton}
          </div>
        </>
      )}
      {state === 'done' && (
        <>
          <p className="prose" role="status">
            {recoloured
              ? recolouredSentence()
              : rebuilt
                ? drawnSentence(day)
                : doneSentence(forced, changed, relaid)}
          </p>
          {movedNotice}
          {/* The run outlives the screen, so this state is what a person
              comes back to; without the unforced run here, "Lay out again"
              would be unreachable until the app restarts. */}
          <div className="toolbar">
            <Button onClick={begin} disabled={disabled}>
              <Icon name="map" />
              Lay out again
            </Button>
            {relayoutButton}
          </div>
        </>
      )}
      {warning}
    </section>
  )
}

/**
 * What a finished run says. A re-layout runs every stage again under the
 * same id, so its map may differ while the id does not; an ordinary run
 * that lands on a different id than the record had was drawn from a layout
 * the engine named anew - a feed that changed, another LOOM, or a record
 * from before the engine named layouts at all; and an ordinary run whose
 * id is the record's but whose set was made again since was drawn from a
 * layout another project on the same inputs re-laid out (A3-06).
 */
export function doneSentence(forced: boolean, changed: boolean, relaid = false): string {
  if (forced && changed)
    return 'Laid out again from scratch, and the project now names this layout in place of the one it had recorded. A new layout may place stations differently.'
  if (forced) return 'Laid out again from scratch. A new layout may place stations differently.'
  if (changed)
    return 'Laid out. The layout differs from the one the project had recorded, so the project now names this one.'
  if (relaid)
    return 'Laid out. The layout was laid out again from another project since this one last drew from it, so the map may place stations differently.'
  return 'Laid out.'
}

/** A mode and an agency, in words. */
export function describeInputs(inputs: { mode: string; agency: string | null } | null): string {
  if (inputs === null) return "the feed's own entry"
  return inputs.agency === null
    ? `${inputs.mode}, every operator`
    : `${inputs.mode}, ${inputs.agency}`
}

/** What a rebuild for a chosen day says when the map has been drawn. */
export function drawnSentence(day: string | null): string {
  return day === null
    ? 'Drawn from the stored layout.'
    : `Drawn for ${day} from the stored layout. The stations have not moved.`
}

/** What a redraw for chosen colours says when the map has been drawn. */
export function recolouredSentence(): string {
  return 'Drawn in the colours you chose, from the stored layout. The stations have not moved.'
}

/**
 * What a run that did not finish says. Nothing was written to the record
 * either way; but a re-layout whose layout call had already answered has
 * a new layout stored under the project's id, and the map on screen is the
 * old one until the next run draws the new; and a rebuild that stopped may
 * have left the page half-drawn for the day it did not record.
 */
export function stoppedSentence(
  state: string,
  replaced: boolean,
  rebuilt = false,
  recoloured = false,
): string {
  if (recoloured) {
    return state === 'cancelled'
      ? 'The redraw was cancelled. The project keeps the colours it had; the map on screen may be the old one until the next build.'
      : 'The map was not drawn in those colours. The project keeps the colours it had; the map on screen may be the old one until the next build.'
  }
  if (rebuilt) {
    return state === 'cancelled'
      ? 'The rebuild was cancelled. The project keeps its day; the map on screen may be the old one until the next build.'
      : 'The map was not drawn for that day. The project keeps its day; the map on screen may be the old one until the next build.'
  }
  if (replaced) {
    return state === 'cancelled'
      ? 'The run was cancelled after the layout had been laid out again, before the map was drawn from it. The project keeps its record; lay out to draw the new layout.'
      : 'The layout was laid out again, but the map was not drawn from it. The project keeps its record; lay out to draw the new layout.'
  }
  return state === 'cancelled'
    ? 'The run was cancelled. The project is as it was.'
    : 'Nothing was saved. The project is as it was.'
}

/** One sentence for the whole line, for a screen reader. */
function describe(state: string, total: number, message: string | null): string {
  if (state === 'failed') return 'The layout run failed.'
  if (state === 'cancelled') return 'The layout run was cancelled.'
  if (state === 'done') return `The layout run finished all ${total} stages.`
  return message === null ? 'The layout run is starting.' : `Running: ${message}`
}
