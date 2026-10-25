// Main refuses what would break a run that is going (spec 037, User Story 4,
// issue 491): an export while a request is writing the project's map, and a
// deletion while the project's export runs or a request is writing its map.
// Every case here is judged from main alone, with no renderer in the room:
// the interface's disabled buttons are the first line, and these are the
// last, for a button that was somehow pressed anyway.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerEngineHandlers, type EngineSource } from '../../src/main/engine-ipc'
import { Exporter, type ExportEngine } from '../../src/main/export'
import { NO_ROOTS } from '../../src/main/ipc-shape'
import { ProjectActivity, projectNamedBy } from '../../src/main/projectActivity'
import { ProjectStore } from '../../src/main/projects'
import {
  DELETE_WHILE_DRAWING,
  DELETE_WHILE_EXPORTING,
  EXPORT_WHILE_DRAWING,
} from '../../src/shared/activity'
import { CHANNELS } from '../../src/shared/api'
import { EngineError, ERROR_CODES } from '../../src/shared/engine'
import type { ExportChoice } from '../../src/shared/export'
import { DEFAULT_STYLE } from '../../src/shared/project'

const REEL: ExportChoice = { preset: 'instagram-reel', options: {} }
const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

let home: string
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'legible-cities-activity-'))
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

/** The sentences the spec fixes, written out so a change to a constant is seen. */
describe('the sentences', () => {
  it('are the ones the spec gives', () => {
    expect(EXPORT_WHILE_DRAWING).toBe(
      "This project's map is being drawn. Wait for it to finish, then export.",
    )
    expect(DELETE_WHILE_EXPORTING).toBe(
      'This project is exporting. Wait for the export to finish or cancel it, then delete the project.',
    )
    expect(DELETE_WHILE_DRAWING).toBe(
      'This project is being drawn. Wait for it to finish or cancel it, then delete the project.',
    )
  })
})

describe('which request names a project', () => {
  it('is a map.build with an out folder, and nothing else', () => {
    expect(projectNamedBy('map.build', { out: 'abcdefghijk1' })).toBe('abcdefghijk1')
    // Without `out` the files go into out/ itself: no project.
    expect(projectNamedBy('map.build', { key: 'bart' })).toBeNull()
    expect(projectNamedBy('map.build', undefined)).toBeNull()
    expect(projectNamedBy('map.build', { out: '' })).toBeNull()
    expect(projectNamedBy('map.build', { out: 7 })).toBeNull()
    // These carry a feed's key and a layout's id, which projects share.
    expect(projectNamedBy('graph.build', { key: 'bart', out: 'abcdefghijk1' })).toBeNull()
    expect(projectNamedBy('render.stage', { key: 'bart' })).toBeNull()
  })
})

describe('the marks', () => {
  it('count, and a release is safe to repeat', () => {
    const activity = new ProjectActivity()
    const first = activity.beginRequest('p')
    const second = activity.beginRequest('p')
    first()
    first()
    // The second request still holds the mark.
    expect(activity.deleteRefusal('p')).toBe(DELETE_WHILE_DRAWING)
    second()
    expect(activity.deleteRefusal('p')).toBeNull()
    expect(activity.exportRefusal('p')).toBeNull()
  })
  it('keep one project from refusing another', () => {
    const activity = new ProjectActivity()
    activity.beginRequest('p')
    activity.beginExport('p')
    expect(activity.deleteRefusal('q')).toBeNull()
    expect(activity.exportRefusal('q')).toBeNull()
  })
  it('say the export first when both are going', () => {
    const activity = new ProjectActivity()
    activity.beginRequest('p')
    activity.beginExport('p')
    expect(activity.deleteRefusal('p')).toBe(DELETE_WHILE_EXPORTING)
  })
})

/** The engine bridge over a fake engine whose answers are held until a test settles them. */
function bridge(
  activity: ProjectActivity,
  over: {
    guard?: (method: string) => Promise<string | null>
    throwOnRequest?: boolean
  } = {},
) {
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, ...a: unknown[]) => Promise<unknown>
  >()
  const ipc = { handle: (c: string, h: never) => handlers.set(c, h) } as unknown as IpcMain
  const held: {
    id: number
    method: string
    resolve(v: unknown): void
    reject(e: unknown): void
  }[] = []
  const cancelled: number[] = []
  let nextId = 1
  const engine: EngineSource = {
    state: { state: 'ready', version: '0.19.0', protocol: 1 },
    request: (method) => {
      if (over.throwOnRequest) throw new Error('the engine is gone')
      const id = nextId++
      let resolve!: (v: unknown) => void
      let reject!: (e: unknown) => void
      const result = new Promise<unknown>((res, rej) => {
        resolve = res
        reject = rej
      })
      held.push({ id, method, resolve, reject })
      return { id, result }
    },
    cancel: (id) => {
      cancelled.push(id)
      held.find((h) => h.id === id)?.reject(new EngineError(ERROR_CODES.cancelled, 'cancelled'))
    },
    onState: () => () => {},
    onNotification: () => () => {},
  }
  registerEngineHandlers(
    ipc,
    engine,
    () => true,
    () => {},
    () => {},
    over.guard,
    NO_ROOTS,
    activity,
  )
  const event = {} as IpcMainInvokeEvent
  return {
    held,
    cancelled,
    request: (token: string, method: string, params?: unknown) =>
      handlers.get(CHANNELS.engineRequest)!(event, token, method, params),
    cancel: (token: string) => handlers.get(CHANNELS.engineCancel)!(event, token),
  }
}

