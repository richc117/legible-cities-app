// `stillHolds` (tests/support/holds.ts, issue 596): the end-to-end suite's one
// way to hold that something did not happen. What is held here is the two
// things that make it better than a sleep followed by an assertion: the
// check is made again and again over the window and once more at its end,
// and the first time it fails the wait ends with that failure at once.

import { describe, expect, it } from 'vitest'
import { stillHolds } from '../support/holds'

describe('stillHolds', () => {
  it('checks again over the window, and once more at its end', async () => {
    let checks = 0
    const started = Date.now()
    await stillHolds(
      () => {
        checks += 1
      },
      { window: 200, every: 20 },
    )
    expect(Date.now() - started, 'it lasted the window').toBeGreaterThanOrEqual(190)
    expect(checks, 'it checked many times, not once at the start').toBeGreaterThan(3)
  })

  it('ends at the first check that fails, with its error, long before the window is out', async () => {
    let checks = 0
    const started = Date.now()
    await expect(
      stillHolds(
        () => {
          checks += 1
          if (checks === 3) throw new Error('it was redrawn')
        },
        { window: 5_000, every: 10 },
      ),
    ).rejects.toThrow('it was redrawn')
    expect(checks).toBe(3)
    expect(Date.now() - started, 'it did not wait the window out').toBeLessThan(2_000)
  })
})
