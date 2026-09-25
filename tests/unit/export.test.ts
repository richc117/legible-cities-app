// The export's order and its cleanup, asserted without Electron: the engine
// plans, the app captures, the engine encodes, and the frames never outlive
// the export. The engine, the store and the capture are fakes that record
// what they were asked; a cancel is delivered wherever the export is.

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CaptureError, type CaptureOptions, type CaptureResult } from '../../src/main/capture'
import {
  destinationRefusal,
  Destinations,
  Exporter,
  folderName,
  isProjectPage,
  jobOf,
  keptFramesFolder,
  STILL_FRAME,
  normalise,
  pageUrl,
  themeFor,
  type ExportEngine,
} from '../../src/main/export'
import type { Notification } from '../../src/main/sidecar'
import type { CaptureJob } from '../../src/shared/capture'
import { EngineError, ERROR_CODES } from '../../src/shared/engine'
import {
  DEFAULT_CHOICE,
  OFFERED_PRESETS,
  STORYBOARD_NAMES,
  planOptions,
  sentChoice,
  validateChoiceOptions,
  validateExportChoice,
  type ExportChoice,
  type ExportProgress,
} from '../../src/shared/export'
import { DEFAULT_STYLE, type ProjectRecord } from '../../src/shared/project'
import type { CaptureJob as PlannedJob, Preset } from '../../src/shared/protocol'
import { FAKE_ENGINE, findPython } from '../support/python'

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

/** What the one button exported before the export tab: the reel, with the engine's defaults. */
const REEL: ExportChoice = { preset: 'instagram-reel', options: {} }

interface Pending {
  id: number
  method: string
  params: Record<string, unknown> | undefined
  resolve(value: unknown): void
  reject(error: unknown): void
}

/**
 * The engine's preset table at the pinned tag (v0.8.2), as `export.presets`
 * answers it; the stand-in engine is held to the same file below.
 */
const ENGINE_TABLES = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/export-tables-v0.8.2.json'), 'utf8'),
) as { engine: string; presets: Preset[]; storyboards: unknown[] }

/**
 * A fake engine. `export.presets` is answered at once from the pinned
 * table, under ids of its own, so the plan and the encode keep the ids and
 * the places in `requests` the tests count by; `tables` counts the asks.
 */
function fakeEngine(ready = true, presets: unknown = { presets: ENGINE_TABLES.presets }) {
  const requests: Pending[] = []
  const tables: number[] = []
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
      if (method === 'export.presets') {
        const id = 1000 + tables.length
        tables.push(id)
        return { id, result: Promise.resolve(presets) }
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
  return { engine, requests, tables, cancelled, notify, engineCancelled, listeners }
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
  export: { preset: 'instagram-reel' as const, options: {} },
  destination: null,
  layout: 'a'.repeat(64),
  made: null,
  drawn: null,
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
    /** What `export.presets` answers, when not the pinned table. */
    presets?: unknown
    /** Where a copy of each export's frames goes (LEGIBLE_KEEP_FRAMES). */
    keepFrames?: string | null
    /** Why a project's own destination may not be written to (A5.5-19). */
    destinationRefusal?: (folder: string) => Promise<string | null>
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'legible-cities-export-'))
  dirs.push(root)
  const framesRoot = join(root, 'frames')
  const folder = over.folder ?? { now: join(root, 'exports') }
  const exportFolder = folder.now
  const eng = fakeEngine(over.ready ?? true, over.presets ?? { presets: ENGINE_TABLES.presets })
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
    destinationRefusal: over.destinationRefusal,
    keepFrames: over.keepFrames ?? null,
    log: (m) => log.push(m),
  })
  exporter.onProgress((p) => progress.push(p))
  return { exporter, eng, cap, progress, log, framesRoot, exportFolder, folder, root }
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
 * filesystem call to land, it only gives it another chance - so the wait is
 * a deadline in real time, and it says what never arrived.
 *
 * It counted turns until 2026-09-12, which read as a deadline and was not
 * one: two thousand immediates are however long two thousand immediates
 * take, and on a Windows runner that is less than the mkdir and the two
 * writes this waits for. The suite then failed a different test on each
 * run, each time saying a step of the export never happened when what had
 * not happened was the waiting.
 */
const until = async (what: string, ok: () => boolean, ms = 30_000): Promise<void> => {
  const deadline = Date.now() + ms
  while (!ok() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 1))
  if (!ok()) throw new Error(`${what} never happened`)
}

describe('keeping the frames, for development only (A5-04)', () => {
  const absolute = join(tmpdir(), 'kept-frames')

  it('reads LEGIBLE_KEEP_FRAMES in development, as an absolute path', () => {
    expect(keptFramesFolder({ LEGIBLE_KEEP_FRAMES: absolute }, false)).toBe(absolute)
  })

  it('is ignored when packaged, whatever the environment says', () => {
    expect(keptFramesFolder({ LEGIBLE_KEEP_FRAMES: absolute }, true)).toBeNull()
  })

  it('is ignored when unset, empty or relative', () => {
    expect(keptFramesFolder({}, false)).toBeNull()
    expect(keptFramesFolder({ LEGIBLE_KEEP_FRAMES: '' }, false)).toBeNull()
    expect(keptFramesFolder({ LEGIBLE_KEEP_FRAMES: 'frames' }, false)).toBeNull()
  })

  it("copies each export's frames before they are removed, numbered, and nothing without it", async () => {
    const kept = mkdtempSync(join(tmpdir(), 'legible-cities-kept-'))
    dirs.push(kept)
    const h = harness({ keepFrames: kept })
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', REEL)
    await until('the plan', () => h.eng.requests.length === 1)
    h.eng.requests[0].resolve(plan())
    await until('the capture', () => h.cap.calls.length === 1)
    h.cap.calls[0].finish(60)
    await until('the encode', () => h.eng.requests.length === 2)
    h.eng.requests[1].resolve({ files: [], sidecar: {} })
    await result
    expect(readFileSync(join(kept, '001-tok-1', '000000.png'), 'utf8')).toBe('png')
    expect(existsSync(join(h.framesRoot, 'tok-1')), "the export's own frames are gone").toBe(false)
    expect(h.log.join('\n')).not.toContain(kept)

    const plain = harness()
    const second = plain.exporter.start('tok-2', 'abcdefghijk1', REEL)
    await until('the plan', () => plain.eng.requests.length === 1)
    plain.eng.requests[0].resolve(plan())
    await until('the capture', () => plain.cap.calls.length === 1)
    plain.cap.calls[0].finish(60)
    await until('the encode', () => plain.eng.requests.length === 2)
    plain.eng.requests[1].resolve({ files: [], sidecar: {} })
    await second.result
    expect(readdirSync(plain.root).sort()).toEqual(['frames'])
  })
})

