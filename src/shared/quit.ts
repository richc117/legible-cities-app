// Asking before a quit or a close of the app's window throws a run away
// (issue 552, specs/039-quit-guard): what crosses the bridge, and the words
// the dialog says. Main decides whether to ask (`quitQuestion`,
// src/main/window-lifecycle.ts) and sends the question; the page shows it in
// its own `<dialog>` and answers; and the page tells main which layouts it is
// running whenever that changes, since a layout is steps the page drives and
// main cannot see one. No Electron and no React.

/** What the person did: quit the app, or closed its window. */
export const QUIT_KINDS = ['quit', 'close'] as const
export type QuitKind = (typeof QUIT_KINDS)[number]

/**
 * The question: what was asked for, how many runs it would throw away, and
 * whose they are. At least one run, and at least one name.
 */
export interface QuitQuestion {
  kind: QuitKind
  /** The exports running. */
  exports: number
  /** The layouts running. */
  layouts: number
  /** Each running project's name, once, in the order the runs started. */
  names: string[]
}

/** The question as it crosses the bridge: numbered, so an answer is for the question it was given to. */
export interface AskedQuit extends QuitQuestion {
  id: number
}

/** The person's answer: carry on, or go ahead and stop the runs. */
export const QUIT_ANSWERS = ['keep', 'anyway'] as const
export type QuitAnswer = (typeof QUIT_ANSWERS)[number]

export function isQuitAnswer(value: unknown): value is QuitAnswer {
  return typeof value === 'string' && (QUIT_ANSWERS as readonly string[]).includes(value)
}

/** A layout the page is running: whose, and when it started, in milliseconds since the epoch. */
export interface RunningLayout {
  project: string
  started: number
}

/** A count as the question carries one: a whole number, none included. */
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

/**
 * Whether a value is a question as main sends one. The preload checks again
 * what arrives, as it checks a menu command, so the page's dialog is never
 * handed a shape it cannot say.
 */
export function isAskedQuit(value: unknown): value is AskedQuit {
  if (value === null || typeof value !== 'object') return false
  const asked = value as Record<string, unknown>
  return (
    typeof asked.id === 'number' &&
    Number.isInteger(asked.id) &&
    typeof asked.kind === 'string' &&
    (QUIT_KINDS as readonly string[]).includes(asked.kind) &&
    isCount(asked.exports) &&
    isCount(asked.layouts) &&
    asked.exports + asked.layouts > 0 &&
    Array.isArray(asked.names) &&
    asked.names.length > 0 &&
    asked.names.every((name) => typeof name === 'string')
  )
}

/**
 * What the sentence says for a project main cannot name. Every running
 * project's record has been read through the store, which is where the names
 * come from, so this is for a case that should not arise; it keeps the
 * sentence a sentence if it does.
 */
export const UNNAMED_PROJECT = 'a project'

/** The safe button, focused first: the dialog's default, and what Escape answers. */
export const KEEP_WORKING = 'Keep working'

/** The dialog's words. */
export interface QuitWords {
  title: string
  description: string
  /** The safe button. */
  keep: string
  /** The button that goes ahead. */
  anyway: string
}

/** Names as a sentence lists them: "Paris", "Paris and Lyon", "Paris, Lyon and Lille". */
function listed(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * The dialog's title, sentence and buttons for a question. One run is named
 * for what it is, "an export" or "a layout"; several are "runs", counted in
 * the title, and the sentence names each project once.
 */
export function quitWords(question: QuitQuestion): QuitWords {
  const verb = question.kind === 'quit' ? 'Quit' : 'Close'
  const doing = question.kind === 'quit' ? 'Quitting' : 'Closing'
  const runs = question.exports + question.layouts
  const anyway = `${verb} anyway`
  if (runs === 1) {
    const [article, run] = question.exports === 1 ? ['an', 'export'] : ['a', 'layout']
    return {
      title: `${verb} while ${article} ${run} is running?`,
      description: `The ${run} of ${listed(question.names)} has not finished. ${doing} stops it, and nothing of it is kept.`,
      keep: KEEP_WORKING,
      anyway,
    }
  }
  return {
    title: `${verb} while ${runs} runs are going?`,
    description: `The runs of ${listed(question.names)} have not finished. ${doing} stops them, and nothing of them is kept.`,
    keep: KEEP_WORKING,
    anyway,
  }
}
