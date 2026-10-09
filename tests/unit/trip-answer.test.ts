// Route mode's data, read before anything is drawn from it (issue 272, spec
// 030 FR-004 and FR-005): the stations `map.build` lists, and the trip the
// engine's page answers through `setTrip` and `state().trip`.
//
// Both come from outside the app's trust: the list from the engine, through
// the bridge and into a record; the trip from a page at an opaque origin
// (ADR-028). What is asserted is what each reads as - kept whole, refused
// whole - and above all the one rule the brief and the engine's own tests
// insist on: **no trip is `legs === null`, never the presence of a reason**,
// because the page's `not_serving` fallback finds a trip and gives a reason
// with it.

import { describe, expect, it } from 'vitest'
import {
  STATIONS_MAX,
  UNLISTED_STATION,
  UNREADABLE_TRIP,
  readStations,
  readTrip,
  type Station,
} from '../../src/shared/trip'

/** Spec 030's fixture (FR-006): three lines through Cedar and Hazel, ids the names in lower case. */
const NAMES = [
  'Alder',
  'Birch',
  'Cedar',
  'Damson',
  'Elm',
  'Fir',
  'Gorse',
  'Hazel',
  'Ivy',
  'Juniper',
  'Larch',
  'Maple',
  'Oak',
]
const STATIONS: Station[] = NAMES.map((name) => ({ id: name.toLowerCase(), name }))

/** The page's answer for Alder to Gorse: the Blue Line to Cedar, then the Red Line. */
const ALDER_TO_GORSE = {
  from: 'alder',
  to: 'gorse',
  legs: [
    { line: 'Blue Line', towards: 'elm', board: 'alder', alight: 'cedar', stops: 2 },
    { line: 'Red Line', towards: 'oak', board: 'cedar', alight: 'gorse', stops: 1 },
  ],
  changes: 1,
}

describe('the stations a map was drawn with', () => {
  it('keeps a list as it came, in its own order, empty names included', () => {
    const list = [
      { id: '0x6000036f4a40', name: 'Alpha' },
      { id: '0x6000036f4c80', name: 'Bravo' },
      { id: 'n9', name: '' },
    ]
    expect(readStations(list)).toEqual(list)
    expect(readStations([])).toEqual([])
  })

  it('keeps two stations that share a name, each by its own id', () => {
    const twins = [
      { id: 'b', name: 'Times Sq' },
      { id: 'a', name: 'Times Sq' },
    ]
    expect(readStations(twins)).toEqual(twins)
  })

  it('takes a name as the feed wrote it, odd characters and all', () => {
    expect(readStations([{ id: 'x', name: 'Ten\tPast' }])).toEqual([{ id: 'x', name: 'Ten\tPast' }])
  })

  it('reads a list that is not whole as no list', () => {
    for (const bad of [
      null,
      'Alpha',
      { id: 'a', name: 'Alpha' },
      [{ id: 'a' }],
      [{ name: 'Alpha' }],
      [{ id: '', name: 'Nowhere' }],
      [{ id: 7, name: 'Seven' }],
      [{ id: 'a', name: null }],
      [
        { id: 'a', name: 'One' },
        { id: 'a', name: 'Two' },
      ],
      [{ id: 'x'.repeat(201), name: 'Long' }],
      [{ id: 'a\nb', name: 'Broken' }],
      [{ id: 'a', name: 'n'.repeat(1001) }],
      ['a'],
    ]) {
      expect(readStations(bad), JSON.stringify(bad)).toBeNull()
    }
  })

  it('reads a list longer than any city as no list', () => {
    const many = Array.from({ length: STATIONS_MAX + 1 }, (_, i) => ({ id: `n${i}`, name: '' }))
    expect(readStations(many)).toBeNull()
    expect(readStations(many.slice(0, STATIONS_MAX))).toHaveLength(STATIONS_MAX)
  })
})

