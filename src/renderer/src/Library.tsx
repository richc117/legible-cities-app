import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { CreateProjectInput, ProjectSummary } from '../../shared/api'
import type { FeedRecord } from '../../shared/protocol'
import { sentenceFor } from './engine/feedAdd'
import { engineClient, feedAdd } from './engine/runs'
import AddFeedDialog from './AddFeedDialog'
import ConfirmDialog from './ConfirmDialog'
import CreateProjectDialog from './CreateProjectDialog'
import FeedList from './FeedList'
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
// dialog falls back to a typed key. Nothing polls: the list is read when
// the Library opens and after an add or a remove.
async function listFeeds(ready: boolean): Promise<FeedRecord[]> {
  if (!ready) return []
  try {
    return (await engineClient().request('feeds.list').result).feeds
  } catch {
    return []
  }
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

  const refreshFeeds = useCallback(async (): Promise<void> => {
    setFeeds(await listFeeds(ready))
  }, [ready])

  useEffect(() => {
    let cancelled = false
    void listFeeds(ready).then((listed) => {
      if (!cancelled) setFeeds(listed)
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
    await window.api.projects.create(input)
    setCreating(null)
    setLibrary({ status: 'ready', projects: await listProjects() })
  }

  const added = useCallback((): void => {
    setAdding(false)
    void refreshFeeds()
  }, [refreshFeeds])

  // The engine forgets the feed, its zip and its layouts; the main process
  // refuses first when a project names it, and that sentence is shown.
  const remove = async (): Promise<void> => {
    if (removing === null) return
    try {
      await engineClient().request('feeds.remove', { key: removing.key }).result
    } catch (error) {
      throw new Error(sentenceFor(error), { cause: error })
    }
    setRemoving(null)
    setFeedNotice(`${removing.name} was removed.`)
    await refreshFeeds()
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
        <Button onClick={() => setAdding(true)} disabled={!ready}>
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
          onNewProject={(feed) => setCreating({ feed: feed.key })}
          onRemove={(feed) => setRemoving(feed)}
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
        onCancel={() => setRemoving(null)}
      />
    </main>
  )
}
