import type { Theme } from '../../shared/project'
import { MISSING_METHOD } from '../../shared/viewer'

// The theme switch's own pieces of logic, with no React in them: what a
// press should do at this moment, how a press that arrived during a write is
// applied after it, and what a written theme does to the map on screen. The
// rule that logic lives in something callable without rendering is what
// makes these testable (.claude/rules/renderer.md). Over them sits the
// chooser (themeChooser.ts), which holds what the switch remembers between
// one press and the next, and the switch (ThemeSwitch.tsx) is then only a
// screen over that.
//
// A theme is written the moment it is pressed rather than after a build, so
// there is no debounce here and nothing to cancel - only the gap of one
// round trip to the record, which is short and still long enough for a
// second press to land in it.

/**
 * What a press should do now: write it, keep it until the write in flight
 * has settled, or nothing at all because it is what the project already is.
 *
 * Keeping rather than dropping is the point. A press a person cannot see
 * refused is indistinguishable from a dead button, and the button that
 * would undo it already reads as the chosen one.
 */
export function nextWrite(
  theme: Theme,
  current: Theme,
  writing: boolean,
): 'write' | 'keep' | 'none' {
  if (writing) return 'keep'
  return theme === current ? 'none' : 'write'
}

/**
 * Write one theme, then whatever was pressed while that was happening, and
 * so on until nothing more has been asked for. `take` answers the theme
 * kept since the last call and forgets it; answering null ends the run, and
 * so does a press that only repeats what has just been written.
 *
 * It gives up on the first failure, with the error, so the screen can say
 * which press did not land; anything kept behind it is `take`'s to forget.
 */
export async function writeThrough(
  first: Theme,
  write: (theme: Theme) => Promise<void>,
  take: () => Theme | null,
): Promise<void> {
  let next: Theme | null = first
  let written: Theme | null = null
  while (next !== null && next !== written) {
    await write(next)
    written = next
    next = take()
  }
}

/**
 * Write one theme to the record and then restyle the map's page in place
 * (issue 349): the record first, as it always was, and the page second.
 *
 * **A write that fails sends nothing**: the rejection is the caller's to
 * show, and a map restyled for a theme the record does not hold would be the
 * screen and the file disagreeing about what the project is.
 *
 * **The restyle is not waited for, and almost nothing it says is an error.**
 * The page can be missing for good reasons - no layout yet, so no map; the
 * frame between two documents - and in each the record already holds the
 * theme, which the next document carries on its address and is given again
 * as its first call (`restoreCalls`). Waiting would also hand a page whose
 * main thread is blocked the switch's write loop, which would then keep every
 * later press for ever. The calls are sent in the order the presses were
 * written, so the last word at the page is the last word on the record.
 *
 * **The one refusal that is answered is the page having no `setTheme`**: a
 * page the engine wrote before v0.11.0 says `MISSING_METHOD`, and no later
 * document is coming to carry the theme. `fallBack` is then called, and
 * it is the caller's to do what was done before the seam had a theme: load
 * the page again at an address with the live theme, through the path a
 * redraw takes. Every other failure stays swallowed.
 */
export async function writeThenRestyle(
  theme: Theme,
  write: (theme: Theme) => Promise<void>,
  restyle: (theme: Theme) => Promise<unknown>,
  fallBack: () => void = () => undefined,
): Promise<void> {
  await write(theme)
  const refused = (error: unknown): void => {
    if (!lacksTheSeam(error)) return
    try {
      fallBack()
    } catch {
      // The record is written and the page is as it was; there is nobody to tell.
    }
  }
  try {
    restyle(theme).then(undefined, refused)
  } catch {
    // A bridge that throws before it can ask is the same silence.
  }
}

/**
 * Whether a rejected call to the page is the page saying it has no such
 * method. The sentence is the dispatcher's own and is compared whole: a page
 * that is still loading says another, the frame being gone says another, and
 * neither is a reason to load the page again.
 */
export function lacksTheSeam(error: unknown): boolean {
  return error instanceof Error && error.message === MISSING_METHOD
}
