import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react'
import type { CreateProjectInput, PickedZip } from '../../shared/api'
import type { EngineState } from '../../shared/engine'
import { DEFAULT_FEED, uniqueName, validateFeedKey, validateName } from '../../shared/project'
import type { FeedRecord } from '../../shared/protocol'
import type { FeedAdd } from './engine/feedAdd'
import { placeOf } from './FeedList'
import Icon from './icons/Icon'
import Button from './kit/Button'
import Select from './kit/Select'
import TextInput, { type TextInputHandle } from './kit/TextInput'
import ProgressLine from './ProgressLine'
import { useSnapshot } from './useSnapshot'

// New project (A5.6-05): one sheet with three sources - a feed the engine
// already lists (a sample city, or a feed a person added), a GTFS zip on
// this computer, or a feed at an address - landing in the same form with
// what is already known filled in. It replaces the create dialog and the
// add-a-feed dialog, which were two halves of one task.
//
// What is filled, and from where:
//
// - The name: a listed feed's own name as soon as it is chosen; for a zip
//   or an address, the feed's own name once the engine has added it (its
//   first agency's, the engine's default). A name a person has typed is
//   theirs and is never overwritten by either, and neither is written into a
//   field a person already has in hand, typed in or not (issue 263).
// - The mode and the operator: a listed feed's registry entry, so a sample
//   draws as the engine's site draws it (A2-02) - including an entry that
//   names its operator, such as Mexico City's, which eight operators share.
//   A feed a person adds starts at every operator. The issue asked for
//   every operator throughout; the registry's own operator was kept for the
//   samples on the maintainer's decision, because every operator would
//   draw a different map from the one the sample promises.
//
// For a zip or an address it is two steps. "Add the feed" adds it, with
// its download on the progress line; once it is in, the name is filled
// from it (unless typed) and the button becomes Create. Two steps and not
// one, because a feed is worth having without a project - Cancel after the
// add leaves it listed under "Your feeds" - and because a name a person
// has not seen should not become a project's name unasked. A refusal from
// the add is said under the field that caused it.
//
// The zip is chosen in the platform's own dialog, which the main process
// opens and remembers. Its answer does come back inward, as `feeds.add`'s
// source, and what makes that safe is the guard in the main process that
// takes only a path its own dialog answered, once - unchanged here.

/** Where a new project's feed comes from. */
export type Source = 'feed' | 'zip' | 'address'

/** What the sheet opens on: a source, and for a listed feed which one. */
export type SheetStart = { source: 'feed'; feed?: string } | { source: 'zip' | 'address' }

/** The feed the sheet opens on: the one asked for when the list has it, else the first listed, else the default key. */
export function startingFeed(feeds: FeedRecord[], wanted: string | undefined): string {
  if (wanted !== undefined && (feeds.length === 0 || feeds.some((f) => f.key === wanted)))
    return wanted
  if (feeds.some((f) => f.key === DEFAULT_FEED)) return DEFAULT_FEED
  return feeds.length > 0 ? feeds[0].key : DEFAULT_FEED
}

const URL_PATTERN = /^https?:\/\/\S+$/

/** What is wrong with a typed URL, or null. */
export function validateFeedUrl(url: string): string | null {
  const trimmed = url.trim()
  if (trimmed === '') return 'paste the address of a GTFS zip, or choose a file'
  if (!URL_PATTERN.test(trimmed)) return 'a feed address starts with http:// or https://'
  return null
}

/**
 * The name the sheet fills in: the feed's own, unless a person has typed
 * one. Pure, so "a typed name is never overwritten" is a unit test.
 */
export function filledName(current: string, edited: boolean, feedName: string | null): string {
  if (edited || feedName === null) return current
  return feedName
}

/**
 * The name the feed list's arrival may write into the name field, or null to
 * leave the field exactly as it is (issue 263).
 *
 * The arrival is the one write the sheet makes that nobody asked for: the
 * engine became ready while the sheet was open. So it is made only into a
 * field no one has touched - nothing typed in it, and not in a person's
 * hand. In hand means focused, because focus comes before any text does: a
 * click into the field, and a test's fill, which focuses and selects the
 * empty field and inserts its text a moment later. A value written between
 * the two puts the caret at its end, and what is typed next lands beside the
 * written name ("LA Metro RailLos Angeles") instead of in place of it.
 * `typed` alone was not enough, since it is set by the first input event and
 * the hand is on the field before that.
 */
export function arrivalName(typed: boolean, held: boolean, feedName: string | null): string | null {
  if (typed || held) return null
  return feedName
}

