// The page's part in the question a quit or a close asks first (issue 552,
// specs/039-quit-guard), without the dialog: which layouts it tells main it
// is running, when it tells it, and which runs "Close anyway" stops.
//
// Main cannot see a layout. One is four steps the page drives - the graph,
// the service day, the map, the record's write - with nothing in flight
// between them, so the page reports its running layouts whenever they
// change, and main keeps the last report; it is never asked at the moment of
// a quit. An export needs no report: it runs in the main process.
//
// Pure functions and one subscription handed in, so a test drives them with
// stub jobs and no `window`.

import type { Job } from '../../shared/jobs'
import type { RunningLayout } from '../../shared/quit'

/**
 * The layouts running among these jobs, oldest first: the project and when
 * the run started. A layout run only - the run of cell 02, Run all's layout,
 * a sample city's card with its download - never a redraw, which is a moment
 * and loses nothing, and never a feed's download by itself.
 */
export function runningLayouts(jobs: readonly Job[]): RunningLayout[] {
  const layouts = new Map<string, RunningLayout>()
  for (const job of jobs) {
    if (job.kind !== 'layout' || job.state !== 'running' || job.projectId === null) continue
    // A project has one layout run; were there ever two jobs, the older is the run.
    const known = layouts.get(job.projectId)
    if (known === undefined || job.started < known.started)
      layouts.set(job.projectId, { project: job.projectId, started: job.started })
  }
  return [...layouts.values()].sort(
    (a, b) => a.started - b.started || a.project.localeCompare(b.project),
  )
}

/** What the reporter needs: the jobs, their changes, and the bridge's call. */
export interface LayoutReportDeps {
  jobs: () => readonly Job[]
  /** Hear every change to any job (`subscribeToJobs`). */
  subscribe: (listener: () => void) => () => void
  /** `window.api.app.reportLayouts`. */
  report: (layouts: RunningLayout[]) => Promise<void>
}

/**
 * Tell main which layouts are running: once now, so a page that has just
 * loaded says it runs none, and again whenever the list changes. A run's
 * progress changes its job many times a second and the list not at all, so
 * a list equal to the one last sent is not sent again. A report main did not
 * take is sent again at the next change. Returns the way to stop.
 */
export function reportRunningLayouts(deps: LayoutReportDeps): () => void {
  let sent: string | null = null
  const push = (): void => {
    const layouts = runningLayouts(deps.jobs())
    const key = JSON.stringify(layouts)
    if (key === sent) return
    sent = key
    deps.report(layouts).catch(() => {
      if (sent === key) sent = null
    })
  }
  push()
  return deps.subscribe(push)
}

/**
 * The jobs "Close anyway" stops, by id: every export and every layout still
 * running, which are the runs the question counts. Each is stopped through
 * its own run's cancel, the path its own Cancel takes.
 */
export function runsToStop(jobs: readonly Job[]): string[] {
  return jobs
    .filter((job) => job.state === 'running' && (job.kind === 'layout' || job.kind === 'export'))
    .map((job) => job.id)
}
