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

import { OFFERED_PRESETS, type ExportProgress } from '../../../shared/export'
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
  const run = new ExportRun(sharedExportBridge(), OFFERED_PRESETS[0])
  exports.set(projectId, run)
  return run
}
