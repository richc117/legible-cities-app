// The geographic pane's buttons (issue 546, WCAG 2.5.7): the single-pointer
// way to everything a drag, the wheel and the keys do. A button hands the
// pane the key it stands for, and the pane takes that key through the one
// function the keyboard handler uses, so these tests hold the two together:
// what each button is named, what it presses, and what that does to the view.
// tests/e2e/geographic.spec.ts presses them in the built app.

import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Button from '../../src/renderer/src/kit/Button'
import { ViewControls } from '../../src/renderer/src/StageView'
import { ICON_NAMES } from '../../src/renderer/src/icons/Icon'
import { NUDGE, STEP, VIEW_CONTROLS, viewed } from '../../src/renderer/src/engine/stages'

const PANE = { width: 800, height: 500 }
const DRAWING = { width: 1600, height: 960 }
const VIEW = { x: 0, y: 0, scale: 1 }

/** Every kit button in an element tree, in order, without rendering it. */
function buttonsIn(node: ReactNode): ReactElement<{ onClick?: () => void; children: ReactNode }>[] {
  if (Array.isArray(node)) return node.flatMap(buttonsIn)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  if (node.type === Button)
    return [node as ReactElement<{ onClick?: () => void; children: ReactNode }>]
  return buttonsIn(node.props.children)
}

const text = (node: ReactNode): string =>
  renderToStaticMarkup(<>{node}</>)
    .replace(/<[^>]*>/g, '')
    .trim()

describe('the pane has a button for every move', () => {
  it('names seven buttons, and each icon is one the interface has', () => {
    expect(VIEW_CONTROLS.map((c) => c.name)).toEqual([
      'Zoom in',
      'Zoom out',
      'Fit',
      'Pan left',
      'Pan right',
      'Pan up',
      'Pan down',
    ])
    for (const control of VIEW_CONTROLS) expect(ICON_NAMES, control.name).toContain(control.icon)
  })

  it('draws the seven as the kit buttons they are, each with its name as its visible word', () => {
    const buttons = buttonsIn(ViewControls({ onPress: () => undefined }))
    expect(buttons).toHaveLength(7)
    expect(buttons.map((b) => text(b.props.children))).toEqual(VIEW_CONTROLS.map((c) => c.name))
    const markup = renderToStaticMarkup(<ViewControls onPress={() => undefined} />)
    expect(markup).toContain('role="group"')
    expect(markup).toContain('aria-label="Pan and zoom"')
  })

  it('presses, for each button, the key the pane takes for the same move', () => {
    const pressed: string[] = []
    const buttons = buttonsIn(ViewControls({ onPress: (key) => pressed.push(key) }))
    for (const button of buttons) button.props.onClick?.()
    expect(pressed).toEqual(VIEW_CONTROLS.map((c) => c.key))
  })

  it('moves the view the way each button says, by the step the key takes', () => {
    const by = (name: string) => {
      const control = VIEW_CONTROLS.find((c) => c.name === name)!
      return viewed(VIEW, control.key, PANE, DRAWING)!
    }
    // The view looks left, so the drawing moves right: the left arrow's move.
    expect(by('Pan left')).toEqual({ ...VIEW, x: NUDGE })
    expect(by('Pan right')).toEqual({ ...VIEW, x: -NUDGE })
    expect(by('Pan up')).toEqual({ ...VIEW, y: NUDGE })
    expect(by('Pan down')).toEqual({ ...VIEW, y: -NUDGE })
    expect(by('Zoom in').scale).toBe(STEP)
    expect(by('Zoom out').scale).toBeCloseTo(1 / STEP)
    // Fit is the drawing whole and centred, wherever the view had got to.
    const lost = { x: 900, y: -700, scale: 3 }
    expect(viewed(lost, '0', PANE, DRAWING)).toEqual({ x: 0, y: 10, scale: 0.5 })
  })

  it('takes the same keys from the keyboard, and fits nothing where nothing is drawn', () => {
    expect(viewed(VIEW, '+', PANE, null)?.scale).toBe(STEP)
    expect(viewed(VIEW, 'ArrowLeft', PANE, null)).toEqual({ ...VIEW, x: NUDGE })
    expect(viewed(VIEW, '0', PANE, null)).toBeNull()
    expect(viewed(VIEW, 'a', PANE, DRAWING)).toBeNull()
  })
})
