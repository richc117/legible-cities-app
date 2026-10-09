import { useEffect, useRef } from 'react'
import type { RunState } from '../../shared/layout'
import { stoppedNow } from './panelRelease'

/**
 * Calls `putBack` once each time the run stops for a panel whose own redraw
 * it was, and at no other time (issue 360, `stoppedNow`).
 *
 * The colour, order and size panels all use this and nothing else to go back
 * to the record after a cancelled or failed build. The effect has no
 * dependency list on purpose: it looks at every render, remembers the state
 * it saw, and the rule alone decides, so there is no field of the record for
 * it to depend on and a new record reference cannot be a trigger. `putBack`
 * is the latest render's, so it reads the record as it stands.
 */
export function usePutBack(state: RunState, own: boolean, putBack: () => void): void {
  const was = useRef(state)
  useEffect(() => {
    const before = was.current
    was.current = state
    if (stoppedNow(before, state, own)) putBack()
  })
}
