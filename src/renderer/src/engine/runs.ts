// One layout run and one export per project, for as long as the app is
// open, and one client for the whole renderer.
//
// All are here rather than in a component because a run outlives the view
// that started it: a person can start a layout or an export, go back to the
// Library, and come back to a project that is still running. A run held in
// a component would be a second run for the same project, writing the same
// output folder, and a client made per view would leave its two bridge
// subscriptions behind every time (each is an `ipcRenderer.on`).
//
// This module reaches for `window.api`, so it is imported only by the
// renderer. The runs themselves take their client or bridge as an argument
// and know nothing of any of this, which is what lets the tests drive them.

import type { ExportProgress } from '../../../shared/export'
import { keepFinished, orderJobs, type Job } from '../../../shared/jobs'
import { copyText } from './diagnostics'
import { ExportRun, type ExportBridge } from './exportRun'
import { FeedAdd } from './feedAdd'
import { LayoutRun } from './layoutRun'
import { EngineClient } from './client'

/** A run the registry lists: anything that can describe its latest attempt as a job. */
export interface JobSource {
  job(): Job | null
  subscribe(listener: () => void): () => void
  cancel(): void
}

/**
 * The session's jobs over the runs that exist (A1-03, specs/024-jobs).
 *
 * Each run holds only its latest attempt, so the registry keeps the earlier
 * ones itself: the moment a run's job reaches a final state it is copied
 * into a list, newest first, at most `MAX_FINISHED` long. Running jobs are
 * read from the runs every time and are never dropped. Nothing here is
 * written anywhere; a relaunch starts with an empty list.
 *
 * It takes no `window`, so a test drives it with stub runs.
 */
export class JobRegistry {
  readonly #sources = new Map<JobSource, () => void>()
  readonly #listeners = new Set<() => void>()
  #finished: Job[] = []
  /** Every job ever copied into the list, so one pushed out or forgotten never comes back. */
  readonly #recorded = new Set<string>()

