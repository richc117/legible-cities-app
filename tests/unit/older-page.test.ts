// A page an older engine drew, and what the project screen does about it
// (issue 465): the judgement from the page's seam (`isOlderPage`, with the
// answer read as data by `readSeams`), and the rule for redrawing the page a
// project opened on (`redrawOnOpen`).

import { describe, expect, it } from 'vitest'
import {
  NO_TRIP_ON_IT,
  ON_SCREEN_AS_IT_WAS,
  OPENING_REDRAW_FAILED,
  OPENING_REDRAW_STOPPED,
  THEME_BY_RELOAD,
  frameFailure,
  frameFailureWords,
  keepFocusInCell,
  openPlanOf,
  openingFallback,
  pageLacks,
  processStoppedSentence,
  redrawOnOpen,
  type FocusedElement,
  type FrameFailureFacts,
  type OnOpenFacts,
} from '../../src/renderer/src/notebook/olderPage'
import type { DrawnFrom, ProjectRecord, ServiceWindow } from '../../src/shared/project/types'
import { PAGE_SEAM_NAMES, PAGE_SEAM_SINCE } from '../../src/shared/protocol'
import { engineBefore } from '../../src/renderer/src/record'
import { SEAMS_MAX, VIEWER_METHODS, isOlderPage, readSeams } from '../../src/shared/viewer'

/** The seam of a page drawn at the pin. */
const CURRENT: string[] = [...PAGE_SEAM_NAMES]

/** The seam of a page drawn before `version`, by the schema's `since`. */
const seamBefore = (version: string): string[] =>
  CURRENT.filter((name) =>
    engineBefore(PAGE_SEAM_SINCE[name as keyof typeof PAGE_SEAM_SINCE], version),
  )

/**
 * The seam of the pages the engine drew before each seam it added: before
 * `setTheme` (no theme), before `setTrip` (no trip) and before the opening's
 * two (no opening), by the version the schema says each arrived at.
 */
const before = (...gone: string[]): string[] => CURRENT.filter((name) => !gone.includes(name))
const NO_THEME = seamBefore(PAGE_SEAM_SINCE.setTheme)
const NO_TRIP = seamBefore(PAGE_SEAM_SINCE.setTrip)
const NO_OPENING = seamBefore(PAGE_SEAM_SINCE.setCard)

