// What the two job bridges share: the token the page mints, a refusal that
// crosses the bridge as data, and an error turned into the engine's wire
// shape. Small on purpose; each bridge keeps its own channels and rules.
//
// It is also the one door an error goes through on its way to the page
// (issue 207), so the redaction is here and nowhere else. Until v0.10.1 the
// engine wrote a failed download's whole URL into its error - `FeedError`'s
// sentence was "{url} could not be fetched: ...", and the serve loop makes
// that the message, the hint and the start of the detail
// (`serve.classify`) - so a key in a feed's query string would otherwise
// have been drawn on screen by the New project sheet and every panel's
// failure line, and kept in the jobs inspector. Since v0.10.1 the engine
// redacts a person's feed at source (engine issue 32), and this door
// stays: for an older engine's sentence, and for anyone else's. The logs have been redacted since A6-03;
// this is the same `redactUrls`, applied to all three fields of every shape
// that crosses, the app's own refusals included.
//
// Since issue 419 the paths come out here too, from the same three fields:
// every path under a folder the main process knows - the engine's home, the
// user-data folder, the resources folder, the export folder in force and the
// home folder, as `index.ts` names them - is "a file", whatever spaces or
// quotes it holds, and `withoutPaths` then takes out what it can find under
// no known folder (`paths-in-text.ts`). Before this only the engine's hint
// and the export's own errors lost their paths, and only up to the first
// space, in `jsonrpc.ts` and `export.ts`, which still run `withoutPaths`
// first. The error the shape is made from is left as it was, so whatever
// logs it logs the paths, which the log may contain. Text with no path in
// it, and none of `? # @ %`, comes back exactly as it was.
//
// The folders are what make a call the door. The two bridges always hand
// them in (`NO_ROOTS` where a test names none, which leaves `withoutPaths`
// alone to work); a shape made without them has its URLs redacted and its
// paths left as they were, which is the exporter's preview, shaping its own
// refusal before the export bridge puts it through the door with the
// folders. Taking the paths out there with no folder known would cut a path
// at a space the folder would have covered, and leave the rest for no
// later pass to find.

import type { Accepted } from '../shared/api'
import { EngineError, ERROR_CODES, type EngineErrorShape } from '../shared/engine'
import { pathScrubber } from './paths-in-text'
import { redactUrls } from './redact'

/**
 * The folders a path in an error can start with, asked as each error is
 * shaped: a function, not a list, because the export folder can change while
 * the app runs (`knownRoots` in `paths-in-text.ts`, composed in `index.ts`).
 */
export type PathRoots = () => readonly string[]

/** The door with no folder known: the URLs are redacted and `withoutPaths` is the only path rule. */
export const NO_ROOTS: PathRoots = () => []

/** A token the preload minted; a UUID passes. */
export const TOKEN = /^[A-Za-z0-9-]{1,64}$/

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** A call refused before anything started, answered rather than thrown so `data` survives the trip. */
export function badCall(what: string, roots?: PathRoots): Accepted {
  return {
    accepted: false,
    error: redactShape(
      new EngineError(ERROR_CODES.badCall, what, {
        kind: 'params',
        detail: what,
        hint: what,
      }).toJSON(),
      roots,
    ),
  }
}

/** Any error as the engine's wire shape, redacted for the page. */
export function toShape(error: unknown, roots?: PathRoots): EngineErrorShape {
  if (error instanceof EngineError) return redactShape(error.toJSON(), roots)
  const message = error instanceof Error ? error.message : String(error)
  return redactShape({ code: -32603, message }, roots)
}

/**
 * A shape with the user information, query values and fragments of every
 * URL in its message, hint and detail redacted, and, given the folders a
 * path can start with, every path in them taken out (issue 419). A new
 * object: the error it came from, which the log may still be writing, is
 * left as it was.
 */
export function redactShape(shape: EngineErrorShape, roots?: PathRoots): EngineErrorShape {
  const withoutPaths = roots === undefined ? (text: string) => text : pathScrubber(knownNow(roots))
  const clean = (text: string): string => withoutPaths(redactUrls(text))
  const message = clean(shape.message)
  if (shape.data === undefined) return { code: shape.code, message }
  return {
    code: shape.code,
    message,
    data: {
      ...shape.data,
      hint: clean(shape.data.hint),
      detail: clean(shape.data.detail),
    },
  }
}

/**
 * The known folders as they stand. A function that throws costs its folders
 * and leaves `withoutPaths` to do what it can, because the shape is what a
 * settling request is sent with: a throw here would leave the page waiting
 * for an answer that never comes.
 */
function knownNow(roots: PathRoots): readonly string[] {
  try {
    return roots()
  } catch {
    return []
  }
}
