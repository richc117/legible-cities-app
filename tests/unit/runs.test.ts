// The session's jobs over the runs (A1-03, specs/024-jobs): the registry
// lists running jobs from the runs themselves and keeps the finished ones,
// sees runs made after a listener subscribed, cancels through a run's own
// `cancel()`, and forgets a deleted project's jobs. Stub runs, no window.

import { describe, expect, it } from 'vitest'
import { ExportRun, type ExportBridge } from '../../src/renderer/src/engine/exportRun'
import { JobRegistry, type JobSource } from '../../src/renderer/src/engine/runs'
import { ERROR_CODES } from '../../src/shared/engine'
import type { ExportProgress, ExportResult } from '../../src/shared/export'
import type { ProjectRecord } from '../../src/shared/project'
import { MAX_FINISHED, nextJobId, type Job, type JobState } from '../../src/shared/jobs'

/** A run reduced to what the registry reads: a job, a way to hear it change, and cancel. */
class StubRun implements JobSource {
  current: Job | null = null
  cancelled = 0
  readonly #listeners = new Set<() => void>()
  constructor(readonly projectId: string | null = 'p1') {}

  job(): Job | null {
    return this.current
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  cancel(): void {
    this.cancelled += 1
  }

  start(started = Date.now()): void {
    this.current = {
      id: nextJobId(),
      kind: this.projectId === null ? 'feed-add' : 'layout',
      projectId: this.projectId,
      projectName: null,
      label: 'Layout run',
      state: 'running',
      stages: [],
      message: null,
      hint: null,
      detail: null,
      rawDetail: null,
      log: [],
      dropped: 0,
      started,
      ended: null,
    }
    this.#emit()
  }

  end(state: Exclude<JobState, 'running'>, ended = Date.now()): void {
    if (this.current === null) throw new Error('not started')
    this.current = { ...this.current, state, ended }
    this.#emit()
  }

  #emit(): void {
    for (const listener of this.#listeners) listener()
  }
}

describe('JobRegistry', () => {
  it('lists nothing for a run that has never started', () => {
    const registry = new JobRegistry()
    registry.track(new StubRun())
    expect(registry.jobs()).toEqual([])
    expect(registry.runningCount()).toBe(0)
  })

  it('hears a run tracked after a listener subscribed, silently until the run changes', () => {
    const registry = new JobRegistry()
    let heard = 0
    registry.subscribe(() => {
      heard += 1
    })
    const run = new StubRun()
    registry.track(run)
    // A run is made while a screen renders; a listener setting state then
    // would be an update during another component's render.
    expect(heard).toBe(0)
    run.start()
    expect(heard).toBe(1)
    expect(registry.runningCount()).toBe(1)
  })

  it('lists running jobs first, then finished ones newest first, named where a name is known', () => {
    const registry = new JobRegistry()
    const a = new StubRun('pa')
    const b = new StubRun('pb')
    const feeds = new StubRun(null)
    for (const run of [a, b, feeds]) registry.track(run)
    a.start(1)
    a.end('done', 2)
    feeds.start(3)
    feeds.end('failed', 4)
    b.start(5)
    registry.setNames([
      ['pa', 'Alpha'],
      ['pb', 'Bravo'],
    ])
    const listed = registry.jobs()
    expect(listed.map((j) => [j.projectName, j.state])).toEqual([
      ['Bravo', 'running'],
      [null, 'failed'],
      ['Alpha', 'done'],
    ])
  })

  it('keeps a finished job when its run starts again, and keeps twenty finished at most', () => {
    const registry = new JobRegistry()
    const run = new StubRun()
    registry.track(run)
    for (let i = 0; i < MAX_FINISHED + 1; i++) {
      run.start(i * 10)
      run.end('failed', i * 10 + 1)
    }
    run.start(1_000)
    const listed = registry.jobs()
    expect(listed[0].state).toBe('running')
    expect(listed.filter((j) => j.state !== 'running')).toHaveLength(MAX_FINISHED)
    expect(registry.runningCount()).toBe(1)
  })

  it('never drops a running job, however many have finished', () => {
    const registry = new JobRegistry()
    const long = new StubRun('long')
    registry.track(long)
    long.start(0)
    const other = new StubRun()
    registry.track(other)
    for (let i = 0; i < 30; i++) {
      other.start(i + 1)
      other.end('done', i + 2)
    }
    expect(registry.jobs().some((j) => j.projectId === 'long' && j.state === 'running')).toBe(true)
  })

  it('cancels a running job through its own run, and nothing else', () => {
    const registry = new JobRegistry()
    const run = new StubRun()
    registry.track(run)
    run.start()
    const id = run.current?.id as string
    registry.cancel('job-that-is-not-there')
    expect(run.cancelled).toBe(0)
    registry.cancel(id)
    expect(run.cancelled).toBe(1)
    run.end('cancelled')
    registry.cancel(id)
    expect(run.cancelled, 'a finished job is not cancelled again').toBe(1)
  })

  it("forgets a project's finished jobs and name only when told it was deleted", () => {
    const registry = new JobRegistry()
    const kept = new StubRun('kept')
    const gone = new StubRun('gone')
    const feeds = new StubRun(null)
    for (const run of [kept, gone, feeds]) registry.track(run)
    for (const run of [kept, gone, feeds]) {
      run.start(1)
      run.end('done', 2)
    }
    registry.setNames([
      ['kept', 'Kept'],
      ['gone', 'Gone'],
    ])
    // A list read that misses a record it could not read forgets nothing.
    registry.setNames([['kept', 'Kept']])
    const ids = (): (string | null)[] => registry.jobs().map((j) => j.projectId)
    expect(new Set(ids())).toEqual(new Set(['kept', 'gone', null]))
    let heard = 0
    registry.subscribe(() => {
      heard += 1
    })
    registry.forgetProject('gone')
    expect(heard, 'an open inspector hears it at once').toBe(1)
    expect(new Set(ids())).toEqual(new Set(['kept', null]))
    expect(registry.hasName('gone')).toBe(false)
    expect(registry.hasName('kept')).toBe(true)
  })

  it('says a renamed project’s new name, and a name that did not change is no change', () => {
    const registry = new JobRegistry()
    const run = new StubRun('p1')
    registry.track(run)
    run.start(1)
    run.end('done', 2)
    registry.setNames([['p1', 'Los Angeles']])
    let heard = 0
    registry.subscribe(() => {
      heard += 1
    })
    registry.setNames([['p1', 'Los Angeles']])
    expect(heard).toBe(0)
    registry.setNames([['p1', 'LA Metro']])
    expect(heard).toBe(1)
    expect(registry.jobs()[0].projectName).toBe('LA Metro')
  })

  it('tells an end listener once per job, named, at the moment it ends', () => {
    const registry = new JobRegistry()
    const run = new StubRun('p1')
    registry.track(run)
    registry.setNames([['p1', 'Los Angeles']])
    const ended: string[] = []
    registry.onEnded((job) => ended.push(`${job.projectName}: ${job.state}`))
    run.start(1)
    expect(ended).toEqual([])
    run.end('failed', 2)
    run.end('failed', 2)
    run.start(3)
    run.end('failed', 4)
    // Two identical ends are two ends.
    expect(ended).toEqual(['Los Angeles: failed', 'Los Angeles: failed'])
  })

  it('does not bring back a job pushed out of the list when its run speaks again', () => {
    const registry = new JobRegistry()
    const quiet = new StubRun('quiet')
    registry.track(quiet)
    quiet.start(0)
    quiet.end('done', 1)
    const busy = new StubRun('busy')
    registry.track(busy)
    for (let i = 0; i < MAX_FINISHED; i++) {
      busy.start(10 + i)
      busy.end('done', 10 + i)
    }
    expect(registry.jobs().some((j) => j.projectId === 'quiet')).toBe(false)
    quiet.end('done', 1)
    expect(registry.jobs().some((j) => j.projectId === 'quiet')).toBe(false)
  })
})

describe('the registry over a real run', () => {
  it('shows the state the run shows, at every step, and keeps the run once it is cancelled', async () => {
    const listeners = new Set<(p: ExportProgress) => void>()
    let reject!: (e: unknown) => void
    const cancelled: string[] = []
    const bridge: ExportBridge = {
      run: () => ({
        id: 'tok-1',
        result: new Promise<ExportResult>((_, rej) => {
          reject = rej
        }),
      }),
      cancel: async (id) => {
        cancelled.push(id)
      },
      reveal: async () => undefined,
      onProgress: (l) => {
        listeners.add(l)
        return () => listeners.delete(l)
      },
    }
    const run = new ExportRun(bridge)
    const registry = new JobRegistry()
    registry.track(run)
    const disagreements: string[] = []
    registry.subscribe(() => {
      const listed = registry.jobs()[0]
      if (listed !== undefined && listed.state !== run.snapshot.state)
        disagreements.push(`${listed.state} vs ${run.snapshot.state}`)
    })
    run.start(
      { id: 'p1', layout: 'a'.repeat(64), feed: 'la-metro-rail' } as unknown as ProjectRecord,
      { state: 'ready', version: '0.8.2', protocol: 1 },
      { preset: 'instagram-reel', options: {} },
    )
    for (const l of listeners) l({ id: 'tok-1', stage: 'capture', fraction: 0.5, message: 'Half.' })
    expect(registry.jobs()[0]).toMatchObject({ state: 'running', message: 'Half.' })
    registry.cancel(registry.jobs()[0].id)
    expect(cancelled).toEqual(['tok-1'])
    reject({ code: ERROR_CODES.cancelled, message: 'The export was cancelled.' })
    await new Promise((r) => setImmediate(r))
    expect(run.snapshot.state).toBe('cancelled')
    expect(registry.jobs()).toHaveLength(1)
    expect(registry.jobs()[0].state).toBe('cancelled')
    expect(disagreements).toEqual([])
  })
})
