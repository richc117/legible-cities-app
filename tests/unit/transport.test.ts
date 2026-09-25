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
  asDispatched,
  clampTo,
  makePoll,
  pollsNow,
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

// The poll (A5.5-16). This is where the feature's one real defect lived:
// `bounds` was asked once, from an effect keyed on three values that never
// move on a project screen, and the frame it needs is attached by the
// iframe's own load handler - which cannot have run by the time React
// flushes the effect that asks. So the ask always rejected, `bounds` stayed
// null, and the whole section rendered `null` for the life of the screen.
// Five end-to-end runs out of five, on the plain path: open a laid-out
// project and look at cell 03.
describe('the poll', () => {
  /** A page that refuses the first `refusals` asks of each method, then answers. */
  function page(refusals: { bounds?: number; state?: number } = {}): {
    ask: (method: 'bounds' | 'state') => Promise<unknown>
    asked: string[]
    settle: () => Promise<void>
  } {
    const left = { bounds: refusals.bounds ?? 0, state: refusals.state ?? 0 }
    const asked: string[] = []
    const answers = { bounds: { t0: 21_600, t1: 93_600 }, state: { now: 26_400, clock: '07:20' } }
    return {
      asked,
      ask: (method) => {
        asked.push(method)
        if (left[method] > 0) {
          left[method] -= 1
          return Promise.reject(new Error('the map is not on the screen'))
        }
        return Promise.resolve(answers[method])
      },
      // The asks settle as microtasks, so a handful of turns is enough and
      // no timer is involved: nothing here waits on a clock.
      settle: async () => {
        for (let turn = 0; turn < 10; turn += 1) await Promise.resolve()
      },
    }
  }

  it('asks the day again on the next pass when the frame was not there yet', async () => {
    // The defect, as a test. The frame is attached by the iframe's load
    // handler, so the first ask of a freshly opened project always rejects;
    // the control appears only because the poll asks again.
    const it = page({ bounds: 1 })
    const learnt = vi.fn()
    const poll = makePoll(it.ask, learnt)

    poll.tick()
    await it.settle()
    expect(learnt, 'the first pass learnt nothing, as it must').not.toHaveBeenCalled()
    expect(it.asked, 'and it did not go on to ask for a clock it cannot place').toEqual(['bounds'])

    poll.tick()
    await it.settle()
    expect(it.asked).toEqual(['bounds', 'bounds', 'state'])
    expect(learnt).toHaveBeenCalledTimes(1)
    expect(learnt).toHaveBeenCalledWith({
      bounds: { t0: 21_600, t1: 93_600 },
      clock: { now: 26_400, clock: '07:20' },
    })
  })

  it('keeps asking for as many passes as it takes', async () => {
    const it = page({ bounds: 4 })
    const learnt = vi.fn()
    const poll = makePoll(it.ask, learnt)
    for (let pass = 0; pass < 5; pass += 1) {
      poll.tick()
      await it.settle()
    }
    expect(learnt).toHaveBeenCalledTimes(1)
    expect(it.asked.filter((m) => m === 'bounds')).toHaveLength(5)
  })

  it('asks the day once and then only the clock', async () => {
    const it = page()
    const poll = makePoll(it.ask, () => undefined)
    for (let pass = 0; pass < 3; pass += 1) {
      poll.tick()
      await it.settle()
    }
    expect(it.asked).toEqual(['bounds', 'state', 'state', 'state'])
  })

  it('has one ask outstanding at a time, whatever the timer does', async () => {
    // Every ask is an injection into the frame's main world, and injections
    // into one frame are serialised by that frame's main thread: a pass
    // fired while the last is unanswered queues behind it. Unguarded, a slow
    // page collects two passes a second, and that backlog sits ahead of the
    // one-second read `Viewer.tsx` makes before it navigates - so the
    // restore's deadline passes and the person loses their clock, view and
    // labels across a run.
    let release: (() => void) | null = null
    const asked: string[] = []
    const poll = makePoll(
      (method) => {
        asked.push(method)
        return new Promise((resolve) => {
          release = () => resolve({ t0: 0, t1: 100 })
        })
      },
      () => undefined,
    )
    poll.tick()
    for (let extra = 0; extra < 5; extra += 1) poll.tick()
    await Promise.resolve()
    expect(asked, 'five more ticks while the first is unanswered asked nothing').toEqual(['bounds'])
    ;(release as unknown as () => void)()
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve()
    poll.tick()
    expect(asked.length, 'and the poll is not stuck once it answers').toBeGreaterThan(1)
  })

  it('is not stopped for good by a pass that threw', async () => {
    // The guard is cleared whichever way a pass ends. A pass handles its
    // own refusals, so the way it throws is this callback throwing - which
    // in the control sets React state. Cleared on success alone, one throw
    // from here leaves the guard up and ends the poll for the life of the
    // screen, which is the defect above again by another route.
    //
    // Written first as a refused *ask*, which proved nothing: a refused ask
    // is caught inside the pass, so the pass resolves either way and the
    // test passed with the guard cleared on success only.
    const it = page()
    let thrown = 0
    const seen: unknown[] = []
    const poll = makePoll(it.ask, (what) => {
      if (thrown === 0) {
        thrown += 1
        throw new Error('the screen went while this was in flight')
      }
      seen.push(what)
    })
    poll.tick()
    await it.settle()
    expect(thrown, 'the first pass threw out of the callback').toBe(1)

    poll.tick()
    await it.settle()
    expect(seen, 'and the poll went on asking').toHaveLength(1)
  })

  it('reports no day on the passes after it has learnt one', async () => {
    const it = page()
    const learnt = vi.fn()
    const poll = makePoll(it.ask, learnt)
    poll.tick()
    await it.settle()
    poll.tick()
    await it.settle()
    expect(learnt.mock.calls[0][0].bounds).not.toBeNull()
    expect(learnt.mock.calls[1][0].bounds, 'nothing new to report').toBeNull()
  })

  it('hands on a clock the page could not answer as nothing, and keeps going', async () => {
    const it = page({ state: 1 })
    const learnt = vi.fn()
    const poll = makePoll(it.ask, learnt)
    poll.tick()
    await it.settle()
    expect(learnt).toHaveBeenCalledWith({ bounds: { t0: 21_600, t1: 93_600 }, clock: null })
    poll.tick()
    await it.settle()
    expect(learnt.mock.calls[1][0].clock).toEqual({ now: 26_400, clock: '07:20' })
  })
})

