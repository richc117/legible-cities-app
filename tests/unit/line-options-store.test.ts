// A line's options in the store and on the bridge (issue 394, spec 036):
// `completeLines` writes what the map was drawn with, keeping only what is
// away from the engine's own, and puts the same into `drawn`; the handler
// refuses what the engine would before the store sees it, and takes only
// the five fields. Against a temporary engine home, as the store's own test
// is.
//
// Each test was watched failing under a mutation of the rule it holds; the
// mutation is named beside it.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerProjectHandlers } from '../../src/main/ipc'
import { ProjectStore } from '../../src/main/projects'
import { CHANNELS } from '../../src/shared/api'
import type { LayoutDone } from '../../src/shared/layout'

let home: string
let store: ProjectStore

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'legible-cities-lines-'))
  store = new ProjectStore(home, () => undefined)
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

const LAYOUT = 'a'.repeat(64)
const done: LayoutDone = {
  date: '2026-09-15',
  layout: LAYOUT,
  made: '2026-09-10T12:00:00+00:00',
  built: { mode: 'all', agency: null },
  service: { start: '2026-01-01', end: '2026-12-31', busiest: '2026-09-15', anchor: '2026-09-08' },
}

/** The record as it is on disk, every key the file holds. */
const onDisk = async (id: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(join(home, 'projects', id, 'project.json'), 'utf8'))

async function laidOut(): Promise<string> {
  const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
  await store.completeLayout(project.id, done)
  return project.id
}

describe('completeLines', () => {
  it('writes the options the map was drawn with, keeping only what is away from the engine’s own', async () => {
    const id = await laidOut()
    const after = await store.completeLines(id, {
      A: { name: 'Airport Express', hidden: false, width: 1 },
      B: { hidden: true },
      C: { dash: 'solid' },
    })
    // Mutation: `withLines` writes the lines as given - `hidden: false`, a
    // width of 1 and C's solid dash would then be on disk.
    expect(after.lines).toEqual({ A: { name: 'Airport Express' }, B: { hidden: true } })
    expect((await onDisk(id)).lines).toEqual({
      A: { name: 'Airport Express' },
      B: { hidden: true },
    })
    expect((await store.get(id)).lines).toEqual({
      A: { name: 'Airport Express' },
      B: { hidden: true },
    })
  })

  it('puts the same into what the map was drawn from, and keeps the day the map showed', async () => {
    const id = await laidOut()
    await store.setDate(id, '2026-09-20')
    const after = await store.completeLines(id, { B: { width: 1.5, dash: 'dotted' } })
    // Mutation: `completeLines` goes through `drew` - the chosen day, never
    // drawn, would then be stamped on the map.
    expect(after.drawn?.lines).toEqual({ B: { width: 1.5, dash: 'dotted' } })
    expect(after.drawn?.date).toBe('2026-09-15')
    expect(after.date).toBe('2026-09-20')
    expect((await onDisk(id)).drawn).toMatchObject({ lines: { B: { width: 1.5, dash: 'dotted' } } })
  })

  it('removes the key for a set of nothing, which is what Reset line leaves behind', async () => {
    // Mutation: `withLines` writes `{}` - a file that never chose anything
    // would then carry the key.
    const id = await laidOut()
    await store.completeLines(id, { A: { hidden: true } })
    await store.completeLines(id, { A: {} })
    const record = await onDisk(id)
    expect(record).not.toHaveProperty('lines')
    expect(record.drawn).not.toHaveProperty('lines')
  })

  it('refuses what the engine would, and writes nothing', async () => {
    // Mutation: the store's own check removed - a width of 2 from a caller
    // other than the bridge would then be written.
    const id = await laidOut()
    const before = await onDisk(id)
    await expect(store.completeLines(id, { A: { width: 2 } })).rejects.toThrow(
      "lines['A'].width must be from 0.75 to 1.5, as a multiple of line_width",
    )
    await expect(store.completeLines(id, { A: { colour: '#ff0000' } } as never)).rejects.toThrow(
      "lines['A'] does not take colour",
    )
    expect(await onDisk(id)).toEqual(before)
  })

  it('refuses before a layout, which has no map to draw them on', async () => {
    // Mutation: the layout check removed.
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await expect(store.completeLines(project.id, { A: { hidden: true } })).rejects.toThrow(
      'lay the project out first',
    )
  })
})

describe('the bridge’s handler for the line options', () => {
  type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

  function harness() {
    const handlers = new Map<string, Handler>()
    const ipc = {
      handle: (channel: string, h: Handler) => handlers.set(channel, h),
    } as unknown as IpcMain
    const calls: { method: string; args: unknown[] }[] = []
    const stub = new Proxy({} as ProjectStore, {
      get:
        (_t, method: string) =>
        async (...args: unknown[]) => {
          calls.push({ method, args })
          return { ok: method }
        },
    })
    registerProjectHandlers(ipc, stub, () => true)
    const call = (...args: unknown[]) =>
      handlers.get(CHANNELS.projectsCompleteLines)!({} as IpcMainInvokeEvent, ...args)
    return { call, calls }
  }

  it('refuses in the engine’s sentences before the store sees anything', async () => {
    // Mutation: the handler passes the options to the store unread - a name
    // past 40 characters would then reach the store from another process.
    const { call, calls } = harness()
    for (const [lines, sentence] of [
      [
        { A: { name: 'x'.repeat(41) } },
        "lines['A'].name must be from 1 to 40 characters with no line break",
      ],
      [{ A: { hidden: 1 } }, "lines['A'].hidden must be true or false"],
      [{ A: { casing: { width: 0.5 } } }, "lines['A'].casing must have both width and color"],
      [{ A: { dash: 'wavy' } }, "lines['A'].dash must be solid, dashed or dotted"],
      [{ A: { stroke: 2 } }, "lines['A'] does not take stroke"],
      [
        ['A'],
        "lines must be an object of line label to the line's name, hidden, width, casing and dash",
      ],
      [JSON.parse('{"__proto__": {"hidden": true}}'), 'a line cannot be called __proto__'],
    ] as const)
      await expect(call('abcdefghijk1', lines), JSON.stringify(lines)).rejects.toThrow(sentence)
    await expect(call('../x', { A: { hidden: true } })).rejects.toThrow('invalid id')
    expect(calls, 'nothing reached the store').toEqual([])
  })

  it('takes the five fields and a casing’s two, copied, and the stations where they read whole', async () => {
    // Mutation: the handler hands the store the object it was given - a change
    // to it afterwards would then reach the store.
    const { call, calls } = harness()
    const lines = {
      A: { name: 'Airport Express', casing: { width: 0.5, color: '#112233' } },
      B: { hidden: true, width: 1.25, dash: 'dashed' },
    }
    await call('abcdefghijk1', lines)
    await call('abcdefghijk1', {}, [{ id: '0x1', name: 'Alpha' }])
    lines.A.casing.width = 1
    lines.B.width = 1.5
    expect(calls).toEqual([
      {
        method: 'completeLines',
        args: [
          'abcdefghijk1',
          {
            A: { name: 'Airport Express', casing: { width: 0.5, color: '#112233' } },
            B: { hidden: true, width: 1.25, dash: 'dashed' },
          },
        ],
      },
      { method: 'completeLines', args: ['abcdefghijk1', {}, [{ id: '0x1', name: 'Alpha' }]] },
    ])
  })
})
