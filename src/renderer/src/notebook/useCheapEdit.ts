import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ProjectRecord } from '../../../shared/project'
import type { LayoutRun, RunSnapshot } from '../engine/layoutRun'
import { mustWait, refusedAtStart } from '../panelRelease'
import { usePutBack } from '../usePutBack'
import { useSnapshot } from '../useSnapshot'

// The cheap edits' one hook (spec 037 part 2, issue 490, FR-010): the line
// colours, the line order, the sizes with their looks and markers, and the
// line options. A cheap edit is a choice drawn by a `map.build` from the
// stored layout and never by a re-layout, shown at once and written only
// once the map carries it (A4-01's rule), so a draw that stops leaves the
// record alone and the control goes back to it.
//
// Each of the four panels hand-built this until issue 490, and the copies
// had drifted: two flushed a waiting change as the panel went and two
// dropped it, and two took the record mid-redraw and two did not. Here is
// the one copy, and the rule a new control follows is written once, in
// docs/ARCHITECTURE.md, "The record session". In order:
//
// - **The wait.** A change is drawn `delay` after the last one, so two
//   changes in quick succession are one build. The line colours are the
//   exception (`atOnce`, issue 262): a colour is a gesture's end, and is
//   tried at that end, never on a quiet interval. A gesture's colours on
//   the way (`follow`) are shown and not drawn, and hold the change, and the
//   record, off for as long as the hand is on them.
// - **The hold** (issue 399, `mustWait`). While a run is going, an export
//   reads the page, the record a finished run wrote is being read back, or
//   the run has moved on since the screen last drew, a change is held and
//   asked again `delay` later, never refused, so no control disables itself
//   under a person's hands. It is asked before the change is compared with
//   the record, never after.
// - **The put-back** (issues 360 and 399). When the panel's own redraw
//   stops, or its start is refused at once, the control goes back to the
//   record and whatever was waiting is dropped with it; the run's own panel,
//   cell 02, says why.
// - **Adoption** (User Story 3, scenario 4). A record that arrives is taken
//   onto the control unless a change is waiting or under a hand, or the
//   panel's own redraw is going: until that redraw ends the record does not
//   yet hold what it draws, and taking it would put the old value on screen
//   and then take it away. Every other field is the record's at once,
//   because the panel reads it from the record and holds no copy of it.
// - **The panel going** (scenario 5, the maintainer's choice of 24 Oct
//   2026). A change still waiting when its panel goes is flushed: tried at
//   once, as if its delay had run out. If the way is not clear it waits on,
//   with nobody's screen behind it, and is drawn once the run and the export
//   have let go of the page. It is then drawn without being compared with
//   the record, because the record the panel last saw may be behind the
//   store, and since spec 037 part 1 every draw reads its own record from
//   the store and sends this change over it. A start refused then is said
//   on the project's status line (`sayRefusedGone`), since the control
//   that would have gone back is not there.
//
// Nothing here writes the record, and nothing orders writes: the redraw
// reads the record from the store at its start, and its completion writes
// what it sent (docs/ARCHITECTURE.md, "The record session").

export interface CheapEditOptions<V> {
  run: LayoutRun
  project: ProjectRecord
  /** The panel's own kind of run: the snapshot's flag its redraw sets. */
  own: (snapshot: RunSnapshot) => boolean
  /** The panel's fields as the record holds them. */
  stored: (project: ProjectRecord) => V
  /**
   * The record's own values for those fields, by reference: the record is
   * offered to the control again whenever one of them, or the project,
   * moves, and at no other time.
   */
  fields: readonly unknown[]
  /** Is `next` what the record already holds? Then there is nothing to draw. */
  same: (next: V, stored: V) => boolean
  /** Start the panel's own redraw, drawing `next` over the record. */
  draw: (project: ProjectRecord, next: V) => void
  /**
   * In milliseconds: how long a change waits before it is first tried, and
   * how long a held change waits before it is asked again.
   */
  delay: number
  /**
   * The colours' rule (issue 262): a change is a gesture's end and is tried
   * at once; `delay` is then only the wait of a held one.
   */
  atOnce?: boolean
  /**
   * What the screen holds a change for, as it last drew: an export reading
   * the page, the record a finished run wrote being read back.
   */
  held: boolean
  /** The same question at this instant, which a render cannot answer: an export begun since. */
  busyNow?: () => boolean
  /** Take the record's value onto the control. */
  adopt: (stored: V, project: ProjectRecord) => void
  /** Put the control back to the record: a stop of its own redraw, or its start refused. */
  putBack: (project: ProjectRecord) => void
  /**
   * A change the panel's own rule refuses as it is tried, which the panel
   * has put back and said why; true drops it. The line order's bound on how
   * many lines a record may hold.
   */
  refuse?: (next: V, project: ProjectRecord) => boolean
}

