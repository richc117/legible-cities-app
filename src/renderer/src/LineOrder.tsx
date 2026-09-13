import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { EngineState } from '../../shared/engine'
import { withoutPaths } from '../../shared/engine'
import type { Inspection } from '../../shared/protocol'
import {
  orderOf,
  paletteOf,
  validateLineOrder,
  type LineOrder as Order,
  type ProjectRecord,
} from '../../shared/project'
import { linesOf, REDRAW_DELAY, shownColour, type Line } from './colours'
import { debounce } from './debounce'
import type { LayoutRun as Run } from './engine/layoutRun'
import Button from './kit/Button'
import {
  alphabetical,
  arrange,
  isAlphabetical,
  move,
  nextStep,
  positionWords,
  sameOrder,
} from './order'
import { useSnapshot } from './useSnapshot'

// The order a project's lines are drawn in (A4-02, specs/020-line-order).
//
// One list does two things on the engine's page: where two lines share
// track the later is drawn over the earlier, and the page lists the lines
// in rows in the same order. The app sends that list as `line_order` and
// draws none of it: the picture is the engine's.
//
// An order is a render, never a layout: the stored layout is drawn again
// and the stations do not move (ADR-023). Nothing is written until the map
// has been drawn, as a chosen day and a chosen colour are not (A3-04,
// A4-01), so a cancelled or failed build leaves the record alone and the
// panel goes back to it.
//
// A partial or stale arrangement is safe at the engine the app pins: the
// lines an order names are drawn first and every other line the layout
// carries after them (engine issue 28). Before that release the field was
// a whitelist and an order naming two lines of six drew two.

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
  /** The same question at this instant rather than at the last render (A4-01). */
  busyNow?: () => boolean
}

