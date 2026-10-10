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
  mayAdoptRecord,
  reached,
  released,
  resetAll,
  retried,
  shownColour,
  sourceWords,
  stopped,
  withDefault,
  withOverride,
  withoutOverride,
  NOTHING_UNBUILT,
  REDRAW_DELAY,
  type Line,
  type Outcome,
  type Shown,
  type Unbuilt,
} from './colours'
import { useColourPanel, type ColourPanelProps } from './ColourChip'
import type { LayoutRun as Run } from './engine/layoutRun'
import Button from './kit/Button'
import { choiceOf, hidesEveryLine, isHidden } from './lineOptions'
import LineOptionsDisclosure from './LineOptionsDisclosure'
import { useLineOptions } from './useLineOptions'
import { usePutBack } from './usePutBack'
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

  // What has been chosen and the map does not carry yet: the colours of a
  // gesture that is going, and a release that is waiting for the page. They
  // are refs because they decide what an event does and what a read of the
  // record may do, and never what is drawn; `palette` is what is drawn.
  const unbuilt = useRef<Unbuilt>(NOTHING_UNBUILT)
  // The wait for a held release: the one timer on this path, and it is a
  // retry, not a debounce. It asks again whether the way is clear, through
  // a ref so that it is the latest render's project, engine and run that
  // answer and not those of the render that held the release.
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null)
  const askAgain = useRef<() => void>(() => undefined)
  useEffect(
    () => () => {
      if (retry.current !== null) clearTimeout(retry.current)
    },
    [],
  )

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
  // arrives while a gesture is going or a release is waiting is not allowed
  // to throw it off the screen - the view refetches whenever any run
  // finishes, and under a pointer that would move the picker's thumb under
  // the person's hand.
  useEffect(() => {
    if (!mayAdoptRecord(unbuilt.current)) return
    setPalette({ colors: project.colors, defaultColor: project.defaultColor })
  }, [project.id, project.colors, project.defaultColor])

  // A build that stopped wrote nothing, so the colours on screen must go
  // back to the record's; the run's own panel says why. A stop stops
  // everything: a release that was waiting for this build is dropped, and
  // letting it through would build the colours a person had just been told
  // the project did not keep. A gesture going at that moment is dropped
  // with it, and its next colour starts it again: the picker clears its
  // changed flag when the colour it is given moves under it, so it would
  // never report the end of the one that was cut off.
  //
  // **Only at the moment the run stops** (`usePutBack`, issue 360), not for
  // as long as it stays stopped: the run keeps `failed` or `cancelled` until
  // the next one starts, and a record written for another reason is a new
  // `project.colors` reference. Acting on that would drop, and snap back, a
  // colour chosen afterwards and waiting for an export to let go of the page.
  usePutBack(runState, recoloured, () => {
    if (retry.current !== null) clearTimeout(retry.current)
    retry.current = null
    unbuilt.current = stopped()
    setPalette({ colors: project.colors, defaultColor: project.defaultColor })
  })

  // What `released` or `retried` decided. A layout, a rebuild or an export
  // is reading the page a build would rewrite, so a release then is held,
  // never refused, and asks again after `REDRAW_DELAY` until the way is
  // clear: one build, when it is.
  const act = ({ step, unbuilt: after }: Outcome, next: Palette): void => {
    unbuilt.current = after
    if (retry.current !== null) clearTimeout(retry.current)
    retry.current = null
    if (step === 'wait') {
      retry.current = setTimeout(() => {
        retry.current = null
        askAgain.current()
      }, REDRAW_DELAY)
    } else if (step === 'build') {
      run.recolour(project, engine, next)
    }
  }
  // `busy` is what the last render saw; the run's own state is what is true
  // at this moment, and a run can start between the two. Without it a colour
  // would be handed to a run that refuses it, silently.
  // While the record a finished run wrote is being read back, too (issue
  // 394): every draw now carries the line options, and one drawn from the
  // record before that run could put a hidden line back on the map while
  // the store, writing `drawn` from the record after it, said it was gone.
  const stillBusy = (): boolean =>
    busy || settling || run.snapshot.state === 'running' || busyNow?.() === true
  // The commit point: the picker released, or the hex field's button.
  const commit = (next: Palette): void =>
    act(released(unbuilt.current, next, paletteOf(project), stillBusy()), next)
  useEffect(() => {
    askAgain.current = () => {
      const held = unbuilt.current.held
      if (held !== null) act(retried(unbuilt.current, paletteOf(project), stillBusy()), held)
    }
  })

  // Closing every open panel, through the elements: the platform owns
  // whether a panel is open, and a press of a button elsewhere is a click
  // that light-dismisses it, but a keyboard press is not (issue 284).
  const closePanels = (): void => {
    section.current
      ?.querySelectorAll<HTMLElement>('.colour-popover:popover-open')
      .forEach((panel) => panel.hidePopover())
  }

  // A gesture reached a colour: the swatch and the hex field follow it, and
  // nothing is sent.
  const follow = (next: Palette): void => {
    unbuilt.current = reached(unbuilt.current, next)
    setPalette(next)
  }
  // A gesture ended, or a button chose a colour outright: the map follows.
  const release = (next: Palette): void => {
    setPalette(next)
    commit(next)
  }
  // A panel closed with a gesture still going, which is a key or a pointer
  // that never reported its release - Escape pressed with the button down,
  // a panel light-dismissed under a held key. What the person saw on the
  // swatch is what they chose, and a swatch the map does not carry is the
  // disagreement this panel exists to prevent.
  const panelClosed = (): void => {
    const { live } = unbuilt.current
    if (live !== null) release(live)
  }
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
