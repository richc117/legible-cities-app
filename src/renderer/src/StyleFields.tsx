import { useEffect, useId, useMemo, useRef, useState, type JSX, type RefObject } from 'react'
import type { EngineState } from '../../shared/engine'
import {
  sameStyle,
  STYLE_KEYS,
  styleIsSet,
  styleRefusals,
  type ProjectRecord,
  type ProjectStyle,
  type StyleKey,
} from '../../shared/project'
import { REDRAW_DELAY } from './colours'
import { debounce } from './debounce'
import type { LayoutRun as Run } from './engine/layoutRun'
import Button from './kit/Button'
import TextInput from './kit/TextInput'
import {
  commitDrafts,
  describeField,
  draftsOf,
  FRAME_SENTENCE,
  isPending,
  nextStyleStep,
  STYLE_FIELDS,
  UNIT_SENTENCE,
  type Drafts,
  type Problems,
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

/** What the panel shows: the style it is drawing, the fields as typed, and what was refused. */
interface View {
  style: ProjectStyle
  drafts: Drafts
  problems: Problems
}

/**
 * The panel showing a record's style. A figure that was refused and is still
 * waiting where it was typed is kept through it, with its sentence: a redraw
 * finishing elsewhere in the cell must not take a person's half-mended
 * number away.
 */
function viewOf(style: ProjectStyle, previous?: View): View {
  const drafts = draftsOf(style)
  // A record that holds a number the engine would refuse shows it refused.
  const problems: Problems = styleRefusals(style)
  if (previous !== undefined) {
    for (const key of STYLE_KEYS) {
      if (previous.problems[key] === undefined || !isPending(style, previous.drafts, key)) continue
      drafts[key] = previous.drafts[key]
      problems[key] = previous.problems[key]
    }
  }
  return { style, drafts, problems }
}

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

  const type = (key: StyleKey, text: string): void =>
    setView((current) => ({ ...current, drafts: { ...current.drafts, [key]: text } }))

  const commitField = (key: StyleKey): void => {
    const done = commitDrafts(view.style, view.drafts, key)
    setView({ style: done.style, drafts: done.drafts, problems: done.problems })
    if (!sameStyle(done.style, view.style)) schedule(done.style)
  }

  // A button that removes the last thing it had to remove disables itself,
  // and Chromium blurs a disabled element; the cell's heading is where
  // focus goes so a screen reader stays in the cell (A3-04 learned this).
  const reset = (): void => {
    setView({ style: {}, drafts: draftsOf({}), problems: {} })
    schedule({})
    handback.current?.focus()
  }

  const nothingToReset =
    !styleIsSet(view.style) && !STYLE_KEYS.some((key) => isPending(view.style, view.drafts, key))

  return (
    <section className="style-fields" aria-label={NAME} aria-busy={busy}>
      <p className="prose">{UNIT_SENTENCE}</p>
      {STYLE_FIELDS.map(({ key, label }) => {
        const id = `${ids}-${key}`
        const problem = view.problems[key]
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
                  key === 'padding' ? `${id}-frame` : null,
                  problem === undefined ? null : `${id}-refused`,
                ]
                  .filter((described) => described !== null)
                  .join(' ')}
                aria-invalid={problem !== undefined ? true : undefined}
              />
              <p id={`${id}-range`} className="message">
                {describeField(key)}
              </p>
              {key === 'padding' && (
                <p id={`${id}-frame`} className="message">
                  {FRAME_SENTENCE}
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
      })}
      <div className="toolbar">
        <Button disabled={nothingToReset} onClick={reset}>
          Reset to the engine’s sizes
        </Button>
      </div>
    </section>
  )
}
