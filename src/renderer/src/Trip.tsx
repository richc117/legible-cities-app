import { useEffect, useId, useRef, useState, type JSX } from 'react'
import { readTrip, type Station, type TripAnswer } from '../../shared/trip'
import Button from './kit/Button'
import { LiveRegion, useAnnouncer } from './Jobs'
import Combobox from './kit/Combobox'
import { lacksTheSeam } from './themeWrites'
import {
  EMPTY,
  choose,
  refusalsAfter,
  restation,
  stationsKey,
  wholeNetwork,
  type Ask,
  type Outcome,
  type Pair,
  type Picker,
  type Place,
  type Refusal,
} from './tripState'
import {
  DRAW_AGAIN,
  END,
  NOT_LAID_OUT,
  NOT_READY,
  OLD_PAGE,
  START,
  TRIP,
  TRIP_INTRO,
  WHOLE_NETWORK,
  avoidsWords,
  hiddenWords,
  legSentences,
  matchWords,
  namesOf,
  optionsFor,
  reasonSentence,
  tripRefusal,
  tripSummary,
} from './tripWords'

// The trip, cell 03's third section (issue 272, spec 030, ADR-048): a start
// and an end station, and the map fades everything off the trip between
// them, which the steps then say in words.
//
// **The page finds and draws the trip; this draws neither** (principle I).
// The section asks the engine's page through its seam - `setTrip(from, to)`
// and `setTrip(null)`, from the main process, as the transport does - and
// what the page answers is read as untrusted data (`readTrip`) before a word
// of it is drawn. It asks the engine nothing, builds no map, writes no record
// and marks no cell stale: a trip is view state (FR-001, FR-010), and a page
// reloaded by a run is given it back by the viewer's restore, not by this.
//
// **The pickers offer the map's own stations** (FR-004): `map.build`'s list,
// kept in the record's `drawn` because a project opened again draws its map
// from the stored files without a build. A record from before the list was
// kept offers none and says so, and nothing is disabled (FR-011).
//
// The pair, what the page is told, and every refusal are `tripState.ts`'s;
// every sentence is `tripWords.ts`'s. This is the wiring.

/** The two sentences a held page is refused with, which go when the hold does. */
const HOLDS = [
  tripRefusal({ laying: true, exporting: false }),
  tripRefusal({ laying: false, exporting: true }),
]

/**
 * The announcement (FR-007): once per trip shown, and nothing while there is
 * none. The region is emptied and filled a frame or two later so a trip
 * whose counts repeat the last one's is still said, and both are written to
 * the region's element and not rendered from state: an empty and a refill
 * made by a state setter can land in one render, and a refill equal to what
 * shows writes nothing (issue 466, after issue 330).
 */
export function TripSummary({
  view,
  nextFrame,
}: {
  view: TripAnswer
  /** The wait between the empty region and the sentence; the page's two frames unless a test hands its own. */
  nextFrame?: (then: () => void) => unknown
}): JSX.Element {
  const { region, announce } = useAnnouncer(nextFrame)
  useEffect(() => {
    // What was waiting for its frame is withdrawn: a view that has changed
    // again must not be followed by the sentence of the one before.
    announce.silence()
    if (view.kind === 'trip') announce(tripSummary(view.trip))
  }, [view, announce])
  return <LiveRegion region={region} className="prose trip-summary" role="status" />
}

