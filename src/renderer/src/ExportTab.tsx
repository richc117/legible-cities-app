import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
} from 'react'
import { withoutPaths, type EngineState } from '../../shared/engine'
import { type ExportChoice, type ExportPreview } from '../../shared/export'
import { drawnDate } from '../../shared/project/helpers'
import { type ProjectRecord } from '../../shared/project/types'
import type { Inspection } from '../../shared/protocol'
import { linesOf } from './colours'
import type { ExportRun as Run } from './engine/exportRun'
import ExportForm from './export/ExportForm'
import { useExportChoice } from './export/useExportChoice'
import { useExportTables } from './export/useExportTables'
import ExportRunView from './ExportRun'
import {
  defaultsFor,
  keepableLines,
  plannedChoice,
  playedBy,
  PreviewPlanner,
  refusalWords,
  type PreviewAddress,
} from './exportChoice'
import { focusLost } from './focusHandback'
import { openingOf, PREVIEW_NOTE } from './opening'
import Icon from './icons/Icon'
import Button from './kit/Button'
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
// the page's either (A5.5-19). A folder is chosen in the platform's own
// dialog, which only the main process can open, and applied there: the
// page asks for the chooser by naming its project and is told the record
// that came back, so no path crosses the bridge inward - the rule
// Settings' two folders have followed since A1-04. What comes back *out*
// is the folder itself, shown to the person whose folder it is and to
// nobody else; it is in no message the app sends anywhere.

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

/**
 * A key for "this choice, for this page, in this theme", so a refusal is
 * tied to what was refused.
 *
 * The day is the one the page was drawn for and not the record's: a day
 * chosen and not yet drawn changes nothing about the page this preview is
 * of, and re-planning for it would draw the preview's beats and clock for a
 * picture that does not exist (A5.5-15).
 */
