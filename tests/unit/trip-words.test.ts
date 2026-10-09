// Cell 03's Trip section in words (issue 272, spec 030): the steps a trip is
// read as (FR-006), the line that announces it (FR-007), the polite count
// under a picker (FR-003), the pickers' options (FR-004) and the section's
// sentences.
//
// The expectations are the spec's own, word for word: its three fixture
// trips are built here from hand-made legs and a hand-made list of stations
// that use the spec's names, as the page would answer them for engine 49's
// fixture (Blue Line: Alder, Birch, Cedar, Damson, Elm; Red Line: Fir,
// Cedar, Gorse, Hazel, Oak; Green Line: Ivy, Hazel, Juniper, Larch, Maple).

import { describe, expect, it } from 'vitest'
import type { Leg, Station } from '../../src/shared/trip'
import {
  avoidsWords,
  changesWords,
  goneWords,
  hiddenWords,
  legSentences,
  matchWords,
  namesOf,
  optionsFor,
  reasonSentence,
  stopsWords,
  tripRefusal,
  tripSummary,
} from '../../src/renderer/src/tripWords'

/** The fixture's stations, by ids that are not their names, in `map.build`'s order. */
const STATIONS: Station[] = [
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
].map((name, i) => ({ id: `n${i}`, name }))

const id = (name: string): string => {
  const station = STATIONS.find((s) => s.name === name)
  if (station === undefined) throw new Error(name)
  return station.id
}

const leg = (line: string, towards: string, board: string, alight: string, stops: number): Leg => ({
  line,
  towards: id(towards),
  board: id(board),
  alight: id(alight),
  stops,
})

const NAMES = namesOf(STATIONS)

describe('the steps (FR-006)', () => {
  it('reads a trip on one line as its two sentences', () => {
    const legs = [leg('Blue Line', 'Elm', 'Alder', 'Damson', 3)]
    expect(legSentences(legs, NAMES)).toEqual([
      'At Alder, board the Blue Line towards Elm. Ride 3 stops to Damson and get off.',
    ])
  })

  it('reads a trip with one change as two steps, the second a change', () => {
    const legs = [
      leg('Blue Line', 'Elm', 'Alder', 'Cedar', 2),
      leg('Red Line', 'Oak', 'Cedar', 'Gorse', 1),
    ]
    expect(legSentences(legs, NAMES)).toEqual([
      'At Alder, board the Blue Line towards Elm. Ride 2 stops to Cedar.',
      'At Cedar, change to the Red Line towards Oak. Ride 1 stop to Gorse and get off.',
    ])
  })

  it('reads a trip with two changes as three steps', () => {
    const legs = [
      leg('Blue Line', 'Elm', 'Alder', 'Cedar', 2),
      leg('Red Line', 'Oak', 'Cedar', 'Hazel', 2),
      leg('Green Line', 'Maple', 'Hazel', 'Larch', 2),
    ]
    expect(legSentences(legs, NAMES)).toEqual([
      'At Alder, board the Blue Line towards Elm. Ride 2 stops to Cedar.',
      'At Cedar, change to the Red Line towards Oak. Ride 2 stops to Hazel.',
      'At Hazel, change to the Green Line towards Maple. Ride 2 stops to Larch and get off.',
    ])
  })

  it('says the line’s label verbatim, and a station with no name by its id', () => {
    const names = namesOf([...STATIONS, { id: 'x9', name: '' }])
    const legs = [{ line: 'A', towards: 'x9', board: id('Alder'), alight: 'x9', stops: 1 }]
    expect(legSentences(legs, names)).toEqual([
      'At Alder, board the A towards Unnamed station x9. Ride 1 stop to Unnamed station x9 and get off.',
    ])
  })
})

