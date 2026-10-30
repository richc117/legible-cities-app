// @vitest-environment jsdom
// How far an opened colour panel scrolls the page (issue 436, `fitShift`
// in `ColourChip.tsx`): the least that brings the chip and its panel into
// the window together, never so far up that the chip goes under the
// header, and never so far down that the chip goes past the window's
// foot. The geometry is a pure function, so the cases are a table here;
// the sweep in `notebook-a11y.spec.ts` checks the real popover, which
// jsdom does not have. Each test was watched failing under its mutation in
// `colour-fit.mutations.json`.

import { describe, expect, it } from 'vitest'
import { fitShift } from '../../src/renderer/src/ColourChip'

/** A 720-tall window under a header whose bottom is at 56. */
const HEIGHT = 720
const HEADER = 56

describe('the scroll that keeps a colour panel and its chip in the window', () => {
  it('leaves the page where both already fit', () => {
    expect(fitShift({ top: 300, bottom: 324 }, { top: 330, bottom: 650 }, HEADER, HEIGHT)).toBe(0)
  })

  it('moves the page up by the overflow of a panel below its chip, but never the chip under the header', () => {
    expect(fitShift({ top: 400, bottom: 424 }, { top: 430, bottom: 750 }, HEADER, HEIGHT)).toBe(30)
    expect(fitShift({ top: 80, bottom: 104 }, { top: 110, bottom: 900 }, HEADER, HEIGHT)).toBe(24)
  })

  it('moves the page down for a panel above its chip under the header, as far as the chip still fits', () => {
    // The panel's top is 40 under the header; the chip has 100 below it.
    expect(fitShift({ top: 596, bottom: 620 }, { top: 16, bottom: 590 }, HEADER, HEIGHT)).toBe(-40)
    // The chip has 10 below it: the page moves 10, the chip stays in the
    // window, and the rest of the panel is drawn over the header.
    expect(fitShift({ top: 686, bottom: 710 }, { top: 16, bottom: 680 }, HEADER, HEIGHT)).toBe(-10)
    // At the foot already: nothing moves.
    expect(fitShift({ top: 696, bottom: 720 }, { top: 16, bottom: 690 }, HEADER, HEIGHT)).toBe(0)
  })

  it('brings back a chip already past the foot, though its panel above runs under the header', () => {
    // Both overrun at once: the chip's 12 past the foot decides, and the
    // page moves up 12, never down by the panel's 36 under the header.
    expect(fitShift({ top: 708, bottom: 732 }, { top: 20, bottom: 700 }, HEADER, HEIGHT)).toBe(12)
  })
})
