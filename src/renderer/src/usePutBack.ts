import { useEffect, useRef } from 'react'
import type { RunState } from '../../shared/layout'
import { stoppedNow, type Seen } from './panelRelease'

/**
 * Calls `putBack` once each time the run stops for a panel whose own redraw
 * it was, and at no other time (issue 360, `stoppedNow`).
 *
 * The cheap edits' one hook (`notebook/useCheapEdit.ts`, issue 490) uses
 * this and nothing else to put a panel back to the record after a cancelled
 * or failed build, and is its only caller. The effect has no
 * dependency list on purpose: it looks at every render, remembers the state
 * and the kind of run it saw, and the rule alone decides, so there is no
 * field of the record for it to depend on and a new record reference cannot
 * be a trigger. `putBack` is the latest render's, so it reads the record as
 * it stands.
 */
export function usePutBack(state: RunState, own: boolean, putBack: () => void): void {
  const was = useRef<Seen>({ state, own })
  useEffect(() => {
    const before = was.current
    const now = { state, own }
    was.current = now
    if (stoppedNow(before, now)) putBack()
  })
}
