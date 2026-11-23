// What a quit says of itself, and what is left when it does not finish
// (issue 749).
//
// An end-to-end repeat once found the app still running twenty seconds after
// it had accepted a quit and stopped its engine, and `main.log` held nothing
// of the quit, so nothing said where it had stopped. This is the record a
// quit leaves from now on. It is a diagnosis and changes nothing a quit
// does, in what order, or when:
//
// - **The trail.** Each step of a quit is one line under `[quit]` in
//   `main.log`, said where the step happens and before the step acts: the
//   guard's (quit-guard.ts), the gate's and the shutdown's
//   (window-lifecycle.ts), and Electron's events as index.ts hears them. A
//   line is a state - held, let through, stopped - and never a project's
//   name, a path or an address.
// - **After the files close.** The log files close in `will-quit`, and what
//   a quit does after that - it asks itself to quit once more, passes
//   `before-quit` and `will-quit` again, and is then Electron's to end -
//   reached standard error in development and nowhere else. From the moment
//   the files are closing, the trail's lines are appended to `main.log`
//   through a way in of this module's own (`lateLog`): one handle, opened as
//   `will-quit` begins, and one write a line, asked for as the line is said.
//   A write is not waited for, so the very last lines can lose a race with
//   the process ending; a quit that stalls has all the time they need.
// - **The report.** From the moment the quit is let go on to Electron - the
//   engine stopped and the app asking itself to quit, or no engine to stop -
//   a process still there after `QUIT_OVERDUE_MS[0]` writes once what is
//   left: every window, the captures, the exports, how far the trail got and
//   what Node's loop holds. It writes once more at `QUIT_OVERDUE_MS[1]`, so
//   a slow quit and a stuck one can be told apart. It reports and does
//   nothing else: no window is closed and no exit is forced. A report can
//   only be written while the main process still runs its timers; a process
//   held after Electron's own `quit` event writes none, and the trail's last
//   lines are what say so.
//
// Nothing here may throw into a quit or keep the process: every line and
// every read is guarded, the timers are unref'd, and nothing is awaited.
//
// No Electron import: a window is read through the few methods `WindowLike`
// names, so the tests hand in stand-ins.

import { constants, open as openFile, write as writeFile } from 'node:fs'
import { LOG_WAIT_MS } from './log-file'
import { redactUrls } from './redact'

/** The tag every line of a quit is logged under. */
export const QUIT_TAG = 'quit'

/**
 * How long after the quit is let go on to Electron each report is written,
 * while the process is still there.
 *
 * The first is the longest a quit may take by its own rules, and a second
 * over: `will-quit` waits at most `LOG_WAIT_MS` for the window's place to be
 * kept and at most `LOG_WAIT_MS` again for the log files to close, and
 * everything else between the engine's stop and the process's end takes
 * milliseconds on a machine that is keeping up. A process still there after
 * that is late for a reason the quit's own waits do not give.
 *
 * The second is three times the first: far enough on that whatever was only
 * slow has gone, and inside the twenty seconds the end-to-end suite gives a
 * quit before it calls the app stuck and starts asking it again, which would
 * change what is left to see.
 */
export const QUIT_OVERDUE_MS = [2 * LOG_WAIT_MS + 1_000, 15_000] as const

/** How many of a quit's lines are kept for the report; the newest are. */
export const STEPS_KEPT = 120

/** Where the interface's own pages live: what tells its window from another. Compared, never written. */
const INTERFACE_PAGES = 'app://local/ui/'

/** The slice of a `BrowserWindow` the report reads. */
export interface WindowLike {
  isDestroyed(): boolean
  isVisible(): boolean
  readonly webContents?: {
    isDestroyed(): boolean
    getURL(): string
    isOffscreen(): boolean
    isCrashed(): boolean
  } | null
}

