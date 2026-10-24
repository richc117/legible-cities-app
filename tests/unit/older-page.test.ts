// A page an older engine drew, and what the project screen does about it
// (issue 465): the judgement from the page's seam (`isOlderPage`, with the
// answer read as data by `readSeams`), and the rule for redrawing the page a
// project opened on (`redrawOnOpen`).

import { describe, expect, it } from 'vitest'
import { redrawOnOpen, type OnOpenFacts } from '../../src/renderer/src/notebook/olderPage'
import type { DrawnFrom, ServiceWindow } from '../../src/shared/project'
import {
  PAGE_SEAMS,
  SEAMS_MAX,
  VIEWER_METHODS,
  isOlderPage,
  readSeams,
} from '../../src/shared/viewer'

/** The seam of a page drawn at the pin. */
const CURRENT: string[] = [...PAGE_SEAMS]

/**
 * The seam of the pages the engine drew before each seam it added: before
 * v0.11.0 (no theme), v0.11.0 to v0.12.x (no trip) and v0.13.0 to v0.14.x
 * (no opening), as each version's page.html has it.
 */
const before = (...gone: string[]): string[] => CURRENT.filter((name) => !gone.includes(name))
const V0_10 = before('setTheme', 'setTrip', 'setCard', 'setDrawn')
const V0_12 = before('setTrip', 'setCard', 'setDrawn')
const V0_14 = before('setCard', 'setDrawn')

describe('which pages an older engine drew', () => {
  it('names every method the app drives among the pinned page’s', () => {
    for (const method of VIEWER_METHODS) expect(PAGE_SEAMS).toContain(method)
  })

  it('is not one drawn at the pin', () => {
    expect(isOlderPage(CURRENT)).toBe(false)
  })

  it('is one drawn before each seam the engine added, not only the theme', () => {
    expect(isOlderPage(V0_10), 'no setTheme').toBe(true)
    expect(isOlderPage(V0_12), 'setTheme, and no setTrip').toBe(true)
    // The page that has setTheme and setTrip and lacks only the opening's two:
    // a test tuned to the theme would call it current.
    expect(isOlderPage(V0_14), 'setTheme and setTrip, and no opening').toBe(true)
  })

  it('is one lacking any single seam of the pin’s, whichever it is', () => {
    for (const name of PAGE_SEAMS) expect(isOlderPage(before(name)), name).toBe(true)
  })

  it('is not one a newer engine drew, with seams beyond the pin’s', () => {
    expect(isOlderPage([...CURRENT, 'setSomethingNew'])).toBe(false)
  })

  it('cannot be said of a page that did not say', () => {
    expect(isOlderPage(null)).toBeNull()
    // A page with a seam and none of its methods did say: it is older.
    expect(isOlderPage([])).toBe(true)
  })
})

describe('what a page says about its seam, read as data', () => {
  it('is the names it gave, once each', () => {
    expect(readSeams(['seek', 'state', 'seek'])).toEqual(['seek', 'state'])
  })

  it('is no answer for anything but a list of method names', () => {
    expect(readSeams(null)).toBeNull()
    expect(readSeams('seek,state')).toBeNull()
    expect(readSeams({ 0: 'seek', length: 1 })).toBeNull()
    // One bad entry makes the whole answer none, never a list cut to its good part.
    expect(readSeams(['seek', 7])).toBeNull()
    expect(readSeams(['seek', 'not a name'])).toBeNull()
    expect(readSeams(['seek', ''])).toBeNull()
    expect(readSeams(['seek', 'x'.repeat(65)])).toBeNull()
    expect(readSeams(['seek', 'x'.repeat(64)])).toEqual(['seek', 'x'.repeat(64)])
  })

  it('is no answer past its bound, however good the names', () => {
    const many = Array.from({ length: SEAMS_MAX + 1 }, (_, i) => `m${i}`)
    expect(readSeams(many)).toBeNull()
    expect(readSeams(many.slice(0, SEAMS_MAX))).toHaveLength(SEAMS_MAX)
  })
})

const WINDOW: ServiceWindow = {
  start: '2026-01-01',
  end: '2026-12-31',
  busiest: '2026-06-16',
  anchor: '2026-06-16',
}

const DRAWN: DrawnFrom = {
  layout: 'abc123',
  made: '2026-09-10T00:00:01+00:00',
  date: '2026-06-16',
  colors: {},
  defaultColor: '#888888',
  lineOrder: [],
  theme: 'warm-dark',
  style: {},
}

/** A laid-out project whose page an older engine drew, with everything else in order. */
const facts = (over: Partial<OnOpenFacts> = {}, project: Partial<OnOpenFacts['project']> = {}) =>
  ({
    older: true,
    engineReady: true,
    busy: false,
    drawnHere: 0,
    ...over,
    project: {
      layout: 'abc123',
      made: '2026-09-10T00:00:01+00:00',
      date: '2026-06-16',
      drawn: DRAWN,
      service: WINDOW,
      readOnly: false,
      ...project,
    },
  }) as OnOpenFacts

describe('redrawing the page a project opened on', () => {
  it('redraws an older page once the engine is ready, for the day the map shows', () => {
    expect(redrawOnOpen(facts())).toEqual({ kind: 'redraw', date: '2026-06-16' })
  })

  it('never redraws a current page, or one that did not say', () => {
    expect(redrawOnOpen(facts({ older: false }))).toEqual({ kind: 'never' })
    expect(redrawOnOpen(facts({ older: null }))).toEqual({ kind: 'never' })
  })

  it('waits while the engine is away or not ready, or the page is held', () => {
    expect(redrawOnOpen(facts({ engineReady: false }))).toEqual({ kind: 'wait' })
    expect(redrawOnOpen(facts({ busy: true }))).toEqual({ kind: 'wait' })
  })

  it('never redraws once a run has drawn the page on this screen', () => {
    expect(redrawOnOpen(facts({ drawnHere: 1 }))).toEqual({ kind: 'never' })
    // Even while it would otherwise wait.
    expect(redrawOnOpen(facts({ drawnHere: 1, engineReady: false }))).toEqual({ kind: 'never' })
  })

  it('never writes a record this build may not write', () => {
    expect(redrawOnOpen(facts({}, { readOnly: true }))).toEqual({ kind: 'never' })
  })

  it('never redraws a project with no layout or no day', () => {
    expect(redrawOnOpen(facts({}, { layout: null }))).toEqual({ kind: 'never' })
    expect(redrawOnOpen(facts({}, { date: null, drawn: null }))).toEqual({ kind: 'never' })
  })

  it('leaves a day chosen and not drawn to the person who chose it', () => {
    expect(redrawOnOpen(facts({}, { date: '2026-06-17' }))).toEqual({ kind: 'never' })
  })

  it('never moves the map to a layout it was not drawn from', () => {
    expect(redrawOnOpen(facts({}, { layout: 'def456' }))).toEqual({ kind: 'never' })
    expect(redrawOnOpen(facts({}, { made: '2026-09-11T00:00:01+00:00' }))).toEqual({
      kind: 'never',
    })
  })

  it('never draws a day the store would refuse to keep', () => {
    expect(redrawOnOpen(facts({}, { service: { ...WINDOW, start: '2026-07-01' } }))).toEqual({
      kind: 'never',
    })
    expect(redrawOnOpen(facts({}, { service: null }))).toEqual({ kind: 'never' })
  })

  it('redraws a record from before `drawn` existed, for its own day', () => {
    expect(redrawOnOpen(facts({}, { drawn: null }))).toEqual({ kind: 'redraw', date: '2026-06-16' })
  })
})