describe('the export, step by step', () => {
  it('plans with the engine, captures, encodes, and hands back the file name', async () => {
    const h = harness()
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', REEL)
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
    void h.exporter.start('tok-1', 'abcdefghijk1', REEL).result.catch(() => {})
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
    const first = h.exporter.start('tok-1', 'abcdefghijk1', REEL)
    await until('the plan', () => h.eng.requests.length === 1)
    h.eng.requests[0].resolve(plan())
    await until('the capture', () => h.cap.calls.length === 1)
    expect(readdirSync(h.framesRoot)).toContain('.legible-frames')
    h.exporter.cancel('tok-1')
    await first.result.catch(() => undefined)

    // The reset's shape: the folder goes whole, marker and all.
    rmSync(h.framesRoot, { recursive: true, force: true })
    expect(existsSync(h.framesRoot)).toBe(false)

    const second = h.exporter.start('tok-2', 'abcdefghijk1', REEL)
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
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', REEL)
    await settle()
    h.eng.requests[0].resolve(plan())
    await until('the capture', () => h.cap.calls.length === 1)
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
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', REEL)
    await settle()
    h.eng.requests[0].resolve(plan())
    await until('the capture', () => h.cap.calls.length === 1)
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
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', REEL)
    await settle()
    h.exporter.cancel('tok-1')
    expect(h.eng.cancelled, 'the plan request is cancelled too').toEqual([1])
    h.eng.requests[0].resolve(plan())
    await expect(result).rejects.toMatchObject({ code: ERROR_CODES.cancelled })
    expect(h.cap.calls).toHaveLength(0)
  })

  it('a quit cancels every export', async () => {
    const h = harness()
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', REEL)
    await settle()
    h.eng.requests[0].resolve(plan())
    await until('the capture', () => h.cap.calls.length === 1)
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
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', REEL)
    await settle()
    h.eng.requests[0].resolve(plan())
    await until('the capture', () => h.cap.calls.length === 1)
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
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', REEL)
    await settle()
    h.eng.requests[0].resolve(plan())
    await until('the capture', () => h.cap.calls.length === 1)
    h.cap.calls[0].fail(new CaptureError('the page never exposed __present (page)'))
    await expect(result).rejects.toMatchObject({
      code: ERROR_CODES.exportFailed,
      data: { kind: 'export', hint: 'the page never exposed __present (page)' },
    })
    expect(h.eng.requests).toHaveLength(1)
  })

  it('a plan the capture cannot take is refused before a window exists', async () => {
    const h = harness()
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', REEL)
    await settle()
    h.eng.requests[0].resolve(plan({ url: 'https://example.com/la.html', scale: 4 }))
    await expect(result).rejects.toMatchObject({ code: ERROR_CODES.exportFailed })
    await expect(result).rejects.toThrow(/cannot be captured/)
    expect(h.cap.calls).toHaveLength(0)
  })

  it('a plan whose file name could be a path is refused', async () => {
    const h = harness()
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', REEL)
    await settle()
    h.eng.requests[0].resolve(plan({ filename: '../escape.mp4' }))
    await expect(result).rejects.toThrow(/no usable file/)
    expect(h.cap.calls).toHaveLength(0)
  })

  // A5.5-15 broke the invariant this used to rest on: a day chosen and not
  // drawn moves `date` and leaves the page in the output folder alone. The
  // capture navigates to that page, so the plan and the provenance take the
  // day the page was drawn for, or the file would be frames of one day with
  // beats, a clock and a sidecar for another. Nothing blocks the export -
  // stale never does (ADR-045) - so this is the whole of the defence.
  it('plans and stamps the day the page was drawn for, not a day merely chosen', async () => {
    const drawn = {
      layout: 'a'.repeat(64),
      made: null,
      date: '2026-09-08',
      colors: {},
      defaultColor: '#888888',
      lineOrder: [],
      theme: 'warm-dark' as const,
    }
    const h = harness({ project: { date: '2026-09-20', drawn } })
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', REEL)
    await settle()
    expect(h.eng.requests[0].method).toBe('export.plan')
    expect(
      (h.eng.requests[0].params as { date: string }).date,
      'the plan is of the picture, not of the choice',
    ).toBe('2026-09-08')
    h.eng.requests[0].resolve(plan())
    await until('the capture', () => h.cap.calls.length === 1)
    h.cap.calls[0].finish(60)
    await until('the encode', () => h.eng.requests.length === 2)
    expect(
      (h.eng.requests[1].params as { provenance: { service_date: string } }).provenance,
      'and so is the sidecar beside the file',
    ).toEqual({ service_date: '2026-09-08' })
    h.eng.requests[1].resolve({ files: [], sidecar: {} })
    await result
  })

  it("takes the record's day when the project cannot say what it drew", async () => {
    // A record from before `drawn` existed: unknown is not a reason to
    // refuse, and its stored day is the only answer there is.
    const h = harness({ project: { date: '2026-09-20', drawn: null } })
    h.exporter.start('tok-1', 'abcdefghijk1', REEL)
    await settle()
    expect((h.eng.requests[0].params as { date: string }).date).toBe('2026-09-20')
  })

  it('an engine that is not ready fails with its state, and nothing is captured', async () => {
    const h = harness({ ready: false })
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', REEL)
    await expect(result).rejects.toMatchObject({ code: ERROR_CODES.notReady })
    expect(h.cap.calls).toHaveLength(0)
  })

  it('a project without a layout, or a read-only one, is refused before the engine is asked', async () => {
    for (const over of [{ layout: null }, { date: null }, { readOnly: true }]) {
      const h = harness({ project: over })
      const { result } = h.exporter.start('tok-1', 'abcdefghijk1', REEL)
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
    const first = h.exporter.start('tok-1', 'abcdefghijk1', REEL)
    await settle()
    h.eng.requests[0].resolve(plan())
    await until('the capture', () => h.cap.calls.length === 1)
    expect(h.cap.calls, 'the first is capturing').toHaveLength(1)

    const second = h.exporter.start('tok-2', 'abcdefghijk2', REEL)
    await settle()
    h.eng.requests[1].resolve(plan())
    await expect(second.result).rejects.toThrow(/Another export is writing this file/)
    expect(h.cap.calls, 'the second never captured').toHaveLength(1)

    const third = h.exporter.start('tok-3', 'abcdefghijk3', REEL)
    await settle()
    h.eng.requests[2].resolve(plan())
    // Two, not three: the second was refused the file and never captured.
    await until('the third capture', () => h.cap.calls.length === 2)
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
    const again = h.exporter.start('tok-4', 'abcdefghijk2', REEL)
    await settle()
    h.eng.requests[3].resolve(plan())
    await until('the fourth capture', () => h.cap.calls.length === 3)
    expect(h.cap.calls).toHaveLength(3)
    h.exporter.cancel('tok-4')
    await expect(again.result).rejects.toMatchObject({ code: ERROR_CODES.cancelled })
  })

  it('a second export of the same project, or the same id, is refused at once', async () => {
    const h = harness()
    void h.exporter.start('tok-1', 'abcdefghijk1', REEL).result.catch(() => {})
    expect(() => h.exporter.start('tok-1', 'abcdefghijk2', REEL)).toThrow(/already running/)
    expect(() => h.exporter.start('tok-2', 'abcdefghijk1', REEL)).toThrow(/already being exported/)
    h.exporter.cancel('tok-1')
    await settle()
    expect(h.exporter.live).toBe(0)
  })
})

describe('the small functions', () => {
  it('plans a sepia project in the engine’s word for it', async () => {
    const h = harness({ project: { theme: 'sepia' } })
    h.exporter.start('tok-1', 'abcdefghijk1', REEL)
    await settle()
    expect(h.eng.requests[0].params).toMatchObject({ options: { theme: 'light' } })
  })

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
    expect(() => h.exporter.start('tok-1', 'abcdefghijk1', REEL)).toThrow(why)
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
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', REEL)
    // Changed the instant the export is under way, while the plan is out.
    folder.now = join(root, 'second')
    await settle()

    h.eng.requests[0].resolve(plan())
    await until('the capture', () => h.cap.calls.length === 1)
    h.cap.calls[0].finish(60)
    await settle()

    const dest = join(root, 'first', 'Los Angeles', 'la-metro-rail-instagram-reel.mp4')
    expect(h.eng.requests[1].method).toBe('export.encode')
    expect((h.eng.requests[1].params as { dest: string }).dest).toBe(dest)
    h.eng.requests[1].resolve({ files: [{ path: dest, bytes: 1234 }], sidecar: {} })
    await expect(result).resolves.toBeTruthy()
  })
})