/** What the report is made from, each read when it is written and each allowed to throw. */
export interface LeftFacts {
  /** Every window Electron still holds (`BrowserWindow.getAllWindows`). */
  windows: () => readonly WindowLike[]
  /** The app's own window, or null once it has closed. */
  appWindow: () => unknown
  /** The captures running (`liveCaptures`). */
  captures: () => number
  /**
   * The exporter's two counts: the exports not yet unwound (`Exporter.live`),
   * and those of them not yet asked to stop (`Exporter.running`). Null before
   * there is an exporter.
   */
  exports: () => { live: number; running: number } | null
  /** What keeps Node's loop alive, a name each (`process.getActiveResourcesInfo`). */
  resources: () => readonly string[]
}

const UNREAD = 'could not be read'

/** One fact, or the words saying it could not be read: a window half gone throws from anything. */
function read(fact: () => string): string {
  try {
    return fact()
  } catch {
    return UNREAD
  }
}

/**
 * One window, as the report says it. `isDestroyed()` on the window comes
 * first and, for a destroyed one, last: every other read of it throws. Then
 * its web contents' own `isDestroyed()`, before anything else of them is
 * touched. Which kind it is - the interface's, a capture's, another - is
 * judged from whether it is the window the app holds, where its page lives
 * and whether it draws offscreen, as only a capture's does; the address is
 * compared and never written.
 */
function describeWindow(window: WindowLike, own: boolean): string {
  if (window.isDestroyed())
    return `${own ? "the app's own window" : 'not the window the app holds'}; destroyed`
  // Its web contents, or null where they are gone or cannot be reached; and
  // whether they could be asked at all.
  let contents: NonNullable<WindowLike['webContents']> | null = null
  let asked = true
  try {
    const held = window.webContents ?? null
    if (held !== null && !held.isDestroyed()) contents = held
  } catch {
    asked = false
  }
  const live = contents
  const kind = read(() => {
    if (own) return "the interface's, the app's own window"
    if (live === null) return 'of a kind that cannot be told without its web contents'
    if (live.getURL().startsWith(INTERFACE_PAGES))
      return "the interface's, but not the window the app holds"
    return live.isOffscreen() ? "a capture's" : 'of another kind'
  })
  const visible = read(() => (window.isVisible() ? 'visible' : 'hidden'))
  const renderer =
    live === null
      ? `web contents ${asked ? 'destroyed' : UNREAD}`
      : `web contents not destroyed, renderer ${read(() => (live.isCrashed() ? 'crashed' : 'running'))}`
  return `${kind}; not destroyed; ${visible}; ${renderer}`
}

/** `Timeout 2, FSReqCallback 1`: the most of a kind first, then by name. */
function byKind(names: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const name of names) counts.set(String(name), (counts.get(String(name)) ?? 0) + 1)
  return [...counts]
    .sort(([a, n], [b, m]) => m - n || a.localeCompare(b))
    .map(([name, count]) => `${name} ${count}`)
    .join(', ')
}

/**
 * What is left of the app, a line each, for a quit that has not finished:
 * the windows, the captures, the exports and what Node's loop holds. Never
 * throws: a fact that cannot be read is said to be unreadable, and the
 * others are still read.
 */
export function whatIsLeft(facts: LeftFacts): string[] {
  const lines: string[] = []
  try {
    const windows = facts.windows()
    let own: unknown = null
    try {
      own = facts.appWindow()
    } catch {
      // Then no window is called the app's own.
    }
    if (windows.length === 0) lines.push('windows: none')
    windows.forEach((window, index) => {
      const said = read(() => describeWindow(window, own !== null && window === own))
      lines.push(`window ${index + 1} of ${windows.length}: ${said}`)
    })
  } catch {
    lines.push(`windows: ${UNREAD}`)
  }
  lines.push(`captures still running: ${read(() => String(facts.captures()))}`)
  lines.push(
    `exports: ${read(() => {
      const exports = facts.exports()
      if (exports === null) return 'no exporter yet'
      return `${exports.live} not yet unwound, ${exports.running} of them not yet asked to stop`
    })}`,
  )
  lines.push(
    `what Node's loop holds, by kind: ${read(() => {
      const held = byKind(facts.resources())
      return held === '' ? 'nothing' : held
    })}`,
  )
  return lines
}

