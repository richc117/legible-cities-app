// The run's state machine, against a stub client and a stub bridge. No
// React, no Electron, no engine: the run is a plain object precisely so
// this is possible (.claude/rules/renderer.md).

import { describe, expect, it, vi } from 'vitest'
import {
  LayoutRun,
  advance,
  freshStages,
  readableMessage,
  sentenceFor,
  type RunClient,
} from '../../src/renderer/src/engine/layoutRun'
import { doneSentence, stoppedSentence } from '../../src/renderer/src/LayoutRun'
import { LAYOUT_STAGES } from '../../src/shared/layout'
import { ERROR_CODES, type EngineState } from '../../src/shared/engine'
import type { ProjectRecord } from '../../src/shared/project'

interface Pending {
  method: string
  params: Record<string, unknown>
  report(stage: string, message: string): void
  resolve(value: unknown): void
  reject(error: unknown): void
  cancelled: boolean
}

// The stub answers with whatever a test hands it, so the one cast lives
// here, at the seam, rather than anywhere in the code under test.
type AnyHandle = ReturnType<RunClient['request']>

function stubClient() {
  const calls: Pending[] = []
  const client: RunClient = {
    request(method, params: unknown) {
      const listeners: ((p: { stage: string; message: string }) => void)[] = []
      let settle!: (v: unknown) => void
      let fail!: (e: unknown) => void
      const result = new Promise<unknown>((res, rej) => {
        settle = res
        fail = rej
      })
      const pending: Pending = {
        method,
        params: params as Record<string, unknown>,
        cancelled: false,
        report: (stage, message) => listeners.forEach((l) => l({ stage, message })),
        resolve: settle,
        reject: fail,
      }
      calls.push(pending)
      return {
        result,
        onProgress: (listener: (p: { stage: string; message: string }) => void) => {
          listeners.push(listener)
          return () => {}
        },
        cancel: () => {
          pending.cancelled = true
        },
      } as unknown as AnyHandle
    },
  }
  return { client, calls }
}

// What graph.build answers with, as far as the run reads it: the engine's
// layout id. The paths it also names are never opened by the app.
const LAYOUT = 'c'.repeat(64)
const BUILT = { layout: LAYOUT, paths: {} }

const READY: EngineState = { state: 'ready', version: '0.2.0', protocol: 1 }

const project = (over: Partial<ProjectRecord> = {}): ProjectRecord =>
  ({
    version: 1,
    id: 'p1',
    name: 'LA',
    feed: 'la-metro-rail',
    mode: 'all',
    agency: null,
    date: null,
    style: {},
    colors: {},
    defaultColor: '#888888',
    lineOrder: [],
    theme: 'warm-dark',
    layout: null,
    created: '2026-09-01T00:00:00.000Z',
    modified: '2026-09-01T00:00:00.000Z',
    ...over,
  }) as ProjectRecord

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function setup(over: Partial<ProjectRecord> = {}, engine: EngineState | null = READY) {
  const { client, calls } = stubClient()
  const complete = vi.fn(async () => ({ changed: false }))
  const record = project(over)
  const run = new LayoutRun({ client, complete, today: () => '2026-09-08' })
  return { run, calls, complete, record, begin: () => run.start(record, engine) }
}

describe('the sentences a finished run shows', () => {
  it('say what a re-layout and a changed id each mean, and both together', () => {
    expect(doneSentence(false, false)).toBe('Laid out.')
    expect(doneSentence(false, true)).toMatch(/now names this one/)
    expect(doneSentence(true, false)).toMatch(/^Laid out again from scratch\./)
    expect(doneSentence(true, true)).toMatch(/in place of the one it had recorded/)
  })
})

describe('advance, the progress rule', () => {
  it('marks the finished stage done and the next one running', () => {
    const after = advance(freshStages(), 'gtfs2graph')
    expect(after[0].state).toBe('done')
    expect(after[1].state).toBe('running')
    expect(after[2].state).toBe('pending')
  })

  it('leaves a stage that is already done alone, and returns the same list', () => {
    const once = advance(freshStages(), 'gtfs2graph')
    const twice = advance(once, 'gtfs2graph')
    expect(twice).toBe(once)
  })

  it('ignores a stage it does not know', () => {
    const stages = freshStages()
    expect(advance(stages, 'sausage')).toBe(stages)
  })
})

