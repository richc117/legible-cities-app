// @vitest-environment jsdom
// One line's options, drawn (issue 433, part c): what the Name field says
// when the line under it moves. The field follows the line's name when it
// moves - a reset, a stopped redraw put back, a record read again - and its
// refusal goes with it, while what a person types with nothing moving is
// kept.
//
// Drawn through `renderPanel` with the kit real, and opened, since jsdom
// puts no focus on a field inside a hidden group. The field is typed into
// and left as a person does, and what it holds and what is said beside it
// are read from the document. Each test was watched failing under
// its mutations in `line-options-fields.mutations.json`.

import { act, createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LineChoice } from '../../src/shared/project/types'
import LineOptions from '../../src/renderer/src/LineOptionsDisclosure'
import { NAME_LABEL, readName } from '../../src/renderer/src/lineOptions'
import { byName, cleanup, renderPanel } from '../support/render'

afterEach(cleanup)

const handback = createRef<HTMLElement>()

/** The disclosure opened, by a press of its toggle. */
function open(): void {
  const toggle = document.querySelector<HTMLButtonElement>('button.line-options-toggle')
  if (toggle === null) throw new Error('no line options are drawn')
  act(() => toggle.click())
}

/** Line A's options, holding `choice`. */
function options(choice: LineChoice, lastShown = false) {
  return (
    <LineOptions
      label="A"
      choice={choice}
      onChoose={vi.fn()}
      onFollow={vi.fn()}
      onPanelClosed={vi.fn()}
      onReset={vi.fn()}
      lastShown={lastShown}
      handback={handback}
    />
  )
}

/** The Name field's input. */
const nameField = (): HTMLInputElement => byName('textbox', NAME_LABEL) as HTMLInputElement

/** Text typed into the Name field, one character at a time, as a person types it. */
function type(text: string): void {
  const field = nameField()
  act(() => field.focus())
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  for (let at = 1; at <= text.length; at++)
    act(() => {
      setter?.call(field, text.slice(0, at))
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

/** The Name field left, as a person tabs out of it. */
const leave = (): void => act(() => nameField().blur())

/** Every refusal said beside a control, in the order drawn. */
const refusals = (): string[] =>
  [...document.querySelectorAll('[role="alert"]')].map((alert) => alert.textContent ?? '')

describe('the Name field, as the line’s name moves under it', () => {
  const tooLong = 'x'.repeat(41)
  const refused = readName('A', tooLong)
  if (!('refused' in refused)) throw new Error('41 characters are no longer refused')

  it('follows a name that moves, the refusal going with it', () => {
    const view = renderPanel(options({}))
    open()
    type(tooLong)
    leave()
    expect(refusals()).toEqual([refused.refused])
    // A reset, a stopped redraw or a record read again moves the name.
    view.rerender(options({ name: 'X' }))
    expect(nameField().value).toBe('X')
    expect(refusals()).toEqual([])
  })

  it('keeps what is typed while the name does not move', () => {
    const view = renderPanel(options({ name: 'X' }))
    open()
    type('Expo')
    expect(nameField().value).toBe('Expo')
    // The section draws again for something else: the name has not moved.
    view.rerender(options({ name: 'X', width: 6 }))
    expect(nameField().value).toBe('Expo')
  })
})
