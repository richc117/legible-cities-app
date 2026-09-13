import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { CreateProjectInput, ProjectSummary } from '../../shared/api'
import { ERROR_CODES, isEngineErrorShape } from '../../shared/engine'
import type { FeedRecord } from '../../shared/protocol'
import { sentenceFor } from './engine/feedAdd'
import { forgetFeedList, forgetInspection } from './engine/inspections'
import { engineClient, feedAdd } from './engine/runs'
import AddFeedDialog from './AddFeedDialog'
import ConfirmDialog from './ConfirmDialog'
import CreateProjectDialog from './CreateProjectDialog'
import FeedList, { FEEDS_HEADING_ID } from './FeedList'
import { afterRendering, focusLost } from './focusHandback'
import Icon from './icons/Icon'
import Button from './kit/Button'
import { useEngineState } from './useEngineState'

type LibraryState = { status: 'loading' } | { status: 'ready'; projects: ProjectSummary[] }

interface Props {
  /** A sentence carried over from the project view, such as what a delete could not remove. */
  notice: string | null
  onOpen: (id: string) => void
}

// list() never rejects by contract (an unreadable record is skipped and
// logged on the main side); if the bridge itself is unavailable an empty
// Library is the only thing there is to show.
async function listProjects(): Promise<ProjectSummary[]> {
  try {
    return await window.api.projects.list()
  } catch {
    return []
  }
}

// The feeds the engine lists; none when it cannot be asked, and the create
// dialog falls back to a typed key. Null when it was asked and the read
// failed: that says nothing about which feeds there are, so the list keeps
// what it last showed rather than empty itself (issue 107). Nothing polls:
// the list is read when the Library opens and after an add or a remove.
async function listFeeds(ready: boolean): Promise<FeedRecord[] | null> {
  if (!ready) return []
  try {
    return (await engineClient().request('feeds.list').result).feeds
  } catch {
    return null
  }
}

/**
 * What a removal says when the app stopped waiting for the engine (issue
 * 107): the request's deadline passed, or its inactivity bound. The engine
 * was asked to stop, but its file work may have been done, or half done, so
 * nothing here may claim either; the list is read again instead.
 */
export const UNANSWERED_REMOVAL =
  'The engine did not answer in time, so the feed may or may not have been removed. The list of feeds is read again to show what the engine has now.'

/** Whether a failed request ended because the app stopped waiting, leaving its outcome unknown. */
export function unanswered(error: unknown): boolean {
  return isEngineErrorShape(error) && error.code === ERROR_CODES.inactive
}

