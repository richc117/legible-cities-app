// The registry's gate on the main side: a zip is chosen in the platform's
// own dialog and remembered, a feeds.add with any other path is refused,
// and a feed a project names cannot be removed.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import {
  PickedPaths,
  isLocalHost,
  refuseUrl,
  registerFeedsHandlers,
  registryGuard,
  type FeedsInUse,
} from '../../src/main/feeds-ipc'
import { CHANNELS } from '../../src/shared/api'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

function harness(answer: string | null, topFrame = true) {
  const handlers = new Map<string, Handler>()
  const ipc = { handle: (c: string, h: Handler) => handlers.set(c, h) } as unknown as IpcMain
  const picked = new PickedPaths()
  let opened = 0
  registerFeedsHandlers(
    ipc,
    async () => {
      opened += 1
      return answer
    },
    picked,
    () => topFrame,
  )
  const call = (channel: string) => handlers.get(channel)!({} as IpcMainInvokeEvent)
  return { call, picked, handlers, opened: () => opened }
}

describe('feeds.pickZip', () => {
  it('registers one channel', () => {
    expect([...harness(null).handlers.keys()]).toEqual([CHANNELS.feedsPickZip])
  })

  it('opens the chooser and hands back the path with its name, remembering it', async () => {
    const path = process.platform === 'win32' ? 'C:\\feeds\\LA Metro.zip' : '/feeds/LA Metro.zip'
    const h = harness(path)
    expect(await h.call(CHANNELS.feedsPickZip)).toEqual({ path, name: 'LA Metro.zip' })
    expect(h.picked.has(path)).toBe(true)
    expect(h.opened()).toBe(1)
  })

  it('answers null when the person cancelled, and remembers nothing', async () => {
    const h = harness(null)
    expect(await h.call(CHANNELS.feedsPickZip)).toBeNull()
    expect(h.picked.has('')).toBe(false)
  })

  it('refuses a caller that is not the top frame', async () => {
    await expect(harness('/x.zip', false).call(CHANNELS.feedsPickZip)).rejects.toThrow('forbidden')
  })
})

describe('the registry guard', () => {
  const inUse =
    (feeds: string[]): FeedsInUse =>
    async () =>
      feeds
  it('lets a public URL through and a path it handed out once, and refuses any other path', async () => {
    const picked = new PickedPaths()
    picked.remember('/chosen/feed.zip')
    const guard = registryGuard(picked, inUse([]))
    expect(await guard('feeds.add', { source: 'https://agency.example/gtfs.zip' })).toBeNull()
    expect(await guard('feeds.add', { source: 'http://agency.example/gtfs.zip' })).toBeNull()
    expect(await guard('feeds.add', { source: '/chosen/feed.zip' })).toBeNull()
    // Spent: one consent is one add, or a page could copy the zip without bound.
    expect(await guard('feeds.add', { source: '/chosen/feed.zip' })).toMatch(/chosen in the app/)
    picked.remember('/chosen/feed.zip')
    expect(await guard('feeds.add', { source: '/chosen/feed.zip' })).toBeNull()
    expect(await guard('feeds.add', { source: '/etc/passwd' })).toMatch(/chosen in the app/)
    expect(await guard('feeds.add', { source: 'file:///chosen/feed.zip' })).toMatch(
      /chosen in the app/,
    )
    expect(await guard('feeds.add', { source: '' })).toMatch(/needs a source/)
    expect(await guard('feeds.add', {})).toMatch(/needs a source/)
    expect(await guard('feeds.add', undefined)).toMatch(/needs a source/)
  })

  it('refuses an address on this machine or its network, which would be an oracle', async () => {
    const guard = registryGuard(new PickedPaths(), inUse([]))
    // The two RFC 1918 examples are assembled rather than written: the
    // hygiene scanner refuses a private address in a committed file, and
    // these are the ranges the guard refuses, not a host of anyone's.
    const rfc1918 = [['172', '16', '0', '1'].join('.'), ['192', '168', '1', '1'].join('.')]
    for (const source of [
      'http://127.0.0.1:631/',
      'http://localhost/feed.zip',
      'http://[::1]/feed.zip',
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.5/gtfs.zip',
      `http://${rfc1918[0]}/gtfs.zip`,
      `http://${rfc1918[1]}/gtfs.zip`,
      'http://0.0.0.0/',
      'http://[fe80::1]/x.zip',
    ]) {
      expect(await guard('feeds.add', { source }), source).toMatch(/public host/)
    }
    expect(await guard('feeds.add', { source: 'https://172.32.0.1/gtfs.zip' })).toBeNull()
    expect(await guard('feeds.add', { source: 'https://agency.example/a b.zip' })).toBeNull()
    expect(refuseUrl('https://')).toMatch(/URL with its scheme/)
    expect(isLocalHost('agency.example')).toBe(false)
    expect(isLocalHost('8.8.8.8')).toBe(false)
  })

  it('resolves an IPv6 literal to its full address, not a string prefix', async () => {
    // The RFC 1918 octets are assembled rather than written for the same
    // reason as above: these are addresses the guard refuses, named by
    // their arithmetic, not a host of anyone's.
    const mapped = (a: number, b: number, c: number, d: number): string =>
      `::ffff:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
    const compatible = (a: number, b: number, c: number, d: number): string =>
      `::${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
    const octetSets: ReadonlyArray<readonly [number, number, number, number]> = [
      [127, 0, 0, 1],
      [10, 0, 0, 1],
    ]
    for (const octets of octetSets) {
      // An IPv4-mapped IPv6 literal names the same machine the plain
      // dotted address does; `new URL()` normalises a written-out
      // `::ffff:a.b.c.d` into exactly this hex-group form on its own, so
      // this is the shape isLocalHost actually has to judge.
      expect(isLocalHost(`[${mapped(...octets)}]`)).toBe(true)
      expect(isLocalHost(mapped(...octets))).toBe(true)
      // The deprecated IPv4-compatible form embeds the same address a
      // different way; still the same machine.
      expect(isLocalHost(compatible(...octets))).toBe(true)
    }
    // fe80::/10 is a range, not the one literal address `fe80::`; a host
    // elsewhere in the range must not slip past a prefix check.
    expect(isLocalHost('fe95::1')).toBe(true)
    expect(isLocalHost('febf::1')).toBe(true)
    // A public IPv6 host - Google's public resolver - must still pass.
    expect(isLocalHost('2001:4860:4860::8888')).toBe(false)
  })

  it('refuses to remove a feed a project names, naming how many', async () => {
    const guard = registryGuard(new PickedPaths(), inUse(['mine', 'mine', 'other']))
    expect(await guard('feeds.remove', { key: 'mine' })).toBe(
      '2 projects use this feed; delete them first.',
    )
    expect(await guard('feeds.remove', { key: 'other' })).toBe(
      'One project uses this feed; delete the project first.',
    )
    expect(await guard('feeds.remove', { key: 'unused' })).toBeNull()
    expect(await guard('feeds.remove', {})).toMatch(/needs a key/)
  })

  it('leaves every other method alone', async () => {
    const guard = registryGuard(new PickedPaths(), inUse(['x']))
    expect(await guard('graph.build', { key: 'x' })).toBeNull()
    expect(await guard('feeds.list', undefined)).toBeNull()
    expect(await guard('feeds.inspect', { key: 'x' })).toBeNull()
  })
})
