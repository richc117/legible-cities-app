import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { MAX_LOG_LINES, type Job } from '../../../shared/jobs'
import type { LayoutRun } from '../engine/layoutRun'
import { copyLog, logNotCopied } from '../Jobs'
import Button from '../kit/Button'
import Disclosure from '../kit/Disclosure'

// The engine's log for the run that is going, inside cell 02 (A5.5-13).
//
// The lines already reach the renderer: every `job/log` notification
// crosses the bridge on `CHANNELS.engineLog`, the typed client fans it out
// by request token, and the run pushes its own into a `LogBuffer`. Until
// now the only thing that read that buffer was "Copy log" in the jobs
// inspector, so a run doing something inexplicable could be watched but not
// read. This puts the same bytes under the stages doing the work.
//
// Two things it is careful about.
//
// **Where the lines come from.** The content is always the run's own buffer
// - `run.job()!.log` - so a feed add going at the same time can never put a
// line in this panel. The bridge's `onLog` is subscribed to only as a
// signal that there is something new to read: it fires for every engine
// request in the renderer, and it fires for every line this run produces,
// which makes it exactly the right tick and never the source. The read is
// coalesced onto an animation frame, because LOOM prints thousands of lines
// in one stage and a render each would be a render each.
//
// **The bound.** Nothing new is kept here at all: the panel draws the
// buffer the run already bounds at `MAX_LOG_LINES` (200) with the earlier
// lines counted, and says so under the box when any have been dropped. The
// renderer writes nothing to disk; `engine.log` in the platform's log
// folder is where the rest is, and the main process put it there.
//
// **Redaction** is the main process's, twice over, and none of it is here.
// A line arrives with its secrets already out: `src/main/engine-ipc.ts`
// redacts every `job/log` line at the one door they come through, so what
// this draws, what the run buffers and what a copy is made from are the
// same redacted bytes (A5.5-13). "Copy log" then sends the composed text to
// `window.api.jobs.copyLog`, which redacts again - the function is stable
// under a second pass - and writes the home folder as `~`, which only that
// side can do, before anything reaches the clipboard. There is deliberately
// no second implementation on this side: `src/main/redact.ts` is the main
// project's, the renderer cannot import it, and a copy of it here is the
// thing that goes stale.

/**
 * The two names in this panel, which have to differ, because one is inside
 * the other: the disclosed part holds the box of lines, the note about
 * dropped ones and "Copy log", while the box holds only the lines. Giving
 * them the same name put the same group name twice in a screen reader's
 * path with nothing to tell the inner one from the outer, and made
 * `getByRole` ambiguous, which is how it was found.
 *
 * The box is named at all - rather than having its role and label removed -
 * because it scrolls and takes focus, and an unnamed focusable scroll box
 * is worse than a duplicated name: a person tabs into it and is told
 * nothing about where they have landed.
 *
 * It is a named `group` and deliberately **not** `role="log"`, which is the
 * role for this content and would have made the two distinct on its own.
 * `log` carries an implicit `aria-live="polite"`, and the thing it would
 * announce is every line of a run as it arrives - LOOM alone prints
 * thousands in one stage - read out over whatever else the person is doing,
 * unstoppable except by closing the disclosure they opened to read. The run
 * already says what it is doing, once per stage, in the progress line's own
 * sentence. Overriding the role with `aria-live="off"` would work and would
 * leave a role in the markup that says the opposite of what the element
 * does. `group` says what this is: a named box a person goes to and reads.
 */
export const PANEL_LABEL = "The engine's log for this run"
export const LINES_LABEL = 'Log lines'

/** The lines on screen and which job they belong to. */
export interface LogView {
  /** The job the lines came from; null when the run has never started. */
  id: string | null
  lines: string[]
  /** How many earlier lines the run's buffer dropped to stay inside its bound. */
  dropped: number
}

export const NO_LOG: LogView = { id: null, lines: [], dropped: 0 }

/** What a job's log looks like to this panel; nothing at all before a run. */
export function logOf(job: Job | null): LogView {
  return job === null ? NO_LOG : { id: job.id, lines: job.log, dropped: job.dropped }
}

/**
 * Whether two reads say the same thing, so a tick that brought nothing
 * costs no render. The last line is compared as well as the count, because
 * a `LogBuffer` can replace its last line rather than push a new one.
 */
