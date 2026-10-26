import { useId, useRef, useState, type JSX, type RefObject } from 'react'
import type { EngineState } from '../../shared/engine'
import {
  type ChoiceKey,
  type FigureKey,
  type ProjectRecord,
  type ProjectStyle,
} from '../../shared/project/types'
import { isStyleChoice } from '../../shared/project/validate'
import { sameStyle } from './record'
import { REDRAW_DELAY } from './colours'
import type { LayoutRun as Run, RunSnapshot } from './engine/layoutRun'
import Button from './kit/Button'
import TextInput from './kit/TextInput'
import { chooseValue, type Look } from './looks'
import { useCheapEdit } from './notebook/useCheapEdit'
import { ChoiceSelect, LookSelect } from './StyleLooks'
import {
  chooseIn,
  commitDrafts,
  describeField,
  draftsOf,
  drawable,
  FRAME_SENTENCE,
  resettable,
  STYLE_FIELDS,
  TICK_SENTENCE,
  TRAIL_SENTENCE,
  TRAIN_FIELDS,
  TRAINS_LEGEND,
  TRAINS_SENTENCE,
  UNIT_SENTENCE,
  viewForRecord,
  viewOf,
  type View,
} from './styleRules'

// The map's sizes: line width and gap, the two station radii and the
// station's outline, the size and distance of the names, and the margin
// (issue 350, ADR-049, ADR-050).
//
// The app draws a field for each and nothing else. The picture is the
// engine's page, and the engine draws it: this panel sends map.build the
// numbers a person set, in the engine's names, and the map and every export
// of it follow. A size is a render, never a layout: the stored layout is
// drawn again and the stations do not move (ADR-023). The labels a size
// re-places are the engine's, and the drawing's box moves with them.
//
// A field commits on blur or Enter, not on each keystroke, because a
// half-typed "1" is a line width of 1. Nothing is sent that the engine would
// refuse: a figure outside its range, or an interchange radius below the
// station radius, is refused beside the field in the engine's own sentence
// (`commitDrafts`). A commit is a cheap edit (`useCheapEdit`, issue 490):
// drawn after the delay, held while the page is held, and written to the
// record only once the map has been drawn with it (A4-01's rule), so a
// cancelled or failed build leaves the record alone and the panel goes back
// to it.
//
// Since issue 391 (spec 034) the group holds the rest of how the map is
// drawn, in this order: the engine's named looks at its head (`LookSelect`),
// the eight sizes, the station's and the interchange's marker and the label
// face (`ChoiceSelect`), and the trains' dot size and trail, which are fields
// in the sizes' pattern. Every one of them is the same cheap edit by the
// same path: shown at once, drawn once after the delay, written once the map
// carries it. One Reset clears them all and leaves the theme.

interface Props {
  run: Run
  project: ProjectRecord
  engine: EngineState | null
  /** True while something else, such as an export, is reading the project's page. */
  disabled?: boolean
  /**
   * The same question at this instant rather than at the last render. An
   * export can start inside the debounce window, and a rendered prop is one
   * render behind it: a build begun in that gap would rewrite the page the
   * capture is reading, which is the one thing a run and an export may
   * never do to each other (.claude/rules/main.md).
   */
  busyNow?: () => boolean
  /**
   * Where focus goes when a control that held it is disabled: cell 04's own
   * heading, not the cell's toggle - a reflexive Space after "Reset to the
   * engine's sizes" would collapse the cell the person is working in. Required,
   * because a panel with nowhere to hand focus back to is the A6-07 defect
   * itself: Chromium blurs a disabled element and focus falls to the body.
   */
  handback: RefObject<HTMLElement | null>
  /**
   * True from a run's end until the record it wrote has been read back
   * (A5.5-22). A size committed in that beat waits for it, as a colour and a
   * line option do: every draw carries the line options, and one drawn from
   * the record before that run could put a line it hid back on the map
   * (issue 399).
   */
  settling?: boolean
}

/** What the section is called, as the name of its region. */
const NAME = 'Sizes'

/** A redraw for sizes: this section's own kind of run. */
const ownRun = (snapshot: RunSnapshot): boolean => snapshot.restyled

