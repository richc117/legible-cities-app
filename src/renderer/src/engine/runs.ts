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
 * Running jobs are derived from the runs every time they are asked for and
 * are never dropped. Finished jobs are copies: each run holds only its
 * latest attempt, so the moment a run's job reaches a final state the
 * registry keeps a copy beside the runs, newest first, at most
 * `MAX_FINISHED`, and tells whoever listens for ends. The projects' names
 * are copies too, kept here because a run knows its project only by id;
 * the screens that learn a name - the list read, a rename - hand it in.
 * Nothing is written anywhere; a relaunch starts empty.
 *
 * It takes no `window`, so a test drives it with stub runs.
 */
export class JobRegistry {
  readonly #sources = new Map<JobSource, () => void>()
  readonly #listeners = new Set<() => void>()
  readonly #endListeners = new Set<(job: Job) => void>()
  #finished: Job[] = []
  /** Every job ever copied into the list, so one pushed out or forgotten never comes back. */
  readonly #recorded = new Set<string>()
  readonly #names = new Map<string, string>()
  /**
   * A clock for names, moved by every rename and every forgetting, so a
   * list read can tell whether it is older than what it would overwrite.
   */
  #tick = 0
  /** When each project was last named or forgotten by its own screen. */
  readonly #namedAt = new Map<string, number>()
  /** When every project was last forgotten at once, by a reset. */
  #clearedAt = 0
  #reading: Promise<void> | null = null
  #queued: Promise<void> | null = null

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
    let ended: Job | null = null
    if (job !== null && job.state !== 'running' && !this.#recorded.has(job.id)) {
      this.#recorded.add(job.id)
      this.#finished = keepFinished(this.#finished, job)
      ended = job
    }
    this.#notify()
    if (ended !== null) {
      const named = this.#named(ended)
      for (const listener of this.#endListeners) listener(named)
    }
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }

  #named(job: Job): Job {
    return job.projectId === null
      ? job
      : { ...job, projectName: this.#names.get(job.projectId) ?? null }
  }

  /** Running first, newest first; then the finished, newest first; each named if a name is known. */
  jobs(): Job[] {
    const running: Job[] = []
    for (const source of this.#sources.keys()) {
      const job = source.job()
      if (job !== null && job.state === 'running') running.push(job)
    }
    return orderJobs([...running, ...this.#finished]).map((job) => this.#named(job))
  }

  runningCount(): number {
    let going = 0
    for (const source of this.#sources.keys()) if (source.job()?.state === 'running') going += 1
    return going
  }

  /** Hear every change to any tracked run, to the list, and to a name. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Hear each job once, named, at the moment it ends. */
  onEnded(listener: (job: Job) => void): () => void {
    this.#endListeners.add(listener)
    return () => {
      this.#endListeners.delete(listener)
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

  /** Whether a project's name is known. */
  hasName(projectId: string): boolean {
    return this.#names.has(projectId)
  }

  /** Every project's name, as given. Nothing is forgotten by it. */
  setNames(names: Iterable<readonly [string, string]>): void {
    let moved = false
    for (const [id, name] of names) {
      if (this.#names.get(id) === name) continue
      this.#names.set(id, name)
      moved = true
    }
    if (moved) this.#notify()
  }

  /** A project's screen renamed it: the new name, which no read begun earlier may overwrite. */
  rename(projectId: string, name: string): void {
    this.#tick += 1
    this.#namedAt.set(projectId, this.#tick)
    this.setNames([[projectId, name]])
  }

  /**
   * Read the names from a list, one read at a time. A read asked for while
   * one is out is queued once behind it, so a project created during the
   * first read is named by the second; however many ask meanwhile, one more
   * read is made. A read applies nothing for a project renamed or forgotten
   * after it began, and nothing at all if a reset came after it began:
   * its list may be older than what it would overwrite.
   */
  readNames(list: () => Promise<readonly { id: string; name: string }[]>): Promise<void> {
    if (this.#reading === null) {
      const began = this.#tick
      this.#reading = list()
        .then(
          (projects) => {
            if (began < this.#clearedAt) return
            this.setNames(
              projects
                .filter((p) => (this.#namedAt.get(p.id) ?? 0) <= began)
                .map((p) => [p.id, p.name] as const),
            )
          },
          () => undefined,
        )
        .finally(() => {
          this.#reading = null
        })
      return this.#reading
    }
    this.#queued ??= this.#reading.then(() => {
      this.#queued = null
      return this.readNames(list)
    })
    return this.#queued
  }

  /**
   * A project was deleted: its finished jobs and its name go. A running
   * one cannot exist, since a project cannot be deleted while it runs. Only
   * on that positive signal: a list read can miss a record it could not read
   * at that moment, and must not make a live project's jobs vanish.
   */
  forgetProject(projectId: string): void {
    this.#tick += 1
    this.#namedAt.set(projectId, this.#tick)
    const before = this.#finished.length
    this.#finished = this.#finished.filter((job) => job.projectId !== projectId)
    const hadName = this.#names.delete(projectId)
    if (this.#finished.length !== before || hadName) this.#notify()
  }
  /**
   * The engine's data was reset: every project is gone, so every project's
   * finished jobs and every name go. A feed add is no project's and stays;
   * a running job cannot exist, since a reset refuses while one runs.
   */
  forgetAllProjects(): void {
    this.#tick += 1
    this.#clearedAt = this.#tick
    this.#namedAt.clear()
    this.#names.clear()
    this.#finished = this.#finished.filter((job) => job.projectId === null)
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

/** The session's jobs, running first and then the finished ones newest first, at most twenty of those (FR-002). */
export const jobs = (): Job[] => registry.jobs()

/** Hear every change to any job or name, including runs made after this was called. */
export const subscribeToJobs: JobRegistry['subscribe'] = (listener) => registry.subscribe(listener)

/** Hear each job once, at the moment it ends. */
export const onJobEnded: JobRegistry['onEnded'] = (listener) => registry.onEnded(listener)

/** How many jobs are running: layout runs, rebuilds, exports and a feed add. */
export const runningCount: JobRegistry['runningCount'] = () => registry.runningCount()

/** Cancel a running job through its own run's `cancel()`, as its own screen does. */
export const cancelJob: JobRegistry['cancel'] = (jobId) => registry.cancel(jobId)

/** A project was deleted: its finished jobs and its name go (US4.2). */
export const forgetProjectJobs: JobRegistry['forgetProject'] = (projectId) =>
  registry.forgetProject(projectId)

/** A project was renamed: the jobs say its new name from now on. */
export const nameProject = (projectId: string, name: string): void =>
  registry.rename(projectId, name)

/** The engine's data was reset: every project's jobs and name go. */
export const forgetAllProjectJobs = (): void => registry.forgetAllProjects()

/** The projects among these jobs whose names are not known yet. */
export const unnamedProjects = (list: readonly Job[]): string[] => [
  ...new Set(
    list
      .map((job) => job.projectId)
      .filter((id): id is string => id !== null && !registry.hasName(id)),
  ),
]

/**
 * Read the projects' names from the store. Asked only when a name is
 * needed - the inspector opening, or a job ending or listed for a project
 * it cannot name - so a person working on one screen causes no extra
 * reads. A read that fails costs the names, not the jobs; a read that
 * misses a project forgets nothing.
 */
export const readProjectNames = (): Promise<void> =>
  registry.readNames(() => window.api.projects.list())