describe('which pages an older engine drew', () => {
  it('names every method the app drives among the pinned page’s', () => {
    for (const method of VIEWER_METHODS) expect(PAGE_SEAM_NAMES).toContain(method)
  })

  // The schema's `since` is what the older pages are made from, so it is
  // held here to the order the engine added its seams in: the theme, then
  // the trip, then the opening's two together, and nothing else since its
  // first page.
  it('arrived, by the schema, in the order the engine added them', () => {
    expect(NO_THEME).toEqual(before('setTheme', 'setTrip', 'setCard', 'setDrawn'))
    expect(NO_TRIP).toEqual(before('setTrip', 'setCard', 'setDrawn'))
    expect(NO_OPENING).toEqual(before('setCard', 'setDrawn'))
    expect(PAGE_SEAM_SINCE.setDrawn).toBe(PAGE_SEAM_SINCE.setCard)
  })

  it('is not one drawn at the pin', () => {
    expect(isOlderPage(CURRENT)).toBe(false)
  })

  it('is one drawn before each seam the engine added, not only the theme', () => {
    expect(isOlderPage(NO_THEME), 'no setTheme').toBe(true)
    expect(isOlderPage(NO_TRIP), 'setTheme, and no setTrip').toBe(true)
    // The page that has setTheme and setTrip and lacks only the opening's two:
    // a test tuned to the theme would call it current.
    expect(isOlderPage(NO_OPENING), 'setTheme and setTrip, and no opening').toBe(true)
  })

  it('is one lacking any single seam of the pin’s, whichever it is', () => {
    for (const name of PAGE_SEAM_NAMES) expect(isOlderPage(before(name)), name).toBe(true)
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
  // Drawn by the running engine, so older or not by its seam alone unless a
  // test says otherwise (issue 494).
  engine: '0.19.0',
}

/** A `drawn` block that names no engine: every block written before issue 494. */
const UNNAMED: DrawnFrom = { ...DRAWN }
delete UNNAMED.engine

/** A laid-out project whose page an older engine drew, with everything else in order. */
const facts = (over: Partial<OnOpenFacts> = {}, project: Partial<OnOpenFacts['project']> = {}) =>
  ({
    older: true,
    running: '0.19.0',
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

// Issue 494: a page with every seam the pinned page has is older still where
// its record says an engine below the running one drew it (`drawn.engine`).
// The seam's judgement stays for a record from before the field, and either
// test saying older is enough.
describe('redrawing the page a project opened on, by the engine that drew it', () => {
  /** A page with every seam, its record naming the engine that drew it. */
  const by = (engine: string | undefined, over: Partial<OnOpenFacts> = {}) =>
    facts(
      { older: false, ...over },
      { drawn: engine === undefined ? UNNAMED : { ...DRAWN, engine } },
    )

  it('redraws a page with every seam that an engine below the running one drew', () => {
    // Mutation: the version not read (`byVersion` left out) - the page
    // v0.15.0 to v0.18.x drew, with every seam, is kept as current.
    expect(redrawOnOpen(by('0.18.1'))).toEqual({ kind: 'redraw', date: '2026-06-16' })
    expect(redrawOnOpen(by('0.15.0'))).toEqual({ kind: 'redraw', date: '2026-06-16' })
    // And where its page did not say what its seam has.
    expect(redrawOnOpen(by('0.18.1', { older: null }))).toEqual({
      kind: 'redraw',
      date: '2026-06-16',
    })
  })

  it('never redraws one drawn at the running engine’s version, or above it', () => {
    // Mutation: the comparison `<=` - every page the pin drew is redrawn on
    // every opening.
    expect(redrawOnOpen(by('0.19.0'))).toEqual({ kind: 'never' })
    expect(redrawOnOpen(by('0.20.0'))).toEqual({ kind: 'never' })
  })

  it('still redraws one lacking a seam, whatever version its record names', () => {
    // Mutation: the version made to override the seam - a page that cannot
    // take a theme in place kept because its record says the pin drew it.
    expect(redrawOnOpen(by('0.19.0', { older: true }))).toEqual({
      kind: 'redraw',
      date: '2026-06-16',
    })
    expect(redrawOnOpen(by('0.20.0', { older: true }))).toEqual({
      kind: 'redraw',
      date: '2026-06-16',
    })
  })

  it('redraws a page with every seam whose record names no engine, once its engine has answered', () => {
    // Decided by the maintainer, 25 Oct 2026: every record drawn before the
    // field counts as older, so the v0.15.0 to v0.18.x pages are redrawn once.
    // Mutation: a record naming none judged by its seam alone (the old rule) -
    // it is kept as current.
    expect(redrawOnOpen(by(undefined))).toEqual({ kind: 'redraw', date: '2026-06-16' })
    expect(redrawOnOpen(by(undefined, { older: null }))).toEqual({
      kind: 'redraw',
      date: '2026-06-16',
    })
    // A value the reader would not take is dropped as it is read; were one to
    // reach here, it is judged as none.
    expect(redrawOnOpen(by('0.18', {}))).toEqual({ kind: 'redraw', date: '2026-06-16' })
    // A record never drawn has nothing to redraw, whatever it names.
    expect(redrawOnOpen(facts({ older: false }, { drawn: null }))).toEqual({ kind: 'never' })
  })

  it('judges by the seam alone where the running engine’s version is not one it reads', () => {
    expect(redrawOnOpen(by(undefined, { running: '0.19.0rc1' }))).toEqual({ kind: 'never' })
    expect(redrawOnOpen(by('0.18.1', { running: '0.19.0rc1' }))).toEqual({ kind: 'never' })
    expect(redrawOnOpen(by('0.18.1', { running: '0.19.0rc1', older: true }))).toEqual({
      kind: 'redraw',
      date: '2026-06-16',
    })
  })

  it('waits for the engine’s handshake before judging a page by version', () => {
    // Mutation: the wait removed - a page whose seam is current, opened
    // before the engine is ready, is settled as current for the screen and
    // never redrawn, though its record says an older engine drew it, or none.
    const away = { running: null, engineReady: false }
    expect(redrawOnOpen(by('0.18.1', away))).toEqual({ kind: 'wait' })
    expect(redrawOnOpen(by(undefined, away)), 'a record naming none').toEqual({ kind: 'wait' })
    expect(redrawOnOpen(by('0.19.0', away)), 'one the running engine may yet match').toEqual({
      kind: 'wait',
    })
    // And the rest of the rule still comes first.
    expect(redrawOnOpen(by('0.18.1', { ...away, drawnHere: 1 }))).toEqual({ kind: 'never' })
    expect(
      redrawOnOpen(
        facts({ older: false, ...away }, { drawn: { ...DRAWN, engine: '0.18.1' }, readOnly: true }),
      ),
    ).toEqual({ kind: 'never' })
  })

  it('withdraws once the store’s record names the running engine, as the redraw’s own write does', () => {
    // The redraw happens once (issue 465): its rebuild's write names the
    // engine that drew it, so a record read after it asks for nothing.
    const record = (engine: string | undefined) =>
      ({
        layout: 'abc123',
        made: '2026-09-10T00:00:01+00:00',
        date: '2026-06-16',
        drawn: engine === undefined ? UNNAMED : { ...DRAWN, engine },
        service: WINDOW,
      }) as unknown as ProjectRecord
    const plan = openPlanOf({ older: false, running: '0.19.0', drawnHere: 0 }, false)
    expect(plan(record('0.18.1'))).toEqual({ kind: 'rebuild', date: '2026-06-16' })
    expect(plan(record(undefined)), 'one naming none').toEqual({
      kind: 'rebuild',
      date: '2026-06-16',
    })
    expect(plan(record('0.19.0'))).toEqual({ kind: 'none' })
  })
})

// Issue 517, decided 25 Oct 2026: a redraw on open that fails says so as an
// error in cell 03, in words for a person who pressed nothing; every other
// failed rebuild of cell 03's own says so there plainly. Which failure is the
// opening's is derived from the run's latest job against the job the opening
// started, never stored as a flag, and what still holds of the map on screen
// from the seams its page lacks. Each clause below is shown red by the
// mutation its comment names.
describe('what cell 03 says when a rebuild of its own failed', () => {
  const HINT = 'la-metro-rail has no stored layout cccccccc'
  /** A failed rebuild for the 16th: what the run's snapshot says of it. */
  const FAILED: FrameFailureFacts['run'] = {
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
    day: '2026-06-16',
  }
  const failure = (over: Partial<FrameFailureFacts> = {}, run: Partial<typeof FAILED> = {}) =>
    frameFailure({
      asked: 'job-1',
      job: 'job-1',
      seams: NO_THEME,
      ...over,
      run: { ...FAILED, ...run },
    })
  const PLAIN = { kind: 'rebuild', reason: HINT, day: '2026-06-16' }

  it('is the opening’s, with its reason and what its page lacks, for the job the opening started', () => {
    expect(failure()).toEqual({ kind: 'opening', reason: HINT, lacks: { theme: true, trip: true } })
  })

  it('is plain where the screen started no redraw: the failure met again after a remount', () => {
    // Mutation: the `asked !== null` clause removed - a run whose job cannot
    // be read (null) matches a screen that asked for none (null).
    expect(failure({ asked: null, job: null })).toEqual(PLAIN)
    expect(failure({ asked: null, job: 'job-1' })).toEqual(PLAIN)
  })

  it('is plain for a later job, such as Run all pressed after the failure', () => {
    // Mutation: the job's id not compared - a rebuild a person asked for is
    // told it was the opening's.
    expect(failure({ job: 'job-2' })).toEqual(PLAIN)
  })

  it('is plain for a rebuild a person asked for, with no day where the run has none', () => {
    // Mutation: the run's day not carried - the plain words name no day.
    expect(failure({ asked: null }, { day: null })).toEqual({ ...PLAIN, day: null })
  })

  it('is nothing while the rebuild goes, or once it was stopped or drew', () => {
    // Mutation: the state clause removed - cell 03 says a rebuild failed
    // while it is still running.
    for (const state of ['running', 'cancelled', 'done', 'idle'] as const)
      expect(failure({}, { state, error: null }), state).toBeNull()
  })

  it('is nothing where the failed run is another cell’s, under the same job or not', () => {
    // Mutation: the cell clause removed - Run all makes a layout of the press
    // where the record it read has no layout, under the same job, and that
    // layout's failure is cell 02's.
    expect(failure({}, { rebuilt: false }), 'a layout').toBeNull()
    expect(failure({}, { rebuilt: false, recoloured: true }), 'a recolour').toBeNull()
    expect(failure({}, { feedMissing: true }), 'at the feed').toBeNull()
  })

  it('is nothing where the map was drawn and the record then would not keep it', () => {
    // Mutation: the `unkept` clause removed - cell 03 says the map could not
    // be redrawn, or that the rebuild did not finish, of a map that was drawn
    // (issue 399); cell 02's own sentence for it is the true one.
    expect(failure({}, { unkept: true }), 'the opening’s job').toBeNull()
    expect(failure({ job: 'job-2' }, { unkept: true }), 'any other').toBeNull()
  })

  it('gives the reason as the jobs inspector does, with no path in it', () => {
    // Mutation: the reason handed on as `run.error`, unscreened.
    const said = failure({}, { error: 'could not read /var/folders/x/out/la-metro-rail.html' })
    expect(said?.reason).toBe('could not read a file')
  })

  it('tells a page older only by version, which has every seam, neither the theme’s nor the trip’s sentence', () => {
    // Issue 494: such a page takes a theme and a trip in place, so what
    // still holds of it is only that the map stays as it was. Mutation: the
    // lacks built from "older" - the page told it cannot take either.
    const opening = failure({ seams: CURRENT })
    expect(opening).toEqual({ kind: 'opening', reason: HINT, lacks: { theme: false, trip: false } })
    expect(frameFailureWords(opening!)).toEqual({
      error: OPENING_REDRAW_FAILED,
      reason: 'la-metro-rail has no stored layout cccccccc.',
      fallback: ON_SCREEN_AS_IT_WAS,
    })
  })

  it('lacks, of the theme and the trip, only what the page’s seam does not have', () => {
    // Mutation: the lacks built from "older" - every older page told both.
    expect(pageLacks(NO_OPENING), 'only the opening’s two').toEqual({ theme: false, trip: false })
    expect(pageLacks(before('setTrip')), 'only setTrip').toEqual({ theme: false, trip: true })
    expect(pageLacks(NO_TRIP), 'no trip and no opening').toEqual({ theme: false, trip: true })
    expect(pageLacks(NO_THEME), 'none of them').toEqual({ theme: true, trip: true })
    expect(pageLacks(before('setTheme')), 'only setTheme').toEqual({ theme: true, trip: false })
    expect(pageLacks(null), 'a page that did not say').toEqual({ theme: false, trip: false })
    expect(failure({ seams: NO_OPENING })).toMatchObject({ lacks: { theme: false, trip: false } })
  })

  it('says what still holds for the seams the page lacks and no others', () => {
    // Mutation: either clause said whatever the page lacks.
    expect(openingFallback({ theme: false, trip: false })).toBe(ON_SCREEN_AS_IT_WAS)
    expect(openingFallback({ theme: false, trip: true })).toBe(
      `${ON_SCREEN_AS_IT_WAS} ${NO_TRIP_ON_IT}`,
    )
    expect(openingFallback({ theme: true, trip: false })).toBe(
      `${ON_SCREEN_AS_IT_WAS} ${THEME_BY_RELOAD}`,
    )
    expect(openingFallback({ theme: true, trip: true })).toBe(
      `${ON_SCREEN_AS_IT_WAS} ${THEME_BY_RELOAD} ${NO_TRIP_ON_IT}`,
    )
    // The condition, not a remedy: the engine's reason before it says what
    // would draw the map again.
    expect(NO_TRIP_ON_IT).toBe('It cannot show a trip until the map is drawn again.')
    expect(ON_SCREEN_AS_IT_WAS).toBe('The map on screen stays as it was.')
  })

  it('says the opening’s words, the reason as a sentence, then what still holds', () => {
    // Mutation: the reason handed on with no closing stop, or with its first
    // letter raised - the feed's key then spelled as neither the engine nor the
    // jobs inspector spells it.
    const opening = failure()
    expect(opening).not.toBeNull()
    expect(frameFailureWords(opening!)).toEqual({
      error: OPENING_REDRAW_FAILED,
      reason: 'la-metro-rail has no stored layout cccccccc.',
      fallback: `${ON_SCREEN_AS_IT_WAS} ${THEME_BY_RELOAD} ${NO_TRIP_ON_IT}`,
    })
    expect(OPENING_REDRAW_FAILED).toMatch(/older version of the engine/)
    expect(OPENING_REDRAW_FAILED).toMatch(/could not be redrawn as the project opened/)
    // A reason already a sentence is left as it is; none is nothing.
    expect(frameFailureWords({ ...opening!, reason: 'The engine stopped.' }).reason).toBe(
      'The engine stopped.',
    )
    expect(frameFailureWords({ ...opening!, reason: null }).reason).toBe('')
  })

  it('says a plain failure with its day and reason, and nothing of what holds', () => {
    // Mutation: the plain kind given the opening's words.
    expect(frameFailureWords(failure({ job: 'job-2' })!)).toEqual({
      error: 'The rebuild for 2026-06-16 did not finish.',
      reason: 'la-metro-rail has no stored layout cccccccc.',
      fallback: null,
    })
    expect(frameFailureWords(failure({ job: 'job-2' }, { day: null })!).error).toBe(
      'The rebuild did not finish.',
    )
  })

  it('has cell 02 point at cell 03 for the opening’s failure, and keep its own sentence otherwise', () => {
    // Mutation: `processStoppedSentence` answering the ordinary sentence
    // always, or the neutral one for any failure of cell 03's.
    const ordinary = 'The map was not drawn for that day.'
    expect(processStoppedSentence(failure(), ordinary)).toBe(OPENING_REDRAW_STOPPED)
    expect(processStoppedSentence(failure({ job: 'job-2' }), ordinary)).toBe(ordinary)
    expect(processStoppedSentence(null, ordinary)).toBe(ordinary)
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
