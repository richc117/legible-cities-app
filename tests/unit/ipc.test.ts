// The IPC layer is a validating adapter: arguments arrive from another
// process, so their shape is checked before the store sees them, and only
// the interface's top frame may call at all.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { registerProjectHandlers } from '../../src/main/ipc'
import type { ProjectStore } from '../../src/main/projects'
import { CHANNELS } from '../../src/shared/api'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

const WINDOW = {
  start: '2026-01-01',
  end: '2026-12-31',
  busiest: '2026-09-15',
  anchor: '2026-09-08',
}

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
  // shape, and the store checks it again before it writes.
  it('refuses a finished run whose day, layout id or window are not the right shape', async () => {
    const { call, calls } = harness()
    const layout = 'a'.repeat(64)
    const service = WINDOW
    for (const done of [
      undefined,
      {},
      { date: '2026-13-01', layout, service },
      { date: 'yesterday', layout, service },
      { date: '2026-09-08', service },
      { date: '2026-09-08', layout: 'not an id', service },
      { date: '2026-09-08', layout: ['a'.repeat(64)], service },
      { date: '2026-09-08', layout: '/a/03.json', service },
      { date: '2026-09-08', layout },
      { date: '2026-09-08', layout, service: 'whenever' },
      { date: '2026-09-08', layout, service: { ...WINDOW, busiest: 42 } },
      { date: '2026-09-08', layout, service: { ...WINDOW, end: '2025-01-01' } },
    ]) {
      await expect(
        call(CHANNELS.projectsCompleteLayout, 'abcdefghijk1', done),
        JSON.stringify(done),
      ).rejects.toThrow()
    }
    expect(calls, 'nothing reached the store').toEqual([])
  })

  it('passes a well-formed finished run to the store, the window with only its four days', async () => {
    const { call, calls } = harness()
    const done = { date: '2026-09-08', layout: 'a'.repeat(64), service: { ...WINDOW, extra: 1 } }
    await call(CHANNELS.projectsCompleteLayout, 'abcdefghijk1', done)
    expect(calls).toEqual([
      {
        method: 'completeLayout',
        args: ['abcdefghijk1', { date: '2026-09-08', layout: 'a'.repeat(64), service: WINDOW }],
      },
    ])
  })

  it("checks a finished rebuild's day for shape, and leaves the window to the store", async () => {
    const { call, calls } = harness()
    for (const done of [undefined, {}, { date: '2026-02-30' }, { date: 20260908 }]) {
      await expect(
        call(CHANNELS.projectsCompleteRebuild, 'abcdefghijk1', done),
        JSON.stringify(done),
      ).rejects.toThrow()
    }
    expect(calls).toEqual([])
    await call(CHANNELS.projectsCompleteRebuild, 'abcdefghijk1', { date: '2026-09-12', extra: 1 })
    expect(calls).toEqual([
      { method: 'completeRebuild', args: ['abcdefghijk1', { date: '2026-09-12' }] },
    ])
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