describe('the engine bridge marks a project while a request names it', () => {
  it('from the request to its answer', async () => {
    const activity = new ProjectActivity()
    const b = bridge(activity)
    await b.request('t1', 'map.build', { out: 'abcdefghijk1' })
    expect(activity.deleteRefusal('abcdefghijk1')).toBe(DELETE_WHILE_DRAWING)
    expect(activity.exportRefusal('abcdefghijk1')).toBe(EXPORT_WHILE_DRAWING)
    b.held[0].resolve({})
    await tick()
    expect(activity.deleteRefusal('abcdefghijk1')).toBeNull()
    expect(activity.exportRefusal('abcdefghijk1')).toBeNull()
  })
  it('and clears the mark when the request fails', async () => {
    const activity = new ProjectActivity()
    const b = bridge(activity)
    await b.request('t1', 'map.build', { out: 'abcdefghijk1' })
    b.held[0].reject(new EngineError(ERROR_CODES.badCall, 'no such layout'))
    await tick()
    expect(activity.deleteRefusal('abcdefghijk1')).toBeNull()
  })
  it('and clears the mark when the request is cancelled', async () => {
    const activity = new ProjectActivity()
    const b = bridge(activity)
    await b.request('t1', 'map.build', { out: 'abcdefghijk1' })
    expect(activity.deleteRefusal('abcdefghijk1')).not.toBeNull()
    await b.cancel('t1')
    await tick()
    expect(b.cancelled).toEqual([1])
    expect(activity.deleteRefusal('abcdefghijk1')).toBeNull()
  })
  it('and clears the mark when the guard refuses or fails', async () => {
    const activity = new ProjectActivity()
    const refusing = bridge(activity, { guard: async () => 'not now' })
    await refusing.request('t1', 'map.build', { out: 'abcdefghijk1' })
    expect(activity.deleteRefusal('abcdefghijk1')).toBeNull()
    const failing = bridge(activity, {
      guard: async () => {
        throw new Error('the guard broke')
      },
    })
    await expect(failing.request('t2', 'map.build', { out: 'abcdefghijk1' })).rejects.toThrow()
    expect(activity.deleteRefusal('abcdefghijk1')).toBeNull()
  })
  it('and clears the mark when the supervisor refuses to send it', async () => {
    const activity = new ProjectActivity()
    const b = bridge(activity, { throwOnRequest: true })
    await b.request('t1', 'map.build', { out: 'abcdefghijk1' })
    expect(activity.deleteRefusal('abcdefghijk1')).toBeNull()
  })
  it('already marks while the guard is still thinking', async () => {
    const activity = new ProjectActivity()
    let open!: (v: string | null) => void
    const b = bridge(activity, { guard: () => new Promise((r) => (open = r)) })
    const asked = b.request('t1', 'map.build', { out: 'abcdefghijk1' })
    await tick()
    expect(activity.deleteRefusal('abcdefghijk1')).toBe(DELETE_WHILE_DRAWING)
    open(null)
    await asked
    b.held[0].resolve({})
    await tick()
    expect(activity.deleteRefusal('abcdefghijk1')).toBeNull()
  })
  it('does not mark a request that names no project', async () => {
    const activity = new ProjectActivity()
    const b = bridge(activity)
    await b.request('t1', 'map.build', { key: 'bart' })
    await b.request('t2', 'graph.build', { key: 'bart' })
    await b.request('t3', 'render.stage', { key: 'bart' })
    expect(activity.deleteRefusal('bart')).toBeNull()
    expect(activity.deleteRefusal('abcdefghijk1')).toBeNull()
  })
})

/** An exporter whose engine records what it was asked and answers nothing until told. */
function exporterOver(activity: ProjectActivity, id = 'abcdefghijk1') {
  const asked: string[] = []
  const pending: { method: string; reject(e: unknown): void }[] = []
  const engine: ExportEngine = {
    request(method) {
      asked.push(method)
      if (method === 'export.presets') return { id: 1, result: Promise.resolve({ presets: [] }) }
      let reject!: (e: unknown) => void
      const result = new Promise<unknown>((_, rej) => (reject = rej))
      pending.push({ method, reject })
      return { id: 2, result }
    },
    cancel: () => {},
    onNotification: () => () => {},
  }
  const gets: string[] = []
  const exporter = new Exporter({
    engine,
    projects: {
      get: async (project) => {
        gets.push(project)
        return {
          version: 1,
          id: project,
          name: 'Los Angeles',
          feed: 'la-metro-rail',
          mode: 'all',
          agency: null,
          date: '2026-09-08',
          layout: 'a'.repeat(64),
          created: '2026-09-08T00:00:00.000Z',
          modified: '2026-09-08T00:00:00.000Z',
          theme: 'dark',
          style: DEFAULT_STYLE,
          readOnly: false,
        } as never
      },
    },
    capture: async () => {
      throw new Error('nothing is captured here')
    },
    framesRoot: join(home, 'frames'),
    exportFolder: () => join(home, 'exports'),
    activity,
    log: () => {},
  })
  void id
  return { exporter, asked, gets, pending }
}

