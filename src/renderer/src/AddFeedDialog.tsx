import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
import type { EngineState } from '../../shared/engine'
import type { PickedZip } from '../../shared/api'
import type { FeedAdd } from './engine/feedAdd'
import Icon from './icons/Icon'
import Button from './kit/Button'
import TextInput, { type TextInputHandle } from './kit/TextInput'
import ProgressLine from './ProgressLine'
import { useSnapshot } from './useSnapshot'

// Adding a feed: a zip chosen in the platform's own chooser, which the main
// process opens and remembers, or a URL. The add runs on the engine with
// its download on the progress line and can be cancelled; a refusal is
// the engine's sentence under the source. The dialog stays open until the
// feed is in, or the person leaves.

interface Props {
  open: boolean
  run: FeedAdd
  engine: EngineState | null
  pickZip: () => Promise<PickedZip | null>
  onAdded: () => void
  onCancel: () => void
}

const URL_PATTERN = /^https?:\/\/\S+$/

/** What is wrong with a typed URL, or null. */
export function validateFeedUrl(url: string): string | null {
  const trimmed = url.trim()
  if (trimmed === '') return 'paste the address of a GTFS zip, or choose a file'
  if (!URL_PATTERN.test(trimmed)) return 'a feed address starts with http:// or https://'
  return null
}

export default function AddFeedDialog({
  open,
  run,
  engine,
  pickZip,
  onAdded,
  onCancel,
}: Props): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const urlRef = useRef<TextInputHandle>(null)
  const chooseRef = useRef<HTMLElement>(null)
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<PickedZip | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const snapshot = useSnapshot(run)
  const running = snapshot.state === 'running'

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      chooseRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  // The feed is in: the Library lists again and the dialog goes.
  useEffect(() => {
    if (snapshot.state === 'done') onAdded()
  }, [snapshot.state, onAdded])

  const reset = (): void => {
    setUrl('')
    setFile(null)
    setMessage(null)
    run.reset()
  }

  const choose = async (): Promise<void> => {
    const picked = await pickZip()
    if (picked === null) return
    setFile(picked)
    setUrl('')
    setMessage(null)
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (running) return
    if (file !== null) {
      setMessage(null)
      run.start({ file: file.path }, engine)
      return
    }
    const problem = validateFeedUrl(url)
    if (problem !== null) {
      setMessage(problem)
      urlRef.current?.focus()
      return
    }
    setMessage(null)
    run.start({ url: url.trim() }, engine)
  }

  // Escape while a run is going cancels the run and keeps the dialog: a
  // person who changes their mind should see that nothing was kept.
  const cancel = (): void => {
    if (running) {
      run.cancel()
      return
    }
    onCancel()
  }

  const shown = snapshot.error ?? message
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="add-feed-title"
      aria-describedby="add-feed-desc"
      onCancel={(event) => {
        event.preventDefault()
        cancel()
      }}
      onClose={reset}
    >
      <form noValidate onSubmit={submit}>
        <h2 id="add-feed-title">Add a feed</h2>
        <p id="add-feed-desc" className="hint">
          A GTFS zip from your disk, or the address the agency publishes it at. The engine checks it
          has the tables a map and a timetable need.
        </p>
        <div className="field">
          <span className="field-label" id="add-feed-file-label">
            From a file
          </span>
          <div className="toolbar">
            <Button
              ref={chooseRef}
              onClick={() => void choose()}
              disabled={running}
              aria-describedby="add-feed-file-name"
            >
              <Icon name="layers" />
              Choose a zip
            </Button>
            <span id="add-feed-file-name" className="hint">
              {file === null ? 'No file chosen.' : file.name}
            </span>
          </div>
        </div>
        <div className="field">
          <label htmlFor="add-feed-url">Or from an address</label>
          <TextInput
            id="add-feed-url"
            ref={urlRef}
            size="large"
            value={url}
            onChange={(value) => {
              setUrl(value)
              if (value !== '') setFile(null)
              setMessage(null)
            }}
            placeholder="https://"
            spellCheck={false}
            disabled={running}
            aria-describedby="add-feed-message"
            aria-invalid={shown ? true : undefined}
          />
          <p id="add-feed-message" className="message error" role="alert">
            {shown}
          </p>
        </div>
        {snapshot.state !== 'idle' && (
          <section className="add-run" aria-label="Adding the feed">
            <ProgressLine
              stages={snapshot.stages}
              ariaLabel={
                snapshot.state === 'running'
                  ? `Adding the feed: ${snapshot.message ?? 'starting'}`
                  : snapshot.state === 'cancelled'
                    ? 'The add was cancelled.'
                    : snapshot.state === 'failed'
                      ? 'The feed was refused.'
                      : 'The feed was added.'
              }
            />
            <p className="progress-message" role="status" aria-live="polite">
              {snapshot.state === 'cancelled'
                ? 'Cancelled. Nothing was kept.'
                : (snapshot.message ?? 'Starting.')}
            </p>
          </section>
        )}
        <div className="actions">
          <Button onClick={cancel}>{running ? 'Cancel the add' : 'Close'}</Button>
          <Button
            variant="primary"
            type="submit"
            disabled={running || (file === null && url === '')}
          >
            Add feed
          </Button>
        </div>
      </form>
    </dialog>
  )
}
