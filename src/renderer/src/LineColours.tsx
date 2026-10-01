import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type JSX,
  type ReactNode,
  type RefObject,
} from 'react'
import { HexColorPicker } from 'react-colorful'
import type { EngineState } from '../../shared/engine'
import { withoutPaths } from '../../shared/engine'
import type { Inspection } from '../../shared/protocol'
import { paletteOf, type Palette, type ProjectRecord } from '../../shared/project'
import {
  feedWords,
  hasOverride,
  isReset,
  linesOf,
  nextStep,
  readHex,
  resetAll,
  shownColour,
  sourceWords,
  withDefault,
  withOverride,
  withoutOverride,
  REDRAW_DELAY,
  type Line,
  type Shown,
} from './colours'
import { debounce } from './debounce'
import type { LayoutRun as Run } from './engine/layoutRun'
import Button from './kit/Button'
import TextInput from './kit/TextInput'
import { useSnapshot } from './useSnapshot'

// The project's line colours: what the feed publishes, what a person chose
// over it, and one default for the lines the feed leaves blank (A4-01,
// specs/018-colours).
//
// The app draws a colour chip beside each name and nothing else. The picture is the
// engine's page, and the engine resolves the colours: this panel sends
// map.build the same two fields the CLI does and the page's map, chips and
// time chart all move together because the engine resolved them once
// (render.line_colors, E06). A colour is a render, never a layout: the
// stored layout is read and the stations do not move (ADR-023).
//
// Nothing is written until the map has been drawn, as a chosen day is not
// (A3-04): a cancelled or failed build leaves the record alone and the
// panel goes back to it.

/** A line's own colour is data, not a token: it is drawn from the record, never from a stylesheet. */
const swatch = (colour: string): { background: string } => ({ background: colour })

type State =
  | { status: 'waiting' }
  | { status: 'ready'; inspection: Inspection }
  | { status: 'failed'; message: string }

interface Props {
  run: Run
  project: ProjectRecord
  engine: EngineState | null
  /** The feed as the engine read it; the Inspect view's cache answers, so nothing is asked twice. */
  inspect: (key: string) => Promise<Inspection>
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
   * Where focus goes when a control that held it is disabled or removed:
   * cell 05's own heading, which is the one thing above both sections that
   * takes focus and does nothing with it. Not the heading below, which
   * names this section but is not the cell's, and not the cell's toggle -
   * a reflexive Space after "Reset every line" would collapse the cell the
   * person is working in (A5.5-18).
   *
   * Required, because a panel with nowhere to hand focus back to is the
   * A6-07 defect itself - Chromium blurs a disabled element and focus falls
   * to the body - and a shape that cannot say it cannot ship it.
   */
  handback: RefObject<HTMLElement | null>
}

/** What the section is called, as its heading and as the name of its region. */
const NAME = 'Line colours'

