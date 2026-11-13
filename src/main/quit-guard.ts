// Asking before a quit, or a close of the app's window, throws a run away
// (issue 552, specs/039-quit-guard), main side.
//
// The rule is `quitQuestion` in window-lifecycle.ts. This holds what the
// rule is asked with and carries its answer out:
//
// - **What is running.** The exports are the exporter's own, asked for at
//   the moment of the quit. The layouts are the page's, as it last reported
//   them: a layout is steps the page drives with nothing in flight between
//   them, so main cannot see one, and the page is never asked at the moment
//   of a quit, when it may be the thing that is broken. The projects' names
//   are the store's, so a report carries identifiers and nothing to show.
// - **Whether the page can be asked.** Only a page that has said it listens,
//   whose frame is still the window's main frame and which Electron has not
//   reported unresponsive, is asked. Otherwise the quit goes ahead: a person
//   must always be able to quit. Listening ends as it does for the menu
//   (menu-ipc.ts): when a navigation of the main frame commits, when the
//   renderer dies, when the window closes; the page's report goes with it.
// - **The question open.** One at a time, numbered, so an answer is for the
//   question it was given to. While one is open a second quit, or a second
//   close, is an answer, and goes ahead.
// - **The app's own quits.** Every quit the app makes itself goes through
//   `quit()` here and is never asked about, nor is anything after it: the
//   crash box's Quit, a missing single-instance lock, an uncaught exception,
//   the quit that follows the window on Windows and Linux, and the one the
//   person has just confirmed.
//
// The question comes before the quit gate and never replaces it
// (`onBeforeQuit`): a quit that is asked about has not begun, so the gate
// has not seen it, and the quit the person confirms is the gate's first
// pass, which stops the engine as it always has.
//
// **Close anyway** stops the runs and then closes the window. The page stops
// the ones it counts through each run's own Cancel before it answers; main
// stops the exports it holds as well, so nothing main runs outlives the
// window whatever the page did, and a second close, which no page answers,
// stops them too. On Windows and Linux the app then quits with its window,
// as it does today; on macOS it stays, with nothing of those runs going on.
// A layout's request already with the engine at a second close is not
// cancelled by it: the page that would take its next step is gone, so the
// run goes no further, and on Windows and Linux the quit ends the engine.
//
// No Electron import beyond types, so all of it is tested without a session.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from '../shared/api'
import {
  isQuitAnswer,
  UNNAMED_PROJECT,
  type AskedQuit,
  type QuitAnswer,
  type QuitKind,
  type QuitQuestion,
  type RunningLayout,
} from '../shared/quit'
import { guardedHandle } from './ipc-shape'
import { validateId } from './record/validate'
import {
  quitQuestion,
  type Cancellable,
  type QuitDecision,
  type QuitGate,
  type RendererState,
  type Run,
} from './window-lifecycle'

/** A run as its holder knows it: whose, and when it started. The name is the store's. */
export type UnnamedRun = Pick<Run, 'project' | 'started'>

export interface QuitGuardDeps {
  /** The exports a quit would throw away, in the order they started (`Exporter.running`). */
  exports: () => readonly UnnamedRun[]
  /** A project's name as the store last read or wrote it, or null (`ProjectStore.nameOf`). */
  nameOf: (project: string) => string | null
  /** Whether the frame that said it listens is still the window's main frame. */
  current: (frame: unknown) => boolean
  /** Bring the app's window up and send its page the question. */
  ask: (question: AskedQuit) => void
  /** Tell the page the question it shows has been answered without it. */
  withdraw: () => void
  /** Stop every export main holds, as a quit does (`Exporter.abortAll`). */
  stopExports: () => void
  /** Close the app's window. */
  close: () => void
  /** Quit the app (`app.quit`). */
  quit: () => void
}

export class QuitGuard {
  readonly #deps: QuitGuardDeps
  /** The frame that said it listens, or null. */
  #listener: unknown = null
  /** Whether Electron last said the page answers. */
  #responsive = true
  /** The layouts the listening page last reported. */
  #layouts: readonly RunningLayout[] = []
  /** The question on the screen, or null. */
  #open: { id: number; kind: QuitKind } | null = null
  /** Questions asked, for their numbers. */
  #asked = 0
  /** The app has begun a quit of its own; nothing after it is asked about. */
  #own = false
  /** The close in flight is the one the person confirmed. */
  #passing = false

