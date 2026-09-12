// The export's order and its cleanup, asserted without Electron: the engine
// plans, the app captures, the engine encodes, and the frames never outlive
// the export. The engine, the store and the capture are fakes that record
// what they were asked; a cancel is delivered wherever the export is.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CaptureError, type CaptureOptions, type CaptureResult } from '../../src/main/capture'
import {
  Exporter,
  folderName,
  jobOf,
  normalise,
  pageUrl,
  themeFor,
  type ExportEngine,
} from '../../src/main/export'
import type { Notification } from '../../src/main/sidecar'
import type { CaptureJob } from '../../src/shared/capture'
import { EngineError, ERROR_CODES } from '../../src/shared/engine'
import type { ExportProgress } from '../../src/shared/export'
import { DEFAULT_STYLE, type ProjectRecord } from '../../src/shared/project'
import type { CaptureJob as PlannedJob } from '../../src/shared/protocol'

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

interface Pending {
  id: number
  method: string
  params: Record<string, unknown> | undefined
  resolve(value: unknown): void
  reject(error: unknown): void
}

function fakeEngine(ready = true) {
  const requests: Pending[] = []
  const cancelled: number[] = []
  const listeners = new Set<(n: Notification) => void>()
  let nextId = 1
  const engine: ExportEngine = {
    request(method, params) {
      if (!ready) {
        return {
          id: 0,
          result: Promise.reject(
            new EngineError(ERROR_CODES.notReady, 'Starting the engine.', {
              kind: 'state',
              detail: 'starting',
              hint: 'Starting the engine.',
            }),
          ),
        }
      }
      const id = nextId++
      let resolve!: (v: unknown) => void
      let reject!: (e: unknown) => void
      const result = new Promise<unknown>((res, rej) => {
        resolve = res
        reject = rej
      })
      requests.push({ id, method, params, resolve, reject })
      return { id, result }
    },
    cancel: (id) => cancelled.push(id),
    onNotification: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
  const notify = (id: number, fraction: number, message = ''): void => {
    for (const l of listeners)
      l({ method: 'job/progress', params: { id, stage: 'encode', fraction, message } })
  }
  const engineCancelled = (p: Pending): void =>
    p.reject(new EngineError(ERROR_CODES.cancelled, 'Request Cancelled'))
  return { engine, requests, cancelled, notify, engineCancelled, listeners }
}

const project = (over: Partial<ProjectRecord & { readOnly: boolean }> = {}) => ({
  version: 1,
  id: 'abcdefghijk1',
  name: 'Los Angeles',
  feed: 'la-metro-rail',
  mode: 'all',
  agency: null,
  date: '2026-09-08',
  service: null,
  style: { ...DEFAULT_STYLE },
  colors: {},
  defaultColor: '#888888',
  lineOrder: [],
  theme: 'warm-dark' as const,
  layout: 'a'.repeat(64),
  made: null,
  built: null,
  created: '2026-09-10T00:00:00.000Z',
  modified: '2026-09-10T00:00:00.000Z',
  readOnly: false,
  ...over,
})

const plan = (over: Partial<PlannedJob> = {}): PlannedJob => ({
  key: 'la-metro-rail',
  preset: 'instagram-reel',
  mode: 'video',
  url: 'app://local/projects/abcdefghijk1/la-metro-rail.html?present=1&view=map',
  width: 1080,
  height: 1920,
  scale: 2,
  fps: 30,
  format: 'mp4',
  settle: 1200,
  beats: [
    {
      secs: 2,
      view: 'map',
      labels: null,
      at: 8 * 3600,
      speed: 120,
      sweep: false,
      hours: null,
      lo: null,
      hi: null,
      tween: 0,
    },
  ],
  keep: false,
  crf: 20,
  fade: 0,
  stem: 'la-metro-rail-instagram-reel',
  theme: 'dark',
  view: 'map',
  storyboard: 'tour',
  at: null,
  notes: [],
  filename: 'la-metro-rail-instagram-reel.mp4',
  ...over,
})

interface CaptureCall {
  job: CaptureJob
  options: CaptureOptions
  finish(frames?: number): void
  fail(error: Error): void
}

/** A capture that writes one file into its directory and waits to be told how it ends. */
function fakeCapture() {
  const calls: CaptureCall[] = []
  const capture = (job: CaptureJob, options: CaptureOptions): Promise<CaptureResult> =>
    new Promise((resolve, reject) => {
      mkdirSync(options.frames, { recursive: true })
      writeFileSync(join(options.frames, '000000.png'), 'png')
      const call: CaptureCall = {
        job,
        options,
        finish: (frames = 60) => {
          options.onProgress?.(frames, frames)
          resolve({
            frames,
            width: 2160,
            height: 3840,
            first: { now: 0, clock: '08:00', shown: 1 },
          })
        },
        fail: (error) => {
          rmSync(options.frames, { recursive: true, force: true })
          reject(error)
        },
      }
      options.signal?.addEventListener('abort', () =>
        call.fail(new CaptureError('the capture was cancelled', true)),
      )
      calls.push(call)
    })
  return { capture, calls }
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function harness(
  over: {
    ready?: boolean
    project?: Partial<ProjectRecord & { readOnly: boolean }>
    /** Records by identifier, for a test with more than one project. */
    projects?: Record<string, Partial<ProjectRecord & { readOnly: boolean }>>
    /** Why no export may start: Settings sets this while it removes the home. */
    blocked?: string | null
    /** The export folder, changed between calls, to prove when it is read. */
    folder?: { now: string }
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'legible-cities-export-'))
  dirs.push(root)
  const framesRoot = join(root, 'frames')
  const folder = over.folder ?? { now: join(root, 'exports') }
  const exportFolder = folder.now
  const eng = fakeEngine(over.ready ?? true)
  const cap = fakeCapture()
  const progress: ExportProgress[] = []
  const log: string[] = []
  const exporter = new Exporter({
    engine: eng.engine,
    projects: { get: async (id) => project({ id, ...(over.projects?.[id] ?? over.project) }) },
    capture: cap.capture,
    framesRoot,
    // Asked at each export, so a folder changed in Settings applies
    // without a restart (A1-04).
    exportFolder: () => folder.now,
    blocked: () => over.blocked ?? null,
    log: (m) => log.push(m),
  })
  exporter.onProgress((p) => progress.push(p))
  return { exporter, eng, cap, progress, log, framesRoot, exportFolder, folder }
}

// Turns of the event loop, not promise flushes: steps of the export touch
// the filesystem, and a real read or write takes several turns to come back
// where a resolved promise takes one. Generous on purpose - the whole file
// runs in under a fifth of a second either way, and a budget that is too
// tight fails as "the step did not happen", which reads like a bug in the
// step rather than in the waiting.
const settle = async (times = 24): Promise<void> => {
  for (let i = 0; i < times; i++) await tick()
}

/**
 * Wait for something to become true rather than for a number of turns. A
 * budget is a race whatever its size - an immediate does not wait for a
 * filesystem call to land, it only gives it another chance - so anything
 * that follows real I/O waits on the thing itself and says so when it never
 * arrives.
 */
const until = async (what: string, ok: () => boolean, turns = 2000): Promise<void> => {
  for (let i = 0; i < turns && !ok(); i++) await tick()
  if (!ok()) throw new Error(`${what} never happened`)
}

describe('the export, step by step', () => {
  it('plans with the engine, captures, encodes, and hands back the file name', async () => {
    const h = harness()
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', 'instagram-reel')
    await settle()

    // The plan: the project's feed, page, service day and theme, nothing else.
    expect(h.eng.requests).toHaveLength(1)
    expect(h.eng.requests[0].method).toBe('export.plan')
    expect(h.eng.requests[0].params).toEqual({
      key: 'la-metro-rail',
      preset: 'instagram-reel',
      page: 'app://local/projects/abcdefghijk1/la-metro-rail.html',
      date: '2026-09-08',
      options: { theme: 'dark' },
    })
    h.eng.requests[0].resolve(plan())
    // The claim touches the filesystem on the way, so this waits for the
    // capture itself rather than for a number of turns.
    await until('the capture', () => h.cap.calls.length === 1)

    // The capture: the plan's job, into this export's own frames directory.
    expect(h.cap.calls[0].job).toEqual(jobOf(plan()))
    expect(h.cap.calls[0].options.frames).toBe(join(h.framesRoot, 'tok-1'))
    expect(h.exporter.live).toBe(1)

    // The frames folder carries the mark that lets a later start clear what
    // a crash leaves. Claimed here and not only at a start, because "Reset
    // engine data" removes the folder and its mark together, and without
    // this one reset turned the sweep off for good.
    expect(readdirSync(h.framesRoot)).toContain('.legible-frames')

    h.cap.calls[0].finish(60)
    await settle()

    // The encode: the plan handed back unchanged, the frames, the file under
    // the export folder in a folder named after the project, and the
    // project's service day as provenance.
    expect(h.eng.requests).toHaveLength(2)
    expect(h.eng.requests[1].method).toBe('export.encode')
    const dest = join(h.exportFolder, 'Los Angeles', 'la-metro-rail-instagram-reel.mp4')
    expect(h.eng.requests[1].params).toEqual({
      plan: plan(),
      source: join(h.framesRoot, 'tok-1'),
      dest,
      provenance: { service_date: '2026-09-08' },
    })
    h.eng.notify(2, 0.5)
    h.eng.requests[1].resolve({ files: [{ path: dest, bytes: 1234 }], sidecar: {} })

    await expect(result).resolves.toEqual({
      file: 'la-metro-rail-instagram-reel.mp4',
      bytes: 1234,
      frames: 60,
    })
    expect(h.exporter.fileOf('tok-1')).toBe(dest)
    expect(h.exporter.live).toBe(0)
    expect(existsSync(join(h.framesRoot, 'tok-1')), 'the frames are gone').toBe(false)

    // The stages, in order, with a sentence each and no path in any of them.
    expect(h.progress.map((p) => p.stage)).toEqual([
      'plan',
      'plan',
      'capture',
      'capture',
      'encode',
      'encode',
    ])
    expect(h.progress.map((p) => p.message)).toEqual([
      'Planning the export.',
      'Planned la-metro-rail-instagram-reel.mp4: 60 frames at 30 frames per second.',
      'Capturing 60 frames.',
      'Captured 60 of 60 frames.',
      'Encoding 60 frames.',
      'Encoded 30 of 60 frames.',
    ])
    for (const p of h.progress) expect(p.message).not.toMatch(/[/\\]/)
  })

  it("puts the plan's notes beside the planned sentence, with any path taken out", async () => {
    const h = harness()
    void h.exporter.start('tok-1', 'abcdefghijk1', 'instagram-reel').result.catch(() => {})
    await settle()
    h.eng.requests[0].resolve(
      plan({
        notes: ['this sweep advances 90 simulated seconds per frame.', 'see /data/maps/la.html'],
      }),
    )
    await settle()
    expect(h.progress[1].message).toBe(
      'Planned la-metro-rail-instagram-reel.mp4: 60 frames at 30 frames per second. this sweep advances 90 simulated seconds per frame. see a file',
    )
    h.exporter.cancel('tok-1')
  })

  // The mark is what lets a later start clear what a crash leaves, and
  // "Reset engine data" removes the frames folder and the mark together
  // while the app runs. Claiming only at a start therefore turned the sweep
  // off for the life of the install after one reset, and nothing saw it.
  it('marks the frames folder again after it has been taken away', async () => {
    const h = harness()
    const first = h.exporter.start('tok-1', 'abcdefghijk1', 'instagram-reel')
    await until('the plan', () => h.eng.requests.length === 1)
    h.eng.requests[0].resolve(plan())
    await until('the capture', () => h.cap.calls.length === 1)
    expect(readdirSync(h.framesRoot)).toContain('.legible-frames')
    h.exporter.cancel('tok-1')
    await first.result.catch(() => undefined)

    // The reset's shape: the folder goes whole, marker and all.
    rmSync(h.framesRoot, { recursive: true, force: true })
    expect(existsSync(h.framesRoot)).toBe(false)

    const second = h.exporter.start('tok-2', 'abcdefghijk1', 'instagram-reel')
    await until('the second plan', () => h.eng.requests.length === 2)
    h.eng.requests[1].resolve(plan())
    await until('the second capture', () => h.cap.calls.length === 2)
    expect(readdirSync(h.framesRoot)).toContain('.legible-frames')
    h.exporter.cancel('tok-2')
    await second.result.catch(() => undefined)
  })
})

describe('cancelling', () => {
  it('during the capture aborts it, removes the frames and ends cancelled', async () => {
    const h = harness()
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', 'instagram-reel')
    await settle()
    h.eng.requests[0].resolve(plan())
    await settle()
    expect(h.cap.calls).toHaveLength(1)
    h.exporter.cancel('tok-1')
    await expect(result).rejects.toMatchObject({ code: ERROR_CODES.cancelled })
    expect(h.cap.calls[0].options.signal?.aborted).toBe(true)
    expect(existsSync(join(h.framesRoot, 'tok-1'))).toBe(false)
    expect(h.eng.requests, 'nothing was sent to encode').toHaveLength(1)
    expect(h.exporter.live).toBe(0)
  })

  it('during the encode cancels the engine request and ends cancelled', async () => {
    const h = harness()
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', 'instagram-reel')
    await settle()
    h.eng.requests[0].resolve(plan())
    await settle()
    h.cap.calls[0].finish()
    await settle()
    expect(h.eng.requests[1].method).toBe('export.encode')
    h.exporter.cancel('tok-1')
    expect(h.eng.cancelled).toEqual([2])
    h.eng.engineCancelled(h.eng.requests[1])
    await expect(result).rejects.toMatchObject({ code: ERROR_CODES.cancelled })
    expect(existsSync(join(h.framesRoot, 'tok-1'))).toBe(false)
    expect(h.exporter.fileOf('tok-1')).toBeNull()
  })

  it('between the plan and the capture never starts the capture', async () => {
    const h = harness()
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', 'instagram-reel')
    await settle()
    h.exporter.cancel('tok-1')
    expect(h.eng.cancelled, 'the plan request is cancelled too').toEqual([1])
    h.eng.requests[0].resolve(plan())
    await expect(result).rejects.toMatchObject({ code: ERROR_CODES.cancelled })
    expect(h.cap.calls).toHaveLength(0)
  })

  it('a quit cancels every export', async () => {
    const h = harness()
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', 'instagram-reel')
    await settle()
    h.eng.requests[0].resolve(plan())
    await settle()
    h.exporter.abortAll()
    await expect(result).rejects.toMatchObject({ code: ERROR_CODES.cancelled })
    expect(h.exporter.live).toBe(0)
  })

  it('an unknown or finished id does nothing', () => {
    const h = harness()
    expect(() => h.exporter.cancel('nobody')).not.toThrow()
    expect(h.eng.cancelled).toEqual([])
  })
})

describe('failing', () => {
  it("a failed encode ends with the engine's hint and no frames left", async () => {
    const h = harness()
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', 'instagram-reel')
    await settle()
    h.eng.requests[0].resolve(plan())
    await settle()
    h.cap.calls[0].finish()
    await settle()
    h.eng.requests[1].reject(
      new EngineError(-32000, 'ffmpeg exited 1', {
        kind: 'export',
        detail: 'ffmpeg exited 1',
        hint: 'ffmpeg could not encode the frames.',
      }),
    )
    await expect(result).rejects.toMatchObject({
      code: -32000,
      data: { hint: 'ffmpeg could not encode the frames.' },
    })
    expect(existsSync(join(h.framesRoot, 'tok-1'))).toBe(false)
    expect(h.exporter.live).toBe(0)
  })

  it('a failed capture carries its sentence as an export failure', async () => {
    const h = harness()
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', 'instagram-reel')
    await settle()
    h.eng.requests[0].resolve(plan())
    await settle()
    h.cap.calls[0].fail(new CaptureError('the page never exposed __present (page)'))
    await expect(result).rejects.toMatchObject({
      code: ERROR_CODES.exportFailed,
      data: { kind: 'export', hint: 'the page never exposed __present (page)' },
    })
    expect(h.eng.requests).toHaveLength(1)
  })

  it('a plan the capture cannot take is refused before a window exists', async () => {
    const h = harness()
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', 'instagram-reel')
    await settle()
    h.eng.requests[0].resolve(plan({ url: 'https://example.com/la.html', scale: 4 }))
    await expect(result).rejects.toMatchObject({ code: ERROR_CODES.exportFailed })
    await expect(result).rejects.toThrow(/cannot be captured/)
    expect(h.cap.calls).toHaveLength(0)
  })

  it('a plan whose file name could be a path is refused', async () => {
    const h = harness()
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', 'instagram-reel')
    await settle()
    h.eng.requests[0].resolve(plan({ filename: '../escape.mp4' }))
    await expect(result).rejects.toThrow(/no usable file/)
    expect(h.cap.calls).toHaveLength(0)
  })

  it('an engine that is not ready fails with its state, and nothing is captured', async () => {
    const h = harness({ ready: false })
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', 'instagram-reel')
    await expect(result).rejects.toMatchObject({ code: ERROR_CODES.notReady })
    expect(h.cap.calls).toHaveLength(0)
  })

  it('a project without a layout, or a read-only one, is refused before the engine is asked', async () => {
    for (const over of [{ layout: null }, { date: null }, { readOnly: true }]) {
      const h = harness({ project: over })
      const { result } = h.exporter.start('tok-1', 'abcdefghijk1', 'instagram-reel')
      await expect(result).rejects.toMatchObject({ code: ERROR_CODES.badCall })
      expect(h.eng.requests, JSON.stringify(over)).toHaveLength(0)
    }
  })

  it('two projects with one name and one feed take turns at the file; a third name proceeds', async () => {
    const h = harness({
      projects: {
        abcdefghijk1: { name: 'Los Angeles' },
        abcdefghijk2: { name: 'Los Angeles' },
        abcdefghijk3: { name: 'LA, again' },
      },
    })
    const first = h.exporter.start('tok-1', 'abcdefghijk1', 'instagram-reel')
    await settle()
    h.eng.requests[0].resolve(plan())
    await settle()
    expect(h.cap.calls, 'the first is capturing').toHaveLength(1)

    const second = h.exporter.start('tok-2', 'abcdefghijk2', 'instagram-reel')
    await settle()
    h.eng.requests[1].resolve(plan())
    await expect(second.result).rejects.toThrow(/Another export is writing this file/)
    expect(h.cap.calls, 'the second never captured').toHaveLength(1)

    const third = h.exporter.start('tok-3', 'abcdefghijk3', 'instagram-reel')
    await settle()
    h.eng.requests[2].resolve(plan())
    await settle()
    expect(h.cap.calls, 'a different folder is not in the way').toHaveLength(2)

    // Both outcomes are awaited together: a rejection settles a macrotask
    // after the cancel (the frames are removed first), so a handler attached
    // one await later can miss it on a fast machine.
    const ends = [first.result, third.result].map((r) => r.catch((reason: unknown) => reason))
    h.exporter.cancel('tok-1')
    h.exporter.cancel('tok-3')
    for (const end of await Promise.all(ends))
      expect(end).toMatchObject({ code: ERROR_CODES.cancelled })
    // The file is free again once the first has ended.
    const again = h.exporter.start('tok-4', 'abcdefghijk2', 'instagram-reel')
    await settle()
    h.eng.requests[3].resolve(plan())
    await settle()
    expect(h.cap.calls).toHaveLength(3)
    h.exporter.cancel('tok-4')
    await expect(again.result).rejects.toMatchObject({ code: ERROR_CODES.cancelled })
  })

  it('a second export of the same project, or the same id, is refused at once', async () => {
    const h = harness()
    void h.exporter.start('tok-1', 'abcdefghijk1', 'instagram-reel').result.catch(() => {})
    expect(() => h.exporter.start('tok-1', 'abcdefghijk2', 'instagram-reel')).toThrow(
      /already running/,
    )
    expect(() => h.exporter.start('tok-2', 'abcdefghijk1', 'instagram-reel')).toThrow(
      /already being exported/,
    )
    h.exporter.cancel('tok-1')
    await settle()
    expect(h.exporter.live).toBe(0)
  })
})

describe('the small functions', () => {
  it('maps the record theme to the engine theme', () => {
    expect(themeFor('warm-dark')).toBe('dark')
    expect(themeFor('sepia')).toBe('light')
  })
  it("builds the project page's address on the app's origin", () => {
    expect(pageUrl({ id: 'abcdefghijk1', feed: 'la-metro-rail' })).toBe(
      'app://local/projects/abcdefghijk1/la-metro-rail.html',
    )
  })
  it('makes a folder name from a project name, and falls back to the id', () => {
    expect(folderName('Los Angeles', 'id')).toBe('Los Angeles')
    expect(folderName('a/b\\c:d*e?f"g<h>i|j', 'id')).toBe('a-b-c-d-e-f-g-h-i-j')
    expect(folderName('  .hidden. ', 'id')).toBe('hidden')
    expect(folderName('...', 'id')).toBe('id')
    expect(folderName('CON', 'id')).toBe('id')
    expect(folderName('tab\there', 'id')).toBe('tab-here')
    expect(folderName('x'.repeat(200), 'id')).toHaveLength(80)
    // Cut first, then stripped: nothing the cut exposes is left at the end.
    expect(folderName('x'.repeat(79) + '.tail', 'id')).toBe('x'.repeat(79))
    expect(folderName('x'.repeat(78) + ' . tail', 'id')).toBe('x'.repeat(78))
  })
  it('takes only the capture half of a plan', () => {
    expect(Object.keys(jobOf(plan())).sort()).toEqual(
      ['beats', 'fps', 'height', 'scale', 'settle', 'url', 'width'].sort(),
    )
  })
  it('turns every failure into the one error shape, without a path', () => {
    expect(normalise(new CaptureError('stopped', true)).code).toBe(ERROR_CODES.cancelled)
    expect(normalise(new CaptureError('the page died')).data?.hint).toBe('the page died')
    expect(normalise(new Error('ENOENT: no such file, open /data/x/y')).data?.hint).toBe(
      'ENOENT: no such file, open a file',
    )
    const engine = new EngineError(-32000, 'x')
    expect(normalise(engine)).toBe(engine)
  })
})

// The frames live under the engine's home while an export runs, and the
// file's folder is read once at the start: both are things Settings can
// pull out from under a running export (A1-04).
describe('the export and the settings screen', () => {
  it('refuses to start at all while the engine data is being reset', () => {
    const why = 'The engine data is being reset; wait for it to finish.'
    const h = harness({ blocked: why })
    expect(() => h.exporter.start('tok-1', 'abcdefghijk1', 'instagram-reel')).toThrow(why)
    expect(h.exporter.live, 'nothing was begun').toBe(0)
    expect(h.eng.requests, 'the engine was never asked for a plan').toHaveLength(0)
  })

  // The plan is a round trip to the engine. A folder changed while it is in
  // flight must not redirect an export that was already under way.
  it('writes to the folder in force when it started, not when it finished', async () => {
    const root = mkdtempSync(join(tmpdir(), 'legible-cities-export-'))
    dirs.push(root)
    const folder = { now: join(root, 'first') }
    const h = harness({ folder })
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', 'instagram-reel')
    // Changed the instant the export is under way, while the plan is out.
    folder.now = join(root, 'second')
    await settle()

    h.eng.requests[0].resolve(plan())
    await settle()
    h.cap.calls[0].finish(60)
    await settle()

    const dest = join(root, 'first', 'Los Angeles', 'la-metro-rail-instagram-reel.mp4')
    expect(h.eng.requests[1].method).toBe('export.encode')
    expect((h.eng.requests[1].params as { dest: string }).dest).toBe(dest)
    h.eng.requests[1].resolve({ files: [{ path: dest, bytes: 1234 }], sidecar: {} })
    await expect(result).resolves.toBeTruthy()
  })
})