export default function LineColours({
  run,
  project,
  engine,
  inspect,
  disabled = false,
  busyNow,
  handback,
}: Props): JSX.Element {
  const ready = engine?.state === 'ready'
  const { state: runState, recoloured } = useSnapshot(run)
  const running = runState === 'running'
  // Something else is reading or rewriting the project's page. Nothing here
  // is disabled for it: a change made now waits and builds once the way is
  // clear, so no control disables itself under a person's hands and no
  // change is lost. `aria-busy` says a build is going; `commit` does the
  // waiting.
  const busy = disabled || running

  const [state, setState] = useState<State>({ status: 'waiting' })
  const [palette, setPalette] = useState<Palette>(() => paletteOf(project))
  const section = useRef<HTMLElement>(null)

  // The debounce, made once: a person dragging through a hue must not start
  // a map build per frame. The current project, engine and run are read
  // through a ref, so the waiting call is never the one from three renders
  // ago.
  const commitRef = useRef<(next: Palette) => void>(() => undefined)
  const schedule = useMemo(
    () => debounce((next: Palette) => commitRef.current(next), REDRAW_DELAY),
    [],
  )
  useEffect(() => () => schedule.cancel(), [schedule])

  useEffect(() => {
    if (!ready) {
      setState({ status: 'waiting' })
      return
    }
    let left = false
    inspect(project.feed).then(
      (inspection) => {
        if (!left) setState({ status: 'ready', inspection })
      },
      (error: unknown) => {
        if (left) return
        const reason = error as { data?: { hint?: string }; message?: string }
        setState({
          status: 'failed',
          message: withoutPaths(
            reason.data?.hint ?? reason.message ?? 'The feed could not be read.',
          ),
        })
      },
    )
    return () => {
      left = true
    }
  }, [ready, project.feed, inspect])

  // The record is what the panel shows: a build that finished has written
  // it and the view has read it back, so the two agree again. A record that
  // arrives while an edit is still waiting is not allowed to throw it off
  // the screen - the view refetches whenever any run finishes, and under a
  // pointer that would move the picker's thumb under the person's hand.
  useEffect(() => {
    if (schedule.pending) return
    setPalette({ colors: project.colors, defaultColor: project.defaultColor })
  }, [project.id, project.colors, project.defaultColor, schedule])

  // A build that stopped wrote nothing, so the colours on screen must go
  // back to the record's; the run's own panel says why. A stop stops
  // everything: a change made while the build ran is waiting on the same
  // timer, and letting it through would build the colours a person had
  // just been told the project did not keep.
  useEffect(() => {
    if (recoloured && (runState === 'cancelled' || runState === 'failed')) {
      schedule.cancel()
      setPalette({ colors: project.colors, defaultColor: project.defaultColor })
    }
  }, [runState, recoloured, project.colors, project.defaultColor, schedule])

  const commit = (next: Palette): void => {
    // `busy` is what the last render saw; the run's own state is what is
    // true at this moment, and a run can start between the two. Without it
    // a colour would be handed to a run that refuses it, silently.
    const step = nextStep(
      next,
      paletteOf(project),
      busy || run.snapshot.state === 'running' || busyNow?.() === true,
    )
    // A layout, a rebuild or an export is reading the page this would
    // rewrite. Wait rather than refuse: the same delay again, and again,
    // until the way is clear.
    if (step === 'wait') schedule(next)
    else if (step === 'build') run.recolour(project, engine, next)
  }
  useEffect(() => {
    commitRef.current = commit
  })

  // Closing every open panel, through the elements: the platform owns
  // whether a panel is open, and a press of a button elsewhere is a click
  // that light-dismisses it, but a keyboard press is not (issue 284).
  const closePanels = (): void => {
    section.current
      ?.querySelectorAll<HTMLElement>('.colour-popover:popover-open')
      .forEach((panel) => panel.hidePopover())
  }

  const change = (next: Palette): void => {
    setPalette(next)
    schedule(next)
  }
  // A button that removes the last thing it had to remove disables itself,
  // and Chromium blurs a disabled element; the cell's heading is where
  // focus goes so a screen reader stays in the cell (A3-04 learned this).
  const changeAndKeepFocus = (next: Palette): void => {
    change(next)
    handback.current?.focus()
  }

  const inspection = state.status === 'ready' ? state.inspection : null
  // The layout on screen was made with these; the record's own are what the
  // next layout will use, and may have moved since (A2-02).
  const mode = project.built?.mode ?? project.mode
  const agency = project.built === null ? project.agency : project.built.agency
  const lines = useMemo(
    () => (inspection === null ? [] : linesOf(inspection, { mode, agency })),
    [inspection, mode, agency],
  )
  const nothingToReset = isReset(palette)

  return (
    <section
      ref={section}
      className="line-colours"
      aria-labelledby="line-colours-heading"
      aria-busy={busy}
    >
      {/* Cell 05 holds two sections, so the cell's own heading cannot name
          either of them: it says Lines, and a person reading down the cell
          has to be told where the colours end and the order begins. The
          heading is a level below the cell's, takes no focus of its own -
          the cell's heading is where focus is handed (A5.5-18) - and is
          what names the region. */}
      <h3 id="line-colours-heading">{NAME}</h3>
      <p className="prose">
        A line is drawn in the colour its feed publishes. Choose another here and the map, the chips
        over it and the time chart all follow. The stations do not move: the stored layout is drawn
        again, never laid out again.
      </p>
      {state.status === 'waiting' && (
        <p className="hint" role="status">
          {ready
            ? 'Reading the feed for its lines and their colours…'
            : 'The engine is not ready, so the feed cannot be read yet.'}
        </p>
      )}
      {state.status === 'failed' && (
        <p className="message error" role="alert">
          {state.message}
        </p>
      )}
      {inspection !== null && (
        <>
          <DefaultColour
            colour={palette.defaultColor}
            onPick={(hex) => change(withDefault(palette, hex))}
          />
          {lines.length === 0 ? (
            <p className="hint" role="status">
              This feed has no lines under {mode}
              {agency === null ? '' : ` for ${agency}`}.
            </p>
          ) : (
            <ul className="line-list" aria-label="Lines">
              {lines.map((line) => (
                <LineRow
                  key={line.label}
                  line={line}
                  shown={shownColour(line, palette)}
                  overridden={hasOverride(palette, line.label)}
                  onPick={(hex) => change(withOverride(palette, line.label, hex))}
                  onReset={() => change(withoutOverride(palette, line.label))}
                />
              ))}
            </ul>
          )}
          <div className="toolbar">
            <Button
              disabled={nothingToReset}
              onClick={() => {
                closePanels()
                changeAndKeepFocus(resetAll())
              }}
            >
              Reset every line
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

/**
 * The colour chip and the panel it opens, in one place for both kinds of row.
 *
 * The chip is a native button at the row's start, in the line's own colour:
 * the preview and the control in one (issue 284). A native button and not
 * the kit's, so the kit's inner-button trap (`.claude/rules/renderer.md`,
 * issue 121) does not arise. The panel is an auto popover anchored to it.
 *
 * What the platform does here is what a hand-written dismissal (issue 87's) used to do. An auto
 * popover is light-dismissed only when the press and the release both land
 * outside it, so a drag that begins in the square and ends on the map is a
 * colour and the panel stays (issue 87); a click outside closes it, Escape
 * closes it, and opening another row's chip closes this one. It is in the
 * top layer, so it is never clipped by the cell or hidden behind the pinned
 * band, and it takes nothing out of the flow, so the old reason to dismiss
 * on the click and not the press - a picker leaving the flow between press
 * and release moved the button being pressed - is gone with the flow.
 *
 * The panel is always in the document and its contents are mounted while it
 * is open. React follows the element, by its `beforetoggle` event, and
 * never drives it except to close it from a finished gesture.
 */
function ColourControl({
  label,
  colour,
  panelName,
  onPick,
  reset,
  children,
}: {
  label: string
  colour: string
  panelName: string
  onPick: (hex: string) => void
  /** Only a line that can have an override offers Reset. */
  reset?: { label: string; enabled: boolean; onReset: () => void }
  children: ReactNode
}): JSX.Element {
  const panelId = useId()
  // Whether this panel is showing, as the element last said. It lives here
  // and not in the parent so that it goes with the row: a popover removed
  // from the document sends no event, and a flag kept above would read
  // "open" for a row that came back closed (an engine restart, a change of
  // mode). Nothing above needs to know which is open: opening one closes
  // the others, which is the platform's.
  const [open, setOpen] = useState(false)
  const chip = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // A person saying they have finished: close the panel and go back to the
  // chip that opened it, as the rename form's does.
  const done = (): void => {
    if (panel.current?.matches(':popover-open') === true) panel.current.hidePopover()
    chip.current?.focus()
  }
  return (
    <>
      <div className="line-row">
        <button
          ref={chip}
          type="button"
          className="colour-chip"
          style={swatch(colour)}
          popoverTarget={panelId}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={label}
        />
        {children}
      </div>
      <div
        ref={panel}
        id={panelId}
        className="colour-popover"
        popover="auto"
        role="group"
        aria-label={panelName}
        // Mounted before the panel is shown, so its contents are there for
        // its first frame and the flip is decided on the box it will have,
        // not an empty one; unmounted only after it has gone. The platform
        // gives focus back to the chip when a panel closes with focus in it,
        // and it can only do that if the focused field is still there
        // when it looks.
        onBeforeToggle={(event) => {
          if (event.newState === 'open') setOpen(true)
        }}
        onToggle={(event) => {
          if (event.newState === 'closed') setOpen(false)
        }}
      >
        {open && (
          <ColourPicker
            colour={colour}
            onPick={onPick}
            onDone={done}
            reset={
              reset === undefined
                ? undefined
                : {
                    ...reset,
                    onReset: () => {
                      reset.onReset()
                      done()
                    },
                  }
            }
          />
        )}
      </div>
    </>
  )
}

function DefaultColour({
  colour,
  onPick,
}: {
  colour: string
  onPick: (hex: string) => void
}): JSX.Element {
  return (
    <div className="line-row-group">
      <ColourControl
        label="Choose the colour of lines the feed leaves uncoloured"
        colour={colour}
        panelName="Colour for lines the feed leaves uncoloured"
        onPick={onPick}
      >
        <span className="line-name">Lines with no colour in the feed</span>
        <span className="line-source">drawn in {colour}</span>
      </ColourControl>
    </div>
  )
}

function LineRow({
  line,
  shown,
  overridden,
  onPick,
  onReset,
}: {
  line: Line
  shown: Shown
  overridden: boolean
  onPick: (hex: string) => void
  onReset: () => void
}): JSX.Element {
  return (
    <li className="line-row-group">
      <ColourControl
        label={`Choose the colour of line ${line.label}`}
        colour={shown.color}
        panelName={`Colour for line ${line.label}`}
        onPick={onPick}
        reset={{
          label:
            line.feed === null
              ? `Reset line ${line.label} to the default colour`
              : `Reset line ${line.label} to the colour in the feed`,
          enabled: overridden,
          onReset,
        }}
      >
        <span className="line-name">{line.label}</span>
        <span className="line-feed">{feedWords(line)}</span>
        <span className="line-source">{sourceWords(shown)}</span>
      </ColourControl>
    </li>
  )
}

/**
 * One colour, two ways: the picker for a pointing device, and a typed hex
 * value for everything else. The picker is keyboard-operable in its own
 * right (its two areas are sliders that take the arrow keys), and the field
 * beside it is the path that needs no pointing device at all.
 *
 * `onPick` is every colour the picker is given, including each step of a
 * drag; `onDone` is a person saying they have finished, which only the
 * typed field's own button means. The two were one callback until issue 87,
 * and the row closed on the first colour - so a drag ended on the pointer
 * event that began it.
 *
 * It stays live while something else is reading the project's page. Turning
 * it off would take the focus with it, and refusing its changes would lose
 * a colour moved by an arrow key without a word; `commit` holds the change
 * instead and builds once the way is clear.
 */
function ColourPicker({
  colour,
  onPick,
  onDone,
  reset,
}: {
  colour: string
  onPick: (hex: string) => void
  onDone: () => void
  reset?: { label: string; enabled: boolean; onReset: () => void }
}): JSX.Element {
  const [text, setText] = useState(colour)
  const [message, setMessage] = useState<string | null>(null)
  const fieldId = useId()
  const messageId = useId()

  // The picker and the field show one colour: a drag moves the value, and
  // the field follows it.
  useEffect(() => {
    setText(colour)
    setMessage(null)
  }, [colour])

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const hex = readHex(text)
    if (hex === null) {
      setMessage('A colour is six hexadecimal digits, such as 0072bc.')
      return
    }
    setMessage(null)
    onPick(hex)
    onDone()
  }

  return (
    <div className="colour-picker">
      <HexColorPicker color={colour} onChange={onPick} />
      <form className="inline-form" noValidate onSubmit={submit}>
        <div className="field">
          <label htmlFor={fieldId}>Hex value</label>
          <TextInput
            id={fieldId}
            value={text}
            onChange={(value) => {
              setText(value)
              setMessage(null)
            }}
            spellCheck={false}
            aria-describedby={messageId}
            aria-invalid={message ? true : undefined}
          />
          <p id={messageId} className="message error">
            {message}
          </p>
        </div>
        <div className="actions">
          <Button variant="primary" type="submit">
            Use this colour
          </Button>
          {reset !== undefined && (
            <Button aria-label={reset.label} disabled={!reset.enabled} onClick={reset.onReset}>
              Reset
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}
