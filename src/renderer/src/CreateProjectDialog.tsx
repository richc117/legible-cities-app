import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
import type { CreateProjectInput } from '../../shared/api'
import type { FeedRecord } from '../../shared/protocol'
import { DEFAULT_FEED, validateFeedKey, validateName } from '../../shared/project'
import { placeOf } from './FeedList'
import Button from './kit/Button'
import Select from './kit/Select'
import TextInput, { type TextInputHandle } from './kit/TextInput'

interface Props {
  open: boolean
  /** The feeds the engine listed; empty when it could not be asked, and the key is typed. */
  feeds: FeedRecord[]
  /** The feed to start on: the row's, or the default. */
  initialFeed?: string
  /** Creates the project; a rejection's message is shown under the field it concerns. */
  onCreate: (input: CreateProjectInput) => Promise<void>
  onCancel: () => void
}

/** The feed the dialog opens on: the one asked for when the list has it, else the first listed, else the default key. */
export function startingFeed(feeds: FeedRecord[], wanted: string | undefined): string {
  if (wanted !== undefined && (feeds.length === 0 || feeds.some((f) => f.key === wanted)))
    return wanted
  if (feeds.some((f) => f.key === DEFAULT_FEED)) return DEFAULT_FEED
  return feeds.length > 0 ? feeds[0].key : DEFAULT_FEED
}

type Field = 'name' | 'feed'
type Messages = Partial<Record<Field, string>>

// The bridge's messages open with the field they concern ("name is
// required", "feed key must be…"), so a rejection lands under that field;
// anything else lands under the first one.
function fieldFor(message: string): Field {
  return message.startsWith('feed') ? 'feed' : 'name'
}

export default function CreateProjectDialog({
  open,
  feeds,
  initialFeed,
  onCreate,
  onCancel,
}: Props): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const nameRef = useRef<TextInputHandle>(null)
  const feedRef = useRef<TextInputHandle>(null)
  const [name, setName] = useState('')
  const [feed, setFeed] = useState(() => startingFeed(feeds, initialFeed))
  const listed = feeds.length > 0
  const [messages, setMessages] = useState<Messages>({})

  // The list can arrive while the dialog is open (the engine became ready):
  // the typed key gives way to the select, and a key the list does not
  // hold is not sent to a feed that does not exist.
  useEffect(() => {
    if (open) setFeed((current) => startingFeed(feeds, listed ? current : undefined))
  }, [open, feeds, listed])
  const [busy, setBusy] = useState(false)

  // showModal() makes the browser own modality, the focus trap, Escape and
  // the return of focus to the opener; the open prop only drives it.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      // The feed the opener asked for, read at opening: a row's "New
      // project" names its feed, the toolbar's names none.
      setFeed(startingFeed(feeds, initialFeed))
      dialog.showModal()
      // React's autoFocus only acts at mount, when the dialog is still hidden.
      nameRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open, feeds, initialFeed])

  // The close event follows every way out (Escape, Cancel, a finished
  // create), so the next opening starts from a blank form.
  const reset = (): void => {
    setName('')
    setFeed(startingFeed(feeds, undefined))
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
      // A project starts with its feed's own inputs when the registry is in
      // view, so a preset draws as the engine's site draws it (A2-02).
      const entry = feeds.find((f) => f.key === feed)
      await onCreate(
        entry === undefined
          ? { name: trimmed, feed }
          : { name: trimmed, feed, mode: entry.mode, agency: entry.agency },
      )
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
          {listed
            ? 'A project draws one feed. Add a feed to the Library to see it here.'
            : 'The engine is not ready to list the feeds, so the feed key is typed.'}
        </p>
        <div className="field">
          <label htmlFor="create-name">Name</label>
          <TextInput
            id="create-name"
            ref={nameRef}
            size="large"
            value={name}
            onChange={setName}
            aria-describedby="create-name-message"
            aria-invalid={messages.name ? true : undefined}
            aria-required
          />
          <p id="create-name-message" className="message error">
            {messages.name}
          </p>
        </div>
        <div className="field">
          {listed ? (
            <>
              {/* The kit names the native select itself; this is the visible word. */}
              <span className="field-label" aria-hidden="true">
                Feed
              </span>
              <Select label="Feed" value={feed} onChange={setFeed} className="feed-select">
                {feeds.map((f) => {
                  const place = placeOf(f)
                  return (
                    <option key={f.key} value={f.key}>
                      {place === null ? f.name : `${f.name} (${place})`}
                    </option>
                  )
                })}
              </Select>
            </>
          ) : (
            <>
              <label htmlFor="create-feed">Feed key</label>
              <TextInput
                id="create-feed"
                ref={feedRef}
                size="large"
                value={feed}
                onChange={setFeed}
                spellCheck={false}
                aria-describedby="create-feed-message"
                aria-invalid={messages.feed ? true : undefined}
              />
            </>
          )}
          <p id="create-feed-message" className="message error" role={listed ? 'alert' : undefined}>
            {messages.feed}
          </p>
        </div>
        <div className="actions">
          <Button onClick={() => onCancel()}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            Create
          </Button>
        </div>
      </form>
    </dialog>
  )
}