/** What a trail is handed. */
export interface QuitTrailDeps {
  /**
   * One line to the log under the quit's tag: the files while they are open,
   * and afterwards whatever the log does with a line it has nowhere to put.
   */
  log: (line: string) => void
  /** Lines straight to `main.log`, for once the files are closing (`lateLog`). */
  late: (lines: readonly string[]) => void
  /** What is left, a line each, read as a report is written (`whatIsLeft`). */
  left: () => readonly string[]
  /** A clock that only goes forward, in milliseconds. */
  now: () => number
  /** `setTimeout`. The trail unrefs what it is handed back: its timers never keep the process. */
  timer: (run: () => void, ms: number) => { unref(): unknown }
  /** When each report is written, in milliseconds after `watch()`: `QUIT_OVERDUE_MS`, unless a test says. */
  overdue?: readonly number[]
}

/** A length of time for a person: `5 s`, `15.2 s`. */
const seconds = (ms: number): string => `${Math.round(ms / 100) / 10} s`

/**
 * The quit's lines, and its reports. One for the life of the process:
 * index.ts hands `say` to the guard, the gate and the shutdown, and calls it
 * for Electron's own events.
 */
export class QuitTrail {
  readonly #deps: QuitTrailDeps
  /** The lines said, newest last, each with the clock's reading. */
  #steps: { at: number; line: string }[] = []
  /** Lines said before the oldest one kept. */
  #dropped = 0
  /** The log files are closing or closed: lines go straight to the file as well. */
  #late = false
  /** The clock's reading when the watch began, or null before it. */
  #watched: number | null = null
  /** The reports written, by their place in `overdue`. */
  readonly #reported = new Set<number>()

  constructor(deps: QuitTrailDeps) {
    this.#deps = deps
  }

  /** One step of a quit, as it happens. Never throws, never waits. */
  say(line: string): void {
    try {
      this.#steps.push({ at: this.#deps.now(), line })
      if (this.#steps.length > STEPS_KEPT) {
        this.#steps.shift()
        this.#dropped += 1
      }
    } catch {
      // The line is still said, though no report will show it.
    }
    this.#write([line])
  }

  /**
   * The log files are about to be closed, and take no line after this: from
   * here every line goes straight to `main.log` as well.
   */
  filesClosing(): void {
    this.#late = true
  }

