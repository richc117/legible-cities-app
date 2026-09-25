// The sequence that gives a reloaded page back what the page before it was
// showing (A5.5-20). No React and no window: a state in, an ordered list of
// calls out, which is the whole reason the sequence is a module of its own.
//
// The order is what is asserted, not merely the membership. A list holding
// the right calls in the wrong order is a map that seeks and then plays
// away from where it was asked to be.

import { describe, expect, it } from 'vitest'
import { restoreCalls } from '../../src/renderer/src/viewerRestore'
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

const names = (state: unknown): string[] => restoreCalls(state).map((call) => call.method)

describe('restoreCalls', () => {
  it('asks for nothing when there is nothing to give back', () => {
    expect(restoreCalls(null)).toEqual([])
    expect(restoreCalls(undefined)).toEqual([])
    expect(restoreCalls({})).toEqual([])
  })

  it('restores the view, the labels and the clock of a real page state', () => {
    expect(restoreCalls(PAGE_STATE)).toEqual([
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
    const running = restoreCalls({ ...PAGE_STATE, playing: true })
    expect(running[0]).toEqual({ method: 'setPlaying', args: [false] })
    expect(running[running.length - 1]).toEqual({ method: 'setPlaying', args: [true] })

    const paused = restoreCalls({ ...PAGE_STATE, playing: false })
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
    expect(restoreCalls(PAGE_STATE)).toContainEqual({
      method: 'showView',
      args: ['schematic', 0],
    })
  })

  it('names only methods the bridge will carry', () => {
    const every = restoreCalls({ ...PAGE_STATE, speed: 60, playing: true })
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
    expect(restoreCalls({ now: 0 })).toEqual([{ method: 'seek', args: [0] }])
    expect(restoreCalls({ labels: false })).toEqual([{ method: 'setLabels', args: [false] }])
  })

  it('takes what is not an object as nothing to restore', () => {
    for (const nonsense of ['state', 7, true, [], () => undefined]) {
      expect(restoreCalls(nonsense)).toEqual([])
    }
  })
})
