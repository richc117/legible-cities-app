// The layout's tuning in the store and on the bridge (issue 385, spec 033):
// `setTuning` writes what a person committed at once and keeps only what is
// away from LOOM's own; `completeLayout` keeps beside the layout the tuning
// its run was asked with; the handler refuses what the engine would before
// the store sees it. Against a temporary engine home, as the store's own
// test is.
//
// Each test was watched failing under a mutation of the rule it holds; the
// mutation is named beside it.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerProjectHandlers } from '../../src/main/ipc'
import { ProjectStore } from '../../src/main/projects'
import { CHANNELS } from '../../src/shared/api'
import type { LayoutDone } from '../../src/shared/layout'
import { GRID_SENTENCE, tuningRangeSentence } from '../../src/shared/project'

let home: string
let store: ProjectStore

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'legible-cities-tuning-'))
  store = new ProjectStore(home, () => undefined)
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

const LAYOUT = 'a'.repeat(64)
const TUNED = 'b'.repeat(64)
const WINDOW = {
  start: '2026-01-01',
  end: '2026-12-31',
  busiest: '2026-09-15',
  anchor: '2026-09-08',
}
const MADE = '2026-09-10T12:00:00+00:00'
const done = (over: Partial<LayoutDone> = {}): LayoutDone => ({
  date: '2026-09-15',
  layout: LAYOUT,
  made: MADE,
  built: { mode: 'all', agency: null },
  service: WINDOW,
  ...over,
})

/** The record as it is on disk, every key the file holds. */
const onDisk = async (id: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(join(home, 'projects', id, 'project.json'), 'utf8'))

describe('setTuning', () => {
  it('writes a tuning at once, keeping only what is away from LOOM’s own', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const after = await store.setTuning(project.id, {
      grid: 'orthoradial',
      mergeDistance: 50,
      deg45: 3,
    })
    // Mutation: `withTuning` keeps the settled tuning's defaults - the merge
    // distance of 50 is then on disk.
    expect(after.tuning).toEqual({ grid: 'orthoradial', deg45: 3 })
    expect((await onDisk(project.id)).tuning).toEqual({ grid: 'orthoradial', deg45: 3 })
    expect((await store.get(project.id)).tuning).toEqual({ grid: 'orthoradial', deg45: 3 })
  })

  it('removes the key for a tuning of nothing, which is what Reset sends', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await store.setTuning(project.id, { gridSize: 50 })
    await store.setTuning(project.id, {})
    expect(await onDisk(project.id)).not.toHaveProperty('tuning')
    await store.setTuning(project.id, { gridSize: 50 })
    await store.setTuning(project.id, { gridSize: 100, grid: 'octilinear' })
    expect(await onDisk(project.id), 'LOOM’s own is no choice').not.toHaveProperty('tuning')
  })

  it('writes nothing for a tuning the record already holds', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const first = await store.setTuning(project.id, { deg90: 2 })
    const again = await store.setTuning(project.id, { deg90: 2, deg135: 1 })
    expect(again.modified).toBe(first.modified)
  })

  it('may tune a project before its first layout, and draws nothing for it', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const after = await store.setTuning(project.id, { grid: 'hexalinear' })
    expect(after.layout).toBeNull()
    expect(after.drawn).toBeNull()
    expect(after).not.toHaveProperty('laidOutWith')
  })

  it('refuses what the engine would, in its sentence, and writes nothing', async () => {
    // Mutation: the store's `check(validateTuning(...))` removed - the out
    // of range number is then written.
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await expect(store.setTuning(project.id, { mergeDistance: 600 })).rejects.toThrow(
      tuningRangeSentence('mergeDistance'),
    )
    await expect(store.setTuning(project.id, { grid: 'quadtree' as never })).rejects.toThrow(
      GRID_SENTENCE,
    )
    await expect(store.setTuning(project.id, { slider: 3 } as never)).rejects.toThrow(
      'the tuning does not take slider',
    )
    expect(await onDisk(project.id)).not.toHaveProperty('tuning')
  })

  it('refuses a project a newer version of the app made', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    const file = join(home, 'projects', project.id, 'project.json')
    await writeFile(file, JSON.stringify({ ...(await onDisk(project.id)), version: 99 }))
    await expect(store.setTuning(project.id, { grid: 'hexalinear' })).rejects.toThrow('read-only')
  })

  it('keeps every other field, and the layout’s own record of what it was asked with', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await store.completeLayout(project.id, done({ tuning: { gridSize: 50 } }))
    const after = await store.setTuning(project.id, { grid: 'ortholinear' })
    expect(after.laidOutWith, 'only a layout run moves it').toEqual({ gridSize: 50 })
    expect(after.layout).toBe(LAYOUT)
    expect(after.drawn?.layout, 'and nothing was drawn').toBe(LAYOUT)
  })
})

