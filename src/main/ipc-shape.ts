// What the two job bridges share: the token the page mints, a refusal that
// crosses the bridge as data, and an error turned into the engine's wire
// shape. Small on purpose; each bridge keeps its own channels and rules.

import type { Accepted } from '../shared/api'
import { EngineError, ERROR_CODES, type EngineErrorShape } from '../shared/engine'

/** A token the preload minted; a UUID passes. */
export const TOKEN = /^[A-Za-z0-9-]{1,64}$/

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** A call refused before anything started, answered rather than thrown so `data` survives the trip. */
export function badCall(what: string): Accepted {
  return {
    accepted: false,
    error: new EngineError(ERROR_CODES.badCall, what, {
      kind: 'params',
      detail: what,
      hint: what,
    }).toJSON(),
  }
}

export function toShape(error: unknown): EngineErrorShape {
  if (error instanceof EngineError) return error.toJSON()
  const message = error instanceof Error ? error.message : String(error)
  return { code: -32603, message }
}
