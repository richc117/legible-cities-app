// What crosses the bridge between the page and the engine's supervisor:
// the state, the pin, the notifications and the one error shape. Imported
// by all three processes. Contract: specs/004-sidecar-supervisor/data-model.md.

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

export interface JobProgress {
  id: string
  stage: string
  fraction: number
  message: string
}

export interface JobLog {
  id: string
  level: 'debug' | 'info' | 'warning' | 'error'
  line: string
}

export interface ErrorData {
  kind: string
  detail: string
  hint: string
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
  kind: string,
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
