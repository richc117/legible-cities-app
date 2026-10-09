import type { Leg, Station, Trip } from '../../shared/trip'
import type { ComboboxOption } from './kit/comboboxModel'

// Cell 03's Trip section in words (issue 272, spec 030): the steps a trip is
// read as, the line that announces it, the pickers' options and every
// sentence the section says. Pure, so each is a unit test, and a plain
// module, so an end-to-end spec can import the sentences it waits for
// without importing a component (a spec never imports one).
//
// The station names are the map's own, looked up by id in the list
// `map.build` answered; the line's label is the page's, verbatim. The app
// composes the sentences around them and invents neither.

/** The section's heading, which is its region's whole name (FR-002). */
export const TRIP = 'Trip'

/** The two pickers' names (FR-003). */
export const START = 'Start'
export const END = 'End'

/** The one button, shown while a trip is (FR-002, FR-008). */
export const WHOLE_NETWORK = 'Show the whole network'

/** What the section says first, once there is a map to pick a trip on. */
export const TRIP_INTRO =
  'Choose a start and an end station: the map fades everything off the trip between them, and the steps say how to ride it. A trip changes nothing the project keeps.'

/** A project with no layout has no map, and no control is drawn (spec 030's edge case). */
export const NOT_LAID_OUT = 'Lay the project out to plan a trip.'

/** A record drawn before the stations were kept, or whose list did not read whole. */
export const DRAW_AGAIN = 'Draw the map again to pick a trip.'

/** Both pickers on one station: refused where it was chosen, and nothing is sent. */
export const SAME_STATION = 'Start and end are the same station.'

/** A page the engine wrote before v0.13.0 has no `setTrip`. */
export const OLD_PAGE =
  'This map was drawn before it could show a trip. Draw the map again to pick a trip.'

/** The page could not be reached: between two documents, or not on the screen. */
export const NOT_READY =
  'The map is not ready to show a trip. Choose the station again in a moment.'

/** A station the feed gives no name, said by the id the map knows it by. */
export const unnamed = (id: string): string => `Unnamed station ${id}`

/** A station's name as the steps say it: the map's, or the unnamed form. */
export const stationName = (station: Station): string =>
  station.name !== '' ? station.name : unnamed(station.id)

/** Every station's name by its id, for the steps. */
export function namesOf(stations: readonly Station[]): Map<string, string> {
  return new Map(stations.map((station) => [station.id, stationName(station)]))
}

/**
 * The pickers' options: every station, in the list's order, by id. Two
 * stations with one name (New York has several) are both offered, and are
 * told apart by their place among the stations of that name - "Times Sq (1
 * of 2)" - so each option has a name of its own, the field says which one
 * was chosen, and a screen reader does not hear the same option twice.
 */
export function optionsFor(stations: readonly Station[]): ComboboxOption[] {
  const count = new Map<string, number>()
  for (const station of stations) {
    const name = stationName(station)
    count.set(name, (count.get(name) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  return stations.map((station) => {
    const name = stationName(station)
    const of = count.get(name) ?? 1
    if (of === 1) return { id: station.id, label: name }
    const place = (seen.get(name) ?? 0) + 1
    seen.set(name, place)
    return { id: station.id, label: `${name} (${place} of ${of})` }
  })
}

/** The polite line under a picker while a person types (FR-003). */
export function matchWords(count: number): string {
  if (count === 0) return 'No station matches'
  if (count === 1) return '1 station matches'
  return `${count} stations match`
}

/** "1 stop", "2 stops". */
export const stopsWords = (count: number): string => (count === 1 ? '1 stop' : `${count} stops`)

/** "no changes", "1 change", "2 changes". */
export const changesWords = (count: number): string =>
  count === 0 ? 'no changes' : count === 1 ? '1 change' : `${count} changes`

/**
 * The steps (FR-006): one per leg, two sentences each. The station comes
 * first, so no name is heard as "at" another: "At Alder, board the Blue Line
 * towards Elm. Ride 2 stops to Cedar." From the second leg on it is "change
 * to", and the last ends "and get off.".
 */
export function legSentences(legs: readonly Leg[], names: ReadonlyMap<string, string>): string[] {
  const name = (id: string): string => names.get(id) ?? unnamed(id)
  return legs.map((leg, i) => {
    const take = i === 0 ? 'board' : 'change to'
    const off = i === legs.length - 1 ? ' and get off' : ''
    return (
      `At ${name(leg.board)}, ${take} the ${leg.line} towards ${name(leg.towards)}. ` +
      `Ride ${stopsWords(leg.stops)} to ${name(leg.alight)}${off}.`
    )
  })
}

/** The trip in one line, announced once when it changes (FR-007): "3 stops, 1 change." */
export function tripSummary(trip: Pick<Trip, 'legs' | 'changes'>): string {
  const stops = trip.legs.reduce((sum, leg) => sum + leg.stops, 0)
  return `${stopsWords(stops)}, ${changesWords(trip.changes)}.`
}

/** Under a trip found without the lines a person hid (spec 030 US2 scenario 3). */
export const avoidsWords = (hidden: readonly string[]): string =>
  `Avoids the lines you hid: ${hidden.join(', ')}.`

/** Under a refusal that came of the lines a person hid. */
export const hiddenWords = (hidden: readonly string[]): string =>
  `The lines you hid: ${hidden.join(', ')}.`

/**
 * One of the page's reasons as a sentence. The page's reasons are its own
 * short facts ("no trip joins these stations") and are said as they come,
 * word for word; only the first letter and the full stop are the app's, so
 * they read as the sentences everything else on the screen is.
 */
export function reasonSentence(reason: string): string {
  const said = reason.trim()
  if (said === '') return said
  const first = said.charAt(0).toUpperCase() + said.slice(1)
  return /[.!?]$/.test(first) ? first : `${first}.`
}

/** A chosen station a new layout does not draw (spec 030 US4 scenario 2). */
export const goneWords = (name: string, picker: string): string =>
  `${name} is not on the map drawn now, so ${picker} is empty.`

/**
 * Why a trip cannot be chosen or cleared just now, or null where it can: the
 * transport's reasons, in the trip's words. A run rewrites the page, and an
 * export reads it; a choice made into either is refused with a sentence, and
 * nothing disables (FR-011).
 */
export function tripRefusal(page: { laying: boolean; exporting: boolean }): string | null {
  if (page.laying) return 'The map is being drawn. A trip can be chosen again when the run ends.'
  if (page.exporting) return 'The export is reading the map. A trip can be chosen again afterwards.'
  return null
}
