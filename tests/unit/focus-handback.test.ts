// Focus that has nowhere to be (A6-07): when the control that last took
// focus in a region goes - removed, in a dialog that closed, disabled or no
// longer rendered - focus is handed to the control that took its place, and
// only when focus has nowhere else to be. The decisions, without a browser;
// the end-to-end sweep drives the run, the export, the Library and Settings
// in the built app (tests/e2e/accessibility.spec.ts).

import { describe, expect, it } from 'vitest'
import {
  focusLost,
  gone,
  shouldHandBack,
  type Focusable,
} from '../../src/renderer/src/focusHandback'

/** An element as the checks read it. */
const element = ({
  connected = true,
  inClosedDialog = false,
  disabled = false,
  visible = true,
}: {
  connected?: boolean
  inClosedDialog?: boolean
  disabled?: boolean
  visible?: boolean
} = {}): Focusable =>
  ({
    isConnected: connected,
    closest: (selector: string) =>
      selector === 'dialog:not([open])' && inClosedDialog ? ({} as Element) : null,
    matches: (selector: string) => selector === ':disabled' && disabled,
    hasAttribute: () => false,
    checkVisibility: () => visible,
  }) as unknown as Focusable
const body = element()

describe('gone', () => {
  it('holds focus while it is there, enabled and drawn', () => {
    expect(gone(element())).toBe(false)
  })

  // Chromium moves focus off such an element at its next rendering update,
  // and until then may still report it as focused.
  it('cannot hold focus once removed, in a closed dialog, disabled or not drawn', () => {
    expect(gone(element({ connected: false }))).toBe(true)
    expect(gone(element({ inClosedDialog: true }))).toBe(true)
    expect(gone(element({ disabled: true }))).toBe(true)
    expect(gone(element({ visible: false }))).toBe(true)
  })

  it('reads a kit button as disabled by the attribute on its host', () => {
    const host = { ...element(), hasAttribute: (name: string) => name === 'disabled' }
    expect(gone(host as unknown as Focusable)).toBe(true)
  })
})

describe('focusLost', () => {
  it('is lost on the body, on nothing, or on an element that is gone', () => {
    expect(focusLost(body, body)).toBe(true)
    expect(focusLost(null, body)).toBe(true)
    expect(focusLost(element({ connected: false }), body)).toBe(true)
  })

  it('is not lost while a control holds it', () => {
    expect(focusLost(element(), body)).toBe(false)
  })
})

describe('shouldHandBack', () => {
  it("hands focus on when the region's control that held it went", () => {
    const pressed = element({ connected: false })
    expect(shouldHandBack(pressed, body, body)).toBe(true)
    // Chromium still reporting the removed control as focused.
    expect(shouldHandBack(pressed, pressed, body)).toBe(true)
  })

  it('leaves focus a person put elsewhere, or nowhere, alone', () => {
    // Pressed on prose: nothing of the region's holds focus.
    expect(shouldHandBack(null, body, body)).toBe(false)
    // Moved to another control that is still there.
    expect(shouldHandBack(element({ connected: false }), element(), body)).toBe(false)
  })

  it('does nothing while the control that held focus is still there', () => {
    const held = element()
    expect(shouldHandBack(held, held, body)).toBe(false)
  })
})