// A press made while the restore is dispatching (A5.5-16). `Viewer.tsx`
// composes the list from the memory and then awaits up to six round trips,
// and cell 03's controls are live for all of them.
describe('what a restore sends at the moment it sends it', () => {
  it('sends the speed the memory holds now, not the one the list was made with', () => {
    expect(asDispatched('setSpeed', [60], { speed: 30, playing: null })).toEqual([30])
  })

  it('sends the play the memory holds now', () => {
    // A person who pressed Pause during the restore must not have the
    // restore's own setPlaying(true) put the map back into motion - and
    // nothing could ever correct it, because the page reports neither
    // (engine issue 29).
    expect(asDispatched('setPlaying', [true], { speed: null, playing: false })).toEqual([false])
  })

  it('leaves the stop that begins a restore alone', () => {
    // setPlaying(false) at the head of the list is not a claim about state:
    // it is what keeps the clock still while the view, the labels and the
    // seek are given back. Re-read from a memory that says "playing", it
    // would become setPlaying(true) and the clock would run through the
    // rest of the restore.
    expect(asDispatched('setPlaying', [false], { speed: null, playing: true })).toEqual([false])
  })

  it('leaves every other call exactly as it was composed', () => {
    const memory = { speed: 30, playing: false }
    expect(asDispatched('showView', ['schematic', 0], memory)).toEqual(['schematic', 0])
    expect(asDispatched('setLabels', [true], memory)).toEqual([true])
    expect(asDispatched('seek', [26_400], memory)).toEqual([26_400])
  })

  it('changes nothing where the app has set neither', () => {
    const nothing = { speed: null, playing: null }
    expect(asDispatched('setSpeed', [60], nothing)).toEqual([60])
    expect(asDispatched('setPlaying', [true], nothing)).toEqual([true])
  })
})

// Whether the page is asked anything at all (A5.5-16). Driven through
// `transportRefusal` rather than through a hand-written null, so the two
// cannot drift: the poll is gated on the very value that refuses a press,
// and a hold dropped from one is dropped from both or this fails.
describe('when the page is polled', () => {
  const held = (page: Partial<Parameters<typeof transportRefusal>[0]>): string | null =>
    transportRefusal({ ...NOTHING, ...page })

  it('is asked while the cell is open and nothing else has the page', () => {
    expect(pollsNow(true, held({}))).toBe(true)
  })

  it('is not asked while the cell is collapsed', () => {
    // A collapsed cell keeps its controls mounted, so the effect is still
    // there to ask; nobody can read the answer.
    expect(pollsNow(false, held({}))).toBe(false)
  })

  it('is not asked while a run, an export or the preview holds the page', () => {
    // Every act of this control is refused then, so a poll is a round trip
    // through the privileged process, twice a second, to move a scrub
    // nobody may move. During an export it is worse than idle: the frame is
    // showing the address `export.plan` answered, so what would be read
    // back is the export preview's clock and not the map's - and the viewer
    // deliberately neither keeps nor restores that, so that closing cell 06
    // brings the map back to the clock it was opened at.
    for (const hold of ['laying', 'exporting', 'previewing'] as const) {
      expect(pollsNow(true, held({ [hold]: true })), hold).toBe(false)
    }
  })

  it('asks again once the hold ends', () => {
    expect(pollsNow(true, held({ exporting: true }))).toBe(false)
    expect(pollsNow(true, held({ exporting: false }))).toBe(true)
  })
})
