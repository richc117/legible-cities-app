import { useRef, type JSX } from 'react'
import ThemeSwitch from '../../ThemeSwitch'
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
// its value teaches a person a lie (ADR-045). The sentence saying so is
// A5.5-17's, along with whatever the engine then answers.

export default function StyleCell({ cell, state, open, onToggle }: CellViewProps): JSX.Element {
  const { project, setTheme, exporting, layingOut } = useProject()
  const heading = useRef<HTMLHeadingElement>(null)
  return (
    <Cell
      number={cell.number}
      name={cell.name}
      state={state}
      open={open}
      onToggle={onToggle}
      headingRef={heading}
    >
      {project !== null &&
        (project.readOnly ? (
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
        ))}
    </Cell>
  )
}
