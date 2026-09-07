import { useState, type JSX } from 'react'
import Library from './Library'
import ProjectView from './ProjectView'

// Two screens and no URL to preserve, so navigation is local state rather
// than a router. The Library is unmounted while a project is open and lists
// afresh when it mounts again, so a rename or a delete shows on return. A
// delete that could not remove everything hands the Library one sentence
// to show, since the view that found out is gone by then.
type Screen = { screen: 'library'; notice: string | null } | { screen: 'project'; id: string }

export default function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>({ screen: 'library', notice: null })

  if (screen.screen === 'project') {
    return (
      <ProjectView
        id={screen.id}
        onBack={(notice) => setScreen({ screen: 'library', notice: notice ?? null })}
      />
    )
  }
  return <Library notice={screen.notice} onOpen={(id) => setScreen({ screen: 'project', id })} />
}