export interface CheapEdit<V> {
  /** The run as this render saw it. */
  snapshot: RunSnapshot
  /** A change, shown already: drawn after the delay, or at once with `atOnce`. */
  change: (next: V) => void
  /** A gesture reached `next`: shown and not drawn, and it holds everything off until it ends. */
  follow: (next: V) => void
  /** A gesture that never reported its end, as a panel closing under it: drawn as it was shown. */
  release: () => void
  /** A change is held for the way to clear: a run, an export or a read-back has the page. */
  waiting: boolean
}

/** What the hook reads at the moment it acts, from the latest render. */
interface Facts<V> extends CheapEditOptions<V> {
  snapshot: RunSnapshot
}

/** What a panel has chosen and the map does not carry yet. */
interface Unbuilt<V> {
  /** Chosen and not yet handed to a draw: waiting on the delay, or held. */
  held: V | null
  /** A gesture's, not yet released. */
  live: V | null
  timer: ReturnType<typeof setTimeout> | null
  /** The panel has gone: nothing is shown, put back or adopted any more. */
  gone: boolean
}

/** The editor itself, with no React in it: the hook keeps one for the panel's life and after. */
function editor<V>(
  latest: { readonly current: Facts<V> },
  saidWaiting: (waiting: boolean) => void,
): {
  unbuilt: Unbuilt<V>
  change: (next: V) => void
  follow: (next: V) => void
  release: () => void
  putBack: () => void
  here: () => void
  leave: () => void
} {
  const unbuilt: Unbuilt<V> = { held: null, live: null, timer: null, gone: false }
  const clear = (): void => {
    if (unbuilt.timer !== null) clearTimeout(unbuilt.timer)
    unbuilt.timer = null
  }
  const arm = (): void => {
    clear()
    unbuilt.timer = setTimeout(() => {
      unbuilt.timer = null
      if (unbuilt.gone) attemptGone()
      else attempt()
    }, latest.current.delay)
  }
  const say = (waiting: boolean): void => {
    if (!unbuilt.gone) saidWaiting(waiting)
  }

  const putBack = (): void => {
    clear()
    unbuilt.held = null
    unbuilt.live = null
    say(false)
    if (!unbuilt.gone) latest.current.putBack(latest.current.project)
  }

  /**
   * The panel's own redraw started with `next`, once nobody is there to go
   * back: any stop of its own at the start is a refusal, since there is no
   * next render to see it, and is said on the project's status line.
   */
  const drawGone = (next: V): void => {
    const facts = latest.current
    const before = facts.run.snapshot
    facts.draw(facts.project, next)
    const after = facts.run.snapshot
    if (after !== before && after.state === 'failed' && facts.own(after) && after.error !== null)
      sayRefusedGone(facts.run, after, after.error)
  }

  /** The delay ran out, or a held change is asked again, with the panel there. */
  const attempt = (): void => {
    const next = unbuilt.held
    if (next === null) return
    const facts = latest.current
    if (facts.refuse?.(next, facts.project) === true) {
      unbuilt.held = null
      say(false)
      return
    }
    // Asked before anything is compared with the record (issue 399): while
    // something holds the page the record may be about to move.
    const wait = mustWait({
      held: facts.held || unbuilt.live !== null,
      rendered: facts.snapshot,
      run: facts.run,
      busyNow: facts.busyNow,
    })
    if (wait) {
      say(true)
      arm()
      return
    }
    unbuilt.held = null
    say(false)
    if (facts.same(next, facts.stored(facts.project))) return
    if (refusedAtStart(facts.run, facts.own, () => facts.draw(facts.project, next))) putBack()
  }

  /**
   * A held change asked again after its panel went. Only the run and the
   * export, read as they are now, can hold it: the screen's own holds went
   * with the screen, and so did the record it would be compared with.
   */
  const attemptGone = (): void => {
    const next = unbuilt.held
    if (next === null) return
    const facts = latest.current
    if (facts.run.snapshot.state === 'running' || facts.busyNow?.() === true) {
      arm()
      return
    }
    unbuilt.held = null
    if (facts.refuse?.(next, facts.project) === true) return
    drawGone(next)
  }

  return {
    unbuilt,
    change: (next) => {
      unbuilt.live = null
      unbuilt.held = next
      if (latest.current.atOnce === true) {
        clear()
        attempt()
      } else arm()
    },
    follow: (next) => {
      unbuilt.live = next
    },
    release: () => {
      const live = unbuilt.live
      if (live === null) return
      unbuilt.live = null
      unbuilt.held = live
      if (latest.current.atOnce === true) {
        clear()
        attempt()
      } else arm()
    },
    putBack,
    here: () => {
      unbuilt.gone = false
    },
    // The panel goes: what is waiting is tried now, as if its delay had run
    // out, with what the last render saw. A gesture still under a hand was
    // never released, so it is not a change and goes with the panel.
    leave: () => {
      unbuilt.gone = true
      unbuilt.live = null
      clear()
      const next = unbuilt.held
      if (next === null) return
      const facts = latest.current
      const wait = mustWait({
        held: facts.held,
        rendered: facts.snapshot,
        run: facts.run,
        busyNow: facts.busyNow,
      })
      if (wait) {
        arm()
        return
      }
      unbuilt.held = null
      if (facts.refuse?.(next, facts.project) === true) return
      if (facts.same(next, facts.stored(facts.project))) return
      drawGone(next)
    },
  }
}

