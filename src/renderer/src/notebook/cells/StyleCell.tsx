import { useRef, type JSX } from 'react'
import type { ProjectRecord } from '../../../../shared/project'
import StyleFields from '../../StyleFields'
import ThemeSwitch, { themeWord } from '../../ThemeSwitch'
import { sizesWords } from '../../styleRules'
import Cell from '../Cell'
import type { CellViewProps } from '../cells'
import { useProject } from '../context'
import { runRowStatus } from '../runRow'

// Cell 04, Style: how the map is drawn (ADR-045).
//
// Two sections, the project's theme (A4-03) and the map's sizes (issue 350,
// ADR-049), both drawn headless: the cell's own heading is the section's
// heading, and its focus handback lands there - on the heading, not on the
// toggle inside it, which a press after the handback would collapse. Each
// names its region by an `aria-label` ("Theme", "Sizes") and not by a
// heading: the cell is called Style and holds nothing else, so a heading
// beneath it would only repeat the label a screen reader has already said.
//
// The theme is neither a layout nor a render; the sizes are a render, and
// the cheap edit ADR-045 exempts from staleness: they redraw themselves from
// the stored layout, so this cell reads running while they do and never
// stale, and `cellOfRun` answers `style` for them.
//
// The collapsed summary is the theme in the map's own words, Warm dark or
// Sepia, then ", sizes of your own" when any size has been set and nothing
// when none has, as cell 05 adds what a person has changed and says nothing
// of what they have not. Not the interface's Night and Parchment: ADR-044
// rethemed the interface alone, so the two palettes are different things
// and a summary naming this one after the other would be wrong about which
// it is.

/**
 * What the collapsed cell says it holds: the map's theme, and - only when a
 * person has set a size - that the sizes are their own (DESIGN.md 8.2, "The
 * cell"). The record alone answers it. A size at the engine's own number is
 * no choice, so it does not count.
 */
export function styleSummary(project: Pick<ProjectRecord, 'theme' | 'style'>): string {
  const sizes = sizesWords(project.style)
  return sizes === null ? themeWord(project.theme) : `${themeWord(project.theme)}, ${sizes}`
}

export default function StyleCell({ cell, state, open, onToggle }: CellViewProps): JSX.Element {
  const { project, engine, run, runSnapshot, exporter, setTheme, exporting, layingOut } =
    useProject()
  const redrawing =
    runSnapshot.state === 'running' &&
    (runSnapshot.recoloured || runSnapshot.reordered || runSnapshot.restyled)
  const heading = useRef<HTMLHeadingElement>(null)
  const busyNow = (): boolean => exporter.snapshot.state === 'running'
  return (
    <Cell
      number={cell.number}
      name={cell.name}
      state={state}
      // Null while the record is being read: a cell with nothing true to
      // say says nothing. A read-only project still names its theme and its
      // sizes, which are drawn on the map whether or not they can be
      // changed here.
      summary={project === null ? null : styleSummary(project)}
      progress={runRowStatus(runSnapshot, cell.id)}
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
            This project was made by a newer version of the app, so its theme and its sizes cannot
            be changed here.
          </p>
        ) : (
          <>
            <ThemeSwitch
              project={project}
              onChange={setTheme}
              disabled={exporting || layingOut}
              quiet={redrawing && !exporting}
              handback={heading}
            />
            <StyleFields
              run={run}
              project={project}
              engine={engine}
              disabled={exporting}
              busyNow={busyNow}
              handback={heading}
            />
          </>
        ))}
    </Cell>
  )
}
