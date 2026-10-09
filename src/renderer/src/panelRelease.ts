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
