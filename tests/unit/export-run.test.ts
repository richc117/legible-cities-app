// The page's view of an export, against a stub bridge. No React, no
// Electron, no main process: the run is a plain object so this is possible.

import { describe, expect, it } from 'vitest'
import {
  ExportRun,
  freshStages,
  sentenceFor,
  stagesAt,
  type ExportBridge,
} from '../../src/renderer/src/engine/exportRun'
import { ERROR_CODES, type EngineState } from '../../src/shared/engine'
import type { ExportProgress, ExportResult } from '../../src/shared/export'
import { DEFAULT_STYLE, type ProjectRecord } from '../../src/shared/project'

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

function stubBridge() {
  const runs: { projectId: string; preset: string }[] = []
  const cancelled: string[] = []
  const revealed: string[] = []
  const listeners = new Set<(p: ExportProgress) => void>()
  let resolve!: (v: ExportResult) => void
  let reject!: (e: unknown) => void
  let next = 1
  const bridge: ExportBridge = {
    run(projectId, preset) {
      runs.push({ projectId, preset })
      const id = `tok-${next++}`
      return {
        id,
        result: new Promise<ExportResult>((res, rej) => {
          resolve = res
          reject = rej
        }),
      }
    },
    cancel: async (id) => {
      cancelled.push(id)
    },
    reveal: async (id) => {
      revealed.push(id)
    },
    onProgress: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
  return {
    bridge,
    runs,
    cancelled,
    revealed,
    listeners,
    report: (p: ExportProgress) => listeners.forEach((l) => l(p)),
    resolve: (v: ExportResult) => resolve(v),
    reject: (e: unknown) => reject(e),
  }
}

const READY: EngineState = { state: 'ready', version: '0.3.0', protocol: 1 }

const project = (over: Partial<ProjectRecord> = {}): ProjectRecord => ({
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
  theme: 'warm-dark',
  layout: 'a'.repeat(64),
  made: null,
  created: '2026-09-10T00:00:00.000Z',
  modified: '2026-09-10T00:00:00.000Z',
  ...over,
})

describe('ExportRun', () => {
  it('starts idle with the three stages waiting', () => {
    const { bridge } = stubBridge()
    const run = new ExportRun(bridge, 'instagram-reel')
    expect(run.snapshot.state).toBe('idle')
    expect(run.snapshot.stages.map((s) => s.id)).toEqual(['plan', 'capture', 'encode'])
    expect(run.snapshot.stages.every((s) => s.state === 'pending')).toBe(true)
  })

  it('refuses to start without a ready engine, or without a layout', () => {
    const { bridge, runs } = stubBridge()
    const run = new ExportRun(bridge, 'instagram-reel')
    run.start(project(), null)
    expect(run.snapshot).toMatchObject({ state: 'failed', error: /still starting/ })
    run.start(project(), { state: 'starting', attempt: 1 })
    expect(run.snapshot.error).toMatch(/not ready to export: starting/)
    run.start(project({ layout: null }), READY)
    expect(run.snapshot.error).toMatch(/Lay the project out/)
    expect(runs).toEqual([])
  })

  it('follows the reports stage by stage and ends done with the file name', async () => {
    const stub = stubBridge()
    const run = new ExportRun(stub.bridge, 'instagram-reel')
    const seen: string[] = []
    run.subscribe((s) => seen.push(s.state))
    run.start(project(), READY)
    expect(stub.runs).toEqual([{ projectId: 'abcdefghijk1', preset: 'instagram-reel' }])
    expect(run.snapshot.state).toBe('running')
    expect(run.snapshot.stages.map((s) => s.state)).toEqual(['running', 'pending', 'pending'])

    stub.report({ id: 'tok-1', stage: 'plan', fraction: 1, message: 'Planned x.mp4: 60 frames.' })
    expect(run.snapshot.message).toBe('Planned x.mp4: 60 frames.')
    stub.report({
      id: 'tok-1',
      stage: 'capture',
      fraction: 0.5,
      message: 'Captured 30 of 60 frames.',
    })
    expect(run.snapshot.stages.map((s) => s.state)).toEqual(['done', 'running', 'pending'])
    // A report for another export is ignored.
    stub.report({ id: 'tok-9', stage: 'encode', fraction: 1, message: 'not ours' })
    expect(run.snapshot.message).toBe('Captured 30 of 60 frames.')
    stub.report({
      id: 'tok-1',
      stage: 'encode',
      fraction: 0.2,
      message: 'Encoded 12 of 60 frames.',
    })
    expect(run.snapshot.stages.map((s) => s.state)).toEqual(['done', 'done', 'running'])

    stub.resolve({ file: 'x.mp4', bytes: 10, frames: 60 })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'done', file: 'x.mp4' })
    expect(run.snapshot.stages.every((s) => s.state === 'done')).toBe(true)
    expect(seen.at(-1)).toBe('done')

    run.reveal()
    expect(stub.revealed).toEqual(['tok-1'])
  })

  it('cancels through the bridge and ends cancelled with the running stage reverted', async () => {
    const stub = stubBridge()
    const run = new ExportRun(stub.bridge, 'instagram-reel')
    run.start(project(), READY)
    stub.report({
      id: 'tok-1',
      stage: 'capture',
      fraction: 0.1,
      message: 'Captured 6 of 60 frames.',
    })
    run.cancel()
    expect(stub.cancelled).toEqual(['tok-1'])
    stub.reject({ code: ERROR_CODES.cancelled, message: 'The export was cancelled.' })
    await tick()
    expect(run.snapshot.state).toBe('cancelled')
    expect(run.snapshot.stages.map((s) => s.state)).toEqual(['done', 'pending', 'pending'])
    expect(run.snapshot.error).toBeNull()
    run.reveal()
    expect(stub.revealed, 'nothing to reveal').toEqual([])
  })

  it("ends failed with the engine's hint and the running stage marked", async () => {
    const stub = stubBridge()
    const run = new ExportRun(stub.bridge, 'instagram-reel')
    run.start(project(), READY)
    stub.report({ id: 'tok-1', stage: 'encode', fraction: 0, message: 'Encoding 60 frames.' })
    stub.reject({
      code: -32000,
      message: 'ffmpeg exited 1',
      data: {
        kind: 'export',
        detail: 'ffmpeg exited 1',
        hint: 'ffmpeg could not encode the frames.',
      },
    })
    await tick()
    expect(run.snapshot).toMatchObject({
      state: 'failed',
      error: 'ffmpeg could not encode the frames.',
    })
    expect(run.snapshot.stages.map((s) => s.state)).toEqual(['done', 'done', 'failed'])
  })

  it('says a file may have been left only when the engine died during the encode', async () => {
    const stub = stubBridge()
    const run = new ExportRun(stub.bridge, 'instagram-reel')
    run.start(project(), READY)
    stub.report({
      id: 'tok-1',
      stage: 'capture',
      fraction: 0.5,
      message: 'Captured 30 of 60 frames.',
    })
    stub.reject({ code: ERROR_CODES.engineExited, message: 'The engine stopped.' })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'failed', left: false })

    run.start(project(), READY)
    stub.report({
      id: 'tok-2',
      stage: 'encode',
      fraction: 0.5,
      message: 'Encoded 30 of 60 frames.',
    })
    stub.reject({ code: ERROR_CODES.engineExited, message: 'The engine stopped.' })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'failed', left: true })

    run.start(project(), READY)
    stub.report({
      id: 'tok-3',
      stage: 'encode',
      fraction: 0.5,
      message: 'Encoded 30 of 60 frames.',
    })
    stub.reject({ code: -32000, message: 'ffmpeg exited 1' })
    await tick()
    expect(run.snapshot, 'the engine cleaned up its own failure').toMatchObject({
      state: 'failed',
      left: false,
    })
  })

  it('can start again after it ended, and ignores a late answer from the earlier export', async () => {
    const stub = stubBridge()
    const run = new ExportRun(stub.bridge, 'instagram-reel')
    run.start(project(), READY)
    const rejectFirst = stub.reject
    run.cancel()
    rejectFirst({ code: ERROR_CODES.cancelled, message: 'cancelled' })
    await tick()
    expect(run.snapshot.state).toBe('cancelled')
    run.start(project(), READY)
    expect(run.snapshot.state).toBe('running')
    expect(stub.runs).toHaveLength(2)
    stub.resolve({ file: 'y.mp4', bytes: 1, frames: 1 })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'done', file: 'y.mp4' })
  })

  it('does not start twice while running, and dispose releases the subscription', () => {
    const stub = stubBridge()
    const run = new ExportRun(stub.bridge, 'instagram-reel')
    run.start(project(), READY)
    run.start(project(), READY)
    expect(stub.runs).toHaveLength(1)
    expect(stub.listeners.size).toBe(1)
    run.dispose()
    expect(stub.listeners.size).toBe(0)
  })
})

describe('the small functions', () => {
  it('stagesAt marks earlier stages done, the named one running, the rest waiting', () => {
    expect(stagesAt(freshStages(), 'capture').map((s) => s.state)).toEqual([
      'done',
      'running',
      'pending',
    ])
    expect(stagesAt(freshStages(), 'plan').map((s) => s.state)).toEqual([
      'running',
      'pending',
      'pending',
    ])
    const same = freshStages()
    expect(stagesAt(same, 'nowhere')).toBe(same)
  })
  it('sentenceFor prefers the hint, then the message, then a plain sentence', () => {
    expect(
      sentenceFor({ code: 1, message: 'm', data: { kind: 'io', detail: 'd', hint: 'h' } }),
    ).toBe('h')
    expect(sentenceFor({ code: 1, message: 'm' })).toBe('m')
    expect(sentenceFor(new Error('e'))).toBe('e')
    expect(sentenceFor('?')).toBe('The export did not finish.')
  })
})