describe('the run asks for the layout and then the map', () => {
  it('sends the feed key, the day and the project as the output folder', async () => {
    const { calls, begin } = setup()
    begin()
    expect(calls[0]).toMatchObject({ method: 'graph.build', params: { key: 'la-metro-rail' } })
    calls[0].resolve(BUILT)
    await tick()
    expect(calls[1]).toMatchObject({
      method: 'map.build',
      params: { key: 'la-metro-rail', layout: LAYOUT, date: '2026-09-08', out: 'p1' },
    })
  })

  it('draws the map from the layout the engine just answered, never asking it to lay out', async () => {
    const { calls, begin } = setup()
    begin()
    calls[0].resolve({ layout: 'd'.repeat(64), paths: {} })
    await tick()
    expect(calls[1].params.layout).toBe('d'.repeat(64))
    expect(Object.keys(calls[1].params)).not.toContain('force')
  })

  it('a re-layout forces every stage and says so when done', async () => {
    const { run, calls, complete, record } = setup({ layout: LAYOUT })
    run.start(record, READY, { force: true })
    expect(calls[0]).toMatchObject({
      method: 'graph.build',
      params: { key: 'la-metro-rail', force: true },
    })
    expect(run.snapshot.forced).toBe(true)
    calls[0].resolve(BUILT)
    await tick()
    expect(Object.keys(calls[1].params).sort()).toEqual(['date', 'key', 'layout', 'out'])
    calls[1].resolve({ files: {} })
    await tick()
    expect(complete).toHaveBeenCalledWith('p1', { date: '2026-09-08', layout: LAYOUT })
    expect(run.snapshot).toMatchObject({ state: 'done', forced: true, changed: false })
  })

  it('an ordinary run sends no force', async () => {
    const { calls, begin } = setup()
    begin()
    expect(Object.keys(calls[0].params)).toEqual(['key'])
  })

  it('uses the day the project already has rather than today', async () => {
    const { calls, begin } = setup({ date: '2026-05-04' })
    begin()
    calls[0].resolve(BUILT)
    await tick()
    expect(calls[1].params).toMatchObject({ date: '2026-05-04' })
  })

  it("leaves the registry's mode and agency to the engine until a person can choose them", async () => {
    const { calls, begin } = setup({ mode: 'rail', agency: 'Metro' })
    begin()
    calls[0].resolve(BUILT)
    await tick()
    expect(Object.keys(calls[0].params).sort()).toEqual(['key'])
    expect(Object.keys(calls[1].params).sort()).toEqual(['date', 'key', 'layout', 'out'])
  })

  it("writes the record once, with the engine's layout id", async () => {
    const { run, calls, complete, begin } = setup()
    begin()
    calls[0].resolve(BUILT)
    await tick()
    calls[1].resolve({ files: {} })
    await tick()
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledWith('p1', { date: '2026-09-08', layout: LAYOUT })
    expect(run.snapshot.state).toBe('done')
    expect(run.snapshot.stages.every((s) => s.state === 'done')).toBe(true)
  })

  it('reports a layout that differs from the one the project stored', async () => {
    const { run, calls, complete, begin } = setup({ layout: 'a'.repeat(64) })
    complete.mockResolvedValueOnce({ changed: true })
    begin()
    calls[0].resolve(BUILT)
    await tick()
    calls[1].resolve({ files: {} })
    await tick()
    expect(run.snapshot.changed).toBe(true)
  })
})

