import { useEffect, useId, useRef, useState, type JSX } from 'react'
import { sameTuning } from '../../shared/project/helpers'
import {
  DEFAULT_TUNING,
  PENALTY_KEYS,
  type ProjectRecord,
  type ProjectTuning,
  type TuningKey,
} from '../../shared/project/types'
import { isGrid } from '../../shared/project/validate'
import Icon from './icons/Icon'
import { useFocusHandback } from './focusHandback'
import Button from './kit/Button'
import Disclosure from './kit/Disclosure'
import Select from './kit/Select'
import TextInput from './kit/TextInput'
import { PUT_BACK_TUNING, TUNING_RESET_SAID } from './putBackWords'
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
  putBackTuning,
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
// focus when no Put back comes, not the toggle, where a reflexive Space
// would close the section a person is working in (cell 04's reason, A6-07).

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
  // Whether the last write was Reset's, with a tuning to put back (issue
  // 561): what the section's polite line says, set by Reset alone and
  // cleared by every other write and by a refusal, so the line is empty
  // as the section opens and does not fill because a run ended.
  // By the project it was said for, so a section handed another project
  // says nothing of this one's reset.
  const [resetSaid, setResetSaid] = useState<string | null>(null)

  // The tuning the last write asked for, and that write while its answer has
  // not come. The answers come back in the order the writes were sent (spec
  // 037, "The record session" in docs/ARCHITECTURE.md), so the last write's
  // answer is the last to arrive: a record that arrives before it, and is
  // not the one asked for, is an earlier write's answer, and showing it would
  // take a later field's number off the screen until its own answer put it
  // back.
  const latest = useRef<Promise<void> | null>(null)
  const asked = useRef<ProjectTuning>(view.tuning)
  // The record's tuning at this moment, for a refused write to go back to.
  const stored = useRef<ProjectTuning | undefined>(project.tuning)
  useEffect(() => {
    stored.current = project.tuning
  })

  // The record is what the section shows: a write that landed has written
  // it and the screen has read it back, so the two agree again.
  useEffect(() => {
    if (latest.current !== null && !sameTuning(project.tuning, asked.current)) return
    asked.current = project.tuning ?? {}
    setView((current) => tuningViewOf(project.tuning, current))
  }, [project.id, project.tuning])

  const write = (next: ProjectTuning): void => {
    asked.current = next
    setUnsaved(null)
    setResetSaid(null)
    const mine = onChange(next)
      .catch((reason: unknown) => {
        // Nothing was kept, so the fields go back to the record and say why.
        asked.current = stored.current ?? {}
        setView(tuningViewOf(stored.current))
        setUnsaved(notSaved(reason))
        setResetSaid(null)
      })
      .finally(() => {
        if (latest.current === mine) latest.current = null
      })
    latest.current = mine
  }

  const show = (next: TuningView): void => {
    setView(next)
    if (!sameTuning(next.tuning, view.tuning)) write(next.tuning)
  }

  const type = (key: TuningKey, text: string): void =>
    setView((current) => ({ ...current, drafts: { ...current.drafts, [key]: text } }))

  // The tuning the stored layout was made with, while the section shows
  // another (issue 561): derived from the record, so nothing is kept.
  const laid = putBackTuning(project, view.tuning)

  // Reset and Put back, each the way back from the other. A button that
  // removes the last thing it had to remove disables itself, and Chromium
  // blurs a disabled element; Put back goes as it is pressed. Whichever
  // held focus, it goes to the control that is there: Put back while it is
  // offered, else Reset while it can be pressed, else the section's heading,
  // never the toggle, where a reflexive Space would close the section
  // (A6-07). Watched on Put back being offered and on Reset being
  // pressable, so a write the store refuses later hands it on too
  // (`useFocusHandback`).
  const root = useRef<HTMLDivElement>(null)
  const resetRef = useRef<HTMLElement>(null)
  const putBackRef = useRef<HTMLElement>(null)
  useFocusHandback(
    root,
    () => {
      if (putBackRef.current !== null) return putBackRef.current
      const button = resetRef.current
      return button !== null && !button.hasAttribute('disabled') ? button : heading.current
    },
    `${laid !== null}/${resettable(view)}`,
  )
  const reset = (): void => {
    show(tuningViewOf({}))
    setResetSaid(putBackTuning(project, {}) !== null ? project.id : null)
  }
  // Written as any choice is, at once, and the cells below read as drawn
  // again because the tuning and the layout agree, not because anything ran.
  const putBack = (): void => {
    if (laid === null) return
    show(tuningViewOf(laid))
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
    <div className="layout-tuning" ref={root}>
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
        {/* The section's one polite line (issue 561), in the document before
            it has anything to say, as a live region must be: the reset's
            sentence from Reset's press while there is a tuning to put
            back, and nothing otherwise. */}
        <p className="message" role="status" aria-live="polite">
          {resetSaid === project.id && laid !== null ? TUNING_RESET_SAID : ''}
        </p>
        <div className="toolbar">
          <Button ref={resetRef} disabled={!resettable(view)} onClick={reset}>
            {RESET_LABEL}
          </Button>
          {laid !== null && (
            <Button ref={putBackRef} onClick={putBack}>
              {PUT_BACK_TUNING}
            </Button>
          )}
        </div>
        <p className="message error" role="alert" hidden={unsaved === null}>
          {unsaved}
        </p>
      </Disclosure>
    </div>
  )
}
