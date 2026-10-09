import type { Theme } from '../../shared/project'
import { nextWrite, writeThrough } from './themeWrites'

// What the theme switch does with a choice, with no React in it (A7-13,
// issue 285): the in-flight flag, the choice kept while a write is going,
// what the record will hold once the writes asked for have landed, and
// which theme the cards should show meanwhile. `ThemeSwitch.tsx` is then
// only a screen over it, and the sequences that need a write held open are
// tested in `tests/unit/theme-chooser.test.ts`, which the end-to-end suite
// cannot make on purpose.
//
// **The theme to compare a choice with is kept here, and is not read from
// the screen.** The record's theme reaches the screen a render after its
// write has returned, and React renders a state update from a task of its
// own: a choice made in that gap - an arrow key a moment after the last
// one - would be compared with the theme the screen still had, found to be
// what the project already is, and dropped, while the radio the browser
// had checked was put back by React. That was seen on a slow macOS runner
// (issue 285), as a radio that stayed unchecked for good. So the theme
// each write lands is remembered here the moment it lands, and the screen's
// own is taken only when it changes (`sync`), and by then it is the same.

export interface ThemeChooser {
  /**
   * A theme was chosen. Writes it, or keeps it until the write in flight has
   * settled, or does nothing when it is the theme the project is already in.
   * Resolves when everything chosen meanwhile has been written, or the first
   * write that failed has said so.
   */
  choose(theme: Theme): Promise<void>
  /**
   * The project's theme, as the screen has it, each time it changes there:
   * what a write has landed, which is already known here, or a change made
   * elsewhere.
   */
  sync(theme: Theme): void
  /** Forget a choice kept for a write that is going: the way closed under it. */
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
  // What the record holds, or will once the writes in flight have landed.
  let recorded = initial
  // Whether a write is in flight, and the theme chosen while it was.
  let writing = false
  let kept: Theme | null = null

  return {
    async choose(theme) {
      const step = nextWrite(theme, recorded, writing)
      if (step === 'none') return
      asked(theme)
      if (step === 'keep') {
        kept = theme
        return
      }
      failed(null)
      writing = true
      try {
        await writeThrough(
          theme,
          async (next) => {
            await write(next)
            recorded = next
          },
          () => {
            const next = kept
            kept = null
            return next
          },
        )
      } catch (error) {
        kept = null
        failed(error instanceof Error ? error.message : String(error))
      } finally {
        // Nothing is left to write: the loop took what was kept, or the
        // failure dropped it. The record is the cards' word again - what
        // was written, or what it was if the write failed.
        writing = false
        asked(null)
      }
    },
    sync(theme) {
      recorded = theme
    },
    forget() {
      kept = null
    },
  }
}
