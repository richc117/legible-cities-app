// Focus that has nowhere to be (A6-07): when a control a person pressed
// goes with the press, focus is handed to the control that took its place,
// and only when focus had fallen to the body from inside the region. The
// hook's two decisions, without a browser; the end-to-end sweep drives the
// run, the export, the Library and Settings in the built app
// (tests/e2e/accessibility.spec.ts).

import { describe, expect, it } from 'vitest'
import { focusLost, shouldHandBack } from '../../src/renderer/src/focusHandback'

const body = { tagName: 'BODY' } as unknown as Element
const button = { tagName: 'BUTTON' } as unknown as Element

describe('focusLost', () => {
  it('is lost on the body, or when nothing holds it', () => {
    expect(focusLost(body, body)).toBe(true)
    expect(focusLost(null, body)).toBe(true)
  })

  it('is not lost while a control holds it', () => {
    expect(focusLost(button, body)).toBe(false)
  })
})

describe('shouldHandBack', () => {
  it('hands focus back when it fell to the body from inside the region', () => {
    expect(shouldHandBack(true, body, body)).toBe(true)
  })

  it('leaves focus a person moved elsewhere where it is', () => {
    expect(shouldHandBack(false, body, body)).toBe(false)
    expect(shouldHandBack(false, button, body)).toBe(false)
  })

  it('leaves focus alone while a control still holds it', () => {
    expect(shouldHandBack(true, button, body)).toBe(false)
  })
})
