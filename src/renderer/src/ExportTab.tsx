import { useEffect, useMemo, useRef, type JSX, type ReactNode, type RefObject } from 'react'
import type { EngineState } from '../../shared/engine'
import type { ExportChoice } from '../../shared/export'
import type { ProjectRecord } from '../../shared/project/types'
import type { Inspection } from '../../shared/protocol'
import type { ExportRun as Run } from './engine/exportRun'
import ExportDestination, { useDestination } from './export/ExportDestination'
import ExportForm, { useExportDrafts } from './export/ExportForm'
import { useExportChoice } from './export/useExportChoice'
import { useExportLines } from './export/useExportLines'
import { useExportPreview } from './export/useExportPreview'
import { useExportTables } from './export/useExportTables'
import ExportRunView from './ExportRun'
import { defaultsFor, plannedChoice, playedBy, type PreviewAddress } from './exportChoice'
import { openingOf, PREVIEW_NOTE } from './opening'
import { exportable } from './runGraph'
import { useSnapshot } from './useSnapshot'

// The export (A5-01, specs/022-export-tab), cell 06 of the notebook: the composition
// of its pieces (issue 433, part b). It reads the engine's tables (`useExportTables`)
// and the feed's lines (`useExportLines`), holds the choice and writes it
// (`useExportChoice`), plans the preview (`useExportPreview`), and draws the form
// (`ExportForm`), the destination as the form's last field (`ExportDestination`) and
// the run (`ExportRun`), handing each what it needs of the others. The preview's
// frame is the cell's own (`ExportPreview.tsx`, ADR-046): this panel hands up the
// address a plan answers (`onPreview`) and draws the frame it is given (`preview`).
// Every list and every refusal is the engine's.

interface Props {
  project: ProjectRecord & { readOnly: boolean }
  engine: EngineState | null
  run: Run
  /** A layout run, a chosen day, a recolour or a reorder is rewriting the page. */
  layingOut: boolean
  /** Whether the cell holding this is open; the preview is planned only then. */
  active: boolean
  /** The feed as the engine read it, for the lines; the Inspect view's cache answers. */
  inspect: (key: string) => Promise<Inspection>
  /** Write the choice to the record; the view takes the record that comes back. */
  onChoice: (choice: ExportChoice) => Promise<void>
  /** The address cell 06's preview should show, when a plan answers. */
  onPreview: (address: PreviewAddress) => void
  /** Cell 06's preview frame, mounted only while the cell is open, drawn after its sentence. */
  preview?: ReactNode
  /**
   * The heading of the cell this is drawn in (A5.5-19): the panel has none of its own, since the
   * row says "06 Export" already, and focus a disabling control drops lands here - on the heading,
   * not on the toggle inside it, which a reflexive Space after the handback would collapse.
   */
  handback: RefObject<HTMLHeadingElement | null>
}

export default function ExportTab({
  project,
  engine,
  run,
  layingOut,
  active,
  inspect,
  onChoice,
  onPreview,
  preview,
  handback,
}: Props): JSX.Element {
  const ready = engine?.state === 'ready'
  const runState = useSnapshot(run).state
  const exporting = runState === 'running'
  const tables = useExportTables(ready)
  const read = tables.status === 'ready' ? tables.tables : null
  const { inspection, lines } = useExportLines(project, ready, inspect)
  const { choice, dropped, change, writeProblem } = useExportChoice({
    record: project.export,
    tables: read,
    readOnly: project.readOnly,
    onChoice,
  })
  const preset = read?.presets.find((p) => p.name === choice.preset)
  // The storyboard it plays, which an opening is made from; none for a still.
  const played = preset && read ? playedBy(choice, preset, read) : undefined
  // What the preview and the export are planned from: the choice, less a line
  // hidden in cell 05, which the stored choice keeps for it shown again (issue 399).
  const asked = useMemo(() => plannedChoice(choice, project.lines), [choice, project.lines])
  const { refused, refusal, notes } = useExportPreview({
    project,
    asked,
    active,
    ready,
    tables: read,
    layingOut,
    exporting,
    onPreview,
  })
  // Held here, so a form drawn again shows what was typed and the folder answered.
  const drafts = useExportDrafts(choice, dropped)
  const destination = useDestination(project.destination)

  // An export locks the choices it was planned from, which a change could not reach
  // now; Chromium blurs a disabled control, so focus goes to the cell's heading first.
  const locked = project.readOnly || exporting
  const choicesRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (!exporting) return
    const focused = document.activeElement
    if (focused !== null && choicesRef.current?.contains(focused) === true)
      handback.current?.focus()
  }, [exporting, handback])

  // Nothing to choose or preview, not even the choice held (ADR-046, FR-019, spec 029),
  // where no export can be made: one sentence says why, as cells 02 to 05 say theirs.
  if (!exportable(project))
    return (
      <div className="export-tab">
        <p className="prose">
          {project.readOnly
            ? 'This project was made by a newer version of the app, so its export cannot be changed or made here.'
            : 'There is no map to export yet. Lay the project out first, and its export is previewed here.'}
        </p>
      </div>
    )

  return (
    <div className="export-tab" aria-busy={exporting}>
      {!ready && (
        <p className="hint" role="status">
          The engine is not running, so nothing can be planned or exported until it is.
        </p>
      )}
      {ready && tables.status === 'waiting' && (
        <p className="hint" role="status">
          Asking the engine for its presets.
        </p>
      )}
      {tables.status === 'failed' && (
        <p className="message error" role="alert">
          {tables.message}
        </p>
      )}
      {ready && read !== null && preset !== undefined && (
        <>
          {dropped !== null && (
            <p className="notice" role="status">
              The export this project was set to, {dropped}, is no longer offered by the engine.
              This is the Instagram reel with the engine&rsquo;s defaults until another is chosen.
            </p>
          )}
          <p className="prose">
            The preview shows the frame the export will have, with the parts a platform covers with
            its own buttons shaded where it has them. The theme is the map&rsquo;s own.
          </p>
          {played !== undefined && openingOf(choice) !== 'none' && (
            <p className="prose">{PREVIEW_NOTE}</p>
          )}
          {preview}
          <ExportForm
            projectId={project.id}
            tables={read}
            preset={preset}
            defaults={defaultsFor(preset)}
            choice={choice}
            drafts={drafts}
            locked={locked}
            lines={lines}
            inspection={inspection}
            played={played}
            change={change}
            choicesRef={choicesRef}
            refusal={refused && refusal !== null ? refusal.sentence : null}
            notes={notes}
          >
            {/* Inside the form, so an export that starts takes focus off its two
                buttons as off every other choice; neither is a submit. */}
            <ExportDestination projectId={project.id} destination={destination} locked={locked} />
          </ExportForm>
          {exporting && (
            <p className="hint" role="status">
              The choices wait until the export that is going has finished: it was planned from
              them.
            </p>
          )}
          {writeProblem !== null && (
            <p className="message error" role="alert">
              {writeProblem}
            </p>
          )}
        </>
      )}
      {(runState !== 'idle' || (ready && read !== null)) && (
        <ExportRunView
          run={run}
          project={project}
          engine={engine}
          choice={asked}
          disabled={layingOut || refused || read === null}
        />
      )}
    </div>
  )
}
