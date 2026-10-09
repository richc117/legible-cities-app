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
 * Has the run just stopped, for a panel whose own redraw it was? True only
 * on the change into `failed` or `cancelled`, and only for the kind of run
 * the panel started (`own`: the snapshot's `recoloured`, `reordered` or
 * `restyled`).
 *
 * Both states are needed. The current one alone is true for as long as the
 * run stays stopped; the previous one is what makes a second failure a
 * second transition, since `failed` then `running` then `failed` changes
 * twice and a run that is merely `failed` twice in a row does not.
 */
export function stoppedNow(before: RunState, now: RunState, own: boolean): boolean {
  return own && before !== now && (now === 'failed' || now === 'cancelled')
}
