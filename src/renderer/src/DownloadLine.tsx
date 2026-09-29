import type { JSX } from 'react'
import { downloading, type LayoutRun } from './engine/layoutRun'
import ProgressLine, { type StageState } from './ProgressLine'
import { useSnapshot } from './useSnapshot'

// The feed's download, in cell 01 (issue 178). A preset's zip is fetched
// inside the layout run the first time the layout needs it, and engine
// v0.10.0 reports it as stage "download" (E36). The run keeps it apart from
// its own stages; this draws it where it belongs, with the feed: one
// station, the engine's count of the bytes beside it, and - when the engine
// refused the feed - the engine's own sentence, here rather than in a
// dialog or in cell 02, whose layout never began.
//
// Nothing at all when the run has no download: a feed already on disk, a
// run past its download, or no run.

/** Cell 02's sentence while its layout waits on the download here. */
export const WAITING_FOR_FEED = 'Waiting for the feed to download (cell 01).'

/** Cell 02's sentence when the run ended at the download and laid nothing out. */
export const NOT_LAID_OUT = 'Nothing was laid out: the feed did not download. Cell 01 says why.'

/** This line's sentence after a cancel during the download. */
export const DOWNLOAD_CANCELLED = 'The download was cancelled, and nothing of it was kept.'

export default function DownloadLine({ run }: { run: LayoutRun }): JSX.Element | null {
  const { state, download, error } = useSnapshot(run)
  if (download === null) return null
  const going = downloading({ download })
  const station: StageState =
    state === 'failed'
      ? 'failed'
      : state === 'cancelled'
        ? 'pending'
        : state === 'running' && going
          ? 'running'
          : 'done'
  const described =
    state === 'failed'
      ? 'The feed did not download.'
      : state === 'cancelled'
        ? DOWNLOAD_CANCELLED
        : going
          ? `Downloading the feed: ${download.message}`
          : 'The feed has downloaded.'
  return (
    <section className="download-run" aria-label="Download">
      <ProgressLine
        stages={[{ id: 'download', label: 'download', state: station }]}
        ariaLabel={described}
      />
      <div className="layout-run-foot">
        <p className="progress-message" role="status" aria-live="polite">
          {state === 'cancelled' ? DOWNLOAD_CANCELLED : download.message}
        </p>
      </div>
      {state === 'failed' && error !== null && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
