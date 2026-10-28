// @vitest-environment jsdom
// The window's jobs as the header and the inspector follow them (A1-03,
// issue 433): the header's Jobs toggle carries the running count, read from
// the registry as an outside store, and the inspector lists the jobs from
// the moment it opens and every change after.
//
// The session's registry is a real `JobRegistry` over a stub run, laid in
// for the one `engine/runs.ts` keeps, so a move of the run reaches the
// header and the inspector exactly as a layout's would. The Library is
// drawn as nothing: it is not what is tested, and it asks the bridge for
// every project and feed. jsdom has no `matchMedia`, which the header reads
// for the narrow window and the theme module reads as it loads; this file
// gives it one that never matches.
//
// Mutations, each watched failing (`jobs-header.mutations.json`): the
// header's count subscribed to nothing - it stays "none running"; the
// inspector's subscription taken away - a job that starts after it opened
// is never listed.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import type { JobRegistry, JobSource } from '../../src/renderer/src/engine/runs'
import { nextJobId, type Job } from '../../src/shared/jobs'
import { byName, cleanup, renderPanel } from '../support/render'
import { pending, unsubscribed } from '../support/project-state'

const session = vi.hoisted(() => ({ registry: null as unknown as JobRegistry }))

vi.mock('../../src/renderer/src/engine/runs', async (original) => {
  const module = await original<typeof import('../../src/renderer/src/engine/runs')>()
  const registry = new module.JobRegistry()
  session.registry = registry
  return {
    ...module,
    jobs: () => registry.jobs(),
    subscribeToJobs: (listener: () => void) => registry.subscribe(listener),
    onJobEnded: (listener: (job: Job) => void) => registry.onEnded(listener),
    runningCount: () => registry.runningCount(),
    cancelJob: (id: string) => registry.cancel(id),
    readProjectNames: async () => undefined,
  }
})

vi.mock('../../src/renderer/src/Library', () => ({ default: () => null }))

// The window never narrow and the system never light, from before the app's
// theme module reads it as it loads until this file is done.
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }),
})
afterAll(() => {
  delete (window as { matchMedia?: unknown }).matchMedia
})

// Imported after the mocks, which `vi.mock` hoists above every import, and
// after the stub above.
const { default: App } = await import('../../src/renderer/src/App')

/** A run as the registry lists one: its latest job, and a way to hear it move. */
class StubRun implements JobSource {
  current: Job | null = null
  readonly #listeners = new Set<() => void>()
  job(): Job | null {
    return this.current
  }
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
  cancel(): void {}
  move(job: Job): void {
    this.current = job
    for (const listener of this.#listeners) listener()
  }
}

const job = (over: Partial<Job> = {}): Job => ({
  id: 'job-1',
  kind: 'layout',
  projectId: 'p1',
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
  started: Date.UTC(2026, 9, 27, 12, 0, 0),
  ended: null,
  ...over,
})

const API = {
  settings: { read: () => pending<never>() },
  firstRun: { get: () => pending<never>(), onChanged: unsubscribed },
}

let run: StubRun

beforeEach(() => {
  run = new StubRun()
  session.registry.track(run)
})

afterEach(() => {
  cleanup()
  // A finished job is the registry's copy, kept until its project is forgotten.
  session.registry.untrack(run)
  session.registry.forgetProject('p1')
})

describe('the header’s Jobs toggle', () => {
  it('says how many jobs are running as a run starts and ends', () => {
    renderPanel(<App />, { api: API })
    expect(byName('button', 'Jobs, none running')).toBeTruthy()
    act(() => run.move(job({ id: nextJobId() })))
    expect(byName('button', 'Jobs, 1 running'), 'once the run starts').toBeTruthy()
    act(() => run.move({ ...run.current!, state: 'done', ended: Date.UTC(2026, 9, 27, 12, 1) }))
    expect(byName('button', 'Jobs, none running'), 'once it has ended').toBeTruthy()
  })
})