type Field = 'name' | 'feed' | 'file' | 'url'
type Messages = Partial<Record<Field, string>>

// The bridge's messages open with the field they concern ("name is
// required", "feed key must be…"), so a create's refusal lands under that
// field; anything else lands under the name.
function fieldFor(message: string): Field {
  return message.startsWith('feed') ? 'feed' : 'name'
}

interface Props {
  open: boolean
  start: SheetStart
  /** The feeds the engine listed; empty when it could not be asked, and the key is typed. */
  feeds: FeedRecord[]
  run: FeedAdd
  engine: EngineState | null
  pickZip: () => Promise<PickedZip | null>
  /** Creates the project; a rejection's message is shown under the field it concerns. */
  onCreate: (input: CreateProjectInput) => Promise<void>
  /** A feed was added: the front door reads the list again. */
  onAdded: () => void
  /** The names of the projects listed, so a name the sheet fills is not one of them. */
  taken: readonly string[]
  onCancel: () => void
}

export default function NewProjectSheet({
  open,
  start,
  feeds,
  run,
  engine,
  pickZip,
  onCreate,
  onAdded,
  taken,
  onCancel,
}: Props): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLElement>(null)
  const nameRef = useRef<TextInputHandle>(null)
  const feedRef = useRef<TextInputHandle>(null)
  const urlRef = useRef<TextInputHandle>(null)
  const chooseRef = useRef<HTMLElement>(null)
  const ids = useId()
  const field = (id: Field): string => `${ids}-${id}`
  const [source, setSource] = useState<Source>(start.source)
  const [feed, setFeed] = useState(() =>
    startingFeed(feeds, start.source === 'feed' ? start.feed : undefined),
  )
  const [name, setName] = useState('')
  // Whether a person has typed a name, as a ref and not state: it is read
  // inside the fills, which can run later than the render that scheduled
  // them. As state, an effect scheduled before a keystroke read "not typed"
  // after it, and put the feed's name over the name just typed - the
  // end-to-end suite caught it as projects made under the wrong name.
  const edited = useRef(false)
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<PickedZip | null>(null)
  const [picking, setPicking] = useState(false)
  const [messages, setMessages] = useState<Messages>({})
  const [busy, setBusy] = useState(false)
  // The feed this sheet added, once it is in: Create then makes the
  // project on it.
  const [added, setAdded] = useState<FeedRecord | null>(null)
  // Which add this opening started, counted, or 0 for none. The add run is
  // the front door's one run and outlives the sheet: an add left going by
  // an earlier opening (a second Escape closes the dialog; the engine's
  // check cannot be interrupted) can end while a later opening is up, and
  // must not fill that opening's name or claim its Create (review of
  // A5.6-05). A count and not a flag, so that a second press that fails as
  // the first did is still answered: the run's state alone does not move
  // from failed to failed.
  const [attempt, setAttempt] = useState(0)
  const snapshot = useSnapshot(run)
  const running = snapshot.state === 'running'
  // Ours: this opening started the add that is going.
  const adding = running && attempt > 0
  // An add another opening left behind, still finishing: nothing new can
  // start until it has, and the sheet says so rather than going quiet.
  const elsewhere = running && attempt === 0
  const listed = feeds.length > 0
  const presets = feeds.filter((f) => f.source === 'preset')
  const yours = feeds.filter((f) => f.source === 'user')
  const ready = engine?.state === 'ready'

  // The name the sheet fills for a feed: its own, made unique among the
  // projects listed ("LA Metro Rail 2"), since it is the app's choice and
  // not a person's. A name typed is left exactly as typed.
  const nameOf = (key: string): string | null => {
    const own = feeds.find((f) => f.key === key)?.name
    return own === undefined ? null : uniqueName(own, taken)
  }

  // showModal() makes the browser own modality, the focus trap, Escape and
  // the return of focus to the opener; the open prop only drives it. The
  // safe action takes focus first: a sheet opened by accident is left with
  // one Enter, and nothing is added or created by a reflexive press.
  //
  // Two steps, so the sheet is never shown before its fields hold what it
  // opens with. The first sets them and asks for the showing; the second,
  // in the commit that carries those values, shows it - after the kit's
  // text field has pushed its value into the page, which it does in an
  // effect of its own, run before this component's. Shown in the same
  // effect that set the name, the sheet was up a frame before the name
  // was, and text typed at once landed beside the name that arrived after
  // it ("LA Metro RailLos Angeles", which the end-to-end suite caught).
  const [showing, setShowing] = useState(0)
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      const first = startingFeed(feeds, start.source === 'feed' ? start.feed : undefined)
      setSource(start.source)
      setFeed(first)
      setName(start.source === 'feed' ? (nameOf(first) ?? '') : '')
      // Nothing of an earlier opening carries into this one.
      edited.current = false
      setUrl('')
      setFile(null)
      setMessages({})
      setAdded(null)
      setBusy(false)
      setAttempt(0)
      if (run.snapshot.state !== 'running') run.reset()
      setShowing((n) => n + 1)
    } else if (!open && dialog.open) {
      dialog.close()
    }
    // `feeds` is read at opening only; a list arriving later is the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, start])
  useEffect(() => {
    const dialog = dialogRef.current
    if (showing === 0 || !dialog || !open || dialog.open) return
    dialog.showModal()
    cancelRef.current?.focus()
    // Only a new showing moves this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showing])

  // The list can arrive while the sheet is open (the engine became ready):
  // the typed key gives way to the select, a key the list does not hold is
  // not sent to a feed that does not exist, and the name follows when no one
  // has touched it - a sheet opened while the engine was still starting had
  // no feed name to fill. Keyed on the list alone and not on opening: at the
  // opening render `feed` still holds the last opening's key, and acting on
  // it then undid the feed a card or a row asked for.
  //
  // Touched is typed in, or in hand (`arrivalName`): a test that fills the
  // name focuses and selects the empty field and inserts its text a moment
  // later, and a name written in between landed beside it, as would a
  // person's own first words after a click (issue 263; the two-step showing
  // above closed the sheet's opening and never this). The write is made
  // here, in the turn that decides it, and not left to the kit's wrapper,
  // which pushes state into the page in an effect of its own two tasks
  // later (measured): a hand that arrives in between finds the name written
  // after the check that found the field free. The wrapper then finds the
  // page already holding the value and writes nothing.
  useEffect(() => {
    if (!dialogRef.current?.open) return
    const next = startingFeed(feeds, listed ? feed : undefined)
    setFeed(next)
    if (source !== 'feed') return
    const input = document.getElementById(field('name'))
    const filled = arrivalName(
      edited.current,
      input !== null && input === document.activeElement,
      nameOf(next),
    )
    if (filled === null) return
    setName(filled)
    const host = input?.closest('fig-input-text')
    if (host && host.getAttribute('value') !== filled) host.setAttribute('value', filled)
    // The list arriving is the change; the rest is read as it stands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feeds, listed])

  const fail = (asked: Field, message: string): void => {
    // A message about the feed goes where a feed field is on screen and can
    // hold it; otherwise - the zip, the address, or the listed select, which
    // references no message - it goes under the name, so it is never said
    // into a field nobody can see (review of A5.6-05).
    const field = asked === 'feed' && (source !== 'feed' || listed) ? 'name' : asked
    setMessages({ [field]: message })
    const target =
      field === 'name'
        ? nameRef
        : field === 'url'
          ? urlRef
          : field === 'feed'
            ? feedRef
            : { current: chooseRef.current }
    target.current?.focus()
  }

  const create = async (input: CreateProjectInput): Promise<void> => {
    setBusy(true)
    try {
      await onCreate(input)
    } catch (error) {
      // Escape may have closed the sheet while the request was in flight;
      // the message would only surface, stale, on the next opening.
      if (!dialogRef.current?.open) return
      const message = error instanceof Error ? error.message : String(error)
      // Not busy before focus moves: a disabled field cannot take it.
      setBusy(false)
      fail(fieldFor(message), message)
    } finally {
      setBusy(false)
    }
  }

  // The add's end. Done: the front door lists again, the name is filled
  // unless typed, and focus goes to the name, where a person reads what was
  // filled before pressing Create. Refused or stopped: the file is spent
  // (the main process forgets a path once it has let it through), and the
  // engine's sentence is said under the field it concerns.
  useEffect(() => {
    // An add this opening did not start, or a sheet already shut, is not
    // this form's business: the front door lists again on its own.
    if (attempt === 0 || !dialogRef.current?.open) return
    if (snapshot.state === 'done' && snapshot.feed !== null) {
      const feedAdded = snapshot.feed
      setAdded(feedAdded)
      // The file is spent by the add, as by a refusal.
      setFile(null)
      onAdded()
      setName((current) => filledName(current, edited.current, uniqueName(feedAdded.name, taken)))
      nameRef.current?.focus()
    } else if (snapshot.state === 'failed' || snapshot.state === 'cancelled') {
      setFile(null)
      if (snapshot.state === 'failed' && snapshot.error !== null)
        fail(source === 'zip' ? 'file' : 'url', snapshot.error)
    }
    // The add's own state and this opening's attempts move this; the rest
    // is read as it stands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.state, attempt])

  // Submitting disables the controls, and a disabled element drops focus;
  // the one control left is where a person would go next.
  useEffect(() => {
    if (adding) cancelRef.current?.focus()
  }, [adding])

  const reset = (): void => {
    setName('')
    edited.current = false
    setUrl('')
    setFile(null)
    setMessages({})
    setBusy(false)
    setAdded(null)
    setAttempt(0)
    run.reset()
  }

  // The engine's last refusal goes with the next edit, as a typed message
  // does, so an old sentence does not sit under a new choice.
  //
  // A finished add goes too, whatever its outcome: once the source or the
  // address has changed, "The feed is in." is about a feed no longer in
  // view, and leaving it would offer the same add again.
  const changed = (): void => {
    setMessages({})
    setAdded(null)
    if (run.snapshot.state !== 'running') run.reset()
  }

  const chooseZip = async (): Promise<void> => {
    if (picking) return
    setPicking(true)
    try {
      const picked = await pickZip()
      // Escape may have closed the sheet while the chooser was up.
      if (picked === null || !dialogRef.current?.open) return
      setFile(picked)
      changed()
    } finally {
      setPicking(false)
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (adding || busy) return
    const trimmed = name.trim()
    const begin = (source: { file: string } | { url: string }): void => {
      if (elsewhere)
        return fail(
          'file' in source ? 'file' : 'url',
          'an earlier add is still finishing; try again once it has',
        )
      setMessages({})
      setAttempt((n) => n + 1)
      run.start(source, engine)
    }

    if (source === 'feed') {
      const nameProblem = validateName(trimmed)
      if (nameProblem !== null) return fail('name', nameProblem)
      const feedProblem = validateFeedKey(feed)
      if (feedProblem !== null) return fail('feed', feedProblem)
      // A project starts with its feed's own inputs when the registry is in
      // view, so a sample draws as the engine's site draws it (A2-02).
      const entry = feeds.find((f) => f.key === feed)
      void create(
        entry === undefined
          ? { name: trimmed, feed }
          : { name: trimmed, feed, mode: entry.mode, agency: entry.agency },
      )
      return
    }

    // The feed is in: this press makes the project on it, at every operator.
    if (added !== null) {
      const problem = validateName(trimmed)
      if (problem !== null) return fail('name', problem)
      void create({ name: trimmed, feed: added.key, mode: added.mode, agency: null })
      return
    }
    if (source === 'zip') {
      if (file === null) return fail('file', 'choose a GTFS zip first')
      return begin({ file: file.path })
    }
    const problem = validateFeedUrl(url)
    if (problem !== null) return fail('url', problem)
    begin({ url: url.trim() })
  }

  // Escape while an add is going cancels the add and keeps the sheet: a
  // person who changes their mind should see what happened. The platform
  // may close the dialog anyway on a second Escape (a cancel event is only
  // cancelable while the window holds an unspent activation), so the close
  // handler tells the parent whenever the element closed on its own.
  const cancel = (): void => {
    if (adding) {
      run.cancel()
      return
    }
    onCancel()
  }
  const closed = (): void => {
    if (adding) run.cancel()
    reset()
    if (open) onCancel()
  }

  const pickSource = (next: Source): void => {
    setSource(next)
    changed()
    if (next === 'feed' && !edited.current) setName(nameOf(feed) ?? '')
    if (next !== 'feed' && !edited.current) setName('')
  }

  // The zip's and the address's lines are alerts: the engine's refusal
  // arrives after the press, whenever the download ends. The name's and the
  // typed key's are not - a refusal there is said by moving focus into the
  // field that references it, and an alert as well would say it twice.
  const message = (id: Field): JSX.Element => (
    <p
      id={`${field(id)}-message`}
      className="message error"
      role={id === 'file' || id === 'url' ? 'alert' : undefined}
    >
      {messages[id]}
    </p>
  )

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${ids}-title`}
      aria-describedby={`${ids}-desc`}
      onCancel={(event) => {
        event.preventDefault()
        cancel()
      }}
      onClose={closed}
    >
      <form noValidate onSubmit={submit}>
        <h2 id={`${ids}-title`}>New project</h2>
        <p id={`${ids}-desc`} className="hint">
          A project draws one feed: a sample city, or a GTFS feed of your own from a file or an
          address.
        </p>
        <fieldset className="field source-choice" disabled={adding || busy}>
          <legend className="field-label">Start from</legend>
          {(
            [
              ['feed', 'A sample city, or a feed you added'],
              ['zip', 'A GTFS zip on this computer'],
              ['address', 'A feed at an address'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="check">
              <input
                type="radio"
                name={`${ids}-source`}
                value={value}
                checked={source === value}
                disabled={value !== 'feed' && !ready}
                onChange={() => pickSource(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>

        {source === 'feed' && (
          <div className="field">
            {listed ? (
              <>
                {/* The kit names the native select itself; this is the visible word. */}
                <span className="field-label" aria-hidden="true">
                  Feed
                </span>
                <Select
                  label="Feed"
                  value={feed}
                  onChange={(key) => {
                    setFeed(key)
                    setMessages({})
                    setName((current) => filledName(current, edited.current, nameOf(key)))
                  }}
                  className="feed-select"
                >
                  {[
                    ['Sample cities', presets],
                    ['Your feeds', yours],
                  ].map(([group, rows]) =>
                    (rows as FeedRecord[]).length === 0 ? null : (
                      <optgroup key={group as string} label={group as string}>
                        {(rows as FeedRecord[]).map((f) => {
                          const place = placeOf(f)
                          return (
                            <option key={f.key} value={f.key}>
                              {place === null ? f.name : `${f.name} (${place})`}
                            </option>
                          )
                        })}
                      </optgroup>
                    ),
                  )}
                </Select>
              </>
            ) : (
              <>
                <label htmlFor={field('feed')}>Feed key</label>
                <TextInput
                  id={field('feed')}
                  ref={feedRef}
                  size="large"
                  value={feed}
                  onChange={(value) => {
                    setFeed(value)
                    setMessages({})
                  }}
                  spellCheck={false}
                  aria-describedby={`${field('feed')}-message`}
                  aria-invalid={messages.feed ? true : undefined}
                />
                <p className="hint">
                  The engine is not ready to list the feeds, so the feed key is typed.
                </p>
              </>
            )}
            {message('feed')}
          </div>
        )}

        {source === 'zip' && (
          <div className="field">
            <span className="field-label" id={`${field('file')}-label`}>
              GTFS zip
            </span>
            <div className="toolbar">
              <Button
                ref={chooseRef}
                onClick={() => void chooseZip()}
                disabled={adding || busy || picking}
                aria-describedby={`${field('file')}-name ${field('file')}-message`}
              >
                <Icon name="layers" />
                Choose a zip
              </Button>
              <span id={`${field('file')}-name`} className="hint" aria-live="polite">
                {file === null ? 'No file chosen.' : file.name}
              </span>
            </div>
            {message('file')}
          </div>
        )}

        {source === 'address' && (
          <div className="field">
            <label htmlFor={field('url')}>Feed address</label>
            <TextInput
              id={field('url')}
              ref={urlRef}
              size="large"
              value={url}
              onChange={(value) => {
                setUrl(value)
                changed()
              }}
              placeholder="https://"
              spellCheck={false}
              disabled={adding || busy}
              aria-describedby={`${field('url')}-message`}
              aria-invalid={messages.url ? true : undefined}
            />
            {message('url')}
          </div>
        )}

        <div className="field">
          <label htmlFor={field('name')}>Name</label>
          <TextInput
            id={field('name')}
            ref={nameRef}
            size="large"
            value={name}
            onChange={(value) => {
              setName(value)
              edited.current = true
              setMessages({})
            }}
            disabled={adding}
            aria-describedby={
              source === 'feed'
                ? `${field('name')}-message`
                : `${field('name')}-message ${field('name')}-hint`
            }
            aria-invalid={messages.name ? true : undefined}
            aria-required={source === 'feed'}
          />
          {source !== 'feed' && (
            <p id={`${field('name')}-hint`} className="hint">
              Filled with the feed&rsquo;s own name once the feed is in, unless you type one.
            </p>
          )}
          {message('name')}
        </div>

        {source !== 'feed' && attempt > 0 && snapshot.state !== 'idle' && (
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
                : snapshot.state === 'done'
                  ? 'The feed is in.'
                  : (snapshot.message ?? 'Starting.')}
            </p>
          </section>
        )}

        <div className="actions">
          <Button ref={cancelRef} onClick={cancel}>
            {adding ? 'Cancel the add' : 'Cancel'}
          </Button>
          <Button variant="primary" type="submit" disabled={adding || busy}>
            {source !== 'feed' && added === null ? 'Add the feed' : 'Create'}
          </Button>
        </div>
      </form>
    </dialog>
  )
}
