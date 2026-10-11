import type { RunState } from '../../shared/layout'

// When a panel puts its control back to the record (issue 360).
//
// The colour, order and size panels each hold a control that runs ahead of
// the record: nothing is written until the map has been drawn with the
// change, so when that draw is cancelled or fails the control must go back
// to what the record still says. The three share one rule for *when*, and
// this is it.
//
// The run keeps its `failed` or `cancelled` state until the next run starts.
// Read as "stopped" on every render after, it would act on everything that
// renders in the meantime - a rename, a theme press, an export option and a
// chosen day each bring a fresh record - and would cancel, and snap back, a
// change made after the failure that is waiting for an export to let go of
// the page. So the rule is the *change into* a stopped state, from the state
// the panel last saw, and never the record's reference.
//
// Since issue 399 the four cheap edits (the line options with them) share
// two more rules here: when a change must wait rather than be compared with
// the record (`mustWait`), and the one stop the rule above cannot see, a
// start refused at once after a stop of the same kind (`refusedAtStart`).

/**
 * What a panel sees of the run at one render: its state, and whether the
 * run is the kind the panel started (`own`: the snapshot's `recoloured`,
 * `reordered` or `restyled`).
 */
export interface Seen {
  state: RunState
  own: boolean
}

const isStop = (state: RunState): boolean => state === 'failed' || state === 'cancelled'

/**
 * Has the run just stopped, for a panel whose own redraw it was? True when
 * the run now is the panel's own and stopped, and either its state changed
 * since the panel last looked - the change into `failed` or `cancelled` -
 * or the run before was not the panel's own.
 *
 * The last look is needed as well as this one. The current state alone is
 * true for as long as the run stays stopped; the previous state is what
 * makes a second failure a second transition, since `failed` then `running`
 * then `failed` changes twice and a run that is merely `failed` twice in a
 * row does not.
 *
 * The kind of run has to be remembered with the state because a start that
 * is refused at once - the engine is not ready - sets `failed` without
 * passing through `running`. If the run was already `failed` for another
 * kind (a layout run, say), a colour refused at its start goes from
 * `failed` to `failed` and only the kind has changed. That is the panel's
 * own redraw stopping, and its control has to go back as for any other.
 */
export function stoppedNow(before: Seen, now: Seen): boolean {
  return now.own && isStop(now.state) && (before.state !== now.state || !before.own)
}

/**
 * Whether a change a panel holds must wait, rather than be compared with the
 * record now (issue 399). The four cheap edits - the colours, the line
 * options, the order and the sizes - ask this one question before their own
 * rule compares anything.
 *
 * It waits while the last render saw something hold the page or the record
 * (`held`: an export reading the page, the record a finished run wrote being
 * read back, a gesture under a hand); while a run is going at this instant;
 * while `busyNow` says something has started since that render, as an
 * export can; and while the run has moved on since that render - its
 * snapshot is not the one the render drew from - since a run that ended in
 * that gap wrote a record the render has not read, and a build begun from
 * it would draw the colours, the order, the sizes and the line options from
 * before it.
 *
 * **It is asked before the change is compared with the record, never
 * after.** While something holds the page the record is about to move: a
 * build of this very change may be about to write it. A colour chosen and
 * then put back while its build runs equals the record still on disk, and
 * comparing then would drop it; the build would write the first colour, and
 * the control would go back to it by itself. Asked once the way is clear,
 * it is compared with the record that build wrote.
 */
export function mustWait<S extends { readonly state: RunState }>(way: {
  held: boolean
  /** The run's snapshot as the last render saw it. */
  rendered: S
  /** The run itself, read at this instant. */
  run: { readonly snapshot: S }
  busyNow?: () => boolean
}): boolean {
  const now = way.run.snapshot
  return way.held || now !== way.rendered || now.state === 'running' || way.busyNow?.() === true
}

/**
 * Starts a panel's own redraw (`start`), and answers true when the start was
 * refused at once in the one way `stoppedNow` cannot see, so the panel puts
 * itself back to the record then, as it does for any stop (issue 399).
 *
 * A start the run cannot make - the engine is restarting, the project has no
 * layout to draw - is refused inside the call: the run goes to `failed` with
 * the panel's kind, and never passes through `running`. After any other
 * state, or after a stop of another kind, that is a change `stoppedNow`
 * sees at the next render. After a stop of the panel's own kind it is not:
 * a redraw that failed, then a choice made while the engine restarts, is
 * `failed` to `failed` with the kind unmoved, and the choice would stay on
 * screen though it was neither drawn nor written and nothing will draw it.
 * Cell 02 says for it what it says for any stopped redraw - the project
 * keeps what it had - so the panel goes back to the record, and is not left
 * to retry what a person was told to try again.
 *
 * `own` says whether a snapshot is the panel's kind of run, as `Seen.own`
 * does. Only a refusal that the next render would not see answers true, so
 * nothing is put back twice.
 */
export function refusedAtStart<S extends { readonly state: RunState }>(
  run: { readonly snapshot: S },
  own: (snapshot: S) => boolean,
  start: () => void,
): boolean {
  const before = run.snapshot
  start()
  const after = run.snapshot
  if (after === before) return false
  const now = { state: after.state, own: own(after) }
  return now.own && isStop(now.state) && !stoppedNow({ state: before.state, own: own(before) }, now)
}
