// @vitest-environment jsdom
// Which control a focus hand-back lands on (`useFocusHandback` in
// `focusHandback.ts`, A6-07): the one `target` names in the render that
// replaced the controls, not in the render that first set the hand-back up.
// Its callers hand in a new `target` on every render, closed over what that
// render drew; the effect that hands focus over reads it as an effect
// event (issue 433).
//
// The decisions are `tests/unit/focus-handback.test.ts`, and the kit's own
// focus delegation is `export-run-handback.browser.test.tsx`; this holds
// only which `target` is asked, with native buttons, which jsdom focuses.
//
// Mutation, watched failing (`focus-handback-target.mutations.json`): the
// first render's `target` kept - focus lands on the control it named.

import { act, useRef, type JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { useFocusHandback } from '../../src/renderer/src/focusHandback'
import { cleanup, renderPanel } from '../support/render'

afterEach(cleanup)

/**
 * A region whose controls are replaced as `step` moves: "Lay out" first,
 * then "Cancel" and "Lay out again" together, each keyed so that React
 * removes the one that held focus rather than reusing it. Focus belongs on
 * the control `belongs` names, as each render has it.
 */
function Region({ step, belongs }: { step: number; belongs: string }): JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  useFocusHandback(
    root,
    () => root.current?.querySelector<HTMLElement>(`[data-name="${belongs}"]`) ?? null,
    step,
  )
  return (
    <div ref={root}>
      {step === 0 ? (
        <button key="lay-out" type="button" data-name="lay-out">
          Lay out
        </button>
      ) : (
        <>
          <button key="cancel" type="button" data-name="cancel">
            Cancel
          </button>
          <button key="again" type="button" data-name="again">
            Lay out again
          </button>
        </>
      )}
    </div>
  )
}

describe('a focus hand-back', () => {
  it('lands on the control the render that replaced the controls names', () => {
    const view = renderPanel(<Region step={0} belongs="cancel" />)
    act(() => view.host.querySelector<HTMLElement>('[data-name="lay-out"]')?.focus())
    const pressed = document.activeElement
    expect(pressed?.textContent, 'the press held focus').toBe('Lay out')
    view.rerender(<Region step={1} belongs="again" />)
    expect(pressed?.isConnected, 'the control pressed is gone').toBe(false)
    expect(document.activeElement?.textContent).toBe('Lay out again')
  })
})
