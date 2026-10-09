// The sequence that gives a reloaded page back what the page before it was
// showing (A5.5-20). No React and no window: a state in, an ordered list of
// calls out, which is the whole reason the sequence is a module of its own.
//
// The order is what is asserted, not merely the membership. A list holding
// the right calls in the wrong order is a map that seeks and then plays
// away from where it was asked to be.
//
// The first call is always the project's theme (issue 349): a page restyles
// in place now, so the address's theme is only the theme of the moment it
// was made, and the load has to put the page right. Most assertions below
// are about everything after it, and read the list through `after`.

import { describe, expect, it } from 'vitest'
import { restoreCalls, type ViewerCall } from '../../src/renderer/src/viewerRestore'
import { THEMES } from '../../src/shared/project'
import { isViewerMethod } from '../../src/shared/viewer'

/** What the engine's page actually answers from `state()`. */
const PAGE_STATE = {
  now: 26_400,
  clock: '07:20',
  shown: 'map',
  mode: 'map',
  view: 0,
  str: 0,
  geo: 0,
  box: [0, 0, 100, 100],
  viewName: 'schematic',
  labels: true,
}

/** The project's theme in these tests, unless a test is about the theme. */
const THEME = 'warm-dark' as const

/** Every call but the theme's, which is the first and is asserted on its own. */
const after = (state: unknown): ViewerCall[] => {
  const [theme, ...rest] = restoreCalls(state, THEME)
  expect(theme, 'the theme is the first call').toEqual({ method: 'setTheme', args: [THEME] })
  return rest
}

const names = (state: unknown): string[] => after(state).map((call) => call.method)

