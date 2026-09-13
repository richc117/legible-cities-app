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
  const [picking, setPicking] = useState(false)
  const cancelRef = useRef<HTMLElement>(null)
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

  // The feed is in: the Library lists again and the dialog goes. A cancel
  // may have landed after the engine kept the feed (its check cannot be
  // interrupted), so the Library lists again then too.
  useEffect(() => {
    if (snapshot.state === 'done') onAdded()
  }, [snapshot.state, onAdded])

  // A file is spent by one add, accepted or not: the main process forgets
  // the path once it has let it through, so the next try picks again.
  useEffect(() => {
    if (snapshot.state === 'failed' || snapshot.state === 'cancelled') setFile(null)
  }, [snapshot.state])

  // Submitting disables the controls, and a disabled element drops focus;
  // the one control left is where a person would go next.
  useEffect(() => {
    if (running) cancelRef.current?.focus()
  }, [running])

  const reset = (): void => {
    setUrl('')
    setFile(null)
    setMessage(null)
    run.reset()
  }

  // The engine's last refusal is cleared by the next edit, as a typed
  // message is, so an old sentence does not sit under a new choice.
  const edited = (): void => {
    setMessage(null)
    if (snapshot.state === 'failed' || snapshot.state === 'cancelled') run.reset()
  }

  const choose = async (): Promise<void> => {
    if (picking) return
    setPicking(true)
    try {
      const picked = await pickZip()
      // Escape may have closed the dialog while the chooser was up.
      if (picked === null || !dialogRef.current?.open) return
      setFile(picked)
      setUrl('')
      edited()
    } finally {
      setPicking(false)
    }
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
  // person who changes their mind should see what happened. The platform
  // may close the dialog anyway on a second Escape (a cancel event is only
  // cancelable while the window holds an unspent activation), so the close
  // handler tells the parent whenever the element closed on its own.
  const cancel = (): void => {
    if (running) {
      run.cancel()
      return
    }
    onCancel()
  }
  const closed = (): void => {
    if (running) run.cancel()
    reset()
    if (open) onCancel()
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
      onClose={closed}
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
              disabled={running || picking}
              aria-describedby="add-feed-file-name add-feed-message"
            >
              <Icon name="layers" />
              Choose a zip
            </Button>
            <span id="add-feed-file-name" className="hint" aria-live="polite">
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
              edited()
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
                ? 'Cancelled. A download stopped keeps nothing; a check already finished may have kept the feed, and the list says which.'
                : (snapshot.message ?? 'Starting.')}
            </p>
          </section>
        )}
        <div className="actions">
          <Button ref={cancelRef} onClick={cancel}>
            {running ? 'Cancel the add' : 'Close'}
          </Button>
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