describe('Exporter.start', () => {
  it('is refused while a request is writing the project’s map, and plans and writes nothing', () => {
    const activity = new ProjectActivity()
    const { exporter, asked, gets } = exporterOver(activity)
    activity.beginRequest('abcdefghijk1')
    expect(() => exporter.start('tok-1', 'abcdefghijk1', REEL)).toThrow(EXPORT_WHILE_DRAWING)
    expect(exporter.live).toBe(0)
    expect(asked).toEqual([])
    expect(gets).toEqual([])
    expect(existsSync(join(home, 'frames'))).toBe(false)
    expect(existsSync(join(home, 'exports'))).toBe(false)
  })
  it('is not refused for another project’s map', () => {
    const activity = new ProjectActivity()
    const { exporter } = exporterOver(activity)
    activity.beginRequest('zzzzzzzzzzzz')
    const { result } = exporter.start('tok-1', 'abcdefghijk1', REEL)
    result.catch(() => {})
    expect(exporter.live).toBe(1)
  })
  it('is not refused once the request has ended', () => {
    const activity = new ProjectActivity()
    const { exporter } = exporterOver(activity)
    activity.beginRequest('abcdefghijk1')()
    const { result } = exporter.start('tok-1', 'abcdefghijk1', REEL)
    result.catch(() => {})
    expect(exporter.live).toBe(1)
  })
  it('marks the project while it runs and clears it when the export fails', async () => {
    const activity = new ProjectActivity()
    // The empty preset table makes the export fail on its own, after it began.
    const { exporter } = exporterOver(activity)
    const { result } = exporter.start('tok-1', 'abcdefghijk1', REEL)
    expect(activity.deleteRefusal('abcdefghijk1')).toBe(DELETE_WHILE_EXPORTING)
    await expect(result).rejects.toBeDefined()
    expect(activity.deleteRefusal('abcdefghijk1')).toBeNull()
  })
})

describe('ProjectStore.delete', () => {
  async function made(activity: ProjectActivity) {
    const store = new ProjectStore(home, () => {}, {}, activity)
    const project = await store.create({ name: 'Keep', feed: 'la-metro-rail' })
    await mkdir(join(home, 'out', project.id), { recursive: true })
    await writeFile(join(home, 'out', project.id, 'index.html'), '<title>kept</title>')
    return { store, project }
  }
  const untouched = async (id: string): Promise<void> => {
    await access(join(home, 'projects', id, 'project.json'))
    expect(await readFile(join(home, 'out', id, 'index.html'), 'utf8')).toBe('<title>kept</title>')
  }

  it('is refused while the project’s export runs, and the record and out folder stay', async () => {
    const activity = new ProjectActivity()
    const { store, project } = await made(activity)
    const release = activity.beginExport(project.id)
    await expect(store.delete(project.id)).rejects.toThrow(DELETE_WHILE_EXPORTING)
    await untouched(project.id)
    expect((await store.list()).map((s) => s.id)).toEqual([project.id])
    release()
    expect(await store.delete(project.id)).toEqual({ removed: ['project', 'output'], failed: [] })
  })
  it('is refused while a request naming the project is in flight', async () => {
    const activity = new ProjectActivity()
    const { store, project } = await made(activity)
    const release = activity.beginRequest(project.id)
    await expect(store.delete(project.id)).rejects.toThrow(DELETE_WHILE_DRAWING)
    await untouched(project.id)
    release()
    expect(await store.delete(project.id)).toEqual({ removed: ['project', 'output'], failed: [] })
  })
  it('asks at the moment the deletion runs, after the writes queued before it', async () => {
    const activity = new ProjectActivity()
    const { store, project } = await made(activity)
    const rename = store.rename(project.id, 'Renamed')
    const deletion = store.delete(project.id)
    // The mark goes up after the deletion was sent and before it runs.
    activity.beginExport(project.id)
    await rename
    await expect(deletion).rejects.toThrow(DELETE_WHILE_EXPORTING)
    await untouched(project.id)
  })
  it('leaves another project alone', async () => {
    const activity = new ProjectActivity()
    const { store, project } = await made(activity)
    activity.beginExport('zzzzzzzzzzzz')
    activity.beginRequest('zzzzzzzzzzzz')
    expect(await store.delete(project.id)).toEqual({ removed: ['project', 'output'], failed: [] })
  })
})
