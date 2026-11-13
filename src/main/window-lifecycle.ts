// What the app does when its own window goes and when the Dock icon is
// pressed (issue 537). Both rules look at the app's window and nothing else:
// an export's offscreen capture window is a `BrowserWindow` too, and counting
// every window made the app's own absence invisible while a capture ran -
// on macOS no window came back from the Dock, and on Windows and Linux the
// app sat windowless until the capture ended and then quit, cancelling the
// export at its encode with nothing said.
//
// And whether a quit, or a close of that window, is asked about before it
// throws a run away (issue 552, `quitQuestion`): the rule alone is here;
// what it is asked with and how its answer is carried out is quit-guard.ts.
//
// No Electron import, so the rules are tested without a session; index.ts
// hands in the platform, the quit and the opener.

import { messageOf } from '../shared/errors'
import type { QuitKind, QuitQuestion } from '../shared/quit'

/** What the closing handler needs: the platform's name and the app's own quit. */
export interface AppWindowClosedDeps {
  platform: string
  quit: () => void
}

/**
 * The handler for the app's own window closing. Windows and Linux quit, as
 * they do when nothing else is open, so a running export is cancelled by the
 * quit at once and visibly; macOS stays running with no window, as its apps
 * do. A close is asked about first while a run is going (`quitQuestion`,
 * below), and one that goes ahead has stopped the runs, so on macOS nothing
 * goes on unseen; an export goes on without a window only where the question
 * could not be shown.
 */
export function onAppWindowClosed(deps: AppWindowClosedDeps): () => void {
  return () => {
    if (deps.platform !== 'darwin') deps.quit()
  }
}

/** What the activate handler needs: the app's window, if it has one, and the way to make one. */
export interface ActivateDeps {
  /** The app's own window, or null once it has closed. Never a capture window. */
  appWindow: () => unknown
  open: () => void
}

/** The handler for the Dock icon: a window when the app has none of its own. */
export function onActivate(deps: ActivateDeps): () => void {
  return () => {
    if (deps.appWindow() === null) deps.open()
  }
}

/** The slice of Electron's event the gate needs. */
export interface Cancellable {
  preventDefault(): void
}

/** A run a quit or a close would throw away. */
export interface Run {
  /** The project's identifier: a project is named once, however many runs it has. */
  project: string
  /** Its name, as the Library shows it. */
  name: string
  /** When the run started, in milliseconds since the epoch: the order the names are said in. */
  started: number
}

/**
 * Whether the page can show a question: `ready`, there and answering; `gone`,
 * no window, a renderer that died, or a page that has not said it listens;
 * `unresponsive`, as Electron reported it.
 */
export type RendererState = 'ready' | 'gone' | 'unresponsive'

/** What `quitQuestion` is asked with. */
export interface QuitFacts {
  /** A quit of the app, or a close of its own window. */
  kind: QuitKind
  /** The exports running, from the main process's own state. */
  exports: readonly Run[]
  /** The layouts running, as the page last reported them: main cannot see one. */
  layouts: readonly Run[]
  renderer: RendererState
  /**
   * The quit is the app's own, not the person's: the crash box's Quit, a
   * missing single-instance lock, an uncaught exception, the quit that
   * follows the window on Windows and Linux, the one the person has just
   * confirmed, and any quit already under way.
   */
  own: boolean
  /** How long the question on the screen has been there, in milliseconds; null with none open. */
  open: number | null
}

/**
 * How long a question must have been on the screen before a second quit, or
 * a second close, counts as its answer. A shortcut held past the keyboard's
 * repeat delay, or a double click on the window's close button, would
 * otherwise be the question and its answer before anyone had read it.
 */
export const QUESTION_MIN_AGE_MS = 1_000

/**
 * Ask this; or ask nothing, and either go ahead or hold: cancel the quit or
 * the close and leave the question on the screen as it is.
 */
export type QuitDecision = { ask: false; hold: boolean } | { ask: true; question: QuitQuestion }

const GO_AHEAD: QuitDecision = { ask: false, hold: false }
const HOLD: QuitDecision = { ask: false, hold: true }

