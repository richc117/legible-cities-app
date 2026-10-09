import { useId, useLayoutEffect, useRef, useState, type JSX, type RefObject } from 'react'
import { THEMES, isTheme, type ProjectRecord, type Theme } from '../../shared/project'
import { themePicture } from './themePictures'
import { createThemeChooser, type ThemeChooser } from './themeChooser'

// The theme a project's map is drawn in (A4-03, specs/021-theme).
//
// Neither a layout nor a render: the engine's page carries its furniture's
// colours as CSS variables with literal fallbacks, so a theme is written the
// moment it is pressed and then the page is told through its seam, which
// restyles it in place (`setTheme`, engine v0.11.0; issue 349). The frame is
// not reloaded: its clock, view, labels and speed stay as they were. The
// address carries the theme for the next load only, except for a page from
// before v0.11.0, which cannot be told and is loaded again at the new theme.
// The line colours are not themed and do not move.
//
// It is the project's theme, not the interface's. The interface has its own
// in Settings (A1-04) and the two are independent: a theme belongs to the
// map, which is exported and published, rather than to the room the person
// making it is sitting in.
//
// **Two native radios, each a card** (A7-13, issue 285, DESIGN.md 8.2). A
// theme is a stored choice and the two exclude each other, which is what a
// radio group says to a screen reader and to the arrow keys; a pair of
// pressed buttons says only that each is pressed or not. Each radio sits in
// the `<label>` that is its card, over the engine's picture of the theme
// and the theme's word, and is visually hidden but keeps focus, so the card
// draws the ring and the checked edge (`panels.css`). The picture is
// `alt=""`: it sits beside the word that names it, and the radio takes its
// name from the word alone. The pictures are the engine's files
// (`themePictures.ts`); nothing here draws a line or a station.

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
 * The theme in the map's own words, for the cards here and for cell 04's
 * collapsed summary (A5.5-17). Beside the cards that say it rather than
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
   * the choice taking); an export took the theme when it planned, so a change
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
   * Say nothing about why the cards are disabled. A redraw for colours
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
  // The theme most recently asked for while its write is still on its way,
  // so the cards show the person's last choice at once and not the record's
  // until the write has landed. A radio the person has just checked and the
  // page then unchecks - the record still holding the old theme for the
  // moment a write takes - is read out as a choice that did not take, and a
  // second choice back to the old theme would be a click on a radio that
  // already looks checked, which the browser never reports.
  const [asked, setAsked] = useState<Theme | null>(null)
  const shown = asked ?? project.theme
  // One name for the two radios, so they are one group to the keyboard: Tab
  // enters it once and the arrow keys move the choice.
  const group = useId()
  // What a choice does - written, kept for the write in flight, or nothing
  // - is `themeChooser.ts`, made once for the life of the switch. It takes
  // the latest `onChange`, not the one it was made with, and the record's
  // theme from here only when nothing is being written: the screen's copy
  // of it arrives a render after a write has landed, and a choice made in
  // that gap must not be compared with the old one.
  const write = useRef(onChange)
  useLayoutEffect(() => {
    write.current = onChange
  })
  const made = useRef<ThemeChooser | null>(null)
  const chooser = (made.current ??= createThemeChooser({
    initial: project.theme,
    write: (theme) => write.current(theme),
    asked: setAsked,
    failed: setProblem,
  }))
  useLayoutEffect(() => {
    chooser.sync(project.theme)
  }, [chooser, project.theme])
  const section = useRef<HTMLElement>(null)

  // A run can start from a timer rather than a choice: a colour or an order
  // change is debounced, so the way closes with nobody touching anything.
  // Chromium blurs a disabled element, so focus is handed to the cell's heading
  // before the radios go, and a choice kept from before is forgotten -
  // applying it after the way closed is what the closing is for.
  //
  // A layout effect, so it runs in the commit that disables the radios, as the
  // DOM is written and before any task of the browser's own. The kit's
  // buttons this replaced were disabled by an effect of their own, which ran
  // just before this one in the same flush; a radio is disabled by the commit
  // itself, and an effect left to the scheduler runs later and could find
  // focus already gone.
  //
  // **Each radio is disabled itself and not the fieldset round them.**
  // Chromium takes focus from an element disabled directly at its next
  // focus check, a task later, so it is still there to be found; but from
  // a descendant of a disabled fieldset it takes focus as the attribute is
  // written, and this would find the body (measured in Chromium 153:
  // `document.activeElement` is the body in the same task as the write for
  // a fieldset, and the radio itself for a radio, a select or a button).
  useLayoutEffect(() => {
    if (!disabled) return
    chooser.forget()
    const active = document.activeElement
    if (active !== null && section.current?.contains(active) === true) {
      handback.current?.focus()
    }
  }, [chooser, disabled, handback])

  return (
    <section className="theme-switch" aria-label={NAME} aria-busy={disabled} ref={section}>
      <p className="prose">
        The map is drawn in one of the engine&rsquo;s two themes, and so is every export of it. The
        interface has its own theme in Settings; neither follows the other.
      </p>
      {/* A fieldset named for what it sets. Its legend is the group's name
          and is not drawn: the paragraph above says the same in words, and
          the cards are the control. The radios are disabled one by one while
          a run or an export holds the page, and not the fieldset, which would
          take focus from the radio holding it before the handback above could
          hand it on. Not disabled while the write is in flight: it takes a
          moment, and a control that disables itself under a person's hands
          takes the focus with it (A3-04). A choice that arrives then is kept
          and applied when the write settles. */}
      <fieldset className="theme-cards-group">
        <legend className="visually-hidden">The theme this map is drawn in</legend>
        <div className="theme-cards">
          {THEMES.map((theme) => (
            <label key={theme} className="card theme-card">
              <input
                type="radio"
                className="visually-hidden"
                name={group}
                value={theme}
                checked={theme === shown}
                disabled={disabled}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  if (isTheme(value)) void chooser.choose(value)
                }}
              />
              <span className="card-picture">
                <img src={themePicture(theme)} alt="" />
              </span>
              <span className="card-name">{WORDS[theme]}</span>
            </label>
          ))}
        </div>
      </fieldset>
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
