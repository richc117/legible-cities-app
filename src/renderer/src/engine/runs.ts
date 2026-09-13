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
import { copyText } from './diagnostics'
import { ExportRun, type ExportBridge } from './exportRun'
import { FeedAdd } from './feedAdd'
import { LayoutRun } from './layoutRun'
import { EngineClient } from './client'

let client: EngineClient | null = null

export const engineClient = (): EngineClient => {
  client ??= new EngineClient(window.api.engine)
  return client
}

const runs = new Map<string, LayoutRun>()

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
  return run
}

/** Forget a project's run: it was deleted, so nothing will ask again. */
export function forgetLayoutRun(projectId: string): void {
  runs.delete(projectId)
}

let adder: FeedAdd | null = null

/** The one feed add at a time, over the shared client. */
export function feedAdd(): FeedAdd {
  adder ??= new FeedAdd(engineClient())
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
