import { describe, expect, it } from 'vitest'
import { isFeedUrl } from '../../src/shared/feeds'
import { FEED_REFUSALS, PickedPaths, refuseUrl, registryGuard } from '../../src/main/feeds-ipc'
import { SHEET_REFUSALS, validateFeedUrl } from '../../src/renderer/src/NewProjectSheet'

const inUse = () => async (): Promise<{ feed: string; name: string }[]> => []
const HTTP_ONLY = SHEET_REFUSALS.httpOnly

/**
 * The two predicates for a feed's address before they were one (issue 598),
 * one row per input where they disagreed or the change shows: what the New
 * project sheet said (`/^https?:\/\/\S+$/`, which refused a capital scheme),
 * what the main process's gate said (it sorted by `/^https?:\/\//i` and let
 * `URL` judge, which encodes a space in a path), and what each says now,
 * null for accepted. The sheet refuses first, so only a caller other than
 * the sheet reaches main's new refusal.
 */
const ROWS: {
  input: string
  sheetBefore: string | null
  mainBefore: string | null
  sheetNow: string | null
  mainNow: string | null
}[] = [
  {
    input: 'https://host/a b',
    sheetBefore: HTTP_ONLY,
    mainBefore: null,
    sheetNow: HTTP_ONLY,
    mainNow: FEED_REFUSALS.httpOnly,
  },
  {
    input: 'https://ho st',
    sheetBefore: HTTP_ONLY,
    mainBefore: FEED_REFUSALS.notUrl,
    sheetNow: HTTP_ONLY,
    mainNow: FEED_REFUSALS.notUrl,
  },
  {
    input: 'https://',
    sheetBefore: HTTP_ONLY,
    mainBefore: FEED_REFUSALS.notUrl,
    sheetNow: HTTP_ONLY,
    mainNow: FEED_REFUSALS.notUrl,
  },
  {
    input: 'HTTPS://host/f.zip',
    sheetBefore: HTTP_ONLY,
    mainBefore: null,
    sheetNow: null,
    mainNow: null,
  },
  {
    input: 'http://host/f.zip',
    sheetBefore: null,
    mainBefore: null,
    sheetNow: null,
    mainNow: null,
  },
]

describe('a feed address, in the sheet and in the main process', () => {
  it.each(ROWS)('is judged alike for "$input"', async ({ input, sheetNow, mainNow }) => {
    expect(validateFeedUrl(input)).toBe(sheetNow)
    expect(refuseUrl(input)).toBe(mainNow)
    const guard = registryGuard(new PickedPaths(), inUse())
    expect(await guard('feeds.add', { source: input })).toBe(mainNow)
    // Neither side accepts what the other refuses.
    expect(sheetNow === null).toBe(mainNow === null)
  })

  it.each(ROWS)(
    'changes only what the issue names for "$input"',
    ({ sheetBefore, mainBefore, sheetNow, mainNow }) => {
      // The sheet now takes a capital scheme, as main did; main now refuses
      // a space, as the sheet did, in the sheet's words. Nothing else moves.
      if (sheetNow !== sheetBefore) expect([sheetBefore, sheetNow]).toEqual([HTTP_ONLY, null])
      if (mainNow !== mainBefore) expect([mainBefore, mainNow]).toEqual([null, HTTP_ONLY])
    },
  )
})

describe('isFeedUrl', () => {
  it('takes http and https in any case', () => {
    for (const address of [
      'http://agency.example/gtfs.zip',
      'https://agency.example/gtfs.zip',
      'HTTPS://agency.example/gtfs.zip',
      'Http://agency.example/gtfs.zip',
    ])
      expect(isFeedUrl(address), address).toBe(true)
  })
  it('refuses whitespace anywhere, an empty rest, and any other scheme', () => {
    for (const address of [
      'https://agency.example/a b.zip',
      'https://agency.example/gtfs.zip\n',
      ' https://agency.example/gtfs.zip',
      'https://',
      'ftp://agency.example/gtfs.zip',
      'agency.example/gtfs.zip',
    ])
      expect(isFeedUrl(address), JSON.stringify(address)).toBe(false)
  })
})
