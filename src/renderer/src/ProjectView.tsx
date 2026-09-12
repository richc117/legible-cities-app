import { useCallback, useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
import type { DeleteResult, ProjectRecord } from '../../shared/api'
import { shortLayoutId } from '../../shared/layout'
import { validateName, type Theme } from '../../shared/project'
import ConfirmDialog from './ConfirmDialog'
import DiagnosticsView from './Diagnostics'
import { engineClient, exportRunFor, layoutRunFor } from './engine/runs'
import { feedRecordFor, inspectionFor } from './engine/inspections'
import { stageFor } from './engine/stages'
import StageView from './StageView'
import Inspect from './Inspect'
import ExportRunView from './ExportRun'
import Viewer from './Viewer'
import Icon from './icons/Icon'
import Button from './kit/Button'
import LayoutRunView from './LayoutRun'
import LineColours from './LineColours'
import LineOrderPanel from './LineOrder'
import ThemeSwitch from './ThemeSwitch'
import ServiceDay from './ServiceDay'
import TextInput, { type TextInputHandle } from './kit/TextInput'
import { useEngineState } from './useEngineState'
import { useSnapshot } from './useSnapshot'

type Project = ProjectRecord & { readOnly: boolean }
type ViewState =
  | { status: 'loading' }
  | { status: 'ready'; project: Project }
  | { status: 'error'; message: string }

interface Props {
  id: string
  /** Back to the Library, with an optional sentence for it to show. */
  onBack: (notice?: string) => void
}

const FOLDER_WORDS: Record<DeleteResult['failed'][number]['folder'], string> = {
  project: "The project's folder",
  output: "The project's output folder",
}

// What a delete left behind, for the person: folders by role, never by
// path (the reasons come from the main side, which keeps paths out too).
function describeFailures(failed: DeleteResult['failed']): string | undefined {
  if (failed.length === 0) return undefined
  return failed
    .map(({ folder, reason }) => `${FOLDER_WORDS[folder]} could not be removed: ${reason}`)
    .join(' ')
}

// The record's times are ISO 8601 in UTC; a person reads them in their
// own locale, with the exact value kept on the element.
function Time({ iso }: { iso: string }): JSX.Element {
  const date = new Date(iso)
  return <time dateTime={iso}>{Number.isNaN(date.getTime()) ? iso : date.toLocaleString()}</time>
}

export default function ProjectView({ id, onBack }: Props): JSX.Element {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const [renameMessage, setRenameMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // How many runs have drawn the page while this view is open. The viewer
  // is keyed by it, so the frame loads the page a run just wrote instead of
  // keeping the one it had: its address does not change between the two.
  const [drawn, setDrawn] = useState(0)
  const engine = useEngineState()
  const headingRef = useRef<HTMLHeadingElement>(null)

  // One run per project, made once. It reads the record and the engine's
  // state through refs when it starts, so writing the record at the end of a
  // run does not rebuild the run and discard the outcome it just produced.

  // The runs belong to the project, not to this view: a person can start a
  // layout or an export, go back to the Library and come back to one still
  // running. Neither may start while the other runs: a layout rewrites the
  // page an export is reading, and an export reads a page a layout would
  // replace under it.
  const run = layoutRunFor(id)
  const exporter = exportRunFor(id)
  const layingOut = useSnapshot(run).state === 'running'
  const exporting = useSnapshot(exporter).state === 'running'

  // When a run finishes it has written the record; read it back so the
  // screen shows the layout and the day it just stored.
  useEffect(() => {
    let previous = run.snapshot.state
    return run.subscribe((snapshot) => {
      if (snapshot.state === 'done' && previous !== 'done') {
        window.api.projects.get(id).then(
          (project) => {
            setState({ status: 'ready', project })
            setDrawn((n) => n + 1)
          },
          () => undefined,
        )
      }
      previous = snapshot.state
    })
  }, [id, run])
  const renameButtonRef = useRef<HTMLElement>(null)
  const newNameRef = useRef<TextInputHandle>(null)

  useEffect(() => {
    let cancelled = false
    window.api.projects.get(id).then(
      (project) => {
        if (!cancelled) setState({ status: 'ready', project })
      },
      (error: unknown) => {
        if (cancelled) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      },
    )
    return () => {
      cancelled = true
    }
  }, [id])

  // Focus the heading once there is something to read, so a screen reader
  // says which project opened.
  useEffect(() => {
    if (state.status !== 'loading') headingRef.current?.focus()
  }, [state.status])

  const project = state.status === 'ready' ? state.project : null

  const openRename = (): void => {
    if (!project) return
    setNewName(project.name)
    setRenameMessage(null)
    setRenaming(true)
  }

  // The form's own controls disappear with it, so focus goes back to the
  // button that revealed it.
  const closeRename = (): void => {
    setRenaming(false)
    renameButtonRef.current?.focus()
  }

  const saveRename = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!project) return
    const trimmed = newName.trim()
    const invalid = validateName(trimmed)
    if (invalid) {
      setRenameMessage(invalid)
      newNameRef.current?.focus()
      return
    }
    if (trimmed === project.name) return closeRename()
    setSaving(true)
    try {
      const record = await window.api.projects.rename(id, trimmed)
      setState({ status: 'ready', project: { ...project, ...record } })
      closeRename()
    } catch (error) {
      setRenameMessage(error instanceof Error ? error.message : String(error))
      newNameRef.current?.focus()
    } finally {
      setSaving(false)
    }
  }

  // The two inputs chosen with the feed in view: the record comes back
  // written, and the run reads it when it next starts.
  const setInputs = async (inputs: { mode: string; agency: string | null }): Promise<void> => {
    const record = await window.api.projects.setInputs(id, inputs)
    setState((current) =>
      current.status === 'ready'
        ? { status: 'ready', project: { ...current.project, ...record } }
        : current,
    )
  }
  // The theme is written at once and nothing is rebuilt for it: the page
  // takes it on its address and restyles itself, so the record coming back
  // is all the viewer needs to reload in it (A4-03).
  const setTheme = async (theme: Theme): Promise<void> => {
    const record = await window.api.projects.setTheme(id, theme)
    setState((current) =>
      current.status === 'ready'
        ? { status: 'ready', project: { ...current.project, ...record } }
        : current,
    )
  }
  const today = (): string => {
    const now = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  }
  const inspect = useCallback((key: string) => inspectionFor(engineClient(), key, today()), [])
  const readStage = useCallback(
    (
      key: string,
      layout: string,
      made: string | null,
      stage: 'gtfs2graph' | 'topo' | 'loom' | 'octi',
      width: number,
    ) => stageFor(engineClient(), key, layout, made, stage, width),
    [],
  )
  const [registry, setRegistry] = useState<{ mode: string; agency: string | null } | null>(null)
  const feedKey = project?.feed ?? null
  const ready = engine?.state === 'ready'
  useEffect(() => {
    if (feedKey === null || !ready) return
    let left = false
    feedRecordFor(engineClient(), feedKey).then(
      (record) => {
        if (!left)
          setRegistry(record === null ? null : { mode: record.mode, agency: record.agency })
      },
      () => undefined,
    )
    return () => {
      left = true
    }
  }, [feedKey, ready])

  // A rejection stays in the confirm dialog; a result goes back to the
  // Library, with a sentence if some folder remained.
  const remove = async (): Promise<void> => {
    const result = await window.api.projects.delete(id)
    onBack(describeFailures(result.failed))
  }

  return (
    <main className="panel project" aria-labelledby="project-heading">
      <h1 id="project-heading" tabIndex={-1} ref={headingRef}>
        {project?.name ?? 'Project'}
      </h1>
      <div className="toolbar">
        <Button onClick={() => onBack()}>
          <Icon name="back" />
          Back to Library
        </Button>
      </div>
      {state.status === 'error' && (
        <p role="alert" className="notice">
          {state.message}
        </p>
      )}
      {project?.readOnly && (
        <p role="status">
          This project was made by a newer version of the app and is read-only here. It can still be
          deleted.
        </p>
      )}
      {project && (
        <>
          <dl className="fields">
            <dt>Feed</dt>
            <dd>{project.feed}</dd>
            <dt>Mode</dt>
            <dd>{project.mode}</dd>
            <dt>Agency</dt>
            <dd>{project.agency ?? 'none'}</dd>
            <dt>Service day</dt>
            <dd>{project.date ?? 'not yet chosen'}</dd>
            <dt>Layout</dt>
            <dd>
              {project.layout === null ? (
                'not laid out yet'
              ) : project.made === null ? (
                shortLayoutId(project.layout)
              ) : (
                <>
                  {shortLayoutId(project.layout)}, made <Time iso={project.made} />
                </>
              )}
            </dd>
            <dt>Theme</dt>
            <dd>{project.theme}</dd>
            <dt>Created</dt>
            <dd>
              <Time iso={project.created} />
            </dd>
            <dt>Modified</dt>
            <dd>
              <Time iso={project.modified} />
            </dd>
          </dl>
          {!project.readOnly && (
            <Inspect
              project={project}
              engine={engine}
              inspect={inspect}
              onInputs={setInputs}
              registry={registry}
              disabled={layingOut || exporting}
            />
          )}
          {!project.readOnly && (
            <LayoutRunView run={run} project={project} engine={engine} disabled={exporting} />
          )}
          {/* What the build that just ran had to fudge. The panel draws
              nothing until a map has been drawn in this session, and the
              numbers are never stored (A3-03, specs/017). */}
          {!project.readOnly && <DiagnosticsView run={run} project={project} />}
          {!project.readOnly && project.layout !== null && (
            <ServiceDay run={run} project={project} engine={engine} disabled={exporting} />
          )}
          {!project.readOnly && project.layout !== null && (
            <LineColours
              run={run}
              project={project}
              engine={engine}
              inspect={inspect}
              disabled={exporting}
              busyNow={() => exporter.snapshot.state === 'running'}
            />
          )}
          {!project.readOnly && project.layout !== null && (
            <LineOrderPanel
              run={run}
              project={project}
              engine={engine}
              inspect={inspect}
              disabled={exporting}
              busyNow={() => exporter.snapshot.state === 'running'}
            />
          )}
          {!project.readOnly && (
            <ThemeSwitch project={project} onChange={setTheme} disabled={exporting} />
          )}
          {!project.readOnly && project.layout !== null && (
            <ExportRunView run={exporter} project={project} engine={engine} disabled={layingOut} />
          )}
          {project.layout !== null && (
            <StageView project={project} engine={engine} read={readStage} />
          )}
          {project.layout !== null && <Viewer key={drawn} project={project} />}
          <div className="toolbar">
            <Button
              ref={renameButtonRef}
              aria-expanded={renaming}
              disabled={project.readOnly}
              onClick={() => (renaming ? closeRename() : openRename())}
            >
              <Icon name="edit" />
              Rename
            </Button>
            <Button
              variant="destructive"
              disabled={exporting || layingOut}
              onClick={() => setConfirming(true)}
            >
              <Icon name="trash" />
              Delete project
            </Button>
          </div>
          {renaming && (
            <form className="inline-form" noValidate onSubmit={saveRename}>
              <div className="field">
                <label htmlFor="rename-name">New name</label>
                <TextInput
                  id="rename-name"
                  ref={newNameRef}
                  size="large"
                  value={newName}
                  onChange={setNewName}
                  aria-describedby="rename-message"
                  aria-invalid={renameMessage ? true : undefined}
                  aria-required
                />
                <p id="rename-message" className="message error">
                  {renameMessage}
                </p>
              </div>
              <div className="actions">
                <Button onClick={closeRename}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={saving}>
                  Save
                </Button>
              </div>
            </form>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirming}
        title={`Delete ${project?.name ?? ''}?`}
        description="This removes the project and its generated output. The feed stays."
        confirmLabel="Delete"
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
      />
    </main>
  )
}
