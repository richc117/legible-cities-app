import type { Theme } from '../../shared/project/types'
import { messageOf } from '../../shared/errors'

// What the theme switch does with a choice, with no React in it (A7-13,
// issue 285): which theme the record will hold once the writes asked for
// have landed, and which theme the cards should show meanwhile.
// `ThemeSwitch.tsx` is then only a screen over it, and the sequences that
// need a write held open are tested in `tests/unit/theme-chooser.test.ts`,
// which the end-to-end suite cannot make on purpose.
//
// **Each choice is written the moment it is made, and nothing here orders
// the writes.** The bridge hands main a frame's calls in the order they were
// sent and the store writes a project's record in that order, answering in
// it too (spec 037, "The record session" in docs/ARCHITECTURE.md): the
// record ends at the last choice, and the last answer is the last choice's.
// What is kept here is only what the cards show while a choice is on its way
// - the latest asked, until its own answer comes - and the theme a choice is
// compared with.
//
// **The theme to compare a choice with is kept here, and is not read from
// the screen.** The record's theme reaches the screen a render after its
// write has returned, and React renders a state update from a task of its
// own: a choice made in that gap - an arrow key a moment after the last
// one - would be compared with the theme the screen still had, found to be
// what the project already is, and dropped, while the radio the browser
// had checked was put back by React. That was seen on a slow macOS runner
// (issue 285), as a radio that stayed unchecked for good. So the theme a
// choice asks for is remembered here the moment it is asked, and the
// screen's own is taken only when it changes (`sync`).

export interface ThemeChooser {
  /**
   * A theme was chosen. Writes it, or does nothing when it is the theme the
   * project is already in or already asked for. Resolves when its write has
   * been answered, or has said why it failed.
   */
  choose(theme: Theme): Promise<void>
  /**
   * The project's theme, as the screen has it, each time it changes there:
   * what a write has landed, which is already known here, or a change made
   * elsewhere.
   */
  sync(theme: Theme): void
  /**
   * The way closed under a choice on its way. Since every choice is written
   * as it is made (spec 037), there is nothing held back to forget: the
   * write on its way lands as the last word on the record, and the page is
   * told it, or given it on the address of the next document.
   */
  forget(): void
}

interface Options {
  /** The theme the project holds now. */
  initial: Theme
  /** Write one theme to the record, and restyle the map. Rejects when it cannot. */
  write: (theme: Theme) => Promise<void>
  /**
   * The theme the cards should show in place of the record's while a choice
   * is on its way to it, or null when they should show the record's.
   */
  asked: (theme: Theme | null) => void
  /** What went wrong with the last write, or null when a new one starts. */
  failed: (message: string | null) => void
}

export function createThemeChooser({ initial, write, asked, failed }: Options): ThemeChooser {
  // What the record holds, or will once the writes on their way have landed.
  let recorded = initial
  // The latest choice whose answer has not come; its answer is the last.
  let latest: { theme: Theme } | null = null

  return {
    async choose(theme) {
      if (theme === (latest?.theme ?? recorded)) return
      const mine = { theme }
      latest = mine
      asked(theme)
      failed(null)
      try {
        await write(theme)
        // Answered in the order they were sent, so the last to land is the
        // record's; and the latest choice landing is nothing left unsaved.
        recorded = theme
        if (latest === mine) failed(null)
      } catch (error) {
        // What the record holds is what the writes before this one left,
        // which the screen's own record says (`sync`).
        failed(messageOf(error))
      } finally {
        // The last answer is the latest choice's: the record is the cards'
        // word again - what was written, or what it was if the write failed.
        if (latest === mine) {
          latest = null
          asked(null)
        }
      }
    },
    sync(theme) {
      recorded = theme
    },
    forget() {
      // Nothing is held back (see above).
    },
  }
}
