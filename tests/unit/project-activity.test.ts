// Main refuses what would break a run that is going (spec 037, User Story 4,
// issue 491): an export while a request is writing the project's map, and a
// deletion while the project's export runs or a request is writing its map.
// Every case here is judged from main alone, with no renderer in the room:
// the interface's disabled buttons are the first line, and these are the
// last, for a button that was somehow pressed anyway.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  registerEngineHandlers,
  type EngineSource,
  type RecordLookup,
} from '../../src/main/engine-ipc'
import { Exporter, type ExportEngine } from '../../src/main/export'
import { NO_ROOTS } from '../../src/main/ipc-shape'
import { ProjectActivity, projectNamedBy } from '../../src/main/projectActivity'
import { ProjectStore } from '../../src/main/projects'
import {
  DELETE_WHILE_DRAWING,
  DELETE_WHILE_EXPORTING,
  DRAW_WHILE_EXPORTING,
  EXPORT_WHILE_DRAWING,
  REQUEST_FOR_NO_PROJECT,
  REQUEST_UNCHECKED,
  REQUEST_WHILE_DELETING,
} from '../../src/shared/activity'
import { CHANNELS } from '../../src/shared/api'
import { EngineError, ERROR_CODES } from '../../src/shared/engine'
import type { ExportChoice } from '../../src/shared/export'
import { DEFAULT_STYLE } from '../../src/shared/project/types'
import { until } from '../support/until'

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
  it('and the ones issue 505 adds', () => {
    expect(DRAW_WHILE_EXPORTING).toBe(
      'This project is exporting. Wait for the export to finish or cancel it, then try again.',
    )
    expect(REQUEST_FOR_NO_PROJECT).toBe('This project has been deleted.')
    expect(REQUEST_UNCHECKED).toBe('This project could not be found in time. Try again.')
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
  it('hold a deletion against requests and exports of that project only', () => {
    const activity = new ProjectActivity(() => 0)
    const done = activity.beginDelete('p')
    expect(activity.requestRefusal('p')).toBe(REQUEST_WHILE_DELETING)
    expect(activity.exportRefusal('p')).toBe(REQUEST_WHILE_DELETING)
    expect(activity.requestRefusal('q')).toBeNull()
    expect(activity.exportRefusal('q')).toBeNull()
    done()
    expect(activity.requestRefusal('p')).toBeNull()
    expect(activity.exportRefusal('p')).toBeNull()
  })
  it('hold an export against requests that write that project only (issue 505)', () => {
    // Mutation: `requestRefusal` without its export line - the first expect
    // reads null.
    const activity = new ProjectActivity(() => 0)
    const done = activity.beginExport('p')
    expect(activity.requestRefusal('p')).toBe(DRAW_WHILE_EXPORTING)
    expect(activity.requestRefusal('q')).toBeNull()
    done()
    expect(activity.requestRefusal('p')).toBeNull()
  })
  it('hold an abandoned project, and only it, while the engine has work unanswered', () => {
    let abandoned = 2
    const activity = new ProjectActivity(() => abandoned)
    // Nothing stuck is named yet: a count alone refuses no project.
    expect(activity.exportRefusal('p')).toBeNull()
    activity.abandon('p')
    expect(activity.exportRefusal('p')).toBe(EXPORT_WHILE_DRAWING)
    expect(activity.deleteRefusal('p')).toBe(DELETE_WHILE_DRAWING)
    expect(activity.exportRefusal('q')).toBeNull()
    expect(activity.deleteRefusal('q')).toBeNull()
    abandoned = 0
    expect(activity.exportRefusal('p')).toBeNull()
    expect(activity.deleteRefusal('p')).toBeNull()
    // Once the count has been read at 0 the set is empty, so a count that
    // rises afterwards does not bring this project back. (A hold nobody read
    // at 0 would come back: the known limit in the header.)
    abandoned = 1
    expect(activity.exportRefusal('p')).toBeNull()
  })
  it('do not hold a project for an abandon the engine has already answered', () => {
    const activity = new ProjectActivity(() => 0)
    activity.abandon('p')
    expect(activity.deleteRefusal('p')).toBeNull()
  })
  it('count, and a release is safe to repeat', () => {
    const activity = new ProjectActivity(() => 0)
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
    const activity = new ProjectActivity(() => 0)
    activity.beginRequest('p')
    activity.beginExport('p')
    expect(activity.deleteRefusal('q')).toBeNull()
    expect(activity.exportRefusal('q')).toBeNull()
  })
  it('say the export first when both are going', () => {
    const activity = new ProjectActivity(() => 0)
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
    /** The store's lookup; by default every project has its record. */
    records?: RecordLookup
    lookupMs?: number
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
    request: (method, params) => {
      if (over.throwOnRequest) throw new Error('the engine is gone')
      // A map.build that reaches the engine writes its folder at once, as the
      // real one stages and renames it, so "nothing written" is a fact on
      // disk and not only an empty list of requests.
      if (method === 'map.build' && typeof params?.out === 'string') {
        mkdirSync(join(home, 'out', params.out), { recursive: true })
        writeFileSync(join(home, 'out', params.out, 'index.html'), '<title>drawn</title>')
      }
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
    retry: () => null,
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
    over.records ?? { recordGone: async () => false },
    () => null,
    over.lookupMs,
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
    const activity = new ProjectActivity(() => 0)
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
    const activity = new ProjectActivity(() => 0)
    const b = bridge(activity)
    await b.request('t1', 'map.build', { out: 'abcdefghijk1' })
    b.held[0].reject(new EngineError(ERROR_CODES.badCall, 'no such layout'))
    await tick()
    expect(activity.deleteRefusal('abcdefghijk1')).toBeNull()
  })
  it('and clears the mark when the request is cancelled', async () => {
    const activity = new ProjectActivity(() => 0)
    const b = bridge(activity)
    await b.request('t1', 'map.build', { out: 'abcdefghijk1' })
    expect(activity.deleteRefusal('abcdefghijk1')).not.toBeNull()
    await b.cancel('t1')
    await tick()
    expect(b.cancelled).toEqual([1])
    expect(activity.deleteRefusal('abcdefghijk1')).toBeNull()
  })
  it('holds the project, and only it, when a bound ends its request while the engine still works', async () => {
    let abandoned = 1
    const activity = new ProjectActivity(() => abandoned)
    const b = bridge(activity)
    await b.request('t1', 'map.build', { out: 'abcdefghijk1' })
    b.held[0].reject(new EngineError(ERROR_CODES.inactive, 'no word from the engine'))
    await tick()
    // The request is over, the engine is not: still refused, with the
    // existing sentences, which are true.
    expect(activity.deleteRefusal('abcdefghijk1')).toBe(DELETE_WHILE_DRAWING)
    expect(activity.exportRefusal('abcdefghijk1')).toBe(EXPORT_WHILE_DRAWING)
    expect(activity.deleteRefusal('zzzzzzzzzzzz')).toBeNull()
    expect(activity.exportRefusal('zzzzzzzzzzzz')).toBeNull()
    abandoned = 0
    expect(activity.deleteRefusal('abcdefghijk1')).toBeNull()
    expect(activity.exportRefusal('abcdefghijk1')).toBeNull()
  })
  it('does not hold the project for a failure that is not a bound, whatever the engine owes', async () => {
    const activity = new ProjectActivity(() => 1)
    const b = bridge(activity)
    await b.request('t1', 'map.build', { out: 'abcdefghijk1' })
    b.held[0].reject(new EngineError(ERROR_CODES.badCall, 'no such layout'))
    await tick()
    expect(activity.deleteRefusal('abcdefghijk1')).toBeNull()
  })
  it('and clears the mark when the guard refuses or fails', async () => {
    const activity = new ProjectActivity(() => 0)
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
    const activity = new ProjectActivity(() => 0)
    const b = bridge(activity, { throwOnRequest: true })
    await b.request('t1', 'map.build', { out: 'abcdefghijk1' })
    expect(activity.deleteRefusal('abcdefghijk1')).toBeNull()
  })
  it('already marks while the guard is still thinking', async () => {
    const activity = new ProjectActivity(() => 0)
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
    const activity = new ProjectActivity(() => 0)
    const b = bridge(activity)
    await b.request('t1', 'map.build', { key: 'bart' })
    await b.request('t2', 'graph.build', { key: 'bart' })
    await b.request('t3', 'render.stage', { key: 'bart' })
    expect(activity.deleteRefusal('bart')).toBeNull()
    expect(activity.deleteRefusal('abcdefghijk1')).toBeNull()
  })
})

/** An exporter whose engine records what it was asked and answers nothing until told. */
function exporterOver(activity: ProjectActivity, presets: unknown = { presets: [] }) {
  const asked: string[] = []
  const pending: { id: number; method: string; reject(e: unknown): void }[] = []
  const cancelled: number[] = []
  const engine: ExportEngine = {
    request(method) {
      asked.push(method)
      if (method === 'export.presets') return { id: 1, result: Promise.resolve(presets) }
      let reject!: (e: unknown) => void
      const result = new Promise<unknown>((_, rej) => (reject = rej))
      pending.push({ id: 2, method, reject })
      return { id: 2, result }
    },
    cancel: (id) => {
      cancelled.push(id)
      pending.find((p) => p.id === id)?.reject(new EngineError(ERROR_CODES.cancelled, 'cancelled'))
    },
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
  return { exporter, asked, gets, pending, cancelled }
}

describe('Exporter.start', () => {
  it('is refused while a request is writing the project’s map, and plans and writes nothing', () => {
    const activity = new ProjectActivity(() => 0)
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
    const activity = new ProjectActivity(() => 0)
    const { exporter } = exporterOver(activity)
    activity.beginRequest('zzzzzzzzzzzz')
    const { result } = exporter.start('tok-1', 'abcdefghijk1', REEL)
    result.catch(() => {})
    expect(exporter.live).toBe(1)
  })
  it('is not refused once the request has ended', () => {
    const activity = new ProjectActivity(() => 0)
    const { exporter } = exporterOver(activity)
    activity.beginRequest('abcdefghijk1')()
    const { result } = exporter.start('tok-1', 'abcdefghijk1', REEL)
    result.catch(() => {})
    expect(exporter.live).toBe(1)
  })
  it('is refused while the engine reports a request it stopped answering', () => {
    let abandoned = 1
    const activity = new ProjectActivity(() => abandoned)
    activity.abandon('abcdefghijk1')
    const { exporter, asked } = exporterOver(activity)
    expect(() => exporter.start('tok-1', 'abcdefghijk1', REEL)).toThrow(EXPORT_WHILE_DRAWING)
    expect(asked).toEqual([])
    abandoned = 0
    const { result } = exporter.start('tok-1', 'abcdefghijk1', REEL)
    result.catch(() => {})
    expect(exporter.live).toBe(1)
  })
  it('is refused while the project is being deleted', () => {
    const activity = new ProjectActivity(() => 0)
    const { exporter, asked } = exporterOver(activity)
    const done = activity.beginDelete('abcdefghijk1')
    expect(() => exporter.start('tok-1', 'abcdefghijk1', REEL)).toThrow(REQUEST_WHILE_DELETING)
    expect(asked).toEqual([])
    done()
  })
  it('clears the mark when a running export is cancelled', async () => {
    const activity = new ProjectActivity(() => 0)
    const presets = JSON.parse(
      readFileSync(join(__dirname, '../fixtures/export-tables-v0.8.2.json'), 'utf8'),
    ) as { presets: unknown[] }
    const { exporter, pending, cancelled } = exporterOver(activity, { presets: presets.presets })
    const { result } = exporter.start('tok-1', 'abcdefghijk1', REEL)
    result.catch(() => {})
    // Held at the engine's plan: the export is running, and nothing has ended.
    const deadline = Date.now() + 10_000
    while (pending.length === 0 && Date.now() < deadline) await tick()
    expect(pending.map((p) => p.method)).toEqual(['export.plan'])
    expect(activity.deleteRefusal('abcdefghijk1')).toBe(DELETE_WHILE_EXPORTING)
    exporter.cancel('tok-1')
    await expect(result).rejects.toMatchObject({ code: ERROR_CODES.cancelled })
    expect(cancelled).toEqual([2])
    expect(activity.deleteRefusal('abcdefghijk1')).toBeNull()
    expect(exporter.live).toBe(0)
  })
  it('marks the project while it runs and clears it when the export fails', async () => {
    const activity = new ProjectActivity(() => 0)
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
    const activity = new ProjectActivity(() => 0)
    const { store, project } = await made(activity)
    const release = activity.beginExport(project.id)
    await expect(store.delete(project.id)).rejects.toThrow(DELETE_WHILE_EXPORTING)
    await untouched(project.id)
    expect((await store.list()).map((s) => s.id)).toEqual([project.id])
    release()
    expect(await store.delete(project.id)).toEqual({ removed: ['project', 'output'], failed: [] })
  })
  it('is refused while a request naming the project is in flight', async () => {
    const activity = new ProjectActivity(() => 0)
    const { store, project } = await made(activity)
    const release = activity.beginRequest(project.id)
    await expect(store.delete(project.id)).rejects.toThrow(DELETE_WHILE_DRAWING)
    await untouched(project.id)
    release()
    expect(await store.delete(project.id)).toEqual({ removed: ['project', 'output'], failed: [] })
  })
  it('asks at the moment the deletion runs, after the writes queued before it', async () => {
    const activity = new ProjectActivity(() => 0)
    const { store, project } = await made(activity)
    const rename = store.rename(project.id, 'Renamed')
    const deletion = store.delete(project.id)
    // The mark goes up after the deletion was sent and before it runs.
    activity.beginExport(project.id)
    await rename
    await expect(deletion).rejects.toThrow(DELETE_WHILE_EXPORTING)
    await untouched(project.id)
  })
  it('is refused while the engine reports a request it stopped answering', async () => {
    let abandoned = 1
    const activity = new ProjectActivity(() => abandoned)
    const { store, project } = await made(activity)
    activity.abandon(project.id)
    await expect(store.delete(project.id)).rejects.toThrow(DELETE_WHILE_DRAWING)
    await untouched(project.id)
    abandoned = 0
    expect(await store.delete(project.id)).toEqual({ removed: ['project', 'output'], failed: [] })
  })
  it('refuses a map.build sent after the check and before the removals end', async () => {
    // The window is the awaits after the check: a debounced redraw's timer
    // can fire in it. The mark is raised at the check's own turn, so a
    // request sent at that instant is already refused by the bridge.
    const seen: unknown[] = []
    const atRelease: { second: unknown; folders: boolean[] }[] = []
    const later: { b?: ReturnType<typeof bridge> } = {}
    class Watching extends ProjectActivity {
      override beginDelete(projectId: string): () => void {
        const release = super.beginDelete(projectId)
        seen.push(later.b!.request('t-late', 'map.build', { out: projectId }))
        // The mark must also hold across the removals: just before it is
        // released, a second request is sent, and the folders must be gone.
        return () => {
          atRelease.push({
            second: later.b!.request('t-second', 'map.build', { out: projectId }),
            folders: [
              existsSync(join(home, 'projects', projectId)),
              existsSync(join(home, 'out', projectId)),
            ],
          })
          release()
        }
      }
    }
    const activity = new Watching(() => 0)
    const b = bridge(activity)
    later.b = b
    const { store, project } = await made(activity)
    expect(await store.delete(project.id)).toEqual({ removed: ['project', 'output'], failed: [] })
    expect(seen, 'the deletion raised its mark').toHaveLength(1)
    const answer = JSON.stringify(await seen[0])
    expect(answer).toContain(REQUEST_WHILE_DELETING)
    expect(answer).toContain('"accepted":false')
    expect(atRelease, 'the mark was released once').toHaveLength(1)
    expect(atRelease[0].folders, 'released only after both removals').toEqual([false, false])
    const second = JSON.stringify(await atRelease[0].second)
    expect(second).toContain(REQUEST_WHILE_DELETING)
    expect(second).toContain('"accepted":false')
    expect(b.held, 'nothing reached the engine').toEqual([])
    // Released at the end of the removals, so a later project is not held.
    await b.request('t-after', 'map.build', { out: project.id })
    expect(b.held).toHaveLength(1)
  })
  it('releases its mark when it fails', async () => {
    const activity = new ProjectActivity(() => 0)
    const store = new ProjectStore(home, () => {}, {}, activity)
    await expect(store.delete('aaaaaaaaaaaa')).rejects.toThrow('not found')
    expect(activity.requestRefusal('aaaaaaaaaaaa')).toBeNull()
  })
  it('leaves another project alone', async () => {
    const activity = new ProjectActivity(() => 0)
    const { store, project } = await made(activity)
    activity.beginExport('zzzzzzzzzzzz')
    activity.beginRequest('zzzzzzzzzzzz')
    expect(await store.delete(project.id)).toEqual({ removed: ['project', 'output'], failed: [] })
  })
})

/** What the bridge answered, as text, for a sentence and the refusal's shape. */
const said = async (answer: Promise<unknown>): Promise<string> => JSON.stringify(await answer)
const drawnInto = (id: string): boolean => existsSync(join(home, 'out', id))

describe('the engine bridge refuses a map.build for a project with no record (issue 505)', () => {
  // Every case is main alone, the renderer's guards nowhere: the bridge is
  // handed the real store, and a map.build that reached the engine would
  // write `out/<id>` (the fake engine above), so "nothing written" is read
  // from the disk.
  it('the closing map.build of a layout whose project was deleted while it ran', async () => {
    // Mutation: the bridge without the record lookup (`gone` always false) -
    // the map.build is accepted and out/<id> is made again.
    const activity = new ProjectActivity(() => 0)
    const store = new ProjectStore(home, () => {}, {}, activity)
    const b = bridge(activity, { records: store })
    const project = await store.create({ name: 'Gone', feed: 'la-metro-rail' })
    // The layout's long step names a feed, not the project, so nothing holds
    // the deletion: it runs and removes the record.
    await b.request('t-graph', 'graph.build', { key: 'la-metro-rail' })
    expect(await store.delete(project.id)).toEqual({ removed: ['project'], failed: [] })
    b.held[0].resolve({ layout: 'a'.repeat(64) })
    await tick()
    const answer = await said(b.request('t-map', 'map.build', { out: project.id }))
    expect(answer).toContain('"accepted":false')
    expect(answer).toContain(REQUEST_FOR_NO_PROJECT)
    expect(
      b.held.map((h) => h.method),
      'only the layout reached the engine',
    ).toEqual(['graph.build'])
    expect(drawnInto(project.id), 'out/<id> was not made again').toBe(false)
    // The refusal released its mark.
    expect(activity.exportRefusal(project.id)).toBeNull()
    expect(activity.deleteRefusal(project.id)).toBeNull()
  })
  it('refuses an out that no record can have, and writes nothing', async () => {
    const activity = new ProjectActivity(() => 0)
    const store = new ProjectStore(home, () => {}, {}, activity)
    const b = bridge(activity, { records: store })
    for (const [i, out] of ['aaaaaaaaaaaa', 'Not-An-Id', '../escape'].entries()) {
      const answer = await said(b.request(`t-${i}`, 'map.build', { out }))
      expect(answer, out).toContain(REQUEST_FOR_NO_PROJECT)
    }
    expect(b.held).toEqual([])
    expect(existsSync(join(home, 'out')), 'nothing under out/').toBe(false)
    expect(existsSync(join(home, 'escape'))).toBe(false)
  })
  it('lets a first layout through for a project just made, with no out folder yet', async () => {
    // Both front doors (the New project sheet and a sample card) answer
    // only once `create` has written the record, and a run reads the record
    // before it draws, so the first map.build always finds it.
    const activity = new ProjectActivity(() => 0)
    const store = new ProjectStore(home, () => {}, {}, activity)
    const b = bridge(activity, { records: store })
    const project = await store.create({ name: 'New', feed: 'la-metro-rail' })
    expect(drawnInto(project.id)).toBe(false)
    expect(await b.request('t1', 'map.build', { out: project.id })).toEqual({ accepted: true })
    expect(b.held.map((h) => h.method)).toEqual(['map.build'])
    expect(drawnInto(project.id)).toBe(true)
  })
  it('lets a rebuild through over the map already drawn', async () => {
    const activity = new ProjectActivity(() => 0)
    const store = new ProjectStore(home, () => {}, {}, activity)
    const b = bridge(activity, { records: store })
    const project = await store.create({ name: 'Drawn', feed: 'la-metro-rail' })
    await mkdir(join(home, 'out', project.id), { recursive: true })
    expect(await b.request('t1', 'map.build', { out: project.id })).toEqual({ accepted: true })
    expect(b.held).toHaveLength(1)
  })
  it('lets a record that is there but cannot be read through', async () => {
    // Not gone: its folder is still under projects/, and a deletion still
    // removes out/<id> with it. The run's own write says what is wrong.
    const activity = new ProjectActivity(() => 0)
    const store = new ProjectStore(home, () => {}, {}, activity)
    const b = bridge(activity, { records: store })
    const project = await store.create({ name: 'Broken', feed: 'la-metro-rail' })
    await writeFile(join(home, 'projects', project.id, 'project.json'), '{ not json')
    expect(await b.request('t1', 'map.build', { out: project.id })).toEqual({ accepted: true })
    expect(b.held).toHaveLength(1)
  })
  it('refuses when the lookup does not answer in time, and releases the mark', async () => {
    // Mutation: `gone === LAPSED` read as "not gone" - the request is sent.
    const activity = new ProjectActivity(() => 0)
    const b = bridge(activity, {
      records: { recordGone: () => new Promise<boolean>(() => {}) },
      lookupMs: 20,
    })
    const answer = await said(b.request('t1', 'map.build', { out: 'abcdefghijk1' }))
    expect(answer).toContain(REQUEST_UNCHECKED)
    expect(b.held).toEqual([])
    expect(drawnInto('abcdefghijk1')).toBe(false)
    expect(activity.deleteRefusal('abcdefghijk1')).toBeNull()
  })
  it('asks nothing of the store for a request that names no project', async () => {
    const activity = new ProjectActivity(() => 0)
    const asked: string[] = []
    const b = bridge(activity, {
      records: {
        recordGone: async (id) => {
          asked.push(id)
          return true
        },
      },
    })
    await b.request('t1', 'graph.build', { key: 'bart' })
    await b.request('t2', 'map.build', { key: 'bart' })
    expect(asked).toEqual([])
    expect(b.held).toHaveLength(2)
  })
})

describe('the engine bridge refuses a map.build while the project exports (issue 505)', () => {
  it('with its own sentence, writing nothing, and lets it through once the export ends', async () => {
    // Mutation: `requestRefusal` without its export line - the map.build is
    // accepted and out/<id> is written under the export.
    const activity = new ProjectActivity(() => 0)
    const presets = JSON.parse(
      readFileSync(join(__dirname, '../fixtures/export-tables-v0.8.2.json'), 'utf8'),
    ) as { presets: unknown[] }
    const { exporter, pending } = exporterOver(activity, { presets: presets.presets })
    const b = bridge(activity)
    const { result } = exporter.start('tok-1', 'abcdefghijk1', REEL)
    result.catch(() => {})
    // Refused from the export's first turn, before it has asked the engine
    // anything: the mark is up when `start` returns.
    const early = await said(b.request('t-early', 'map.build', { out: 'abcdefghijk1' }))
    expect(early).toContain(DRAW_WHILE_EXPORTING)
    // And still while it waits on the engine's plan.
    const deadline = Date.now() + 10_000
    while (pending.length === 0 && Date.now() < deadline) await tick()
    expect(pending.map((p) => p.method)).toEqual(['export.plan'])
    const answer = await said(b.request('t1', 'map.build', { out: 'abcdefghijk1' }))
    expect(answer).toContain('"accepted":false')
    expect(answer).toContain(DRAW_WHILE_EXPORTING)
    expect(b.held, 'nothing reached the engine').toEqual([])
    expect(drawnInto('abcdefghijk1'), 'out/<id> untouched').toBe(false)
    // Another project's map is not held by this export.
    expect(await b.request('t2', 'map.build', { out: 'zzzzzzzzzzzz' })).toEqual({
      accepted: true,
    })
    exporter.cancel('tok-1')
    await expect(result).rejects.toMatchObject({ code: ERROR_CODES.cancelled })
    expect(await b.request('t3', 'map.build', { out: 'abcdefghijk1' })).toEqual({
      accepted: true,
    })
  })
})

describe('the bridge marks before it asks (issue 505)', () => {
  // The record lookup awaits the disk, which opens a window between the
  // bridge's check and the engine. The mark goes up before that await, so an
  // export or a deletion begun in the window meets it.
  // Mutation: `beginRequest` moved after the lookup - the export starts and
  // the deletion removes the record while the map.build is still let through.
  async function held() {
    const activity = new ProjectActivity(() => 0)
    const store = new ProjectStore(home, () => {}, {}, activity)
    let open!: () => void
    const opened = new Promise<void>((r) => (open = r))
    let looking = false
    const b = bridge(activity, {
      records: {
        recordGone: (id) => {
          looking = true
          return opened.then(() => store.recordGone(id))
        },
      },
    })
    const project = await store.create({ name: 'Racing', feed: 'la-metro-rail' })
    const asked = b.request('t1', 'map.build', { out: project.id })
    // The window is open once the bridge is asking the lookup, whatever it
    // awaited on the way there: a fact, not a turn of the loop.
    await until('the bridge to ask the record lookup', () => looking)
    return { activity, store, b, project, asked, open }
  }
  it('an export begun while the lookup thinks is refused', async () => {
    const { activity, b, project, asked, open } = await held()
    const { exporter, asked: planned } = exporterOver(activity)
    expect(() => exporter.start('tok-1', project.id, REEL)).toThrow(EXPORT_WHILE_DRAWING)
    expect(planned).toEqual([])
    open()
    expect(await asked).toEqual({ accepted: true })
    expect(b.held.map((h) => h.method)).toEqual(['map.build'])
  })
  it('a deletion begun while the lookup thinks is refused, and the record stays', async () => {
    const { store, b, project, asked, open } = await held()
    await expect(store.delete(project.id)).rejects.toThrow(DELETE_WHILE_DRAWING)
    await access(join(home, 'projects', project.id, 'project.json'))
    open()
    expect(await asked).toEqual({ accepted: true })
    expect(b.held).toHaveLength(1)
  })
})

describe('the guard is asked after the record lookup (issue 505)', () => {
  /** A lookup held open until the test lets it answer `gone`. */
  function heldLookup(gone: boolean) {
    let open!: () => void
    const opened = new Promise<void>((r) => (open = r))
    return { records: { recordGone: () => opened.then(() => gone) }, open }
  }
  it('so a reset begun while the lookup waits is still the guard’s to refuse', async () => {
    // Mutation: the guard asked before the lookup - it answers null before
    // the flag goes up, and the map.build is sent.
    const activity = new ProjectActivity(() => 0)
    let resetting = false
    const { records, open } = heldLookup(false)
    const b = bridge(activity, {
      records,
      guard: async () => (resetting ? 'The engine data is being reset.' : null),
    })
    const asked = b.request('t1', 'map.build', { out: 'abcdefghijk1' })
    await tick()
    resetting = true
    open()
    const answer = await said(asked)
    expect(answer).toContain('The engine data is being reset.')
    expect(b.held, 'nothing sent').toEqual([])
    expect(drawnInto('abcdefghijk1')).toBe(false)
  })
  it('and its sentence wins over the lookup’s', async () => {
    // A reset that has removed projects/ finds no record: the person is
    // told about the reset, not about a deletion.
    // Mutation: the lookup's refusal taken first (`lookup ?? guard`) - the
    // answer says the project has been deleted.
    const activity = new ProjectActivity(() => 0)
    const { records, open } = heldLookup(true)
    const b = bridge(activity, { records, guard: async () => 'The engine data is being reset.' })
    const asked = b.request('t1', 'map.build', { out: 'abcdefghijk1' })
    open()
    const answer = await said(asked)
    expect(answer).toContain('The engine data is being reset.')
    expect(answer).not.toContain(REQUEST_FOR_NO_PROJECT)
    expect(b.held).toEqual([])
  })
  it('a lookup that fails rejects the invoke and leaves no mark behind', async () => {
    // Mutation: `release()` removed from the bridge's catch - the project
    // stays marked as being drawn after the failed request.
    const activity = new ProjectActivity(() => 0)
    let fails = true
    const b = bridge(activity, {
      records: {
        recordGone: async () => {
          if (fails) throw new Error('the disk broke')
          return false
        },
      },
    })
    await expect(b.request('t1', 'map.build', { out: 'abcdefghijk1' })).rejects.toThrow(
      'the disk broke',
    )
    expect(activity.deleteRefusal('abcdefghijk1')).toBeNull()
    expect(activity.exportRefusal('abcdefghijk1')).toBeNull()
    expect(b.held).toEqual([])
    // The token is free and the project can be marked again.
    fails = false
    expect(await b.request('t1', 'map.build', { out: 'abcdefghijk1' })).toEqual({ accepted: true })
    expect(activity.deleteRefusal('abcdefghijk1')).toBe(DELETE_WHILE_DRAWING)
  })
})

describe('ProjectStore.recordGone', () => {
  it('is true only when the store knows there is no record', async () => {
    // Mutation: `recordGone` answers false for ENOENT - the deleted and the
    // never-made rows fail.
    const store = new ProjectStore(home, () => {})
    const kept = await store.create({ name: 'Kept', feed: 'la-metro-rail' })
    const removed = await store.create({ name: 'Removed', feed: 'la-metro-rail' })
    await store.delete(removed.id)
    const broken = await store.create({ name: 'Broken', feed: 'la-metro-rail' })
    await writeFile(join(home, 'projects', broken.id, 'project.json'), '{ not json')
    const emptied = await store.create({ name: 'Emptied', feed: 'la-metro-rail' })
    await rm(join(home, 'projects', emptied.id, 'project.json'))
    expect(await store.recordGone(kept.id), 'kept').toBe(false)
    expect(await store.recordGone(broken.id), 'there, unreadable').toBe(false)
    expect(await store.recordGone(removed.id), 'deleted').toBe(true)
    expect(await store.recordGone(emptied.id), 'a folder with no record').toBe(true)
    expect(await store.recordGone('aaaaaaaaaaaa'), 'never made').toBe(true)
    expect(await store.recordGone('../projects'), 'no identifier').toBe(true)
  })
  it('answers after a deletion sent before it', async () => {
    const store = new ProjectStore(home, () => {})
    const project = await store.create({ name: 'Queued', feed: 'la-metro-rail' })
    const deletion = store.delete(project.id)
    const gone = store.recordGone(project.id)
    await deletion
    expect(await gone).toBe(true)
  })
})
