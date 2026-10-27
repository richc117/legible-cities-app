import {
  useEffect,
  useState,
  type FormEvent,
  type JSX,
  type ReactNode,
  type RefObject,
} from 'react'
import { VIEWS, type View } from '../../../shared/capture'
import {
  isClockCorner,
  isOfferedPreset,
  QUALITIES,
  standardQualityOnly,
  validateAlt,
  validateClock,
  validateTag,
  type ExportChoice,
  type Quality,
} from '../../../shared/export'
import type { Inspection, Storyboard } from '../../../shared/protocol'
import ExportOpening from '../ExportOpening'
import {
  byPlatform,
  cornerNote,
  cornerWords,
  defaultCorner,
  offeredCorners,
  plays,
  presetWords,
  readCaption,
  storyboardWords,
  toggledLines,
  withAlt,
  withOption,
  withPreset,
  withStoryboard,
  type ExportTables,
  type OfferedRow,
  type OptionDefaults,
} from '../exportChoice'
import Select from '../kit/Select'
import TextInput from '../kit/TextInput'

// Cell 06's choices (issue 433, part b): every field from the preset to
// the alt text, the four typed fields' drafts and their commit on Enter or
// on leaving the field. The opening is its own file (`ExportOpening.tsx`)
// and is drawn here, after the storyboard it opens. What the form changes
// it hands to `change`, which writes it (`useExportChoice`). What the
// preview's plan said it is told (`useExportPreview`, through the
// composition), and where the file goes is drawn as its last field
// (`children`, `ExportDestination.tsx`).

const VIEW_WORDS: Record<View, string> = {
  geographic: 'geographic',
  map: 'map',
  linear: 'linear',
  time: 'time chart',
}

interface Props {
  /** The project's id, which the opening's drafts are kept for. */
  projectId: string
  tables: ExportTables
  /** The choice's preset, as the engine's table lists it. */
  preset: OfferedRow
  /** What the engine does for the preset when it is told nothing. */
  defaults: OptionDefaults
  choice: ExportChoice
  /** The preset or storyboard the record named and the engine no longer lists; null when none. */
  dropped: string | null
  /** An export is running, or the project cannot be written. */
  locked: boolean
  /** The lines that can be kept, by the labels the line colours use. */
  lines: readonly string[]
  /** The feed as the engine read it; null until it has answered. */
  inspection: Inspection | null
  /** The storyboard this choice plays, which an opening is made from; none for a still. */
  played: Storyboard | undefined
  change: (next: ExportChoice) => void
  /** The form, so the composition can take focus off it as an export starts. */
  choicesRef: RefObject<HTMLFormElement | null>
  /** The engine's refusal of the choice as it is now, from the preview's plan; null when none. */
  refusal: string | null
  /** The engine's notes on the last plan it answered. */
  notes: readonly string[]
  /** Where the file goes, the form's last field. */
  children: ReactNode
}

