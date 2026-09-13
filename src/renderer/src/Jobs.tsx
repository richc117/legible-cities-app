import { useEffect, useRef, useState, type JSX } from 'react'
import { composeJobLog, describeJobState, jobSubject, type Job } from '../../shared/jobs'
import Icon from './icons/Icon'
import Button from './kit/Button'
import ProgressLine from './ProgressLine'

// The jobs the inspector lists (A1-03, specs/024-jobs): each one the run's
// own stages on the progress line, its last sentence, Cancel while it runs,
// and when it failed the engine's hint in full with its detail behind a
// disclosure; "Copy log" on every one. A second view of the runs, never a
// second place they live: every value here is the run's, read through the
// registry, and Cancel is the run's own `cancel()`.

/** What the job says after "Copy log", either way. */
export const LOG_COPIED =
  'The log is on the clipboard, with the keys in web addresses taken out and your home folder written as ~.'
export const logNotCopied = (why: string): string => `The log could not be copied: ${why}.`

const sentenceOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * "Copy log", as a function that can be called without rendering: the page
 * composes the job's text and the main process redacts it and writes the
 * clipboard. A refusal is a sentence, never a thrown error in a handler.
 */
export async function copyLog(job: Job, copy: (text: string) => Promise<void>): Promise<string> {
  try {
    await copy(composeJobLog(job))
    return LOG_COPIED
  } catch (error) {
    return logNotCopied(sentenceOf(error))
  }
}

/** One sentence for a job's whole line, for a screen reader. */
export function describeJob(job: Job): string {
  if (job.state === 'running') {
    const current = job.stages.find((s) => s.state === 'running')
    return current === undefined ? `${job.label} is running.` : `Running ${current.label}.`
  }
  return `${job.label} ${describeJobState(job.state)}.`
}

/** The time a job started, in the reader's own locale. */
const startedAt = (ms: number): string => new Date(ms).toLocaleTimeString()

interface ItemProps {
  job: Job
  onCancel: (jobId: string) => void
  /**
   * Copy the job's log and answer the sentence to show. By id, so the copy
   * reads the job as it is at the press: log lines arrive between renders.
   */
  onCopy: (jobId: string) => Promise<string>
}

export function JobItem({ job, onCancel, onCopy }: ItemProps): JSX.Element {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const copying = useRef(false)
  // Whether focus is on Cancel. The button goes when the job stops, and
  // Chromium drops the focus of an element it removes, so the job's heading
  // takes it instead, as the theme switch hands its focus on (A4-03).
  const cancelFocused = useRef(false)
  const running = job.state === 'running'

  useEffect(() => {
    if (running || !cancelFocused.current) return
    cancelFocused.current = false
    headingRef.current?.focus()
  }, [running])

  const titleId = `${job.id}-title`
  const detailShown = job.state === 'failed' && job.detail !== null && job.detail !== job.hint

  return (
    <li className="job" aria-labelledby={titleId} data-state={job.state}>
      <h3 id={titleId} className="job-title" tabIndex={-1} ref={headingRef}>
        <span className="job-subject">{jobSubject(job)}</span>{' '}
        <span className="job-label">{job.label}</span>
      </h3>
      <p className="job-meta">
        {describeJobState(job.state)}, started {startedAt(job.started)}
      </p>
      <div className="job-line">
        <ProgressLine stages={job.stages} ariaLabel={describeJob(job)} />
      </div>
      {job.message !== null && job.state !== 'failed' && (
        <p className="progress-message">{job.message}</p>
      )}
      {job.state === 'failed' && job.hint !== null && <p className="message error">{job.hint}</p>}
      {detailShown && (
        <details className="job-detail">
          <summary>Details</summary>
          <p>{job.detail}</p>
        </details>
      )}
      <div className="toolbar">
        {running && (
          <span
            onFocusCapture={() => {
              cancelFocused.current = true
            }}
            onBlurCapture={() => {
              cancelFocused.current = false
            }}
          >
            <Button
              aria-label={`Cancel: ${job.label}, ${jobSubject(job)}`}
              onClick={() => {
                // The heading first: the button is about to go.
                headingRef.current?.focus()
                cancelFocused.current = false
                onCancel(job.id)
              }}
            >
              <Icon name="close" />
              Cancel
            </Button>
          </span>
        )}
        <Button
          aria-label={`Copy log: ${job.label}, ${jobSubject(job)}`}
          onClick={() => {
            if (copying.current) return
            copying.current = true
            setCopied(null)
            void onCopy(job.id)
              .then(setCopied)
              .finally(() => {
                copying.current = false
              })
          }}
        >
          Copy log
        </Button>
      </div>
      <p className="message" role="status" aria-live="polite">
        {copied}
      </p>
    </li>
  )
}

interface ListProps {
  jobs: Job[]
  onCancel: (jobId: string) => void
  onCopy: (jobId: string) => Promise<string>
}

/** The session's jobs, running first, then finished newest first; or a sentence saying there are none. */
export default function JobsList({ jobs, onCancel, onCopy }: ListProps): JSX.Element {
  if (jobs.length === 0) return <p className="hint">There are no jobs this session.</p>
  return (
    <ul className="jobs">
      {jobs.map((job) => (
        <JobItem key={job.id} job={job} onCancel={onCancel} onCopy={onCopy} />
      ))}
    </ul>
  )
}
