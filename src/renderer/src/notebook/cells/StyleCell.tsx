import { useRef, type JSX } from 'react'
import ThemeSwitch, { themeWord } from '../../ThemeSwitch'
import Cell from '../Cell'
import type { CellViewProps } from '../cells'
import { useProject } from '../context'

// Cell 04, Style: how the map is drawn (ADR-045).
//
// One control today, the project's theme (A4-03), drawn headless because
// this cell's heading is the section's heading now and its focus handback
// lands there - on the heading, not on the toggle inside it, which a press
// after the handback would collapse. `render.Style` exists on the engine but `serve.py` never
// constructs one, so line width, station radii and label size are not
// drawn at all rather than drawn disabled - a control with nowhere to send
// its value teaches a person a lie (ADR-045). One sentence says so, which
// is the whole of what this cell can honestly offer until the engine takes
// a style; the cell keeps its number either way, since renumbering it
// would move every issue code, every rail step and every test selector.
//
// The collapsed summary is the theme in the map's own words, Warm dark or
// Sepia. Not the interface's Night and Parchment: ADR-044 rethemed the
// interface alone, so the two palettes are different things and a summary
// naming this one after the other would be wrong about which it is.

export default function StyleCell({ cell, state, open, onToggle }: CellViewProps): JSX.Element {
  const { project, setTheme, exporting, layingOut } = useProject()
  const heading = useRef<HTMLHeadingElement>(null)
  return (
    <Cell
      number={cell.number}
      name={cell.name}
      state={state}
      // Null while the record is being read: a cell with nothing true to
      // say says nothing. A read-only project still names its theme, which
      // is drawn on the map whether or not it can be changed here.
      summary={project === null ? null : themeWord(project.theme)}
      open={open}
      onToggle={onToggle}
      headingRef={heading}
    >
      {project !== null && (
        <>
          {project.readOnly ? (
            // A cell with nothing to offer says so in one sentence and offers
            // no disabled stand-in (DESIGN.md 8.2). Under the tabs this panel
            // was simply absent, which left the reason to be guessed at.
            <p className="prose">
              This project was made by a newer version of the app, so its theme cannot be changed
              here.
            </p>
          ) : (
            <ThemeSwitch
              project={project}
              onChange={setTheme}
              disabled={exporting || layingOut}
              handback={heading}
            />
          )}
          {/* The same rule, about the engine rather than the record: what
              this cell will hold, said plainly, with nothing standing in
              for it. True of a read-only project too, which is why it sits
              outside the branch above. */}
          <p className="prose">
            Line width, station size and label size are the engine&rsquo;s own for now: it has no
            way to be told otherwise, so nothing here offers to set them. They are chosen in this
            cell once there is one.
          </p>
        </>
      )}
    </Cell>
  )
}
