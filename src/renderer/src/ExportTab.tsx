import { useEffect, useMemo, useRef, useState, type FormEvent, type JSX } from 'react'
import { VIEWS, type View } from '../../shared/capture'
import { withoutPaths, type EngineState } from '../../shared/engine'
import {
  isOfferedPreset,
  QUALITIES,
  standardQualityOnly,
  validateClock,
  validateTag,
  type ExportChoice,
  type ExportPreview,
  type Quality,
} from '../../shared/export'
import type { ProjectRecord } from '../../shared/project'
import type { Inspection } from '../../shared/protocol'
import { linesOf } from './colours'
import { engineClient } from './engine/runs'
import type { ExportRun as Run } from './engine/exportRun'
import ExportRunView from './ExportRun'
import {
  byPlatform,
  defaultsFor,
  exportTablesFor,
  forgetExportTables,
  plays,
  presetWords,
  PreviewPlanner,
  refusalWords,
  sameChoice,
  storyboardWords,
  toggledLines,
  usable,
  withOption,
  withPreset,
  withStoryboard,
  type ExportTables,
  type PreviewAddress,
} from './exportChoice'
import Select from './kit/Select'
import TextInput from './kit/TextInput'
import { useSnapshot } from './useSnapshot'

// The export tab (A5-01, specs/022-export-tab): a preset from the engine's
// table, grouped by platform; a storyboard for a video or a GIF; the
// options; and the export itself, with the progress line, cancel and
// "Reveal" it always had.
//
// The preview is not drawn here. While this tab is open the map's own frame
// is sent to the address `export.plan` answers for the choice, with the
// platform's safe zones asked for where the preset has them, and the page
// draws the frame, the title, the clock and the zones itself (principle I).
// This tab only says which address, through `onPreview`.
//
// Every list and every refusal is the engine's. A choice is written to the
// project record the moment it is made (a text field when it is committed),
// so a project opens on what it was last set to export.

type Tables =
  | { status: 'waiting' }
  | { status: 'ready'; tables: ExportTables }
  | { status: 'failed'; message: string }

const VIEW_WORDS: Record<View, string> = {
  geographic: 'geographic',
  map: 'map',
  linear: 'linear',
  time: 'time chart',
}

interface Props {
  project: ProjectRecord & { readOnly: boolean }
  engine: EngineState | null
  run: Run
  /** A layout run, a chosen day, a recolour or a reorder is rewriting the page. */
  layingOut: boolean
  /** Whether this tab is the one showing; the preview is planned only then. */
  active: boolean
  /** The feed as the engine read it, for the lines; the Inspect view's cache answers. */
  inspect: (key: string) => Promise<Inspection>
  /** Write the choice to the record; the view takes the record that comes back. */
  onChoice: (choice: ExportChoice) => Promise<void>
  /** The address the map's frame should show, when a plan answers. */
  onPreview: (address: PreviewAddress) => void
}

/** A key for "this choice, for this page, in this theme", so a refusal is tied to what was refused. */
const keyOf = (choice: ExportChoice, project: ProjectRecord): string =>
  JSON.stringify([choice, project.theme, project.date, project.layout])

