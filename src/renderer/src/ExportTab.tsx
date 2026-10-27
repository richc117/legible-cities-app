import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
} from 'react'
import { type EngineState } from '../../shared/engine'
import { type ExportChoice } from '../../shared/export'
import { type ProjectRecord } from '../../shared/project/types'
import type { Inspection } from '../../shared/protocol'
import { linesOf } from './colours'
import type { ExportRun as Run } from './engine/exportRun'
import ExportDestination from './export/ExportDestination'
import ExportForm from './export/ExportForm'
import { useExportChoice } from './export/useExportChoice'
import { useExportPreview } from './export/useExportPreview'
import { useExportTables } from './export/useExportTables'
import ExportRunView from './ExportRun'
import {
  defaultsFor,
  keepableLines,
  plannedChoice,
  playedBy,
  type PreviewAddress,
} from './exportChoice'
import { openingOf, PREVIEW_NOTE } from './opening'
import { useSnapshot } from './useSnapshot'

// The export (A5-01, specs/022-export-tab), cell 06 of the notebook since
// A5.5-08 and its own tab before that: a preset from the engine's
// table, grouped by platform; a storyboard for a video or a GIF; the
// options, a caption and the clock's corner among them, and the sidecar's
// alt text beside them (issue 352, ADR-052); for a video or a GIF, the
// opening it plays first, a title card or the network drawing in
// (`ExportOpening.tsx`, issue 392); and the export itself, with the
// progress line, cancel and "Reveal" it always had.
//
// The panel has no heading of its own: cell 06's row is its heading, and
// focus a disabling control drops is handed there (`handback`).
//
// The preview is not drawn here. While this cell is open a frame of the
// cell's own (`ExportPreview.tsx`, ADR-046) shows the address `export.plan`
// answers for the choice, with the platform's safe zones asked for where
// the preset has them, and the page draws the frame, the title, the clock
// and the zones itself (principle I). This panel says which address,
// through `onPreview`, and where the cell's frame goes (`preview`). The
// map's own frame is never sent there.
//
// Every list and every refusal is the engine's. A choice is written to the
// project record the moment it is made (a text field when it is committed),
// so a project opens on what it was last set to export.
//
// Where the file goes is the one choice that is not the engine's and not
// the page's either (A5.5-19), and no path crosses the bridge inward for
// it: `export/ExportDestination.tsx` says how.

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
  /**
   * Cell 06's preview frame, which the cell mounts only while it is open
   * (ADR-046), drawn after the sentence that says what it is.
   */
  preview?: ReactNode
  /**
   * The heading of the cell this is drawn in (A5.5-19). The panel has no
   * heading of its own: the cell's row says "06 Export" already, and a
   * second heading saying "Export" under it is one a screen reader reads
   * twice. Focus that a disabling control drops lands here - on the
   * heading and not on the toggle inside it, which a reflexive Space after
   * the handback would collapse.
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
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const choicesRef = useRef<HTMLFormElement>(null)

  // The lines, by the labels the line colours use, for the lines option.
  useEffect(() => {
    if (!ready) return
    let left = false
    inspect(project.feed).then(
      (answer) => {
        if (!left) setInspection(answer)
      },
      () => undefined,
    )
    return () => {
      left = true
    }
  }, [ready, project.feed, inspect])
  const mode = project.built === null ? project.mode : project.built.mode
  const agency = project.built === null ? project.agency : project.built.agency
  // A line hidden in cell 05 is not offered (issue 399): the page has no
  // such line to keep, and keeping only hidden lines would hide them all.
  const lines = useMemo(
    () =>
      inspection === null
        ? []
        : keepableLines(
            linesOf(inspection, { mode, agency }).map((l) => l.label),
            project.lines,
          ),
    [inspection, mode, agency, project.lines],
  )

  const { choice, dropped, change, writeProblem } = useExportChoice({
    record: project.export,
    tables: tables.status === 'ready' ? tables.tables : null,
    readOnly: project.readOnly,
    onChoice,
  })
  const preset =
    tables.status === 'ready' ? tables.tables.presets.find((p) => p.name === choice.preset) : null
  const defaults = preset ? defaultsFor(preset) : null
  // The storyboard this choice plays, as the engine lists it, which an
  // opening is made from; none for a still (issue 392).
  const played =
    preset && tables.status === 'ready' ? playedBy(choice, preset, tables.tables) : undefined
  const opening = played === undefined ? 'none' : openingOf(choice)
  // What the preview and the export are planned from: the choice, less any
  // line hidden in cell 05 among the lines to keep, which the stored choice
  // keeps for a line shown again (issue 399).
  const asked = useMemo(() => plannedChoice(choice, project.lines), [choice, project.lines])

  const { refused, refusal, notes } = useExportPreview({
    project,
    asked,
    active,
    ready,
    tables: tables.status === 'ready' ? tables.tables : null,
    layingOut,
    exporting,
    onPreview,
  })

  // An export locks the choices: it planned from them, and a change now
  // could not reach the file being made. Chromium blurs a disabled control,
  // so focus goes to the cell's own heading first.
  const locked = project.readOnly || exporting
  useEffect(() => {
    if (!exporting) return
    const focused = document.activeElement
    if (focused !== null && choicesRef.current?.contains(focused) === true)
      handback.current?.focus()
  }, [exporting, handback])

  // A read-only project is shown nothing to choose and nothing previewed
  // (ADR-046, FR-019): the preview promises an export that cannot be made
  // here, and options that cannot be changed are a page of disabled
  // controls. One sentence says why, as cells 02 to 05 say theirs. What a
  // project holds as its export choice is not shown either, which is the
  // trade-off spec 029 records.
  if (project.readOnly) {
    return (
      <div className="export-tab">
        <p className="prose">
          This project was made by a newer version of the app, so its export cannot be changed or
          made here.
        </p>
      </div>
    )
  }

  if (project.layout === null) {
    return (
      <div className="export-tab">
        <p className="prose">
          There is no map to export yet. Lay the project out first, and its export is previewed
          here.
        </p>
      </div>
    )
  }

  const showRun = runState !== 'idle' || (ready && tables.status === 'ready' && !project.readOnly)

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
      {ready && tables.status === 'ready' && preset && defaults && (
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
          {opening !== 'none' && <p className="prose">{PREVIEW_NOTE}</p>}
          {preview}
          <ExportForm
            projectId={project.id}
            tables={tables.tables}
            preset={preset}
            defaults={defaults}
            choice={choice}
            dropped={dropped}
            locked={locked}
            lines={lines}
            inspection={inspection}
            played={played}
            change={change}
            choicesRef={choicesRef}
            planNotes={
              <>
                {refused && refusal !== null && (
                  <p className="message error" role="alert">
                    {refusal.sentence}
                  </p>
                )}
                {notes.length > 0 && (
                  <p className="hint" role="status">
                    {notes.join(' ')}
                  </p>
                )}
              </>
            }
          >
            {/* Where the file goes. Inside the form with the rest of the
                choices, so an export that starts takes focus off these two
                as it does off every other control here; neither is a
                submit, so neither ends the two typed fields' commit. */}
            <ExportDestination
              projectId={project.id}
              destination={project.destination}
              locked={locked}
            />
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
      {showRun && (
        <ExportRunView
          run={run}
          project={project}
          engine={engine}
          choice={asked}
          disabled={layingOut || refused || tables.status !== 'ready'}
        />
      )}
    </div>
  )
}
