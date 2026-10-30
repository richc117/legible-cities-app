import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { EngineState } from '../../../shared/engine'
import type { ProjectRecord } from '../../../shared/project/types'
import type { LayoutRun, RunSnapshot } from '../engine/layoutRun'
import { mustWait, refusedAtStart, stoppedNow } from '../panelRelease'
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
//   have let go of the page - from the record and the engine's state read
//   then through the bridge, never from the last render's, which may be
//   behind (a project laid out since, an engine started since). A stop of
//   the panel's own kind while it waits drops it, as a stop does with the
//   panel there. A panel that comes back for the same run and kind - the
//   project opened again - takes the change over, shows it and holds it as
//   its own, so two editors never hold one panel's whole value at once. A
//   start refused after the panel went is said on the project's status line
//   (`sayRefusedGone`), since the control that would have gone back is not
//   there.
// - **Put back** (issue 561, ADR-061), which is not the put-back above. A
//   panel's reset, once drawn, leaves the record holding the reset values
//   and nothing of what was there before, because a cheap edit is never
//   stale and so has no Revert (issue 164). So at the reset's press the
//   hook keeps one thing: the section's values as the record's own `drawn`
//   holds them, which are provably what the map on screen was drawn from,
//   and again as the reset is drawn, for a reset held behind a redraw.
//   The panel offers them back, through the same cheap edit as any change.
//   It is one step and no history: the slot goes at the section's next
//   edit (Put back's own included), at a stop of the panel's own redraw -
//   the reset was then never drawn and the record still holds the values -
//   and with the panel, so a project screen that closes takes it along.
//   It is never written to the record, and never travels with a change
//   flushed as its panel goes.
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
  /** The engine's state as the screen last drew it. */
  engine: EngineState | null
  /** Start the panel's own redraw of `next`, which is the panel's whole value. */
  draw: (project: ProjectRecord, engine: EngineState | null, next: V) => void
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
  /**
   * The record and the engine's state as they are now, for a change drawn
   * after its panel has gone: through the bridge unless a test hands its own.
   */
  readNow?: (id: string) => Promise<[ProjectRecord, EngineState | null]>
  /**
   * The panel's fields as the record's own `drawn` holds them - what the map
   * on screen was drawn from - or null for a record with nothing drawn: what
   * a reset keeps for Put back (issue 561). A panel with no reset leaves it
   * out, and its `reset` keeps nothing.
   */
  drawnOf?: (project: ProjectRecord) => V | null
}

/**
 * Did a read fail because the project is not there? The store refuses a
 * project it has no record for with "not found" (`ProjectStore.load`), and
 * the bridge hands the refusal on inside its own words. The store says the
 * same of a record it cannot read, parse or place, so this answers yes for
 * those too.
 */
export const projectMissing = (reason: unknown): boolean =>
  reason instanceof Error && /\bnot found\b/.test(reason.message)

/** In milliseconds: the longest a gone change waits between two refused reads. */
export const READ_RETRY_MAX = 30_000

/** The record and the engine's state, asked of main now. */
const readThroughBridge = (id: string): Promise<[ProjectRecord, EngineState | null]> =>
  Promise.all([window.api.projects.get(id), window.api.engine.state()])

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
  /**
   * The panel's reset, made as a change is, with what the map was drawn from
   * kept for Put back. True when something was kept, so the panel knows
   * Put back is coming and can hand it the focus the reset is about to drop.
   */
  reset: (next: V) => boolean
  /**
   * What Put back offers: the section as the map was drawn from it when the
   * reset was pressed, until the section's next edit; null when there is
   * nothing to put back. Put back itself is `change` with it.
   */
  before: V | null
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
  /** While gone and waiting: stop listening to the run, and leave the orphans. */
  forget: (() => void) | null
  /** The wait after a refused read while gone, doubled at each; 0 until one is refused. */
  backoff: number
}

/** What an editor whose panel has gone offers a panel of its kind that comes back. */
interface Orphan {
  /** The change it holds, which it gives up; null if it has none. */
  take: () => unknown
}

// Editors whose panel went while they held a change, by the run they draw on
// and their panel's kind of run (`own`, one function per panel).
const orphans = new WeakMap<LayoutRun, Map<unknown, Orphan>>()