  constructor(deps: QuitGuardDeps) {
    this.#deps = deps
  }

  /** The app's own quit, for every quit it makes itself: never asked about. */
  quit(): void {
    this.#own = true
    this.#deps.quit()
  }

  #renderer(): RendererState {
    if (this.#listener === null || !this.#deps.current(this.#listener)) return 'gone'
    return this.#responsive ? 'ready' : 'unresponsive'
  }

  #decide(kind: QuitKind, underWay: boolean): QuitDecision {
    const named = (run: UnnamedRun): Run => ({
      project: run.project,
      started: run.started,
      name: this.#deps.nameOf(run.project) ?? UNNAMED_PROJECT,
    })
    return quitQuestion({
      kind,
      exports: this.#deps.exports().map(named),
      layouts: this.#layouts.map(named),
      renderer: this.#renderer(),
      // A quit already under way is the app's by now, whoever began it: the
      // gate's later passes, and the windows a quit closes on its way out.
      own: this.#own || underWay,
      open: this.#open !== null,
    })
  }

  #ask(question: QuitQuestion): void {
    this.#asked += 1
    this.#open = { id: this.#asked, kind: question.kind }
    this.#deps.ask({ id: this.#asked, ...question })
  }

  /**
   * Every `before-quit`, before the gate. True when the quit was cancelled
   * and the question sent: the caller does nothing more, and the gate never
   * hears of it. False lets the quit go on to the gate. `underWay` is the
   * gate's `quitting`.
   */
  beforeQuit(event: Cancellable, underWay: boolean): boolean {
    const decision = this.#decide('quit', underWay)
    if (decision.ask) {
      event.preventDefault()
      this.#ask(decision.question)
      return true
    }
    // A quit that goes ahead with a question open has answered it: a second
    // quit is "Quit anyway", and the dialog is taken back.
    if (this.#open !== null) {
      this.#open = null
      this.#deps.withdraw()
    }
    return false
  }

  /**
   * Every `close` of the app's own window. True when the close was cancelled
   * and the question sent; false lets the window close.
   */
  closing(event: Cancellable, underWay: boolean): boolean {
    // The close the guard itself makes, once the person has said so.
    if (this.#passing) {
      this.#passing = false
      return false
    }
    const decision = this.#decide('close', underWay)
    if (decision.ask) {
      event.preventDefault()
      this.#ask(decision.question)
      return true
    }
    // A second close is an answer, as a second quit is: "Close anyway", with
    // no page to stop anything, so what main holds is stopped here. Not for
    // a window a quit is closing: the quit's own shutdown has that.
    if (this.#open !== null && !this.#own && !underWay) {
      this.#open = null
      this.#deps.stopExports()
    }
    return false
  }

  /** A page subscribed, from this frame: it can be asked. A new page has reported nothing yet. */
  listening(frame: unknown): void {
    if (frame !== this.#listener) {
      this.#layouts = []
      this.#open = null
    }
    this.#listener = frame
    this.#responsive = true
  }

  /** The listening page's layouts, as they now stand. Another frame's word is not heard. */
  report(frame: unknown, layouts: readonly RunningLayout[]): void {
    if (frame !== this.#listener) return
    this.#layouts = layouts
  }

  /**
   * The person's answer, from the listening page, to the question open. An
   * answer to any other question - one a second quit answered, one from
   * before a crash - does nothing.
   */
  answer(frame: unknown, id: number, answer: QuitAnswer): void {
    if (frame !== this.#listener) return
    const open = this.#open
    if (open === null || open.id !== id) return
    this.#open = null
    if (answer === 'keep') return
    if (open.kind === 'quit') {
      this.quit()
      return
    }
    // Close anyway. The page has stopped its runs through each one's own
    // Cancel before it answered; the exports are stopped here too, since on
    // macOS no quit follows the window to do it.
    this.#deps.stopExports()
    this.#passing = true
    this.#deps.close()
  }

  /** Electron reported the page unresponsive: it cannot be asked until it answers again. */
  unresponsive(): void {
    this.#responsive = false
  }

  responsive(): void {
    this.#responsive = true
  }

  /**
   * The page went: its main frame navigated to another document, its
   * renderer died, or its window closed. Nothing it reported or was asked
   * outlives it.
   */
  gone(): void {
    this.#listener = null
    this.#layouts = []
    this.#open = null
    this.#passing = false
    this.#responsive = true
  }
}

/** What `onBeforeQuit` composes. */
export interface BeforeQuitDeps {
  guard: Pick<QuitGuard, 'beforeQuit'>
  gate: QuitGate
  /** Whether there is an engine to stop. */
  engineRunning: () => boolean
  /** The first pass's work, once the gate has cancelled it (`shutDown`). */
  shutDown: () => void
}

/**
 * The `before-quit` handler: the question, then the gate, then the shutdown,
 * in that order. A quit that is asked about stops here and the gate never
 * sees it, so the quit the person confirms - or any later one - is still the
 * gate's first pass and stops the engine before Electron goes (FR-006).
 */
export function onBeforeQuit(deps: BeforeQuitDeps): (event: Cancellable) => void {
  return (event) => {
    if (deps.guard.beforeQuit(event, deps.gate.quitting)) return
    if (deps.gate.beforeQuit(event, deps.engineRunning()) === 'later') return
    deps.shutDown()
  }
}

/** What `onAppWindowClose` composes. */
export interface AppWindowCloseDeps {
  guard: Pick<QuitGuard, 'closing'>
  gate: Pick<QuitGate, 'quitting'>
  /** What a close that goes ahead does first: the window's place is kept. */
  closing: () => void
}

/** The `close` handler of the app's own window: the question first, and nothing else for a close that is held. */
export function onAppWindowClose(deps: AppWindowCloseDeps): (event: Cancellable) => void {
  return (event) => {
    if (deps.guard.closing(event, deps.gate.quitting)) return
    deps.closing()
  }
}

/** The most layouts one report may name; a page runs one per project it has open. */
export const MAX_REPORTED_LAYOUTS = 64

/** What a report of the wrong shape is refused with. */
export const BAD_REPORT = 'a report of running layouts must list projects and when each started'

/** What an answer of the wrong shape is refused with. */
export const BAD_ANSWER = 'an answer must name its question and say keep or anyway'

/**
 * The page's report as main keeps it, or null where it is not one: a list of
 * at most `MAX_REPORTED_LAYOUTS`, each a project's identifier, once, and a
 * start time. A copy with nothing else on it.
 */
export function readLayoutReport(value: unknown): RunningLayout[] | null {
  if (!Array.isArray(value) || value.length > MAX_REPORTED_LAYOUTS) return null
  const layouts: RunningLayout[] = []
  const seen = new Set<string>()
  for (const entry of value as unknown[]) {
    if (entry === null || typeof entry !== 'object') return null
    const { project, started } = entry as Record<string, unknown>
    if (typeof project !== 'string' || validateId(project) !== null || seen.has(project))
      return null
    if (typeof started !== 'number' || !Number.isFinite(started) || started < 0) return null
    seen.add(project)
    layouts.push({ project, started })
  }
  return layouts
}

/**
 * The page's three words: that it listens, what it is laying out, and the
 * person's answer. From the interface's own top frame only, through the one
 * guard every handler has; a report or an answer of the wrong shape is
 * refused and changes nothing.
 */
export function registerQuitHandlers(
  ipcMain: IpcMain,
  guard: QuitGuard,
  isTopFrame: (event: IpcMainInvokeEvent) => boolean,
): void {
  const handle = guardedHandle(ipcMain, isTopFrame)
  handle(CHANNELS.quitListening, async (event) => {
    guard.listening(event.senderFrame)
  })
  handle(CHANNELS.quitLayouts, async (event, layouts) => {
    const report = readLayoutReport(layouts)
    if (report === null) throw new Error(BAD_REPORT)
    guard.report(event.senderFrame, report)
  })
  handle(CHANNELS.quitAnswer, async (event, id, answer) => {
    if (typeof id !== 'number' || !Number.isInteger(id) || !isQuitAnswer(answer))
      throw new Error(BAD_ANSWER)
    guard.answer(event.senderFrame, id, answer)
  })
}