describe('the announcement (FR-007)', () => {
  it('counts the stops of every leg and the changes, once, in one line', () => {
    expect(tripSummary({ legs: [leg('Blue Line', 'Elm', 'Alder', 'Damson', 3)], changes: 0 })).toBe(
      '3 stops, no changes.',
    )
    expect(
      tripSummary({
        legs: [
          leg('Blue Line', 'Elm', 'Alder', 'Cedar', 2),
          leg('Red Line', 'Oak', 'Cedar', 'Gorse', 1),
        ],
        changes: 1,
      }),
    ).toBe('3 stops, 1 change.')
    expect(
      tripSummary({
        legs: [
          leg('Blue Line', 'Elm', 'Alder', 'Cedar', 2),
          leg('Red Line', 'Oak', 'Cedar', 'Hazel', 2),
          leg('Green Line', 'Maple', 'Hazel', 'Larch', 2),
        ],
        changes: 2,
      }),
    ).toBe('6 stops, 2 changes.')
    expect(tripSummary({ legs: [leg('A', 'Birch', 'Alder', 'Birch', 1)], changes: 0 })).toBe(
      '1 stop, no changes.',
    )
  })

  it('words a count of one in the singular and none as none', () => {
    expect([stopsWords(1), stopsWords(2)]).toEqual(['1 stop', '2 stops'])
    expect([changesWords(0), changesWords(1), changesWords(3)]).toEqual([
      'no changes',
      '1 change',
      '3 changes',
    ])
  })
})

describe('the polite line under a picker (FR-003)', () => {
  it('says how many stations match', () => {
    expect(matchWords(0)).toBe('No station matches')
    expect(matchWords(1)).toBe('1 station matches')
    expect(matchWords(3)).toBe('3 stations match')
    expect(matchWords(400)).toBe('400 stations match')
  })
})

describe('the pickers’ options (FR-004)', () => {
  it('are the stations, by id, in the list’s order, named as the map names them', () => {
    expect(optionsFor(STATIONS.slice(0, 3))).toEqual([
      { id: 'n0', label: 'Alder' },
      { id: 'n1', label: 'Birch' },
      { id: 'n2', label: 'Cedar' },
    ])
  })

  it('lists two stations of one name both, each by its id, each named apart', () => {
    const twins: Station[] = [
      { id: 'q', name: 'Times Sq' },
      { id: 'p', name: 'Times Sq' },
      { id: 'r', name: 'Union Sq' },
    ]
    const options = optionsFor(twins)
    expect(options).toEqual([
      { id: 'q', label: 'Times Sq (1 of 2)' },
      { id: 'p', label: 'Times Sq (2 of 2)' },
      { id: 'r', label: 'Union Sq' },
    ])
    expect(new Set(options.map((o) => o.label)).size).toBe(options.length)
  })

  it('names a station the feed gave no name by its id', () => {
    expect(optionsFor([{ id: 'x9', name: '' }])).toEqual([
      { id: 'x9', label: 'Unnamed station x9' },
    ])
  })
})

describe('what the section says around a trip', () => {
  it('names the lines a trip avoided, and the lines that left no trip', () => {
    expect(avoidsWords(['A', 'C'])).toBe('Avoids the lines you hid: A, C.')
    expect(hiddenWords(['Long', 'Up'])).toBe('The lines you hid: Long, Up.')
  })

  it('says the page’s reason as it came, as a sentence', () => {
    expect(reasonSentence('no trip joins these stations')).toBe('No trip joins these stations.')
    expect(reasonSentence('start and end are the same station')).toBe(
      'Start and end are the same station.',
    )
    expect(
      reasonSentence("a stop on this trip is one the map's data says its line does not make"),
    ).toBe("A stop on this trip is one the map's data says its line does not make.")
    expect(reasonSentence('Already a sentence.')).toBe('Already a sentence.')
  })

  it('says which picker a station that left the map was taken out of', () => {
    expect(goneWords('Bravo', 'Start')).toBe(
      'Bravo is not on the map drawn now, so Start is empty.',
    )
  })

  it('refuses a choice while a run or an export holds the page, and not otherwise', () => {
    expect(tripRefusal({ laying: false, exporting: false })).toBeNull()
    expect(tripRefusal({ laying: true, exporting: false })).toBe(
      'The map is being drawn. A trip can be chosen again when the run ends.',
    )
    expect(tripRefusal({ laying: false, exporting: true })).toBe(
      'The export is reading the map. A trip can be chosen again afterwards.',
    )
  })
})
