import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dayWords, momentWords, timeWords } from '../../src/renderer/src/dates'

// The interface's one way of writing a day and a moment (issue 559).
//
// Node honours a change of TZ at run time on macOS and Linux (not on
// Windows, where these rows then detect nothing), so the zone is pinned to
// one west of Greenwich, where UTC midnight is the evening before (the
// mutation job runs in UTC, where it would not be). The formatters make
// their `Intl.DateTimeFormat` when asked, so the zone set here is the one
// they read.

describe('the interface’s dates, west of Greenwich', () => {
  const zone = process.env.TZ

  beforeEach(() => {
    process.env.TZ = 'America/Los_Angeles'
  })

  afterEach(() => {
    if (zone === undefined) delete process.env.TZ
    else process.env.TZ = zone
  })

  it('writes a day as the export’s title does, on the day it is', () => {
    // Mutation: `timeZone: 'UTC'` dropped - the day is read as the evening
    // before in Los Angeles, "16 September 2026".
    expect(dayWords('2026-09-17')).toBe('17 September 2026')
    expect(dayWords('2026-01-01')).toBe('1 January 2026')
    expect(dayWords('2026-12-31')).toBe('31 December 2026')
  })

  it('gives back what is not a day as it was', () => {
    expect(dayWords('')).toBe('')
    expect(dayWords('17/09/2026')).toBe('17/09/2026')
    expect(dayWords('2026-13-45')).toBe('2026-13-45')
  })

  it('writes a moment as the day the person’s clock was on, then the time, with no seconds', () => {
    // 02:16:51 UTC on the 30th is 7:16 in the evening of the 29th here.
    const said = momentWords('2026-09-30T02:16:51Z')
    expect(said).toMatch(/^29 September 2026 at (7:16\sPM|19:16)$/)
    expect(said).not.toContain('51')
    expect(momentWords('2026-09-29T19:16:51.123+00:00')).toMatch(
      /^29 September 2026 at (12:16\sPM|12:16)$/,
    )
  })

  it('gives back what is not a moment as it was', () => {
    expect(momentWords('not a time')).toBe('not a time')
  })

  it('writes a time of day with no seconds', () => {
    const said = timeWords(Date.parse('2026-09-30T02:16:51Z'))
    expect(said).toMatch(/^(7:16\sPM|19:16)$/)
    expect(timeWords(new Date('2026-09-30T02:16:51Z'))).toBe(said)
  })
})