// The export tab's half of the export (A5-01, specs/022-export-tab): the
// choice reaches the plan as options, a still is captured as one pinned
// frame, and the preview plans with the safe zones where the preset has
// them and never otherwise.
describe('what the export tab chooses', () => {
  const LINKEDIN: ExportChoice = {
    preset: 'linkedin-video',
    storyboard: 'day',
    options: { clock: false, at: '07:30', lines: ['A', 'B'], quality: 'draft', tag: 'draft-1' },
  }

  it('plans with the options, the storyboard and the theme, and never with safe', async () => {
    for (const [choice, theme] of [
      [LINKEDIN, 'sepia'],
      [REEL, 'warm-dark'],
      [{ preset: 'instagram-story', options: { title: false, view: 'linear' } }, 'warm-dark'],
    ] as [ExportChoice, 'sepia' | 'warm-dark'][]) {
      const h = harness({ project: { theme } })
      void h.exporter.start('tok-1', 'abcdefghijk1', choice).result.catch(() => undefined)
      await settle()
      const params = h.eng.requests[0].params as {
        preset: string
        options: Record<string, unknown>
      }
      expect(params.preset).toBe(choice.preset)
      expect(params.options).toEqual({
        ...sentChoice(choice, presetOf(choice.preset)).options,
        ...(choice.storyboard ? { storyboard: choice.storyboard } : {}),
        theme: theme === 'sepia' ? 'light' : 'dark',
      })
      expect(h.eng.tables, 'the table is asked before the plan').toHaveLength(1)
      expect('safe' in params.options, 'an export never draws the safe zones').toBe(false)
      h.exporter.cancel('tok-1')
    }
  })

  it('captures a still as one frame pinned at its time, and encodes that frame', async () => {
    const h = harness()
    const still = plan({
      preset: 'instagram-post',
      mode: 'still',
      beats: [],
      at: 7 * 3600 + 30 * 60,
      storyboard: '',
      format: 'png',
      filename: 'la-metro-rail-instagram-post.png',
    })
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', {
      preset: 'instagram-post',
      options: { at: '07:30' },
    })
    await settle()
    h.eng.requests[0].resolve(still)
    await until('the capture', () => h.cap.calls.length === 1)
    expect(h.cap.calls[0].job.beats).toEqual([
      {
        secs: 1 / 30,
        view: 'map',
        labels: null,
        at: 27_000,
        speed: 0,
        sweep: false,
        hours: null,
        lo: null,
        hi: null,
        tween: 0,
      },
    ])
    expect(h.progress[1].message).toBe('Planned la-metro-rail-instagram-post.png: a still.')
    h.cap.calls[0].finish(1)
    await settle()
    expect(h.eng.requests[1].params).toMatchObject({
      plan: still,
      source: join(h.framesRoot, 'tok-1', STILL_FRAME),
    })
    const dest = join(h.exportFolder, 'Los Angeles', 'la-metro-rail-instagram-post.png')
    h.eng.requests[1].resolve({ files: [{ path: dest, bytes: 99 }], sidecar: {} })
    await expect(result).resolves.toEqual({
      file: 'la-metro-rail-instagram-post.png',
      bytes: 99,
      frames: 1,
    })
  })

  it('refuses a still the plan did not pin, before a window exists', async () => {
    const h = harness()
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', REEL)
    await settle()
    h.eng.requests[0].resolve(plan({ mode: 'still', beats: [], at: null }))
    await expect(result).rejects.toThrow(/cannot be captured/)
    expect(h.cap.calls).toHaveLength(0)
  })

  const presetOf = (name: string): Preset => {
    const found = ENGINE_TABLES.presets.find((p) => p.name === name)
    if (found === undefined) throw new Error(`no ${name} in the pinned table`)
    return found
  }

  it('never sends a view or a start time beside a storyboard, which names its own', async () => {
    const h = harness()
    const video: ExportChoice = {
      preset: 'instagram-reel',
      storyboard: 'run',
      options: { view: 'linear', at: '07:30', clock: false },
    }
    void h.exporter.start('tok-1', 'abcdefghijk1', video).result.catch(() => undefined)
    await until('the plan', () => h.eng.requests.length === 1)
    expect(h.eng.requests[0].params).toMatchObject({
      options: { storyboard: 'run', clock: false, theme: 'dark' },
    })
    const options = (h.eng.requests[0].params as { options: object }).options
    expect(options).not.toHaveProperty('view')
    expect(options).not.toHaveProperty('at')
    h.exporter.cancel('tok-1')

    // A still takes both, and no storyboard.
    const s = harness()
    const still: ExportChoice = {
      preset: 'instagram-post',
      storyboard: 'run',
      options: { view: 'linear', at: '07:30' },
    }
    void s.exporter.start('tok-2', 'abcdefghijk1', still).result.catch(() => undefined)
    await until('the plan', () => s.eng.requests.length === 1)
    expect((s.eng.requests[0].params as { options: object }).options).toEqual({
      view: 'linear',
      at: '07:30',
      theme: 'dark',
    })
    s.exporter.cancel('tok-2')
  })

  it('makes a JPEG still at standard quality only, read from the engine’s table', async () => {
    // Bluesky's still is the engine's one JPEG preset at v0.8.2; which it is
    // comes from the table, so a table that says otherwise is obeyed.
    const h = harness()
    const draft: ExportChoice = { preset: 'bluesky', options: { quality: 'draft', tag: 'd' } }
    void h.exporter.start('tok-1', 'abcdefghijk1', draft).result.catch(() => undefined)
    await until('the plan', () => h.eng.requests.length === 1)
    expect((h.eng.requests[0].params as { options: object }).options).toEqual({
      tag: 'd',
      theme: 'dark',
    })
    h.exporter.cancel('tok-1')

    const png = harness({
      presets: {
        presets: ENGINE_TABLES.presets.map((p) =>
          p.name === 'bluesky' ? { ...p, format: 'png' } : p,
        ),
      },
    })
    void png.exporter.start('tok-2', 'abcdefghijk1', draft).result.catch(() => undefined)
    await until('the plan', () => png.eng.requests.length === 1)
    expect((png.eng.requests[0].params as { options: object }).options).toMatchObject({
      quality: 'draft',
    })
    png.exporter.cancel('tok-2')
  })

  it('refuses a plan that would keep a PNG capture as a JPEG, or that disagrees with its preset', async () => {
    for (const [choice, answer, sentence] of [
      [
        { preset: 'bluesky', options: {} },
        plan({
          preset: 'bluesky',
          mode: 'still',
          beats: [],
          at: 25_200,
          format: 'jpg',
          keep: true,
          filename: 'la-metro-rail-bluesky.jpg',
        }),
        /standard quality/,
      ],
      [
        { preset: 'instagram-post', options: {} },
        plan({ preset: 'instagram-post', filename: 'la-metro-rail-instagram-post.mp4' }),
        /does not match its preset/,
      ],
    ] as [ExportChoice, PlannedJob, RegExp][]) {
      const h = harness()
      const { result } = h.exporter.start('tok-1', 'abcdefghijk1', choice)
      await until('the plan', () => h.eng.requests.length === 1)
      h.eng.requests[0].resolve(answer)
      await expect(result).rejects.toThrow(sentence)
      expect(h.cap.calls).toHaveLength(0)
    }
  })

  it('refuses a preset the engine’s table no longer lists, before the plan', async () => {
    const h = harness({ presets: { presets: [] } })
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', REEL)
    await expect(result).rejects.toThrow(/no longer offers/)
    expect(h.eng.requests).toHaveLength(0)
  })

  it('previews with the safe zones exactly where the preset has them', async () => {
    for (const [choice, safe] of [
      [REEL, true],
      [{ preset: 'instagram-story', options: {} }, true],
      [LINKEDIN, false],
      [{ preset: 'bluesky', options: {} }, false],
    ] as [ExportChoice, boolean][]) {
      const h = harness()
      const answer = h.exporter.preview('abcdefghijk1', choice)
      await until('the plan', () => h.eng.requests.length === 1)
      expect(h.eng.tables).toHaveLength(1)
      expect(h.eng.requests[0].method).toBe('export.plan')
      expect(h.eng.requests[0].params).toEqual({
        key: 'la-metro-rail',
        preset: choice.preset,
        page: 'app://local/projects/abcdefghijk1/la-metro-rail.html',
        date: '2026-09-08',
        options: planOptions(choice, presetOf(choice.preset), 'dark', safe),
      })
      const url = `app://local/projects/abcdefghijk1/la-metro-rail.html?present=1${safe ? '&safe=1' : ''}`
      h.eng.requests[0].resolve(plan({ url, width: 540, height: 960, notes: ['see /x/y'] }))
      await expect(answer).resolves.toEqual({
        ok: true,
        url,
        width: 540,
        height: 960,
        notes: ['see a file'],
      })
      expect(h.exporter.live, 'a preview is not an export').toBe(0)
      expect(h.cap.calls).toHaveLength(0)
    }
  })

  it("answers the engine's refusal in its own shape, and never throws", async () => {
    const h = harness()
    const answer = h.exporter.preview('abcdefghijk1', LINKEDIN)
    await until('the plan', () => h.eng.requests.length === 1)
    h.eng.requests[0].reject(
      new EngineError(-32000, 'no geographic geometry', {
        kind: 'export',
        detail: 'ValueError',
        hint: "'la-metro-rail' carries no geographic geometry",
      }),
    )
    await expect(answer).resolves.toEqual({
      ok: false,
      error: {
        code: -32000,
        message: 'no geographic geometry',
        data: {
          kind: 'export',
          detail: 'ValueError',
          hint: "'la-metro-rail' carries no geographic geometry",
        },
      },
    })
  })

  it('refuses a planned address that is not the project’s own page', async () => {
    const h = harness()
    const answer = h.exporter.preview('abcdefghijk1', REEL)
    await until('the plan', () => h.eng.requests.length === 1)
    h.eng.requests[0].resolve(plan({ url: 'app://local/projects/zzzzzzzzzzzz/x.html?safe=1' }))
    await expect(answer).resolves.toMatchObject({
      ok: false,
      error: { code: ERROR_CODES.exportFailed },
    })
  })

  it('previews nothing while the engine data is being reset, or before a layout', async () => {
    const why = 'The engine data is being reset; wait for it to finish.'
    const blocked = harness({ blocked: why })
    await expect(blocked.exporter.preview('abcdefghijk1', REEL)).resolves.toMatchObject({
      ok: false,
      error: { message: why },
    })
    const bare = harness({ project: { layout: null } })
    await expect(bare.exporter.preview('abcdefghijk1', REEL)).resolves.toMatchObject({ ok: false })
    expect([...blocked.eng.requests, ...bare.eng.requests]).toHaveLength(0)
  })

  it('previews nothing when a reset begins while the record is being read', async () => {
    const why = 'The engine data is being reset; wait for it to finish.'
    let blocked: string | null = null
    let release!: () => void
    const read = new Promise<void>((resolve) => {
      release = resolve
    })
    const eng = fakeEngine()
    const exporter = new Exporter({
      engine: eng.engine,
      projects: {
        get: async (id) => {
          await read
          return project({ id })
        },
      },
      capture: fakeCapture().capture,
      framesRoot: join(tmpdir(), 'unused-frames'),
      exportFolder: () => join(tmpdir(), 'unused-exports'),
      blocked: () => blocked,
      log: () => undefined,
    })
    const answer = exporter.preview('abcdefghijk1', REEL)
    await settle()
    blocked = why
    release()
    await expect(answer).resolves.toMatchObject({ ok: false, error: { message: why } })
    expect(eng.tables, 'the engine was never asked').toHaveLength(0)
    expect(eng.requests).toHaveLength(0)
  })

  it('knows the project’s own page from any other', () => {
    const project = { id: 'abcdefghijk1', feed: 'la-metro-rail' }
    const page = 'app://local/projects/abcdefghijk1/la-metro-rail.html'
    expect(isProjectPage(page, project)).toBe(true)
    expect(isProjectPage(`${page}?present=1&safe=1`, project)).toBe(true)
    for (const url of [
      `${page}x?present=1`,
      `${page}#x`,
      'app://local/projects/abcdefghijk2/la-metro-rail.html?x',
      `https://example.com/?${page}`,
      `${page}?present=1 &x`,
      42,
    ])
      expect(isProjectPage(url, project), String(url)).toBe(false)
  })
})

