// A page an older engine drew, and what the project screen does about it
// (issue 465): the judgement from the page's seam (`isOlderPage`, with the
// answer read as data by `readSeams`), and the rule for redrawing the page a
// project opened on (`redrawOnOpen`).

import { describe, expect, it } from 'vitest'
import {
  OPENING_REDRAW_FAILED,
  OPENING_REDRAW_FALLBACK,
  keepFocusInCell,
  openingRedrawFailedSentence,
  openingRedrawFailure,
  redrawOnOpen,
  type FocusedElement,
  type OnOpenFacts,
  type OpeningFailureFacts,
} from '../../src/renderer/src/notebook/olderPage'
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
    expect(redrawOnOpen(facts({}, { date: null }))).toEqual({ kind: 'never' })
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

  it('never redraws a record from before `drawn` existed, which keeps today’s fallback', () => {
    expect(redrawOnOpen(facts({}, { drawn: null }))).toEqual({ kind: 'never' })
  })
})

// Issue 517, decided 25 Oct 2026: a redraw on open that fails says so as an
// error in cell 03, in words for a person who pressed nothing. Which failure
// is the opening's is derived from the run's latest job against the job the
// opening started, never stored as a flag. Each clause below is shown red by
// the mutation its comment names.
describe('what cell 03 says when the redraw on open failed', () => {
  const HINT = 'la-metro-rail has no stored layout cccccccc'
  /** The opening's redraw, failed as a rebuild: what the run's snapshot says of it. */
  const FAILED: OpeningFailureFacts['run'] = {
    state: 'failed',
    rebuilt: true,
    recoloured: false,
    reordered: false,
    restyled: false,
    replaced: false,
    download: null,
    feedMissing: false,
    error: HINT,
    unkept: false,
  }
  const failure = (over: Partial<OpeningFailureFacts> = {}, run: Partial<typeof FAILED> = {}) =>
    openingRedrawFailure({ asked: 'job-1', job: 'job-1', ...over, run: { ...FAILED, ...run } })

  it('is said, with the engine’s reason, where the opening’s own job failed as cell 03’s', () => {
    expect(failure()).toEqual({ reason: HINT })
  })

  it('is not said where the screen started no redraw', () => {
    // Mutation: the `asked === null` clause removed - a run whose job cannot
    // be read (null) matches a screen that asked for none (null).
    expect(failure({ asked: null, job: null })).toBeNull()
    expect(failure({ asked: null, job: 'job-1' })).toBeNull()
  })

  it('is not said of a later job, such as Run all pressed after the failure', () => {
    // Mutation: the job's id not compared - a rebuild a person asked for is
    // told it was the opening's.
    expect(failure({ job: 'job-2' })).toBeNull()
  })

  it('is not said while the redraw goes, or once it was stopped or drew', () => {
    // Mutation: the state clause removed - cell 03 says the redraw failed
    // while it is still running.
    for (const state of ['running', 'cancelled', 'done', 'idle'] as const)
      expect(failure({}, { state, error: null }), state).toBeNull()
  })

  it('is not said where the press became another cell’s run under the same job', () => {
    // Mutation: the cell clause removed - Run all makes a layout of the press
    // where the record it read has no layout, under the same job, and that
    // layout's failure is cell 02's.
    expect(failure({}, { rebuilt: false }), 'a layout').toBeNull()
    expect(failure({}, { rebuilt: false, recoloured: true }), 'a recolour').toBeNull()
    expect(failure({}, { feedMissing: true }), 'at the feed').toBeNull()
  })

  it('is not said where the map was redrawn and the record then would not keep it', () => {
    // Mutation: the `unkept` clause removed - cell 03 says the map could not
    // be redrawn of a map that was (issue 399).
    expect(failure({}, { unkept: true })).toBeNull()
  })

  it('says the reason as the jobs inspector does, with no path in it', () => {
    // Mutation: the reason handed on as `run.error`, unscreened.
    const said = failure({}, { error: 'could not read /var/folders/x/out/la-metro-rail.html' })
    expect(said?.reason).toBe('could not read a file')
  })

  it('says what was tried, then the reason, then what still holds', () => {
    // Mutation: the reason left out of the sentence.
    expect(openingRedrawFailedSentence(HINT)).toBe(`${OPENING_REDRAW_FAILED} ${HINT}`)
    expect(openingRedrawFailedSentence(null)).toBe(OPENING_REDRAW_FAILED)
    expect(openingRedrawFailedSentence('')).toBe(OPENING_REDRAW_FAILED)
    expect(OPENING_REDRAW_FAILED).toMatch(/older version of the engine/)
    expect(OPENING_REDRAW_FAILED).toMatch(/could not be redrawn as the project opened/)
    expect(OPENING_REDRAW_FALLBACK).toMatch(/stays as it was/)
    expect(OPENING_REDRAW_FALLBACK).toMatch(/theme/)
    expect(OPENING_REDRAW_FALLBACK).toMatch(/trip cannot be shown/)
  })
})

// A redraw on open can start while a person is in a control the run disables
// - the day they have just picked is what makes it wait - and Chromium blurs a
// disabled element to the body. So focus goes to the cell's heading first.
describe('focus as the redraw is asked for', () => {
  /** A cell with a heading, and a control in it, as far as the handback reads them. */
  function cellWith(heading: boolean) {
    const focused: unknown[] = []
    const head = { focus: (options?: unknown) => focused.push(options) }
    const cell = {
      querySelector: (selector: string) =>
        heading && selector === '.disclosure-heading' ? head : null,
    }
    const inCell = (el: object): FocusedElement =>
      ({
        ...el,
        closest: (selector: string) => (selector === '.cell' ? cell : null),
      }) as unknown as FocusedElement
    return { focused, head: inCell(head), control: inCell({}) }
  }

  it('goes from a control in a cell to that cell’s heading, without scrolling', () => {
    // Mutation: `keepFocusInCell` returning before it focuses anything - focus
    // stays in the control the run disables, and falls to the body.
    const { focused, control } = cellWith(true)
    expect(keepFocusInCell(control)).toBe(true)
    expect(focused).toEqual([{ preventScroll: true }])
  })

  it('stays where it is on the heading, outside any cell, or nowhere', () => {
    const { focused } = cellWith(true)
    const heading = { focus: () => focused.push('again') }
    const cell = { querySelector: () => heading }
    const onHeading = { closest: () => cell } as unknown as FocusedElement
    Object.assign(heading, onHeading)
    expect(keepFocusInCell(heading as unknown as FocusedElement), 'already on it').toBe(false)
    const outside = { closest: () => null } as unknown as FocusedElement
    expect(keepFocusInCell(outside), 'outside a cell').toBe(false)
    expect(keepFocusInCell(null), 'nothing focused').toBe(false)
    expect(focused).toEqual([])
  })

  it('stays where it is in a cell with no heading to take it', () => {
    const { focused, control } = cellWith(false)
    expect(keepFocusInCell(control)).toBe(false)
    expect(focused).toEqual([])
  })
})
