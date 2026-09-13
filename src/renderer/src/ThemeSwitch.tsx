import { useEffect, useRef, useState, type JSX } from 'react'
import { THEMES, type ProjectRecord, type Theme } from '../../shared/project'
import Button from './kit/Button'
import { nextWrite, writeThrough } from './themeWrites'

// The theme a project's map is drawn in (A4-03, specs/021-theme).
//
// Neither a layout nor a render: the engine's page carries its furniture's
// colours as CSS variables with literal fallbacks and restyles itself from
// its own address, so a theme is written the moment it is pressed and the
// frame simply reloads. The line colours are not themed and do not move.
//
// It is the project's theme, not the interface's. The interface has its own
// in Settings (A1-04) and the two are independent: a theme belongs to the
// map, which is exported and published, rather than to the room the person
// making it is sitting in.

/** What each theme is called on the screen; the values are the engine page's own. */
const WORDS: Record<Theme, string> = {
  'warm-dark': 'Warm dark',
  sepia: 'Sepia',
}

interface Props {
  project: ProjectRecord
  /** The record as the store wrote it, so the viewer redraws in the new theme. */
  onChange: (theme: Theme) => Promise<void>
  /**
   * True while a run or an export is going. A run rewrites the page file in
   * place, and a theme change reloads the frame that reads it, which would
   * show a person half a document and an alert saying their map is gone; an
   * export took the theme when it planned, so a change during one would not
   * reach the reel it is making.
   */
  disabled?: boolean
}

export default function ThemeSwitch({ project, onChange, disabled = false }: Props): JSX.Element {
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
  const headingRef = useRef<HTMLHeadingElement>(null)

  // A run can start from a timer rather than a press: a colour or an order
  // change is debounced, so the way closes with nobody touching anything.
  // Chromium blurs a disabled element, so focus is handed to the heading
  // before the buttons go, and a press kept from before is forgotten -
  // applying it after the way closed is what the closing is for.
  useEffect(() => {
    if (!disabled) return
    kept.current = null
    const active = document.activeElement
    if (active !== null && section.current?.contains(active) === true) {
      headingRef.current?.focus()
    }
  }, [disabled])

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
    <section
      className="theme-switch"
      aria-labelledby="theme-switch-heading"
      aria-busy={disabled}
      ref={section}
    >
      <h2 id="theme-switch-heading" tabIndex={-1} ref={headingRef}>
        Theme
      </h2>
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
      {disabled && (
        <p className="hint" role="status">
          The theme waits until the run that is going has finished: it changes what the map on
          screen is loaded from, and an export is made in the theme it was planned with.
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
