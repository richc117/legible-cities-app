// The IPC layer is a validating adapter: arguments arrive from another
// process, so their shape is checked before the store sees them, and only
// the interface's top frame may call at all.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import {
  CLIPBOARD_LIMIT,
  registerClipboardHandler,
  registerProjectHandlers,
} from '../../src/main/ipc'
import type { ProjectStore } from '../../src/main/projects'
import { CHANNELS } from '../../src/shared/api'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

const WINDOW = {
  start: '2026-01-01',
  end: '2026-12-31',
  busiest: '2026-09-15',
  anchor: '2026-09-08',
}
const MADE = '2026-09-10T12:00:00+00:00'
const BUILT = { mode: 'all', agency: null }

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
    const made = MADE
    const built = BUILT
    for (const done of [
      undefined,
      {},
      { date: '2026-13-01', layout, service, made, built },
      { date: 'yesterday', layout, service, made },
      { date: '2026-09-08', service, made },
      { date: '2026-09-08', layout: 'not an id', service, made, built },
      { date: '2026-09-08', layout: ['a'.repeat(64)], service, made, built },
      { date: '2026-09-08', layout: '/a/03.json', service, made, built },
      { date: '2026-09-08', layout, made },
      { date: '2026-09-08', layout, service: 'whenever', made, built },
      { date: '2026-09-08', layout, service: { ...WINDOW, busiest: 42 }, made },
      { date: '2026-09-08', layout, service: { ...WINDOW, end: '2025-01-01' }, made },
      { date: '2026-09-08', layout, service },
      { date: '2026-09-08', layout, service, made: 'never', built },
      { date: '2026-09-08', layout, service, made: '', built },
      { date: '2026-09-08', layout, service, made: 42, built },
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
    const done = {
      date: '2026-09-08',
      layout: 'a'.repeat(64),
      service: { ...WINDOW, extra: 1 },
      made: MADE,
      built: { ...BUILT, extra: 1 },
    }
    await call(CHANNELS.projectsCompleteLayout, 'abcdefghijk1', done)
    expect(calls).toEqual([
      {
        method: 'completeLayout',
        args: [
          'abcdefghijk1',
          {
            date: '2026-09-08',
            layout: 'a'.repeat(64),
            made: MADE,
            built: BUILT,
            service: WINDOW,
          },
        ],
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

  it('checks the two inputs for shape and passes them to the store', async () => {
    const { call, calls } = harness()
    for (const inputs of [
      undefined,
      {},
      { mode: 3 },
      { mode: 'Rail!' },
      { mode: 'all', agency: 7 },
    ]) {
      await expect(
        call(CHANNELS.projectsSetInputs, 'abcdefghijk1', inputs),
        JSON.stringify(inputs),
      ).rejects.toThrow()
    }
    expect(calls).toEqual([])
    await call(CHANNELS.projectsSetInputs, 'abcdefghijk1', { mode: 'tram', agency: null })
    await call(CHANNELS.projectsSetInputs, 'abcdefghijk1', { mode: 'all', agency: 'M', extra: 1 })
    expect(calls).toEqual([
      { method: 'setInputs', args: ['abcdefghijk1', { mode: 'tram', agency: null }] },
      { method: 'setInputs', args: ['abcdefghijk1', { mode: 'all', agency: 'M' }] },
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

// The clipboard's one direction (A3-03). The page can put text on it,
// never take text off, and the handler is the only way it can: Chromium's
// own clipboard write is a permission, and the app refuses every one.
describe('registerClipboardHandler', () => {
  function clipboard(topFrame = true) {
    const handlers = new Map<string, Handler>()
    const ipc = {
      handle: (channel: string, h: Handler) => handlers.set(channel, h),
    } as unknown as IpcMain
    const written: string[] = []
    registerClipboardHandler(
      ipc,
      (text) => written.push(text),
      () => topFrame,
    )
    const event = {} as IpcMainInvokeEvent
    return {
      written,
      handlers,
      call: (...args: unknown[]) => handlers.get(CHANNELS.clipboardWrite)!(event, ...args),
    }
  }

  it('registers one channel and writes the text it is given', async () => {
    const { call, written, handlers } = clipboard()
    expect([...handlers.keys()]).toEqual([CHANNELS.clipboardWrite])
    await expect(call('Los Angeles — the map drawn for 2026-09-15')).resolves.toBeUndefined()
    expect(written).toEqual(['Los Angeles — the map drawn for 2026-09-15'])
  })

  it('refuses anything that is not text, and text without end', async () => {
    const { call, written } = clipboard()
    await expect(call(undefined)).rejects.toThrow('there is nothing to copy')
    await expect(call({ toString: () => 'x' })).rejects.toThrow('there is nothing to copy')
    await expect(call('x'.repeat(CLIPBOARD_LIMIT + 1))).rejects.toThrow(/too much text/)
    expect(written).toEqual([])
  })

  it('refuses a caller that is not the interface top frame', async () => {
    const { call, written } = clipboard(false)
    await expect(call('anything')).rejects.toThrow('forbidden')
    expect(written).toEqual([])
  })
})
