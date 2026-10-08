// Cell 01's inspection, held behind a sample's download (issue 178,
// `src/renderer/src/engine/downloadGate.ts`).

import { describe, expect, it } from 'vitest'
import {
  NOT_DOWNLOADED,
  afterRunDownload,
  downloadPhase,
  type WatchedRun,
} from '../../src/renderer/src/engine/downloadGate'
import { freshStages, type RunSnapshot } from '../../src/renderer/src/engine/layoutRun'

const snapshot = (patch: Partial<RunSnapshot> = {}): RunSnapshot => ({
  state: 'idle',
  stages: freshStages(),
  message: null,
  error: null,
  changed: false,
  relaid: false,
  forced: false,
  replaced: false,
  rebuilt: false,
  recoloured: false,
  reordered: false,
  restyled: false,
  day: null,
  report: null,
  download: null,
  feedMissing: false,
  ...patch,
})

const midway = { message: 'downloaded 65,536 of 1,732,403 bytes', fraction: 0.04 }
const whole = { message: 'downloaded 1,732,403 of 1,732,403 bytes', fraction: 1 }
const firstDone = (): RunSnapshot['stages'] => {
  const stages = freshStages()
  stages[0] = { ...stages[0], state: 'done' }
  return stages
}

describe('where a run stands with its download', () => {
  it('waits for a run still to start, and not for one that will not', () => {
    expect(downloadPhase(snapshot(), true)).toBe('wait')
    expect(downloadPhase(snapshot(), false)).toBe('go')
  })

  it('waits while the bytes come or before anything has reported, and goes after', () => {
    expect(downloadPhase(snapshot({ state: 'running' }), false)).toBe('wait')
    expect(downloadPhase(snapshot({ state: 'running', download: midway }), false)).toBe('wait')
    // The last byte is not the end: the engine checks the zip after it.
    expect(downloadPhase(snapshot({ state: 'running', download: whole }), false)).toBe('wait')
    expect(downloadPhase(snapshot({ state: 'running', stages: firstDone() }), false)).toBe('go')
    expect(downloadPhase(snapshot({ state: 'done', stages: firstDone() }), false)).toBe('go')
  })

  it('stops for a run that ended with its feed not on disk, however far the bytes had come', () => {
    // The registry's answer, not the fraction: a refusal comes after the
    // last byte, and a failure can come before the first.
    expect(
      downloadPhase(snapshot({ state: 'failed', download: whole, feedMissing: true }), false),
    ).toBe('stop')
    expect(downloadPhase(snapshot({ state: 'failed', feedMissing: true }), false)).toBe('stop')
    expect(
      downloadPhase(snapshot({ state: 'cancelled', download: midway, feedMissing: true }), false),
    ).toBe('stop')
    // Not known (the registry did not answer): stop, since going could
    // download the feed where no cancel reaches.
    expect(downloadPhase(snapshot({ state: 'cancelled', feedMissing: null }), false)).toBe('stop')
    // A zip that was kept, whatever the fraction said: the inspection goes.
    expect(downloadPhase(snapshot({ state: 'cancelled', download: midway }), false)).toBe('go')
    expect(downloadPhase(snapshot({ state: 'cancelled', stages: firstDone() }), false)).toBe('go')
  })
})

/** A run whose snapshot the test moves, telling its listeners as the real one does. */
function watched(initial: RunSnapshot): WatchedRun & { move(patch: Partial<RunSnapshot>): void } {
  let current = initial
  const listeners = new Set<(s: RunSnapshot) => void>()
  return {
    get snapshot() {
      return current
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    move(patch) {
      current = { ...current, ...patch }
      for (const listener of listeners) listener(current)
    },
  }
}

const settled = async (promise: Promise<void>): Promise<string> => {
  let said = 'pending'
  promise.then(
    () => (said = 'resolved'),
    (error: Error) => (said = error.message),
  )
  await new Promise((done) => setTimeout(done, 0))
  return said
}

describe('holding the inspection', () => {
  it('goes at once when the feed is on disk, whatever the run is doing', async () => {
    const run = watched(snapshot({ state: 'running' }))
    expect(await settled(afterRunDownload(run, () => false, Promise.resolve(true)))).toBe(
      'resolved',
    )
  })

  it('waits through the download and goes when the layout is past it', async () => {
    const run = watched(snapshot())
    let starting = true
    const gate = afterRunDownload(run, () => starting, Promise.resolve(false), 5)
    expect(await settled(gate)).toBe('pending')
    starting = false
    run.move({ state: 'running' })
    run.move({ download: midway })
    expect(await settled(gate)).toBe('pending')
    run.move({ download: null, stages: firstDone() })
    expect(await settled(gate)).toBe('resolved')
  })

  it('does not start after a run cancelled at its download, so nothing downloads behind it', async () => {
    const run = watched(snapshot({ state: 'running', download: midway }))
    const gate = afterRunDownload(run, () => false, Promise.resolve(false), 5)
    run.move({ state: 'cancelled', feedMissing: true })
    expect(await settled(gate)).toBe(NOT_DOWNLOADED)
  })

  it('notices a start given up on, which the run itself does not report', async () => {
    const run = watched(snapshot())
    let starting = true
    const gate = afterRunDownload(run, () => starting, Promise.resolve(false), 5)
    starting = false
    await new Promise((done) => setTimeout(done, 20))
    expect(await settled(gate)).toBe('resolved')
  })
})
