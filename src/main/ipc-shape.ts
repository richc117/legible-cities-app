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
// no known folder (`paths-in-text.ts`). Until then only the engine's hint, in
// `jsonrpc.ts`, and the export's own errors, in `export.ts`, lost their
// paths, and only up to the first space; the hint now reaches this door as
// the engine wrote it, so the known folders can be matched in it. The
// error the shape is made from is left as it was. Text with no path in it,
// and none of `? # @ %`, comes back exactly as it was.
//
// The app's own refusals (`badCall`, `refusal`) get the known folders and
// not the backstop: they can quote a person's project name, and a guess at
// a path inside a name rewrites the name.
//
// Each field is cut to `FIELD_CHARS` after its URLs are redacted - before,
// the cut could go through `user:pass@` and leave half a password - and
// before its paths are looked for, so the work on one error is bounded
// whatever the engine sent. A field the scrub fails on is replaced whole by
// `UNCHECKED`, because the shape is what a settling request is sent with,
// and a throw here would leave the page waiting for an answer that never
// comes.
//
// The folders are what make a call the door, and every caller names them:
// the two bridges hand in `index.ts`'s, `NO_ROOTS` where a test names none,
// which leaves `withoutPaths` alone to work. `URLS_ONLY` is the one way to
// shape an error that is not the door: the exporter's preview shapes its
// own refusal so, and the export bridge then puts it through the door with
// the folders. Taking the paths out there with no folder known would cut a
// path at a space the folder would have covered, and leave the rest for no
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

/**
 * Not the door: the URLs are redacted and the paths left for the door to
 * take out, with the folders, when the shape reaches it.
 */
export const URLS_ONLY: unique symbol = Symbol('URLs only')

/** What a shape is cleaned with: the folders, at the door, or `URLS_ONLY` on the way to it. */
export type Cleaning = PathRoots | typeof URLS_ONLY

/** The most of each field that crosses, in UTF-16 code units, the marker included. */
export const FIELD_CHARS = 4_096

/** What a cut field ends with. */
export const CUT = ' [cut to fit]'

/** What a field says when its paths could not be looked for. */
export const UNCHECKED =
  'This error could not be checked for file paths, so its words are not shown.'

/** A token the preload minted; a UUID passes. */
export const TOKEN = /^[A-Za-z0-9-]{1,64}$/

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The app's own refusal in the engine's shape, its sentence in all three
 * fields. The known folders come out of it, and nothing is guessed at: the
 * sentence can quote a person's project name.
 */
export function refusal(what: string, roots: PathRoots): EngineErrorShape {
  return outward(
    new EngineError(ERROR_CODES.badCall, what, {
      kind: 'params',
      detail: what,
      hint: what,
    }).toJSON(),
    roots,
    false,
  )
}

/** A call refused before anything started, answered rather than thrown so `data` survives the trip. */
export function badCall(what: string, roots: PathRoots): Accepted {
  return { accepted: false, error: refusal(what, roots) }
}

/** Any error as the engine's wire shape, redacted for the page. */
export function toShape(error: unknown, cleaning: Cleaning): EngineErrorShape {
  if (error instanceof EngineError) return redactShape(error.toJSON(), cleaning)
  const message = error instanceof Error ? error.message : String(error)
  return redactShape({ code: -32603, message }, cleaning)
}

/**
 * A shape with the user information, query values and fragments of every
 * URL in its message, hint and detail redacted, each field cut to
 * `FIELD_CHARS`, and, at the door, every path in them taken out (issue 419).
 * A new object: the error it came from, which the log may still be writing,
 * is left as it was.
 */
export function redactShape(shape: EngineErrorShape, cleaning: Cleaning): EngineErrorShape {
  return outward(shape, cleaning, true)
}

function outward(shape: EngineErrorShape, cleaning: Cleaning, backstop: boolean): EngineErrorShape {
  let scrub: ((text: string) => string) | undefined
  const clean = (text: string): string => {
    try {
      const redacted = capped(redactUrls(text))
      if (cleaning === URLS_ONLY) return redacted
      scrub ??= pathScrubber(knownNow(cleaning), process.platform, { backstop })
      return scrub(redacted)
    } catch {
      return UNCHECKED
    }
  }
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
 * A field no longer than `FIELD_CHARS`, the marker included. A cut that
 * falls in the last few hundred characters' final word goes back to the
 * space before it, so a path the cut goes through keeps no half of a folder's
 * name that its whole would have matched. Stable: a field cut once is not
 * cut again.
 */
function capped(text: string): string {
  if (text.length <= FIELD_CHARS) return text
  let head = text.slice(0, FIELD_CHARS - CUT.length)
  const space = head.search(/\s\S*$/)
  if (space >= head.length - 256) head = head.slice(0, space)
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1)
  return `${head}${CUT}`
}

/**
 * The known folders as they stand. A function that throws costs its folders
 * and leaves `withoutPaths` to do what it can.
 */
function knownNow(roots: PathRoots): readonly string[] {
  try {
    return roots()
  } catch {
    return []
  }
}
