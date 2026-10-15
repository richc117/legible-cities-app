// Paths taken out of an error's sentences by the folders the main process
// knows, at the one door every error shape goes through on its way to the
// page (`src/main/ipc-shape.ts`, issue 419).
//
// `withoutPaths` guesses where a path starts and ends, and a guess stops at
// the first space: on the default macOS install the engine's home is under
// "Application Support", so an I/O failure printed the tail of the engine's
// data path on screen, and a folder a person named with a space printed the
// tail of theirs. The main process does not have to guess. Every path an
// error can name starts with a folder it knows - the engine's home, the
// user-data folder, the resources folder, the export folder in force and
// the home folder - so each is matched whole, whatever its names hold, in
// every form a message can write it: either separator, separators doubled
// as `repr` and JSON print them, percent-encoded as in a file URL, in any
// case on Windows and macOS, and on Windows the 8.3 short name of its last
// folder. That is the home folder's pattern from "Copy diagnostics"
// (`homePattern` in `diagnostics-text.ts`), reused, so the two can never
// disagree about what counts as the home written another way.
//
// From the folder on, the path runs to its closing quote where a quote
// opened it, and otherwise as far as `withoutPaths` would run it: to a
// space, unless a later word in the clause carries the path on (a folder
// under the export folder named after a project with a space in it), or a
// comma, a semicolon or a colon before a space, a closing parenthesis, or
// the end of the line. The whole path becomes "a file", the words the
// engine's sentences already read with. Then `withoutPaths` runs over what
// is left, as the backstop for a path under no folder named here.
//
// Nothing here reads Electron or the disk except through what it is handed,
// so the rule and the lookups are asserted in unit tests.

import { PATH_REST, QUOTE_CLOSES, QUOTED_CHAR, withoutPaths } from '../shared/engine'
import { homePattern } from './diagnostics-text'
import { inTime, LAPSED } from './settings'

/** What a path is replaced with. */
export const A_FILE = 'a file'

/**
 * What may not stand right before a folder for the match to be its start: a
 * letter, a digit or `_ ~ . -`, which would make it the end of a longer name
 * - or the path of a web address, whose host ends in one.
 */
const NAME_BEFORE = String.raw`(?<![\p{L}\p{N}_~.-])`

/** A folder this shallow names nobody, and a drive alone would match any word ending in a letter and a colon. */
const deepEnough = (root: string): boolean =>
  root.split(/[\\/]+/).filter((part) => part !== '').length >= 2

/**
 * One known folder and the rest of the path after it, quoted or bare. The
 * first group is the quote, when there is one, so the replacement keeps it
 * and the sentence keeps its shape (`'a file'`).
 */
function rootPattern(root: string, platform: string): RegExp | null {
  if (!deepEnough(root)) return null
  const folder = homePattern(root, platform)
  if (folder === null) return null
  const quoted = String.raw`(['"])(?:${folder.source})${QUOTED_CHAR}*?\1${QUOTE_CLOSES}`
  const bare = `${NAME_BEFORE}(?:${folder.source})${PATH_REST}`
  return new RegExp(`${quoted}|${bare}`, folder.flags)
}

/**
 * A function that takes the paths out of a text: every path under one of
 * the roots, then the backstop. The patterns are made once, so a door that
 * cleans three fields of one error makes them once.
 */
export function pathScrubber(
  roots: readonly string[],
  platform: string = process.platform,
): (text: string) => string {
  const patterns = [...new Set(roots)]
    // The longest first, so a folder inside another is replaced whole before
    // the one around it could take only its start.
    .sort((a, b) => b.length - a.length)
    .map((root) => rootPattern(root, platform))
    .filter((pattern): pattern is RegExp => pattern !== null)
  return (text) => {
    let out = text
    for (const pattern of patterns) {
      out = out.replace(pattern, (_match, quote: string | undefined) =>
        quote === undefined ? A_FILE : `${quote}${A_FILE}${quote}`,
      )
    }
    return withoutPaths(out)
  }
}

/** A text with every path under a known folder, and then every other path it can find, taken out. */
export function withoutKnownPaths(
  text: string,
  roots: readonly string[],
  platform: string = process.platform,
): string {
  return pathScrubber(roots, platform)(text)
}

/** Where the known folders come from; `index.ts` hands in Electron's and the settings' answers. */
export interface RootSources {
  /**
   * The folders as they stand, asked at every call: the export folder can
   * change in Settings while the app runs, and the one in force is the one
   * an export writes to.
   */
  roots: () => readonly string[]
  /** One folder through its links. */
  realpath: (path: string) => Promise<string>
  /**
   * The home folder in every other form a copy hides - through its links,
   * and on Windows in 8.3 short form - from the lookup "Copy diagnostics"
   * makes (`SettingsService.homesToHide`). Asked once.
   */
  homes: () => Promise<readonly string[]>
  /** How long a lookup is waited for (`HOMES_TIMEOUT_MS`). */
  ms: number
}

type Lookup = 'asking' | 'lapsed' | { real: string }

/** A lookup's promise, with a lookup that throws as it is asked turned into one that fails. */
function asked<T>(lookup: () => Promise<T>): Promise<T> {
  try {
    return lookup()
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * The folders a path can start with, as a function the door asks at each
 * error. The door never waits: it gets every folder as named at once, and
 * each one's real path, and the home's other forms, once their lookups have
 * answered. Each lookup is bounded at `ms`, as the diagnostics copy bounds
 * its own, and a lookup that lapses is abandoned (`inTime`): its folder is
 * used as named from then on, and the disk is not asked about it again, so
 * a folder on a share that stalls holds one of the threads files are read
 * with, never one per error. A lookup that fails in time is asked again at
 * the next error, since the folder may not have been made yet (the export
 * folder is made by the first export).
 */
export function knownRoots(sources: RootSources): () => string[] {
  const lookups = new Map<string, Lookup>()
  let homes: readonly string[] = []
  const ask = (root: string): void => {
    lookups.set(root, 'asking')
    void inTime(
      asked(() => sources.realpath(root)),
      sources.ms,
    ).then(
      (answer) => lookups.set(root, answer === LAPSED ? 'lapsed' : { real: answer }),
      () => lookups.delete(root),
    )
  }
  const current = (): string[] => {
    const named = sources.roots().filter((root) => root !== '')
    for (const root of named) if (!lookups.has(root)) ask(root)
    const real = named.flatMap((root) => {
      const lookup = lookups.get(root)
      return typeof lookup === 'object' ? [lookup.real] : []
    })
    return [...new Set([...named, ...real, ...homes])]
  }
  void inTime(asked(sources.homes), sources.ms).then(
    (answer) => {
      if (answer !== LAPSED) homes = answer
    },
    // The home as named, and through its links, are among the folders
    // `index.ts` names, so what is lost is its 8.3 short form, which
    // `homePattern` still matches by shape on Windows.
    () => undefined,
  )
  current()
  return current
}