export default function LineOrder({
  run,
  project,
  engine,
  inspect,
  disabled = false,
  busyNow,
}: Props): JSX.Element {
  const ready = engine?.state === 'ready'
  const { state: runState, reordered } = useSnapshot(run)
  const running = runState === 'running'
  // Nothing here disables itself because something else is going: a move
  // made now waits and draws once the way is clear, so no control goes out
  // from under a person's hands and no move is lost.
  const busy = disabled || running

  const [state, setState] = useState<State>({ status: 'waiting' })
  const [order, setOrder] = useState<Order>(() => orderOf(project))
  const [said, setSaid] = useState<string | null>(null)
  // A move made while a run or an export is reading the page waits on the
  // timer until the way is clear, which for an export is minutes. Saying so
  // is the difference between a move waiting and a move that looks done.
  const [waiting, setWaiting] = useState(false)
  // Which button the line that moved left focus on: the one that made the
  // move, or its opposite when the line has reached an end and that button
  // is now disabled, because Chromium blurs a disabled element and focus
  // would fall to the body (A3-04 learned this).
  //
  // It is a ref rather than state because it outlives the move. The list is
  // drawn again when the build starts and again when the record comes back,
  // and a row moving in the DOM takes focus off the button inside it, half
  // a second after the press - which macOS's runner caught and this
  // machine, finishing sooner, did not.
  const focusOn = useRef<string | null>(null)
  const buttons = useRef(new Map<string, HTMLElement>())
  const headingRef = useRef<HTMLHeadingElement>(null)

  const commitRef = useRef<(next: Order) => void>(() => undefined)
  const schedule = useMemo(
    () => debounce((next: Order) => commitRef.current(next), REDRAW_DELAY),
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

  // The record is what the panel shows, once there is no edit waiting on
  // the timer: a build that finished has written it and the view has read
  // it back, so the two agree again.
  useEffect(() => {
    if (schedule.pending) return
    setOrder(project.lineOrder)
  }, [project.id, project.lineOrder, schedule])

  // A build that stopped wrote nothing, so the arrangement on screen must
  // go back to the record's; the run's own panel says why. A move made
  // while the build ran is waiting on the same timer, and letting it
  // through would draw an order a person had just been told was not kept.
  useEffect(() => {
    if (reordered && (runState === 'cancelled' || runState === 'failed')) {
      schedule.cancel()
      setWaiting(false)
      setOrder(project.lineOrder)
    }
  }, [runState, reordered, project.lineOrder, schedule])

  const commit = (next: Order): void => {
    // The store's own rule, run here as well: a feed with more lines than a
    // record may hold would otherwise draw the map and then fail on the way
    // to disk, once per move, with the panel springing back each time.
    const refused = validateLineOrder(next)
    if (refused !== null) {
      // Back to the record, as a stopped build is: a panel that says the
      // order was not kept while showing it is worse than either.
      setWaiting(false)
      setOrder(project.lineOrder)
      setSaid(`The order was not kept: ${refused}.`)
      return
    }
    // `busy` is what the last render saw; the run's own state is what is
    // true at this moment, and a run can start between the two. Without it
    // an arrangement would be handed to a run that refuses it, silently.
    const step = nextStep(
      next,
      orderOf(project),
      busy || run.snapshot.state === 'running' || busyNow?.() === true,
    )
    // A layout, a rebuild or an export is reading the page this would
    // rewrite. Wait rather than refuse: the same delay again, and again,
    // until the way is clear. An export is minutes, not milliseconds, so
    // the wait is said rather than left to look like a move that landed.
    if (step === 'wait') {
      setWaiting(true)
      schedule(next)
    } else {
      setWaiting(false)
      if (step === 'build') run.reorder(project, engine, next)
    }
  }
  useEffect(() => {
    commitRef.current = commit
  })

  const inspection = state.status === 'ready' ? state.inspection : null
  // The layout on screen was made with these; the record's own may have
  // moved since (A2-02).
  const mode = project.built?.mode ?? project.mode
  const agency = project.built === null ? project.agency : project.built.agency
  const lines = useMemo(
    () => (inspection === null ? [] : linesOf(inspection, { mode, agency })),
    [inspection, mode, agency],
  )
  const arranged = useMemo(() => arrange(lines, order), [lines, order])
  const palette = paletteOf(project)
  const nothingToPutBack = isAlphabetical(lines, order)

  // Focus follows the line that moved, through every redraw of the list -
  // but only while nothing else holds it, so a person who has tabbed on is
  // never pulled back.
  useLayoutEffect(() => {
    const key = focusOn.current
    if (key === null) return
    const target = buttons.current.get(key)
    if (target === undefined || target === document.activeElement) return
    const active = document.activeElement
    if (active === null || active === document.body) target.focus()
  })

  const moveLine = (line: Line, by: -1 | 1): void => {
    const moved = move(lines, order, line.label, by)
    // A line moved down and then back up leaves the lines where the engine
    // would have drawn them anyway, and that is stored as no order at all:
    // otherwise the record would name every line to say nothing, and the
    // way back to alphabetical would stay lit with nothing to undo.
    const next = isAlphabetical(lines, moved) ? alphabetical() : moved
    if (sameOrder(next, order)) return
    const at = arrange(lines, next).findIndex((each) => each.label === line.label)
    setOrder(next)
    schedule(next)
    setSaid(`${line.label} is now ${positionWords(at, lines.length)}.`)
    // The button pressed, unless the line has just reached the end it was
    // moving towards and that button is about to be disabled. Handed over
    // now, before React disables anything, and held by the effect above
    // through the redraws that follow.
    const stillThere = by === -1 ? at > 0 : at < lines.length - 1
    const key = `${line.label}:${stillThere ? by : -by}`
    focusOn.current = key
    buttons.current.get(key)?.focus()
  }

  const putBack = (): void => {
    // Nothing is following a line any more.
    focusOn.current = null
    // This button removes the last thing it had to remove and so disables
    // itself, and Chromium blurs a disabled element; the heading is where
    // focus goes, so a screen reader stays in the panel (A3-04 learned
    // this, and the Colours panel's resets do the same).
    headingRef.current?.focus()
    const next = alphabetical()
    setOrder(next)
    schedule(next)
    setSaid('The lines are in alphabetical order again.')
  }

  return (
    <section className="line-order" aria-labelledby="line-order-heading" aria-busy={busy}>
      <h2 id="line-order-heading" tabIndex={-1} ref={headingRef}>
        Line order
      </h2>
      <p className="prose">
        Where two lines share track the map draws the later of them over the earlier, and the page
        lists them in this order too. The stations do not move: the stored layout is drawn again,
        never laid out again.
      </p>
      {state.status === 'waiting' && (
        <p className="hint" role="status">
          {ready
            ? 'Reading the feed for its lines…'
            : 'The engine is not ready, so the feed cannot be read yet.'}
        </p>
      )}
      {state.status === 'failed' && (
        <p className="message error" role="alert">
          {state.message}
        </p>
      )}
      {inspection !== null &&
        (arranged.length === 0 ? (
          <p className="hint" role="status">
            This feed has no lines under {mode}
            {agency === null ? '' : ` for ${agency}`}.
          </p>
        ) : (
          <>
            <ol className="line-list" aria-label="Lines in the order they are drawn">
              {arranged.map((line, index) => (
                <li className="line-row-group" key={line.label}>
                  <div className="line-row">
                    {/* The figure a person scans. A screen reader is told
                        the place by the list itself - an ordered list says
                        "3 of 6" - and after a move by the status below, so
                        saying it a third time in the row would be noise. */}
                    <span className="line-place" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span
                      className="swatch"
                      style={swatch(shownColour(line, palette).color)}
                      aria-hidden="true"
                    />
                    <span className="line-name">{line.label}</span>
                    <span className="line-actions">
                      <Button
                        ref={keep(buttons.current, `${line.label}:-1`)}
                        disabled={index === 0}
                        aria-label={`Move line ${line.label} up`}
                        onClick={() => moveLine(line, -1)}
                      >
                        Up
                      </Button>
                      <Button
                        ref={keep(buttons.current, `${line.label}:1`)}
                        disabled={index === arranged.length - 1}
                        aria-label={`Move line ${line.label} down`}
                        onClick={() => moveLine(line, 1)}
                      >
                        Down
                      </Button>
                    </span>
                  </div>
                </li>
              ))}
            </ol>
            <p className="hint" role="status" aria-live="polite">
              {waiting
                ? 'Waiting for the map to be free, then the lines are drawn in this order.'
                : said}
            </p>
            <div className="toolbar">
              <Button disabled={nothingToPutBack} onClick={putBack}>
                Back to alphabetical
              </Button>
            </div>
          </>
        ))}
    </section>
  )
}

/** Hold on to a row's button by name, so focus can be put back on it after a move. */
function keep(map: Map<string, HTMLElement>, key: string): (element: HTMLElement | null) => void {
  return (element) => {
    if (element === null) map.delete(key)
    else map.set(key, element)
  }
}
