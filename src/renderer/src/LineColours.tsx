import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type JSX,
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
import Icon from './icons/Icon'
import Button from './kit/Button'
import TextInput from './kit/TextInput'
import { useSnapshot } from './useSnapshot'

// The project's line colours: what the feed publishes, what a person chose
// over it, and one default for the lines the feed leaves blank (A4-01,
// specs/018-colours).
//
// The app draws swatches beside names and nothing else. The picture is the
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
}

export default function LineColours({
  run,
  project,
  engine,
  inspect,
  disabled = false,
  busyNow,
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
  const [open, setOpen] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

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

  // Made once: it is a dependency of every open picker's dismissal effect,
  // and a fresh closure per render would re-subscribe the document's
  // listeners on every frame of a drag.
  const closePicker = useCallback(() => setOpen(null), [])

  const change = (next: Palette): void => {
    setPalette(next)
    schedule(next)
  }
  // A button that removes the last thing it had to remove disables itself,
  // and Chromium blurs a disabled element; the heading is where focus goes
  // so a screen reader stays in the panel (A3-04 learned this).
  const changeAndKeepFocus = (next: Palette): void => {
    change(next)
    headingRef.current?.focus()
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
    <section className="line-colours" aria-labelledby="line-colours-heading" aria-busy={busy}>
      <h2 id="line-colours-heading" tabIndex={-1} ref={headingRef}>
        Line colours
      </h2>
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
            open={open === DEFAULT_ROW}
            onToggle={() => setOpen(open === DEFAULT_ROW ? null : DEFAULT_ROW)}
            onPick={(hex) => change(withDefault(palette, hex))}
            onDone={closePicker}
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
                  open={open === line.label}
                  onToggle={() => setOpen(open === line.label ? null : line.label)}
                  onPick={(hex) => change(withOverride(palette, line.label, hex))}
                  onDone={closePicker}
                  onReset={() => changeAndKeepFocus(withoutOverride(palette, line.label))}
                />
              ))}
            </ul>
          )}
          <div className="toolbar">
            <Button
              disabled={nothingToReset}
              onClick={() => {
                setOpen(null)
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

/** The default row's key in the one-picker-at-a-time state; no line can be called this. */
const DEFAULT_ROW = ''

/**
 * A picker stays open until it is dismissed: a click outside its row, or
 * Escape. It used to close on the first colour it was given, which is the
 * first pointer event the square or the slider sees - so dragging through a
 * hue, which is what the picker is for, ended the moment it began (issue
 * 87). Applying a colour and dismissing the picker are two different
 * things now.
 *
 * The row, not the picker, is what counts as inside: the toggle that
 * revealed it sits beside it, and a click on that is its own business. The
 * dismissal is on the click and not the press, and a gesture that began
 * inside the row is a colour however far outside it ends; both are
 * explained where they are done, below.
 */
function useDismiss(
  open: boolean,
  row: RefObject<HTMLElement | null>,
  toggle: RefObject<HTMLElement | null>,
  dismiss: () => void,
): void {
  useEffect(() => {
    if (!open) return undefined
    // What the press that is under way began as. Read and cleared by the
    // click it belongs to, so a gesture cannot speak for the next one: a
    // press with no click (a right-click, a cancelled touch) and a click
    // with no press (Enter on a control elsewhere, a screen reader's own
    // activation) would otherwise be judged by whoever pressed last.
    let began = false
    let hadFocus = false
    const inside = (target: EventTarget | null): boolean =>
      target instanceof Node && row.current?.contains(target) === true
    const leave = (handBack: boolean): void => {
      if (handBack) toggle.current?.focus()
      dismiss()
    }
    const onPointerDown = (event: PointerEvent): void => {
      began = inside(event.target)
      // Asked now rather than at the click: the press has already moved
      // focus by then, so this is the only moment that can say whether the
      // picker held it.
      hadFocus = row.current?.contains(document.activeElement) === true
    }
    const onClick = (event: MouseEvent): void => {
      const startedInside = began
      const held = hadFocus
      began = false
      hadFocus = false
      // A drag that starts in the picker and ends outside it is a colour,
      // not a dismissal.
      if (startedInside || inside(event.target)) return
      // Hand focus back only if the press put it nowhere. A press on
      // another control has already taken focus and it is theirs; a press
      // on prose or a margin leaves it on the body, which is where a
      // screen reader would be stranded when the picker goes.
      const active = document.activeElement
      leave(held && (active === null || active === document.body))
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      leave(row.current?.contains(document.activeElement) === true)
    }
    // The click, not the press. Dismissing on the press takes this row's
    // picker out of the flow before the button is released, and everything
    // below it moves up by the picker's height - so the click is delivered
    // to the nearest common ancestor of where the press began and where it
    // ended, and the button a person pressed never hears it. One press on
    // another row's Choose then did nothing at all.
    //
    // Capture, so the picker is dismissed before anything in the row that
    // is being pressed acts on it; the click still reaches its own target,
    // which is what makes the press count.
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, row, toggle, dismiss])
}

function DefaultColour({
  colour,
  open,
  onToggle,
  onPick,
  onDone,
}: {
  colour: string
  open: boolean
  onToggle: () => void
  onPick: (hex: string) => void
  onDone: () => void
}): JSX.Element {
  const panelId = useId()
  const chooseRef = useRef<HTMLElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  useDismiss(open, rowRef, chooseRef, onDone)
  return (
    <div className="line-row-group" ref={rowRef}>
      <div className="line-row">
        <span className="swatch" style={swatch(colour)} aria-hidden="true" />
        <span className="line-name">Lines with no colour in the feed</span>
        <span className="line-source">drawn in {colour}</span>
        <Button
          ref={chooseRef}
          aria-expanded={open}
          /* Only while it is there: a control named by aria-controls must exist. */
          aria-controls={open ? panelId : undefined}
          aria-label="Choose the colour of lines the feed leaves uncoloured"
          onClick={onToggle}
        >
          <Icon name="edit" />
          Choose
        </Button>
      </div>
      {open && (
        <ColourPicker
          id={panelId}
          name="Colour for lines the feed leaves uncoloured"
          colour={colour}
          onPick={onPick}
          onDone={() => {
            // The picker goes with the press, so focus goes back to the
            // control that revealed it, as the rename form's does. Moved
            // before the parent unmounts it, or focus would fall to the body.
            chooseRef.current?.focus()
            onDone()
          }}
        />
      )}
    </div>
  )
}

function LineRow({
  line,
  shown,
  overridden,
  open,
  onToggle,
  onPick,
  onDone,
  onReset,
}: {
  line: Line
  shown: Shown
  overridden: boolean
  open: boolean
  onToggle: () => void
  onPick: (hex: string) => void
  onDone: () => void
  onReset: () => void
}): JSX.Element {
  const panelId = useId()
  const chooseRef = useRef<HTMLElement>(null)
  const rowRef = useRef<HTMLLIElement>(null)
  useDismiss(open, rowRef, chooseRef, onDone)
  return (
    <li className="line-row-group" ref={rowRef}>
      <div className="line-row">
        <span className="swatch" style={swatch(shown.color)} aria-hidden="true" />
        <span className="line-name">{line.label}</span>
        <span className="line-feed">{feedWords(line)}</span>
        <span className="line-source">{sourceWords(shown)}</span>
        <Button
          ref={chooseRef}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-label={`Choose the colour of line ${line.label}`}
          onClick={onToggle}
        >
          <Icon name="edit" />
          Choose
        </Button>
        <Button
          disabled={!overridden}
          aria-label={
            line.feed === null
              ? `Reset line ${line.label} to the default colour`
              : `Reset line ${line.label} to the colour in the feed`
          }
          onClick={onReset}
        >
          Reset
        </Button>
      </div>
      {open && (
        <ColourPicker
          id={panelId}
          name={`Colour for line ${line.label}`}
          colour={shown.color}
          onPick={onPick}
          onDone={() => {
            // The picker goes with the press, so focus goes back to the
            // control that revealed it, as the rename form's does. Moved
            // before the parent unmounts it, or focus would fall to the body.
            chooseRef.current?.focus()
            onDone()
          }}
        />
      )}
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
  id,
  name,
  colour,
  onPick,
  onDone,
}: {
  id: string
  name: string
  colour: string
  onPick: (hex: string) => void
  onDone: () => void
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
    <div id={id} className="colour-picker" role="group" aria-label={name}>
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
        </div>
      </form>
    </div>
  )
}
