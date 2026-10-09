// Route mode's data (issue 272, spec 030, ADR-048): the stations a map was
// drawn with, as `map.build` lists them, and the trip the engine's page
// answers between two of them. Pure: the main process reads the list when
// it writes a record, and the renderer reads the trip before it draws a
// word of it.
//
// Both arrive from somewhere the app does not trust. The list comes from the
// engine, through the renderer and the bridge, into a file. The trip comes
// from the page, which runs at an opaque origin and carries text from a
// transit feed (ADR-028), and the page's own `state().trip` is a claim like
// the rest of what it says. So each is checked for shape, size and sense
// before anything is drawn from it; a list that is not whole is no list,
// and a trip that is not whole is refused with a sentence and never half
// drawn.

/** One station of the map, as `map.build` lists it: what `setTrip` takes, and the name the map writes. */
export interface Station {
  /** The node id in the stored layout. */
  id: string
  /** The name the map writes for it; the empty string where the feed gives none. */
  name: string
}

/**
 * The most stations a list may hold. The registry's largest network draws
 * well under a thousand; this is room for a city larger than any of them,
 * and a bound on what a record can be made to carry.
 */
export const STATIONS_MAX = 20_000

/** The longest station id read: LOOM's node ids are a few dozen characters. */
export const STATION_ID_MAX = 200

/** The longest station name read, which is a name and not a paragraph. */
export const STATION_NAME_MAX = 200

/** The longest line label the page's answer may carry. The label is drawn verbatim. */
export const TRIP_LABEL_MAX = 200

/** The longest reason the page may give. Its reasons are a short sentence each. */
export const TRIP_REASON_MAX = 200

/** The most legs read: a trip of a hundred changes is not a trip. */
export const TRIP_LEGS_MAX = 100

/** The most stops one leg may ride. */
export const TRIP_STOPS_MAX = 100_000

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Text the feed wrote - a station's name, a line's label - which is drawn as
 * text and never as markup, so only its length is bounded: a name with an
 * odd character in it is still that station's name.
 */
const isFeedText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max

/** Text the app or the engine wrote - an id, a reason - which carries no control character either. */
const isText = (value: unknown, max: number): value is string => {
  if (typeof value !== 'string' || value.length > max) return false
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
}

/**
 * The stations of a map, whole, or null. Every entry is an object with an
 * id and a name, each a string of sensible length, and no id appears
 * twice: an id is what the page is asked for, so two the same would make
 * one option stand for two stations. The order is kept as it came, which
 * is the engine's (by name as code points, then by id). Anything else is
 * not half-trusted: a list that cannot be read is no list.
 */
export function readStations(value: unknown): Station[] | null {
  if (!Array.isArray(value) || value.length > STATIONS_MAX) return null
  const seen = new Set<string>()
  const stations: Station[] = []
  for (const entry of value) {
    if (!isObject(entry)) return null
    const { id, name } = entry
    if (!isText(id, STATION_ID_MAX) || id === '' || seen.has(id)) return null
    if (!isFeedText(name, STATION_NAME_MAX)) return null
    seen.add(id)
    stations.push({ id, name })
  }
  return stations
}

/** One leg of a trip: a line boarded at one station and left at another. */
export interface Leg {
  /** The line's label, verbatim. */
  line: string
  /** The station at the end of the line it is heading for, by id. */
  towards: string
  board: string
  alight: string
  /** Stops after boarding, the alighting one included: at least one. */
  stops: number
}

/** A trip the page found and is showing. */
export interface Trip {
  from: string
  to: string
  legs: Leg[]
  changes: number
  /**
   * A caveat the page attached to a trip it still found: the `not_serving`
   * fallback, which routes as though every line stopped at every station it
   * passes and says so. Null when there is none.
   */
  reason: string | null
  /** The lines hidden on the page, which the trip was found without. */
  hidden: string[]
}

/** What `setTrip` or `state().trip` answered, once read. */
export type TripAnswer =
  /** No trip: the page shows the whole network. */
  | { kind: 'none' }
  /** A trip, with its legs. */
  | { kind: 'trip'; trip: Trip }
  /** No trip between the two, and the page's reason; the map is whole. */
  | { kind: 'no-trip'; reason: string; hidden: string[] }
  /** An answer the app will not draw from, and the sentence that says so. */
  | { kind: 'refused'; sentence: string }

