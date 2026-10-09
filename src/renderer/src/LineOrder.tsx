import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent,
  type RefObject,
} from 'react'
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
import Icon from './icons/Icon'
import Button from './kit/Button'
import {
  alphabetical,
  arrange,
  dropPlace,
  isAlphabetical,
  move,
  moveTo,
  nextStep,
  positionWords,
  sameOrder,
  standAside,
} from './order'
import { usePutBack } from './usePutBack'
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
//
// A line moves two ways (issue 283): carried by the grip at its row's start
// to any place, or one place at a time by the arrows at its end. The arrows
// are the way that needs no pointer, and they are why a drag is safe to
// offer at all: spec 020 deferred dragging because a handle alone would
// have put the feature out of the keyboard's reach, and the buttons stay.
// The drag is the app's own pointer code, as the geographic view's pan is
// (StageView.tsx): the grip captures the pointer, the list follows it, and
// the release is one change on the same debounced timer the presses use,
// so a drop is one build. HTML's own drag and drop was ruled out: no touch,
// no say over what is drawn under the pointer, and it does not mix with
// pointer capture.

/** A line's own colour is data, not a token: it is drawn from the record, never from a stylesheet. */
const swatch = (colour: string): { background: string } => ({ background: colour })

type State =
  | { status: 'waiting' }
  | { status: 'ready'; inspection: Inspection }
  | { status: 'failed'; message: string }

/** What the list shows while a line is carried: which, from where, to where, and how far. */
interface Drag {
  label: string
  from: number
  to: number
  /** How far the dragged row has moved, in CSS pixels, down being positive. */
  by: number
  /** The dragged row's own height: how far each row it passes stands aside. */
  height: number
}

/**
 * The gesture behind a drag, as the handlers need it at the instant an
 * event arrives rather than at the last render: the pointer, the grip that
 * holds it, and the list as it stood when the drag began.
 */
interface Gesture {
  pointerId: number
  grip: HTMLElement
  label: string
  from: number
  /** Where the pointer went down, from the top of the list. */
  start: number
  /** Every row's middle, from the top of the list, top to bottom. */
  middles: number[]
  /** How far the row can go up and down before it would leave the list. */
  above: number
  below: number
  /** The labels in the order the drag began from, so a list redrawn under it can be noticed. */
  labels: string[]
}

/** The two arrows a row carries, by the way each moves its line. */
const ARROWS = [
  { by: -1, icon: 'up', way: 'up' },
  { by: 1, icon: 'down', way: 'down' },
] as const

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
  /**
   * Where focus goes when a control that held it is disabled or removed:
   * cell 05's own heading, as the colours section hands it (A5.5-18). Not
   * the heading below, which names this section but is not the cell's, and
   * not the cell's toggle - a reflexive Space after "Back to alphabetical"
   * would collapse the cell the person is working in.
   *
   * Required, because a panel with nowhere to hand focus back to is the
   * A6-07 defect itself - Chromium blurs a disabled element and focus falls
   * to the body - and a shape that cannot say it cannot ship it.
   */
  handback: RefObject<HTMLElement | null>
}

/** What the section is called, as its heading and as the name of its region. */
const NAME = 'Line order'

