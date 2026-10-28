// @vitest-environment jsdom
// The colour panel's hex field (issue 433, part c): it follows the colour
// the picker shows when that colour moves - a step of a drag, a reset, a
// stopped redraw put back - and the refusal beside it goes with it, while
// what a person types with nothing moving is kept.
//
// The picker is drawn on its own through `renderPanel`, with the kit real:
// the panel it lives in is an auto popover, which jsdom does not have
// (ADR-059), and what is held here is the picker's, not the popover's. The
// field is typed into and the button pressed as a person does, and what the
// field holds and what is said under it are read from the document. Each
// test was watched failing under its mutation in
// `colour-picker.mutations.json`.

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ColourPicker } from '../../src/renderer/src/ColourChip'
import { answered, byName, cleanup, press, renderPanel } from '../support/render'

afterEach(cleanup)

const REFUSED = 'A colour is six hexadecimal digits, such as 0072bc.'

/** The picker showing `colour`. */
const picker = (colour: string) => (
  <ColourPicker colour={colour} onPick={vi.fn()} onPickEnd={vi.fn()} onDone={vi.fn()} />
)

/** The Hex value field's input. */
const hexField = (): HTMLInputElement => byName('textbox', 'Hex value') as HTMLInputElement

/** Text typed into the Hex value field, one character at a time, as a person types it. */
function type(text: string): void {
  const field = hexField()
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  for (let at = 1; at <= text.length; at++)
    act(() => {
      setter?.call(field, text.slice(0, at))
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

/** What is said under the field: its refusal, or nothing. */
const said = (): string => document.querySelector('.colour-picker .message')?.textContent ?? ''

describe('the colour panel’s hex field', () => {
  it('follows a colour that moves, the refusal going with it', async () => {
    const view = renderPanel(picker('#0072bc'))
    await answered()
    expect(hexField().value).toBe('#0072bc')
    type('zz')
    press('Use this colour')
    expect(said()).toBe(REFUSED)
    // A drag's next step, a reset or a stopped redraw moves the colour.
    view.rerender(picker('#ff0000'))
    expect(hexField().value).toBe('#ff0000')
    expect(said()).toBe('')
  })

  it('keeps what is typed while the colour does not move', async () => {
    const view = renderPanel(picker('#0072bc'))
    await answered()
    type('ab')
    expect(hexField().value).toBe('ab')
    // The row draws again for something else: the colour has not moved.
    view.rerender(picker('#0072bc'))
    expect(hexField().value).toBe('ab')
  })
})
