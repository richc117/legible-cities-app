// What the two job bridges share: the token the page mints, a refusal that
// crosses the bridge as data, and an error turned into the engine's wire
// shape. Small on purpose; each bridge keeps its own channels and rules.
//
// It is also the one door an error goes through on its way to the page
// (issue 207), so the redaction is here and nowhere else. The engine writes
// a failed download's whole URL into its error - `FeedError`'s sentence is
// "{url} could not be fetched: ...", and the serve loop makes that the
// message, the hint and the start of the detail (engine v0.8.3,
// `serve.classify`) - so a key in a feed's query string would otherwise be
// drawn on screen by the add-a-feed dialog and every panel's failure line,
// and kept in the jobs inspector. The logs have been redacted since A6-03;
// this is the same `redactUrls`, applied to all three fields of every shape
// that crosses, the app's own refusals included. Text with none of `? # @ %`
// in it comes back exactly as it was.

import type { Accepted } from '../shared/api'
import { EngineError, ERROR_CODES, type EngineErrorShape } from '../shared/engine'
import { redactUrls } from './redact'

/** A token the preload minted; a UUID passes. */
export const TOKEN = /^[A-Za-z0-9-]{1,64}$/

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** A call refused before anything started, answered rather than thrown so `data` survives the trip. */
export function badCall(what: string): Accepted {
  return {
    accepted: false,
    error: redactShape(
      new EngineError(ERROR_CODES.badCall, what, {
        kind: 'params',
        detail: what,
        hint: what,
      }).toJSON(),
    ),
  }
}

/** Any error as the engine's wire shape, redacted for the page. */
export function toShape(error: unknown): EngineErrorShape {
  if (error instanceof EngineError) return redactShape(error.toJSON())
  const message = error instanceof Error ? error.message : String(error)
  return redactShape({ code: -32603, message })
}

/**
 * A shape with the user information, query values and fragments of every
 * URL in its message, hint and detail redacted. A new object: the error it
 * came from, which the log may still be writing, is left as it was.
 */
export function redactShape(shape: EngineErrorShape): EngineErrorShape {
  const message = redactUrls(shape.message)
  if (shape.data === undefined) return { code: shape.code, message }
  return {
    code: shape.code,
    message,
    data: {
      ...shape.data,
      hint: redactUrls(shape.data.hint),
      detail: redactUrls(shape.data.detail),
    },
  }
}
