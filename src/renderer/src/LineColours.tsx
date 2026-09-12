import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type JSX } from 'react'
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
  readHex,
  resetAll,
  samePalette,
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
}

export default function LineColours({
  run,
  project,
  engine,
  inspect,
  disabled = false,
}: Props): JSX.Element {
  const ready = engine?.state === 'ready'
  const { state: runState, recoloured } = useSnapshot(run)
  const running = runState === 'running'
  // Something else is reading or rewriting the project's page. A change
  // made now is not refused: it waits, and builds once the way is clear,
  // so no control has to disable itself under a person's hands.
  const busy = disabled || running

  const [state, setState] = useState<State>({ status: 'waiting' })
  const [palette, setPalette] = useState<Palette>(() => paletteOf(project))
  const [open, setOpen] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

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
  // it and the view has read it back, so the two agree again.
  useEffect(() => {
    setPalette({ colors: project.colors, defaultColor: project.defaultColor })
  }, [project.id, project.colors, project.defaultColor])

  // A build that stopped wrote nothing, so the colours on screen must go
  // back to the record's; the run's own panel says why.
  useEffect(() => {
    if (recoloured && (runState === 'cancelled' || runState === 'failed')) {
      setPalette({ colors: project.colors, defaultColor: project.defaultColor })
    }
  }, [runState, recoloured, project.colors, project.defaultColor])

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
  const commit = (next: Palette): void => {
    if (samePalette(next, paletteOf(project))) return
    // A layout, a rebuild or an export is reading the page this would
    // rewrite. Wait rather than refuse: the same delay again, and again,
    // until the way is clear.
    if (busy) {
      schedule(next)
      return
    }
    run.recolour(project, engine, next)
  }
  useEffect(() => {
    commitRef.current = commit
  })

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
            busy={busy}
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
                  busy={busy}
                  onToggle={() => setOpen(open === line.label ? null : line.label)}
                  onPick={(hex) => change(withOverride(palette, line.label, hex))}
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

function DefaultColour({
  colour,
  open,
  onToggle,
  onPick,
  busy,
}: {
  colour: string
  open: boolean
  onToggle: () => void
  onPick: (hex: string) => void
  busy: boolean
}): JSX.Element {
  const panelId = useId()
  return (
    <div className="line-row-group">
      <div className="line-row">
        <span className="swatch" style={swatch(colour)} aria-hidden="true" />
        <span className="line-name">Lines with no colour in the feed</span>
        <span className="line-source">drawn in {colour}</span>
        <Button
          aria-expanded={open}
          aria-controls={panelId}
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
          busy={busy}
          onPick={onPick}
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
  busy,
  onToggle,
  onPick,
  onReset,
}: {
  line: Line
  shown: Shown
  overridden: boolean
  open: boolean
  busy: boolean
  onToggle: () => void
  onPick: (hex: string) => void
  onReset: () => void
}): JSX.Element {
  const panelId = useId()
  return (
    <li className="line-row-group">
      <div className="line-row">
        <span className="swatch" style={swatch(shown.color)} aria-hidden="true" />
        <span className="line-name">{line.label}</span>
        <span className="line-feed">{feedWords(line)}</span>
        <span className="line-source">{sourceWords(shown)}</span>
        <Button
          aria-expanded={open}
          aria-controls={panelId}
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
          busy={busy}
          onPick={onPick}
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
 * While something else is reading the project's page the picker is inert
 * rather than removed: a control that vanishes or disables itself under a
 * person's hands takes the focus with it.
 */
function ColourPicker({
  id,
  name,
  colour,
  busy,
  onPick,
}: {
  id: string
  name: string
  colour: string
  busy: boolean
  onPick: (hex: string) => void
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
  }

  return (
    <div
      id={id}
      className="colour-picker"
      role="group"
      aria-label={name}
      aria-disabled={busy || undefined}
    >
      <HexColorPicker color={colour} onChange={(next) => (busy ? undefined : onPick(next))} />
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
