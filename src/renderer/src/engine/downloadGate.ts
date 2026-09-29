import { downloading, type RunSnapshot } from './layoutRun'

// Cell 01's inspection, held behind a sample's download (issue 178).
//
// A sample city opens with its layout already starting (A5.6-03), and cell
// 01 asks the engine to inspect the same feed at the same moment. The engine
// downloads a feed once, for whichever request reaches it first, and the
// other waits (engine v0.10.0, `feeds.fetch`'s lock). Left to race, the
// inspection could win: the bytes would then report to a request nobody
// draws, and a cancel of the layout - the only cancel a person has - would
// not stop the download, which would be kept. So for a sample whose feed is
// not on disk, the inspection waits until the layout's run is past its
// download, and does not start at all when that run ended at it.

/** What the gate reads of a layout run. */
export interface WatchedRun {
  readonly snapshot: RunSnapshot
  subscribe(listener: (snapshot: RunSnapshot) => void): () => void
}

/** Why the inspection did not start: the feed never arrived. */
export const NOT_DOWNLOADED = 'The feed was not downloaded, so there is nothing in it to read yet.'

/**
 * Where a run stands with respect to its feed's download: still to come or
 * under way (`wait`), behind it (`go`), or ended at it (`stop`).
 *
 * A run that has reported neither a download nor a stage of its own may be
 * about to download, so it is waited for; one whose first stage is done, or
 * whose download reached its last byte, is past it.
 */
export function downloadPhase(run: RunSnapshot, starting: boolean): 'wait' | 'go' | 'stop' {
  const firstDone = run.stages[0]?.state === 'done'
  switch (run.state) {
    case 'idle':
      return starting ? 'wait' : 'go'
    case 'running':
      if (downloading(run)) return 'wait'
      return run.download === null && !firstDone ? 'wait' : 'go'
    case 'done':
      return 'go'
    case 'cancelled':
    case 'failed':
      return downloading(run) || (run.download === null && !firstDone) ? 'stop' : 'go'
  }
}

/**
 * Resolves once the run is past its feed's download; rejects with
 * `NOT_DOWNLOADED` when it ended at it. A feed already on disk goes at once.
 * `starting` says whether the run is still to be started for this screen,
 * which the run itself cannot know; it is asked again on a short timer as
 * well as on every change of the run, because that answer changes without
 * the run changing.
 */
export function afterRunDownload(
  run: WatchedRun,
  starting: () => boolean,
  cached: Promise<boolean>,
  every = 250,
): Promise<void> {
  return cached.then((onDisk) => {
    if (onDisk) return
    return new Promise<void>((resolve, reject) => {
      // Filled in once the first look has not settled it.
      const watching: { off: () => void; timer: ReturnType<typeof setInterval> | null } = {
        off: () => undefined,
        timer: null,
      }
      const settle = (): boolean => {
        const phase = downloadPhase(run.snapshot, starting())
        if (phase === 'wait') return false
        watching.off()
        if (watching.timer !== null) clearInterval(watching.timer)
        if (phase === 'go') resolve()
        else reject(new Error(NOT_DOWNLOADED))
        return true
      }
      if (settle()) return
      watching.off = run.subscribe(() => settle())
      watching.timer = setInterval(() => settle(), every)
    })
  })
}