export default function LineOrder({
  run,
  project,
  engine,
  inspect,
  disabled = false,
  busyNow,
  handback,
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
  const back = useRef<HTMLElement>(null)

  // The line being carried, for the render, and the gesture behind it, for
  // the handlers, which must see the pointer at the instant it moves rather
  // than at the last render.
  const [drag, setDrag] = useState<Drag | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const list = useRef<HTMLOListElement>(null)
  const dragging = drag !== null

  // The arrows' tooltips a person sent away with Escape, each until the
  // pointer and the focus have both left it (WCAG 1.4.13), and the arrow
  // under the pointer now, since a pointer resting on one leaves the focus
  // wherever it was. The diagnostics' explanations keep the same rule.
  const [dismissed, setDismissed] = useState<readonly string[]>([])
  const hovered = useRef<string | null>(null)

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
  //
  // **Only at the moment the run stops** (`usePutBack`, issue 360), not for
  // as long as it stays stopped: the run keeps `failed` or `cancelled` until
  // the next one starts, and a record written for another reason is a new
  // `project.lineOrder` reference. Acting on that would cancel, and snap
  // back, a move made afterwards and waiting for an export to let go of the
  // page.
  usePutBack(runState, reordered, () => {
    schedule.cancel()
    setWaiting(false)
    setOrder(project.lineOrder)
  })

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
    // itself, and Chromium blurs a disabled element; the cell's heading is
    // where focus goes, so a screen reader stays in the cell (A3-04 learned
    // this, and the colours section's resets do the same).
    handback.current?.focus()
    const next = alphabetical()
    setOrder(next)
    schedule(next)
    setSaid('The lines are in alphabetical order again.')
  }

  /**
   * The arrow holding focus now, as it should be once the lines stand as
   * `drawn`: the same one, or its opposite when its line has come to rest
   * at the end that arrow points to and it is about to be disabled. Null
   * when focus is anywhere else, so nothing in the list takes it.
   */
  const arrowHolding = (drawn: readonly string[]): string | null => {
    const active = document.activeElement
    for (const [key, element] of buttons.current) {
      if (element !== active) continue
      const cut = key.lastIndexOf(':')
      const label = key.slice(0, cut)
      const by = Number(key.slice(cut + 1))
      const at = drawn.indexOf(label)
      const stuck = by === -1 ? at === 0 : at === drawn.length - 1
      return `${label}:${stuck ? -by : by}`
    }
    return null
  }

  /**
   * The list put back as it was, with nothing built: Escape, a cancelled
   * pointer, or a list drawn again under the drag. Only refs and a setter,
   * so the one function serves every render.
   */
  const abandon = useCallback((): void => {
    const now = gesture.current
    gesture.current = null
    setDrag(null)
    if (now !== null && now.grip.hasPointerCapture(now.pointerId))
      now.grip.releasePointerCapture(now.pointerId)
  }, [])

  /**
   * Where the carried row is drawn now, kept inside the list, and where it
   * would land, from where the pointer is. The place is read from the
   * pointer itself rather than from the row held inside the list, so a
   * pointer past either end of it is that end, whatever the rows' heights.
   */
  const carried = (now: Gesture, clientY: number): { by: number; to: number } | null => {
    const top = list.current?.getBoundingClientRect().top
    if (top === undefined) return null
    const moved = clientY - top - now.start
    const by = Math.min(Math.max(moved, -now.above), now.below)
    return { by, to: dropPlace(now.middles, now.from, moved) }
  }

  // The grip takes the pointer, as the geographic view's pane does for a pan
  // (StageView.tsx): once captured, every move and the release come here
  // wherever the pointer goes, over the map or out of the window. The list
  // is measured once, when the line is picked up, from the top of the list
  // rather than of the window, so a page that scrolls under the drag does
  // not move where the line lands.
  const pickUp = (event: PointerEvent<HTMLElement>, line: Line, index: number): void => {
    if (event.button !== 0 || gesture.current !== null || list.current === null) return
    const top = list.current.getBoundingClientRect().top
    const rows = Array.from(list.current.children, (row) => row.getBoundingClientRect())
    const row = rows[index]
    if (row === undefined || rows.length !== arranged.length) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const labels = arranged.map((each) => each.label)
    gesture.current = {
      pointerId: event.pointerId,
      grip: event.currentTarget,
      label: line.label,
      from: index,
      start: event.clientY - top,
      middles: rows.map((each) => each.top - top + each.height / 2),
      above: row.top - top,
      below: rows[rows.length - 1].bottom - row.bottom,
      labels,
    }
    // Focus stays where it is. On one of the list's arrows it is held
    // through the redraws, as after a press; anywhere else, nothing here
    // reaches for it, whatever an earlier press left behind.
    focusOn.current = arrowHolding(labels)
    setDrag({ label: line.label, from: index, to: index, by: 0, height: row.height })
  }

  const follow = (event: PointerEvent<HTMLElement>): void => {
    const now = gesture.current
    if (now === null || event.pointerId !== now.pointerId) return
    const at = carried(now, event.clientY)
    if (at !== null) setDrag((was) => (was === null ? was : { ...was, ...at }))
  }

  // The release is one change, made exactly as a press makes one: the
  // arrangement on screen at once, and the build on the same debounced
  // timer, so a drop is one `map.build` however far the line travelled and
  // however many moves the pointer made on the way.
  const putDown = (event: PointerEvent<HTMLElement>): void => {
    const now = gesture.current
    if (now === null || event.pointerId !== now.pointerId) return
    const at = carried(now, event.clientY)
    abandon()
    if (at === null) return
    const next = moveTo(lines, order, now.label, at.to)
    if (sameOrder(next, order)) return
    const drawn = arrange(lines, next).map((each) => each.label)
    const key = arrowHolding(drawn)
    focusOn.current = key
    if (key !== null) buttons.current.get(key)?.focus()
    // A drop that puts the lines back where the engine draws them disables
    // "Back to alphabetical", and Chromium blurs a disabled element: the
    // cell's heading takes focus, as it does after that button's own press.
    else if (next.length === 0 && document.activeElement === back.current) handback.current?.focus()
    setOrder(next)
    schedule(next)
    setSaid(`${now.label} is now ${positionWords(drawn.indexOf(now.label), lines.length)}.`)
  }

  // Escape puts the list back while a line is carried, and is the drag's
  // alone: taken before anything else in the window hears it, so nothing
  // else that answers Escape - the diagnostics' explanations, the arrows'
  // own tooltips - takes the same press as its own.
  useEffect(() => {
    if (!dragging) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      abandon()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [dragging, abandon])

  // A list drawn again under the drag - a build that stopped and put the
  // record's order back, a press from the keyboard - has moved the rows the
  // drag was measured against, so the drag is let go rather than landing
  // somewhere nobody chose.
  useEffect(() => {
    const now = gesture.current
    const labels = arranged.map((each) => each.label)
    if (now !== null && !sameOrder(now.labels, labels)) abandon()
  }, [arranged, abandon])

  // Escape from anywhere sends the arrows' tooltips that are showing away,
  // as the diagnostics' explanations go (A6-07).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const showing: string[] = []
      if (hovered.current !== null) showing.push(hovered.current)
      const active = document.activeElement
      const focused = active?.closest('[data-arrow]')?.getAttribute('data-arrow')
      if (focused && list.current?.contains(active ?? null)) showing.push(focused)
      if (showing.length > 0) setDismissed((was) => [...new Set([...was, ...showing])])
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  /** The pointer or the focus has left an arrow: Escape's dismissal of its tooltip is over. */
  const leave = (key: string): void =>
    setDismissed((was) => (was.includes(key) ? was.filter((each) => each !== key) : was))

  /** Where a row is drawn while a line is carried: the carried one under the pointer, the rows it has passed a place aside. */
  const carriedStyle = (index: number): CSSProperties | undefined => {
    if (drag === null) return undefined
    if (index === drag.from) return { transform: `translateY(${drag.by}px)` }
    const aside = standAside(index, drag.from, drag.to)
    return aside === 0 ? undefined : { transform: `translateY(${aside * drag.height}px)` }
  }

  return (
    <section className="line-order" aria-labelledby="line-order-heading" aria-busy={busy}>
      {/* The second of cell 05's two sections, named by its own heading a
          level below the cell's, for the reason the colours section gives:
          one heading cannot name two sections. It takes no focus - the
          cell's heading is where focus is handed (A5.5-18). */}
      <h3 id="line-order-heading">{NAME}</h3>
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
            <ol
              ref={list}
              className="line-list"
              aria-label="Lines in the order they are drawn"
              data-dragging={dragging ? 'true' : undefined}
            >
              {arranged.map((line, index) => (
                <li
                  className="line-row-group"
                  key={line.label}
                  data-dragged={drag?.from === index ? 'true' : undefined}
                  style={carriedStyle(index)}
                >
                  <div className="line-row">
                    {/* The grip: what a pointer carries the line by. It is
                        no control, so it has no name and takes no focus -
                        the arrows at the row's end are the same moves from
                        the keyboard, and a screen reader meets those. The
                        press does not move focus either (the mouse's own
                        default is refused), so a person on an arrow stays
                        on it. */}
                    <span
                      className="line-grip"
                      aria-hidden="true"
                      onPointerDown={(event) => pickUp(event, line, index)}
                      onPointerMove={follow}
                      onPointerUp={putDown}
                      onPointerCancel={(event) => {
                        // Only the pointer that is carrying: the cancel of another
                        // touch on any grip is not this drag's.
                        if (gesture.current?.pointerId === event.pointerId) abandon()
                      }}
                      onLostPointerCapture={abandon}
                      onMouseDown={(event) => event.preventDefault()}
                    >
                      <Icon name="grip" />
                    </span>
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
                      {ARROWS.map(({ by, icon, way }) => {
                        const key = `${line.label}:${by}`
                        const name = `Move line ${line.label} ${way}`
                        return (
                          // An arrow alone says nothing to a person who
                          // cannot guess it, so it carries its name as a
                          // tooltip on hover and on focus (DESIGN.md 8.2).
                          // The name is the button's already, so the
                          // tooltip is hidden from a screen reader rather
                          // than read twice.
                          <span
                            key={way}
                            className="explain line-arrow"
                            data-arrow={key}
                            data-dismissed={dismissed.includes(key) ? 'true' : undefined}
                            onMouseEnter={() => {
                              hovered.current = key
                            }}
                            onMouseLeave={(event) => {
                              hovered.current = null
                              if (!event.currentTarget.contains(document.activeElement)) leave(key)
                            }}
                            onBlur={(event) => {
                              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                                leave(key)
                            }}
                          >
                            <Button
                              ref={keep(buttons.current, key)}
                              icon
                              disabled={by === -1 ? index === 0 : index === arranged.length - 1}
                              aria-label={name}
                              onClick={() => moveLine(line, by)}
                            >
                              <Icon name={icon} />
                            </Button>
                            <span className="tooltip" aria-hidden="true">
                              {name}
                            </span>
                          </span>
                        )
                      })}
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
              <Button ref={back} disabled={nothingToPutBack} onClick={putBack}>
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
