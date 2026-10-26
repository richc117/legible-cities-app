// Adding a feed, against a stub client: the two stages, the file that
// skips the download, the engine's sentence, and a cancel.

import { describe, expect, it, vi } from 'vitest'
import {
  FEED_KEPT,
  FeedAdd,
  sentenceFor,
  type AddClient,
} from '../../src/renderer/src/engine/feedAdd'
import { followAdds, relistAfterAdd } from '../../src/renderer/src/Library'
import { filledName, startingFeed, validateFeedUrl } from '../../src/renderer/src/NewProjectSheet'
import { placeOf } from '../../src/renderer/src/FeedList'
import { ERROR_CODES, type EngineState } from '../../src/shared/engine'
import type { FeedRecord } from '../../src/shared/protocol'

interface Pending {
  params: Record<string, unknown>
  report(stage: string, fraction: number, message: string): void
  log(level: string, line: string): void
  resolve(value: unknown): void
  reject(error: unknown): void
  cancelled: boolean
}

function stub() {
  const calls: Pending[] = []
  const client: AddClient = {
    request(_method, params) {
      const listeners: ((p: { stage: string; fraction: number; message: string }) => void)[] = []
      const logs: ((l: { level: string; line: string }) => void)[] = []
      let settle!: (v: unknown) => void
      let fail!: (e: unknown) => void
      const result = new Promise<unknown>((res, rej) => {
        settle = res
        fail = rej
      })
      const pending: Pending = {
        params: params as unknown as Record<string, unknown>,
        cancelled: false,
        report: (stage, fraction, message) =>
          listeners.forEach((l) => l({ stage, fraction, message })),
        log: (level, line) => logs.forEach((l) => l({ level, line })),
        resolve: settle,
        reject: fail,
      }
      calls.push(pending)
      return {
        result: result as Promise<FeedRecord>,
        onProgress: (l: (p: { stage: string; fraction: number; message: string }) => void) => {
          listeners.push(l)
          return () => {}
        },
        onLog: (l: (line: { level: string; line: string }) => void) => {
          logs.push(l)
          return () => {}
        },
        cancel: () => {
          pending.cancelled = true
        },
      }
    },
  }
  return { client, calls }
}

const READY: EngineState = { state: 'ready', version: '0.7.0', protocol: 1 }
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const FEED: FeedRecord = {
  key: 'mine',
  name: 'Mine',
  city: '',
  network: '',
  url: '',
  mode: 'all',
  label_pattern: null,
  label_strip: null,
  agency: null,
  geographic: true,
  notes: [],
  headways: false,
  source: 'user',
  cached: true,
}