describe('the choice itself', () => {
  const schema = JSON.parse(
    readFileSync(resolve(__dirname, '../../vendor/protocol.schema.json'), 'utf8'),
  ) as { $defs: Record<string, { enum?: string[] }> }

  it('offers the thirteen social presets, every one of them the engine’s', () => {
    expect(OFFERED_PRESETS).toHaveLength(13)
    const engine = schema.$defs.PresetName.enum ?? []
    for (const name of OFFERED_PRESETS) expect(engine).toContain(name)
    expect(engine.filter((name) => !(OFFERED_PRESETS as readonly string[]).includes(name))).toEqual(
      ['portfolio-svg', 'portfolio-mp4', 'portfolio-gif'],
    )
  })

  it('knows every storyboard the engine has, and no other', () => {
    expect([...STORYBOARD_NAMES].sort()).toEqual(
      [...(schema.$defs.StoryboardName.enum ?? [])].sort(),
    )
  })

  it('takes every preset, storyboard and option the tab can send', () => {
    for (const preset of OFFERED_PRESETS)
      expect(validateExportChoice({ preset, options: {} }), preset).toBeNull()
    for (const storyboard of STORYBOARD_NAMES)
      expect(validateExportChoice({ preset: 'linkedin-gif', storyboard, options: {} })).toBeNull()
    expect(
      validateChoiceOptions({
        view: 'geographic',
        labels: false,
        title: false,
        clock: true,
        at: '25:44:10',
        lines: ['A', 'Rapid 720'],
        quality: 'high',
        tag: 'v2.final_1',
      }),
    ).toBeNull()
    expect(validateExportChoice(DEFAULT_CHOICE)).toBeNull()
  })

  it('refuses what the engine would, with a sentence', () => {
    for (const [choice, sentence] of [
      [{ preset: 'portfolio-gif', options: {} }, /does not offer/],
      [{ preset: 'x', storyboard: 'nope', options: {} }, /not a storyboard/],
      [{ preset: 'x' }, /options must be an object/],
      [{ preset: 'x', options: {}, fade: 1 }, /not part of an export choice/],
      [{ preset: 'x', options: { safe: true } }, /safe is not an option/],
      [{ preset: 'x', options: { theme: 'dark' } }, /theme is not an option/],
      [{ preset: 'x', options: { storyboard: 'tour' } }, /storyboard is not an option/],
      [{ preset: 'x', options: { view: 'schematic' } }, /view must be one of/],
      [{ preset: 'x', options: { labels: 'yes' } }, /labels must be on or off/],
      [{ preset: 'x', options: { at: '7.30' } }, /HH:MM/],
      [{ preset: 'x', options: { at: '07:75' } }, /59/],
      [{ preset: 'x', options: { lines: 'A' } }, /list of line labels/],
      [{ preset: 'x', options: { lines: ['A', 'A'] } }, /twice/],
      [{ preset: 'x', options: { lines: [''] } }, /label/],
      [{ preset: 'x', options: { quality: 'best' } }, /draft, standard or high/],
      [{ preset: 'x', options: { tag: 'has space' } }, /tag/],
      [{ preset: 'x', options: { tag: '.hidden' } }, /tag/],
      [{ preset: 'x', options: { tag: 'x'.repeat(65) } }, /tag/],
    ] as [unknown, RegExp][])
      expect(validateExportChoice(choice), JSON.stringify(choice)).toMatch(sentence)
  })

  it('adds safe to a plan only when the preview asks', () => {
    const reel = { kind: 'video', format: 'mp4' } as const
    expect(planOptions(REEL, reel, 'dark')).toEqual({ theme: 'dark' })
    expect(planOptions(REEL, reel, 'light', true)).toEqual({ theme: 'light', safe: true })
  })
})

