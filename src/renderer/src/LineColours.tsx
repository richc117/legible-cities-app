import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
} from 'react'
import type { EngineState } from '../../shared/engine'
import { withoutPaths } from '../../shared/engine'
import type { Inspection } from '../../shared/protocol'
import { paletteOf, type Palette, type ProjectRecord } from '../../shared/project'
import {
  feedWords,
  hasOverride,
  isReset,
  linesOf,
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
import { useColourPanel, type ColourPanelProps } from './ColourChip'
import type { LayoutRun as Run, RunSnapshot } from './engine/layoutRun'
import Button from './kit/Button'
import { choiceOf, hidesEveryLine, isHidden } from './lineOptions'
import LineOptionsDisclosure from './LineOptionsDisclosure'
import { useCheapEdit } from './notebook/useCheapEdit'
import { useLineOptions } from './useLineOptions'

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
// panel goes back to it. When it is drawn, how it waits and when it goes
// back are the cheap edits' one hook's (`useCheapEdit`, issue 490).
//
// The map follows the end of a gesture and not its every colour (issue
// 262). A drag, a press and a key are all gestures, and each ends in one
// event of the picker: `onChangeEnd`, which react-colorful calls on the
// pointer's release and on the release of an arrow key (its `keyup`), and
// only when the gesture changed the colour. The swatch and the hex field
// follow every colour on the way (`onChange`); the build goes on the end,
// or on the hex field's own button. There is no quiet interval anywhere on
// that path, so a drag of any speed, with any pause in it, is one build.
// A held arrow key sends one `keydown` per repeat and a single `keyup`, so
// it is one gesture and one build, and each separate tap is a gesture of
// its own.

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
   * export can start between the last render and a release, and a rendered
   * prop is one render behind it: a build begun in that gap would rewrite
   * the page the capture is reading, which is the one thing a run and an
   * export may never do to each other (.claude/rules/main.md).
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
  /**
   * True from a run's end until the record it wrote has been read back
   * (A5.5-22). A line option chosen in that beat waits for it, since a build
   * then would draw from the record as it was before the run (issue 394).
   */
  settling?: boolean
}

/** What the section is called, as its heading and as the name of its region. */
const NAME = 'Line colours'

/** A redraw for colours, and not for line options: the colours' own kind of run (issue 394). */
const ownRun = (snapshot: RunSnapshot): boolean => snapshot.recoloured && !snapshot.optioned

