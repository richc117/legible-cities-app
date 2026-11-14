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

import { act, useState, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ColourPicker } from '../../src/renderer/src/ColourChip'
import { answered, byName, cleanup, press, renderPanel } from '../support/render'

/** Whether React is told it is driven by `act`, as `render.tsx` tells it. */
const actEnvironment = (on: boolean): void => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = on
}

afterEach(() => {
  actEnvironment(true)
  cleanup()
})

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

// The end of a drag (issue 671). react-colorful reports its end on the
// `mouseup` from its own cache, which a step of the drag reaches only once
// React has rendered it, and React 19 renders a native `mousemove` in a
// later task. So these run with React's own scheduling and no `act`, which
// would render each move at once and hide the race: the events are sent as
// a browser sends them and React renders when it would.

/** The colour square's slider, laid out 200 by 160 at the window's corner. */
function square(): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    '.colour-picker .react-colorful__saturation .react-colorful__interactive',
  )
  if (found === null) throw new Error('the colour square is not drawn')
  found.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 200, height: 160 })
  return found
}

const mouse = (type: string, x: number, y: number, buttons: number): MouseEvent =>
  new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons })

/** A task of its own: whatever React scheduled before it has run. */
const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** A few tasks, for what React scheduled from what it scheduled. */
async function settle(): Promise<void> {
  for (let task = 0; task < 5; task++) await nextTask()
}

/**
 * The picker held as a row holds it: every colour the picker reports is
 * the colour it is drawn with, so the swatch and the hex field show it.
 */
function Row({
  start,
  onPick,
  onPickEnd,
}: {
  start: string
  onPick: (hex: string) => void
  onPickEnd: (hex: string) => void
}): JSX.Element {
  const [colour, setColour] = useState(start)
  return (
    <ColourPicker
      colour={colour}
      onPick={(hex) => {
        setColour(hex)
        onPick(hex)
      }}
      onPickEnd={onPickEnd}
      onDone={vi.fn()}
    />
  )
}

/** The row drawn with `start`, and React left to schedule on its own. */
async function row(start: string) {
  const onPick = vi.fn<(hex: string) => void>()
  const onPickEnd = vi.fn<(hex: string) => void>()
  renderPanel(<Row start={start} onPick={onPick} onPickEnd={onPickEnd} />)
  await answered()
  actEnvironment(false)
  return {
    onPick,
    onPickEnd,
    picked: () => onPick.mock.calls.map(([hex]) => hex),
    ended: () => onPickEnd.mock.calls.map(([hex]) => hex),
  }
}

/** Pressed inside the square, and moved once more inside it, each rendered. */
async function pressAndMove(): Promise<void> {
  square().dispatchEvent(mouse('mousedown', 20, 20, 1))
  await settle()
  window.dispatchEvent(mouse('mousemove', 120, 60, 1))
  await settle()
}

describe('the end of a drag', () => {
  it('is the colour the drag was released on when the last move and the release come in one task', async () => {
    const { picked, ended } = await row('#e1d1cb')
    await pressAndMove()
    expect(ended(), 'the press and the first move are steps, not ends').toEqual([])
    // Past the square's corner, which clamps to black, and released there,
    // before React has rendered the move: as Chromium sends a move coalesced
    // just before the release, or as a loaded runner sends both.
    window.dispatchEvent(mouse('mousemove', 500, 500, 1))
    window.dispatchEvent(mouse('mouseup', 500, 500, 0))
    await vi.waitFor(() => expect(ended()).not.toEqual([]))
    await settle()
    expect(picked().at(-1), 'the drag reached the corner').toBe('#000000')
    expect(ended(), 'one end, with the last colour the drag reached').toEqual(['#000000'])
    expect(hexField().value, 'and the swatch shows the colour built').toBe('#000000')
  })

  it('is the same when the release comes in a task of its own (control)', async () => {
    const { picked, ended } = await row('#e1d1cb')
    await pressAndMove()
    window.dispatchEvent(mouse('mousemove', 500, 500, 1))
    await settle()
    window.dispatchEvent(mouse('mouseup', 500, 500, 0))
    await vi.waitFor(() => expect(ended()).not.toEqual([]))
    await settle()
    expect(picked().at(-1)).toBe('#000000')
    expect(ended()).toEqual(['#000000'])
    expect(hexField().value).toBe('#000000')
  })

  it('is nothing for a press that does not move the colour, and once for the next that does', async () => {
    // Black is the square's lower left corner: a press there is black again.
    const { picked, ended } = await row('#000000')
    square().dispatchEvent(mouse('mousedown', 0, 160, 1))
    await settle()
    window.dispatchEvent(mouse('mouseup', 0, 160, 0))
    await settle()
    expect(picked(), 'nothing moved').toEqual([])
    // The next gesture does move it, and is the only end.
    await pressAndMove()
    window.dispatchEvent(mouse('mouseup', 120, 60, 0))
    await vi.waitFor(() => expect(ended()).not.toEqual([]))
    await settle()
    expect(ended()).toEqual([picked().at(-1)])
  })
})