// The stand-in engine answers the export tab's three methods with the
// engine's own tables (T005), so the end-to-end suite runs without Docker.
// Its names are held to the generated unions here, through the schema they
// were made from.
const PYTHON = findPython()
// A Python start on a busy Windows runner can take longer than vitest's five
// seconds; the probe allows itself twenty, and so does the test.
describe.skipIf(PYTHON === null)('the stand-in engine’s export tables', { timeout: 30_000 }, () => {
  const python = (code: string): string => {
    const probe = spawnSync(PYTHON as string, ['-c', code], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20_000,
      env: { ...process.env, PYTHONPATH: FAKE_ENGINE, PYTHONDONTWRITEBYTECODE: '1' },
    })
    expect(probe.status, probe.stderr).toBe(0)
    return probe.stdout
  }

  it('answers the engine’s own tables at the pinned tag, size, kind, format and all', () => {
    const tables = JSON.parse(
      python(
        'import json; from schematic import serve; print(json.dumps({"presets": serve.EXPORT_PRESETS, "storyboards": serve.EXPORT_STORYBOARDS}))',
      ),
    ) as { presets: Preset[]; storyboards: { name: string }[] }
    // tests/fixtures/export-tables-v0.8.2.json is the engine's
    // `preset_table()` and `storyboard_table()` at v0.8.2. A pin that
    // changes a preset's size, kind, format, rate, safe zones or storyboard
    // fails here until the fixture and the stand-in both follow it.
    expect(ENGINE_TABLES.engine).toBe('v0.8.2')
    expect(tables.presets).toEqual(ENGINE_TABLES.presets)
    expect(tables.storyboards).toEqual(ENGINE_TABLES.storyboards)
    const schema = JSON.parse(
      readFileSync(resolve(__dirname, '../../vendor/protocol.schema.json'), 'utf8'),
    ) as { $defs: Record<string, { enum?: string[] }> }
    expect(tables.presets.map((p) => p.name)).toEqual(schema.$defs.PresetName.enum)
    expect(tables.storyboards.map((b) => b.name).sort()).toEqual(
      [...(schema.$defs.StoryboardName.enum ?? [])].sort(),
    )
  })

  it('refuses to keep a capture in a format the preset does not write, as the engine silently would', () => {
    const answers = JSON.parse(
      python(
        [
          'import json',
          'from pathlib import Path',
          'from schematic import serve',
          'cases = [(True, "jpg", "000000.png"), (False, "jpg", "000000.png"), (True, "png", "000000.png")]',
          'print(json.dumps([serve.Engine.still_problem({"keep": k, "format": f}, Path(s)) for k, f, s in cases]))',
        ].join('\n'),
      ),
    ) as (string | null)[]
    expect(answers[0]).toMatch(/will not keep a png capture as a jpg file/)
    expect(answers.slice(1)).toEqual([null, null])
  })
})