/** Two lists of the same values, by reference. */
const sameRefs = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((value, i) => Object.is(value, b[i]))

/**
 * One cheap edit's machinery for a panel: the wait, the hold, the put-back,
 * adoption and the flush as it goes. The panel keeps what it shows and how a
 * change is made from a press; everything about when it is drawn is here.
 */
export function useCheapEdit<V>(options: CheapEditOptions<V>): CheapEdit<V> {
  const snapshot = useSnapshot(options.run)
  const [waiting, setWaiting] = useState(false)
  const latest = useRef<Facts<V>>({ ...options, snapshot })
  // The latest render's options, for a timer, an event or the panel's going
  // to read at the moment it acts, never those of three renders ago. First,
  // so every effect below reads this render's.
  useEffect(() => {
    latest.current = { ...options, snapshot }
  })
  const [edit] = useState(() => editor(latest, setWaiting))

  usePutBack(snapshot.state, options.own(snapshot), edit.putBack)

  const { project, fields, own } = options
  const seen = useRef<readonly unknown[] | null>(null)
  useEffect(() => {
    const now = [project.id, ...fields]
    const before = seen.current
    if (before !== null && sameRefs(before, now)) return
    seen.current = now
    if (edit.unbuilt.held !== null || edit.unbuilt.live !== null) return
    if (snapshot.state === 'running' && own(snapshot)) return
    latest.current.adopt(latest.current.stored(project), project)
  })

  useEffect(() => {
    edit.here()
    return () => edit.leave()
  }, [edit])

  return { snapshot, change: edit.change, follow: edit.follow, release: edit.release, waiting }
}

// What a cheap edit's flush was refused with after its panel had gone
// (scenario 5), by the run it was refused on, for as long as that run stands
// where the refusal left it: the next start moves its snapshot on, and the
// sentence goes with it. Kept by the run rather than by a screen, because
// the screen that would say it is usually the one that has just gone, and
// the project's own run outlives it (`runs.ts`).
const refusedGone = new WeakMap<LayoutRun, { snapshot: RunSnapshot; sentence: string }>()
const refusalListeners = new Set<() => void>()

/** Say on the project's status line that a flush was refused, with the engine's sentence. */
export function sayRefusedGone(run: LayoutRun, snapshot: RunSnapshot, sentence: string): void {
  refusedGone.set(run, { snapshot, sentence })
  for (const listener of refusalListeners) listener()
}

const hearRefusals = (listener: () => void): (() => void) => {
  refusalListeners.add(listener)
  return () => {
    refusalListeners.delete(listener)
  }
}

/**
 * The engine's sentence for a cheap edit flushed as its panel went and
 * refused at its start, while the run is still where that left it; null
 * otherwise. `snapshot` is the run as the screen last drew it.
 */
export function useRefusedGone(run: LayoutRun, snapshot: RunSnapshot): string | null {
  const said = useSyncExternalStore(hearRefusals, () => refusedGone.get(run))
  return said !== undefined && said.snapshot === snapshot ? said.sentence : null
}