export default function ExportForm({
  projectId,
  tables,
  preset,
  defaults,
  choice,
  dropped,
  locked,
  lines,
  inspection,
  played,
  change,
  choicesRef,
  refusal,
  notes,
  children,
}: Props): JSX.Element {
  // A JPEG still, read from the engine's table: made at standard quality only.
  const jpegStill = standardQualityOnly(preset)
  // The clock's corner: the ones on offer follow the preset and whether the
  // title or a caption is drawn, and the one shown is the choice's or, where
  // the choice names none, the engine's own for the preset (issue 352).
  const clockOn = choice.options.clock ?? defaults.clock
  const nameBlock = {
    title: choice.options.title ?? defaults.title,
    caption: choice.options.caption !== undefined,
  }
  const corners = offeredCorners(preset, nameBlock)
  // `usable` has already taken out a corner this preset would refuse, so the
  // choice's own is on offer whenever it names one.
  const corner = choice.options.clock_corner ?? defaultCorner(preset)

  // The drafts of the two typed fields: written to the choice when they are
  // committed (Enter, or leaving the field), never on every keystroke.
  const [atDraft, setAtDraft] = useState(choice.options.at ?? '')
  const [tagDraft, setTagDraft] = useState(choice.options.tag ?? '')
  const [atProblem, setAtProblem] = useState<string | null>(null)
  const [tagProblem, setTagProblem] = useState<string | null>(null)
  // The caption and the alt text are typed the same way, and are judged as
  // they are typed: the engine's sentence is beside the field at the 81st
  // character and not after it has been left, and nothing refused is ever
  // written or planned. What is written is what is committed.
  const [captionDraft, setCaptionDraft] = useState(choice.options.caption ?? '')
  const [altDraft, setAltDraft] = useState(choice.alt ?? '')
  const caption = readCaption(captionDraft)
  const altProblem = altDraft.trim() === '' ? null : validateAlt(altDraft)
  useEffect(() => {
    // A saved choice that fell back takes its fields with it.
    if (dropped === null) return
    setAtDraft('')
    setTagDraft('')
    setCaptionDraft('')
    setAltDraft('')
  }, [dropped])

  const commitAt = (): void => {
    const value = atDraft.trim()
    const problem = value === '' ? null : validateClock(value)
    setAtProblem(problem)
    if (problem === null && value !== (choice.options.at ?? ''))
      change(withOption(choice, preset, { key: 'at', value }))
  }
  const commitTag = (): void => {
    const value = tagDraft.trim()
    const problem = value === '' ? null : validateTag(value)
    setTagProblem(problem)
    if (problem === null && value !== (choice.options.tag ?? ''))
      change(withOption(choice, preset, { key: 'tag', value }))
  }
  const commitCaption = (): void => {
    if (caption.problem === null && caption.text !== (choice.options.caption ?? ''))
      change(withOption(choice, preset, { key: 'caption', value: caption.text }))
  }
  const commitAlt = (): void => {
    if (altProblem === null && altDraft.trim() !== (choice.alt ?? ''))
      change(withAlt(choice, altDraft))
  }
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    commitAt()
    commitTag()
    commitCaption()
  }

  return (
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
            if (isOfferedPreset(name))
              change(
                withPreset(
                  choice,
                  name,
                  tables.presets.find((row) => row.name === name),
                ),
              )
          }}
        >
          {byPlatform(tables.presets).map((group) => (
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
            {tables.storyboards.map((board) => (
              <option key={board.name} value={board.name}>
                {storyboardWords(board)}
                {board.name === preset.storyboard ? ' (the preset’s own)' : ''}
              </option>
            ))}
          </Select>
        </div>
      )}
      {/* What plays before the storyboard, and how long: after the
          storyboard it opens, and only once that is known. */}
      {played !== undefined && (
        <ExportOpening key={projectId} choice={choice} locked={locked} onChange={change} />
      )}
      {refusal !== null && (
        <p className="message error" role="alert">
          {refusal}
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

      {/* The words the page draws under the title, and where the clock
          sits. The corners on offer are the ones the engine will plan
          for this preset and these options; the rest are absent and
          not disabled. */}
      <div className="field">
        <label htmlFor="export-caption">Caption</label>
        <div onBlur={commitCaption}>
          <TextInput
            id="export-caption"
            value={captionDraft}
            onChange={setCaptionDraft}
            disabled={locked}
            aria-describedby="export-caption-message"
            aria-invalid={caption.problem !== null ? true : undefined}
          />
        </div>
        <p
          id="export-caption-message"
          className={caption.problem === null ? 'message' : 'message error'}
        >
          {caption.problem ??
            [
              caption.count,
              'Drawn under the title, in your words: up to 80 characters, on one line.',
            ]
              .filter((part) => part !== null)
              .join('. ')}
        </p>
      </div>

      <div className="field">
        <span className="field-label" aria-hidden="true">
          Clock corner
        </span>
        {/* Keyed by the preset's own corner, which is what the marked
            option's words depend on: the kit copies a select's options
            into its own when they are added or taken away and not when
            one's words change, and the mark moves only when a preset
            with safe zones is chosen or left. A caption or the title
            changing the list must not make the select afresh: that
            happens as focus is moving to it. */}
        <Select
          key={defaultCorner(preset)}
          label="Clock corner"
          value={corner}
          disabled={locked || !clockOn}
          onChange={(value) => {
            if (isClockCorner(value))
              change(withOption(choice, preset, { key: 'clock_corner', value }))
          }}
        >
          {corners.map((option) => (
            <option key={option} value={option}>
              {cornerWords(option)}
              {option === defaultCorner(preset) ? ' (the preset’s own)' : ''}
            </option>
          ))}
        </Select>
        <p className="message">{cornerNote(preset, clockOn, nameBlock)}</p>
      </div>

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
          <p id="export-at-message" className={atProblem === null ? 'message' : 'message error'}>
            {atProblem ??
              'HH:MM. The still is taken at this time; past midnight stays past midnight, so 25:30 is half past one the next morning.'}
          </p>
        </div>
      )}

      <fieldset className="export-lines" disabled={locked}>
        <legend>Lines to keep</legend>
        <p className="message">None chosen draws every line.</p>
        {inspection === null && (
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
                    value: toggledLines(lines, choice.options.lines, label, event.target.checked),
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
                change(withOption(choice, preset, { key: 'quality', value: quality as Quality }))
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
        <p id="export-tag-message" className={tagProblem === null ? 'message' : 'message error'}>
          {tagProblem ??
            'Added to the file’s name, so a draft does not replace the last good export.'}
        </p>
      </div>

      {/* The sidecar's alt text, in the person's own words. Not a plan
          option: it goes to the encode, in the provenance. A native
          field, because the kit has no multi-line one; the kit's own
          stylesheet draws it. */}
      <div className="field">
        <label htmlFor="export-alt">Alt text for the file’s sidecar</label>
        <textarea
          id="export-alt"
          rows={5}
          value={altDraft}
          onChange={(event) => setAltDraft(event.target.value)}
          onBlur={commitAlt}
          disabled={locked}
          aria-describedby="export-alt-message"
          aria-invalid={altProblem !== null ? true : undefined}
        />
        <p id="export-alt-message" className={altProblem === null ? 'message' : 'message error'}>
          {altProblem ??
            'Describes the map for someone who cannot see it, in your words. Left blank, the engine writes its own sentence.'}
        </p>
      </div>

      {children}
      <button type="submit" hidden />
    </form>
  )
}