// Where one project's exports go (A5.5-19). The app's export folder is
// still the default and is unchanged by any of this; a project that has
// chosen its own writes there instead, and nothing about the plan, the
// capture or the encode changes with it - `export.encode` has always taken
// an absolute destination.
describe("a project's own destination", () => {
  const exportOnce = async (h: ReturnType<typeof harness>): Promise<string> => {
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', REEL)
    await until('the plan', () => h.eng.requests.length === 1)
    h.eng.requests[0].resolve(plan())
    await until('the capture', () => h.cap.calls.length === 1)
    h.cap.calls[0].finish(60)
    await until('the encode', () => h.eng.requests.length === 2)
    const dest = (h.eng.requests[1].params as { dest: string }).dest
    h.eng.requests[1].resolve({ files: [{ path: dest, bytes: 1 }], sidecar: {} })
    await expect(result).resolves.toBeTruthy()
    return dest
  }

  it("writes under the project's own folder, not the app's", async () => {
    const mine = join(tmpdir(), 'somewhere-of-my-own')
    const h = harness({ project: { destination: mine } })
    expect(await exportOnce(h)).toBe(join(mine, 'Los Angeles', 'la-metro-rail-instagram-reel.mp4'))
  })

  it("writes under the app's folder when the project has chosen none", async () => {
    const h = harness({ project: { destination: null } })
    expect(await exportOnce(h)).toBe(
      join(h.exportFolder, 'Los Angeles', 'la-metro-rail-instagram-reel.mp4'),
    )
  })

  // A record is a file on disk and the engine's home can move between two
  // starts, so the folder a record names is judged again at each export and
  // not trusted from the moment it was chosen.
  it('refuses a stored folder the app may not write to, before anything is planned', async () => {
    const h = harness({
      project: { destination: join(tmpdir(), 'inside-the-app') },
      destinationRefusal: async () => 'that folder is inside the app itself',
    })
    const { result } = h.exporter.start('tok-1', 'abcdefghijk1', REEL)
    await expect(result).rejects.toThrow(/inside the app itself/)
    expect(h.eng.requests, 'the engine was never asked for a plan').toHaveLength(0)
    expect(h.cap.calls, 'nothing was captured').toHaveLength(0)
    expect(h.exporter.live, 'the export was let go').toBe(0)
  })

  it('asks nothing of the refusal when the project has no folder of its own', async () => {
    const asked: string[] = []
    const h = harness({
      project: { destination: null },
      destinationRefusal: async (folder) => {
        asked.push(folder)
        return 'never said'
      },
    })
    await exportOnce(h)
    expect(asked).toEqual([])
  })
})

