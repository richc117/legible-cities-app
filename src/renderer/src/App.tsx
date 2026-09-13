import { useCallback, useEffect, useState, type JSX } from 'react'
import type { SettingsView } from '../../shared/settings'
import EngineStatus from './EngineStatus'
import Icon from './icons/Icon'
import Button from './kit/Button'
import Library from './Library'
import MismatchDialog from './MismatchDialog'
import ProjectView from './ProjectView'
import Settings from './Settings'
import { applyTheme } from './theme'
import { useEngineState } from './useEngineState'

// Three screens and no URL to preserve, so navigation is local state rather
// than a router. The Library is unmounted while a project or Settings is
// open and lists afresh when it mounts again, so a rename, a delete or a
// reset shows on return. A delete that could not remove everything hands
// the Library one sentence to show, since the view that found out is gone
// by then. The header, the mark, the engine's status line and the way into
// Settings sit above all three; a version mismatch is said once more, in a
// dialog, the first time it is seen.
type Screen =
  | { screen: 'library'; notice: string | null }
  | { screen: 'project'; id: string }
  | { screen: 'settings' }

export default function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>({ screen: 'library', notice: null })
  const engine = useEngineState()
  const [mismatchSeen, setMismatchSeen] = useState(false)
  // The app's own settings, read once. The main process is the only writer,
  // so every change comes back from it as a whole view rather than being
  // edited here (specs/019-settings).
  const [settings, setSettings] = useState<SettingsView | null>(null)

  const readSettings = useCallback((): void => {
    window.api.settings.read().then(
      (view) => setSettings(view),
      () => setSettings(null),
    )
  }, [])

  useEffect(readSettings, [readSettings])

  // The theme the person chose, over the system's preference the page
  // started with. Idempotent, so a re-render costs nothing.
  const theme = settings?.theme
  useEffect(() => {
    if (theme !== undefined) applyTheme(theme)
  }, [theme])

  return (
    <>
      <header className="app-header">
        <span className="brand">
          <Icon name="mark" />
          Legible Cities
        </span>
        <EngineStatus state={engine} />
        <Button
          aria-label="Settings"
          disabled={screen.screen === 'settings'}
          onClick={() => {
            if (settings === null) readSettings()
            setScreen({ screen: 'settings' })
          }}
        >
          <Icon name="settings" />
          Settings
        </Button>
      </header>
      {engine?.state === 'mismatched' && (
        <MismatchDialog
          open={!mismatchSeen}
          expected={engine.expected}
          found={engine.found}
          onClose={() => setMismatchSeen(true)}
        />
      )}
      {screen.screen === 'settings' ? (
        settings === null ? (
          // The bridge answered nothing. Say so, and offer the one way out
          // besides leaving: ask again.
          <main className="panel" aria-labelledby="settings-heading">
            <h1 id="settings-heading">Settings</h1>
            <p role="status">The settings could not be read.</p>
            <div className="toolbar">
              <Button onClick={readSettings}>Try again</Button>
              <Button onClick={() => setScreen({ screen: 'library', notice: null })}>
                <Icon name="back" />
                Back to Library
              </Button>
            </div>
          </main>
        ) : (
          <Settings
            settings={settings}
            onChanged={setSettings}
            engine={engine}
            onBack={() => setScreen({ screen: 'library', notice: null })}
          />
        )
      ) : screen.screen === 'project' ? (
        <ProjectView
          id={screen.id}
          onBack={(notice) => setScreen({ screen: 'library', notice: notice ?? null })}
        />
      ) : (
        <Library
          notice={screen.screen === 'library' ? screen.notice : null}
          onOpen={(id) => setScreen({ screen: 'project', id })}
        />
      )}
    </>
  )
}
