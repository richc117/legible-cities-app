import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { cancelJob, jobs, readProjectNames, subscribeToJobs, unnamedProjects } from './engine/runs'
import Icon from './icons/Icon'
import JobsList, { copyLog, logNotCopied } from './Jobs'
import Button from './kit/Button'

// The window's right-hand inspector (A1-03, ADR-036). It belongs to the
// window, not to a project, because jobs span projects: it sits beside
// whichever screen is open, 320px wide, and below 900px it covers the main
// region instead of squeezing it. Its first and, for now, only content is
// the session's jobs. It is rendered only while open, and the job list is
// its own state, so a run's progress re-renders this and nothing beside it.
// App owns the toggle and hands focus back to it on close.

export const INSPECTOR_ID = 'inspector'

/**
 * The narrow window, where the inspector covers the main region: the width
 * of the media query in app.css, which cannot read a token either.
 */
export const NARROW_QUERY = '(max-width: 56.25rem)'

/** The header toggle's accessible name: what it opens, and how many jobs are running. */
export function toggleName(running: number): string {
  return running === 0 ? 'Jobs, none running' : `Jobs, ${running} running`
}

interface Props {
  onClose: () => void
}

export default function Inspector({ onClose }: Props): JSX.Element {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [list, setList] = useState(() => jobs())

  // Opening moves focus to the heading, so a screen reader says where the
  // person is and the keyboard starts at the top of the list.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  useEffect(() => {
    setList(jobs())
    return subscribeToJobs(() => setList(jobs()))
  }, [])

  // A job for a project it cannot name yet asks the store once; the effect
  // runs again only when the set of unnamed projects moves.
  const unnamed = unnamedProjects(list).join(' ')
  useEffect(() => {
    if (unnamed !== '') void readProjectNames()
  }, [unnamed])

  // Escape closes it from anywhere inside, which is what a person expects
  // of a panel that covers the screen on a narrow window. A disclosure
  // inside takes no Escape of its own, so nothing else is lost.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    onClose()
  }

  // The job as it is at the press, not as it was at the last render: log
  // lines arrive between renders.
  const copy = async (jobId: string): Promise<string> => {
    const job = jobs().find((j) => j.id === jobId)
    if (job === undefined) return logNotCopied('that job is no longer listed')
    return copyLog(job, (text) => window.api.jobs.copyLog(text))
  }

  return (
    <aside id={INSPECTOR_ID} className="inspector" aria-label="Inspector" onKeyDown={onKeyDown}>
      <div className="inspector-head">
        <h2 id="jobs-heading" tabIndex={-1} ref={headingRef}>
          Jobs
        </h2>
        <Button aria-label="Close the inspector" onClick={onClose}>
          <Icon name="close" />
          Close
        </Button>
      </div>
      <section aria-labelledby="jobs-heading">
        <JobsList jobs={list} onCancel={cancelJob} onCopy={copy} />
      </section>
    </aside>
  )
}
