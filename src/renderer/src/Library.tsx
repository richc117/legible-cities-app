import { useEffect, useRef, useState, type JSX } from 'react'
import type { CreateProjectInput, ProjectSummary } from '../../shared/api'
import CreateProjectDialog from './CreateProjectDialog'
import Icon from './icons/Icon'
import Button from './kit/Button'

type LibraryState = { status: 'loading' } | { status: 'ready'; projects: ProjectSummary[] }

interface Props {
  /** A sentence carried over from the project view, such as what a delete could not remove. */
  notice: string | null
  onOpen: (id: string) => void
}

// list() never rejects by contract (an unreadable record is skipped and
// logged on the main side); if the bridge itself is unavailable an empty
// Library is the only thing there is to show.
async function listProjects(): Promise<ProjectSummary[]> {
  try {
    return await window.api.projects.list()
  } catch {
    return []
  }
}

export default function Library({ notice, onOpen }: Props): JSX.Element {
  const [library, setLibrary] = useState<LibraryState>({ status: 'loading' })
  const [creating, setCreating] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    let cancelled = false
    void listProjects().then((projects) => {
      if (!cancelled) setLibrary({ status: 'ready', projects })
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Focus the heading when the screen appears, so a screen reader says
  // where the person is; on the way back from a project the element that
  // had focus no longer exists.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  // A rejection propagates to the dialog, which shows the message.
  const create = async (input: CreateProjectInput): Promise<void> => {
    await window.api.projects.create(input)
    setCreating(false)
    setLibrary({ status: 'ready', projects: await listProjects() })
  }

  return (
    <main className="panel library" aria-labelledby="library-heading">
      <h1 id="library-heading" tabIndex={-1} ref={headingRef}>
        Library
      </h1>
      <div className="toolbar">
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Icon name="add" />
          New project
        </Button>
      </div>
      {notice && (
        <p role="alert" className="notice">
          {notice}
        </p>
      )}
      {library.status === 'ready' && library.projects.length === 0 && (
        <div className="empty">
          <Icon name="mark" size={24} />
          <p role="status" className="prose">
            No projects yet. Create one to begin.
          </p>
        </div>
      )}
      {library.status === 'ready' && library.projects.length > 0 && (
        <ul className="entries" aria-label="Projects">
          {library.projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                className="entry"
                aria-label={`Open ${project.name}`}
                aria-describedby={`entry-${project.id}-meta`}
                onClick={() => onOpen(project.id)}
              >
                <span className="entry-name">{project.name}</span>
                <span className="entry-meta" id={`entry-${project.id}-meta`}>
                  <span>Feed {project.feed}</span>
                  <span>Service day {project.date ?? 'not yet chosen'}</span>
                  {project.readOnly && <span>read-only</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <CreateProjectDialog open={creating} onCreate={create} onCancel={() => setCreating(false)} />
    </main>
  )
}
