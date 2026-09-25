// The deadline on reading the page before the frame is navigated (A5.5-20).
//
// The frame's one deliberate navigation waits for the page it is leaving to
// say what it is showing, so the page that arrives can be put back there.
// A page that never answers must not be able to stop that wait: the map
// would stay on the old document for the life of the screen, a run would
// draw a map nobody ever saw, and cell 06's preview would never appear.
//
// The page is not trusted (ADR-028) and does not have to be malicious to do
// it - a feed's route name can become live markup in a generated page
// (engine issue E17), and a page whose main thread is blocked answers
// nothing at all, since the app reaches it by injecting into that thread.
//
// Timers are faked, so this is a test of the rule and not a stopwatch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answerWithin } from '../../src/renderer/src/Viewer'

describe('answerWithin', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('answers with what the page said, when it says it', async () => {
    const answer = answerWithin(() => Promise.resolve({ now: 26_400 }), 1000)
    await vi.advanceTimersByTimeAsync(0)
    await expect(answer).resolves.toEqual({ now: 26_400 })
  })

  it('answers with nothing once the deadline passes, and does not wait for the page', async () => {
    // A page that never replies: the promise is never settled at all, which
    // is what a blocked main thread looks like from here.
    const settled = vi.fn()
    const answer = answerWithin(() => new Promise<unknown>(() => {}), 1000).then((value) => {
      settled(value)
      return value
    })

    await vi.advanceTimersByTimeAsync(999)
    expect(settled, 'still waiting, a moment before the deadline').not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await expect(answer).resolves.toBeNull()
    expect(settled).toHaveBeenCalledWith(null)
  })

  it('reads a refusal as it reads a silence', async () => {
    const answer = answerWithin(
      () => Promise.reject(new Error('the map is not on the screen')),
      1000,
    )
    await vi.advanceTimersByTimeAsync(0)
    await expect(answer).resolves.toBeNull()
  })

  it('reads a throw where the asking itself fails', async () => {
    const answer = answerWithin(() => {
      throw new Error('no bridge')
    }, 1000)
    await vi.advanceTimersByTimeAsync(0)
    await expect(answer).resolves.toBeNull()
  })

  it('leaves no timer behind when the page answers first', async () => {
    await answerWithin(() => Promise.resolve('said'), 1000)
    await vi.advanceTimersByTimeAsync(0)
    // A timer still pending here would fire into a navigation that has
    // already happened, and would keep the renderer awake for nothing.
    expect(vi.getTimerCount(), 'the deadline was cleared').toBe(0)
  })
})
