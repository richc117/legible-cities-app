import { useState, type JSX } from 'react'
import EngineStatus from './EngineStatus'
import Icon from './icons/Icon'
import Library from './Library'
import MismatchDialog from './MismatchDialog'
import ProjectView from './ProjectView'
import { useEngineState } from './useEngineState'

// Two screens and no URL to preserve, so navigation is local state rather
// than a router. The Library is unmounted while a project is open and lists
// afresh when it mounts again, so a rename or a delete shows on return. A
// delete that could not remove everything hands the Library one sentence
// to show, since the view that found out is gone by then. The header, the
// mark and the engine's status line sit above both screens; a version
// mismatch is said once more, in a dialog, the first time it is seen.
type Screen = { screen: 'library'; notice: string | null } | { screen: 'project'; id: string }

export default function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>({ screen: 'library', notice: null })
  const engine = useEngineState()
  const [mismatchSeen, setMismatchSeen] = useState(false)

  return (
    <>
      <header className="app-header">
        <span className="brand">
          <Icon name="mark" />
          Legible Cities
        </span>
        <EngineStatus state={engine} />
      </header>
      {engine?.state === 'mismatched' && (
        <MismatchDialog
          open={!mismatchSeen}
          expected={engine.expected}
          found={engine.found}
          onClose={() => setMismatchSeen(true)}
        />
      )}
      {screen.screen === 'project' ? (
        <ProjectView
          id={screen.id}
          onBack={(notice) => setScreen({ screen: 'library', notice: notice ?? null })}
        />
      ) : (
        <Library notice={screen.notice} onOpen={(id) => setScreen({ screen: 'project', id })} />
      )}
    </>
  )
}