export default function Library({ notice, onOpen }: Props): JSX.Element {
  const [library, setLibrary] = useState<LibraryState>({ status: 'loading' })
  const [feeds, setFeeds] = useState<FeedRecord[]>([])
  const [creating, setCreating] = useState<{ feed?: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<FeedRecord | null>(null)
  const [feedNotice, setFeedNotice] = useState<string | null>(null)
  const engine = useEngineState()
  const ready = engine?.state === 'ready'
  const adder = feedAdd()
  const headingRef = useRef<HTMLHeadingElement>(null)
  // Where focus goes once the list has been drawn again, when the control
  // that held it went with the change: the empty state's "New project"
  // leaves with the empty state, a removed feed's row takes its Remove with
  // it. Only if focus did fall to nowhere; otherwise it is a person's
  // (A6-07).
  //
  // Two things have to have happened first, in whichever order they land:
  // the dialog has closed, which hands focus back to the control that
  // opened it, and the list has been drawn without that control. Judged
  // before both, focus is still in the dialog or on the opener and looks
  // held; the opener then goes and focus falls to the body with nobody
  // left to pick it up. The last step can come with no render of ours
  // after it - Chromium moves focus off a removed element at its next
  // rendering update - so the check runs on every render and once more
  // after the rendering has caught up with the action.
  const handBack = useRef<{ project: string } | { feed: string } | null>(null)
  const rows = useRef(new Map<string, HTMLButtonElement>())

  // Reads can overlap - the one when the engine becomes ready, one when a
  // removal went unanswered, another when its dialog closes - and only the
  // latest may set the list, or an older answer would put back a feed the
  // engine has since removed. Resolves with what it set, or null when a
  // later read superseded it or the read failed, and the list was left.
  const listing = useRef(0)
  const refreshFeeds = useCallback(async (): Promise<FeedRecord[] | null> => {
    const mine = ++listing.current
    forgetFeedList()
    const listed = await listFeeds(ready)
    if (listing.current !== mine || listed === null) return null
    setFeeds(listed)
    return listed
  }, [ready])
  // The feed whose removal went unanswered, while its dialog is open:
  // closing that dialog reads the list once more, because the engine may
  // finish the work after the app stopped waiting (issue 107). Cleared by a
  // removal that succeeds and by the dialog closing; a retry that is
  // refused - the engine saying the feed is not registered, once it has
  // finished - keeps it, so the close still reads the truth.
  const unansweredKey = useRef<string | null>(null)
  // The removal dialog's feed as last rendered, for a removal that ends
  // after the dialog was closed under it.
  const removingRef = useRef<FeedRecord | null>(null)
  useEffect(() => {
    removingRef.current = removing
  })

  useEffect(() => {
    let cancelled = false
    const mine = ++listing.current
    void listFeeds(ready).then((listed) => {
      if (!cancelled && listing.current === mine && listed !== null) setFeeds(listed)
    })
    return () => {
      cancelled = true
    }
  }, [ready])

  useEffect(() => {
    let cancelled = false
    void listProjects().then((projects) => {
      if (!cancelled) setLibrary({ status: 'ready', projects })
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Focus the heading when the screen appears, so a screen reader says
  // where the person is; on the way back from a project the element that
  // had focus no longer exists.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  // A rejection propagates to the dialog, which shows the message.
  const create = async (input: CreateProjectInput): Promise<void> => {
    const record = await window.api.projects.create(input)
    handBack.current = { project: record.id }
    setCreating(null)
    setLibrary({ status: 'ready', projects: await listProjects() })
    afterRendering(() => settleRef.current())
  }

  // The check, reading the state as last rendered so it can run outside a
  // render. Before the dialog has closed and the list been drawn it does
  // nothing. After, focus that is lost goes to the target; focus that looks
  // held is looked at once more after the rendering has caught up, and
  // only then left where it is, as a person's.
  const settleRef = useRef<(final?: boolean) => void>(() => undefined)
  useEffect(() => {
    settleRef.current = (final = false) => {
      const target = handBack.current
      if (target === null) return
      let focusTarget: HTMLElement | null
      if ('project' in target) {
        if (creating !== null) return
        focusTarget = rows.current.get(target.project) ?? null
        if (focusTarget === null) return
      } else {
        if (removing !== null || feeds.some((feed) => feed.key === target.feed)) return
        focusTarget = document.getElementById(FEEDS_HEADING_ID) ?? headingRef.current
      }
      if (focusLost(document.activeElement, document.body)) {
        handBack.current = null
        focusTarget?.focus()
      } else if (final) {
        handBack.current = null
      } else {
        afterRendering(() => settleRef.current(true))
      }
    }
    settleRef.current()
  })

  const added = useCallback((): void => {
    setAdding(false)
    void refreshFeeds()
  }, [refreshFeeds])

  // A cancelled add may still have kept the feed (the engine's check cannot
  // be interrupted once its download is done), so the list is read again.
  useEffect(() => {
    let previous = adder.snapshot.state
    return adder.subscribe((snapshot) => {
      if (snapshot.state === 'cancelled' && previous !== 'cancelled') void refreshFeeds()
      // A feed added anew under a key seen before is a new feed to inspect.
      if (snapshot.state === 'done' && snapshot.feed !== null) forgetInspection(snapshot.feed.key)
      previous = snapshot.state
    })
  }, [adder, refreshFeeds])

  // The engine forgets the feed, its zip and its layouts; the main process
  // refuses first when a project names it, and that sentence is shown.
  const remove = async (): Promise<void> => {
    if (removing === null) return
    try {
      await engineClient().request('feeds.remove', { key: removing.key }).result
    } catch (error) {
      if (unanswered(error)) {
        // The dialog shows the sentence at once and takes presses again. The
        // read is not awaited: the pinned engine runs a removal on the one
        // thread that reads requests, so the list is answered only once the
        // removal is done, and then shows it done.
        forgetInspection(removing.key)
        // Remembered only while this feed's dialog is open; one closed under
        // the removal (the platform's second Escape) has nothing to close.
        unansweredKey.current = removingRef.current?.key === removing.key ? removing.key : null
        void refreshFeeds()
        throw new Error(UNANSWERED_REMOVAL, { cause: error })
      }
      throw new Error(sentenceFor(error), { cause: error })
    }
    unansweredKey.current = null
    forgetInspection(removing.key)
    handBack.current = { feed: removing.key }
    // Only this removal's dialog: it may have been closed while the request
    // ran and opened again for another feed, which stays.
    const target = removing
    setRemoving((current) => (current === target ? null : current))
    setFeedNotice(`${removing.name} was removed.`)
    await refreshFeeds()
    afterRendering(() => settleRef.current())
  }

  return (
    <main className="panel library" aria-labelledby="library-heading">
      <h1 id="library-heading" tabIndex={-1} ref={headingRef}>
        Library
      </h1>
      <div className="toolbar">
        {/* The empty state carries the primary action instead, so a first
            visit has one thing to press (DESIGN.md 8.2). */}
        {!(library.status === 'ready' && library.projects.length === 0) && (
          <Button variant="primary" onClick={() => setCreating({})}>
            <Icon name="add" />
            New project
          </Button>
        )}
        <Button
          onClick={() => {
            setFeedNotice(null)
            setAdding(true)
          }}
          disabled={!ready}
        >
          <Icon name="layers" />
          Add feed
        </Button>
      </div>
      {notice && (
        <p role="alert" className="notice">
          {notice}
        </p>
      )}
      {library.status === 'ready' && library.projects.length === 0 && (
        <div className="empty">
          <Icon name="mark" size={24} />
          <p role="status" className="prose">
            No projects yet. Pick one of the feeds below, or add your own, and make a project from
            it.
          </p>
          <Button variant="primary" onClick={() => setCreating({})}>
            <Icon name="add" />
            New project
          </Button>
        </div>
      )}
      {library.status === 'ready' && library.projects.length > 0 && (
        <ul className="entries" aria-label="Projects">
          {library.projects.map((project) => (
            <li key={project.id}>
              <button
                ref={(element) => {
                  if (element === null) rows.current.delete(project.id)
                  else rows.current.set(project.id, element)
                }}
                type="button"
                className="entry"
                aria-label={`Open ${project.name}`}
                aria-describedby={`entry-${project.id}-meta`}
                onClick={() => onOpen(project.id)}
              >
                <span className="entry-name">{project.name}</span>
                <span className="entry-meta" id={`entry-${project.id}-meta`}>
                  <span>Feed {project.feed}</span>
                  <span>Service day {project.date ?? 'not yet chosen'}</span>
                  {project.readOnly && <span>read-only</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {feedNotice && (
        <p role="status" className="notice">
          {feedNotice}
        </p>
      )}
      {feeds.length > 0 && (
        <FeedList
          feeds={feeds}
          onNewProject={(feed) => {
            setFeedNotice(null)
            setCreating({ feed: feed.key })
          }}
          onRemove={(feed) => {
            setFeedNotice(null)
            handBack.current = null
            setRemoving(feed)
          }}
        />
      )}
      <CreateProjectDialog
        open={creating !== null}
        feeds={feeds}
        initialFeed={creating?.feed}
        onCreate={create}
        onCancel={() => setCreating(null)}
      />
      <AddFeedDialog
        open={adding}
        run={adder}
        engine={engine}
        pickZip={() => window.api.feeds.pickZip()}
        onAdded={added}
        onCancel={() => setAdding(false)}
      />
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.name ?? ''}?`}
        description="This forgets the feed, its downloaded zip and the layouts made from it. Projects on it would have nothing to draw, so a feed a project uses cannot be removed."
        confirmLabel="Remove"
        onConfirm={remove}
        onCancel={() => {
          const key = unansweredKey.current
          unansweredKey.current = null
          setRemoving(null)
          if (key === null || removing?.key !== key) return
          // The truth once more. If the feed has gone, the row whose Remove
          // opened the dialog went with it, and focus goes to the heading;
          // a read that failed or was superseded changes nothing here.
          void refreshFeeds().then((listed) => {
            if (listed === null || listed.some((feed) => feed.key === key)) return
            handBack.current = { feed: key }
            afterRendering(() => settleRef.current())
          })
        }}
        busyLabel={`Removing ${removing?.name ?? 'the feed'}…`}
        onLateError={(message) => setFeedNotice(message)}
      />
    </main>
  )
}