// The chooser itself: no path crosses the bridge inward, which is the rule
// Settings' two folders follow (A1-04) and the reason this is a class with
// everything Electron injected.
describe('choosing a destination', () => {
  const RECORD = project()

  function chooser(
    over: { answer?: string | null; refuse?: (f: string) => Promise<string | null> } = {},
  ) {
    const written: (string | null)[] = []
    const asked: string[] = []
    const destinations = new Destinations({
      projects: {
        get: async (id) => project({ id, ...(id === 'readonlyabc1' ? { readOnly: true } : {}) }),
        setDestination: async (id, folder) => {
          written.push(folder)
          return { ...project({ id }), destination: folder }
        },
      },
      chooseFolder: async (current) => {
        asked.push(current)
        return over.answer === undefined ? '/chosen/folder' : over.answer
      },
      appFolder: () => '/the/app/folder',
      refuse: over.refuse ?? (async () => null),
    })
    return { destinations, written, asked }
  }

  it('opens the chooser where the exports go now and stores what it answered', async () => {
    const c = chooser()
    const record = await c.destinations.choose('abcdefghijk1')
    expect(c.asked, "the app's folder, for a project with none of its own").toEqual([
      '/the/app/folder',
    ])
    expect(c.written).toEqual(['/chosen/folder'])
    expect(record.destination).toBe('/chosen/folder')
  })

  it("opens it where the project's own folder is, once it has one", async () => {
    const written: (string | null)[] = []
    const asked: string[] = []
    const destinations = new Destinations({
      projects: {
        get: async (id) => project({ id, destination: '/mine' }),
        setDestination: async (id, folder) => {
          written.push(folder)
          return { ...project({ id }), destination: folder }
        },
      },
      chooseFolder: async (current) => {
        asked.push(current)
        return null
      },
      appFolder: () => '/the/app/folder',
      refuse: async () => null,
    })
    const record = await destinations.choose('abcdefghijk1')
    expect(asked).toEqual(['/mine'])
    // Cancelled: the record as it stands, and nothing written.
    expect(written).toEqual([])
    expect(record.destination).toBe('/mine')
  })

  it('refuses a folder its own dialog did not answer, and one it has already spent', async () => {
    const c = chooser()
    await expect(c.destinations.apply('abcdefghijk1', '/somewhere/else')).rejects.toThrow(
      "a folder is chosen in the app's own dialog",
    )
    expect(c.written).toEqual([])
    await c.destinations.choose('abcdefghijk1')
    // The dialog's answer was spent by the choose above; the same path sent
    // again is another process's guess.
    await expect(c.destinations.apply('abcdefghijk1', '/chosen/folder')).rejects.toThrow(
      "a folder is chosen in the app's own dialog",
    )
    expect(c.written).toEqual(['/chosen/folder'])
  })

  it('refuses anything that is not a folder this app would store', async () => {
    const c = chooser()
    for (const bad of ['relative/folder', '', 'C:no-drive', 42, {}])
      await expect(c.destinations.apply('abcdefghijk1', bad)).rejects.toThrow(
        "a folder is chosen in the app's own dialog",
      )
    expect(c.written).toEqual([])
  })

  // The chooser will make a folder anywhere the platform lets it.
  it('refuses a folder the app may not write into, whoever chose it', async () => {
    const c = chooser({ refuse: async () => 'that folder is inside the app itself' })
    await expect(c.destinations.choose('abcdefghijk1')).rejects.toThrow(
      'that folder is inside the app itself',
    )
    expect(c.written).toEqual([])
  })

  it('refuses a record a newer version of the app wrote, before opening anything', async () => {
    const c = chooser()
    await expect(c.destinations.choose('readonlyabc1')).rejects.toThrow(/newer version of the app/)
    expect(c.asked, 'no dialog was opened').toEqual([])
    expect(c.written).toEqual([])
  })

  // The store would refuse it too, with a bare "read-only" that would go
  // straight into the alert beside the button.
  it('refuses to take the app’s folder back on a record it may not write, in the same sentence', async () => {
    const c = chooser()
    await expect(c.destinations.useAppFolder('readonlyabc1')).rejects.toThrow(
      /newer version of the app/,
    )
    expect(c.written).toEqual([])
  })

  it("takes the app's folder again, sending nothing at all", async () => {
    const c = chooser()
    const record = await c.destinations.useAppFolder('abcdefghijk1')
    expect(c.asked).toEqual([])
    expect(c.written).toEqual([null])
    expect(record.destination).toBeNull()
    expect(RECORD.destination, 'a project starts with none of its own').toBeNull()
  })
})

