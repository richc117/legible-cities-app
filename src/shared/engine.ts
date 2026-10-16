// What crosses the bridge between the page and the engine's supervisor:
// the state, the pin, the notifications and the one error shape. Imported
// by all three processes. Contract: specs/004-sidecar-supervisor/data-model.md.

import type {
  ErrorData as EngineErrorData,
  JobLog as EngineJobLog,
  JobProgress as EngineJobProgress,
} from './protocol'

export interface EnginePin {
  repo: string
  tag: string
  version: string
  protocol: number
}

export type EngineState =
  | { state: 'starting'; attempt: number }
  | { state: 'ready'; version: string; protocol: number }
  | { state: 'restarting'; attempt: number; reason: string }
  | { state: 'unavailable'; reason: string }
  | { state: 'mismatched'; expected: EnginePin; found: { version: string; protocol: number } }
  | { state: 'stopped'; reason: string }

// The three shapes below are the engine's, from the generated types
// (A1-02), with the app's own two differences named rather than copied, so
// that a change to a stage, a level or a hint on the engine's side reaches
// the interface as a build error.
//
// The first difference: the engine keys a notification by its own JSON-RPC
// id, and the main process re-keys it to the token the preload minted
// before the page ever sees it. The page's id is therefore always a string,
// and never the engine's numbering, which the app does not expose.

export type JobProgress = Omit<EngineJobProgress, 'id'> & { id: string }

export type JobLog = Omit<EngineJobLog, 'id'> & { id: string }

// The second difference: the app produces errors on the engine's behalf,
// for a request the engine never saw. Those carry a kind of the app's own
// beside the engine's seven.
export type AppErrorKind = 'state' | 'inactive' | 'exit'

export type ErrorKind = EngineErrorData['kind'] | AppErrorKind

export type ErrorData = Omit<EngineErrorData, 'kind'> & { kind: ErrorKind }

// The engine's kinds as a value, because a kind arriving over the wire has
// to be checked before it is trusted as one. The list is hand-written, and
// tests/unit/protocol-generate.test.ts fails when it stops matching the
// engine's description, so it cannot drift from the type above.
export const ENGINE_ERROR_KINDS = [
  'params',
  'feed',
  'loom',
  'schedule',
  'export',
  'io',
  'engine',
  'layout',
] as const

export const APP_ERROR_KINDS = ['state', 'inactive', 'exit'] as const

/** One of the engine's own kinds: what may arrive over the wire. */
export function isEngineErrorKind(value: unknown): value is EngineErrorData['kind'] {
  return typeof value === 'string' && (ENGINE_ERROR_KINDS as readonly string[]).includes(value)
}

/** One of the eleven the interface may see, the engine's and the app's. */
export function isErrorKind(value: unknown): value is ErrorKind {
  return (
    isEngineErrorKind(value) || (APP_ERROR_KINDS as readonly string[]).includes(value as string)
  )
}

// The app's own codes, in JSON-RPC's reserved server range below the
// engine's -32000, for a request the engine could not be asked or did not
// answer, and for the one job the app runs itself, an export, when its own
// half fails. -32800 (cancelled) and -32602 (bad parameters) are the engine's.
export const ERROR_CODES = {
  notReady: -32001,
  engineExited: -32002,
  inactive: -32003,
  exportFailed: -32004,
  badCall: -32600,
  cancelled: -32800,
} as const

// Where a path ends, for `withoutPaths` below and for the folders the main
// process knows at the error door (`src/main/paths-in-text.ts`, issue 419),
// so the two agree.
//
// A path character is anything but whitespace, a quote, or a clause's
// punctuation (`, ; : )` and the apostrophe), and that punctuation too where
// another path character follows it: a device path's `C:\`, `Program Files
// (x86)\` and a name with a comma or an apostrophe in it stay in one piece,
// while a colon or a comma before a space, and a `)` before a space or a
// full stop, end the path.
const PATH_CHAR = String.raw`(?:[^\s'",;:)]|[',;:)](?=[^\s'",;:).]))`

/**
 * One separator: either slash, or either one percent-encoded as a file URL
 * writes it. A known folder's pattern accepts all four
 * (`src/main/paths-in-text.ts`), so all four end a word here.
 */
const SEP = String.raw`(?:[\\/]|%2[Ff]|%5[Cc])`

/** Where a path starts: a separator, or a drive and a separator, its colon plain or percent-encoded. */
const PATH_START = String.raw`(?:[A-Za-z](?::|%3[Aa]))?${SEP}`

/**
 * A word that is a path of its own, quoted or not, or a web address, and so
 * never the rest of the one before. Every form a known folder's pattern can
 * start on is one of these, so a scan for the rest of a path ends wherever
 * the next known folder could begin, and a line full of them costs linear
 * time.
 */
export const STARTS_ANEW = String.raw`(?:['"]?${PATH_START}|[A-Za-z][\w+.-]*:[\\/]{2})`

/** A later word with no separator in it. */
const WORD = String.raw`(?:(?!${SEP})${PATH_CHAR})+`

/** A later word that carries the path on: one with a separator in it that starts nothing of its own. */
const CARRIES_ON = String.raw`(?!${STARTS_ANEW})(?:(?!${SEP})${PATH_CHAR})*${SEP}${PATH_CHAR}*`