export function sameLog(a: LogView, b: LogView): boolean {
  return (
    a.id === b.id &&
    a.dropped === b.dropped &&
    a.lines.length === b.lines.length &&
    a.lines[a.lines.length - 1] === b.lines[b.lines.length - 1]
  )
}

/**
 * One read of the panel's content, and the whole of it: the run's own job,
 * whatever prompted the read, with the previous view kept when nothing has
 * moved so a tick that brought nothing costs no render.
 *
 * This is where "a feed add going at the same time can never put a line in
 * this panel" is true rather than merely intended. The bridge's `onLog`
 * fires for every engine request in the renderer, this one included, so it
 * is the right thing to wake on and never a thing to read: the listener it
 * is given takes no argument at all - `() => void`, which the compiler
 * holds - and the content comes from `run.job()` here. A line belonging to
 * another request reaches this function only if that run's own buffer
 * holds it, which is to say never.
 */
export function readLog(run: Pick<LayoutRun, 'job'>, was: LogView): LogView {
  const next = logOf(run.job())
  return sameLog(was, next) ? was : next
}

/** How many lines there are, in the words the row says them. */
export function lineCount(lines: number): string {
  if (lines === 0) return 'no lines yet'
  return lines === 1 ? '1 line' : `${lines} lines`
}

/**
 * What the panel says when the run's buffer has dropped lines: the bound it
 * keeps, in figures, and where the rest of them are. Null when none were
 * dropped, because a bound nothing has reached is not news.
 */
export function droppedNote(dropped: number, kept = MAX_LOG_LINES): string | null {
  if (dropped <= 0) return null
  const earlier = dropped === 1 ? '1 earlier line is' : `${dropped} earlier lines are`
  return `The last ${kept} lines are kept here; ${earlier} in engine.log in the logs folder.`
}

/**
 * Which run the person opened the disclosure for. The state is per run
 * rather than per panel: it starts closed, stays where it was put for as
 * long as that run's lines are on screen, and closes again by itself when
 * the next run opens a job of its own.
 */
export interface OpenFor {
  id: string | null
  open: boolean
}

export const CLOSED: OpenFor = { id: null, open: false }

export function isOpen(chosen: OpenFor, jobId: string | null): boolean {
  return jobId !== null && chosen.open && chosen.id === jobId
}

/**
 * Whether the box is following its newest line, and for which run. Every
 * piece of state in this panel is stamped with a job id for the same
 * reason: the component outlives the run it is drawing - cell 02 stays
 * mounted from one run to the next - so anything not stamped is run 1's
 * answer still being used for run 2.
 *
 * A run nobody has scrolled in is followed. That is what makes the id
 * matter here: without it, a person who scrolled back through run 1 turned
 * the following off for every run after it, and run 2's box sat at the top
 * while its lines piled up below.
 */
export interface Follow {
  id: string | null
  /** Whether the person left the box resting at its end in that run. */
  at: boolean
}

export const FOLLOWING: Follow = { id: null, at: true }

export function isFollowing(follow: Follow, jobId: string | null): boolean {
  return follow.id !== jobId || follow.at
}

/** What the copy last said, and for which run; another run's sentence is not shown. */
export interface Said {
  id: string | null
  text: string | null
}

export const SAID_NOTHING: Said = { id: null, text: null }

export function saidFor(said: Said, jobId: string | null): string | null {
  return said.id === jobId ? said.text : null
}

