import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { endSentence, newlyEnded, type Job } from '../../shared/jobs'
import type { SettingsView } from '../../shared/settings'
import EngineStatus from './EngineStatus'
import {
  cancelJob,
  forgetJobsOutside,
  jobs as listJobs,
  runningCount,
  subscribeToJobs,
} from './engine/runs'
import Icon from './icons/Icon'
import Inspector, { INSPECTOR_ID, toggleName } from './Inspector'
import { copyLog, logNotCopied } from './Jobs'
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
  // The projects' names, for the jobs: a run knows its project only by id.
  const [names, setNames] = useState<ReadonlyMap<string, string>>(() => new Map())
  const namesRef = useRef<ReadonlyMap<string, string>>(names)
  const [jobList, setJobList] = useState<Job[]>(() => listJobs())
  const [running, setRunning] = useState(() => runningCount())
  const [announcement, setAnnouncement] = useState('')
  const seen = useRef<ReadonlySet<string>>(new Set())
  const reading = useRef<Promise<void> | null>(null)

  // The names are read from the store only when they are needed: when the
  // inspector opens, and when a job ends or is listed for a project whose
  // name is not known yet. Not on every screen change or every run: a read
  // of the records while one is being renamed into place is exactly the
  // kind of overlap the Windows runner punishes, and the screens already
  // read what they show. A read that fails costs the names, not the list.
  // A project the store no longer lists was deleted, and its finished jobs
  // go with it (US4.2).
  const readNames = useCallback((): Promise<void> => {
    if (reading.current !== null) return reading.current
    const before = Date.now()
    const read = window.api.projects.list().then(
      (list) => {
        const next = new Map(list.map((p) => [p.id, p.name] as const))
        namesRef.current = next
        setNames(next)
        forgetJobsOutside(new Set(next.keys()), before)
      },
      () => undefined,
    )
    reading.current = read.finally(() => {
      reading.current = null
    })
    return reading.current
  }, [])

  const unnamed = (list: readonly Job[]): boolean =>
    list.some((job) => job.projectId !== null && !namesRef.current.has(job.projectId))

  // Every change to any run, including runs made after this subscribed.
  useEffect(() => {
    const named = (): Job[] => listJobs((id) => namesRef.current.get(id))
    const refresh = (): void => {
      const list = named()
      setJobList(list)
      setRunning(runningCount())
      const { ended, seen: next } = newlyEnded(list, seen.current)
      seen.current = next
      if (ended.length === 0) return
      const ids = new Set(ended.map((job) => job.id))
      const announce = (): void => {
        const now = named().filter((job) => ids.has(job.id))
        setAnnouncement((now.length > 0 ? now : ended).map(endSentence).join(' '))
      }
      if (unnamed(ended)) void readNames().then(announce)
      else announce()
    }
    refresh()
    return subscribeToJobs(refresh)
  }, [readNames])
  useEffect(() => {
    setJobList(listJobs((id) => names.get(id)))
  }, [names])
  // While the inspector is open, a project it cannot name yet is asked for
  // once: the effect runs again only when the set of unnamed projects moves.
  const unnamedIds = inspectorOpen
    ? [
        ...new Set(
          jobList
            .map((job) => job.projectId)
            .filter((id): id is string => id !== null && !names.has(id)),
        ),
      ].join(' ')
    : ''
  useEffect(() => {
    if (unnamedIds !== '') void readNames()
  }, [unnamedIds, readNames])

  const openInspector = (): void => {
    setInspectorOpen(true)
    void readNames()
  }
  const closeInspector = (): void => {
    setInspectorOpen(false)
    toggleRef.current?.focus()
  }
  // The job as it is at the press, not as it was at the last render: log
  // lines arrive between renders.
  const copyJob = async (jobId: string): Promise<string> => {
    const job = listJobs((id) => namesRef.current.get(id)).find((j) => j.id === jobId)
    if (job === undefined) return logNotCopied('that job is no longer listed')
    return copyLog(job, (text) => window.api.jobs.copyLog(text))
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
      {/* One polite line for the ends of jobs, on every screen, never shown. */}
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
      <div className="app-body" data-inspector={inspectorOpen ? 'open' : 'closed'}>
        <div className="app-main">
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
        {inspectorOpen && (
          <Inspector
            jobs={jobList}
            onClose={closeInspector}
            onCancel={cancelJob}
            onCopy={copyJob}
          />
        )}
      </div>
    </>
  )
}
