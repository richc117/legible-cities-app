import type { JSX } from 'react'
import ConfirmDialog from '../ConfirmDialog'
import Icon from '../icons/Icon'
import Button from '../kit/Button'
import TextInput from '../kit/TextInput'
import { useProject } from './context'
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

export default function ProjectFooter(): JSX.Element {
  const { project, rename, remove, exporting, layingOut } = useProject()
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
        description="This removes the project and its generated output. The feed stays."
        confirmLabel="Delete"
        onConfirm={remove.confirm}
        onCancel={remove.cancel}
        busyLabel={`Deleting ${project?.name ?? 'the project'}…`}
        onLateError={remove.setProblem}
      />
    </>
  )
}