export default function LineColours({
  run,
  project,
  engine,
  inspect,
  disabled = false,
  busyNow,
  handback,
  settling = false,
}: Props): JSX.Element {
  const ready = engine?.state === 'ready'

  const [state, setState] = useState<State>({ status: 'waiting' })
  const [palette, setPalette] = useState<Palette>(() => paletteOf(project))
  const section = useRef<HTMLElement>(null)

  // The colours are a cheap edit (`useCheapEdit`, issue 490) with the
  // gesture rule of issue 262: a colour on the way is followed and not
  // drawn, and the build goes on the gesture's end, at once - no quiet
  // interval anywhere on the path. A release while a layout, a rebuild or an
  // export reads the page is held, never refused, and asked again after
  // `REDRAW_DELAY` until the way is clear: one build, when it is. A redraw
  // for line options is the colours' kind of run to the run graph, but it
  // carries none of the colours chosen and waiting here, so its stop is not
  // this panel's: putting the palette back for it would drop a colour held
  // until the build ended (issue 394).
  const edit = useCheapEdit<Palette>({
    run,
    project,
    own: ownRun,
    stored: paletteOf,
    fields: [project.colors, project.defaultColor],
    same: samePalette,
    engine,
    draw: (record, now, next) => run.recolour(record, now, next),
    delay: REDRAW_DELAY,
    atOnce: true,
    // While an export reads the page, or the record a finished run wrote is
    // being read back (issue 394): every draw carries the line options, and
    // one drawn from the record before that run could put a hidden line
    // back on the map.
    held: disabled || settling,
    busyNow,
    // The record is what the panel shows: a build that finished has written
    // it and the view has read it back. A record that arrives while a
    // gesture is going or a release is waiting does not throw it off the
    // screen - under a pointer that would move the picker's thumb under the
    // person's hand - and nor does one that arrives while this panel's own
    // redraw goes.
    adopt: setPalette,
    // A build that stopped wrote nothing, so the colours on screen go back
    // to the record's, and a gesture going at that moment is dropped with
    // the release that was waiting: the picker clears its changed flag when
    // the colour it is given moves under it, so it would never report the
    // end of the one that was cut off.
    putBack: (record) => setPalette(paletteOf(record)),
  })
  const running = edit.snapshot.state === 'running'
  // Something else is reading or rewriting the project's page. Nothing here
  // is disabled for it: a change made now waits and builds once the way is
  // clear, so no control disables itself under a person's hands and no
  // change is lost. `aria-busy` says a build is going; the hook does the
  // waiting.
  const busy = disabled || running

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

  // Closing every open panel under the section, the lines' own and their
  // casings' under line options, through the elements: the platform owns
  // whether a panel is open (issue 284). A press with a pointer has
  // light-dismissed it already, and one from the keyboard moved focus to the
  // button, which a panel closes on (`ColourChip.tsx`, issue 436); but a
  // press that moves no focus, a screen reader's activation in browse mode,
  // can reach the button with a panel open, and the handback to the cell's
  // heading that follows moves no focus either when the heading already holds
  // it, as it does after an earlier reset. So the reset closes them itself.
  const closePanels = (): void => {
    section.current
      ?.querySelectorAll<HTMLElement>('.colour-popover:popover-open')
      .forEach((panel) => panel.hidePopover())
  }

  // A gesture reached a colour: the swatch and the hex field follow it, and
  // nothing is sent.
  const follow = (next: Palette): void => {
    edit.follow(next)
    setPalette(next)
  }
  // A gesture ended, or a button chose a colour outright: the map follows.
  const release = (next: Palette): void => {
    setPalette(next)
    edit.change(next)
  }
  // A panel closed with a gesture still going, which is a key or a pointer
  // that never reported its release - Escape pressed with the button down,
  // a panel light-dismissed under a held key. What the person saw on the
  // swatch is what they chose, and a swatch the map does not carry is the
  // disagreement this panel exists to prevent.
  const panelClosed = (): void => edit.release()
  // A button that removes the last thing it had to remove disables itself,
  // and Chromium blurs a disabled element; the cell's heading is where
  // focus goes so a screen reader stays in the cell (A3-04 learned this).
  const releaseAndKeepFocus = (next: Palette): void => {
    release(next)
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
  // Each line's options (issue 394), in a closed disclosure under its row:
  // the colours' kind of cheap edit, held and drawn by their own hook.
  const options = useLineOptions({
    run,
    project,
    engine,
    held: disabled || settling,
    busyNow,
  })
  const labels = lines.map((line) => line.label)

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
        again, never laid out again. Under each line, Line options gives it a name, leaves it off
        the map, or draws it bolder, cased or dashed, the same way.
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
            onPick={(hex) => follow(withDefault(palette, hex))}
            onPickEnd={(hex) => release(withDefault(palette, hex))}
            onClosed={panelClosed}
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
                  onPick={(hex) => follow(withOverride(palette, line.label, hex))}
                  onPickEnd={(hex) => release(withOverride(palette, line.label, hex))}
                  onClosed={panelClosed}
                  onReset={() => release(withoutOverride(palette, line.label))}
                  hidden={isHidden(options.lines, line.label)}
                  options={
                    <LineOptionsDisclosure
                      label={line.label}
                      choice={choiceOf(options.lines, line.label)}
                      onChoose={(next) => options.choose(line.label, next)}
                      onFollow={(next) => options.follow(line.label, next)}
                      onPanelClosed={options.panelClosed}
                      onReset={() => options.reset(line.label)}
                      lastShown={hidesEveryLine(options.lines, labels, line.label)}
                      handback={handback}
                    />
                  }
                />
              ))}
            </ul>
          )}
          <div className="toolbar">
            <Button
              disabled={nothingToReset}
              onClick={() => {
                closePanels()
                releaseAndKeepFocus(resetAll())
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
 * The colour chip at a row's start, beside the row's words, and the panel it
 * opens (`ColourChip.tsx`, issue 284): a line's own colour, or the default
 * for the lines the feed leaves uncoloured.
 */
function ColourControl({
  children,
  ...panel
}: ColourPanelProps & { children: ReactNode }): JSX.Element {
  const { chip, panel: popover } = useColourPanel(panel)
  return (
    <>
      <div className="line-row">
        {chip}
        {children}
      </div>
      {popover}
    </>
  )
}

function DefaultColour({
  colour,
  onPick,
  onPickEnd,
  onClosed,
}: {
  colour: string
  onPick: (hex: string) => void
  onPickEnd: (hex: string) => void
  onClosed: () => void
}): JSX.Element {
  return (
    <div className="line-row-group">
      <ColourControl
        label="Choose the colour of lines the feed leaves uncoloured"
        colour={colour}
        panelName="Colour for lines the feed leaves uncoloured"
        onPick={onPick}
        onPickEnd={onPickEnd}
        onClosed={onClosed}
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
  onPickEnd,
  onClosed,
  onReset,
  hidden,
  options,
}: {
  line: Line
  shown: Shown
  overridden: boolean
  onPick: (hex: string) => void
  onPickEnd: (hex: string) => void
  onClosed: () => void
  onReset: () => void
  /**
   * The line is left off the map (issue 394): the row stays, its words
   * dimmed and its controls all working, so it can be shown again.
   */
  hidden: boolean
  /** The line's options, in a closed disclosure under the row. */
  options: ReactNode
}): JSX.Element {
  return (
    <li className="line-row-group" data-hidden={hidden ? 'true' : undefined}>
      <ColourControl
        label={`Choose the colour of line ${line.label}`}
        colour={shown.color}
        panelName={`Colour for line ${line.label}`}
        onPick={onPick}
        onPickEnd={onPickEnd}
        onClosed={onClosed}
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
      {options}
    </li>
  )
}
