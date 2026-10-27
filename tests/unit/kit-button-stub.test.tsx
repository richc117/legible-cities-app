// @vitest-environment jsdom
// The native button a jsdom test puts in place of the kit's when it hands
// focus (`tests/support/kit-stubs.ts`, ADR-059). It is held to what such a
// test leans on: the press reaches `onClick`, `focus()` lands on the element
// the ref answers, a `disabled` button takes no press, and the accessible
// attributes arrive while the kit's own looks do not.
//
// Mutations, watched failing: the stub not forwarding its ref (`ref` left
// out of the element's props) - "takes focus" fails; the stub keeping the
// kit's looks (`delete` taken out) - "draws the kit's looks" fails.

import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Button from '../../src/renderer/src/kit/Button'
import { cleanup, press, renderPanel } from '../support/render'

vi.mock('../../src/renderer/src/kit/Button', async () =>
  (await import('../support/kit-stubs')).kitButtonStub(),
)

afterEach(cleanup)

describe('the kit button stub', () => {
  it('is a native button that takes a press, and none while disabled', () => {
    const pressed = vi.fn()
    const view = renderPanel(
      <>
        <Button onClick={() => pressed('go')}>Go</Button>
        <Button disabled onClick={() => pressed('held')}>
          Held
        </Button>
      </>,
    )
    expect(view.host.querySelector('fig-button')).toBeNull()
    press('Go')
    press('Held')
    expect(pressed.mock.calls).toEqual([['go']])
  })

  it('takes focus through its ref, as a hand-back gives it', () => {
    const ref = createRef<HTMLElement>()
    renderPanel(<Button ref={ref}>Reveal</Button>)
    ref.current?.focus()
    expect(document.activeElement).not.toBeNull()
    expect(document.activeElement).toBe(ref.current)
    expect(document.activeElement?.localName).toBe('button')
  })

  it("carries the accessible attributes and draws the kit's looks nowhere", () => {
    const view = renderPanel(
      <Button variant="primary" icon size="compact" aria-label="Move line A down" aria-expanded>
        Down
      </Button>,
    )
    const button = view.byName('button', 'Move line A down')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.textContent).toBe('Down')
    for (const look of ['variant', 'icon', 'size'])
      expect(button.hasAttribute(look), `no ${look} attribute`).toBe(false)
  })
})
