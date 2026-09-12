import { useRef, useState, type JSX } from 'react'
import { THEMES, type ProjectRecord, type Theme } from '../../shared/project'
import Button from './kit/Button'

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
  const [saving, setSaving] = useState(false)
  // The last theme asked for while a write was in flight. A press that
  // arrives then is kept rather than dropped: dropping it silently leaves a
  // person looking at the theme they did not choose, with the button that
  // would fix it already showing as chosen.
  const waiting = useRef<Theme | null>(null)

  const choose = async (theme: Theme): Promise<void> => {
    if (saving) {
      waiting.current = theme
      return
    }
    if (theme === project.theme) return
    setProblem(null)
    setSaving(true)
    try {
      // Whatever was pressed last is what a person is asking for. A press
      // that only repeats what has just been written asks for nothing.
      let next: Theme | null = theme
      let written: Theme | null = null
      while (next !== null && next !== written) {
        await onChange(next)
        written = next
        next = waiting.current
        waiting.current = null
      }
    } catch (error) {
      waiting.current = null
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="theme-switch" aria-labelledby="theme-switch-heading">
      <h2 id="theme-switch-heading">Theme</h2>
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
      {problem !== null && (
        <p className="message error" role="alert">
          {problem}
        </p>
      )}
    </section>
  )
}