describe("the page's answer about a trip", () => {
  it('reads null as the whole network', () => {
    expect(readTrip(null, STATIONS)).toEqual({ kind: 'none' })
    expect(readTrip(undefined, STATIONS)).toEqual({ kind: 'none' })
  })

  it('reads a trip with its legs', () => {
    expect(readTrip(ALDER_TO_GORSE, STATIONS)).toEqual({
      kind: 'trip',
      trip: { ...ALDER_TO_GORSE, reason: null, hidden: [] },
    })
  })

  it('reads legs: null as no trip, with the page’s reason', () => {
    for (const reason of [
      'start and end are the same station',
      'no trip joins these stations',
      'the end is not a station on this map',
    ]) {
      expect(
        readTrip({ from: 'alder', to: 'oak', legs: null, changes: 0, reason }, STATIONS),
      ).toEqual({ kind: 'no-trip', reason, hidden: [] })
    }
  })

  it('reads a trip that comes with a reason as a trip, and keeps the reason as a caveat', () => {
    // The `not_serving` fallback: found as though every line stopped at
    // every station it passes, and said so. It is a trip; `legs` says so.
    const caveat = "a stop on this trip is one the map's data says its line does not make"
    const answer = readTrip({ ...ALDER_TO_GORSE, reason: caveat }, STATIONS)
    expect(answer.kind).toBe('trip')
    expect(answer).toEqual({
      kind: 'trip',
      trip: { ...ALDER_TO_GORSE, reason: caveat, hidden: [] },
    })
  })

  it('reads the lines a hidden-line answer names, with a trip or without one', () => {
    expect(readTrip({ ...ALDER_TO_GORSE, hidden: ['Green Line'] }, STATIONS)).toMatchObject({
      kind: 'trip',
      trip: { hidden: ['Green Line'] },
    })
    expect(
      readTrip(
        {
          from: 'alder',
          to: 'maple',
          legs: null,
          changes: 0,
          reason: 'no trip without hidden lines',
          hidden: ['Green Line', 'Red Line'],
        },
        STATIONS,
      ),
    ).toEqual({
      kind: 'no-trip',
      reason: 'no trip without hidden lines',
      hidden: ['Green Line', 'Red Line'],
    })
  })

  it('refuses an answer about another pair than the one asked for', () => {
    // The page answers for the pair it was given; one that answers for some
    // other listed pair is not this trip, whole as it may be.
    expect(readTrip(ALDER_TO_GORSE, STATIONS, ['alder', 'gorse']).kind).toBe('trip')
    for (const asked of [
      ['alder', 'hazel'],
      ['birch', 'gorse'],
      ['gorse', 'alder'],
    ] as const) {
      expect(readTrip(ALDER_TO_GORSE, STATIONS, asked), asked.join(' to ')).toEqual({
        kind: 'refused',
        sentence: UNREADABLE_TRIP,
      })
    }
    const noTrip = {
      from: 'alder',
      to: 'oak',
      legs: null,
      changes: 0,
      reason: 'no trip joins these stations',
    }
    expect(readTrip(noTrip, STATIONS, ['alder', 'oak']).kind).toBe('no-trip')
    expect(readTrip(noTrip, STATIONS, ['alder', 'elm']).kind).toBe('refused')
  })

  it('refuses a trip through a station the project does not list', () => {
    const elsewhere = {
      ...ALDER_TO_GORSE,
      legs: [
        { ...ALDER_TO_GORSE.legs[0], alight: 'quince' },
        { ...ALDER_TO_GORSE.legs[1], board: 'quince' },
      ],
    }
    expect(readTrip(elsewhere, STATIONS)).toEqual({ kind: 'refused', sentence: UNLISTED_STATION })
    // An end the list lacks, and a direction it lacks, the same way.
    expect(
      readTrip(
        {
          ...ALDER_TO_GORSE,
          to: 'quince',
          legs: [ALDER_TO_GORSE.legs[0], { ...ALDER_TO_GORSE.legs[1], alight: 'quince' }],
        },
        STATIONS,
      ),
    ).toEqual({ kind: 'refused', sentence: UNLISTED_STATION })
    expect(
      readTrip(
        {
          ...ALDER_TO_GORSE,
          legs: [{ ...ALDER_TO_GORSE.legs[0], towards: 'quince' }, ALDER_TO_GORSE.legs[1]],
        },
        STATIONS,
      ),
    ).toEqual({ kind: 'refused', sentence: UNLISTED_STATION })
    // Against an empty list every trip names a station it does not hold.
    expect(readTrip(ALDER_TO_GORSE, [])).toEqual({ kind: 'refused', sentence: UNLISTED_STATION })
  })

  it('refuses whatever is not the shape of a trip, and never draws half of one', () => {
    const leg = ALDER_TO_GORSE.legs[0]
    for (const bad of [
      'a trip',
      42,
      [ALDER_TO_GORSE],
      { ...ALDER_TO_GORSE, legs: [] },
      { ...ALDER_TO_GORSE, legs: 'two' },
      { ...ALDER_TO_GORSE, changes: 2 },
      { ...ALDER_TO_GORSE, changes: -1 },
      { ...ALDER_TO_GORSE, changes: 0.5 },
      { ...ALDER_TO_GORSE, from: 42 },
      { ...ALDER_TO_GORSE, reason: 7 },
      { ...ALDER_TO_GORSE, reason: '' },
      { ...ALDER_TO_GORSE, hidden: 'Green Line' },
      { ...ALDER_TO_GORSE, hidden: [''] },
      { ...ALDER_TO_GORSE, legs: [{ ...leg, stops: 0 }, ALDER_TO_GORSE.legs[1]] },
      { ...ALDER_TO_GORSE, legs: [{ ...leg, stops: 2.5 }, ALDER_TO_GORSE.legs[1]] },
      { ...ALDER_TO_GORSE, legs: [{ ...leg, line: '' }, ALDER_TO_GORSE.legs[1]] },
      { ...ALDER_TO_GORSE, legs: [{ ...leg, board: 7 }, ALDER_TO_GORSE.legs[1]] },
      { ...ALDER_TO_GORSE, legs: [null, ALDER_TO_GORSE.legs[1]] },
      // Legs that do not join: the second boards where the first did not stop.
      {
        ...ALDER_TO_GORSE,
        legs: [{ ...leg, alight: 'birch' }, ALDER_TO_GORSE.legs[1]],
      },
      // A trip that starts somewhere it was not asked from.
      { ...ALDER_TO_GORSE, from: 'birch' },
      // No trip, and no reason for it.
      { from: 'alder', to: 'oak', legs: null, changes: 0 },
      { from: 'alder', to: 'oak', legs: null, changes: 0, reason: '   ' },
      { from: 'alder', to: 'oak', legs: null, changes: 0, reason: 'r'.repeat(201) },
    ]) {
      expect(readTrip(bad, STATIONS), JSON.stringify(bad)).toEqual({
        kind: 'refused',
        sentence: UNREADABLE_TRIP,
      })
    }
  })
})
