import { useEffect, useId, useMemo, useRef, useState, type JSX } from 'react'
import type { ViewerBounds } from '../../shared/viewer'
import { debounce } from './debounce'
import Icon from './icons/Icon'
import Button from './kit/Button'
import Select from './kit/Select'
import {
  SPEEDS,
  clampTo,
  makePoll,
  readClock,
  shownPlaying,
  shownSpeed,
  transportFor,
  transportRefusal,
} from './transportState'
import { useSnapshot } from './useSnapshot'

// The transport, cell 03's second section (A5.5-16): where the map is in
// the service day, whether the day is running, and how fast.
//
// It draws no map and computes no time. Every one of its four acts is a
// call on the engine page's own seam, made from the privileged process
// because the frame is sandboxed to an opaque origin (ADR-028): `bounds`
// for the day the page has, `state` for where its clock is, and `seek`,
// `setPlaying` and `setSpeed` to move it. Nothing here asks the engine for
// anything, builds a map, or writes a record, so no cell of the notebook
// goes stale for any of it (contracts/run-graph.md). Looking is not
// editing.
//
// The arithmetic and the two values the page cannot be asked for are in
// `transportState.ts`, which has no React in it; this file is the wiring.
//
// **The clock is read back, never counted.** A poll asks the page where it
// is while this cell is open, which is the only way to follow a page that
// is running its own clock: the seam has no event and `onDraw` takes a
// function, which cannot cross into another frame. It also means the
// control follows the page's own view switcher and anything else that moves
// it, rather than fighting it (`controls=1` gives the page its switcher and
// nothing else, so the app's are the only transport on screen).
//
// The poll runs only while the cell is open. A collapsed cell keeps its
// controls mounted - `Cell.tsx` hides them rather than unmounting, so a
// half-typed value is never lost - which means an effect that polled on
// mount would go on asking the page for the whole life of the screen with
// nobody reading the answer.

/** What the section is called, as its heading and as its region's name. */
const NAME = 'Transport'

/**
 * How often the page is asked where its clock is, in milliseconds, while
 * the cell is open.
 *
 * Twice a second: the clock the page shows is `HH:MM`, so a faster poll
 * cannot change what is on screen at any speed below a minute of the
 * service day per half second, and every ask is a round trip through the
 * privileged process into the frame.
 */
const POLL_DELAY = 500

/**
 * How long a seek waits before it is sent, in milliseconds.
 *
 * A range control reports every position on the way to the one a person
 * means, and a drag across a day is dozens of them. The thumb moves at once
 * either way: the control is drawn from the app's own optimistic position
 * until the page answers.
 */
const SEEK_DELAY = 80

/**
 * How long after a move the poll may not overwrite the thumb, in
 * milliseconds.
 *
 * The seek waits, the round trip takes its own time, and a poll that landed
 * between the two would answer with the clock from *before* the move and
 * pull the thumb back under the hand that moved it. Comfortably longer than
 * the debounce and one round trip, and short enough that a page moved by
 * something else is followed again within a second.
 */
const HOLD = 700

/**
 * The scrub's own step, in seconds of the service day: one minute, which is
 * what the page's clock shows and so the smallest step that changes it.
 * An arrow key moves a minute and a page key an hour's worth of them.
 */
const SCRUB_STEP = 60