  /**
   * The quit is Electron's from here: start the clock, once. A process still
   * there at each of `overdue` writes what is left. The timers are unref'd,
   * so they are never what keeps it.
   */
  watch(): void {
    if (this.#watched !== null) return
    this.#watched = 0
    try {
      this.#watched = this.#deps.now()
    } catch {
      // Then the report measures from nought.
    }
    const overdue = this.#deps.overdue ?? QUIT_OVERDUE_MS
    overdue.forEach((ms, index) => {
      try {
        this.#deps.timer(() => this.#report(index, overdue.length), ms).unref()
      } catch {
        // No report at this bound; the quit goes on.
      }
    })
  }

  #write(lines: readonly string[]): void {
    for (const line of lines) {
      try {
        this.#deps.log(line)
      } catch {
        // Nowhere left to say it.
      }
    }
    if (!this.#late) return
    try {
      this.#deps.late(lines)
    } catch {
      // The file does not get it.
    }
  }

  /** Write, once for this bound, what is left; and do nothing else about it. */
  #report(index: number, of: number): void {
    if (this.#reported.has(index)) return
    this.#reported.add(index)
    let lines: string[]
    try {
      lines = this.#text(index, of)
    } catch {
      lines = ['the quit has not finished, and what is left could not be read']
    }
    this.#write(lines)
  }

  #text(index: number, of: number): string[] {
    const from = this.#watched ?? 0
    const lines = [
      `the quit has not finished: the process is still here ${seconds(this.#deps.now() - from)} after the quit was let go on to Electron (report ${index + 1} of ${of}). What is left:`,
    ]
    let left: readonly string[]
    try {
      left = this.#deps.left()
    } catch {
      left = [`what is left ${UNREAD}`]
    }
    for (const line of left) lines.push(`  ${line}`)
    lines.push(
      `  the quit's steps so far, each with when it was said against that moment${
        this.#dropped > 0 ? ` (${this.#dropped} earlier not kept)` : ''
      }:`,
    )
    for (const step of this.#steps) {
      const ms = Math.round(step.at - from)
      lines.push(`    ${ms < 0 ? '' : '+'}${ms} ms: ${step.line}`)
    }
    lines.push(
      index + 1 < of
        ? '  nothing is done about it; one more report follows if the process is still here'
        : '  nothing is done about it, and no further report follows',
    )
    return lines
  }
}

/**
 * Append, create, and on POSIX never through a symbolic link where the file
 * should be: the flags log-file.ts opens the same file with, for its reason.
 * A link planted in the log folder would otherwise have the app append to
 * whatever it names. Windows has no such flag and gets zero.
 */
const OPEN_FLAGS =
  constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0)

/** The most text held while the file is being opened: lines said before it answers. */
export const LATE_HELD = 200

/** A way into a log file for the lines that come after it has closed. */
export interface LateLog {
  /** Open the file now, so that a line said later is one write away. Asking twice opens once. */
  open(): void
  /**
   * Append these lines, each stamped and tagged as the log's own are and its
   * URLs redacted, as one write. Before the file has opened they wait for it;
   * if it cannot be opened they are dropped. Never throws, never waits.
   */
  append(lines: readonly string[]): void
}

/** The file calls a late log makes: `fs.open` and `fs.write`, with callbacks, and a clock. */
export interface LateLogDeps {
  open: (
    path: string,
    flags: number,
    mode: number,
    done: (error: Error | null, fd: number) => void,
  ) => void
  write: (fd: number, text: string, done: (error: Error | null) => void) => void
  now: () => Date
}

const FILE: LateLogDeps = {
  open: (path, flags, mode, done) => openFile(path, flags, mode, done),
  write: (fd, text, done) => writeFile(fd, text, (error) => done(error)),
  now: () => new Date(),
}

/**
 * `path` - `main.log`, as the log file names it itself - opened for
 * appending when first asked or first written to, and kept open: the process
 * is on its way out, and a close would be one more thing in flight.
 *
 * Asynchronous on purpose. A synchronous write would be on the disk before
 * the next step of the quit, but a disk that does not answer would then hold
 * the quit itself, which is the one thing this may not do; so each line is a
 * write asked for at once and never waited for. The handle is the app's
 * second on the file, beside the log's own while that is still open: both
 * append, so neither writes over the other.
 */
export function lateLog(path: string, tag: string, deps: LateLogDeps = FILE): LateLog {
  let fd: number | null = null
  let opening = false
  let failed = false
  let held: string[] = []
  const dropped = (): void => undefined

  const open = (): void => {
    if (fd !== null || opening || failed) return
    opening = true
    try {
      deps.open(path, OPEN_FLAGS, 0o644, (error, opened) => {
        opening = false
        if (error !== null) {
          failed = true
          held = []
          return
        }
        fd = opened
        const text = held.join('')
        held = []
        if (text === '') return
        try {
          deps.write(opened, text, dropped)
        } catch {
          // Those lines are lost; the quit is not.
        }
      })
    } catch {
      opening = false
      failed = true
      held = []
    }
  }

  const append = (lines: readonly string[]): void => {
    try {
      if (failed || lines.length === 0) return
      const at = deps.now().toISOString()
      const text = lines.map((line) => `${at} [${tag}] ${redactUrls(line)}\n`).join('')
      if (fd !== null) {
        deps.write(fd, text, dropped)
        return
      }
      if (held.length < LATE_HELD) held.push(text)
      open()
    } catch {
      // The line is lost; the quit is not.
    }
  }

  return { open, append }
}
