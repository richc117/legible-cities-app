import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
import type { DeleteResult, ProjectRecord } from '../../shared/api'
import { validateName } from '../../shared/project'
import ConfirmDialog from './ConfirmDialog'

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
  const headingRef = useRef<HTMLHeadingElement>(null)
  const renameButtonRef = useRef<HTMLButtonElement>(null)
  const newNameRef = useRef<HTMLInputElement>(null)

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
        <button type="button" onClick={() => onBack()}>
          Back to Library
        </button>
      </div>
      {state.status === 'error' && (
        <p role="alert" className="notice">
          {state.message}
        </p>
      )}
      {project?.readOnly && (
        <p role="status">
          This project was made by a newer version of the app and is read-only here.
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
            <dd>{project.layout ?? 'not laid out yet'}</dd>
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
          <div className="toolbar">
            <button
              type="button"
              ref={renameButtonRef}
              aria-expanded={renaming}
              disabled={project.readOnly}
              onClick={() => (renaming ? closeRename() : openRename())}
            >
              Rename
            </button>
            <button type="button" disabled={project.readOnly} onClick={() => setConfirming(true)}>
              Delete project
            </button>
          </div>
          {renaming && (
            <form className="inline-form" noValidate onSubmit={saveRename}>
              <div className="field">
                <label htmlFor="rename-name">New name</label>
                <input
                  id="rename-name"
                  ref={newNameRef}
                  type="text"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  required
                  autoFocus
                  aria-describedby="rename-message"
                  aria-invalid={renameMessage ? true : undefined}
                />
                <p id="rename-message" className="message error">
                  {renameMessage}
                </p>
              </div>
              <div className="actions">
                <button type="button" onClick={closeRename}>
                  Cancel
                </button>
                <button type="submit" className="primary" disabled={saving}>
                  Save
                </button>
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
