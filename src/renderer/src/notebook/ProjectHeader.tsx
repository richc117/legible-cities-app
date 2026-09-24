import type { JSX } from 'react'
import Icon from '../icons/Icon'
import Button from '../kit/Button'
import { useProject } from './context'

// The project's own header, above the notebook (ADR-045).
//
// What the project screen carried at its top, moved: the project's name as
// the screen's heading, the way back to the Library, a failed read's
// sentence and the notice a read-only project shows. The `role="status"`
// line saying what the notebook is doing as a whole, and Run all, are
// A5.5-19's; nothing is added here.
//
// It is not the app's own header, which is the window's and knows no
// project (A1-03, ADR-036).

export default function ProjectHeader(): JSX.Element {
  const { project, error, headingRef, onBack } = useProject()
  return (
    <>
      <h1 id="project-heading" tabIndex={-1} ref={headingRef}>
        {project?.name ?? 'Project'}
      </h1>
      <div className="toolbar">
        <Button onClick={() => onBack()}>
          <Icon name="back" />
          Back to Library
        </Button>
      </div>
      {error !== null && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {project?.readOnly === true && (
        <p role="status">
          This project was made by a newer version of the app and is read-only here. It can still be
          deleted.
        </p>
      )}
    </>
  )
}