describe('FeedAdd', () => {
  it('sends a URL and walks the download then the check', async () => {
    const { client, calls } = stub()
    const run = new FeedAdd(client)
    run.start({ url: 'https://agency.example/gtfs.zip' }, READY)
    expect(calls[0].params).toEqual({ source: 'https://agency.example/gtfs.zip' })
    expect(run.snapshot.stages.map((s) => s.state)).toEqual(['running', 'pending'])
    calls[0].report('download', 0.5, 'downloaded 5,120 of 10,240 bytes')
    expect(run.snapshot.message).toBe('downloaded 5,120 of 10,240 bytes')
    expect(run.snapshot.stages.map((s) => s.state)).toEqual(['running', 'pending'])
    calls[0].report('download', 1, 'downloaded 10,240 of 10,240 bytes')
    expect(run.snapshot.stages.map((s) => s.state)).toEqual(['done', 'running'])
    calls[0].report('check', 1, "checked the feed's tables")
    calls[0].resolve(FEED)
    await tick()
    expect(run.snapshot.state).toBe('done')
    expect(run.snapshot.feed).toEqual(FEED)
    expect(run.snapshot.stages.every((s) => s.state === 'done')).toBe(true)
  })

  it('a file skips the download: the check is the first stage running', () => {
    const { client, calls } = stub()
    const run = new FeedAdd(client)
    run.start({ file: '/chosen/feed.zip' }, READY)
    expect(calls[0].params).toEqual({ source: '/chosen/feed.zip' })
    expect(run.snapshot.stages.map((s) => s.state)).toEqual(['done', 'running'])
  })

  it("shows the engine's hint when it refuses, and marks the stage failed", async () => {
    const { client, calls } = stub()
    const run = new FeedAdd(client)
    run.start({ file: '/chosen/partial.zip' }, READY)
    calls[0].reject({
      code: -32000,
      message: 'x',
      data: {
        kind: 'feed',
        detail: '/a/path',
        hint: 'partial.zip has no stop_times.txt, so there is no timetable to animate',
      },
    })
    await tick()
    expect(run.snapshot.state).toBe('failed')
    expect(run.snapshot.error).toBe(
      'partial.zip has no stop_times.txt, so there is no timetable to animate',
    )
    expect(run.snapshot.stages[1].state).toBe('failed')
    // Reset clears it for the next opening; a running add cannot be reset.
    run.reset()
    expect(run.snapshot.state).toBe('idle')
  })

  it('cancels the request and says so, keeping nothing', async () => {
    const { client, calls } = stub()
    const run = new FeedAdd(client)
    run.start({ url: 'https://agency.example/gtfs.zip' }, READY)
    run.cancel()
    expect(calls[0].cancelled).toBe(true)
    calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'cancelled', feed: null })
    expect(run.snapshot.stages[0].state).toBe('pending')
    run.reset()
    run.start({ url: 'https://agency.example/other.zip' }, READY)
    expect(calls).toHaveLength(2)
  })

  it('a cancel the engine read after the feed was kept ends with the feed added, said to be kept', async () => {
    // Engine v0.18.0 (its issue 80): the answer is the feed's record with
    // `cancel_too_late`, and the feed is registered and cached. Mutation: the
    // field not read - the add then says the feed is in, as though nobody had
    // pressed Cancel.
    const { client, calls } = stub()
    const run = new FeedAdd(client)
    run.start({ url: 'https://agency.example/gtfs.zip' }, READY)
    calls[0].report('download', 1, 'downloaded 10,240 of 10,240 bytes')
    run.cancel()
    expect(calls[0].cancelled).toBe(true)
    calls[0].resolve({ ...FEED, cancel_too_late: true })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'done', late: true, message: FEED_KEPT })
    expect(run.snapshot.feed?.key).toBe('mine')
    expect(run.job()?.message).toBe(FEED_KEPT)
    // The next add starts with no word of the last one's cancel.
    run.reset()
    run.start({ url: 'https://agency.example/other.zip' }, READY)
    expect(run.snapshot).toMatchObject({ state: 'running', late: false, message: null })
    calls[1].resolve(FEED)
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'done', late: false })
  })

  it('reads the front door’s list again when an add ends with a feed, the sheet open or not', () => {
    // A close of the sheet cancels the add and the sheet says nothing after
    // it; an add the engine kept then ends with its feed, and only this
    // lists it. Mutation: the rule as it was, a read on a cancelled add -
    // a feed kept after a cancel is then not listed until something else
    // reads the list.
    const running = { state: 'running' as const, feed: null }
    expect(relistAfterAdd('running', { state: 'done', feed: FEED })).toBe(true)
    expect(relistAfterAdd('running', { state: 'cancelled', feed: null })).toBe(false)
    expect(relistAfterAdd('running', { state: 'failed', feed: null })).toBe(false)
    expect(relistAfterAdd('done', { state: 'done', feed: FEED }), 'once per ending').toBe(false)
    expect(relistAfterAdd('running', { state: 'done', feed: null })).toBe(false)
    expect(relistAfterAdd('idle', running)).toBe(false)
  })

  it('lists a feed the engine kept after the sheet was closed on its add, and nothing for an add cancelled in time', async () => {
    // The front door's watch, against a real add. Closing the New project
    // sheet while it adds cancels the add (`closed` in NewProjectSheet.tsx)
    // and the sheet says nothing after it, so when the engine answers the
    // feed's record with `cancel_too_late` this watch is the only thing that
    // lists it. Mutation: the relist taken out of `followAdds` (the line
    // `if (relistAfterAdd(previous, snapshot)) relist()`) - the feed is kept
    // and never listed.
    const { client, calls } = stub()
    const run = new FeedAdd(client)
    const relist = vi.fn()
    const forget = vi.fn()
    const stop = followAdds(run, relist, forget)

    run.start({ url: 'https://agency.example/gtfs.zip' }, READY)
    run.cancel()
    expect(calls[0].cancelled, 'what closing the sheet does').toBe(true)
    calls[0].resolve({ ...FEED, cancel_too_late: true })
    await tick()
    expect(relist, 'the list is read again').toHaveBeenCalledTimes(1)
    expect(forget, 'and the feed is a new one to inspect').toHaveBeenCalledWith('mine')

    // A cancel in time: the engine kept nothing, so there is nothing to list.
    run.reset()
    run.start({ url: 'https://agency.example/other.zip' }, READY)
    run.cancel()
    calls[1].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    expect(run.snapshot.state).toBe('cancelled')
    expect(relist).toHaveBeenCalledTimes(1)

    // Once the screen has gone, an add that ends asks nothing of it.
    stop()
    run.reset()
    run.start({ url: 'https://agency.example/third.zip' }, READY)
    calls[2].resolve(FEED)
    await tick()
    expect(relist).toHaveBeenCalledTimes(1)
  })

  it('refuses while the engine is not ready, and calls nothing', () => {
    const { client, calls } = stub()
    const run = new FeedAdd(client)
    run.start({ url: 'https://x.test/a.zip' }, null)
    expect(calls).toHaveLength(0)
    expect(run.snapshot.error).toMatch(/starting/)
    run.reset()
    run.start({ url: 'https://x.test/a.zip' }, { state: 'unavailable', reason: 'none' })
    expect(run.snapshot.error).toMatch(/not ready/)
  })

  it("keeps a path out of an I/O failure's sentence", () => {
    const io = {
      code: -32000,
      message: 'x',
      data: { kind: 'io', detail: 'x', hint: 'Permission denied: /var/feeds/someone/feed.zip' },
    }
    expect(sentenceFor(io)).not.toContain('/var')
    expect(sentenceFor(io)).toMatch(/Permission denied/)
  })

  it('falls back to the message without a hint', () => {
    expect(sentenceFor({ code: -32000, message: 'plain' })).toBe('plain')
    expect(sentenceFor(new Error('thrown'))).toBe('thrown')
    expect(sentenceFor(42)).toMatch(/could not be added/)
  })
})

