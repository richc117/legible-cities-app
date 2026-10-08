import { useEffect, useRef, useState, type JSX, type RefObject } from 'react'
import { THEMES, type ProjectRecord, type Theme } from '../../shared/project'
import Button from './kit/Button'
import { nextWrite, writeThrough } from './themeWrites'

// The theme a project's map is drawn in (A4-03, specs/021-theme).
//
// Neither a layout nor a render: the engine's page carries its furniture's
// colours as CSS variables with literal fallbacks, so a theme is written the
// moment it is pressed and then the page is told through its seam, which
// restyles it in place (`setTheme`, engine v0.11.0; issue 349). The frame is
// not reloaded: its clock, view, labels and speed stay as they were. The
// address carries the theme for the next load only. The line colours are not
// themed and do not move.
//
// It is the project's theme, not the interface's. The interface has its own
// in Settings (A1-04) and the two are independent: a theme belongs to the
// map, which is exported and published, rather than to the room the person
// making it is sitting in.

/**
 * What each theme is called on the screen; the values are the engine page's
 * own.
 *
 * Deliberately not Night and Parchment, which is what Settings calls the
 * *interface's* two themes: ADR-044 rethemed the interface and left the
 * map where it was, so the two palettes are no longer one and naming them
 * alike would say they are. These are the map's words, and a project's map
 * is what this sets.
 */
const WORDS: Record<Theme, string> = {
  'warm-dark': 'Warm dark',
  sepia: 'Sepia',
}

/**
 * The theme in the map's own words, for the buttons here and for cell 04's
 * collapsed summary (A5.5-17). Beside the buttons that say it rather than
 * in a module of its own, so the row and the summary cannot drift apart.
 */
export const themeWord = (theme: Theme): string => WORDS[theme]

interface Props {
  project: ProjectRecord
  /**
   * Write the theme to the record and then tell the map's page, which
   * restyles in place (`writeThenRestyle`). Rejects, and sends nothing, when
   * the record cannot be written.
   */
  onChange: (theme: Theme) => Promise<void>
  /**
   * True while a run or an export is going. A run rewrites the page file in
   * place and then sends the frame to the result, so a theme set on the page
   * now on screen would be set on a document that is about to go (the record
   * would hold it and the next page would carry it, but nothing would show
   * the press taking); an export took the theme when it planned, so a change
   * during one would not reach the reel it is making.
   */
  disabled?: boolean
  /**
   * Where focus goes when a control that held it is disabled: the heading
   * of the cell the switch is drawn in (A5.5-08). Required, because the
   * switch draws no heading of its own - the cell's names it - and a panel
   * with nowhere to hand focus back to is the A6-07 defect itself: Chromium
   * blurs a disabled element and focus falls to the body. Until the tab
   * strip went (A5.5-23) it was optional, and its absence drew an `h2`.
   */
  handback: RefObject<HTMLElement | null>
  /**
   * Say nothing about why the buttons are disabled. A redraw for colours
   * or order is over in moments and started by the person's own hand, and
   * the sentence added fifty-odd pixels under the cell the colour panel is
   * opened from, moving it (issue 304).
   */
  quiet?: boolean
}

/** What the section is called, as its name inside cell 04. */
const NAME = 'Theme'

export default function ThemeSwitch({
  project,
  onChange,
  disabled = false,
  handback,
  quiet = false,
}: Props): JSX.Element {
  const [problem, setProblem] = useState<string | null>(null)
  // Whether a write is in flight, and the theme pressed while it was: refs
  // rather than state, because a press reads them in the same tick it
  // arrives. As state, the flag would still read true through the render
  // after the last write settled, and a press landing in that gap would be
  // kept by a loop that had already ended - the silent drop this exists to
  // stop, in a narrower window.
  const writing = useRef(false)
  const kept = useRef<Theme | null>(null)
  const section = useRef<HTMLElement>(null)

  // A run can start from a timer rather than a press: a colour or an order
  // change is debounced, so the way closes with nobody touching anything.
  // Chromium blurs a disabled element, so focus is handed to the cell's heading
  // before the buttons go, and a press kept from before is forgotten -
  // applying it after the way closed is what the closing is for.
  useEffect(() => {
    if (!disabled) return
    kept.current = null
    const active = document.activeElement
    if (active !== null && section.current?.contains(active) === true) {
      handback.current?.focus()
    }
  }, [disabled, handback])

  const choose = async (theme: Theme): Promise<void> => {
    const step = nextWrite(theme, project.theme, writing.current)
    if (step === 'none') return
    if (step === 'keep') {
      kept.current = theme
      return
    }
    setProblem(null)
    writing.current = true
    try {
      await writeThrough(theme, onChange, () => {
        const next = kept.current
        kept.current = null
        return next
      })
    } catch (error) {
      kept.current = null
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      writing.current = false
    }
  }

  return (
    <section className="theme-switch" aria-label={NAME} aria-busy={disabled} ref={section}>
      <p className="prose">
        The map is drawn in one of the engine&rsquo;s two themes, and so is every export of it. The
        interface has its own theme in Settings; neither follows the other.
      </p>
      <div className="toolbar" role="group" aria-label="The theme this map is drawn in">
        {THEMES.map((theme) => (
          <Button
            key={theme}
            variant={theme === project.theme ? 'primary' : 'secondary'}
            aria-pressed={theme === project.theme}
            /* Not disabled while the write is in flight: it takes a
               moment, and a button that disables itself under a person's
               hands takes the focus with it (A3-04). A press that arrives
               then is kept and applied when the write settles. */
            disabled={disabled}
            onClick={() => void choose(theme)}
          >
            {WORDS[theme]}
          </Button>
        ))}
      </div>
      {disabled && !quiet && (
        <p className="hint" role="status">
          The theme waits until the run that is going has finished: the map on screen is being
          written, and an export is made in the theme it was planned with.
        </p>
      )}
      {problem !== null && (
        <p className="message error" role="alert">
          {problem}
        </p>
      )}
    </section>
  )
}
