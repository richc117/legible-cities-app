// @vitest-environment jsdom
// The front door's cards follow their projects' runs (A5.6-04; issue 433,
// part c): a run that changes state is heard, a run that stops has written
// its record so the list is read again, and a progress tick that moves no
// state reads nothing. Drawn into the document with the session's runs
// replaced by stand-ins: `peekLayoutRun` answers them and `subscribeToRuns`
// hears the ones that exist when it is called, as the real one does.

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { summarise } from '../../src/main/record/helpers'
import Library from '../../src/renderer/src/Library'
import type { ProjectSummary } from '../../src/shared/api'
import { answered, BASE, cleanup, renderPanel } from '../support/render'
import { snap, StandInRun } from '../support/stand-in-run'

/** The session's layout runs, by project. */
const session = vi.hoisted(() => ({ runs: new Map<string, unknown>() }))

vi.mock('../../src/renderer/src/engine/runs', async (original) => ({
  ...(await original<typeof import('../../src/renderer/src/engine/runs')>()),
  peekLayoutRun: (id: string) => session.runs.get(id) ?? null,
  subscribeToRuns: (listener: () => void) => {
    const offs = [...session.runs.values()].map((run) =>
      (run as StandInRun).subscribe(() => listener()),
    )
    return () => {
      for (const off of offs) off()
    }
  },
}))

afterEach(() => {
  cleanup()
  session.runs.clear()
})

describe('the front door’s cards and their runs', () => {
  it('read the list again when a run stops, heard from a run made after the screen', async () => {
    // Mutations (`front-door-runs.mutations.json`): the subscription a
    // no-op - nothing is heard; and made once, not for each list - the run
    // made after the first subscription is never heard.
    let answer!: (projects: ProjectSummary[]) => void
    const list = vi
      .fn<() => Promise<ProjectSummary[]>>()
      .mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
      .mockImplementation(async () => [summarise(BASE, false)])
    renderPanel(<Library notice={null} onOpen={() => undefined} />, {
      api: { projects: { list } },
    })
    // The run is the session's from now: after the screen first subscribed.
    const run = new StandInRun()
    run.moveQuietly(snap('running'))
    session.runs.set(BASE.id, run)
    answer([summarise(BASE, false)])
    await answered()
    expect(list).toHaveBeenCalledTimes(1)

    act(() => run.move({ ...snap('running'), message: 'Downloading.' }))
    await answered()
    expect(list, 'a tick that moves no state reads nothing').toHaveBeenCalledTimes(1)

    act(() => run.move(snap('done')))
    await answered()
    expect(list, 'a run that stopped has written its record').toHaveBeenCalledTimes(2)
  })
})
