import { useLayoutEffect, useRef, useState, type JSX } from 'react'
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

/**
 * A live region's writer that says a sentence even when it is the one it
 * said last: the region is emptied now and filled on the next frame, so a
 * second "Layout run, finished." or a retry's failure changes the DOM and
 * is spoken. Sentences arriving before that frame are said together.
 */
export function createAnnouncer(
  write: (text: string) => void,
  nextFrame: (then: () => void) => unknown,
): (sentence: string) => void {
  let queued: string[] = []
  return (sentence) => {
    queued.push(sentence)
    if (queued.length > 1) return
    write('')
    nextFrame(() => {
      const text = queued.join(' ')
      queued = []
      write(text)
    })
  }
}

/** Where focus stands after the list has rendered, for the job it was handed to. */
export type FocusPlace = 'lost' | 'in-job' | 'elsewhere'

/**
 * What the list does for a job focus was handed to (Cancel pressed, or
 * Cancel holding focus): put focus on the job's heading when it was lost -
 * Chromium drops focus to the body when the item holding it is moved or its
 * button removed, which is what a cancelled job going below the running ones
 * does - and keep watching while the job still runs and focus is still in
 * it. A person who has moved focus elsewhere is left alone.
 */
export function handOff(place: FocusPlace, running: boolean): { focus: boolean; keep: boolean } {
  if (place === 'elsewhere') return { focus: false, keep: false }
  return { focus: place === 'lost', keep: running }
}

/** The time a job started, in the reader's own locale. */
const startedAt = (ms: number): string => new Date(ms).toLocaleTimeString()

interface ItemProps {
  job: Job
  onCancel: (jobId: string) => void
  /** Focus is on this job's Cancel: if it is lost, the list gives it to the job's heading. */
  onCancelFocus: (jobId: string) => void
  /**
   * Copy the job's log and answer the sentence to show. By id, so the copy
   * reads the job as it is at the press: log lines arrive between renders.
   */
  onCopy: (jobId: string) => Promise<string>
}

export function JobItem({ job, onCancel, onCancelFocus, onCopy }: ItemProps): JSX.Element {
  const [copied, setCopied] = useState<string | null>(null)
  const copying = useRef(false)
  const running = job.state === 'running'

  const titleId = `${job.id}-title`
  const detailShown = job.state === 'failed' && job.detail !== null && job.detail !== job.hint

  return (
    <li className="job" aria-labelledby={titleId} data-state={job.state}>
      <h3 id={titleId} className="job-title" tabIndex={-1}>
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
          <span onFocusCapture={() => onCancelFocus(job.id)}>
            <Button
              aria-label={`Cancel: ${job.label}, ${jobSubject(job)}`}
              onClick={() => onCancel(job.id)}
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

const headingOf = (jobId: string): HTMLElement | null => document.getElementById(`${jobId}-title`)

/** The session's jobs, running first, then finished newest first; or a sentence saying there are none. */
export default function JobsList({ jobs, onCancel, onCopy }: ListProps): JSX.Element {
  // The job focus was handed to, kept at the list because the list is what
  // moves an item: a job that stops goes below the running ones, and the
  // move takes the focus with it before any item could keep it.
  const handedTo = useRef<string | null>(null)

  useLayoutEffect(() => {
    const jobId = handedTo.current
    if (jobId === null) return
    const job = jobs.find((j) => j.id === jobId)
    const heading = headingOf(jobId)
    if (job === undefined || heading === null) {
      handedTo.current = null
      return
    }
    const active = document.activeElement
    const place: FocusPlace =
      active === null || active === document.body
        ? 'lost'
        : heading.closest('li')?.contains(active) === true
          ? 'in-job'
          : 'elsewhere'
    const next = handOff(place, job.state === 'running')
    if (next.focus) heading.focus()
    if (!next.keep) handedTo.current = null
  })

  const cancel = (jobId: string): void => {
    // The heading first: the button is about to go, and the item to move.
    handedTo.current = jobId
    headingOf(jobId)?.focus()
    onCancel(jobId)
  }

  if (jobs.length === 0) return <p className="hint">There are no jobs this session.</p>
  return (
    <ul className="jobs">
      {jobs.map((job) => (
        <JobItem
          key={job.id}
          job={job}
          onCancel={cancel}
          onCancelFocus={(jobId) => {
            handedTo.current = jobId
          }}
          onCopy={onCopy}
        />
      ))}
    </ul>
  )
}