export default function Transport({
  projectId,
  redraw,
  open,
  laying,
  exporting,
  previewing,
}: {
  projectId: string
  /**
   * How many runs have drawn this project's page while the screen has been
   * open. A change means the frame has been sent to a page a run rewrote,
   * whose service day may be another one, so the bounds are asked for again.
   */
  redraw: number
  /** Is this cell disclosed? The poll runs only while it is. */
  open: boolean
  /** A layout, a rebuild, a recolour or a reorder holds the project's page. */
  laying: boolean
  /** An export is reading the page frame by frame. */
  exporting: boolean
  /** Cell 06 has the map showing what the export will frame. */
  previewing: boolean
}): JSX.Element | null {
  const memory = transportFor(projectId)
  const remembered = useSnapshot(memory)
  const speed = shownSpeed(remembered)
  const playing = shownPlaying(remembered)

  const [bounds, setBounds] = useState<ViewerBounds | null>(null)
  const [now, setNow] = useState(0)
  const [clock, setClock] = useState('')
  const [refused, setRefused] = useState<string | null>(null)
  // Until when a poll's answer is stale by construction: see HOLD.
  const held = useRef(0)
  const scrubId = useId()

  const why = transportRefusal({ laying, exporting, previewing })
  // The reason goes, so does the sentence. A refusal left standing after
  // the run that caused it has ended reads as a control that is broken.
  useEffect(() => {
    if (why === null) setRefused(null)
  }, [why])

  // Where the page is, while anyone is looking. The poll owns when the day
  // and the clock are asked for and how many asks may be outstanding;
  // `makePoll` carries the reasoning and the tests. What is here is what to
  // do with what it learns.
  //
  // A fresh poll per effect run, so a redraw asks the new page for its own
  // day: a rebuild draws another service day, and keeping the old bounds
  // would leave the scrub addressing a day the page no longer has.
  useEffect(() => {
    if (!open) return undefined
    let off = false
    const poll = makePoll(
      (method) => window.api.viewer.call(method),
      ({ bounds: found, clock: at }) => {
        if (off) return
        if (found !== null) setBounds(found)
        // The thumb belongs to whoever is moving it; see HOLD.
        if (at === null || Date.now() < held.current) return
        setNow(at.now)
        setClock(at.clock)
      },
    )
    poll.tick()
    const timer = setInterval(poll.tick, POLL_DELAY)
    return () => {
      off = true
      clearInterval(timer)
    }
  }, [open, projectId, redraw])

  // The seek, made once and read through a ref, so a call waiting on the
  // timer is never the closure from three renders ago - the pattern
  // `LineColours` and `ServiceDay` both use for theirs.
  const seekRef = useRef<(seconds: number) => void>(() => undefined)
  const sendSeek = useMemo(() => debounce((at: number) => seekRef.current(at), SEEK_DELAY), [])
  // Cancelled and not flushed: a scrub position is a look at the map, not a
  // choice a person has made and expects to find kept (which is why
  // `ServiceDay` flushes its own). A cell going has nothing to preserve.
  useEffect(() => () => sendSeek.cancel(), [sendSeek])
  // Which seek an answer belongs to. Two seeks can be in flight at once -
  // the debounce is 80ms and a round trip is not bounded - and without this
  // the first one's answer arrives last and pulls the thumb back to where
  // the person was half a second ago.
  const seeks = useRef(0)
  useEffect(() => {
    seekRef.current = (at: number): void => {
      const mine = (seeks.current += 1)
      void window.api.viewer
        .call('seek', at)
        // Read straight back, so what is on screen is the page's own answer
        // and the page's own formatting rather than the app's guess at
        // either: the page clamps a seek to its own day, and the clock is a
        // string only it knows how to write.
        .then(() => window.api.viewer.call('state'))
        .then((answer) => {
          const said = readClock(answer)
          if (said === null || mine !== seeks.current) return
          setNow(said.now)
          setClock(said.clock)
        })
        .catch(() => undefined)
    }
  })

  /** Refuse where something else holds the page. True where the act may go on. */
  const allowed = (): boolean => {
    if (why === null) {
      setRefused(null)
      return true
    }
    setRefused(why)
    return false
  }

  /** The thumb is the person's for a moment: see HOLD. */
  const hold = (): void => {
    held.current = Date.now() + HOLD
  }

  const scrub = (value: string): void => {
    if (bounds === null) return
    if (!allowed()) return
    const at = clampTo(bounds, Number(value))
    // Optimistic: the thumb and the app's own position move now, and the
    // page's answer replaces both a round trip later. Nothing is written
    // anywhere, so an optimistic position that the page then clamps costs a
    // frame of being half a minute out and nothing else.
    hold()
    setNow(at)
    sendSeek(at)
  }

  // Both of these write the memory **before** the call, and swallow a
  // refusal, and that is a choice with a visible symptom either way.
  //
  // Written first: a call is refused only when there is no page to reach -
  // the frame is mid-navigation, or gone - and in that case the memory is
  // precisely what tells the next page what to be (`Viewer.tsx`'s restore).
  // A press made a moment before a run finishes therefore still lands, on
  // the page the run wrote. The symptom, when it is wrong, is that a press
  // the page never received still moves the button and is then asserted to
  // every page after it: the map runs on while the control says Pause,
  // until the next navigation, which applies it and makes the two agree.
  //
  // Written after instead, the symptom would be the other one: a press made
  // in the last moment of a run would be dropped silently, the button would
  // spring back under the person's hand, and nothing would ever apply it.
  // Of the two, a press that is honoured late is better than one that is
  // lost, because the person can see the second one happen and cannot see
  // the first.
  const play = (): void => {
    if (!allowed()) return
    const next = !playing
    memory.remember({ playing: next })
    void window.api.viewer.call('setPlaying', next).catch(() => undefined)
  }

  const choose = (rate: number): void => {
    if (!allowed()) return
    memory.remember({ speed: rate })
    void window.api.viewer.call('setSpeed', rate).catch(() => undefined)
  }

  // Nothing until the page has said what day it has. A page that is not
  // there, or one from before the seam existed, gets no controls rather
  // than controls that do nothing - and the viewer says so in its own
  // words, one region above, so there is nothing to add here.
  //
  // The bounds are never put back to null once they are known: a run
  // navigates the frame, and a section that vanished for the length of a
  // run would take the focus of whoever was in it with it (A6-07).
  if (bounds === null) return null

  return (
    <section className="transport" aria-labelledby="transport-heading">
      {/* A panel names itself with an `h3` **or** with an `aria-label` on
          its region, never with an `h2`, and which of the two is a
          judgement about the panel (the rule lane 197 is landing; cell
          05's two sections are the case that forced it). Cell 03's two
          sections make that judgement differently, on purpose.

          The day is named by the cell's own heading, and takes the
          `aria-label` form. The cell is *called* "Frame and service day":
          a heading reading "Service day" directly beneath one reading
          "Frame and service day" repeats its parent and adds a level to
          walk for nothing. It is also where the day's focus handback
          lands - a control that disables itself under a person's hands
          gives focus to the cell's heading - and that only reads as the
          right place because that heading is the day's own name.

          The transport is named by this `h3`, because nothing above names
          it: the cell's heading is about what the project keeps, and this
          is about the map now on the screen, which is a different subject
          in the same cell. A person walking the document by heading has
          something to walk to, and nothing here ever disables, so it needs
          no handback and takes no focus. */}
      <h3 id="transport-heading">{NAME}</h3>
      <p className="prose">
        Where the map is in its service day. Moving it changes nothing the project keeps and draws
        nothing again: the page is already running the day, and this is the way to ask it where to
        be.
      </p>
      <div className="field">
        <label htmlFor={scrubId}>Time of day</label>
        <div className="transport-scrub">
          <input
            id={scrubId}
            type="range"
            min={bounds.t0}
            max={bounds.t1}
            step={SCRUB_STEP}
            // Clamped here as well as where it is set: `now` is zero for
            // the frame between the bounds arriving and the first clock
            // answering, and a value under `min` is a thumb the browser
            // draws at the start of a day that does not start there.
            value={clampTo(bounds, now)}
            // The clock the page wrote, so a screen reader hears 07:20
            // rather than 26400. Absent until the page has answered once,
            // where the seconds are all anyone has.
            aria-valuetext={clock === '' ? undefined : clock}
            onChange={(event) => scrub(event.target.value)}
            // The thumb is the person's from the moment they take hold of
            // it, not from the first value it reports: a drag that begins
            // on a playing map would otherwise have the poll move the
            // thumb out from under the pointer before the first `change`.
            // Focus does the same for the keyboard. Each `change` renews
            // it, so the only gap left is a pointer held perfectly still
            // for longer than HOLD - where the thumb is not moving anyway
            // and the page's own clock is the better answer.
            onPointerDown={hold}
            onFocus={hold}
          />
          {/* Not a live region: it changes twice a second while the day
              runs, and a polite one would read the whole day out. A screen
              reader hears the clock from the control itself, where it is
              asked for. */}
          <span className="transport-clock">{clock}</span>
        </div>
      </div>
      <div className="actions">
        <Button onClick={play}>
          <Icon name={playing ? 'pause' : 'play'} />
          {playing ? 'Pause' : 'Play day'}
        </Button>
        <div className="field transport-speed">
          {/* The kit's own select, which wraps the platform's (ADR-026),
              and the label pattern the export's choices use: the kit names
              the native control itself, so the visible label is hidden from
              the tree rather than said twice. */}
          <span className="field-label" aria-hidden="true">
            Speed
          </span>
          <Select label="Speed" value={String(speed)} onChange={(rate) => choose(Number(rate))}>
            {SPEEDS.map(({ rate, label }) => (
              <option key={rate} value={rate}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {refused !== null && (
        <p className="message error" role="alert">
          {refused}
        </p>
      )}
    </section>
  )
}
