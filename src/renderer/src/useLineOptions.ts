import { useEffect, useMemo, useRef, useState } from 'react'
import type { EngineState } from '../../shared/engine'
import {
  linesSent,
  type LineChoice,
  type ProjectLines,
  type ProjectRecord,
} from '../../shared/project'
import { REDRAW_DELAY } from './colours'
import { debounce } from './debounce'
import type { LayoutRun as Run } from './engine/layoutRun'
import { linesWith, nextLinesStep } from './lineOptions'
import { usePutBack } from './usePutBack'
import { useSnapshot } from './useSnapshot'

// Cell 05's line options as the colours section holds them (issue 394,
// spec 036, FR-010): what every row's disclosure shows, and when the map is
// drawn with it.
//
// Every option is a cheap edit, the colours' kind: shown at once, drawn
// after the redraw delay from the stored layout (`LayoutRun.redrawLines`),
// and written to the record only once the map carries it, so a cancelled or
// failed build leaves the record alone and the rows go back to it. Choices
// made in quick succession are one build, as the sizes' are; a choice made
// while a run or an export holds the page, or while the record a finished
// run wrote is being read back, waits and is drawn once the way is clear.
// Nothing is disabled for any of it: a control that disables itself under a
// person's hands takes the focus with it, and a refused change is a lost one.
//
// A casing's colour follows the end of a gesture and not its every colour,
// as a line's own does (issue 262): the chip follows each colour on the way
// (`follow`), and the build goes on the release (`choose`), or when the
// panel closes with a gesture still going.
//
// It is a hook of its own, beside the section, because the colours build on
// a gesture's release and never on a quiet interval, and the section's own
// file is held to that (`tests/unit/colours.test.ts`).

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
  const snapshot = useSnapshot(run)
  const { state: runState, recoloured } = snapshot
  const running = runState === 'running'
  const [lines, setLines] = useState<ProjectLines>(() => linesSent(project.lines))
  // What is shown at this moment, for a choice to build on: two choices in
  // one beat each see the other, which a render's copy would not.
  const shown = useRef(lines)
  const show = (next: ProjectLines): void => {
    shown.current = next
    setLines(next)
  }
  // A casing's colour a gesture has reached and not released, for as long as
  // it has not; a record read meanwhile does not take it off the chip.
  const live = useRef<ProjectLines | null>(null)

  // The debounce, made once, reading the latest render's project, engine and
  // run through a ref, so the waiting call is never one from renders ago.
  const commitRef = useRef<(next: ProjectLines) => void>(() => undefined)
  const schedule = useMemo(
    () => debounce((next: ProjectLines) => commitRef.current(next), REDRAW_DELAY),
    [],
  )
  // A choice seen on screen is not lost to a screen that goes inside the
  // delay: the build is the project's, as a run is, and carries on - if the
  // way is clear as the screen goes. If it is not, the choice is dropped
  // rather than left waiting on a screen that is gone, whose last render's
  // record would be drawn from long after a run had moved it on.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      schedule.flush()
    }
  }, [schedule])

  // Whether a redraw of this cell's is going, read by the effect below
  // without being re-run when it ends: the record has not been read back
  // yet, and still holds the options from before it.
  const drawing = useRef(false)
  useEffect(() => {
    drawing.current = running && recoloured
  })

  // The record is what the rows show, once nothing is waiting, drawing or
  // under a hand: a build that finished has written it and the screen has
  // read it back, so the two agree again.
  useEffect(() => {
    if (schedule.pending || drawing.current || live.current !== null) return
    const stored = linesSent(project.lines)
    shown.current = stored
    setLines(stored)
  }, [project.id, project.lines, schedule])

  // A build that stopped wrote nothing, so the rows go back to the record's
  // at the moment it stops (`usePutBack`, issue 360), and a choice waiting
  // on the timer is dropped with it: drawing it would show options a person
  // had just been told the project did not keep. It is the colours' kind of
  // run, so a stopped colour puts the options back too, as one stop of the
  // section's.
  usePutBack(runState, recoloured, () => {
    schedule.cancel()
    live.current = null
    show(linesSent(project.lines))
  })

  const commit = (next: ProjectLines): void => {
    // `held` and the record are what the last render saw. The run's own
    // state is what is true at this moment, and a run can start between the
    // two - or end: a run that has moved on since this render (its snapshot
    // is not the one rendered) wrote a record this render has not read, so
    // drawing now would draw the colours, the order and the sizes from
    // before it. A casing's colour under a hand waits for its release, as a
    // line's own colour does.
    const busy =
      held ||
      live.current !== null ||
      run.snapshot !== snapshot ||
      run.snapshot.state === 'running' ||
      busyNow?.() === true
    const step = nextLinesStep(next, project.lines, busy)
    // Something holds the page: wait rather than refuse, the same delay
    // again, until the way is clear; never on a screen that has gone.
    if (step === 'wait') {
      if (mounted.current) schedule(next)
    } else if (step === 'build') run.redrawLines(project, engine, next)
  }
  useEffect(() => {
    commitRef.current = commit
  })

  const choose = (label: string, next: LineChoice): void => {
    live.current = null
    const after = linesWith(shown.current, label, next)
    show(after)
    schedule(after)
  }

  const follow = (label: string, next: LineChoice): void => {
    const after = linesWith(shown.current, label, next)
    live.current = after
    show(after)
  }

  const panelClosed = (): void => {
    const going = live.current
    if (going === null) return
    live.current = null
    schedule(going)
  }

  const reset = (label: string): void => choose(label, {})

  return { lines, choose, follow, panelClosed, reset }
}