export default function ExportTab({
  project,
  engine,
  run,
  layingOut,
  active,
  inspect,
  onChoice,
  onPreview,
}: Props): JSX.Element {
  const ready = engine?.state === 'ready'
  const runState = useSnapshot(run).state
  const exporting = runState === 'running'
  const [tables, setTables] = useState<Tables>({ status: 'waiting' })
  const [saved, setSaved] = useState<ExportChoice>(project.export)
  const [refusal, setRefusal] = useState<{ key: string; sentence: string } | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [writeProblem, setWriteProblem] = useState<string | null>(null)
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const choicesRef = useRef<HTMLFormElement>(null)

  // The engine's two tables, once while it stays up. A restarted engine
  // may be another version, so they are asked again.
  useEffect(() => {
    if (!ready) {
      forgetExportTables()
      setTables({ status: 'waiting' })
      return
    }
    let left = false
    exportTablesFor(engineClient()).then(
      (answer) => {
        if (!left) setTables({ status: 'ready', tables: answer })
      },
      (error: unknown) => {
        if (left) return
        const reason = error as { data?: { hint?: string }; message?: string }
        setTables({
          status: 'failed',
          message: withoutPaths(
            reason.data?.hint ?? reason.message ?? 'The engine did not list its presets.',
          ),
        })
      },
    )
    return () => {
      left = true
    }
  }, [ready])

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
  const lines = useMemo(
    () => (inspection === null ? [] : linesOf(inspection, { mode, agency }).map((l) => l.label)),
    [inspection, mode, agency],
  )

  const { choice, dropped } = useMemo(
    () =>
      tables.status === 'ready'
        ? usable(saved, tables.tables)
        : { choice: saved, dropped: null as string | null },
    [saved, tables],
  )
  const preset =
    tables.status === 'ready' ? tables.tables.presets.find((p) => p.name === choice.preset) : null
  const defaults = preset ? defaultsFor(preset) : null
  // A JPEG still, read from the engine's table: made at standard quality only.
  const jpegStill = preset ? standardQualityOnly(preset) : false
  const key = keyOf(choice, project)
  const refused = refusal !== null && refusal.key === key

  // The drafts of the two typed fields: written to the choice when they are
  // committed (Enter, or leaving the field), never on every keystroke.
  const [atDraft, setAtDraft] = useState(choice.options.at ?? '')
  const [tagDraft, setTagDraft] = useState(choice.options.tag ?? '')
  const [atProblem, setAtProblem] = useState<string | null>(null)
  const [tagProblem, setTagProblem] = useState<string | null>(null)
  useEffect(() => {
    // A saved choice that fell back takes its fields with it.
    if (dropped === null) return
    setAtDraft('')
    setTagDraft('')
  }, [dropped])

  // The preview's planning: debounced, and a late answer dropped. The
  // callbacks are read through refs, so the planner is made once.
  const answerRef = useRef<(preview: ExportPreview, asked: ExportChoice) => void>(() => undefined)
  useEffect(() => {
    answerRef.current = (preview, asked) => {
      if (preview.ok) {
        setRefusal(null)
        setNotes(preview.notes)
        onPreview({ url: preview.url, width: preview.width, height: preview.height })
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
  const choiceRef = useRef(choice)
  useEffect(() => {
    choiceRef.current = choice
  })
  const made = project.made
  useEffect(() => {
    if (!canPlan) {
      planner.cancel()
      return
    }
    planner.schedule(choiceRef.current)
  }, [canPlan, key, made, planner])

  // Writing: the newest choice wins, and a write is never started while
  // another is on its way to disk. What was last sent, not the record in
  // hand, decides whether a change needs writing: a change back to the
  // record's value while another write is out would otherwise be skipped,
  // and the record would keep the one in between.
  const writing = useRef(false)
  const waiting = useRef<ExportChoice | null>(null)
  const sent = useRef<ExportChoice | null>(project.export)
  const write = async (next: ExportChoice): Promise<void> => {
    waiting.current = next
    if (writing.current) return
    writing.current = true
    try {
      while (waiting.current !== null) {
        const take = waiting.current
        waiting.current = null
        await onChoice(take)
      }
      setWriteProblem(null)
    } catch (error) {
      waiting.current = null
      // What is on disk is unknown now, so the next change is written
      // whatever it is.
      sent.current = null
      setWriteProblem(error instanceof Error ? error.message : String(error))
    } finally {
      writing.current = false
    }
  }
  const change = (next: ExportChoice): void => {
    setSaved(next)
    if (project.readOnly || (sent.current !== null && sameChoice(next, sent.current))) return
    sent.current = next
    void write(next)
  }

  // An export locks the choices: it planned from them, and a change now
  // could not reach the file being made. Chromium blurs a disabled control,
  // so focus goes to the heading first.
  const locked = project.readOnly || exporting
  useEffect(() => {
    if (!exporting) return
    const focused = document.activeElement
    if (focused !== null && choicesRef.current?.contains(focused) === true)
      headingRef.current?.focus()
  }, [exporting])

  const commitAt = (): void => {
    if (preset === null || preset === undefined) return
    const value = atDraft.trim()
    const problem = value === '' ? null : validateClock(value)
    setAtProblem(problem)
    if (problem === null && value !== (choice.options.at ?? ''))
      change(withOption(choice, preset, { key: 'at', value }))
  }
  const commitTag = (): void => {
    if (preset === null || preset === undefined) return
    const value = tagDraft.trim()
    const problem = value === '' ? null : validateTag(value)
    setTagProblem(problem)
    if (problem === null && value !== (choice.options.tag ?? ''))
      change(withOption(choice, preset, { key: 'tag', value }))
  }
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    commitAt()
    commitTag()
  }

  const heading = (
    <h2 id="export-tab-heading" tabIndex={-1} ref={headingRef}>
      Export
    </h2>
  )

  if (project.layout === null) {
    return (
      <div className="export-tab">
        {heading}
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
      {heading}
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
          {project.readOnly && (
            <p className="hint">
              This project was made by a newer version of the app, so its export cannot be changed
              or made here.
            </p>
          )}
          <p className="prose">
            While this tab is open the map shows the frame the export will have, with the parts a
            platform covers with its own buttons shaded where it has them. The theme is the
            map&rsquo;s own.
          </p>
          <form className="export-choices" ref={choicesRef} noValidate onSubmit={submit}>
            <div className="field">
              <span className="field-label" aria-hidden="true">
                Preset
              </span>
              <Select
                label="Preset"
                value={choice.preset}
                disabled={locked}
                onChange={(name) => {
                  if (isOfferedPreset(name)) change(withPreset(choice, name))
                }}
              >
                {byPlatform(tables.tables.presets).map((group) => (
                  <optgroup key={group.platform} label={group.platform}>
                    {group.presets.map((row) => (
                      <option key={row.name} value={row.name}>
                        {presetWords(row)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
              {preset.note !== '' && <p className="message">{preset.note}</p>}
            </div>
            {plays(preset) && (
              <div className="field">
                <span className="field-label" aria-hidden="true">
                  Storyboard
                </span>
                <Select
                  label="Storyboard"
                  value={choice.storyboard ?? preset.storyboard ?? ''}
                  disabled={locked}
                  onChange={(name) => change(withStoryboard(choice, preset, name))}
                >
                  {tables.tables.storyboards.map((board) => (
                    <option key={board.name} value={board.name}>
                      {storyboardWords(board)}
                      {board.name === preset.storyboard ? ' (the preset’s own)' : ''}
                    </option>
                  ))}
                </Select>
              </div>
            )}
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

            {/* A storyboard's first beat names its own view and its own
                clock, and the capture applies them: a view or a start time
                beside one would change the preview and not the file. Both
                are a still's only, and the main process leaves them out of
                any other plan whatever the record holds. */}
            {!plays(preset) && (
              <div className="field">
                <span className="field-label" aria-hidden="true">
                  View
                </span>
                <Select
                  label="View"
                  value={choice.options.view ?? defaults.view}
                  disabled={locked}
                  onChange={(value) => {
                    const view = VIEWS.find((v) => v === value)
                    if (view !== undefined)
                      change(withOption(choice, preset, { key: 'view', value: view }))
                  }}
                >
                  {VIEWS.map((view) => (
                    <option key={view} value={view}>
                      {VIEW_WORDS[view]}
                      {view === defaults.view ? ' (the preset’s own)' : ''}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <fieldset className="export-flags" disabled={locked}>
              <legend>What the frame shows</legend>
              {(
                [
                  ['labels', 'Station names'],
                  ['title', 'The title: city, network and service day'],
                  ['clock', 'The clock'],
                ] as const
              ).map(([flag, words]) => (
                <label key={flag} className="check">
                  <input
                    type="checkbox"
                    checked={choice.options[flag] ?? defaults[flag]}
                    onChange={(event) =>
                      change(withOption(choice, preset, { key: flag, value: event.target.checked }))
                    }
                  />
                  {words}
                </label>
              ))}
            </fieldset>

            {!plays(preset) && (
              <div className="field">
                <label htmlFor="export-at">Start time</label>
                <div onBlur={commitAt}>
                  <TextInput
                    id="export-at"
                    value={atDraft}
                    onChange={setAtDraft}
                    placeholder="07:00"
                    disabled={locked}
                    spellCheck={false}
                    aria-describedby="export-at-message"
                    aria-invalid={atProblem !== null ? true : undefined}
                  />
                </div>
                <p
                  id="export-at-message"
                  className={atProblem === null ? 'message' : 'message error'}
                >
                  {atProblem ??
                    'HH:MM. The still is taken at this time; past midnight stays past midnight, so 25:30 is half past one the next morning.'}
                </p>
              </div>
            )}

            <fieldset className="export-lines" disabled={locked}>
              <legend>Lines to keep</legend>
              <p className="message">None chosen draws every line.</p>
              {lines.length === 0 && (
                <p className="hint">The lines are read from the feed once the engine answers.</p>
              )}
              {lines.map((label) => (
                <label key={label} className="check">
                  <input
                    type="checkbox"
                    checked={choice.options.lines?.includes(label) ?? false}
                    onChange={(event) =>
                      change(
                        withOption(choice, preset, {
                          key: 'lines',
                          value: toggledLines(
                            lines,
                            choice.options.lines,
                            label,
                            event.target.checked,
                          ),
                        }),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </fieldset>

            <div className="field">
              <span className="field-label" aria-hidden="true">
                Quality
              </span>
              {jpegStill ? (
                <>
                  <Select
                    key="standard-only"
                    label="Quality"
                    value="standard"
                    disabled
                    onChange={() => undefined}
                  >
                    <option value="standard">standard</option>
                  </Select>
                  <p className="message">
                    This preset is a JPEG still, which the engine makes at standard quality only.
                  </p>
                </>
              ) : (
                <Select
                  key="any"
                  label="Quality"
                  value={choice.options.quality ?? defaults.quality}
                  disabled={locked}
                  onChange={(value) => {
                    const quality = QUALITIES.find((q) => q === value)
                    if (quality !== undefined)
                      change(
                        withOption(choice, preset, { key: 'quality', value: quality as Quality }),
                      )
                  }}
                >
                  <option value="draft">draft: quick, to check it</option>
                  <option value="standard">standard (the engine’s own)</option>
                  <option value="high">high: twice the size, kept</option>
                </Select>
              )}
            </div>

            <div className="field">
              <label htmlFor="export-tag">Filename tag</label>
              <div onBlur={commitTag}>
                <TextInput
                  id="export-tag"
                  value={tagDraft}
                  onChange={setTagDraft}
                  disabled={locked}
                  spellCheck={false}
                  aria-describedby="export-tag-message"
                  aria-invalid={tagProblem !== null ? true : undefined}
                />
              </div>
              <p
                id="export-tag-message"
                className={tagProblem === null ? 'message' : 'message error'}
              >
                {tagProblem ??
                  'Added to the file’s name, so a draft does not replace the last good export.'}
              </p>
            </div>
            <button type="submit" hidden />
          </form>
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
          choice={choice}
          disabled={layingOut || refused || tables.status !== 'ready'}
        />
      )}
    </div>
  )
}
