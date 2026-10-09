// Cell 03's Trip section without a screen (issue 272, spec 030 FR-002,
// FR-008, FR-011 and US4): what a choice in either picker, the button and a
// new list of stations do to the pair, and exactly what the page is told.
//
// The rule the section is built on: a trip exists while both pickers hold a
// station, and only then. The page is told a trip once per pair a person
// completes and told the whole network once when a trip stops being one; a
// refused choice is not taken, and tells the page nothing.

import { describe, expect, it } from 'vitest'
import type { Station } from '../../src/shared/trip'
import {
  EMPTY,
  askOf,
  choose,
  restation,
  stationsKey,
  wholeNetwork,
  type Ask,
  type Outcome,
  type Pair,
} from '../../src/renderer/src/tripState'
import { SAME_STATION, tripRefusal } from '../../src/renderer/src/tripWords'

const ALPHA = '0x6000036f4a40'
const BRAVO = '0x6000036f4c80'
const CHARLIE = '0x6000036f4010'
const STATIONS: Station[] = [
  { id: ALPHA, name: 'Alpha' },
  { id: BRAVO, name: 'Bravo' },
  { id: CHARLIE, name: 'Charlie' },
]
const PICKERS = { start: 'Start', end: 'End' }
const HELD = tripRefusal({ laying: true, exporting: false })

/**
 * A run of choices from an empty section, keeping what the page was told
 * as the section does, and every call it was sent, in order.
 */
function walk(steps: [keyof Pair | 'whole', string | null][]): {
  pair: Pair
  told: Ask
  sent: Ask[]
} {
  let pair = EMPTY
  let told: Ask = null
  const sent: Ask[] = []
  for (const [where, id] of steps) {
    const outcome: Outcome =
      where === 'whole' ? wholeNetwork(pair, told, null) : choose(pair, where, id, told, null)
    pair = outcome.pair
    if (outcome.send !== undefined) {
      sent.push(outcome.send)
      told = outcome.send
    }
  }
  return { pair, told, sent }
}

describe('a trip, as the pickers make it', () => {
  it('asks for nothing until both pickers hold a station, then for the trip once', () => {
    const start = walk([['start', ALPHA]])
    expect(start.sent, 'Start alone: nothing is sent and the map is whole').toEqual([])
    const both = walk([
      ['start', ALPHA],
      ['end', CHARLIE],
    ])
    expect(both.sent).toEqual([[ALPHA, CHARLIE]])
    expect(both.pair).toEqual({ start: ALPHA, end: CHARLIE })
    // End first does the same.
    expect(
      walk([
        ['end', CHARLIE],
        ['start', ALPHA],
      ]).sent,
    ).toEqual([[ALPHA, CHARLIE]])
  })

  it('asks again only when the pair changes, never for the station already chosen', () => {
    const { sent } = walk([
      ['start', ALPHA],
      ['end', CHARLIE],
      ['end', CHARLIE],
      ['start', ALPHA],
      ['end', BRAVO],
    ])
    expect(sent).toEqual([
      [ALPHA, CHARLIE],
      [ALPHA, BRAVO],
    ])
  })

  it('shows the whole network once when a picker is emptied while a trip is shown', () => {
    const { sent, pair } = walk([
      ['start', ALPHA],
      ['end', CHARLIE],
      ['end', null],
    ])
    expect(sent).toEqual([[ALPHA, CHARLIE], null])
    expect(pair).toEqual({ start: ALPHA, end: null })
    // And emptying the other one too tells the page nothing more.
    expect(
      walk([
        ['start', ALPHA],
        ['end', CHARLIE],
        ['end', null],
        ['start', null],
      ]).sent,
    ).toEqual([[ALPHA, CHARLIE], null])
  })

  it('sends nothing for a picker emptied while no trip was shown', () => {
    expect(
      walk([
        ['start', ALPHA],
        ['start', null],
      ]).sent,
    ).toEqual([])
  })

  it('asks again for a pair the page was not told, when a station already chosen is chosen again', () => {
    // A call that failed, or an answer the section would not draw, leaves
    // both pickers holding the pair and the page told nothing: choosing the
    // same station again is how a person asks again, and it asks once.
    const pair = { start: ALPHA, end: CHARLIE }
    expect(choose(pair, 'end', CHARLIE, null, null)).toEqual({
      pair,
      refusals: [],
      send: [ALPHA, CHARLIE],
    })
    // Told it already, the same choice is nothing at all.
    expect(choose(pair, 'end', CHARLIE, [ALPHA, CHARLIE], null).send).toBeUndefined()
    // Half a pair is no trip to ask for again.
    expect(choose({ start: ALPHA, end: null }, 'start', ALPHA, null, null).send).toBeUndefined()
    // And while something holds the page it is refused like any choice.
    expect(choose(pair, 'end', CHARLIE, null, HELD)).toEqual({
      pair,
      refusals: [{ place: 'end', sentence: HELD }],
      send: undefined,
    })
  })

  it('names the trip a pair asks for: two stations, and two different ones', () => {
    expect(askOf({ start: ALPHA, end: CHARLIE })).toEqual([ALPHA, CHARLIE])
    expect(askOf({ start: ALPHA, end: null })).toBeNull()
    expect(askOf({ start: null, end: CHARLIE })).toBeNull()
    expect(askOf({ start: ALPHA, end: ALPHA })).toBeNull()
  })
})