describe("the dialogs' rules", () => {
  it('validates a typed address', () => {
    expect(validateFeedUrl('')).toMatch(/^Paste the address/)
    expect(validateFeedUrl('ftp://x/y.zip')).toMatch(/starts with http/)
    expect(validateFeedUrl('  https://agency.example/gtfs.zip ')).toBeNull()
  })

  it('opens the New project sheet on the feed asked for, else the default, else the first', () => {
    const la = { ...FEED, key: 'la-metro-rail', source: 'preset' as const }
    const other = { ...FEED, key: 'other' }
    expect(startingFeed([other, la], 'other')).toBe('other')
    expect(startingFeed([other, la], undefined)).toBe('la-metro-rail')
    expect(startingFeed([other], undefined)).toBe('other')
    expect(startingFeed([], undefined)).toBe('la-metro-rail')
    expect(startingFeed([], 'typed'), 'no list: the key asked for is typed').toBe('typed')
    expect(startingFeed([la], 'gone'), 'a feed no longer listed is not chosen').toBe(
      'la-metro-rail',
    )
  })

  it('says where a feed runs when the registry knows', () => {
    expect(placeOf(FEED)).toBeNull()
    expect(placeOf({ ...FEED, city: 'Los Angeles', network: 'Metro Rail' })).toBe(
      'Los Angeles · Metro Rail',
    )
    expect(placeOf({ ...FEED, city: 'Portland' })).toBe('Portland')
  })
})

// The inspector's view of an add (A1-03, specs/024-jobs).
describe('the add as a job', () => {
  it('is a feed-add job with no project, never naming the address, and keeps its log', async () => {
    const { client, calls } = stub()
    const run = new FeedAdd(client)
    expect(run.job()).toBeNull()
    run.start({ url: 'https://agency.example/gtfs.zip?api_key=secret' }, READY)
    const job = run.job()
    expect(job).toMatchObject({
      kind: 'feed-add',
      projectId: null,
      label: 'Feed add from a web address',
      state: 'running',
    })
    expect(JSON.stringify(job)).not.toContain('secret')
    calls[0].log('info', 'downloading')
    calls[0].resolve(FEED)
    await tick()
    expect(run.job()).toMatchObject({
      state: 'done',
      label: 'Feed add of Mine',
      log: ['[info] downloading'],
    })
  })

  it('a refusal carries the hint and detail without paths, and a reset makes it no job', async () => {
    const { client, calls } = stub()
    const run = new FeedAdd(client)
    run.start({ file: ['', 'somewhere', 'feed.zip'].join('/') }, READY)
    expect(run.job()?.label).toBe('Feed add from a file')
    const where = ['', 'somewhere', 'feed.zip'].join('/')
    calls[0].reject({
      code: -32000,
      message: 'no stops',
      data: {
        kind: 'feed',
        detail: `FeedError: ${where} has no stops.txt`,
        hint: 'feed.zip has no stops.txt',
      },
    })
    await tick()
    expect(run.job()).toMatchObject({
      state: 'failed',
      hint: 'feed.zip has no stops.txt',
      detail: 'FeedError: a file has no stops.txt',
    })
    run.reset()
    expect(run.job()).toBeNull()
  })
})

describe('the name the new-project sheet fills in', () => {
  it('takes the feed’s own name until a person has typed one', () => {
    expect(filledName('', false, 'Caltrain')).toBe('Caltrain')
    expect(filledName('LA Metro Rail', false, 'Caltrain')).toBe('Caltrain')
  })

  it('never overwrites a name a person typed, even an empty one', () => {
    expect(filledName('My map', true, 'Caltrain')).toBe('My map')
    expect(filledName('', true, 'Caltrain')).toBe('')
  })

  it('keeps what it has when there is no name to give', () => {
    expect(filledName('My map', false, null)).toBe('My map')
  })
})