/**
 * Whether a quit, or a close of the app's window, is asked about first
 * (issue 552, specs/039-quit-guard), and what is asked. Asked while an
 * export or a layout is running, on every platform, the close on macOS
 * included: the app stays running there with no window, and a window
 * reopened from the Dock cannot see or stop an export that went on without
 * one (issue 556), so going ahead stops the runs as a quit does.
 *
 * Never asked:
 * - for the app's own quits, which nobody chose and nobody can answer;
 * - while the page cannot show the question, because a person must always
 *   be able to quit;
 * - while a question is already open. A second quit, or close, is an
 *   answer, and it goes ahead - once the question has been on the screen for
 *   `QUESTION_MIN_AGE_MS`. Before that it is held and nothing changes: the
 *   repeat of a held shortcut, or the second click of a double click, is not
 *   an answer to a question nobody has had time to read;
 * - with nothing running, which is every quit and close before this rule.
 *
 * The question names each project once, in the order its first run started.
 */
export function quitQuestion(facts: QuitFacts): QuitDecision {
  if (facts.own) return GO_AHEAD
  if (facts.renderer !== 'ready') return GO_AHEAD
  if (facts.open !== null) return facts.open < QUESTION_MIN_AGE_MS ? HOLD : GO_AHEAD
  // Sorted on a copy; ties keep the exports first, as they are handed in.
  const runs = [...facts.exports, ...facts.layouts].sort((a, b) => a.started - b.started)
  if (runs.length === 0) return GO_AHEAD
  const named = new Map<string, string>()
  for (const run of runs) if (!named.has(run.project)) named.set(run.project, run.name)
  return {
    ask: true,
    question: {
      kind: facts.kind,
      exports: facts.exports.length,
      layouts: facts.layouts.length,
      names: [...named.values()],
    },
  }
}

/** What a `before-quit` was: the pass that starts the shutdown, or one that came after it. */
export type QuitPass = 'first' | 'later'

export interface QuitGate {
  /** Whether a quit is under way; a second `app.quit()` is then pointless. */
  readonly quitting: boolean
  /**
   * Every `before-quit` goes through here. The first pass is cancelled when
   * the engine is to be stopped, and the caller starts the stop. Every pass
   * after it is cancelled too until `finished()`: an `app.quit()` made while
   * the stop runs - the window's close and then `window-all-closed` on
   * Windows and Linux, an uncaught exception, the crash box's Quit - must not
   * let Electron go with the engine half-stopped.
   */
  beforeQuit(event: Cancellable, engineRunning: boolean): QuitPass
  /** The stop has ended (however it ended): the next quit is let through. */
  finished(): void
}

export function quitGate(): QuitGate {
  let quitting = false
  let stopped = false
  return {
    get quitting() {
      return quitting
    },
    beforeQuit(event, engineRunning) {
      if (quitting) {
        if (!stopped) event.preventDefault()
        return 'later'
      }
      quitting = true
      if (engineRunning) event.preventDefault()
      else stopped = true
      return 'first'
    },
    finished() {
      stopped = true
    },
  }
}

export interface ShutdownDeps {
  /** What ends at once on a quit, each named for the log: an export, the captures, the first-run check. */
  aborts: { name: string; run: () => void }[]
  /** The engine's stop, or null when there is no engine. */
  stop: (() => Promise<void>) | null
  /** The gate's `finished`. */
  finished: () => void
  /** The app's own quit, asked again once the stop has ended. */
  quit: () => void
  error: (message: string) => void
}

/**
 * A line that cannot throw: the message is built inside the guard (a thrown
 * object whose string form throws) and so is the logger. Nothing here may
 * stop the quit, which the gate is waiting on.
 */
function sayQuietly(error: (message: string) => void, message: () => string): void {
  try {
    error(message())
  } catch {
    // Nowhere left to say it.
  }
}

/**
 * The first pass of a quit, after the gate has cancelled it: end what runs,
 * stop the engine, then let go. The gate keeps cancelling until `finished`,
 * so nothing here may throw past the stop: each abort has its own try, a
 * failing one is logged and the others still run, and the stop is always
 * reached, however it ends, because a throw that skipped it would leave a
 * windowless process that no quit could end.
 */
export function shutDown(deps: ShutdownDeps): void {
  for (const abort of deps.aborts) {
    try {
      abort.run()
    } catch (error) {
      sayQuietly(deps.error, () => `${abort.name} did not end on quit: ${messageOf(error)}`)
    }
  }
  if (deps.stop === null) return
  let stopping: Promise<void>
  try {
    stopping = deps.stop()
  } catch (error) {
    stopping = Promise.reject(error)
  }
  void stopping
    .catch((error: unknown) => sayQuietly(deps.error, () => `stop failed: ${messageOf(error)}`))
    .finally(() => {
      deps.finished()
      deps.quit()
    })
}
