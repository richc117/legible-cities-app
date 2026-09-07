import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
import type { CreateProjectInput } from '../../shared/api'
import { DEFAULT_FEED, validateFeedKey, validateName } from '../../shared/project'

interface Props {
  open: boolean
  /** Creates the project; a rejection's message is shown under the field it concerns. */
  onCreate: (input: CreateProjectInput) => Promise<void>
  onCancel: () => void
}

type Field = 'name' | 'feed'
type Messages = Partial<Record<Field, string>>

// The bridge's messages open with the field they concern ("name is
// required", "feed key must be…"), so a rejection lands under that field;
// anything else lands under the first one.
function fieldFor(message: string): Field {
  return message.startsWith('feed') ? 'feed' : 'name'
}

export default function CreateProjectDialog({ open, onCreate, onCancel }: Props): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const feedRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [feed, setFeed] = useState(DEFAULT_FEED)
  const [messages, setMessages] = useState<Messages>({})
  const [busy, setBusy] = useState(false)

  // showModal() makes the browser own modality, the focus trap, Escape and
  // the return of focus to the opener; the open prop only drives it.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      // React's autoFocus only acts at mount, when the dialog is still hidden.
      nameRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  // The close event follows every way out (Escape, Cancel, a finished
  // create), so the next opening starts from a blank form.
  const reset = (): void => {
    setName('')
    setFeed(DEFAULT_FEED)
    setMessages({})
    setBusy(false)
  }

  const focus = (field: Field): void => {
    ;(field === 'feed' ? feedRef : nameRef).current?.focus()
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const trimmed = name.trim()
    const found: Messages = {}
    const nameMessage = validateName(trimmed)
    if (nameMessage) found.name = nameMessage
    const feedMessage = validateFeedKey(feed)
    if (feedMessage) found.feed = feedMessage
    setMessages(found)
    if (found.name) return focus('name')
    if (found.feed) return focus('feed')

    setBusy(true)
    try {
      await onCreate({ name: trimmed, feed })
    } catch (error) {
      // Escape may have closed the dialog while the request was in flight;
      // the message would only surface, stale, on the next opening.
      if (!dialogRef.current?.open) return
      const message = error instanceof Error ? error.message : String(error)
      const field = fieldFor(message)
      setMessages({ [field]: message })
      focus(field)
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="create-title"
      aria-describedby="create-desc"
      onCancel={() => onCancel()}
      onClose={reset}
    >
      <form noValidate onSubmit={submit}>
        <h2 id="create-title">New project</h2>
        <p id="create-desc" className="hint">
          The list of feeds arrives with a later release, so the feed is typed for now.
        </p>
        <div className="field">
          <label htmlFor="create-name">Name</label>
          <input
            id="create-name"
            ref={nameRef}
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            autoFocus
            aria-describedby="create-name-message"
            aria-invalid={messages.name ? true : undefined}
          />
          <p id="create-name-message" className="message error">
            {messages.name}
          </p>
        </div>
        <div className="field">
          <label htmlFor="create-feed">Feed key</label>
          <input
            id="create-feed"
            ref={feedRef}
            type="text"
            value={feed}
            onChange={(event) => setFeed(event.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-describedby="create-feed-message"
            aria-invalid={messages.feed ? true : undefined}
          />
          <p id="create-feed-message" className="message error">
            {messages.feed}
          </p>
        </div>
        <div className="actions">
          <button type="button" onClick={() => onCancel()}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            Create
          </button>
        </div>
      </form>
    </dialog>
  )
}
