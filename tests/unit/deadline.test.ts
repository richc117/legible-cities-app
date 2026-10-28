import { afterEach, describe, expect, it, vi } from 'vitest'
import { inTime, LAPSED } from '../../src/main/deadline'
import { FOLDERS_TIMEOUT_MS } from '../../src/main/settings'

// The one race main runs (issue 598): a promise or a deadline. These were
// `settings-store.test.ts`'s tests of `inTime` when it lived in
// `settings.ts` (issue 206, a folder on a network share stalling rather
// than failing), moved here whole; the folder checks now pass their
// deadline, `FOLDERS_TIMEOUT_MS`, rather than take it as a default.
describe('inTime', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('answers what the check answered, and leaves no timer', async () => {
    vi.useFakeTimers()
    expect(await inTime(Promise.resolve(['Bart']), FOLDERS_TIMEOUT_MS)).toEqual(['Bart'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('answers that the deadline lapsed for a check that never ends, at the deadline and not before', async () => {
    vi.useFakeTimers()
    let answered: unknown = 'nothing yet'
    void inTime(new Promise<string>(() => undefined), FOLDERS_TIMEOUT_MS).then((answer) => {
      answered = answer
    })
    await vi.advanceTimersByTimeAsync(FOLDERS_TIMEOUT_MS - 1)
    expect(answered).toBe('nothing yet')
    await vi.advanceTimersByTimeAsync(1)
    expect(answered).toBe(LAPSED)
    expect(vi.getTimerCount(), 'and the timer is gone').toBe(0)
    expect(FOLDERS_TIMEOUT_MS).toBe(5_000)
  })

  it('fails as the check failed, and leaves no timer', async () => {
    vi.useFakeTimers()
    await expect(inTime(Promise.reject(new Error('refused')), FOLDERS_TIMEOUT_MS)).rejects.toThrow(
      'refused',
    )
    expect(vi.getTimerCount()).toBe(0)
  })

  it('lets a check that fails after it was given up fail unheard', async () => {
    vi.useFakeTimers()
    const unheard: unknown[] = []
    const listen = (reason: unknown): void => {
      unheard.push(reason)
    }
    process.on('unhandledRejection', listen)
    try {
      let fail: (error: Error) => void = () => undefined
      const check = new Promise<string>((_, reject) => {
        fail = reject
      })
      const waiting = inTime(check, 10)
      await vi.advanceTimersByTimeAsync(10)
      expect(await waiting).toBe(LAPSED)
      fail(new Error('the share answered at last, with a failure'))
      vi.useRealTimers()
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(unheard).toEqual([])
    } finally {
      process.off('unhandledRejection', listen)
    }
  })

  // New with the move: each of the four sites gives its own deadline - the
  // folders' five seconds, the logs' two, the home's two, the supervisor's
  // bounds - so the one it is handed is the one it keeps.
  it('keeps the deadline it is handed, whatever it is, and answers a check that came first', async () => {
    vi.useFakeTimers()
    for (const ms of [1, 300, 2_000, FOLDERS_TIMEOUT_MS + 1]) {
      let answered: unknown = 'nothing yet'
      void inTime(new Promise<string>(() => undefined), ms).then((answer) => {
        answered = answer
      })
      await vi.advanceTimersByTimeAsync(ms - 1)
      expect(answered, `not before ${ms} ms`).toBe('nothing yet')
      await vi.advanceTimersByTimeAsync(1)
      expect(answered, `at ${ms} ms`).toBe(LAPSED)
    }
    let late: (value: string) => void = () => undefined
    const check = new Promise<string>((resolve) => {
      late = resolve
    })
    // A flag, not an await: an answer that never came fails here, now, and
    // not at the test's own timeout.
    let answered: unknown = 'nothing yet'
    void inTime(check, 300).then((answer) => {
      answered = answer
    })
    await vi.advanceTimersByTimeAsync(299)
    late('in time')
    await vi.advanceTimersByTimeAsync(0)
    expect(answered).toBe('in time')
    expect(vi.getTimerCount(), 'and the timer is gone').toBe(0)
  })
})
