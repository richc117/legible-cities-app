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

/** More overrides than the record's cap, so the handler refuses the lot. */
const bigPalette = (): [string, string][] =>
  Array.from({ length: 513 }, (_unused, i) => [`line-${i}`, '#0072bc'] as [string, string])

const WINDOW = {
  start: '2026-01-01',
  end: '2026-12-31',
  busiest: '2026-09-15',
  anchor: '2026-09-08',
}
const MADE = '2026-09-10T12:00:00+00:00'
const BUILT = { mode: 'all', agency: null }

function harness(topFrame = true, blocked: string | null = null) {
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
  registerProjectHandlers(
    ipc,
    store,
    () => topFrame,
    () => blocked,
  )
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

  // Every record and every output folder lives under the engine's home, so
  // a write during a reset of that home would land in a folder being walked
  // away. Reading is still allowed: it answers what is there, or that there
  // is nothing (A1-04).
  it('holds every write while the engine data is being reset, and still reads', async () => {
    const why = 'The engine data is being reset; wait for it to finish.'
    const h = harness(true, why)
    const writes = [
      [CHANNELS.projectsCreate, { name: 'A', feed: 'la-metro-rail' }],
      [CHANNELS.projectsRename, 'aaaaaaaaaaaa', 'B'],
      [CHANNELS.projectsDelete, 'aaaaaaaaaaaa'],
      [CHANNELS.projectsSetInputs, 'aaaaaaaaaaaa', { mode: 'all', agency: null }],
      [CHANNELS.projectsCompleteLayout, 'aaaaaaaaaaaa', {}],
      [CHANNELS.projectsCompleteRebuild, 'aaaaaaaaaaaa', { date: '2026-09-15' }],
      [CHANNELS.projectsCompleteColors, 'aaaaaaaaaaaa', { colors: {}, defaultColor: '#888888' }],
      [CHANNELS.projectsCompleteOrder, 'aaaaaaaaaaaa', ['A']],
      [CHANNELS.projectsSetTheme, 'aaaaaaaaaaaa', 'sepia'],
      [CHANNELS.projectsSetExport, 'aaaaaaaaaaaa', { preset: 'instagram-reel', options: {} }],
    ] as const
    for (const [channel, ...args] of writes) {
      await expect(h.call(channel, ...args), channel).rejects.toThrow(why)
    }
    expect(h.calls, 'the store was never reached').toEqual([])

    await h.call(CHANNELS.projectsList)
    await h.call(CHANNELS.projectsGet, 'aaaaaaaaaaaa')
    expect(h.calls.map((c) => c.method)).toEqual(['list', 'get'])
  })

  it('lets every write through when nothing is being reset', async () => {
    const h = harness()
    await h.call(CHANNELS.projectsRename, 'aaaaaaaaaaaa', 'B')
    expect(h.calls.map((c) => c.method)).toEqual(['rename'])
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

  // The line colours a person chose, relayed by the page after the map was
  // drawn with them. Every label and every colour is checked here, because
  // the argument came from another process (A4-01).
  it('refuses a malformed colour map before the store sees it', async () => {
    const { call, calls } = harness()
    for (const palette of [
      undefined,
      null,
      42,
      'grey',
      [],
      {},
      { colors: {} },
      { defaultColor: '#888888' },
      { colors: [], defaultColor: '#888888' },
      { colors: null, defaultColor: '#888888' },
      { colors: {}, defaultColor: '888888' },
      { colors: {}, defaultColor: 'grey' },
      { colors: {}, defaultColor: '#88888' },
      { colors: { A: '0072bc' }, defaultColor: '#888888' },
      { colors: { A: '#0072b' }, defaultColor: '#888888' },
      { colors: { A: 'red' }, defaultColor: '#888888' },
      { colors: { A: null }, defaultColor: '#888888' },
      { colors: { A: 42 }, defaultColor: '#888888' },
      { colors: { '': '#0072bc' }, defaultColor: '#888888' },
      { colors: { ['A\nB']: '#0072bc' }, defaultColor: '#888888' },
      { colors: { ['a'.repeat(65)]: '#0072bc' }, defaultColor: '#888888' },
      // A key a plain object cannot hold as a property: the record
      // would write it and never read it back.
      { colors: { ['__proto__']: '#0072bc' }, defaultColor: '#888888' },
      { colors: Object.fromEntries(bigPalette()), defaultColor: '#888888' },
    ]) {
      await expect(
        call(CHANNELS.projectsCompleteColors, 'abcdefghijk1', palette),
        JSON.stringify(palette) ?? 'undefined',
      ).rejects.toThrow()
    }
    expect(calls, 'nothing reached the store').toEqual([])
  })

  it('refuses an order the record could not hold, and reaches the store with none of it', async () => {
    const { call, calls } = harness()
    for (const order of [
      undefined,
      null,
      42,
      'A',
      {},
      { 0: 'A' },
      [42],
      [null],
      [''],
      ['A\nB'],
      ['a'.repeat(65)],
      // A label a plain object cannot hold as a key: the record would
      // write it and never read it back.
      ['__proto__'],
      // The same line twice: one would be drawn over itself and another
      // line's place would be ambiguous.
      ['A', 'B', 'A'],
      Array.from({ length: 513 }, (_unused, i) => `line-${i}`),
    ]) {
      await expect(
        call(CHANNELS.projectsCompleteOrder, 'abcdefghijk1', order),
        JSON.stringify(order) ?? 'undefined',
      ).rejects.toThrow()
    }
    expect(calls, 'nothing reached the store').toEqual([])
  })

  it('passes an order the panel would send, and keeps no reference to it', async () => {
    const { call, calls } = harness()
    await expect(call(CHANNELS.projectsCompleteOrder, '../x', ['A'])).rejects.toThrow('invalid id')
    const order = ['K', 'A', 'Rapid 720']
    await call(CHANNELS.projectsCompleteOrder, 'abcdefghijk1', order)
    order[0] = 'B'
    expect(calls).toEqual([
      { method: 'completeOrder', args: ['abcdefghijk1', ['K', 'A', 'Rapid 720']] },
    ])
  })

  it('refuses a theme the page does not draw, and passes the two it does', async () => {
    const { call, calls } = harness()
    for (const theme of [undefined, null, 42, '', 'dark', 'light', 'system', ['sepia'], {}]) {
      await expect(
        call(CHANNELS.projectsSetTheme, 'abcdefghijk1', theme),
        JSON.stringify(theme) ?? 'undefined',
      ).rejects.toThrow()
    }
    expect(calls, 'nothing reached the store').toEqual([])

    await expect(call(CHANNELS.projectsSetTheme, '../x', 'sepia')).rejects.toThrow('invalid id')
    await call(CHANNELS.projectsSetTheme, 'abcdefghijk1', 'sepia')
    await call(CHANNELS.projectsSetTheme, 'abcdefghijk1', 'warm-dark')
    expect(calls).toEqual([
      { method: 'setTheme', args: ['abcdefghijk1', 'sepia'] },
      { method: 'setTheme', args: ['abcdefghijk1', 'warm-dark'] },
    ])
  })

  it('refuses an export choice the engine would refuse, and passes a copy of one it would take', async () => {
    const { call, calls } = harness()
    for (const choice of [
      undefined,
      null,
      'instagram-reel',
      { preset: 'portfolio-svg', options: {} },
      { preset: 'instagram-reel' },
      { preset: 'instagram-reel', options: { safe: true } },
      { preset: 'instagram-reel', options: { theme: 'light' } },
      { preset: 'instagram-reel', options: { fade: 1 } },
      { preset: 'instagram-reel', options: { lines: ['A', 'A'] } },
      { preset: 'instagram-reel', options: { tag: '-leading' } },
      { preset: 'instagram-reel', storyboard: 'tour', options: {}, more: true },
    ]) {
      await expect(
        call(CHANNELS.projectsSetExport, 'abcdefghijk1', choice),
        JSON.stringify(choice) ?? 'undefined',
      ).rejects.toThrow()
    }
    expect(calls, 'nothing reached the store').toEqual([])

    const choice = {
      preset: 'bluesky-gif',
      storyboard: 'reveal',
      options: { labels: false, view: 'linear', lines: ['K'], tag: 'v2' },
    }
    await call(CHANNELS.projectsSetExport, 'abcdefghijk1', choice)
    expect(calls).toEqual([{ method: 'setExport', args: ['abcdefghijk1', choice] }])
    expect(calls[0].args[1], 'a copy, not the caller’s object').not.toBe(choice)
  })

  it('passes a palette the panel would send, and only its two fields', async () => {
    const { call, calls } = harness()
    await expect(call(CHANNELS.projectsCompleteColors, '../x', {})).rejects.toThrow('invalid id')
    await call(CHANNELS.projectsCompleteColors, 'abcdefghijk1', {
      colors: { A: '#0072bc', 'Rapid 720': '#FFFFFF' },
      defaultColor: '#888888',
      lineOrder: ['A'],
    })
    expect(calls).toEqual([
      {
        method: 'completeColors',
        args: [
          'abcdefghijk1',
          { colors: { A: '#0072bc', 'Rapid 720': '#FFFFFF' }, defaultColor: '#888888' },
        ],
      },
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
    // The cap is bytes of UTF-8, which a string's length is not: a euro
    // sign is one code unit and three bytes, so this is under the length
    // and over the cap.
    await expect(call('€'.repeat(CLIPBOARD_LIMIT / 2))).rejects.toThrow(/too much text/)
    expect(written).toEqual([])
  })

  it('takes text whose bytes fit, whatever its characters', async () => {
    const { call, written } = clipboard()
    const text = '€'.repeat(CLIPBOARD_LIMIT / 4)
    await call(text)
    expect(written).toEqual([text])
  })

  it('refuses a caller that is not the interface top frame', async () => {
    const { call, written } = clipboard(false)
    await expect(call('anything')).rejects.toThrow('forbidden')
    expect(written).toEqual([])
  })
})
