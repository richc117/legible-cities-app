// The page's view of an export, against a stub bridge. No React, no
// Electron, no main process: the run is a plain object so this is possible.

import { describe, expect, it } from 'vitest'
import {
  EXPORT_KEPT,
  ExportRun,
  announcement,
  freshStages,
  sentenceFor,
  stagesAt,
  type ExportBridge,
} from '../../src/renderer/src/engine/exportRun'
import { ENCODE_UNFINISHED, unfinishedSentence } from '../../src/renderer/src/ExportRun'
import { ERROR_CODES, type EngineState } from '../../src/shared/engine'
import {
  UNPROVEN_FRAMES,
  type ExportChoice,
  type ExportProgress,
  type ExportResult,
} from '../../src/shared/export'
import { DEFAULT_STYLE, type ProjectRecord } from '../../src/shared/project/types'

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

const REEL: ExportChoice = { preset: 'instagram-reel', options: {} }

function stubBridge() {
  const runs: { projectId: string; choice: ExportChoice }[] = []
  const cancelled: string[] = []
  const revealed: string[] = []
  const listeners = new Set<(p: ExportProgress) => void>()
  let resolve!: (v: ExportResult) => void
  let reject!: (e: unknown) => void
  let next = 1
  const bridge: ExportBridge = {
    run(projectId, choice) {
      runs.push({ projectId, choice })
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
  export: { preset: 'instagram-reel', options: {} },
  destination: null,
  opened: null,
  layout: 'a'.repeat(64),
  made: null,
  drawn: null,
  built: null,
  created: '2026-09-10T00:00:00.000Z',
  modified: '2026-09-10T00:00:00.000Z',
  ...over,
})

describe('ExportRun', () => {
  it('starts idle with the three stages waiting', () => {
    const { bridge } = stubBridge()
    const run = new ExportRun(bridge)
    expect(run.snapshot.state).toBe('idle')
    expect(run.snapshot.stages.map((s) => s.id)).toEqual(['plan', 'capture', 'encode'])
    expect(run.snapshot.stages.every((s) => s.state === 'pending')).toBe(true)
  })

  it('refuses to start without a ready engine, or without a layout', () => {
    const { bridge, runs } = stubBridge()
    const run = new ExportRun(bridge)
    run.start(project(), null, REEL)
    expect(run.snapshot).toMatchObject({ state: 'failed', error: /still starting/ })
    run.start(project(), { state: 'starting', attempt: 1 }, REEL)
    expect(run.snapshot.error).toMatch(/not ready to export: starting/)
    run.start(project({ layout: null }), READY, REEL)
    expect(run.snapshot.error).toMatch(/Lay the project out/)
    expect(runs).toEqual([])
  })

  it('follows the reports stage by stage and ends done with the file name', async () => {
    const stub = stubBridge()
    const run = new ExportRun(stub.bridge)
    const seen: string[] = []
    run.subscribe((s) => seen.push(s.state))
    run.start(project(), READY, REEL)
    expect(stub.runs).toEqual([{ projectId: 'abcdefghijk1', choice: REEL }])
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
    const run = new ExportRun(stub.bridge)
    run.start(project(), READY, REEL)
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

  it('ends done with the file when the cancel came too late, and says the export was kept', async () => {
    // The main process finished the export the engine answered after the
    // cancel with `cancel_too_late` (engine v0.18.0), and said so in the
    // result. Mutation: `late` not read - the page then says nothing of the
    // cancel a person pressed.
    const stub = stubBridge()
    const run = new ExportRun(stub.bridge)
    run.start(project(), READY, REEL)
    stub.report({
      id: 'tok-1',
      stage: 'encode',
      fraction: 0.9,
      message: 'Encoded 54 of 60 frames.',
    })
    run.cancel()
    expect(stub.cancelled).toEqual(['tok-1'])
    stub.resolve({ file: 'x.mp4', bytes: 10, frames: 60, late: true })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'done', file: 'x.mp4', message: EXPORT_KEPT })
    expect(run.job()?.message).toBe(EXPORT_KEPT)
    run.reveal()
    expect(stub.revealed, 'the file kept can be revealed').toEqual(['tok-1'])

    // Only `true` is the flag: anything else is a finish in the ordinary words.
    const plain = stubBridge()
    const other = new ExportRun(plain.bridge)
    other.start(project(), READY, REEL)
    plain.resolve({ file: 'x.mp4', bytes: 10, frames: 60, late: 'yes' } as unknown as ExportResult)
    await tick()
    expect(other.snapshot.state).toBe('done')
    expect(other.snapshot.message).not.toBe(EXPORT_KEPT)
  })

  // The finished sentence (app issue 100): what the result says beside
  // "Exported", in cell 06 and the jobs inspector. Mutations: the unproven
  // sentence dropped; the two joined the other way round.
  it.each<[string, Partial<ExportResult>, string]>([
    ['proven and not late, the last progress sentence', {}, 'Encoded 60 of 60 frames.'],
    ['late only', { late: true }, EXPORT_KEPT],
    ['unproven only', { unproven: true }, UNPROVEN_FRAMES],
    [
      'late and unproven, in that order',
      { late: true, unproven: true },
      `${EXPORT_KEPT} ${UNPROVEN_FRAMES}`,
    ],
  ])('finishes %s', async (_what, flags, said) => {
    const stub = stubBridge()
    const run = new ExportRun(stub.bridge)
    run.start(project(), READY, REEL)
    stub.report({ id: 'tok-1', stage: 'encode', fraction: 1, message: 'Encoded 60 of 60 frames.' })
    stub.resolve({ file: 'x.mp4', bytes: 10, frames: 60, ...flags })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'done', file: 'x.mp4', message: said })
    expect(run.job()?.message).toBe(said)
    // A screen reader is told the finish once, by the job's end sentence,
    // which names the file and then says what the result said beside it
    // (issue 570); cell 06's hidden status keeps its last progress sentence.
    const beside = flags.late === true || flags.unproven === true ? said : null
    expect(run.job()?.exported).toEqual({ file: 'x.mp4', said: beside })
    expect(run.snapshot.announced).toBe('Encoded 100 percent of the frames.')
  })

  it('ends failed with the engine’s sentence for a destination that is its own source', async () => {
    // Engine v0.18.0 refuses it before anything is written (its issue 79),
    // as a params error, shown as every refusal is. Mutation: `left` set for
    // any failure during the encode - the page would then say a file may
    // have been left where the engine wrote none. And the sentence beneath:
    // the refusal comes back while the encode stage is the one running, but
    // the engine judged the request before its job started, so nothing was
    // written and "export again" would only be refused again. Mutation: the
    // `refused` branch dropped from `unfinishedSentence` - the page then
    // says the file may have been written without its sidecar.
    const sentence =
      'dest must not be the source, or put its sidecar or a .part file on it: the source is read and never written to'
    const stub = stubBridge()
    const run = new ExportRun(stub.bridge)
    run.start(project(), READY, REEL)
    stub.report({ id: 'tok-1', stage: 'encode', fraction: 0, message: 'Encoding 60 frames.' })
    stub.reject({
      code: -32602,
      message: sentence,
      data: { kind: 'params', detail: sentence, hint: sentence },
    })
    await tick()
    expect(run.snapshot).toMatchObject({
      state: 'failed',
      error: sentence,
      left: false,
      refused: true,
    })
    expect(run.snapshot.stages.find((s) => s.id === 'encode')?.state).toBe('failed')
    const { left, stages, refused } = run.snapshot
    expect(unfinishedSentence('failed', left, stages, refused)).toBe('Nothing was written.')

    // Another failure while it encodes is not a refusal, and says so.
    run.start(project(), READY, REEL)
    expect(run.snapshot.refused, 'cleared at the start').toBe(false)
    stub.report({ id: 'tok-2', stage: 'encode', fraction: 0.5, message: 'Encoded 30 of 60.' })
    stub.reject({ code: -32000, message: 'ffmpeg exited 1', data: { kind: 'export' } })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'failed', refused: false })
    expect(
      unfinishedSentence('failed', run.snapshot.left, run.snapshot.stages, run.snapshot.refused),
    ).toBe(ENCODE_UNFINISHED)
  })

  it("ends failed with the engine's hint and the running stage marked", async () => {
    const stub = stubBridge()
    const run = new ExportRun(stub.bridge)
    run.start(project(), READY, REEL)
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
    const run = new ExportRun(stub.bridge)
    run.start(project(), READY, REEL)
    stub.report({
      id: 'tok-1',
      stage: 'capture',
      fraction: 0.5,
      message: 'Captured 30 of 60 frames.',
    })
    stub.reject({ code: ERROR_CODES.engineExited, message: 'The engine stopped.' })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'failed', left: false })

    run.start(project(), READY, REEL)
    stub.report({
      id: 'tok-2',
      stage: 'encode',
      fraction: 0.5,
      message: 'Encoded 30 of 60 frames.',
    })
    stub.reject({ code: ERROR_CODES.engineExited, message: 'The engine stopped.' })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'failed', left: true })

    run.start(project(), READY, REEL)
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
    const run = new ExportRun(stub.bridge)
    run.start(project(), READY, REEL)
    const rejectFirst = stub.reject
    run.cancel()
    rejectFirst({ code: ERROR_CODES.cancelled, message: 'cancelled' })
    await tick()
    expect(run.snapshot.state).toBe('cancelled')
    run.start(project(), READY, REEL)
    expect(run.snapshot.state).toBe('running')
    expect(stub.runs).toHaveLength(2)
    stub.resolve({ file: 'y.mp4', bytes: 1, frames: 1 })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'done', file: 'y.mp4' })
  })

  it('does not start twice while running, and dispose releases the subscription', () => {
    const stub = stubBridge()
    const run = new ExportRun(stub.bridge)
    run.start(project(), READY, REEL)
    run.start(project(), READY, REEL)
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
  it('announcement turns a count of frames into a tenth of them and leaves other sentences be', () => {
    expect(announcement('Capturing 108 frames.', null)).toBe('Capturing 108 frames.')
    // Before the first tenth the sentence already spoken stands.
    expect(announcement('Captured 10 of 108 frames.', 'Capturing 108 frames.')).toBe(
      'Capturing 108 frames.',
    )
    expect(announcement('Captured 11 of 108 frames.', 'Capturing 108 frames.')).toBe(
      'Captured 10 percent of the frames.',
    )
    expect(announcement('Encoded 108 of 108 frames.', 'x')).toBe(
      'Encoded 100 percent of the frames.',
    )
    // A still is one frame: it goes from nothing to all of it.
    expect(announcement('Captured 1 of 1 frames.', 'Capturing 1 frames.')).toBe(
      'Captured 100 percent of the frames.',
    )
    // The sentence that says the frames were not proven fresh is not a count.
    const unproven = `Captured 108 of 108 frames. ${UNPROVEN_FRAMES}`
    expect(announcement(unproven, 'x')).toBe(unproven)
    // A count of nothing out of nothing cannot be a share of it.
    expect(announcement('Captured 0 of 0 frames.', 'Capturing 0 frames.')).toBe(
      'Capturing 0 frames.',
    )
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

// The inspector's view of an export (A1-03, specs/024-jobs).
describe('the export as a job', () => {
  it('is no job until it starts, then a running export job named for its preset', () => {
    const stub = stubBridge()
    const run = new ExportRun(stub.bridge)
    expect(run.job()).toBeNull()
    run.start(project(), READY, REEL)
    expect(run.job()).toMatchObject({
      kind: 'export',
      label: 'Export as instagram-reel',
      projectId: 'abcdefghijk1',
      state: 'running',
      ended: null,
    })
    expect(run.job()?.stages.map((s) => s.id)).toEqual(['plan', 'capture', 'encode'])
  })

  it('keeps its progress sentences as its log, since it has no engine log of its own', async () => {
    const stub = stubBridge()
    const run = new ExportRun(stub.bridge)
    run.start(project(), READY, REEL)
    stub.report({ id: 'tok-1', stage: 'plan', fraction: 1, message: 'Planned x.mp4: 60 frames.' })
    stub.report({ id: 'tok-1', stage: 'capture', fraction: 0.5, message: '' })
    stub.report({ id: 'tok-9', stage: 'encode', fraction: 1, message: 'not ours' })
    expect(run.job()?.log).toEqual(['plan: Planned x.mp4: 60 frames.'])
    // A capture reports every frame; its line is replaced, so the plan's survives.
    for (let frame = 1; frame <= 600; frame++)
      stub.report({
        id: 'tok-1',
        stage: 'capture',
        fraction: frame / 600,
        message: `Captured ${frame} of 600 frames.`,
      })
    stub.report({ id: 'tok-1', stage: 'encode', fraction: 0.5, message: 'Encoded 300 of 600.' })
    expect(run.job()?.log).toEqual([
      'plan: Planned x.mp4: 60 frames.',
      'capture: Captured 600 of 600 frames.',
      'encode: Encoded 300 of 600.',
    ])
    expect(run.job()?.dropped).toBe(0)
    stub.resolve({ file: 'x.mp4', bytes: 10, frames: 60 })
    await tick()
    expect(run.job()).toMatchObject({ state: 'done' })
    expect(run.job()?.ended).not.toBeNull()
  })

  it('a failure carries the hint, and the detail when the engine sent one', async () => {
    const stub = stubBridge()
    const run = new ExportRun(stub.bridge)
    run.start(project(), READY, REEL)
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
    expect(run.job()).toMatchObject({
      state: 'failed',
      hint: 'ffmpeg could not encode the frames.',
      detail: 'ffmpeg exited 1',
    })
  })

  it('a refused start is a failed job, and the snapshot keeps its own fields', () => {
    const stub = stubBridge()
    const run = new ExportRun(stub.bridge)
    run.start(project({ layout: null }), READY, REEL)
    expect(run.job()).toMatchObject({
      state: 'failed',
      hint: expect.stringMatching(/Lay the project out/),
    })
    expect(Object.keys(run.snapshot).sort()).toEqual(
      ['state', 'stages', 'message', 'announced', 'error', 'file', 'left', 'refused'].sort(),
    )
  })
})
