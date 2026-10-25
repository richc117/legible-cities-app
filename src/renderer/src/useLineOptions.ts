import { useRef, useState } from 'react'
import type { EngineState } from '../../shared/engine'
import {
  linesSent,
  sameLines,
  type LineChoice,
  type ProjectLines,
  type ProjectRecord,
} from '../../shared/project'
import { REDRAW_DELAY } from './colours'
import type { LayoutRun as Run, RunSnapshot } from './engine/layoutRun'
import { linesWith } from './lineOptions'
import { useCheapEdit } from './notebook/useCheapEdit'

// Cell 05's line options as the colours section holds them (issue 394,
// spec 036, FR-010): what every row's disclosure shows, and when the map is
// drawn with it.
//
// Every option is a cheap edit, the colours' kind, through the cheap edits'
// one hook (`useCheapEdit`, issue 490): shown at once, drawn after the redraw
// delay from the stored layout (`LayoutRun.redrawLines`), and written to the
// record only once the map carries it, so a cancelled or failed build leaves
// the record alone and the rows go back to it. Choices made in quick
// succession are one build, as the sizes' are; a choice made while a run or
// an export holds the page, or while the record a finished run wrote is
// being read back, waits and is drawn once the way is clear. Nothing is
// disabled for any of it: a control that disables itself under a person's
// hands takes the focus with it, and a refused change is a lost one.
//
// A casing's colour follows the end of a gesture and not its every colour,
// as a line's own does (issue 262): the chip follows each colour on the way
// (`follow`), and the build goes on the release (`choose`), or when the
// panel closes with a gesture still going.
//
// It is a hook of its own, beside the section, because the colours build on
// a gesture's release and never on a quiet interval, and the section's own
// file is held to that (`tests/unit/colours.test.ts`).

/** A redraw for line options: the options' own kind of run (`optioned`). */
const ownRun = (snapshot: RunSnapshot): boolean => snapshot.optioned

export interface LineOptionsState {
  /** Every line's options as the rows show them: kept as the store keeps them. */
  lines: ProjectLines
  /** A choice made on one line: shown at once and drawn after the delay. */
  choose: (label: string, next: LineChoice) => void
  /** A casing colour a gesture has reached and not released: shown, and not drawn. */
  follow: (label: string, next: LineChoice) => void
  /** A casing's panel closed: a gesture still going is drawn as the chip showed it. */
  panelClosed: () => void
  /** Reset line: one line's options cleared, and nothing else. */
  reset: (label: string) => void
}

export function useLineOptions({
  run,
  project,
  engine,
  held = false,
  busyNow,
}: {
  run: Run
  project: ProjectRecord
  engine: EngineState | null
  /**
   * True while something else holds the page or the record: an export
   * reading the page, or the record a finished run wrote being read back.
   * A build begun in that beat would draw the map from the record as it was
   * before the run, so it waits.
   */
  held?: boolean
  /** The same question at this instant rather than at the last render (A4-01). */
  busyNow?: () => boolean
}): LineOptionsState {
  const [lines, setLines] = useState<ProjectLines>(() => linesSent(project.lines))
  // What is shown at this moment, for a choice to build on: two choices in
  // one beat each see the other, which a render's copy would not.
  const shown = useRef(lines)
  const show = (next: ProjectLines): void => {
    shown.current = next
    setLines(next)
  }

  const edit = useCheapEdit<ProjectLines>({
    run,
    project,
    own: ownRun,
    stored: (record) => linesSent(record.lines),
    fields: [project.lines],
    same: sameLines,
    engine,
    draw: (record, now, next) => run.redrawLines(record, now, next),
    delay: REDRAW_DELAY,
    held,
    busyNow,
    // The record is what the rows show, once nothing is waiting, drawing or
    // under a hand: a build that finished has written it and the screen has
    // read it back, so the two agree again.
    adopt: show,
    // A build that stopped wrote nothing, so the rows go back to the
    // record's. Only the options' own redraw is this hook's to put back
    // for: a colours' redraw that stops carries none of the options waiting
    // here, which are drawn once the way is clear (the run graph sees both
    // as the colours' kind, `recoloured`).
    putBack: (record) => show(linesSent(record.lines)),
  })

  const choose = (label: string, next: LineChoice): void => {
    const after = linesWith(shown.current, label, next)
    show(after)
    edit.change(after)
  }

  // A casing's colour a gesture has reached and not released: shown, and
  // held - a record read meanwhile does not take it off the chip, and a
  // choice on another line waits for the hand to let go.
  const follow = (label: string, next: LineChoice): void => {
    const after = linesWith(shown.current, label, next)
    show(after)
    edit.follow(after)
  }

  const panelClosed = (): void => edit.release()

  const reset = (label: string): void => choose(label, {})

  return { lines, choose, follow, panelClosed, reset }
}
