import { useEffect, useRef, type JSX, type KeyboardEvent } from 'react'
import type { Job } from '../../shared/jobs'
import Icon from './icons/Icon'
import JobsList from './Jobs'
import Button from './kit/Button'

// The window's right-hand inspector (A1-03, ADR-036). It belongs to the
// window, not to a project, because jobs span projects: it sits beside
// whichever screen is open, 320px wide, and below 900px it covers the main
// region instead of squeezing it. Its first and, for now, only content is
// the session's jobs. It is rendered only while open; App owns the toggle
// and hands focus back to it on close.

export const INSPECTOR_ID = 'inspector'

/** The header toggle's accessible name: what it opens, and how many jobs are running. */
export function toggleName(running: number): string {
  return running === 0 ? 'Jobs, none running' : `Jobs, ${running} running`
}

interface Props {
  jobs: Job[]
  onClose: () => void
  onCancel: (jobId: string) => void
  onCopy: (jobId: string) => Promise<string>
}

export default function Inspector({ jobs, onClose, onCancel, onCopy }: Props): JSX.Element {
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Opening moves focus to the heading, so a screen reader says where the
  // person is and the keyboard starts at the top of the list.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  // Escape closes it from anywhere inside, which is what a person expects
  // of a panel that covers the screen on a narrow window. A disclosure
  // inside takes no Escape of its own, so nothing else is lost.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    onClose()
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
        <JobsList jobs={jobs} onCancel={onCancel} onCopy={onCopy} />
      </section>
    </aside>
  )
}
