import { useRef, useState, type FormEvent, type JSX, type RefObject } from 'react'
import { validateName } from '../../../shared/project/validate'
import ConfirmDialog from '../ConfirmDialog'
import Icon from '../icons/Icon'
import Button from '../kit/Button'
import TextInput, { type TextInputHandle } from '../kit/TextInput'
import { useProjectActions, useProjectRecord, useProjectRuns } from './context'
import Time from './Time'

// The foot of the project's screen: when it was made and last changed, and
// the two things that can be done to the project itself (A1-05).
//
// Moved from the project screen unchanged. The two dates are the last of
// the `<dl class="fields">` that the screen carried whole; they belong to
// the project rather than to any step of making a map, so they are here
// rather than in a cell.
//
// The toolbar is where "Skip past the map" lands (issue 106): its first
// button that can take focus, which is why it stays after the frame and
// why it gains no role or name of its own.
//
// The rename's form and the delete's confirmation are this component's own
// state (issue 433). Held with the screen's, a keystroke in the name field
// rendered every cell; here it renders the footer alone. The two writes they
// end in are the screen's (`setName`, `deleteProject` in `useProjectState`),
// sent at once and answered there, as every write of the record is.

type Named = { name: string } | null

/** The rename form: open or not, the name being typed, and what was said of it. */
function useRename(
  project: Named,
  setName: (name: string) => Promise<void>,
): {
  open: boolean
  value: string
  setValue: (value: string) => void
  message: string | null
  saving: boolean
  buttonRef: RefObject<HTMLElement | null>
  inputRef: RefObject<TextInputHandle | null>
  begin: () => void
  close: () => void
  save: (event: FormEvent<HTMLFormElement>) => Promise<void>
} {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const buttonRef = useRef<HTMLElement>(null)
  const inputRef = useRef<TextInputHandle>(null)

  const begin = (): void => {
    if (!project) return
    setValue(project.name)
    setMessage(null)
    setOpen(true)
  }

  // The form's own controls disappear with it, so focus goes back to the
  // button that revealed it.
  const close = (): void => {
    setOpen(false)
    buttonRef.current?.focus()
  }

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!project) return
    const trimmed = value.trim()
    const invalid = validateName(trimmed)
    if (invalid) {
      setMessage(invalid)
      inputRef.current?.focus()
      return
    }
    if (trimmed === project.name) return close()
    setSaving(true)
    try {
      await setName(trimmed)
      close()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      inputRef.current?.focus()
    } finally {
      setSaving(false)
    }
  }

  return { open, value, setValue, message, saving, buttonRef, inputRef, begin, close, save }
}

/** The delete's confirmation: open or not, and a refusal that came after it closed (A6-07). */
function useRemove(confirm: () => Promise<void>): {
  confirming: boolean
  problem: string | null
  buttonRef: RefObject<HTMLElement | null>
  begin: () => void
  cancel: () => void
  confirm: () => Promise<void>
  setProblem: (problem: string | null) => void
} {
  const [confirming, setConfirming] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const buttonRef = useRef<HTMLElement>(null)
  return {
    confirming,
    problem,
    buttonRef,
    begin: () => {
      setProblem(null)
      setConfirming(true)
    },
    cancel: () => setConfirming(false),
    confirm,
    setProblem,
  }
}

export default function ProjectFooter(): JSX.Element {
  const { project } = useProjectRecord()
  const { exporting, layingOut } = useProjectRuns()
  const { setName, deleteProject } = useProjectActions()
  const rename = useRename(project, setName)
  const remove = useRemove(deleteProject)
  return (
    <>
      {project !== null && (
        <>
          <dl className="fields">
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
            <Button
              ref={rename.buttonRef}
              aria-expanded={rename.open}
              disabled={project.readOnly}
              onClick={() => (rename.open ? rename.close() : rename.begin())}
            >
              <Icon name="edit" />
              Rename
            </Button>
            <Button
              ref={remove.buttonRef}
              variant="destructive"
              disabled={exporting || layingOut}
              onClick={remove.begin}
            >
              <Icon name="trash" />
              Delete project
            </Button>
          </div>
          {remove.problem !== null && (
            <p role="alert" className="notice error">
              {remove.problem}
            </p>
          )}
          {rename.open && (
            <form className="inline-form" noValidate onSubmit={rename.save}>
              <div className="field">
                <label htmlFor="rename-name">New name</label>
                <TextInput
                  id="rename-name"
                  ref={rename.inputRef}
                  size="large"
                  value={rename.value}
                  onChange={rename.setValue}
                  aria-describedby="rename-message"
                  aria-invalid={rename.message ? true : undefined}
                  aria-required
                />
                <p id="rename-message" className="message error">
                  {rename.message}
                </p>
              </div>
              <div className="actions">
                <Button onClick={rename.close}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={rename.saving}>
                  Save
                </Button>
              </div>
            </form>
          )}
        </>
      )}
      <ConfirmDialog
        open={remove.confirming}
        title={`Delete ${project?.name ?? ''}?`}
        description="This removes the project and its generated output. The feed stays. Exported files stay where they are."
        confirmLabel="Delete"
        onConfirm={remove.confirm}
        onCancel={remove.cancel}
        busyLabel={`Deleting ${project?.name ?? 'the project'}…`}
        onLateError={remove.setProblem}
      />
    </>
  )
}
