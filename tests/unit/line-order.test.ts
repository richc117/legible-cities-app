import { describe, expect, it } from 'vitest'
import type { Line } from '../../src/renderer/src/colours'
import {
  alphabetical,
  arrange,
  drawnFirst,
  dropPlace,
  isAlphabetical,
  move,
  moveTo,
  nextStep,
  positionWords,
  sameOrder,
  standAside,
} from '../../src/renderer/src/order'

// The line order's pure half (A4-02, specs/020-line-order). `arrange` is
// the app's copy of the engine's own `ordered_labels`, and the first three
// tests are the engine's own cases: the named lines first, a label the feed
// does not offer passed over, and the rest in the order they came.

const lines = (...labels: string[]): Line[] => labels.map((label) => ({ label, feed: null }))
const labelsOf = (arranged: Line[]): string[] => arranged.map((line) => line.label)

describe('arrange', () => {
  const six = lines('A', 'B', 'C', 'D', 'E', 'K')

  it('is the feed’s own order when nothing has been arranged', () => {
    expect(labelsOf(arrange(six, []))).toEqual(['A', 'B', 'C', 'D', 'E', 'K'])
  })

  it('puts the lines the order names first, and the rest after', () => {
    expect(labelsOf(arrange(six, ['K', 'C']))).toEqual(['K', 'C', 'A', 'B', 'D', 'E'])
  })

  it('obeys an order that names every line', () => {
    const order = ['K', 'E', 'D', 'C', 'B', 'A']
    expect(labelsOf(arrange(six, order))).toEqual(order)
  })

  it('passes over a line the feed no longer offers, so a narrower mode still reads', () => {
    expect(labelsOf(arrange(lines('A', 'B'), ['K', 'B']))).toEqual(['B', 'A'])
  })

  it('draws a line named twice once', () => {
    expect(labelsOf(arrange(six, ['C', 'C']))).toEqual(['C', 'A', 'B', 'D', 'E', 'K'])
  })
})

describe('drawnFirst', () => {
  // The engine sorts labels the way Python's sorted does, by code point;
  // `linesOf` sorts them for a person, numerically. On a rail feed the two
  // agree, which is why only a bus feed shows the difference.
  it('is the engine’s order, not the one a person would write', () => {
    expect(labelsOf(drawnFirst(lines('2', '4', '10', '720')))).toEqual(['10', '2', '4', '720'])
  })

  it('leaves the lines it was given alone', () => {
    const given = lines('B', 'A')
    drawnFirst(given)
    expect(labelsOf(given)).toEqual(['B', 'A'])
  })
})

describe('the tail of an arrangement', () => {
  const bus = lines('2', '4', '10', '720')

  it('is what the engine would draw, so the panel does not claim otherwise', () => {
    expect(labelsOf(arrange(bus, []))).toEqual(['10', '2', '4', '720'])
    expect(labelsOf(arrange(bus, ['720']))).toEqual(['720', '10', '2', '4'])
  })

  it('is what an untouched arrangement is measured against', () => {
    expect(isAlphabetical(bus, ['10', '2', '4', '720'])).toBe(true)
    expect(isAlphabetical(bus, ['2', '4', '10', '720'])).toBe(false)
  })

  it('is where a move starts from', () => {
    expect(move(bus, [], '2', -1)).toEqual(['2', '10', '4', '720'])
  })
})

describe('move', () => {
  const three = lines('A', 'B', 'C')

  it('answers the whole arrangement, not the change to it', () => {
    expect(move(three, [], 'C', -1)).toEqual(['A', 'C', 'B'])
  })

  it('moves one place at a time, from wherever the line stands now', () => {
    expect(move(three, ['A', 'C', 'B'], 'C', -1)).toEqual(['C', 'A', 'B'])
  })

  it('moves down as well as up', () => {
    expect(move(three, [], 'A', 1)).toEqual(['B', 'A', 'C'])
  })

  it('gives the order back when the line is already at that end', () => {
    expect(move(three, [], 'A', -1)).toEqual([])
    expect(move(three, [], 'C', 1)).toEqual([])
  })

  it('gives the order back for a line the feed does not offer', () => {
    expect(move(three, [], 'K', 1)).toEqual([])
  })
})

