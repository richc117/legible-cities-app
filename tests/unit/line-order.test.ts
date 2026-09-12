import { describe, expect, it } from 'vitest'
import type { Line } from '../../src/renderer/src/colours'
import {
  alphabetical,
  arrange,
  drawnFirst,
  isAlphabetical,
  move,
  nextStep,
  positionWords,
  sameOrder,
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