  /**
   * List a run's jobs from now on. A run tracked twice is tracked once.
   *
   * Silent: a run is made while a screen renders (`layoutRunFor` is called
   * from a component's body), and a listener that set state then would be
   * React updating one component during another's render. A run just made
   * has no job to list; its first change is heard like any other.
   */
  track(source: JobSource): void {
    if (this.#sources.has(source)) return
    const off = source.subscribe(() => this.#changed(source))
    this.#sources.set(source, off)
  }

  /** Stop listening to a run. Its finished jobs stay until forgotten. */
  untrack(source: JobSource): void {
    this.#sources.get(source)?.()
    this.#sources.delete(source)
    this.#notify()
  }

  #changed(source: JobSource): void {
    const job = source.job()
    if (job !== null && job.state !== 'running' && !this.#recorded.has(job.id)) {
      this.#recorded.add(job.id)
      this.#finished = keepFinished(this.#finished, job)
    }
    this.#notify()
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }

  /** Running first, newest first; then the finished, newest first; named by the caller. */
  jobs(nameOf: (projectId: string) => string | undefined = () => undefined): Job[] {
    const running: Job[] = []
    for (const source of this.#sources.keys()) {
      const job = source.job()
      if (job !== null && job.state === 'running') running.push(job)
    }
    return orderJobs([...running, ...this.#finished]).map((job) =>
      job.projectId === null ? job : { ...job, projectName: nameOf(job.projectId) ?? null },
    )
  }

  runningCount(): number {
    let going = 0
    for (const source of this.#sources.keys()) if (source.job()?.state === 'running') going += 1
    return going
  }

  /** Hear every change to any tracked run, and to the list itself. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Cancel a running job by its id; nothing for a job that is not running. */
  cancel(jobId: string): void {
    for (const source of this.#sources.keys()) {
      const job = source.job()
      if (job !== null && job.id === jobId && job.state === 'running') {
        source.cancel()
        return
      }
    }
  }

  /** A project was deleted: its finished jobs go. A running one cannot exist. */
  forgetProject(projectId: string): void {
    const before = this.#finished.length
    this.#finished = this.#finished.filter((job) => job.projectId !== projectId)
    if (this.#finished.length !== before) this.#notify()
  }

  /**
   * Keep only the finished jobs of the projects a list read from the store
   * names, among those that ended before the read began; a job that ended
   * after it may be for a project the read could not have seen yet.
   */
  forgetOutside(ids: ReadonlySet<string>, before: number): void {
    const kept = this.#finished.filter(
      (job) =>
        job.projectId === null || ids.has(job.projectId) || (job.ended ?? job.started) >= before,
    )
    if (kept.length === this.#finished.length) return
    this.#finished = kept
    this.#notify()
  }
}

let client: EngineClient | null = null

export const engineClient = (): EngineClient => {
  client ??= new EngineClient(window.api.engine)
  return client
}

const runs = new Map<string, LayoutRun>()

/** Every run this session has made, as jobs, for the inspector (A1-03). */
const registry = new JobRegistry()

const today = (): string => {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** The run for a project, made once and found again on the next visit. */
export function layoutRunFor(projectId: string): LayoutRun {
  const existing = runs.get(projectId)
  if (existing !== undefined) return existing
  const run = new LayoutRun({
    client: engineClient(),
    complete: (id, done) => window.api.projects.completeLayout(id, done),
    completeRebuild: (id, done) => window.api.projects.completeRebuild(id, done),
    completeColors: (id, palette) => window.api.projects.completeColors(id, palette),
    completeOrder: (id, order) => window.api.projects.completeOrder(id, order),
    today,
  })
  runs.set(projectId, run)
  registry.track(run)
  return run
}

/** Forget a project's run: it was deleted, so nothing will ask again. */
export function forgetLayoutRun(projectId: string): void {
  const run = runs.get(projectId)
  if (run !== undefined) registry.untrack(run)
  runs.delete(projectId)
  registry.forgetProject(projectId)
}

let adder: FeedAdd | null = null

/** The one feed add at a time, over the shared client. */
export function feedAdd(): FeedAdd {
  if (adder === null) {
    adder = new FeedAdd(engineClient())
    registry.track(adder)
  }
  return adder
}

const exports = new Map<string, ExportRun>()

let exportBridge: ExportBridge | null = null

/**
 * One bridge subscription for every export run, fanned out to the runs:
 * a run made per project visited must not cost an `ipcRenderer.on` each,
 * which is the same reason the engine has one client.
 */
const sharedExportBridge = (): ExportBridge => {
  if (exportBridge !== null) return exportBridge
  const listeners = new Set<(p: ExportProgress) => void>()
  window.api.export.onProgress((progress) => {
    for (const listener of listeners) listener(progress)
  })
  exportBridge = {
    run: (projectId, preset) => window.api.export.run(projectId, preset),
    cancel: (id) => window.api.export.cancel(id),
    reveal: (id) => window.api.export.reveal(id),
    onProgress: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return exportBridge
}

/** The export for a project, made once and found again on the next visit. */
export function exportRunFor(projectId: string): ExportRun {
  const existing = exports.get(projectId)
  if (existing !== undefined) return existing
  const run = new ExportRun(sharedExportBridge())
  exports.set(projectId, run)
  registry.track(run)
  return run
}

/**
 * How many runs are going, across every project this session has opened.
 *
 * The main process cannot answer this. A layout run is four steps in a row -
 * `graph.build`, `feeds.service`, `map.build`, then the record write - and
 * nothing is in flight between them, so "is the engine busy" says no in the
 * gaps. The runs live here and outlive the views that started them, so this
 * is the one place that knows. Settings asks before it offers to throw the
 * engine's data away (A1-04).
 */
export function runsInProgress(): number {
  let going = 0
  for (const run of runs.values()) if (run.snapshot.state === 'running') going += 1
  for (const run of exports.values()) if (run.snapshot.state === 'running') going += 1
  return going
}

/** Every known run's changes, fanned into one listener. */
export function subscribeToRuns(listener: () => void): () => void {
  const offs = [...runs.values(), ...exports.values()].map((run) => run.subscribe(() => listener()))
  return () => {
    for (const off of offs) off()
  }
}

/**
 * The diagnostics of every map drawn this session, as each project's own
 * panel copies them: one block per project whose run holds a report, in the
 * order the projects were first opened. A run that has not drawn a map, or
 * whose last attempt failed, has none. The name comes from the caller,
 * because a run knows its project only by id; an id nobody can name is
 * used as it is. "Copy diagnostics" in Settings sends these (A6-03).
 */
export function reportsInSession(nameOf: (projectId: string) => string | undefined): string[] {
  const reports: string[] = []
  for (const [projectId, run] of runs) {
    const { report } = run.snapshot
    if (report !== null) reports.push(copyText(nameOf(projectId) ?? projectId, report))
  }
  return reports
}

/**
 * The session's jobs, running first and then the finished ones newest
 * first, at most twenty of those; each named by the caller, because a run
 * knows its project only by id (specs/024-jobs, FR-002).
 */
export const jobs: JobRegistry['jobs'] = (nameOf) => registry.jobs(nameOf)

/** Hear every change to any job, including runs made after this was called. */
export const subscribeToJobs: JobRegistry['subscribe'] = (listener) => registry.subscribe(listener)

/** How many jobs are running: layout runs, rebuilds, exports and a feed add. */
export const runningCount: JobRegistry['runningCount'] = () => registry.runningCount()

/** Cancel a running job through its own run's `cancel()`, as its own screen does. */
export const cancelJob: JobRegistry['cancel'] = (jobId) => registry.cancel(jobId)

/**
 * Drop the finished jobs of every project not in a list read from the
 * store, for jobs that ended before the read began: the project was
 * deleted, so its jobs go with it (US4.2).
 */
export const forgetJobsOutside: JobRegistry['forgetOutside'] = (ids, before) =>
  registry.forgetOutside(ids, before)