describe('the sentence on screen describes the stage that finished', () => {
  it('walks the stages and keeps the last completed sentence', async () => {
    const { run, calls, begin } = setup()
    begin()
    expect(run.snapshot.stages[0].state).toBe('running')
    calls[0].report('gtfs2graph', '114 nodes, 112 edges')
    expect(run.snapshot.stages[0].state).toBe('done')
    expect(run.snapshot.stages[1].state).toBe('running')
    expect(run.snapshot.message).toBe('114 nodes, 112 edges')
  })

  it("ignores the map call repeating the layout's stages", async () => {
    const { run, calls, begin } = setup()
    begin()
    for (const stage of ['gtfs2graph', 'topo', 'loom', 'octi']) {
      calls[0].report(stage, `${stage} finished`)
    }
    calls[0].resolve(BUILT)
    await tick()
    expect(run.snapshot.stages[4].state).toBe('running')
    calls[1].report('gtfs2graph', 'again')
    expect(run.snapshot.stages[4].state, 'the map has not moved past schedule').toBe('running')
    expect(run.snapshot.message, 'a repeat does not replace the sentence').toBe('octi finished')
  })

  it('reaches every stage the engine reports, in order', async () => {
    const { run, calls, begin } = setup()
    begin()
    calls[0].resolve(BUILT)
    await tick()
    for (const stage of LAYOUT_STAGES) calls[1].report(stage, `${stage} finished`)
    expect(run.snapshot.stages.every((s) => s.state === 'done')).toBe(true)
    expect(run.snapshot.message, 'the write stage never shows its folder').toBe(
      'Wrote the map and its page.',
    )
  })

  it('notifies a subscriber of each change and stops when it unsubscribes', () => {
    const { run, calls, begin } = setup()
    const seen: string[] = []
    const off = run.subscribe((s) => seen.push(s.state))
    begin()
    calls[0].report('gtfs2graph', 'x')
    off()
    calls[0].report('topo', 'y')
    expect(seen).toEqual(['running', 'running'])
  })
})

// The engine's last progress message is the folder it wrote into. A path is
// not for a screen, and the specification forbids one (FR-012).
describe('a message that is a path never reaches the screen', () => {
  it("replaces the write stage's folder with what it did", async () => {
    const { run, calls, begin } = setup()
    begin()
    calls[0].resolve(BUILT)
    await tick()
    for (const stage of ['gtfs2graph', 'topo', 'loom', 'octi', 'schedule', 'render', 'animate']) {
      calls[1].report(stage, `${stage} finished`)
    }
    calls[1].report('write', '/engine-home/out/p1')
    expect(run.snapshot.message).toBe('Wrote the map and its page.')
    expect(run.snapshot.message).not.toContain('/')
  })

  // A slash is not evidence of a path. These are the engine's real
  // sentences, from specs/007-layout-run/research.md, and every one of them
  // has to survive.
  it('keeps the sentences the engine actually sends', () => {
    const real: [string, string][] = [
      ['gtfs2graph', '114 nodes (114 stations, 0 junctions), 112 edges, lines: A, B, C, D, E, K'],
      ['schedule', '1236 trips on Wednesday 2 September 2026; matched 114/114 stops (100%)'],
      ['render', '3 labels dropped'],
      ['animate', '28 distinct paths'],
    ]
    for (const [stage, message] of real) {
      expect(readableMessage(stage, message), stage).toBe(message)
    }
    // A line label may carry a slash too.
    expect(readableMessage('topo', '9 nodes, 8 edges, lines: A/C/E, B/D')).toBe(
      '9 nodes, 8 edges, lines: A/C/E, B/D',
    )
  })

  it('replaces a message that is path-shaped, whatever its stage', () => {
    expect(readableMessage('render', 'wrote C:\\out\\map.svg')).toBe('Finished render.')
    expect(readableMessage('render', '/var/folders/x/out')).toBe('Finished render.')
    expect(readableMessage('topo', '')).toBeNull()
  })
})

