import { useEffect, useId, useMemo, useRef, useState, type JSX, type RefObject } from 'react'
import type { EngineState } from '../../shared/engine'
import {
  isStyleChoice,
  sameStyle,
  type ChoiceKey,
  type FigureKey,
  type ProjectRecord,
  type ProjectStyle,
} from '../../shared/project'
import { REDRAW_DELAY } from './colours'
import { debounce } from './debounce'
import type { LayoutRun as Run } from './engine/layoutRun'
import Button from './kit/Button'
import TextInput from './kit/TextInput'
import { chooseValue, type Look } from './looks'
import { ChoiceSelect, LookSelect } from './StyleLooks'
import {
  chooseIn,
  commitDrafts,
  describeField,
  draftsOf,
  drawable,
  FRAME_SENTENCE,
  nextStyleStep,
  resettable,
  STYLE_FIELDS,
  TICK_SENTENCE,
  TRAIL_SENTENCE,
  TRAIN_FIELDS,
  TRAINS_LEGEND,
  TRAINS_SENTENCE,
  UNIT_SENTENCE,
  viewOf,
  type View,
} from './styleRules'
import { usePutBack } from './usePutBack'
import { useSnapshot } from './useSnapshot'

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
// (`commitDrafts`). A commit is a redraw, debounced and run through the same
// path a colour change uses, and nothing is written to the record until the
// map has been drawn with it (A4-01's rule), so a cancelled or failed build
// leaves the record alone and the panel goes back to it.
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
}

/** What the section is called, as the name of its region. */
const NAME = 'Sizes'

export default function StyleFields({
  run,
  project,
  engine,
  disabled = false,
  busyNow,
  handback,
}: Props): JSX.Element {
  const { state: runState, restyled } = useSnapshot(run)
  const running = runState === 'running'
  // Something else is reading or rewriting the project's page. Nothing here
  // is disabled for it: a change made now waits and builds once the way is
  // clear, so no control disables itself under a person's hands and no
  // change is lost. `aria-busy` says a build is going; `commit` does the
  // waiting.
  const busy = disabled || running
  const ids = useId()

  const [view, setView] = useState<View>(() => viewOf(project.style))

  // The debounce, made once: two fields left in quick succession are one
  // map build. The current project, engine and run are read through a ref,
  // so the waiting call is never the one from three renders ago.
  const commitRef = useRef<(next: ProjectStyle) => void>(() => undefined)
  const schedule = useMemo(
    () => debounce((next: ProjectStyle) => commitRef.current(next), REDRAW_DELAY),
    [],
  )
  // A figure committed and seen on screen is not lost to a screen that goes
  // inside the delay: the build is the project's, as a run is, and carries
  // on without this view.
  useEffect(() => () => schedule.flush(), [schedule])

  // Whether this panel's own redraw is going, for the effect below to read
  // without being re-run when it ends: it must not reset the panel to a
  // record that has not been read back yet, which still holds the old sizes.
  const drawing = useRef(false)
  useEffect(() => {
    drawing.current = running && restyled
  })

  // The record is what the panel shows: a build that finished has written it
  // and the screen has read it back, so the two agree again. A record that
  // arrives while a commit is still waiting, or while its own build goes
  // (a rename is enough to bring one), is not allowed to throw the sizes
  // off the screen.
  useEffect(() => {
    if (schedule.pending || drawing.current) return
    setView((current) => viewOf(project.style, current))
  }, [project.id, project.style, schedule])

  // A build that stopped wrote nothing, so the sizes on screen must go back
  // to the record's; the run's own panel says why. A stop stops everything:
  // a change made while the build ran is waiting on the same timer, and
  // letting it through would build sizes a person had just been told the
  // project did not keep.
  //
  // **Only at the moment the run stops** (`usePutBack`, issue 360), not for
  // as long as it stays stopped. The run keeps its failed or cancelled state
  // until the next one starts, and a record written for another reason - a
  // rename, an export option - is a new `project.style` reference: acting on
  // that would snap back, and cancel, a size committed afterwards and waiting
  // for an export to let go of the page.
  usePutBack(runState, restyled, () => {
    schedule.cancel()
    setView(viewOf(project.style))
  })

  const commit = (next: ProjectStyle): void => {
    // `busy` is what the last render saw; the run's own state is what is
    // true at this moment, and a run can start between the two.
    const step = nextStyleStep(
      next,
      project.style,
      busy || run.snapshot.state === 'running' || busyNow?.() === true,
    )
    // A layout, a rebuild or an export is reading the page this would
    // rewrite. Wait rather than refuse: the same delay again, and again,
    // until the way is clear.
    if (step === 'wait') schedule(next)
    else if (step === 'build') run.restyle(project, engine, next)
  }
  useEffect(() => {
    commitRef.current = commit
  })

  const type = (key: FigureKey, text: string): void =>
    setView((current) => ({ ...current, drafts: { ...current.drafts, [key]: text } }))

  const commitField = (key: FigureKey): void => {
    const done = commitDrafts(view.style, view.drafts, key)
    setView({ style: done.style, drafts: done.drafts, problems: done.problems })
    if (!sameStyle(done.style, view.style)) schedule(done.style)
  }

  // A look, a marker or the face chosen (issue 391): shown at once and drawn
  // after the same delay as a figure, so a look and a marker chosen one after
  // the other are one map build. A style that still holds a number written
  // by hand out of range is not drawn, as `commitDrafts` draws nothing then:
  // the choice waits on the screen and goes with the fix.
  const show = (next: View): void => {
    setView(next)
    if (!sameStyle(next.style, view.style) && drawable(next.style)) schedule(next.style)
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
    schedule({})
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