export default function StyleFields({
  run,
  project,
  engine,
  disabled = false,
  busyNow,
  handback,
  settling = false,
}: Props): JSX.Element {
  const ids = useId()

  const [view, setView] = useState<View>(() => viewOf(project.style))

  // The record is what the panel shows: a build that finished has written it
  // and the screen has read it back, so the two agree again. The hook does
  // not offer it while a size is waiting or this panel's own redraw goes (a
  // rename is enough to bring one). Nor is a choice that is waiting for a
  // number written by hand to be mended taken off the screen
  // (`viewForRecord`): it has not been drawn, so the record cannot hold it
  // yet.
  const shownFor = useRef(project.id)
  const edit = useCheapEdit<ProjectStyle>({
    run,
    project,
    own: ownRun,
    stored: (record) => record.style,
    fields: [project.style],
    same: sameStyle,
    engine,
    draw: (record, now, next) => run.restyle(record, now, next),
    delay: REDRAW_DELAY,
    // While an export reads the page, or the record a finished run wrote
    // is read back: every draw carries the line options, and one drawn from
    // the record before that run could put a line it hid back on the map
    // (issue 399).
    held: disabled || settling,
    busyNow,
    adopt: (style, record) => {
      const sameProject = shownFor.current === record.id
      shownFor.current = record.id
      setView((current) => viewForRecord(style, current, sameProject))
    },
    // A build that stopped wrote nothing, so the sizes on screen go back to
    // the record's; the run's own panel says why.
    putBack: (record) => setView(viewOf(record.style)),
  })
  const running = edit.snapshot.state === 'running'
  // Something else is reading or rewriting the project's page. Nothing here
  // is disabled for it: a change made now waits and builds once the way is
  // clear, so no control disables itself under a person's hands and no
  // change is lost. `aria-busy` says a build is going; the hook does the
  // waiting.
  const busy = disabled || running

  const type = (key: FigureKey, text: string): void =>
    setView((current) => ({ ...current, drafts: { ...current.drafts, [key]: text } }))

  const commitField = (key: FigureKey): void => {
    const done = commitDrafts(view.style, view.drafts, key)
    setView({ style: done.style, drafts: done.drafts, problems: done.problems })
    if (!sameStyle(done.style, view.style)) edit.change(done.style)
  }

  // A look, a marker or the face chosen (issue 391): shown at once and drawn
  // after the same delay as a figure, so a look and a marker chosen one after
  // the other are one map build. A style that still holds a number written
  // by hand out of range is not drawn, as `commitDrafts` draws nothing then:
  // the choice waits on the screen and goes with the fix.
  const show = (next: View): void => {
    setView(next)
    if (!sameStyle(next.style, view.style) && drawable(next.style)) edit.change(next.style)
  }

  const chooseLook = (value: string, looks: readonly Look[]): void => {
    const next = chooseValue(view, looks, value)
    if (next !== null) show(next)
  }

  const choose = (key: ChoiceKey, value: string): void => {
    if (isStyleChoice(key, value)) show(chooseIn(view, key, value))
  }

  // A button that removes the last thing it had to remove disables itself,
  // and Chromium blurs a disabled element; the cell's heading is where
  // focus goes so a screen reader stays in the cell (A3-04 learned this).
  const reset = (): void => {
    setView({ style: {}, drafts: draftsOf({}), problems: {} })
    edit.change({})
    handback.current?.focus()
  }

  // A field in the sizes' pattern, a size's or a train's: its name, the
  // control, what it takes, and the engine's sentence when it was refused.
  const field = (key: FigureKey, label: string): JSX.Element => {
    const id = `${ids}-${key}`
    const problem = view.problems[key]
    // The margin's sentence about the frame, the trail's about where it is
    // not drawn: said beside the field, and in its description.
    const note = key === 'padding' ? FRAME_SENTENCE : key === 'trail' ? TRAIL_SENTENCE : null
    return (
      <div className="style-field" key={key}>
        <label htmlFor={id}>{label}</label>
        <div
          className="style-control"
          onBlur={() => commitField(key)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            commitField(key)
          }}
        >
          <TextInput
            id={id}
            value={view.drafts[key]}
            onChange={(text) => type(key, text)}
            spellCheck={false}
            aria-describedby={[
              `${id}-range`,
              note === null ? null : `${id}-note`,
              problem === undefined ? null : `${id}-refused`,
            ]
              .filter((described) => described !== null)
              .join(' ')}
            aria-invalid={problem !== undefined ? true : undefined}
          />
          <p id={`${id}-range`} className="message">
            {describeField(key)}
          </p>
          {note !== null && (
            <p id={`${id}-note`} className="message">
              {note}
            </p>
          )}
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
    <section className="style-fields" aria-label={NAME} aria-busy={busy}>
      <LookSelect style={view.style} engine={engine} onChoose={chooseLook} />
      <p className="prose">{UNIT_SENTENCE}</p>
      {STYLE_FIELDS.map(({ key, label }) => field(key, label))}
      <ChoiceSelect
        choice="stationShape"
        style={view.style}
        sentence={TICK_SENTENCE}
        onChoose={choose}
      />
      <ChoiceSelect choice="interchangeShape" style={view.style} onChoose={choose} />
      <ChoiceSelect choice="labelFont" style={view.style} onChoose={choose} />
      <fieldset className="style-trains">
        <legend>{TRAINS_LEGEND}</legend>
        <p className="message">{TRAINS_SENTENCE}</p>
        {TRAIN_FIELDS.map(({ key, label }) => field(key, label))}
      </fieldset>
      <div className="toolbar">
        <Button disabled={!resettable(view)} onClick={reset}>
          Reset to the engine’s sizes
        </Button>
      </div>
    </section>
  )
}