describe('cancelling and failing write nothing', () => {
  it('cancels the request in flight and says the run was cancelled', async () => {
    const { run, calls, complete, begin } = setup()
    begin()
    run.cancel()
    expect(calls[0].cancelled).toBe(true)
    calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    expect(run.snapshot.state).toBe('cancelled')
    expect(complete).not.toHaveBeenCalled()
    expect(run.snapshot.stages.some((s) => s.state === 'failed')).toBe(false)
  })

  it('a forced run stopped after the layout answered says the layout was replaced', async () => {
    const { run, calls, record } = setup({ layout: LAYOUT })
    run.start(record, READY, { force: true })
    expect(run.snapshot.replaced).toBe(false)
    calls[0].resolve(BUILT)
    await tick()
    expect(run.snapshot.replaced, 'the engine has swapped the stored set in').toBe(true)
    run.cancel()
    calls[1].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'cancelled', forced: true, replaced: true })
    expect(stoppedSentence('cancelled', true)).toMatch(/laid out again, before the map was drawn/)
    expect(stoppedSentence('failed', true)).toMatch(/but the map was not drawn/)
    expect(stoppedSentence('cancelled', false)).toBe(
      'The run was cancelled. The project is as it was.',
    )
  })

  it('an unforced run stopped after the layout answered left the stored layout alone', async () => {
    const { run, calls, begin } = setup({ layout: LAYOUT })
    begin()
    calls[0].resolve(BUILT)
    await tick()
    run.cancel()
    calls[1].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    expect(run.snapshot).toMatchObject({ state: 'cancelled', forced: false, replaced: false })
  })

  it('cancels the map call once the layout has finished', async () => {
    const { run, calls, begin } = setup()
    begin()
    calls[0].resolve(BUILT)
    await tick()
    run.cancel()
    expect(calls[1].cancelled).toBe(true)
    expect(calls[0].cancelled, 'the finished call is not cancelled again').toBe(false)
  })

  it("marks the running stage failed and shows the engine's sentence, not its detail", async () => {
    const { run, calls, complete, begin } = setup()
    begin()
    calls[0].report('gtfs2graph', 'ok')
    calls[0].reject({
      code: -32000,
      message: 'topo failed',
      data: {
        kind: 'loom',
        detail: '/a/path exit 137',
        hint: 'The layout tool ran out of memory.',
      },
    })
    await tick()
    expect(run.snapshot.state).toBe('failed')
    expect(run.snapshot.error).toBe('The layout tool ran out of memory.')
    expect(run.snapshot.error).not.toContain('/a/path')
    expect(run.snapshot.stages[1].state).toBe('failed')
    expect(complete).not.toHaveBeenCalled()
  })

  it('falls back to the message when the engine sent no hint', () => {
    expect(sentenceFor({ code: -32000, message: 'plain' })).toBe('plain')
    expect(sentenceFor(new Error('thrown'))).toBe('thrown')
    expect(sentenceFor('nonsense')).toMatch(/did not finish/)
  })
})

// Writing the record at the end of a run changes the project the view
// holds. The run must not lose what it just produced because of that.
describe('the run survives the record it writes', () => {
  it('keeps its outcome after the project has changed underneath it', async () => {
    const { client, calls } = stubClient()
    let record = project()
    const complete = vi.fn(async () => {
      record = project({ layout: 'b'.repeat(64), date: '2026-09-08' })
      return { changed: false }
    })
    const run = new LayoutRun({ client, complete, today: () => '2026-09-08' })
    run.start(record, READY)
    calls[0].resolve(BUILT)
    await tick()
    calls[1].resolve({ files: {} })
    await tick()
    expect(run.snapshot.state, 'the outcome is still there to be read').toBe('done')
  })

  it('writes the day it started with, not one the record gained meanwhile', async () => {
    const { client, calls } = stubClient()
    const complete = vi.fn(async () => ({ changed: false }))
    const run = new LayoutRun({ client, complete, today: () => '2026-09-08' })
    run.start(project({ date: '2026-01-01' }), READY)
    // The record is written again while the run is in flight, as another
    // screen might. The run is unmoved: it holds the day it began with.
    project({ date: '2026-12-25' })
    calls[0].resolve(BUILT)
    await tick()
    calls[1].resolve({ files: {} })
    await tick()
    expect(calls[1].params).toMatchObject({ date: '2026-01-01' })
    expect(complete).toHaveBeenCalledWith('p1', expect.objectContaining({ date: '2026-01-01' }))
  })
})

describe('the run refuses when it cannot start', () => {
  it('refuses while the engine is not ready, and calls nothing', () => {
    const { run, calls, begin } = setup({}, { state: 'unavailable', reason: 'no interpreter' })
    begin()
    expect(calls).toHaveLength(0)
    expect(run.snapshot.state).toBe('failed')
    expect(run.snapshot.error).toMatch(/not ready/i)
  })

  it('refuses before the engine has said anything', () => {
    const { run, calls, begin } = setup({}, null)
    begin()
    expect(calls).toHaveLength(0)
    expect(run.snapshot.error).toMatch(/starting/i)
  })

  it('refuses a second run while one is in flight', () => {
    const { calls, begin } = setup()
    begin()
    begin()
    expect(calls).toHaveLength(1)
  })
})
