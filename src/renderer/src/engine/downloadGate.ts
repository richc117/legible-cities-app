import type { RunSnapshot } from './layoutRun'

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
 * under way (`wait`), behind it (`go`), or ended with the feed not on disk
 * (`stop`).
 *
 * A running run is past its download once the layout's first stage is done,
 * and not before, whatever the bytes say.
 */
export function downloadPhase(run: RunSnapshot, starting: boolean): 'wait' | 'go' | 'stop' {
  const firstDone = run.stages[0]?.state === 'done'
  switch (run.state) {
    case 'idle':
      return starting ? 'wait' : 'go'
    case 'running':
      // Only the layout's first stage says the download is over and kept:
      // the last byte is not enough, because the engine checks the zip after
      // it and may still refuse it, and a download of unknown size reports
      // a fraction of 0 to its end. Going sooner would let the inspection
      // fetch the feed itself, where no cancel reaches.
      return firstDone ? 'go' : 'wait'
    case 'done':
      return 'go'
    case 'cancelled':
    case 'failed':
      // Whether the feed arrived is the registry's answer at the ending,
      // not how far the bytes had come: a refusal comes after the last byte.
      // Unknown (the registry did not answer) stops as well: going would let
      // the inspection download the feed where no cancel reaches.
      return run.feedMissing === false ? 'go' : 'stop'
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
