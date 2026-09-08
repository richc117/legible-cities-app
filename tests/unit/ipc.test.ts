// The IPC layer is a validating adapter: arguments arrive from another
// process, so their shape is checked before the store sees them, and only
// the interface's top frame may call at all.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { registerProjectHandlers } from '../../src/main/ipc'
import type { ProjectStore } from '../../src/main/projects'
import { CHANNELS } from '../../src/shared/api'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

function harness(topFrame = true) {
  const handlers = new Map<string, Handler>()
  const ipc = {
    handle: (channel: string, h: Handler) => handlers.set(channel, h),
  } as unknown as IpcMain
  const calls: { method: string; args: unknown[] }[] = []
  const store = new Proxy({} as ProjectStore, {
    get:
      (_t, method: string) =>
      async (...args: unknown[]) => {
        calls.push({ method, args })
        return { ok: method }
      },
  })
  registerProjectHandlers(ipc, store, () => topFrame)
  const event = {} as IpcMainInvokeEvent
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(event, ...args)
  return { call, calls, handlers }
}

describe('registerProjectHandlers', () => {
  it('registers every project channel and nothing else', () => {
    const { handlers } = harness()
    const projectChannels = Object.values(CHANNELS).filter((c) => c.startsWith('projects:'))
    expect([...handlers.keys()].sort()).toEqual(projectChannels.sort())
  })
  // The layout run hands back the engine's answer; the handler checks its
  // shape before the store checks the paths against the engine's home.
  it('refuses a finished run whose day or stage graphs are not the right shape', async () => {
    const { call, calls } = harness()
    const paths = ['/a/00.json', '/a/01.json', '/a/02.json', '/a/03.json']
    for (const done of [
      undefined,
      {},
      { date: '2026-13-01', paths },
      { date: 'yesterday', paths },
      { date: '2026-09-08' },
      { date: '2026-09-08', paths: 'not a list' },
      { date: '2026-09-08', paths: [1, 2, 3, 4] },
    ]) {
      await expect(
        call(CHANNELS.projectsCompleteLayout, 'abcdefghijk1', done),
        JSON.stringify(done),
      ).rejects.toThrow()
    }
    expect(calls, 'nothing reached the store').toEqual([])
  })

  it('passes a well-formed finished run to the store', async () => {
    const { call, calls } = harness()
    const done = {
      date: '2026-09-08',
      paths: ['/a/00.json', '/a/01.json', '/a/02.json', '/a/03.json'],
    }
    await call(CHANNELS.projectsCompleteLayout, 'abcdefghijk1', done)
    expect(calls).toEqual([{ method: 'completeLayout', args: ['abcdefghijk1', done] }])
  })

  it('refuses a caller that is not the top frame', async () => {
    const { call, calls } = harness(false)
    await expect(call(CHANNELS.projectsList)).rejects.toThrow('forbidden')
    expect(calls).toEqual([])
  })
  it('validates identifiers before the store sees them', async () => {
    const { call, calls } = harness()
    await expect(call(CHANNELS.projectsGet, '../x')).rejects.toThrow('invalid id')
    await expect(call(CHANNELS.projectsGet, 42)).rejects.toThrow('invalid id')
    await expect(call(CHANNELS.projectsDelete, 'CON')).rejects.toThrow('invalid id')
    expect(calls).toEqual([])
    await call(CHANNELS.projectsGet, 'abcdefghijk1')
    expect(calls).toEqual([{ method: 'get', args: ['abcdefghijk1'] }])
  })
  it("maps a malformed create input onto the contract's messages", async () => {
    const { call, calls } = harness()
    await expect(call(CHANNELS.projectsCreate, undefined)).rejects.toThrow('name is required')
    await expect(call(CHANNELS.projectsCreate, { name: '  ' })).rejects.toThrow('name is required')
    await expect(call(CHANNELS.projectsCreate, { name: 'LA' })).rejects.toThrow(/feed key/)
    await expect(call(CHANNELS.projectsCreate, { name: 'LA', feed: 'LA Metro' })).rejects.toThrow(
      /feed key/,
    )
    await expect(
      call(CHANNELS.projectsCreate, { name: 'LA', feed: 'la-metro-rail', agency: 7 }),
    ).rejects.toThrow('agency must be text')
    await expect(
      call(CHANNELS.projectsCreate, { name: 'LA', feed: 'la-metro-rail', mode: 'Rail!' }),
    ).rejects.toThrow(/mode/)
    expect(calls).toEqual([])
  })
  it('passes a valid create input through with its defaults untouched', async () => {
    const { call, calls } = harness()
    await call(CHANNELS.projectsCreate, { name: 'LA', feed: 'la-metro-rail' })
    expect(calls).toEqual([
      {
        method: 'create',
        args: [{ name: 'LA', feed: 'la-metro-rail', mode: undefined, agency: null }],
      },
    ])
  })
  it('validates a rename name', async () => {
    const { call, calls } = harness()
    await expect(call(CHANNELS.projectsRename, 'abcdefghijk1', '')).rejects.toThrow(
      'name is required',
    )
    await expect(call(CHANNELS.projectsRename, 'abcdefghijk1', 'x'.repeat(121))).rejects.toThrow(
      /too long/,
    )
    expect(calls).toEqual([])
  })
})