// The guard itself (A5.5-19). The two tests above prove the plumbing with a
// stub that always refuses; this is the rule, over real folders and real
// links, because the plumbing is not where the danger is.
describe('where a project may not export to', () => {
  // Two roots, because both halves of the guard are symmetric now: a
  // folder above the bundle and a folder above the home must be told
  // apart, and one root holding both would be refused by whichever check
  // ran first, which proves nothing about the other.
  const tree = () => {
    const root = mkdtempSync(join(tmpdir(), 'legible-cities-forbidden-'))
    const appRoot = mkdtempSync(join(tmpdir(), 'legible-cities-forbidden-app-'))
    dirs.push(root, appRoot)
    const home = join(root, 'support', 'engine')
    mkdirSync(home, { recursive: true })
    const bundle = join(appRoot, 'Legible Cities.app')
    mkdirSync(bundle, { recursive: true })
    const elsewhere = join(root, 'Movies')
    mkdirSync(elsewhere, { recursive: true })
    return {
      root,
      appRoot,
      home,
      bundle,
      elsewhere,
      where: { bundleRoots: [bundle], engineHome: home },
    }
  }

  it('allows a folder that is neither the app nor the engine data', async () => {
    const t = tree()
    expect(await destinationRefusal(t.elsewhere, t.where)).toBeNull()
  })

  it('refuses a folder inside the engine data folder, and the folder itself', async () => {
    const t = tree()
    for (const folder of [t.home, join(t.home, 'out'), join(t.home, 'out', 'deeper')])
      expect(await destinationRefusal(folder, t.where), folder).toMatch(
        /inside the engine data folder/,
      )
  })

  // The defect this test was written for: the file lands at
  // <destination>/<project name>/<filename>, and `folderName` passes
  // "engine" through unchanged, so the folder the home sits in is a folder
  // an export can reach into the home from - one project name away.
  it('refuses a folder that holds the engine data folder, however far above it', async () => {
    const t = tree()
    for (const folder of [join(t.root, 'support'), t.root])
      expect(await destinationRefusal(folder, t.where), folder).toMatch(
        /holds the engine data folder/,
      )
  })

  it('refuses the app’s own bundle and anything inside it', async () => {
    const t = tree()
    for (const folder of [t.bundle, join(t.bundle, 'Contents', 'Resources')])
      expect(await destinationRefusal(folder, t.where), folder).toMatch(/inside the app itself/)
  })

  // The same defect as the home's, in the other half of the same function:
  // `folderName` passes "Legible Cities.app" through unchanged, so the
  // folder the app sits in is one project name away from the bundle.
  it('refuses a folder that holds the app itself, in its own sentence', async () => {
    const t = tree()
    const refusal = await destinationRefusal(t.appRoot, t.where)
    expect(refusal).toMatch(/holds the app itself/)
    // Not the "inside" sentence, which would be plainly wrong here.
    expect(refusal).not.toMatch(/inside the app itself/)
  })

  // Every check here is textual, so a link that passes one and then points
  // inside the home would be a guard that refuses nothing.
  it('follows a link in the folder it is given', async () => {
    const t = tree()
    const link = join(t.root, 'looks-harmless')
    mkdirSync(join(t.home, 'out'), { recursive: true })
    symlinkSync(join(t.home, 'out'), link, 'dir')
    expect(await destinationRefusal(link, t.where)).toMatch(/inside the engine data folder/)
  })

  it('follows a link in the home it is given', async () => {
    const t = tree()
    const real = join(t.root, 'real-home')
    mkdirSync(join(real, 'out'), { recursive: true })
    const linked = join(t.root, 'linked-home')
    symlinkSync(real, linked, 'dir')
    const where = { bundleRoots: [t.bundle], engineHome: linked }
    // The home is a link; the folder names where it really is.
    expect(await destinationRefusal(join(real, 'out'), where)).toMatch(
      /inside the engine data folder/,
    )
    expect(await destinationRefusal(t.root, where)).toMatch(/holds the engine data folder/)
    expect(await destinationRefusal(t.elsewhere, where)).toBeNull()
  })

  it('follows a link in the bundle it is given, in both directions', async () => {
    const t = tree()
    const linked = join(t.root, 'linked-app')
    symlinkSync(t.bundle, linked, 'dir')
    const where = { bundleRoots: [linked], engineHome: t.home }
    expect(await destinationRefusal(join(t.bundle, 'Contents'), where)).toMatch(
      /inside the app itself/,
    )
    expect(await destinationRefusal(t.appRoot, where)).toMatch(/holds the app itself/)
    expect(await destinationRefusal(t.elsewhere, where)).toBeNull()
  })

  // A folder that does not exist yet is judged, not waved through:
  // `createDirectory` in the chooser makes one, and a record can name a
  // folder that has since gone.
  it('judges a folder that is not there', async () => {
    const t = tree()
    expect(await destinationRefusal(join(t.home, 'not-yet'), t.where)).toMatch(
      /inside the engine data folder/,
    )
    expect(await destinationRefusal(join(t.elsewhere, 'not-yet'), t.where)).toBeNull()
  })
})