describe('"Show the whole network" (FR-008)', () => {
  it('empties both pickers and tells the page the whole network, once', () => {
    const { sent, pair, told } = walk([
      ['start', ALPHA],
      ['end', CHARLIE],
      ['whole', null],
    ])
    expect(sent).toEqual([[ALPHA, CHARLIE], null])
    expect(pair).toEqual(EMPTY)
    expect(told).toBeNull()
  })

  it('tells the page nothing when it was showing the whole network already', () => {
    expect(wholeNetwork({ start: ALPHA, end: null }, null, null)).toEqual({
      pair: EMPTY,
      refusals: [],
      send: undefined,
    })
  })
})

describe('a refusal is not taken, and tells the page nothing (FR-011)', () => {
  it('refuses the same station in both pickers, beside the picker it was chosen in', () => {
    const pair = { start: ALPHA, end: null }
    expect(choose(pair, 'end', ALPHA, null, null)).toEqual({
      pair,
      refusals: [{ place: 'end', sentence: SAME_STATION }],
      send: undefined,
    })
    const other = { start: null, end: CHARLIE }
    expect(choose(other, 'start', CHARLIE, null, null).refusals).toEqual([
      { place: 'start', sentence: SAME_STATION },
    ])
  })

  it('keeps the trip on show when the same station is chosen over it', () => {
    // A to C is shown; End chosen as A again is refused, and the map keeps
    // the trip the pickers still describe.
    const shown = { start: ALPHA, end: CHARLIE }
    const outcome = choose(shown, 'end', ALPHA, [ALPHA, CHARLIE], null)
    expect(outcome.pair).toBe(shown)
    expect(outcome.send).toBeUndefined()
  })

  it('refuses a choice, an emptying and the button while a run or an export holds the page', () => {
    const shown = { start: ALPHA, end: CHARLIE }
    const told: Ask = [ALPHA, CHARLIE]
    for (const outcome of [
      choose(shown, 'end', BRAVO, told, HELD),
      choose(shown, 'start', null, told, HELD),
    ]) {
      expect(outcome.pair).toBe(shown)
      expect(outcome.send).toBeUndefined()
      expect(outcome.refusals[0].sentence).toBe(HELD)
    }
    expect(choose(shown, 'end', BRAVO, told, HELD).refusals[0].place).toBe('end')
    expect(wholeNetwork(shown, told, HELD)).toEqual({
      pair: shown,
      refusals: [{ place: 'whole', sentence: HELD }],
      send: undefined,
    })
  })
})

describe('a new list of stations under the pickers (US4 scenario 2)', () => {
  const WITHOUT_BRAVO = [STATIONS[0], STATIONS[2]]

  it('takes a station the new map does not draw out of its picker, saying so, and keeps the rest', () => {
    const outcome = restation(
      { start: BRAVO, end: CHARLIE },
      STATIONS,
      WITHOUT_BRAVO,
      [BRAVO, CHARLIE],
      PICKERS,
    )
    expect(outcome.pair).toEqual({ start: null, end: CHARLIE })
    expect(outcome.refusals).toEqual([
      { place: 'start', sentence: 'Bravo is not on the map drawn now, so Start is empty.' },
    ])
    // The trip it was is gone, so the page is told the whole network - and
    // never a trip.
    expect(outcome.send).toBeNull()
  })

  it('tells the page nothing where no trip was shown', () => {
    const outcome = restation({ start: BRAVO, end: null }, STATIONS, WITHOUT_BRAVO, null, PICKERS)
    expect(outcome.pair).toEqual(EMPTY)
    expect(outcome.send).toBeUndefined()
  })

  it('changes nothing where both stations are still on the map', () => {
    const pair = { start: ALPHA, end: CHARLIE }
    expect(restation(pair, STATIONS, WITHOUT_BRAVO, [ALPHA, CHARLIE], PICKERS)).toEqual({
      pair,
      refusals: [],
      send: undefined,
    })
  })

  it('empties both pickers when the map lists no stations at all', () => {
    const outcome = restation(
      { start: ALPHA, end: CHARLIE },
      STATIONS,
      null,
      [ALPHA, CHARLIE],
      PICKERS,
    )
    expect(outcome.pair).toEqual(EMPTY)
    expect(outcome.refusals.map((r) => r.sentence)).toEqual([
      'Alpha is not on the map drawn now, so Start is empty.',
      'Charlie is not on the map drawn now, so End is empty.',
    ])
    expect(outcome.send).toBeNull()
  })

  it('notices a new list by its stations, not by its being a new array', () => {
    expect(stationsKey(STATIONS)).toBe(stationsKey(STATIONS.map((s) => ({ ...s }))))
    expect(stationsKey(STATIONS)).not.toBe(stationsKey(WITHOUT_BRAVO))
    expect(stationsKey(null)).not.toBe(stationsKey([]))
  })
})
