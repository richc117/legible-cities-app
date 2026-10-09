import { useEffect, useId, useRef, useState, type JSX } from 'react'
import {
  DEFAULT_TUNING,
  isGrid,
  PENALTY_KEYS,
  sameTuning,
  type ProjectRecord,
  type ProjectTuning,
  type TuningKey,
} from '../../shared/project'
import Icon from './icons/Icon'
import Button from './kit/Button'
import Disclosure from './kit/Disclosure'
import Select from './kit/Select'
import TextInput from './kit/TextInput'
import {
  chooseGrid,
  commitTuningField,
  describeTuningField,
  GRID_LABEL,
  gridOptions,
  notSaved,
  OWN_KEYS,
  PENALTY_LEGEND,
  PENALTY_SENTENCE,
  RESET_LABEL,
  resettable,
  TUNING_LABELS,
  TUNING_NAME,
  TUNING_SENTENCE,
  tuningViewOf,
  tuningWord,
  type TuningView,
} from './tuningRules'

// Cell 02's Layout tuning (issue 385, spec 033): LOOM's own settings for the
// project's layout, by name - the grid octi lays the network on, how far
// apart two stretches of track may be and still merge, the grid's cell, and
// what octi pays for each bend - with no slider mapped over any of them.
//
// The app draws fields and nothing else. A tuning is an input to the layout
// run and to nothing else: it is written to the record the moment it is
// committed, as the export's options are, and sent to `graph.build` by the
// next layout run, which the engine names as a layout of its own. Until that
// run the stored layout is of another tuning, which the run graph reports
// and cell 02 says under its run (`tuningNotice`); nothing lays out here.
//
// The numbers follow cell 04's sizes (issue 350, `StyleFields.tsx`), copied
// rather than shared: labelled, described by their range and LOOM's own,
// committed on Enter or on leaving the field and never per keystroke, and a
// number the engine would refuse is refused beside the field in the
// engine's own sentence, with nothing written. Nothing here is disabled for
// a run or an export: a tuning touches neither the page nor the stored
// layout, and a run that is going sends what it was started with.
//
// A closed disclosure under the run's controls, its toggle in an `h3`: the
// tuning is a section of the cell, and the heading is where Reset hands
// focus, not the toggle, where a reflexive Space would close the section a
// person is working in (cell 04's reason, A6-07).

interface Props {
  project: ProjectRecord
  /** Writes a tuning to the record; rejects with the store's reason. */
  onChange: (tuning: ProjectTuning) => Promise<void>
}

export default function LayoutTuning({ project, onChange }: Props): JSX.Element {
  const ids = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<TuningView>(() => tuningViewOf(project.tuning))
  // Why the last write was refused, said once in the section; empty after.
  const [unsaved, setUnsaved] = useState<string | null>(null)

  // Writes on their way, and the tuning the last of them asked for. A record
  // that arrives while one is in flight and is not the one asked for is an
  // earlier write's answer: showing it would take a later field's number
  // off the screen until its own answer put it back.
  const writing = useRef(0)
  const asked = useRef<ProjectTuning>(view.tuning)
  // The record's tuning at this moment, for a refused write to go back to.
  const stored = useRef<ProjectTuning | undefined>(project.tuning)
  useEffect(() => {
    stored.current = project.tuning
  })

  // The record is what the section shows: a write that landed has written
  // it and the screen has read it back, so the two agree again.
  useEffect(() => {
    if (writing.current > 0 && !sameTuning(project.tuning, asked.current)) return
    asked.current = project.tuning ?? {}
    setView((current) => tuningViewOf(project.tuning, current))
  }, [project.id, project.tuning])

  const write = (next: ProjectTuning): void => {
    asked.current = next
    writing.current += 1
    setUnsaved(null)
    onChange(next)
      .catch((reason: unknown) => {
        // Nothing was kept, so the fields go back to the record and say why.
        asked.current = stored.current ?? {}
        setView(tuningViewOf(stored.current))
        setUnsaved(notSaved(reason))
      })
      .finally(() => {
        writing.current -= 1
      })
  }

  const show = (next: TuningView): void => {
    setView(next)
    if (!sameTuning(next.tuning, view.tuning)) write(next.tuning)
  }

  const type = (key: TuningKey, text: string): void =>
    setView((current) => ({ ...current, drafts: { ...current.drafts, [key]: text } }))

  // A button that removes the last thing it had to remove disables itself,
  // and Chromium blurs a disabled element: focus goes to the section's
  // heading first, so it stays in the section (A6-07).
  const reset = (): void => {
    heading.current?.focus()
    show(tuningViewOf({}))
  }

  const field = (key: TuningKey): JSX.Element => {
    const id = `${ids}-${key}`
    const problem = view.problems[key]
    return (
      <div className="style-field" key={key}>
        <label htmlFor={id}>{TUNING_LABELS[key]}</label>
        <div
          className="style-control"
          onBlur={() => show(commitTuningField(view, key))}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            show(commitTuningField(view, key))
          }}
        >
          <TextInput
            id={id}
            value={view.drafts[key]}
            onChange={(text) => type(key, text)}
            spellCheck={false}
            aria-describedby={problem === undefined ? `${id}-range` : `${id}-range ${id}-refused`}
            aria-invalid={problem !== undefined ? true : undefined}
          />
          <p id={`${id}-range`} className="message">
            {describeTuningField(key)}
          </p>
          {problem !== undefined && (
            <p id={`${id}-refused`} className="message error" role="alert">
              {problem}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="layout-tuning">
      <Disclosure
        className="layout-tuning-toggle"
        heading="h3"
        headingRef={heading}
        open={open}
        onToggle={setOpen}
        label={TUNING_NAME}
        summary={
          <>
            <Icon name="chevron" size={16} className="cell-chevron" />
            {TUNING_NAME} <span className="layout-tuning-word">{tuningWord(view.tuning)}</span>
          </>
        }
      >
        <p className="prose">{TUNING_SENTENCE}</p>
        <div className="style-field">
          <span className="layout-tuning-label" aria-hidden="true">
            {GRID_LABEL}
          </span>
          <div className="style-control">
            <Select
              label={GRID_LABEL}
              value={view.tuning.grid ?? DEFAULT_TUNING.grid}
              onChange={(grid) => {
                if (isGrid(grid)) show(chooseGrid(view, grid))
              }}
            >
              {gridOptions().map(({ grid, label }) => (
                <option key={grid} value={grid}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {OWN_KEYS.map(field)}
        <fieldset className="layout-tuning-penalties">
          <legend>{PENALTY_LEGEND}</legend>
          <p className="message">{PENALTY_SENTENCE}</p>
          {PENALTY_KEYS.map(field)}
        </fieldset>
        <div className="toolbar">
          <Button disabled={!resettable(view)} onClick={reset}>
            {RESET_LABEL}
          </Button>
        </div>
        <p className="message error" role="alert" hidden={unsaved === null}>
          {unsaved}
        </p>
      </Disclosure>
    </div>
  )
}