/**
 * The rest of a path once its start is found: its first word, then the
 * words after it on the same line and in the same clause, up to the last
 * that carries it on. "Application Support/Legible Cities/engine" and
 * "Jane Doe\AppData" are one path each, because the word after each space
 * has a separator in it; "/x/y has no stops.txt" is a path and four words,
 * because none of them does.
 */
export const PATH_REST = String.raw`${PATH_CHAR}*(?:[ \t]+(?:${WORD}[ \t]+)*${CARRIES_ON})*`

/** Where a quoted path ends: at its own quote, with a space, punctuation or the end of the text after it. */
export const QUOTE_CLOSES = String.raw`(?=[\s,;:.)\]}>'"]|$)`

/**
 * A character inside a quoted path: anything on the line but a quote that
 * starts another path, in any form a known folder can start on, which also
 * bounds how far the closing quote is looked for, so a line of unclosed
 * quotes costs linear time.
 */
export const QUOTED_CHAR = String.raw`(?:(?!['"]${PATH_START})[^\r\n])`

/**
 * A path behind a single or a double quote, as Python's `OSError` and
 * Node's file-system errors print one: a separator or a drive right after
 * the quote, and everything to the quote that closes it, spaces and colons
 * included. A quote followed at once by its twin (`'/'`) is not a path.
 */
const QUOTED_PATH = new RegExp(
  String.raw`(['"])(?:[A-Za-z]:)?[\\/](?!\1)${QUOTED_CHAR}*?\1${QUOTE_CLOSES}`,
  'g',
)

/**
 * A path with no quote around it: a separator or a drive at the start of the
 * text or after a space, `(`, `=` or an unclosed quote, then at least one
 * path character, so a slash on its own between two words is left alone.
 */
const BARE_PATH = new RegExp(
  String.raw`(^|[\s('"=])(?:[A-Za-z]:)?[\\/]${PATH_CHAR}${PATH_REST}`,
  'g',
)

/**
 * A sentence with any filesystem path taken out of it.
 *
 * The engine writes `hint` for a person, and for an I/O failure it writes
 * "{reason}: {filename}" with an absolute path in it (its `classify`). A
 * path is not for a screen (constitution V).
 *
 * Since issue 419 this is the backstop, not the rule: at the one door every
 * error goes through on its way to the page, the main process first takes
 * out every path under a folder it knows - the engine's home, the home
 * folder and the rest - matching the folder whole, whatever its names hold
 * (`src/main/paths-in-text.ts`), and then runs this over what is left. The
 * renderer's own calls, and the export's for its own errors and the engine's
 * notes on a plan, run it with no folder known. This guesses. A
 * quoted path goes to its closing quote; an unquoted one runs on past a
 * space only while a later word in its clause has a separator in it, so a
 * path whose last name has a space in it (a home folder named "Jane Doe" at
 * the very end of a sentence) still shows the words after the space here.
 */
export function withoutPaths(sentence: string): string {
  const stripped = sentence.replace(QUOTED_PATH, '$1a file$1').replace(BARE_PATH, '$1a file')
  return stripped.trim() === '' ? sentence : stripped
}

/** A rejected request, whoever produced the error: the engine, or the app on its behalf. */
export class EngineError extends Error {
  readonly code: number
  readonly data: ErrorData | undefined

  constructor(code: number, message: string, data?: ErrorData) {
    super(message)
    this.name = 'EngineError'
    this.code = code
    this.data = data
  }

  /** The wire shape: what `engine:request` resolves with when the answer is an error. */
  toJSON(): { code: number; message: string; data?: ErrorData } {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data }
  }
}

export interface EngineErrorShape {
  code: number
  message: string
  data?: ErrorData
}

export function isEngineErrorShape(value: unknown): value is EngineErrorShape {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.code === 'number' && typeof v.message === 'string'
}

export function engineError(
  code: number,
  message: string,
  kind: ErrorKind,
  hint?: string,
): EngineError {
  return new EngineError(code, message, { kind, detail: message, hint: hint ?? message })
}

/** One sentence per state, for the log and for a refused request. */
export function describeState(state: EngineState): string {
  switch (state.state) {
    case 'starting':
      return state.attempt === 1
        ? 'Starting the engine.'
        : `Starting the engine (attempt ${state.attempt}).`
    case 'ready':
      return `Engine ready (${state.version}).`
    case 'restarting':
      return `The engine stopped; restarting (attempt ${state.attempt}). ${state.reason}`
    case 'unavailable':
      return `Engine unavailable: ${state.reason}`
    case 'mismatched':
      return `Engine version mismatch: this app needs engine ${state.expected.version} (protocol ${state.expected.protocol}) and found ${state.found.version} (protocol ${state.found.protocol}).`
    case 'stopped':
      return `Engine stopped: ${state.reason}`
  }
}

/**
 * Whether a result says a cancel came too late (engine v0.18.0, its issue
 * 80): `graph.build`, `map.build`, `export.encode` and `feeds.add` each have
 * a point of no return, the first write a client sees, and a cancel that
 * arrives after it is answered with the method's result carrying
 * `cancel_too_late: true`, over what the result names, written. The result
 * crosses from another process, so it is read rather than assumed, and only
 * `true` is the field. A cancel before the point of no return is answered
 * with the cancelled error instead, and nothing a client sees was written.
 */
export function cameTooLate(result: unknown): boolean {
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as { cancel_too_late?: unknown }).cancel_too_late === true
  )
}
