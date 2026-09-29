import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { CreateProjectInput, ProjectSummary } from '../../shared/api'
import { ERROR_CODES, isEngineErrorShape } from '../../shared/engine'
import type { FeedRecord } from '../../shared/protocol'
import { uniqueName } from '../../shared/project'
import { sentenceFor } from './engine/feedAdd'
import { forgetFeedList, forgetInspection } from './engine/inspections'
import { engineClient, feedAdd, peekLayoutRun, subscribeToRuns } from './engine/runs'
import ConfirmDialog from './ConfirmDialog'
import NewProjectSheet, { type SheetStart } from './NewProjectSheet'
import FeedList, { FEEDS_HEADING_ID } from './FeedList'
import SampleCities, { SAMPLES_HEADING_ID } from './SampleCities'
import { afterRendering, focusLost } from './focusHandback'
import Icon from './icons/Icon'
import Button from './kit/Button'
import Time from './notebook/Time'
import { progressWords } from './projectProgress'
import { useEngineState } from './useEngineState'

type LibraryState = { status: 'loading' } | { status: 'ready'; projects: ProjectSummary[] }

interface Props {
  /** A sentence carried over from the project view, such as what a delete could not remove. */
  notice: string | null
  /** Open a project; `layOut` starts its layout as it opens (a sample city, A5.6-03). */
  onOpen: (id: string, layOut?: boolean) => void
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

// The feeds the engine lists; none when it cannot be asked, and the New
// project sheet falls back to a typed key. Null when it was asked and the read
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

/**
 * What a first start says about the app, in one sentence, above the sample
 * cities (A5.6-01). A person who has made nothing yet arrives with one
 * question - what is this - and the samples are the answer they can press.
 */
export const INTRODUCTION =
  'Legible Cities draws a transit network as a schematic map and plays a day of its service on it: start from a sample city below, or add a feed of your own.'

/** What the samples region says while the engine cannot list them. */
export const SAMPLES_AWAY =
  'The sample cities are listed once the engine is ready; the status line above says what it is doing.'

/** What it says when the engine is ready and its answer to `feeds.list` failed. */
export const SAMPLES_UNREAD =
  'The engine did not list the sample cities this time. They are read again when this screen opens.'

/** What it says when the engine answered and holds no presets at all. */
export const SAMPLES_NONE = 'The engine lists no sample cities.'

/**
 * What the samples region holds when there are no presets to draw: which
 * of the three reasons it is, or nothing while the first read is still on
 * its way - a sentence saying the engine is not ready, under a status line
 * that says it is, would be the screen contradicting itself for a beat.
 */
export function samplesSentence(ready: boolean, read: FeedsRead): string | null {
  if (!ready) return SAMPLES_AWAY
  if (read === 'failed') return SAMPLES_UNREAD
  if (read === 'listed') return SAMPLES_NONE
  return null
}

/** Whether the feeds have been read since the screen opened, and how that went. */
export type FeedsRead = 'unread' | 'listed' | 'failed'

// The front door (A5.6-01, ADR-045). The screen answers the question a
// person arrives with. With no projects it is the sample cities, under one
// sentence saying what the app is; with projects it is the projects list,
// with the samples still below it. The feeds a person added are a region
// of their own after both (A5.6-06).

/** What the sheet is given while it is shut; one object, so its effect does not see a new start on every render. */
const NO_START: SheetStart = { source: 'feed' }

export default function Library({ notice, onOpen }: Props): JSX.Element {
  const [library, setLibrary] = useState<LibraryState>({ status: 'loading' })
  const [feeds, setFeeds] = useState<FeedRecord[]>([])
  const [feedsRead, setFeedsRead] = useState<FeedsRead>('unread')
  // What the New project sheet opens on, while it is open (A5.6-05).
  const [creating, setCreating] = useState<SheetStart | null>(null)
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
    if (listing.current !== mine) return null
    if (listed === null) {
      setFeedsRead('failed')
      return null
    }
    setFeeds(listed)
    setFeedsRead('listed')
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
      if (cancelled || listing.current !== mine) return
      if (listed === null) {
        setFeedsRead('failed')
        return
      }
      setFeeds(listed)
      setFeedsRead('listed')
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

  // A project's run goes on while this screen is open (the runs outlive the
  // views that started them), and its row says how far the project has got
  // (A5.6-04). So the rows follow the runs' states: a change of state
  // redraws them, and a run that stops has written its record, so the list
  // is read again. Keyed on the states alone, because a run tells its
  // listeners about every progress tick and the list must not be read on
  // each of those.
  const projectIds =
    library.status === 'ready' ? library.projects.map((project) => project.id).join(',') : ''
  const [runStates, setRunStates] = useState('')
  useEffect(() => {
    const ids = projectIds === '' ? [] : projectIds.split(',')
    const key = (): string =>
      ids.map((id) => `${id}:${peekLayoutRun(id)?.snapshot.state ?? 'none'}`).join(',')
    setRunStates(key())
    return subscribeToRuns(() => setRunStates(key()))
  }, [projectIds])
  const firstStates = useRef(true)
  useEffect(() => {
    // Not on the first key, which is the list just read.
    if (firstStates.current) {
      firstStates.current = runStates === ''
      return
    }
    let cancelled = false
    void listProjects().then((projects) => {
      if (!cancelled) setLibrary({ status: 'ready', projects })
    })
    return () => {
      cancelled = true
    }
  }, [runStates])

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
        // The added feeds' heading while any are left; once the last one
        // has gone its region goes too, and the samples' heading is the
        // nearest thing still there.
        focusTarget =
          document.getElementById(FEEDS_HEADING_ID) ??
          document.getElementById(SAMPLES_HEADING_ID) ??
          headingRef.current
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

  // A feed added from the sheet is listed at once, whether or not the
  // project it was added for is then created.
  const added = useCallback((): void => {
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
    // The engine said the feed is gone. A read that failed, or was overtaken
    // by one still on its way, must not leave its row on screen with a
    // Remove that works, under the sentence that says it went.
    if ((await refreshFeeds()) === null) {
      setFeeds((current) => current.filter((feed) => feed.key !== target.key))
    }
    afterRendering(() => settleRef.current())
  }

  const presets = feeds.filter((feed) => feed.source === 'preset')
  const samples = samplesSentence(ready, feedsRead)
  const addedFeeds = feeds.filter((feed) => feed.source === 'user')
  const startFrom = (feed: FeedRecord): void => {
    setFeedNotice(null)
    setCreating({ source: 'feed', feed: feed.key })
  }
  // A sample city opens in one press (A5.6-03): the project is made from the
  // registry's entry - its name, its mode, its operator - and its notebook
  // opens at once with the layout starting, so a person presses a city and
  // lands in a notebook that is already working. The layout reports in cell
  // 02 and so does anything that fails. A preset's download happens inside
  // that layout: since engine v0.10.0 it reports stage download and stops on
  // a cancel (E36), which the line does not draw yet (issue 178). A second
  // press while the first is being made is the same press.
  const opening = useRef(false)
  const projectNames = library.status === 'ready' ? library.projects.map((p) => p.name) : []
  const openSample = async (feed: FeedRecord): Promise<void> => {
    if (opening.current) return
    opening.current = true
    setFeedNotice(null)
    try {
      const record = await window.api.projects.create({
        // "LA Metro Rail 2" when there is already an "LA Metro Rail".
        name: uniqueName(feed.name, projectNames),
        feed: feed.key,
        mode: feed.mode,
        agency: feed.agency,
      })
      onOpen(record.id, true)
    } catch (error) {
      // Nothing was made, so there is no notebook to say it in. The guard
      // comes down here only: on success the screen is replaced, and letting
      // it down before that render would let a queued click make a second
      // project and orphan the first.
      opening.current = false
      setFeedNotice(
        `${feed.name} could not be opened: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  const askToRemove = (feed: FeedRecord): void => {
    setFeedNotice(null)
    handBack.current = null
    setRemoving(feed)
  }

  return (
    <main className="panel library" aria-labelledby="library-heading">
      <h1 id="library-heading" tabIndex={-1} ref={headingRef}>
        Library
      </h1>
      <div className="toolbar">
        {/* The empty state carries the primary action instead, so a first
            visit has one thing to press (DESIGN.md 8.2). */}
        {/* Not while the projects are still being read: the sheet numbers
            the name it fills against them ("LA Metro Rail 2"), as the
            sample cards do, which wait for the same list. */}
        {library.status === 'ready' && library.projects.length > 0 && (
          <Button variant="primary" onClick={() => setCreating({ source: 'feed' })}>
            <Icon name="add" />
            New project
          </Button>
        )}
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
            {INTRODUCTION}
          </p>
          <Button variant="primary" onClick={() => setCreating({ source: 'feed' })}>
            <Icon name="add" />
            New project
          </Button>
        </div>
      )}
      {library.status === 'ready' && library.projects.length > 0 && (
        <section className="front-door-region" aria-labelledby="projects-heading">
          <h2 id="projects-heading">Your projects</h2>
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
                    <span>
                      {project.opened === null ? 'Made ' : 'Opened '}
                      <Time iso={project.opened ?? project.created} />
                    </span>
                    <span>
                      {progressWords(project, peekLayoutRun(project.id)?.snapshot ?? null)}
                    </span>
                    {project.readOnly && <span>read-only</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {feedNotice && (
        <p role="status" className="notice">
          {feedNotice}
        </p>
      )}
      {/* Drawn once the projects are read, so the regions do not trade
          places under a person's eyes when a returning start finds some. */}
      {library.status === 'ready' && (
        <SampleCities
          presets={presets}
          sentence={samples}
          onOpen={(feed) => void openSample(feed)}
        />
      )}
      {library.status === 'ready' && addedFeeds.length > 0 && (
        <FeedList
          feeds={addedFeeds}
          heading="Your feeds"
          headingId={FEEDS_HEADING_ID}
          listName="Added"
          onNewProject={startFrom}
          onRemove={askToRemove}
        />
      )}
      {/* One sheet for every way a project starts (A5.6-05): a listed feed,
          a zip or an address. Adding a feed is part of starting a project on
          it; the feed stays listed if the project is then not made. */}
      <NewProjectSheet
        open={creating !== null}
        start={creating ?? NO_START}
        feeds={feeds}
        run={adder}
        engine={engine}
        pickZip={() => window.api.feeds.pickZip()}
        onCreate={create}
        onAdded={added}
        taken={projectNames}
        onCancel={() => setCreating(null)}
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
          // opened the dialog went with it, and focus goes to the heading. A
          // read that failed or was overtaken changes no list, but an earlier
          // read may already have taken the row, so focus is still looked
          // after; the check does nothing while the feed is listed.
          void refreshFeeds().then((listed) => {
            if (listed !== null && listed.some((feed) => feed.key === key)) return
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
