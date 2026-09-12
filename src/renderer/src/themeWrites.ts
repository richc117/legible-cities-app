import type { Theme } from '../../shared/project'

// The theme switch's own two pieces of logic, with no React in them: what a
// press should do at this moment, and how a press that arrived during a
// write is applied after it. The rule that logic lives in something
// callable without rendering is what makes these testable
// (.claude/rules/renderer.md), and the switch above them (ThemeSwitch.tsx)
// is then only a screen.
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
