// The page's part in the quit's question, without the dialog (issue 552,
// specs/039-quit-guard, FR-003): which layouts it reports to main, that the
// report is pushed when the list changes and not otherwise, and which runs
// "Close anyway" stops (`src/renderer/src/quitRuns.ts`). Driven with stub
// jobs and no `window`. Each test was watched failing under its mutation in
// `quit-runs.mutations.json`.

import { describe, expect, it } from 'vitest'
import { reportRunningLayouts, runningLayouts, runsToStop } from '../../src/renderer/src/quitRuns'
import type { Job } from '../../src/shared/jobs'
import type { RunningLayout } from '../../src/shared/quit'

let made = 0
const job = (over: Partial<Job> = {}): Job => ({
  id: `job-${++made}`,
  kind: 'layout',
  projectId: 'paris0000001',
  projectName: null,
  label: 'Layout run',
  state: 'running',
  stages: [],
  message: null,
  hint: null,
  detail: null,
  log: [],
  dropped: 0,
  started: 1_000,
  ended: null,
  rawDetail: null,
  ...over,
})

describe('the layouts the page reports', () => {
  it('lists a running layout by its project and when it started', () => {
    expect(runningLayouts([job()])).toEqual([{ project: 'paris0000001', started: 1_000 }])
  })

  it('lists layout runs only: not a redraw, an export or a feed being added', () => {
    expect(
      runningLayouts([
        job({ kind: 'rebuild' }),
        job({ kind: 'export' }),
        job({ kind: 'feed-add', projectId: null }),
      ]),
    ).toEqual([])
  })

  it('lists none that has ended, however it ended', () => {
    const ended = (['done', 'failed', 'cancelled'] as const).map((state) =>
      job({ state, ended: 2_000 }),
    )
    expect(runningLayouts(ended)).toEqual([])
  })

  it('lists them oldest first, each project once', () => {
    expect(
      runningLayouts([
        job({ projectId: 'lyon00000001', started: 3_000 }),
        job({ projectId: 'paris0000001', started: 2_000 }),
        job({ projectId: 'paris0000001', started: 1_000 }),
      ]),
    ).toEqual([
      { project: 'paris0000001', started: 1_000 },
      { project: 'lyon00000001', started: 3_000 },
    ])
  })
})

describe('the report to main', () => {
  /** A registry a test moves, and what main was told. */
  function session(answer: () => Promise<void> = async () => undefined) {
    const state = { jobs: [] as Job[] }
    const listeners = new Set<() => void>()
    const reports: RunningLayout[][] = []
    const stop = reportRunningLayouts({
      jobs: () => state.jobs,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      report: (layouts) => {
        reports.push(layouts)
        return answer()
      },
    })
    const move = (jobs: Job[]): void => {
      state.jobs = jobs
      for (const listener of listeners) listener()
    }
    return { reports, move, stop, listeners }
  }

  it('says at once that it runs none, so a page just loaded is heard', () => {
    expect(session().reports).toEqual([[]])
  })

  it('reports a layout as it starts and again as it ends', () => {
    const { reports, move } = session()
    const run = job()
    move([run])
    move([{ ...run, state: 'done', ended: 2_000 }])
    expect(reports).toEqual([[], [{ project: 'paris0000001', started: 1_000 }], []])
  })

  it('does not report again while the list stays the same, whatever else a job says', () => {
    const { reports, move } = session()
    const run = job()
    move([run])
    // A run's progress changes its job many times a second.
    move([{ ...run, message: 'Laying out.' }])
    move([{ ...run, message: 'Still laying out.', log: ['a line'] }])
    // And a redraw of another project is not a layout.
    move([run, job({ kind: 'rebuild', projectId: 'lyon00000001' })])
    expect(reports).toHaveLength(2)
  })

  it('sends a report main did not take again at the next change', async () => {
    let refuse = true
    const { reports, move } = session(() =>
      refuse ? Promise.reject(new Error('forbidden')) : Promise.resolve(),
    )
    await Promise.resolve()
    refuse = false
    // The list is as it was when the report was refused: sent again.
    move([])
    expect(reports).toEqual([[], []])
    await Promise.resolve()
    move([])
    expect(reports, 'and once taken, not again').toEqual([[], []])
  })

  it('stops hearing the jobs when it is stopped', () => {
    const { reports, move, stop, listeners } = session()
    stop()
    expect(listeners.size).toBe(0)
    move([job()])
    expect(reports).toEqual([[]])
  })
})

describe('what Close anyway stops', () => {
  it('stops every export and layout still running, and nothing else', () => {
    const layout = job()
    const exporting = job({ kind: 'export', projectId: 'lyon00000001' })
    expect(
      runsToStop([
        layout,
        exporting,
        job({ kind: 'rebuild' }),
        job({ kind: 'feed-add', projectId: null }),
        job({ kind: 'export', state: 'done', ended: 2_000 }),
        job({ state: 'cancelled', ended: 2_000 }),
      ]),
    ).toEqual([layout.id, exporting.id])
  })
})
