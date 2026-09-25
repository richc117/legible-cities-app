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

/** The engine's log for a project's run: closed, and absent until a run has begun. */
export default function EngineLog({ run }: { run: LayoutRun }): JSX.Element | null {
  const [log, setLog] = useState<LogView>(() => logOf(run.job()))
  const [chosen, setChosen] = useState<OpenFor>(CLOSED)
  const [copied, setCopied] = useState<string | null>(null)
  const copying = useRef(false)
  const box = useRef<HTMLPreElement>(null)
  // Whether the newest line should keep itself in view. True until a person
  // scrolls away from the end, so reading back through a run is not undone
  // by the next line to arrive.
  const following = useRef(true)

  useEffect(() => {
    let frame: number | null = null
    const read = (): void => {
      frame = null
      const next = logOf(run.job())
      setLog((was) => (sameLog(was, next) ? was : next))
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
    if (open && following.current) toNewest(box.current)
  }, [open, log])

  if (log.id === null) return null

  const note = droppedNote(log.dropped)
  const copy = (): void => {
    if (copying.current) return
    const job = run.job()
    if (job === null) {
      setCopied(logNotCopied('the run is no longer listed'))
      return
    }
    copying.current = true
    setCopied(null)
    void copyLog(job, (text) => window.api.jobs.copyLog(text))
      .then(setCopied)
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
        label="The engine's log for this run"
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
            aria-label="The engine's log for this run"
            onScroll={() => {
              following.current = box.current === null || atBottom(box.current)
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
          {copied}
        </p>
      </Disclosure>
    </div>
  )
}