const keyOf = (choice: ExportChoice, project: ProjectRecord): string =>
  // Without the alt text, which is not on the plan and so changes nothing
  // the preview is of (issue 352).
  JSON.stringify([{ ...choice, alt: undefined }, project.theme, drawnDate(project), project.layout])

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
  const [refusal, setRefusal] = useState<{ key: string; sentence: string } | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const choicesRef = useRef<HTMLFormElement>(null)

  // Where this project's exports go (A5.5-19). Held here rather than read
  // from the record on every render because the two calls that change it
  // answer the written record themselves, and the screen around this panel
  // is not re-read for a folder: nothing else on it shows one. A record
  // read again for any other reason - a run finishing, the project opened
  // afresh - brings the folder with it, and the effect below takes it.
  const [destination, setDestination] = useState<string | null>(project.destination)
  const [folderProblem, setFolderProblem] = useState<string | null>(null)
  useEffect(() => {
    setDestination(project.destination)
  }, [project.destination])

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
  const key = keyOf(asked, project)
  const refused = refusal !== null && refusal.key === key

  // The preview's planning: debounced, and a late answer dropped. The
  // callbacks are read through refs, so the planner is made once.
  const answerRef = useRef<(preview: ExportPreview, asked: ExportChoice) => void>(() => undefined)
  useEffect(() => {
    answerRef.current = (preview, asked) => {
      if (preview.ok) {
        // Not while the cell is closed. The planner is cancelled in an
        // effect, which flushes after the commit that closed it, so an
        // answer already on its way would otherwise leave an address for a
        // choice a person has left, to be shown the next time the cell
        // opens. `active` is current here because this callback is written
        // on every render.
        if (!active) return
        setRefusal(null)
        setNotes(preview.notes)
        // The preset's own size, from the engine's table, for the frame's
        // ratio and the caption; the plan's may be at another scale.
        const entry =
          tables.status === 'ready'
            ? tables.tables.presets.find((p) => p.name === asked.preset)
            : undefined
        onPreview({
          url: preview.url,
          width: entry?.width ?? preview.width,
          height: entry?.height ?? preview.height,
          safe: entry?.safe_zones ?? false,
        })
      } else {
        // The last good address stays in the frame; the sentence says why
        // this one is not there (FR-007).
        setNotes([])
        setRefusal({
          key: keyOf(asked, project),
          sentence: withoutPaths(refusalWords(preview)),
        })
      }
    }
  })
  const planner = useMemo(
    () =>
      new PreviewPlanner(
        (asked) => window.api.export.preview(project.id, asked),
        (preview, asked) => answerRef.current(preview, asked),
      ),
    [project.id],
  )
  useEffect(() => () => planner.cancel(), [planner])

  const canPlan =
    active &&
    !project.readOnly &&
    ready &&
    tables.status === 'ready' &&
    project.layout !== null &&
    // A run rewrites the page in place; the frame is not reloaded under
    // it, and an export is planned from the record as it was.
    !layingOut &&
    !exporting
  // Planned again whenever what the address depends on changes: `key`
  // carries the choice, the theme, the day and the layout, and `made` a
  // layout laid out again under the same id. Read through a ref, so the
  // effect's dependencies are exactly those.
  const choiceRef = useRef(asked)
  useEffect(() => {
    choiceRef.current = asked
  })
  const made = project.made
  useEffect(() => {
    if (!canPlan) {
      planner.cancel()
      return
    }
    planner.schedule(choiceRef.current)
  }, [canPlan, key, made, planner])

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

  // The destination's two presses. Neither sends a path: `chooseDestination`
  // asks the main process to open the platform's dialog and apply what it
  // answers, and `useAppFolder` takes nothing at all. A cancelled chooser
  // comes back as the record unchanged, so nothing here has to tell the two
  // apart.
  //
  // "Use the app's folder" is the only control in this panel that removes
  // itself: it is drawn only while there is a folder to forget. Chromium
  // blurs an element that leaves the document, so focus is handed to
  // "Choose folder", where the next press about this would go (A6-07).
  const chooserRef = useRef<HTMLElement>(null)
  const handBackToChooser = useRef(false)
  useEffect(() => {
    if (!handBackToChooser.current) return
    handBackToChooser.current = false
    if (focusLost(document.activeElement, document.body)) chooserRef.current?.focus()
  }, [destination])
  // Neither button disables itself while its call is out. The chooser is
  // modal to the window, so a second press cannot reach it anyway, and a
  // control that disables itself under a person's hands drops the focus it
  // holds - which is exactly what the handback above exists to repair. The
  // guard is a ref rather than state for the same reason it is not drawn:
  // two presses in one render would both read the same `false`.
  const changing = useRef(false)
  const changeFolder = async (
    ask: () => Promise<ProjectRecord>,
    /** This press may remove its own button, so focus needs somewhere to go. */
    handBack = false,
  ): Promise<void> => {
    if (changing.current) return
    changing.current = true
    try {
      const record = await ask()
      setFolderProblem(null)
      // Only when the button that was pressed has actually gone: a refused
      // or cancelled change leaves it where it was, holding its own focus.
      handBackToChooser.current = handBack && record.destination === null
      setDestination(record.destination)
    } catch (error) {
      setFolderProblem(error instanceof Error ? error.message : String(error))
    } finally {
      changing.current = false
    }
  }

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
            <div className="field export-destination">
              <p className="field-label" id="export-destination-label">
                Where it goes
              </p>
              {destination === null ? (
                <p className="message" id="export-destination-where">
                  This project&rsquo;s exports go to the app&rsquo;s export folder, which Settings
                  names, in a folder named after the project.
                </p>
              ) : (
                /* A folder's path is shown to the person whose folder it
                   is, as Settings shows its two; it is in no message the
                   app sends anywhere else. */
                <p className="path" id="export-destination-where">
                  {destination}
                </p>
              )}
              <div className="toolbar">
                <Button
                  ref={chooserRef}
                  disabled={locked}
                  aria-describedby="export-destination-where"
                  onClick={() => {
                    void changeFolder(() => window.api.export.chooseDestination(project.id))
                  }}
                >
                  <Icon name="folder" />
                  Choose folder
                </Button>
                {destination !== null && (
                  <Button
                    disabled={locked}
                    aria-describedby="export-destination-where"
                    onClick={() => {
                      void changeFolder(() => window.api.export.useAppFolder(project.id), true)
                    }}
                  >
                    Use the app&rsquo;s folder
                  </Button>
                )}
              </div>
              {folderProblem !== null && (
                <p className="message error" role="alert">
                  {folderProblem}
                </p>
              )}
            </div>
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
