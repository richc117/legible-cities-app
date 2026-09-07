import { useEffect, useState, type JSX } from 'react'
import type { ProjectSummary } from '../../shared/api'

type LibraryState = { status: 'loading' } | { status: 'ready'; projects: ProjectSummary[] }

export default function App(): JSX.Element {
  const [library, setLibrary] = useState<LibraryState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    window.api.library
      .list()
      .then((projects) => {
        if (!cancelled) setLibrary({ status: 'ready', projects })
      })
      .catch(() => {
        if (!cancelled) setLibrary({ status: 'ready', projects: [] })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="library" aria-labelledby="library-heading">
      <h1 id="library-heading">Library</h1>
      {library.status === 'ready' && library.projects.length === 0 && (
        <p role="status">
          No projects yet. The first feed and the first project arrive with a later release.
        </p>
      )}
      {library.status === 'ready' && library.projects.length > 0 && (
        <ul>
          {library.projects.map((project) => (
            <li key={project.id}>{project.name}</li>
          ))}
        </ul>
      )}
    </main>
  )
}