// A drag puts a line down anywhere in one go (issue 283). Watched failing
// with an off-by-one in the splice, the line put in one place past where it
// was dropped: to the top, the middle, the collapse and the ends all fail,
// and only the carry to the end passes, since a splice past the end still
// appends. Without the collapse, only the collapse fails.
describe('moveTo', () => {
  const six = lines('A', 'B', 'C', 'D', 'E', 'K')

  it('carries the first line to the end, every line between moving up one place', () => {
    expect(moveTo(six, [], 'A', 5)).toEqual(['B', 'C', 'D', 'E', 'K', 'A'])
  })

  it('carries the last line to the top, every line between moving down one place', () => {
    expect(moveTo(six, [], 'K', 0)).toEqual(['K', 'A', 'B', 'C', 'D', 'E'])
  })

  it('puts a line down in the middle, from above it and from below it', () => {
    expect(moveTo(six, [], 'A', 3)).toEqual(['B', 'C', 'D', 'A', 'E', 'K'])
    expect(moveTo(six, [], 'K', 2)).toEqual(['A', 'B', 'K', 'C', 'D', 'E'])
  })

  it('answers the whole arrangement, from wherever the lines stand now', () => {
    expect(moveTo(six, ['K', 'C'], 'C', 5)).toEqual(['K', 'A', 'B', 'D', 'E', 'C'])
  })

  it('is no order at all when the lines come out where the engine draws them', () => {
    expect(moveTo(six, ['B', 'A'], 'B', 1)).toEqual([])
    expect(moveTo(six, ['K', 'A', 'B', 'C', 'D', 'E'], 'K', 5)).toEqual([])
  })

  it('gives the order back for a line put down where it stood, or one the feed does not offer', () => {
    expect(moveTo(six, ['K', 'C'], 'C', 1)).toEqual(['K', 'C'])
    expect(moveTo(six, [], 'Z', 2)).toEqual([])
  })

  it('takes a place past either end as that end', () => {
    expect(moveTo(six, [], 'A', 99)).toEqual(['B', 'C', 'D', 'E', 'K', 'A'])
    expect(moveTo(six, [], 'K', -3)).toEqual(['K', 'A', 'B', 'C', 'D', 'E'])
  })
})

// Where a carried row lands, from the rows' middles as the drag began: six
// rows of forty, so the middles are 20, 60, 100 and on.
describe('dropPlace', () => {
  const middles = [20, 60, 100, 140, 180, 220]

  it('stays put until the row has been carried past half of its neighbour', () => {
    expect(dropPlace(middles, 0, 0)).toBe(0)
    expect(dropPlace(middles, 0, 39)).toBe(0)
    expect(dropPlace(middles, 0, 41)).toBe(1)
    expect(dropPlace(middles, 3, -39)).toBe(3)
    expect(dropPlace(middles, 3, -41)).toBe(2)
  })

  it('counts reaching a middle exactly as passing it, whichever way the row goes', () => {
    expect(dropPlace(middles, 0, 40)).toBe(1)
    expect(dropPlace(middles, 3, -40)).toBe(2)
  })

  it('reaches either end, and a pointer past it is that end', () => {
    expect(dropPlace(middles, 0, 200)).toBe(5)
    expect(dropPlace(middles, 5, -200)).toBe(0)
    expect(dropPlace(middles, 0, 900)).toBe(5)
    expect(dropPlace(middles, 5, -900)).toBe(0)
  })
})

describe('standAside', () => {
  it('moves the rows a line passes going down up one place, and no others', () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => standAside(i, 1, 3))).toEqual([0, 0, -1, -1, 0, 0])
  })

  it('moves the rows a line passes going up down one place, and no others', () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => standAside(i, 4, 1))).toEqual([0, 1, 1, 1, 0, 0])
  })

  it('moves nothing while the line is over its own place', () => {
    expect([0, 1, 2].map((i) => standAside(i, 1, 1))).toEqual([0, 0, 0])
  })
})

describe('sameOrder', () => {
  it('is true for two lists that draw the same map', () => {
    expect(sameOrder(['A', 'B'], ['A', 'B'])).toBe(true)
  })

  it('is false when a line has moved, or when there are more of them', () => {
    expect(sameOrder(['A', 'B'], ['B', 'A'])).toBe(false)
    expect(sameOrder(['A'], ['A', 'B'])).toBe(false)
  })
})

describe('isAlphabetical', () => {
  const three = lines('A', 'B', 'C')

  it('is true when nothing has been arranged', () => {
    expect(isAlphabetical(three, alphabetical())).toBe(true)
  })

  it('is true for an order that names the lines where they already stand', () => {
    expect(isAlphabetical(three, ['A', 'B', 'C'])).toBe(true)
  })

  it('is false once a line has moved', () => {
    expect(isAlphabetical(three, ['C', 'A', 'B'])).toBe(false)
  })

  it('is true for an order naming only lines the feed no longer offers', () => {
    expect(isAlphabetical(three, ['K'])).toBe(true)
  })
})

describe('nextStep', () => {
  it('draws a change when nothing else is reading the page', () => {
    expect(nextStep(['B', 'A'], ['A', 'B'], false)).toBe('build')
  })

  it('waits rather than refusing while something else is', () => {
    expect(nextStep(['B', 'A'], ['A', 'B'], true)).toBe('wait')
  })

  it('does nothing at all for a move that ends where it began', () => {
    expect(nextStep(['A', 'B'], ['A', 'B'], false)).toBe('none')
    expect(nextStep(['A', 'B'], ['A', 'B'], true)).toBe('none')
  })
})

describe('positionWords', () => {
  it('counts from one, as a person does', () => {
    expect(positionWords(0, 6)).toBe('1 of 6')
    expect(positionWords(5, 6)).toBe('6 of 6')
  })
})
