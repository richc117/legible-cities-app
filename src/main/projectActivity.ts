// What is going on for each project right now, as main knows it: the engine
// requests in flight that name a project, and its export if one is running.
// Until spec 037 (issue 491) these rules were held only by the interface's
// disabled buttons; `Exporter.start` and `ProjectStore.delete` now ask here,
// so a button that was somehow pressed anyway is refused with a sentence and
// nothing on disk changes.
//
// **A request names a project when it writes the project's `out` folder**,
// and the folder is named for the project's id: `map.build` with `out` set.
// That is the only allowlisted method whose params address a project.
// `graph.build`, `render.stage` and the feed methods carry a feed's key and
// a layout's id, which many projects share, so none of them can say which
// project it is for; a layout run's long `graph.build` is therefore still
// held by the screen alone, and the `map.build` that ends the run is held
// here for as long as it writes.
//
// A mark is set before the request is let through and cleared in `finally`,
// so a request that fails, is refused or is cancelled clears it as one that
// finishes does. `begin*` hands back the function that clears it, which is
// safe to call twice.

import {
  DELETE_WHILE_DRAWING,
  DELETE_WHILE_EXPORTING,
  EXPORT_WHILE_DRAWING,
} from '../shared/activity'

/** The project an engine request is for, or null when its params name none. */
export function projectNamedBy(
  method: string,
  params: Record<string, unknown> | undefined,
): string | null {
  if (method !== 'map.build') return null
  const out = params?.out
  return typeof out === 'string' && out !== '' ? out : null
}

export class ProjectActivity {
  readonly #requests = new Map<string, number>()
  readonly #exports = new Map<string, number>()

  /** A request naming the project is in flight; call the answer when it ends. */
  beginRequest(projectId: string): () => void {
    return this.#begin(this.#requests, projectId)
  }

  /** The project's export is running; call the answer when it ends. */
  beginExport(projectId: string): () => void {
    return this.#begin(this.#exports, projectId)
  }

  /** Why an export of the project may not start, or null. */
  exportRefusal(projectId: string): string | null {
    return this.#requests.has(projectId) ? EXPORT_WHILE_DRAWING : null
  }

  /** Why the project may not be deleted, or null. */
  deleteRefusal(projectId: string): string | null {
    if (this.#exports.has(projectId)) return DELETE_WHILE_EXPORTING
    if (this.#requests.has(projectId)) return DELETE_WHILE_DRAWING
    return null
  }

  #begin(marks: Map<string, number>, projectId: string): () => void {
    marks.set(projectId, (marks.get(projectId) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const left = (marks.get(projectId) ?? 1) - 1
      if (left <= 0) marks.delete(projectId)
      else marks.set(projectId, left)
    }
  }
}
