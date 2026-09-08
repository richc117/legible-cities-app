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
] as const

export const APP_ERROR_KINDS = ['state', 'inactive', 'exit'] as const

/** One of the engine's own kinds: what may arrive over the wire. */
export function isEngineErrorKind(value: unknown): value is EngineErrorData['kind'] {
  return typeof value === 'string' && (ENGINE_ERROR_KINDS as readonly string[]).includes(value)
}

/** One of the ten the interface may see, the engine's and the app's. */
export function isErrorKind(value: unknown): value is ErrorKind {
  return (
    isEngineErrorKind(value) || (APP_ERROR_KINDS as readonly string[]).includes(value as string)
  )
}

// The app's own codes, in JSON-RPC's reserved server range below the
// engine's -32000, for a request the engine could not be asked or did not
// answer. -32800 (cancelled) and -32602 (bad parameters) are the engine's.
export const ERROR_CODES = {
  notReady: -32001,
  engineExited: -32002,
  inactive: -32003,
  badCall: -32600,
  cancelled: -32800,
} as const

/**
 * A sentence with any filesystem path taken out of it.
 *
 * The engine writes `hint` for a person, and for an I/O failure it writes
 * "{reason}: {filename}" with an absolute path in it (its `classify`). A
 * path is not for a screen (constitution V), and this is the sentence the
 * interface shows, so the path comes out here, at the boundary, once, for
 * every consumer. `detail` keeps the whole of it for the log.
 */
export function withoutPaths(sentence: string): string {
  const stripped = sentence
    .replace(/(^|[\s(])(?:[A-Za-z]:)?[\\/][^\s,;:)]*/g, '$1a file')
    .replace(/(^|[\s(])[A-Za-z]:\\[^\s,;:)]*/g, '$1a file')
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