export default function Trip({
  hasLayout,
  stations,
  laying,
  exporting,
}: {
  /** Whether there is a layout, and so a map to pick a trip on. */
  hasLayout: boolean
  /** The stations the map was drawn with, from the record's `drawn`; null where none were kept. */
  stations: Station[] | null
  /** A layout, a rebuild, a recolour, a reorder or a resize holds the project's page. */
  laying: boolean
  /** An export is reading the page frame by frame. */
  exporting: boolean
}): JSX.Element {
  const headingId = useId()
  const held = tripRefusal({ laying, exporting })

  const [pair, setPair] = useState<Pair>(EMPTY)
  const [refusals, setRefusals] = useState<Refusal[]>([])
  // What the section shows of the page's answer: nothing, a trip, the
  // page's reason, or the app's refusal of an answer it would not draw.
  const [view, setView] = useState<TripAnswer>({ kind: 'none' })

  // The pair as it stands, for the effect that answers a new list of
  // stations; what the page was last asked; which ask an answer belongs to,
  // so a slow answer never lands over a newer one; the stations an answer
  // is read against; and whether the screen is still here.
  const pairNow = useRef<Pair>(EMPTY)
  const told = useRef<Ask>(null)
  const asked = useRef(0)
  const listNow = useRef<Station[] | null>(stations)
  const mounted = useRef(true)
  const start = useRef<HTMLInputElement>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    listNow.current = stations
  })

  const update = (next: Pair): void => {
    pairNow.current = next
    setPair(next)
  }

  /** Tell the page, and remember what it was told. */
  const tell = (ask: Ask): Promise<unknown> => {
    told.current = ask
    return ask === null
      ? window.api.viewer.call('map', 'setTrip', null)
      : window.api.viewer.call('map', 'setTrip', ask[0], ask[1])
  }

  /**
   * Ask for a trip, or for the whole network, and show what comes back.
   * One call per ask: the page is never asked again for an answer.
   */
  const send = (ask: Ask): void => {
    const mine = (asked.current += 1)
    setView({ kind: 'none' })
    if (ask === null) {
      void tell(null).catch(() => undefined)
      return
    }
    tell(ask).then(
      (value) => {
        if (mine !== asked.current || !mounted.current) return
        const read = readTrip(value, listNow.current ?? [], ask)
        setView(read)
        // An answer the steps will not list may still be a trip the page
        // has faded the map for: the map is put back whole, so the two
        // never disagree about what is shown.
        if (read.kind === 'refused') {
          asked.current += 1
          void tell(null).catch(() => undefined)
        }
      },
      (error: unknown) => {
        if (mine !== asked.current || !mounted.current) return
        // Not taken: the page has no seam for it, or is not there.
        told.current = null
        setView({ kind: 'refused', sentence: lacksTheSeam(error) ? OLD_PAGE : NOT_READY })
      },
    )
  }

  /** An act's outcome: the pair, the sentences beside the control, the call. */
  const apply = (outcome: Outcome, place: Place): void => {
    const before = pairNow.current
    setRefusals((current) => refusalsAfter(current, outcome, place, before))
    if (outcome.refusals.length > 0) return
    if (outcome.pair !== before) update(outcome.pair)
    if (outcome.send !== undefined) send(outcome.send)
  }

  const pick = (picker: Picker, id: string | null): void =>
    apply(choose(pairNow.current, picker, id, told.current, held), picker)

  const whole = (): void => {
    const outcome = wholeNetwork(pairNow.current, told.current, held)
    // The button goes with its own press, so focus is handed to Start
    // first: that is where the next trip begins (FR-002), and Chromium
    // would otherwise leave it on the body.
    if (outcome.refusals.length === 0) start.current?.focus()
    apply(outcome, 'whole')
  }

  // A new list of stations: a run laid the map out again. A chosen station
  // the new map does not draw leaves its picker with a sentence saying so,
  // and a trip that leaves is cleared on the page (spec 030 US4 scenario 2).
  const key = stationsKey(stations)
  const before = useRef({ key, stations })
  useEffect(() => {
    const was = before.current
    if (was.key === key) return
    before.current = { key, stations }
    const outcome = restation(pairNow.current, was.stations, stations, told.current, {
      start: START,
      end: END,
    })
    if (outcome.refusals.length === 0) return
    update(outcome.pair)
    setRefusals(outcome.refusals)
    if (outcome.send !== undefined) send(outcome.send)
    // The list is read through its key: a record read again hands a new
    // array of the same stations, which is no change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // The hold goes, and so does what it was refused with: a sentence left
  // standing after the run that caused it reads as a control that is broken.
  // In the render that sees the hold go, and guarded on a hold's sentence
  // being there, not on the list's length: the filter makes a new list, so
  // an unguarded call would set state on every render. A refusal of
  // another kind, such as the same station twice, stays.
  const holdSaid = (refusal: Refusal): boolean => HOLDS.includes(refusal.sentence)
  if (held === null && refusals.some(holdSaid))
    setRefusals((current) => current.filter((refusal) => !holdSaid(refusal)))

  const refusalAt = (place: Place): string | null =>
    refusals.find((refusal) => refusal.place === place)?.sentence ?? null

  const trip = view.kind === 'trip' ? view.trip : null
  const names = namesOf(stations ?? [])
  const options = optionsFor(stations ?? [])
  // What the page said instead of a trip, or why the app will not draw what
  // it said: under the pickers, in the error colour, the map whole.
  const instead =
    view.kind === 'no-trip'
      ? [
          reasonSentence(view.reason),
          ...(view.hidden.length > 0 ? [hiddenWords(view.hidden)] : []),
        ].join(' ')
      : view.kind === 'refused'
        ? view.sentence
        : null

  return (
    <section className="trip" aria-labelledby={headingId}>
      {/* Named by its heading alone (FR-002): a region with a label as well
          would be said twice on the way in. The transport's rule, for the
          transport's reason - this is about the map on screen, which the
          cell's own heading does not name. */}
      <h3 id={headingId}>{TRIP}</h3>
      {!hasLayout ? (
        // No map, so nothing to pick a trip on, and no control drawn for it.
        <p className="prose">{NOT_LAID_OUT}</p>
      ) : (
        <>
          <p className="prose">{TRIP_INTRO}</p>
          {stations === null && <p className="prose">{DRAW_AGAIN}</p>}
          <div className="inline-form trip-form">
            <Combobox
              ref={start}
              label={START}
              options={options}
              value={pair.start}
              onChoose={(id) => pick('start', id)}
              onClear={() => pick('start', null)}
              countWords={matchWords}
              message={refusalAt('start')}
            />
            <Combobox
              label={END}
              options={options}
              value={pair.end}
              onChoose={(id) => pick('end', id)}
              onClear={() => pick('end', null)}
              countWords={matchWords}
              message={refusalAt('end')}
            />
          </div>
          <p className="message error trip-instead" role="alert">
            {instead}
          </p>
          <TripSummary view={view} />
          {trip !== null && (
            <>
              <ol className="trip-steps">
                {legSentences(trip.legs, names).map((sentence, i) => (
                  <li key={i}>{sentence}</li>
                ))}
              </ol>
              {trip.reason !== null && <p className="trip-note">{reasonSentence(trip.reason)}</p>}
              {trip.hidden.length > 0 && <p className="trip-note">{avoidsWords(trip.hidden)}</p>}
              <div className="actions trip-actions">
                <Button onClick={whole}>{WHOLE_NETWORK}</Button>
              </div>
            </>
          )}
          <p className="message error" role="alert">
            {refusalAt('whole')}
          </p>
        </>
      )}
    </section>
  )
}
