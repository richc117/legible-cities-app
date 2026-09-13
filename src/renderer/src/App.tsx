import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { needsTelling } from '../../shared/first-run'
import { endSentence } from '../../shared/jobs'
import type { SettingsView } from '../../shared/settings'
import EngineStatus from './EngineStatus'
import FirstRunDialog, { useFirstRun } from './FirstRunDialog'
import {
  jobs,
  onJobEnded,
  readProjectNames,
  reportsInSession,
  runningCount,
  subscribeToJobs,
  unnamedProjects,
} from './engine/runs'
import Icon from './icons/Icon'
import Inspector, { INSPECTOR_ID, NARROW_QUERY, toggleName } from './Inspector'
import { createAnnouncer } from './Jobs'
import Button from './kit/Button'
import Library from './Library'
import MismatchDialog from './MismatchDialog'
import ProjectView from './ProjectView'
import Settings, { copyDiagnostics } from './Settings'
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
//
// Beside all three sits the inspector (A1-03, ADR-036): the window's, not a
// project's, because the jobs it lists span projects. It starts collapsed;
// its toggle in the header carries the running count, and a job that ends
// is announced once, politely, whether it is open or not.
type Screen =
  | { screen: 'library'; notice: string | null }
  | { screen: 'project'; id: string }
  | { screen: 'settings' }

export default function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>({ screen: 'library', notice: null })
  const engine = useEngineState()
  const [mismatchSeen, setMismatchSeen] = useState(false)
  // The first-run check of the bundled tools (A6-02): a failure is said once
  // per start, and never over the mismatch dialog - it waits for that one.
  const firstRun = useFirstRun()
  const [firstRunSeen, setFirstRunSeen] = useState(false)
  // Unknown counts as possibly mismatched: the check only finishes after the
  // engine's first start has settled, but the page may hear of the one
  // before the other.
  const mismatchFirst = engine === null || (engine.state === 'mismatched' && !mismatchSeen)
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

  const [inspectorOpen, setInspectorOpen] = useState(false)
  const toggleRef = useRef<HTMLElement>(null)
  // Only what the header and the announcement need lives here: the running
  // count and the sentence. The list itself is the inspector's own state,
  // mounted only while it is open, so a run's progress re-renders the
  // inspector and never the screen beside it. Setting the same count again
  // is a render React skips.
  const [running, setRunning] = useState(() => runningCount())
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => {
    // Cleared and then set a frame later, so the same sentence twice - a
    // second "Layout run, finished.", a retry after a failure - is said twice.
    const announce = createAnnouncer(setAnnouncement, (then) =>
      requestAnimationFrame(() => requestAnimationFrame(then)),
    )
    const offChanges = subscribeToJobs(() => setRunning(runningCount()))
    const offEnds = onJobEnded((job) => {
      if (unnamedProjects([job]).length === 0) return announce(endSentence(job))
      // A project not named yet: read the names, then say it with the name.
      void readProjectNames().then(() =>
        announce(endSentence(jobs().find((j) => j.id === job.id) ?? job)),
      )
    })
    setRunning(runningCount())
    return () => {
      offChanges()
      offEnds()
    }
  }, [])

  // Below 900px the inspector covers the main region; what it covers is
  // made inert, so Shift+Tab cannot reach controls a person cannot see. The
  // header stays reachable, and its toggle closes the inspector.
  const narrow = useMediaQuery(NARROW_QUERY)

  const openInspector = (): void => setInspectorOpen(true)
  const closeInspector = (): void => {
    setInspectorOpen(false)
    toggleRef.current?.focus()
  }

  return (
    <>
      <header className="app-header">
        <span className="brand">
          <Icon name="mark" />
          Legible Cities
        </span>
        <EngineStatus state={engine} />
        <Button
          ref={toggleRef}
          aria-label={toggleName(running)}
          aria-expanded={inspectorOpen}
          aria-controls={INSPECTOR_ID}
          onClick={() => (inspectorOpen ? closeInspector() : openInspector())}
        >
          <Icon name="layers" />
          Jobs
          {running > 0 && <span className="job-count">{running} running</span>}
        </Button>
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
      {firstRun !== null && needsTelling(firstRun) && (
        <FirstRunDialog
          open={!firstRunSeen && !mismatchFirst}
          result={firstRun}
          onCopyDiagnostics={() =>
            copyDiagnostics({
              listProjects: () => window.api.projects.list(),
              reports: reportsInSession,
              copy: (reports) => window.api.settings.copyDiagnostics(reports),
            })
          }
          onClose={() => setFirstRunSeen(true)}
        />
      )}
      {/* One polite line for the ends of jobs, on every screen, never shown. */}
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
      <div className="app-body" data-inspector={inspectorOpen ? 'open' : 'closed'}>
        <div className="app-main" inert={inspectorOpen && narrow}>
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
        </div>
        {inspectorOpen && <Inspector onClose={closeInspector} />}
      </div>
    </>
  )
}

/** Whether a media query matches, kept current as the window changes. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const update = (): void => setMatches(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])
  return matches
}