describe('completeLayout and what the layout was asked with', () => {
  it('keeps the tuning the run sent beside the layout', async () => {
    // Mutation: `completeLayout` copies the record's own `tuning` in place
    // of `done.tuning` - the record's ortholinear is then written here.
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await store.setTuning(project.id, { grid: 'ortholinear' })
    const { record } = await store.completeLayout(
      project.id,
      done({ layout: TUNED, tuning: { grid: 'hexalinear', deg45: 2 } }),
    )
    expect(record.laidOutWith, 'what was sent, not what is chosen now').toEqual({
      grid: 'hexalinear',
    })
    expect(record.tuning, 'the choice is left as it is').toEqual({ grid: 'ortholinear' })
    expect((await onDisk(project.id)).laidOutWith).toEqual({ grid: 'hexalinear' })
  })

  it('removes it for a run sent none, which was LOOM’s defaults', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await store.completeLayout(project.id, done({ layout: TUNED, tuning: { gridSize: 50 } }))
    await store.completeLayout(project.id, done())
    expect(await onDisk(project.id)).not.toHaveProperty('laidOutWith')
  })

  it('leaves a project that never tuned without either key', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await store.completeLayout(project.id, done())
    const file = await onDisk(project.id)
    expect(file).not.toHaveProperty('tuning')
    expect(file).not.toHaveProperty('laidOutWith')
  })

  it('refuses a run that says it sent what the engine would have refused', async () => {
    const project = await store.create({ name: 'LA', feed: 'la-metro-rail' })
    await expect(store.completeLayout(project.id, done({ tuning: { deg90: 11 } }))).rejects.toThrow(
      tuningRangeSentence('deg90'),
    )
    expect((await onDisk(project.id)).layout).toBeNull()
  })
})

// ---- the bridge's main side

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
  const call = (channel: string, ...args: unknown[]) =>
    (handlers.get(channel) as Handler)({} as IpcMainInvokeEvent, ...args)
  return { call, calls }
}

describe('the tuning on the bridge', () => {
  it('refuses a tuning the engine would refuse before the store sees it', async () => {
    // Mutation: the handler hands the raw argument to the store - the store
    // stub is then called with each of these.
    const { call, calls } = harness()
    for (const tuning of [
      undefined,
      null,
      'hexalinear',
      { grid: 'quadtree' },
      { mergeDistance: 4 },
      { gridSize: '50' },
      { penalties: { deg45: 3 } },
      { deg45: null },
    ]) {
      await expect(
        call(CHANNELS.projectsSetTuning, 'abcdefghijk1', tuning),
        JSON.stringify(tuning),
      ).rejects.toThrow()
    }
    expect(calls).toEqual([])
  })

  it('hands the store the eight fields and nothing else', async () => {
    const { call, calls } = harness()
    const tuning = { grid: 'orthoradial', mergeDistance: 80, deg180: 1 }
    await call(CHANNELS.projectsSetTuning, 'abcdefghijk1', tuning)
    expect(calls).toEqual([{ method: 'setTuning', args: ['abcdefghijk1', tuning] }])
  })

  it('passes a finished run’s tuning on, held to the same rules, and none where it sent none', async () => {
    const { call, calls } = harness()
    const finished = done()
    await call(CHANNELS.projectsCompleteLayout, 'abcdefghijk1', {
      ...finished,
      tuning: { grid: 'hexalinear' },
    })
    await call(CHANNELS.projectsCompleteLayout, 'abcdefghijk1', finished)
    expect((calls[0].args[1] as LayoutDone).tuning).toEqual({ grid: 'hexalinear' })
    expect(calls[1].args[1]).not.toHaveProperty('tuning')
    await expect(
      call(CHANNELS.projectsCompleteLayout, 'abcdefghijk1', {
        ...finished,
        tuning: { gridSize: 500 },
      }),
    ).rejects.toThrow(tuningRangeSentence('gridSize'))
    expect(calls).toHaveLength(2)
  })

  it('refuses a project id that is not one, as every writer does', async () => {
    const { call, calls } = harness()
    await expect(call(CHANNELS.projectsSetTuning, '../x', {})).rejects.toThrow('invalid id')
    expect(calls).toEqual([])
  })
})