/** The editor itself, with no React in it: the hook keeps one for the panel's life and after. */
function editor<V>(
  latest: { readonly current: Facts<V> },
  saidWaiting: (waiting: boolean) => void,
  /** The panel's own redraw stopped, or its start was refused: Put back has nothing to undo. */
  stopped: () => void,
  /** A change is past its hold and about to be compared and drawn, with the record as it is now. */
  drawing: (next: V) => void,
): {
  unbuilt: Unbuilt<V>
  change: (next: V) => void
  follow: (next: V) => void
  release: () => void
  putBack: () => void
  here: () => void
  leave: () => void
} {
  const unbuilt: Unbuilt<V> = {
    held: null,
    live: null,
    timer: null,
    gone: false,
    forget: null,
    backoff: 0,
  }
  const clear = (): void => {
    if (unbuilt.timer !== null) clearTimeout(unbuilt.timer)
    unbuilt.timer = null
  }
  const arm = (wait: number = latest.current.delay): void => {
    clear()
    unbuilt.timer = setTimeout(() => {
      unbuilt.timer = null
      if (unbuilt.gone) attemptGone()
      else attempt()
    }, wait)
  }
  const say = (waiting: boolean): void => {
    if (!unbuilt.gone) saidWaiting(waiting)
  }

  const putBack = (): void => {
    clear()
    unbuilt.held = null
    unbuilt.live = null
    say(false)
    if (unbuilt.gone) return
    stopped()
    latest.current.putBack(latest.current.project)
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
    drawing(next)
    if (facts.same(next, facts.stored(facts.project))) return
    if (refusedAtStart(facts.run, facts.own, () => facts.draw(facts.project, facts.engine, next)))
      putBack()
  }

  /** The gone panel's wait is over, or given to a panel that came back: nothing more of it. */
  const done = (): void => {
    clear()
    unbuilt.held = null
    unbuilt.forget?.()
    unbuilt.forget = null
  }

  /**
   * The panel's own redraw started with `next` over `record`, once nobody is
   * there to go back: any stop of its own at the start is a refusal, since
   * there is no next render to see it, and is said on the project's status
   * line.
   */
  const drawGone = (record: ProjectRecord, engine: EngineState | null, next: V): void => {
    const facts = latest.current
    if (facts.refuse?.(next, record) === true) return
    if (facts.same(next, facts.stored(record))) return
    const before = facts.run.snapshot
    facts.draw(record, engine, next)
    const after = facts.run.snapshot
    if (after !== before && after.state === 'failed' && facts.own(after) && after.error !== null)
      sayRefusedGone(facts.run, after, after.error)
  }

  /** Is the page held, read now? Once the panel has gone only the run and the export can hold it. */
  const heldNow = (facts: Facts<V>): boolean =>
    facts.run.snapshot.state === 'running' || facts.busyNow?.() === true

  /**
   * A held change asked again after its panel went: once the way is clear,
   * drawn from the record and the engine's state read now, and compared
   * with that record, not the one the panel last saw.
   */
  const attemptGone = (): void => {
    const next = unbuilt.held
    if (next === null) return
    const facts = latest.current
    if (heldNow(facts)) {
      arm()
      return
    }
    const read = facts.readNow ?? readThroughBridge
    read(facts.project.id).then(
      ([record, engine]) => {
        // Taken over by a panel that came back, or dropped by a stop, meanwhile.
        if (unbuilt.held !== next) return
        unbuilt.backoff = 0
        if (heldNow(latest.current)) {
          arm()
          return
        }
        done()
        drawGone(record, engine, next)
      },
      // Main answered "not found": the project is gone (deleted since), and
      // there is nothing to draw it on and nothing to say it to. Main says
      // that too for a record it cannot read, cannot parse or finds in the
      // wrong folder (`ProjectStore.load`), a passing read error among them,
      // so such a change ends quietly as well. Any other failure - of the
      // bridge itself, or of `engine.state` - is not the change's to end: it
      // waits on, asked again after twice the last wait, up to
      // `READ_RETRY_MAX`, so an engine that stays away is not asked five
      // times a second for as long as it does.
      (reason: unknown) => {
        if (unbuilt.held !== next) return
        if (projectMissing(reason)) return done()
        unbuilt.backoff = Math.min(
          (unbuilt.backoff === 0 ? latest.current.delay : unbuilt.backoff) * 2,
          READ_RETRY_MAX,
        )
        arm(unbuilt.backoff)
      },
    )
  }

  /**
   * Waits on, with the panel gone: listening to the run for a stop of the
   * panel's own kind, which drops the change as it does with the panel
   * there, and offered to a panel of the same kind that comes back.
   */
  const orphan = (): void => {
    const facts = latest.current
    const { run, own } = facts
    // From the run as the panel last drew it: a stop of its own kind in the
    // beat between that render and the panel going is a stop all the same.
    let seen = { state: facts.snapshot.state, own: own(facts.snapshot) }
    const current = { state: run.snapshot.state, own: own(run.snapshot) }
    if (stoppedNow(seen, current)) {
      done()
      return
    }
    seen = current
    const unhear = run.subscribe((snapshot) => {
      const now = { state: snapshot.state, own: own(snapshot) }
      const stopped = stoppedNow(seen, now)
      seen = now
      if (stopped) done()
    })
    const kinds = orphans.get(run) ?? new Map<unknown, Orphan>()
    orphans.set(run, kinds)
    const self: Orphan = {
      take: () => {
        const held = unbuilt.held
        done()
        return held
      },
    }
    kinds.set(own, self)
    unbuilt.forget = () => {
      unhear()
      if (kinds.get(own) === self) kinds.delete(own)
    }
    arm()
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
    // The panel is here: if one of its kind went for this run while it held
    // a change, that change is this panel's now - shown, held, and tried
    // after the delay as any change is.
    here: () => {
      unbuilt.gone = false
      const facts = latest.current
      const left = orphans.get(facts.run)?.get(facts.own)
      if (left === undefined) return
      const held = left.take() as V | null
      if (held === null) return
      unbuilt.held = held
      facts.adopt(held, facts.project)
      arm()
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
        orphan()
        return
      }
      unbuilt.held = null
      drawGone(facts.project, facts.engine, next)
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
  // to read at the moment it acts, never those of three renders ago. In a
  // layout effect, so it is current before anything can act on the commit
  // that made it, and first, so every effect below reads this render's.
  useLayoutEffect(() => {
    latest.current = { ...options, snapshot }
  })
  // Put back's one slot (issue 561): the section as the map was drawn from
  // it when the reset was pressed, by the project it was kept for. State, so
  // the panel draws Put back from it; the panel's, so it goes with the
  // panel and is never written anywhere.
  const [kept, setKept] = useState<{ id: string; value: V } | null>(null)
  // The reset waiting to be drawn, by reference, so the slot can be taken
  // again from the record as it stands when the reset is drawn: a reset
  // pressed while another redraw of the panel's goes is held, and that
  // redraw writes a `drawn` the slot must follow, or Put back would undo
  // two steps (the review of issue 561).
  const resetting = useRef<V | null>(null)
  const forget = (): void => {
    resetting.current = null
    setKept(null)
  }
  const keepFor = (next: V): boolean => {
    const facts = latest.current
    const drawn = facts.drawnOf?.(facts.project) ?? null
    const keep = drawn !== null && !facts.same(drawn, next)
    setKept(keep ? { id: facts.project.id, value: drawn } : null)
    return keep
  }
  const drawing = (next: V): void => {
    if (resetting.current === null || !Object.is(resetting.current, next)) return
    resetting.current = null
    keepFor(next)
  }
  const [edit] = useState(() => editor(latest, setWaiting, forget, drawing))
  // A person's edit of the section is the next step, and Put back's slot
  // goes with it: one step back, never two.
  const [api] = useState(() => ({
    change: (next: V): void => {
      forget()
      edit.change(next)
    },
    follow: (next: V): void => {
      forget()
      edit.follow(next)
    },
    // A panel closing calls this whether or not a gesture was going under
    // it (the colour panel's `toggle`, a task after the reset that closed
    // it), and only a gesture released is an edit.
    release: (): void => {
      if (edit.unbuilt.live !== null) forget()
      edit.release()
    },
    // Kept at the press, so Put back is there to take the focus the reset
    // drops, and kept again from the record when the reset is drawn. Kept
    // first and drawn second, so a start refused at once - which puts the
    // control back and drops the slot - has the last word.
    reset: (next: V): boolean => {
      const keep = keepFor(next)
      resetting.current = next
      edit.change(next)
      return keep
    },
  }))

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

  return {
    snapshot,
    ...api,
    waiting,
    // Only for the project it was kept for: a panel handed another project
    // has nothing of this one's to put back.
    before: kept !== null && kept.id === project.id ? kept.value : null,
  }
}

// What a cheap edit's flush was refused with after its panel had gone
// (scenario 5), by the run it was refused on, until that run next moves. Kept by the run rather than by a screen, because
// the screen that would say it is usually the one that has just gone, and
// the project's own run outlives it (`runs.ts`).
const refusedGone = new WeakMap<LayoutRun, { snapshot: RunSnapshot; sentence: string }>()
const refusalListeners = new Set<() => void>()

/** Hears the sentence's run move on, for the one sentence kept for each run. */
const forgetting = new WeakMap<LayoutRun, () => void>()

/**
 * Say on the project's status line that a flush was refused, with the
 * engine's sentence. It is forgotten the first time the run moves, whatever
 * it moves to: Run all with nothing left to run puts back the very snapshot
 * it started from (`#withdraw`), and a sentence kept by that object alone
 * would come back with it.
 */
export function sayRefusedGone(run: LayoutRun, snapshot: RunSnapshot, sentence: string): void {
  forgetting.get(run)?.()
  refusedGone.set(run, { snapshot, sentence })
  const unhear = run.subscribe(() => {
    stop()
    if (refusedGone.get(run)?.snapshot === snapshot) refusedGone.delete(run)
    for (const listener of refusalListeners) listener()
  })
  const stop = (): void => {
    unhear()
    if (forgetting.get(run) === stop) forgetting.delete(run)
  }
  forgetting.set(run, stop)
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
