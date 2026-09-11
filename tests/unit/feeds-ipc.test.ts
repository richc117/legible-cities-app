// The registry's gate on the main side: a zip is chosen in the platform's
// own dialog and remembered, a feeds.add with any other path is refused,
// and a feed a project names cannot be removed.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import {
  PickedPaths,
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
  it('lets a URL through and a path it handed out, and refuses any other path', async () => {
    const picked = new PickedPaths()
    picked.remember('/chosen/feed.zip')
    const guard = registryGuard(picked, inUse([]))
    expect(await guard('feeds.add', { source: 'https://agency.example/gtfs.zip' })).toBeNull()
    expect(await guard('feeds.add', { source: 'http://agency.example/gtfs.zip' })).toBeNull()
    expect(await guard('feeds.add', { source: '/chosen/feed.zip' })).toBeNull()
    expect(await guard('feeds.add', { source: '/etc/passwd' })).toMatch(/chosen in the app/)
    expect(await guard('feeds.add', { source: 'file:///chosen/feed.zip' })).toMatch(
      /chosen in the app/,
    )
    expect(await guard('feeds.add', { source: '' })).toMatch(/needs a source/)
    expect(await guard('feeds.add', {})).toMatch(/needs a source/)
    expect(await guard('feeds.add', undefined)).toMatch(/needs a source/)
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
