// Adding a feed, against a stub client: the two stages, the file that
// skips the download, the engine's sentence, and a cancel.

import { describe, expect, it } from 'vitest'
import { FeedAdd, sentenceFor, type AddClient } from '../../src/renderer/src/engine/feedAdd'
import { validateFeedUrl } from '../../src/renderer/src/AddFeedDialog'
import { startingFeed } from '../../src/renderer/src/CreateProjectDialog'
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
    expect(validateFeedUrl('')).toMatch(/paste the address/)
    expect(validateFeedUrl('ftp://x/y.zip')).toMatch(/starts with http/)
    expect(validateFeedUrl('  https://agency.example/gtfs.zip ')).toBeNull()
  })

  it('opens the create dialog on the feed asked for, else the default, else the first', () => {
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
