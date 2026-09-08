// One run per project, for as long as the app is open, and one client for
// the whole renderer.
//
// Both are here rather than in a component because a run outlives the view
// that started it: a person can start a layout, go back to the Library, and
// come back to a project that is still running. A run held in a component
// would be a second run for the same project, writing the same output
// folder, and a client made per view would leave its two bridge
// subscriptions behind every time (each is an `ipcRenderer.on`).
//
// This module reaches for `window.api`, so it is imported only by the
// renderer. The run itself takes its client as an argument and knows
// nothing of any of this, which is what lets the tests drive it.

import { LayoutRun } from './layoutRun'
import { EngineClient } from './client'

let client: EngineClient | null = null

const engineClient = (): EngineClient => {
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
    today,
  })
  runs.set(projectId, run)
  return run
}

/** Forget a project's run: it was deleted, so nothing will ask again. */
export function forgetLayoutRun(projectId: string): void {
  runs.delete(projectId)
}