/** As much of a scrolling element as the two functions below need. */
export interface Box {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/**
 * Slack for a scroll position that is a fraction of a pixel off its end,
 * which is what a scaled display gives. Not a design value: nothing is
 * drawn at this size.
 */
const NEAR_BOTTOM = 2

/** Whether the box is resting at its end, so the newest line should follow. */
export function atBottom(box: Box): boolean {
  return box.scrollHeight - box.scrollTop - box.clientHeight <= NEAR_BOTTOM
}

/**
 * Put the newest line in view by moving the box's own scroll and nothing
 * else. Never `scrollIntoView`, which scrolls every scrollable ancestor to
 * do it and would take the notebook's column with it, out from under the
 * pinned preview, every time a line arrived.
 */
export function toNewest(box: Box | null): void {
  if (box === null) return
  box.scrollTop = box.scrollHeight
}

/**
 * A run's job with the project named on it, for the copy.
 *
 * `LayoutRun.job()` leaves `projectName` null on purpose - a run knows its
 * project only by id, and whoever lists the jobs fills the name in - so the
 * jobs inspector copies through the registry, which names it. A copy made
 * straight from `run.job()` composes its heading through `jobSubject`,
 * which falls back to "A project": cell 02's copied log said that where the
 * inspector's, for the same run, said the project's name, and a bug report
 * pasted from cell 02 did not say which project it was about.
 *
 * The name comes from the cell rather than from the registry because the
 * cell is on the project's screen and already has the record; the
 * registry's names are a cache the inspector fills when it opens, so a
 * person who has never opened it would still get "A project".
 */
export function named(job: Job, projectName: string | null): Job {
  return job.projectName === projectName ? job : { ...job, projectName }
}

/** The engine's log for a project's run: closed, and absent until a run has begun. */
export default function EngineLog({
  run,
  projectName,
}: {
  run: LayoutRun
  /** The project's own name, for the copied log's heading. */
  projectName: string
}): JSX.Element | null {
  const [log, setLog] = useState<LogView>(() => logOf(run.job()))
  const [chosen, setChosen] = useState<OpenFor>(CLOSED)
  const [said, setSaid] = useState<Said>(SAID_NOTHING)
  const copying = useRef(false)
  const box = useRef<HTMLPreElement>(null)
  // Whether the newest line should keep itself in view, for the run it was
  // decided in: true until a person scrolls away from the end, so reading
  // back through a run is not undone by the next line to arrive, and true
  // again for the next run, which they have not scrolled in.
  const follow = useRef<Follow>(FOLLOWING)

  useEffect(() => {
    let frame: number | null = null
    const read = (): void => {
      frame = null
      setLog((was) => readLog(run, was))
    }
    const bump = (): void => {
      if (frame === null) frame = requestAnimationFrame(read)
    }
    bump()
    const offRun = run.subscribe(bump)
    const offLog = window.api.engine.onLog(bump)
    return () => {
      offRun()
      offLog()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [run])

  const open = isOpen(chosen, log.id)

  // The box's own scroll, after the lines have been laid out: on a new line
  // while it is resting at the end, and when it opens, since a hidden box
  // has no height to scroll.
  useLayoutEffect(() => {
    if (open && isFollowing(follow.current, log.id)) toNewest(box.current)
  }, [open, log])

  if (log.id === null) return null

  const note = droppedNote(log.dropped)
  const copy = (): void => {
    if (copying.current) return
    const job = run.job()
    if (job === null) {
      setSaid({ id: log.id, text: logNotCopied('the run is no longer listed') })
      return
    }
    copying.current = true
    setSaid({ id: job.id, text: null })
    void copyLog(named(job, projectName), (text) => window.api.jobs.copyLog(text))
      .then((text) => setSaid({ id: job.id, text }))
      .finally(() => {
        copying.current = false
      })
  }

  return (
    <div className="engine-log">
      <Disclosure
        className="engine-log-toggle"
        open={open}
        onToggle={(next) => setChosen({ id: log.id, open: next })}
        label={PANEL_LABEL}
        summary={
          <>
            Engine log <span className="engine-log-count">{lineCount(log.lines.length)}</span>
          </>
        }
      >
        {log.lines.length === 0 ? (
          <p className="hint">The engine has not said anything yet.</p>
        ) : (
          <pre
            className="engine-log-lines"
            ref={box}
            tabIndex={0}
            role="group"
            aria-label={LINES_LABEL}
            onScroll={() => {
              follow.current = {
                id: log.id,
                at: box.current === null || atBottom(box.current),
              }
            }}
          >
            {log.lines.join('\n')}
          </pre>
        )}
        {note !== null && <p className="hint">{note}</p>}
        <div className="toolbar">
          <Button aria-label="Copy log: the engine's log for this run" onClick={copy}>
            Copy log
          </Button>
        </div>
        <p className="message" role="status" aria-live="polite">
          {saidFor(said, log.id)}
        </p>
      </Disclosure>
    </div>
  )
}