describe('restoreCalls', () => {
  it('asks for nothing but the theme when there is nothing else to give back', () => {
    const only = [{ method: 'setTheme', args: [THEME] }]
    expect(restoreCalls(null, THEME)).toEqual(only)
    expect(restoreCalls(undefined, THEME)).toEqual(only)
    expect(restoreCalls({}, THEME)).toEqual(only)
  })

  it('begins with the project theme, whatever else is known, and whichever theme it is', () => {
    for (const theme of THEMES) {
      for (const state of [null, {}, PAGE_STATE, { ...PAGE_STATE, speed: 30, playing: true }]) {
        expect(restoreCalls(state, theme)[0], JSON.stringify([theme, state])).toEqual({
          method: 'setTheme',
          args: [theme],
        })
      }
    }
  })

  it('gives the project theme and not the one the page being left said', () => {
    // `state()` reports `theme` from engine v0.11.0 on, and it is the page
    // being left: the address it loaded from, or a press it has had. The
    // project's is the one on the record, which is the one to give back.
    const calls = restoreCalls({ ...PAGE_STATE, theme: 'sepia' }, 'warm-dark')
    expect(calls.filter((call) => call.method === 'setTheme')).toEqual([
      { method: 'setTheme', args: ['warm-dark'] },
    ])
  })

  it('restores the view, the labels and the clock of a real page state', () => {
    expect(after(PAGE_STATE)).toEqual([
      { method: 'showView', args: ['schematic', 0] },
      { method: 'setLabels', args: [true] },
      { method: 'seek', args: [26_400] },
    ])
  })

  it('sets the clock after everything else that could move it', () => {
    const order = names({ ...PAGE_STATE, speed: 30, playing: true })
    expect(order).toEqual(['setPlaying', 'showView', 'setLabels', 'setSpeed', 'seek', 'setPlaying'])
    // The seek is the last call that touches the clock, and playing again
    // is the only thing after it.
    expect(order.lastIndexOf('seek')).toBeGreaterThan(order.indexOf('setSpeed'))
    expect(order.lastIndexOf('seek')).toBeGreaterThan(order.indexOf('showView'))
  })

  it('stops the page before the rest and starts it again only if it was running', () => {
    const running = after({ ...PAGE_STATE, playing: true })
    expect(running[0]).toEqual({ method: 'setPlaying', args: [false] })
    expect(running[running.length - 1]).toEqual({ method: 'setPlaying', args: [true] })

    const paused = after({ ...PAGE_STATE, playing: false })
    expect(paused[0]).toEqual({ method: 'setPlaying', args: [false] })
    expect(paused.filter((call) => call.method === 'setPlaying')).toHaveLength(1)
  })

  it('leaves a page it cannot ask about running, rather than pausing it for good', () => {
    // The engine's `state()` says nothing about playing (engine issue 29's
    // seam gap), so a state without it must produce no setPlaying at all: a
    // page paused here and never started again is worse than a clock a
    // fraction of a second behind.
    // Asserted as the whole list, not as an absence: a `not.toContain` over
    // a list that had gone empty would pass just as happily.
    expect(names(PAGE_STATE)).toEqual(['showView', 'setLabels', 'seek'])
  })

  it('snaps the view rather than tweening to it', () => {
    // A duration of zero: this is a page returning to where it already was,
    // and an animation would say that something happened.
    expect(after(PAGE_STATE)).toContainEqual({
      method: 'showView',
      args: ['schematic', 0],
    })
  })

  it('names only methods the bridge will carry', () => {
    const every = restoreCalls({ ...PAGE_STATE, speed: 60, playing: true }, THEME)
    expect(every.length).toBeGreaterThan(0)
    for (const call of every) expect(isViewerMethod(call.method)).toBe(true)
  })

  it('drops what a page it does not trust got wrong', () => {
    // Everything here came from a page the app does not trust (ADR-028), so
    // a field of the wrong shape is left out rather than handed back.
    expect(names({ viewName: 42, labels: 'yes', now: 'noon' })).toEqual([])
    expect(names({ viewName: '', now: Number.NaN, speed: Number.POSITIVE_INFINITY })).toEqual([])
    expect(names({ now: -1 }), 'the service day does not start before it starts').toEqual([])
    expect(names({ speed: 0 }), 'a speed of nothing is what pausing is for').toEqual([])
    expect(names({ viewName: 'x'.repeat(65) }), 'a view name is a name, not an essay').toEqual([])
    expect(names({ viewName: 'x'.repeat(64) })).toEqual(['showView'])
  })

  it('restores a clock of zero, which is the start of the service day', () => {
    // Zero is a place, not an absence: a falsy check here would leave a map
    // scrubbed back to the first minute where it was.
    expect(after({ now: 0 })).toEqual([{ method: 'seek', args: [0] }])
    expect(after({ labels: false })).toEqual([{ method: 'setLabels', args: [false] }])
  })

  // Route mode (issue 272, spec 030 FR-009 and US4): a trip the page was
  // showing is given back after the view and the labels it is drawn over and
  // before playing resumes, as the page's own ask - its two stations - so the
  // page finds the trip again on the map it has just loaded.
  const TRIP = {
    from: '0x6000036f4a40',
    to: '0x6000036f4010',
    legs: [
      {
        line: 'A',
        towards: '0x6000036f4010',
        board: '0x6000036f4a40',
        alight: '0x6000036f4010',
        stops: 2,
      },
    ],
    changes: 0,
  }

  it('gives back the trip the page was showing, between the labels and playing', () => {
    const calls = after({ ...PAGE_STATE, trip: TRIP, speed: 30, playing: true })
    expect(calls.map((call) => call.method)).toEqual([
      'setPlaying',
      'showView',
      'setLabels',
      'setTrip',
      'setSpeed',
      'seek',
      'setPlaying',
    ])
    expect(calls).toContainEqual({ method: 'setTrip', args: ['0x6000036f4a40', '0x6000036f4010'] })
    const order = calls.map((call) => call.method)
    expect(order.indexOf('setTrip')).toBeGreaterThan(order.indexOf('setLabels'))
    expect(order.indexOf('setTrip')).toBeLessThan(order.lastIndexOf('setPlaying'))
  })

  it('gives back the trip on a page it cannot ask whether it was playing', () => {
    expect(names({ ...PAGE_STATE, trip: TRIP })).toEqual([
      'showView',
      'setLabels',
      'setTrip',
      'seek',
    ])
  })

  it('gives back no trip where the page was showing the whole network', () => {
    // A trip refused - `legs: null` and a reason - left the map whole, and a
    // page that has just loaded is whole already; so is one with no trip.
    const refused = { from: 'a', to: 'a', legs: null, changes: 0, reason: 'same' }
    for (const trip of [null, undefined, refused, { ...TRIP, legs: [] }]) {
      expect(names({ ...PAGE_STATE, trip }), JSON.stringify(trip)).toEqual([
        'showView',
        'setLabels',
        'seek',
      ])
    }
  })

  it('drops a trip whose stations a page it does not trust got wrong', () => {
    for (const trip of [
      { ...TRIP, from: 42 },
      { ...TRIP, to: '' },
      { ...TRIP, from: 'x'.repeat(201) },
      { ...TRIP, to: TRIP.from },
      'a trip',
    ]) {
      expect(names({ trip }), JSON.stringify(trip)).toEqual([])
    }
    expect(names({ trip: { ...TRIP, from: 'x'.repeat(200) } })).toEqual(['setTrip'])
  })

  it('composes no setTrip the main process would refuse: one rule for a station id', () => {
    // `isStationId` is the rule `src/main/viewer.ts` holds setTrip's
    // arguments to; an id with a control character in it fails it there,
    // so the restore does not send it either.
    for (const trip of [
      { ...TRIP, from: 'a\nb' },
      { ...TRIP, to: 'tab\there' },
      { ...TRIP, from: '\u0000' },
    ]) {
      expect(names({ trip }), JSON.stringify(trip)).toEqual([])
    }
  })

  it('takes what is not an object as nothing to restore', () => {
    for (const nonsense of ['state', 7, true, [], () => undefined]) {
      expect(after(nonsense)).toEqual([])
    }
  })
})
