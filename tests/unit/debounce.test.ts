// The debounce, with the clock in hand. A person dragging a colour picker
// moves through dozens of colours a second and each one would be a map
// build; this is the thing that makes it one (specs/018-colours).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { debounce } from '../../src/renderer/src/debounce'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('debounce', () => {
  it("runs once, after the delay, with the last call's arguments", () => {
    const calls: string[] = []
    const run = debounce((value: string) => calls.push(value), 400)
    run('a')
    run('b')
    run('c')
    expect(calls, 'nothing before the delay is up').toEqual([])
    vi.advanceTimersByTime(399)
    expect(calls).toEqual([])
    vi.advanceTimersByTime(1)
    expect(calls, 'once, with the last').toEqual(['c'])
  })

  it('starts the delay again at every call, so a stream of them is one run', () => {
    const calls: number[] = []
    const run = debounce((value: number) => calls.push(value), 100)
    for (let i = 0; i < 20; i++) {
      run(i)
      vi.advanceTimersByTime(50)
    }
    expect(calls, 'not one call has landed yet').toEqual([])
    vi.advanceTimersByTime(100)
    expect(calls).toEqual([19])
  })

  it('runs again for a change made after the first has landed', () => {
    const calls: string[] = []
    const run = debounce((value: string) => calls.push(value), 100)
    run('a')
    vi.advanceTimersByTime(100)
    run('b')
    vi.advanceTimersByTime(100)
    expect(calls).toEqual(['a', 'b'])
  })

  it('cancel drops the call that was waiting', () => {
    const calls: string[] = []
    const run = debounce((value: string) => calls.push(value), 100)
    run('a')
    expect(run.pending).toBe(true)
    run.cancel()
    expect(run.pending).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(calls, 'the panel went; nothing should have been built').toEqual([])
  })

  it('cancel with nothing waiting is not an error, and does not stop a later call', () => {
    const calls: string[] = []
    const run = debounce((value: string) => calls.push(value), 100)
    run.cancel()
    run('a')
    vi.advanceTimersByTime(100)
    expect(calls).toEqual(['a'])
  })

  it('is not pending once it has run', () => {
    const run = debounce(() => undefined, 100)
    run()
    vi.advanceTimersByTime(100)
    expect(run.pending).toBe(false)
  })

  // The other half of `cancel`, for a caller whose waiting call is a choice
  // a person has already seen taken rather than an optimisation (A5.5-15).
  it('flush runs the call that was waiting, now, with its latest arguments', () => {
    const calls: string[] = []
    const run = debounce((value: string) => calls.push(value), 100)
    run('a')
    run('b')
    run.flush()
    expect(calls, 'the last one, and only once').toEqual(['b'])
    expect(run.pending).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(calls, 'and the timer that was waiting does not run it again').toEqual(['b'])
  })

  it('flush with nothing waiting does nothing, and does not stop a later call', () => {
    const calls: string[] = []
    const run = debounce((value: string) => calls.push(value), 100)
    run.flush()
    expect(calls).toEqual([])
    run('a')
    run.flush()
    vi.advanceTimersByTime(1000)
    expect(calls).toEqual(['a'])
  })

  it('flush after the call has landed does not run it twice', () => {
    const calls: string[] = []
    const run = debounce((value: string) => calls.push(value), 100)
    run('a')
    vi.advanceTimersByTime(100)
    run.flush()
    expect(calls).toEqual(['a'])
  })
})
