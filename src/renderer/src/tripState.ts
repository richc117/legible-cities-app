import type { Station } from '../../shared/trip'
import { SAME_STATION, goneWords, stationName } from './tripWords'

// Cell 03's Trip section without React (issue 272, spec 030): what a choice
// in either picker, the button and a new list of stations do to the pair of
// stations, and what the page is to be told. `Trip.tsx` is the wiring.
//
// **A trip exists while both pickers hold a station, and only then**
// (FR-002). Until then nothing is sent and the map is whole. The page is
// told a trip exactly once per pair a person completes, and told
// `setTrip(null)` exactly once when a trip it was told stops being one - a
// picker emptied, the button pressed, a station a new layout does not draw.
// A keystroke tells it nothing: a combobox's choice is made by choosing.
//
// **A choice that is refused is not taken.** The same station in both
// pickers, or a choice made while a run or an export holds the page, leaves
// the pair as it was and says why beside the picker it was made in; the
// field then shows its station again (`comboboxModel.ts`). So the pair on
// screen and the trip on the map never disagree, and no refusal needs a
// second act to undo.

/** The two pickers. */
export type Picker = 'start' | 'end'

/** Where a refusal is said: beside a picker, or beside the button. */
export type Place = Picker | 'whole'

/** What the two pickers hold, by station id. */
export interface Pair {
  start: string | null
  end: string | null
}

export const EMPTY: Pair = { start: null, end: null }

/** The two stations the page is asked for, or null for the whole network. */
export type Ask = readonly [string, string] | null

/** The trip a pair asks for: both stations, and two different ones. */
export function askOf(pair: Pair): Ask {
  return pair.start !== null && pair.end !== null && pair.start !== pair.end
    ? [pair.start, pair.end]
    : null
}

/** A sentence said beside the control that caused it (FR-011). */
export interface Refusal {
  place: Place
  sentence: string
}

/**
 * What an act did. `send` is the call to make: two stations, the whole
 * network (null), or nothing at all (undefined).
 */
export interface Outcome {
  pair: Pair
  refusals: Refusal[]
  send: Ask | undefined
}

/** What to tell the page when the pair becomes `next`, given what it was last told. */
function toTell(next: Pair, told: Ask): Ask | undefined {
  const ask = askOf(next)
  if (ask !== null)
    return told !== null && told[0] === ask[0] && told[1] === ask[1] ? undefined : ask
  return told === null ? undefined : null
}

/**
 * A station chosen in one picker, or the picker emptied (`id` null).
 * `told` is what the page was last asked; `held` is why the page cannot be
 * changed now, or null (`tripRefusal`).
 */
export function choose(
  pair: Pair,
  picker: Picker,
  id: string | null,
  told: Ask,
  held: string | null,
): Outcome {
  // The station already chosen, chosen again: nothing, unless the page was
  // never told the trip the pair asks for - a call that failed, or an
  // answer the section refused - and then this is how a person asks again.
  if (pair[picker] === id) {
    const again = toTell(pair, told)
    if (again === undefined) return { pair, refusals: [], send: undefined }
    if (held !== null)
      return { pair, refusals: [{ place: picker, sentence: held }], send: undefined }
    return { pair, refusals: [], send: again }
  }
  if (held !== null) return { pair, refusals: [{ place: picker, sentence: held }], send: undefined }
  const other = picker === 'start' ? pair.end : pair.start
  if (id !== null && id === other)
    return { pair, refusals: [{ place: picker, sentence: SAME_STATION }], send: undefined }
  const next = { ...pair, [picker]: id }
  return { pair: next, refusals: [], send: toTell(next, told) }
}

/**
 * "Show the whole network" (FR-008): both pickers empty, and the page told
 * once. Refused, like a choice, while something holds the page.
 */
export function wholeNetwork(pair: Pair, told: Ask, held: string | null): Outcome {
  if (held !== null)
    return { pair, refusals: [{ place: 'whole', sentence: held }], send: undefined }
  return { pair: EMPTY, refusals: [], send: told === null ? undefined : null }
}

/**
 * A new list of stations under the pickers: a layout run replaced the map
 * (spec 030 US4 scenario 2). A chosen station the new list does not hold is
 * taken out of its picker with a sentence naming it, by the name the old
 * list gave it; a station both lists hold stays. No list at all holds
 * nothing. If that leaves no trip where the page was told one, it is told
 * the whole network, once; it is never told a trip here.
 */
export function restation(
  pair: Pair,
  before: readonly Station[] | null,
  after: readonly Station[] | null,
  told: Ask,
  names: { start: string; end: string },
): Outcome {
  const kept = new Set((after ?? []).map((station) => station.id))
  const known = new Map((before ?? []).map((station) => [station.id, station]))
  const next: Pair = { ...pair }
  const refusals: Refusal[] = []
  for (const picker of ['start', 'end'] as const) {
    const id = pair[picker]
    if (id === null || kept.has(id)) continue
    next[picker] = null
    const station = known.get(id)
    const name = station === undefined ? id : stationName(station)
    refusals.push({ place: picker, sentence: goneWords(name, names[picker]) })
  }
  if (refusals.length === 0) return { pair, refusals, send: undefined }
  return { pair: next, refusals, send: askOf(next) === null && told !== null ? null : undefined }
}

/**
 * A list's identity, for noticing that it changed: its ids, in order, or a
 * mark no list of ids can make for no list at all (an id carries no control
 * character, `readStations`).
 */
export const stationsKey = (stations: readonly Station[] | null): string =>
  stations === null ? '\u0000' : stations.map((station) => station.id).join('\n')
