// @vitest-environment jsdom
// The dismissal watch as a component holds it (`useDismissalWatch` in
// `dismissal.ts`, issue 327): while a mark stands, the document's pointer
// and focus events re-apply the rule, through whatever `apply` the last
// render handed in. The two callers, the line order's arrows and the
// diagnostics' metrics, hand in a new function on every render, closed over
// the marks as they stand then; a listener that kept the first one would
// apply the rule to marks long gone. The listeners call it as an effect
// event and are not added again for it (issue 433).
//
// What the watch decides is `tests/unit/dismissal.test.ts`; this is only
// which `apply` it calls.
//
// Mutation, watched failing (`dismissal-watch.mutations.json`): the
// listeners handed the first render's `apply` - the latest is never called.

import { act, useRef, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDismissalWatch } from '../../src/renderer/src/dismissal'
import { cleanup, renderPanel } from '../support/render'

afterEach(cleanup)

type Apply = (hoveredKey: string | null, focusedKey: string | null) => void

/** One arrow, its mark showing, watched with the `apply` given. */
function Watched({ apply }: { apply: Apply }): JSX.Element {
  const hovered = useRef<string | null>(null)
  useDismissalWatch('data-arrow', true, hovered, apply)
  return (
    <button type="button" data-arrow="a">
      Move line A down
    </button>
  )
}

describe('the dismissal watch', () => {
  it('applies the rule through the apply the last render handed in', () => {
    const first = vi.fn<Apply>()
    const last = vi.fn<Apply>()
    const view = renderPanel(<Watched apply={first} />)
    view.rerender(<Watched apply={last} />)
    act(() => view.host.querySelector('button')?.focus())
    expect(last).toHaveBeenCalledWith(null, 'a')
    expect(first).not.toHaveBeenCalled()
  })
})
