// Cell 03's transport, without a screen (A5.5-16): what the app may believe
// about the engine page's clock, what it has to remember because the page
// cannot be asked, and what it refuses.
//
// The component around this is wiring - a poll, a debounce and four calls
// on the bridge - and everything that could be wrong in a way a person
// would meet is here: a page's answer taken at face value, a clock read
// back as the app's own, a memory that pauses a map and never starts it
// again.

import { describe, expect, it, vi } from 'vitest'
import {
  PAGE_PLAYING,
  PAGE_SPEED,
  SPEEDS,
  TransportMemory,
  clampTo,
  readBounds,
  readClock,
  shownPlaying,
  shownSpeed,
  transportFor,
  transportRefusal,
  withRemembered,
} from '../../src/renderer/src/transportState'
import { restoreCalls } from '../../src/renderer/src/viewerRestore'

/** What the engine's own page answers from `bounds()` and `state()`. */
const BOUNDS = { t0: 14_400, t1: 100_800 }
const STATE = {
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

const NOTHING = { laying: false, exporting: false, previewing: false }

describe('the day the page says it has', () => {
  it('reads a real answer', () => {
    expect(readBounds(BOUNDS)).toEqual({ t0: 14_400, t1: 100_800 })
  })

  it('refuses anything a control cannot be built from', () => {
    // Every one of these would otherwise reach a range control's min or
    // max, where a NaN makes every position invalid without an error
    // anywhere. The page is not trusted (ADR-028) and this is arithmetic.
    for (const answer of [
      null,
      undefined,
      'bounds',
      7,
      [],
      {},
      { t0: 0 },
      { t1: 100 },
      { t0: '0', t1: '100' },
      { t0: 0, t1: Number.NaN },
      { t0: Number.POSITIVE_INFINITY, t1: 100 },
      { t0: -60, t1: 100 },
      { t0: 100, t1: 100 },
      { t0: 200, t1: 100 },
    ]) {
      expect(readBounds(answer), JSON.stringify(answer) ?? 'undefined').toBeNull()
    }
  })
})

describe('where the page says its clock is', () => {
  it('reads the seconds and the page’s own wording of them', () => {
    expect(readClock(STATE)).toEqual({ now: 26_400, clock: '07:20' })
    expect(readClock({ now: 0, clock: '00:00' }), 'the start of the day is a place').toEqual({
      now: 0,
      clock: '00:00',
    })
    expect(readClock({ now: 90_000, clock: '01:00 +1d' })).toEqual({
      now: 90_000,
      clock: '01:00 +1d',
    })
  })

  it('refuses a clock it cannot show, rather than showing it', () => {
    for (const answer of [
      null,
      'state',
      {},
      { now: 100 },
      { clock: '07:20' },
      { now: '26400', clock: '07:20' },
      { now: Number.NaN, clock: '07:20' },
      { now: -1, clock: '07:20' },
      { now: 100, clock: '' },
      { now: 100, clock: 42 },
      // A page the app does not trust could answer a novel, and this string
      // goes on screen beside a control.
      { now: 100, clock: 'x'.repeat(33) },
    ]) {
      expect(readClock(answer), JSON.stringify(answer)).toBeNull()
    }
    expect(readClock({ now: 100, clock: 'x'.repeat(32) })).not.toBeNull()
  })
})

describe('a position in the service day', () => {
  it('stays inside the day the page has', () => {
    expect(clampTo(BOUNDS, 26_400)).toBe(26_400)
    expect(clampTo(BOUNDS, 0)).toBe(BOUNDS.t0)
    expect(clampTo(BOUNDS, 999_999)).toBe(BOUNDS.t1)
    expect(clampTo(BOUNDS, BOUNDS.t0)).toBe(BOUNDS.t0)
    expect(clampTo(BOUNDS, BOUNDS.t1)).toBe(BOUNDS.t1)
  })

  it('takes a value that is not a number as the start of the day', () => {
    // `Number('')` is 0 and `Number('x')` is NaN; both reach here from a
    // range control's own string value.
    expect(clampTo(BOUNDS, Number.NaN)).toBe(BOUNDS.t0)
  })
})

describe('the two the page will never answer', () => {
  it('shows what the page is doing until the app has told it otherwise', () => {
    // `state()` reports neither speed nor playing (engine issue 29), and
    // the app's address names neither, so an untouched page is at
    // present.js's own fallbacks. `tests/unit/viewer-real.test.ts` holds
    // those two numbers to the engine's real page.
    expect(shownSpeed({ speed: null, playing: null })).toBe(PAGE_SPEED)
    expect(shownPlaying({ speed: null, playing: null })).toBe(PAGE_PLAYING)
  })

  it('shows what the app set', () => {
    expect(shownSpeed({ speed: 300, playing: null })).toBe(300)
    expect(shownPlaying({ speed: null, playing: false })).toBe(false)
  })

  it('falls back where the remembered speed is not one on offer', () => {
    // A control whose value names no option shows the first one instead,
    // silently saying the map is at a speed it is not.
    expect(shownSpeed({ speed: 7, playing: null })).toBe(PAGE_SPEED)
  })

  it('offers the page’s own speed among the choices, so it can be shown', () => {
    expect(SPEEDS.map(({ rate }) => rate)).toContain(PAGE_SPEED)
    expect(new Set(SPEEDS.map(({ rate }) => rate)).size, 'no rate twice').toBe(SPEEDS.length)
    for (const { rate, label } of SPEEDS) {
      expect(rate).toBeGreaterThan(0)
      expect(label.length).toBeGreaterThan(0)
    }
  })
})

describe('what a fresh page is given back', () => {
  it('lays the two the app knows over what the page said', () => {
    expect(withRemembered(STATE, { speed: 300, playing: false })).toMatchObject({
      viewName: 'schematic',
      labels: true,
      now: 26_400,
      speed: 300,
      playing: false,
    })
  })

  it('leaves out what the app has not set', () => {
    const given = withRemembered(STATE, { speed: null, playing: null })
    expect('speed' in given, 'a speed nobody set is not a speed to restore').toBe(false)
    expect('playing' in given).toBe(false)
  })

  it('carries the memory even where the page said nothing at all', () => {
    // The page being left has a deadline to answer in (`Viewer.tsx`), and a
    // page that missed it leaves nothing - but what the app set is still
    // what the app set.
    for (const nothing of [null, undefined, 'state', 7, true]) {
      expect(withRemembered(nothing, { speed: 120, playing: false })).toEqual({
        speed: 120,
        playing: false,
      })
    }
  })

  // The whole reason the memory exists: a run, a theme change or the
  // export's preview navigates the frame, and the page that arrives is at
  // the address's own defaults. This is what `Viewer.tsx` composes and
  // dispatches on the load that follows.
  it('gives a paused, slowed map back paused and slowed', () => {
    const calls = restoreCalls(withRemembered(STATE, { speed: 30, playing: false }))
    expect(calls).toEqual([
      { method: 'setPlaying', args: [false] },
      { method: 'showView', args: ['schematic', 0] },
      { method: 'setLabels', args: [true] },
      { method: 'setSpeed', args: [30] },
      { method: 'seek', args: [26_400] },
    ])
  })

  it('gives a running map back running, and last of all', () => {
    const calls = restoreCalls(withRemembered(STATE, { speed: 300, playing: true }))
    expect(calls[0]).toEqual({ method: 'setPlaying', args: [false] })
    expect(calls[calls.length - 1], 'started again after the clock was set').toEqual({
      method: 'setPlaying',
      args: [true],
    })
  })

  it('leaves a page alone where the app has set nothing', () => {
    // Asserted as the whole list: a `not.toContain` over a list that had
    // gone empty would pass just as happily.
    expect(
      restoreCalls(withRemembered(STATE, { speed: null, playing: null })).map((c) => c.method),
    ).toEqual(['showView', 'setLabels', 'seek'])
  })
})

describe('what holds the page', () => {
  it('lets the clock move when nothing else has the page', () => {
    expect(transportRefusal(NOTHING)).toBeNull()
  })

  it('refuses with a sentence for each of the three, and names the one it means', () => {
    expect(transportRefusal({ ...NOTHING, laying: true })).toMatch(/being drawn/)
    expect(transportRefusal({ ...NOTHING, exporting: true })).toMatch(/export is reading/)
    expect(transportRefusal({ ...NOTHING, previewing: true })).toMatch(/what the export will frame/)
  })

  it('names the run first where more than one is true', () => {
    // A run and the export's preview can both be true - cell 06 can be open
    // while a recolour redraws - and the sentence has to be one of them.
    expect(transportRefusal({ laying: true, exporting: true, previewing: true })).toMatch(
      /being drawn/,
    )
  })

  it('says a whole sentence, because it is read aloud as an alert', () => {
    for (const held of ['laying', 'exporting', 'previewing'] as const) {
      const said = transportRefusal({ ...NOTHING, [held]: true }) as string
      expect(said, held).toMatch(/^[A-Z].*\.$/)
      // No path, no identifier: this is a sentence for a person.
      expect(said).not.toMatch(/[\\/]/)
    }
  })
})

describe('a project’s memory of what the app told its page', () => {
  it('starts knowing nothing', () => {
    expect(new TransportMemory().snapshot).toEqual({ speed: null, playing: null })
  })

  it('keeps each half independently and tells a listener', () => {
    const memory = new TransportMemory()
    const heard = vi.fn()
    memory.subscribe(heard)
    memory.remember({ playing: false })
    expect(memory.snapshot).toEqual({ speed: null, playing: false })
    memory.remember({ speed: 120 })
    expect(memory.snapshot).toEqual({ speed: 120, playing: false })
    expect(heard).toHaveBeenCalledTimes(2)
    expect(heard).toHaveBeenLastCalledWith({ speed: 120, playing: false })
  })

  it('says nothing when nothing moved', () => {
    // The control re-sends its own state - a person pressing Pause on a
    // paused map, a select settling on the value it had - and a raise for
    // each would re-render the cell around it for nothing.
    const memory = new TransportMemory()
    memory.remember({ speed: 120 })
    const heard = vi.fn()
    memory.subscribe(heard)
    memory.remember({ speed: 120 })
    memory.remember({})
    expect(heard).not.toHaveBeenCalled()
  })

  it('stops telling a listener that has gone', () => {
    const memory = new TransportMemory()
    const heard = vi.fn()
    memory.subscribe(heard)()
    memory.remember({ playing: false })
    expect(heard).not.toHaveBeenCalled()
  })

  it('is one memory per project, and the same one every time', () => {
    // The component is rendered again on every poll; a fresh memory per
    // render would forget the pause a person made a second ago, and a
    // shared one would hand one project's speed to another's page.
    expect(transportFor('aaaaaaaaaaaa')).toBe(transportFor('aaaaaaaaaaaa'))
    expect(transportFor('aaaaaaaaaaaa')).not.toBe(transportFor('bbbbbbbbbbbb'))
    transportFor('aaaaaaaaaaaa').remember({ speed: 15 })
    expect(transportFor('bbbbbbbbbbbb').snapshot.speed).toBeNull()
  })
})