/** What an answer that is not the shape of a trip is told. */
export const UNREADABLE_TRIP =
  'The map’s answer about the trip could not be read, so no trip is shown.'

/** What an answer naming a station the project does not list is told. */
export const UNLISTED_STATION =
  'The map named a station this project does not list, so no trip is shown. Draw the map again to pick a trip.'

const refused = (sentence: string): TripAnswer => ({ kind: 'refused', sentence })

/** The hidden lines a page named, or null when they are not the shape of a list of labels. */
function readHidden(value: unknown): string[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > TRIP_LEGS_MAX * 10) return null
  const labels: string[] = []
  for (const label of value) {
    if (!isFeedText(label, TRIP_LABEL_MAX) || label === '') return null
    labels.push(label)
  }
  return labels
}

/** A count the page gave: a whole number inside its range. */
const isCount = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

/**
 * The page's answer about a trip, read against the stations the map was
 * drawn with.
 *
 * Null is the whole network. An answer with `legs: null` is no trip, and its
 * reason is the page's own sentence (`legs === null` decides it, never the
 * presence of `reason`, which a found trip carries too). An answer with legs
 * is a trip only when every leg is whole, every station it names is one of
 * `stations`, the legs join up from `from` to `to`, and `changes` is one
 * fewer than the legs; anything less is refused with a sentence, so a page
 * that says something odd is never drawn as a list of steps.
 */
export function readTrip(value: unknown, stations: readonly Station[]): TripAnswer {
  if (value === null || value === undefined) return { kind: 'none' }
  if (!isObject(value)) return refused(UNREADABLE_TRIP)
  const hidden = readHidden(value.hidden)
  if (hidden === null) return refused(UNREADABLE_TRIP)
  if (value.legs === null) {
    const { reason } = value
    if (!isText(reason, TRIP_REASON_MAX) || reason.trim() === '') return refused(UNREADABLE_TRIP)
    return { kind: 'no-trip', reason: reason.trim(), hidden }
  }
  const { from, to, legs, changes, reason } = value
  if (!Array.isArray(legs) || legs.length === 0 || legs.length > TRIP_LEGS_MAX)
    return refused(UNREADABLE_TRIP)
  if (!isText(from, STATION_ID_MAX) || !isText(to, STATION_ID_MAX)) return refused(UNREADABLE_TRIP)
  if (!isCount(changes, 0, TRIP_LEGS_MAX) || changes !== legs.length - 1)
    return refused(UNREADABLE_TRIP)
  if (reason !== undefined && (!isText(reason, TRIP_REASON_MAX) || reason.trim() === ''))
    return refused(UNREADABLE_TRIP)
  const listed = new Set(stations.map((station) => station.id))
  const read: Leg[] = []
  for (const leg of legs) {
    if (!isObject(leg)) return refused(UNREADABLE_TRIP)
    const { line, towards, board, alight, stops } = leg
    if (!isFeedText(line, TRIP_LABEL_MAX) || line === '') return refused(UNREADABLE_TRIP)
    if (!isCount(stops, 1, TRIP_STOPS_MAX)) return refused(UNREADABLE_TRIP)
    for (const id of [towards, board, alight])
      if (!isText(id, STATION_ID_MAX)) return refused(UNREADABLE_TRIP)
    if (![towards, board, alight].every((id) => listed.has(id as string)))
      return refused(UNLISTED_STATION)
    read.push({
      line,
      towards: towards as string,
      board: board as string,
      alight: alight as string,
      stops,
    })
  }
  // The legs are one journey: it starts where it was asked from, each leg
  // boards where the last one left off, and it ends where it was asked to.
  if (read[0].board !== from || read[read.length - 1].alight !== to) return refused(UNREADABLE_TRIP)
  for (let i = 1; i < read.length; i++)
    if (read[i].board !== read[i - 1].alight) return refused(UNREADABLE_TRIP)
  return {
    kind: 'trip',
    trip: {
      from,
      to,
      legs: read,
      changes,
      reason: typeof reason === 'string' ? reason.trim() : null,
      hidden,
    },
  }
}
