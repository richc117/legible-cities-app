// The verdict the backwards walk gives a focus stop (issue 536, WCAG 2.2 SC
// 2.4.11): wholly under a sticky or fixed box fails, and the failure names
// the stop and the box. The page measures (`tests/support/a11y.ts`); this is
// the rule over what it measured, and the only part that runs without
// Electron. Beside it, the stylesheet's half of the fix: the page scrolls
// under the header, so the root carries a scroll padding as deep as the
// header, from a token.

import { describe, expect, it } from 'vitest'
import { boxWords, coveredStops, encloses, type Rect, type StopCover } from '../support/obscured'
import { rulesOf } from '../support/css-rules'

const header: Rect = { left: 0, top: 0, right: 1024, bottom: 41 }
const at = (top: number, height = 28): Rect => ({
  left: 100,
  top,
  right: 160,
  bottom: top + height,
})

const WINDOW = { width: 1024, height: 768 }

const stop = (control: string, rect: Rect, over: StopCover['over'] = []): StopCover => ({
  control,
  rect,
  window: WINDOW,
  over,
})
const pinned = (name: string, rect: Rect): StopCover['over'][number] => ({ name, rect })

describe('a stop under a pinned box', () => {
  it('is named, with the box that covers it and where each was', () => {
    // Mutation (mutations.json): `coveredStops` returns [] (or `encloses`
    // always false). The stops the walk found on main would pass: with cells
    // 02, 04, 05 and 06 open at 1024x768 it read 108 and named, among others,
    // the colour chip of line A, the input "A" and the select "Interchange
    // marker".
    const found = coveredStops([
      stop('button "Choose the colour of line A"', at(4), [
        pinned('header.app-header (sticky)', header),
      ]),
    ])
    expect(found).toEqual([
      'button "Choose the colour of line A" at 100,4 to 160,32 is wholly under header.app-header (sticky) at 0,0 to 1024,41',
    ])
  })

  it('is not one when the control only reaches under the box', () => {
    // Half in: 2.4.11 asks that a part be visible, and a ring on a control
    // with a part showing can be seen.
    expect(coveredStops([stop('button "A"', at(30), [pinned('header (sticky)', header)])])).toEqual(
      [],
    )
  })

  it('is not one when the box is not over the control at all', () => {
    expect(coveredStops([stop('button "A"', at(200)), stop('button "B"', at(300), [])])).toEqual([])
  })

  it('names every stop that is covered, and none that is not', () => {
    const found = coveredStops([
      stop('button "A"', at(2), [pinned('header (sticky)', header)]),
      stop('button "B"', at(300)),
      stop('a "C"', at(10), [pinned('header (sticky)', header)]),
    ])
    expect(found).toHaveLength(2)
    expect(found[0]).toContain('button "A"')
    expect(found[1]).toContain('a "C"')
  })

  it('takes the box that encloses it when more than one is over it', () => {
    const small: Rect = { left: 0, top: 0, right: 50, bottom: 20 }
    const found = coveredStops([
      stop('button "A"', at(4), [
        pinned('badge (fixed)', small),
        pinned('header (sticky)', header),
      ]),
    ])
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('header (sticky)')
  })

  it('is named when it is wholly outside the window, covered by nothing', () => {
    // Mutation (mutations.json): drop the window check from `coveredStops`.
    // A control that is not on the screen would pass as clear.
    expect(coveredStops([stop('button "Above"', at(-60))])).toEqual([
      'button "Above" at 100,-60 to 160,-32 is wholly outside the window, 1024x768',
    ])
    expect(coveredStops([stop('button "Below"', at(800))])).toHaveLength(1)
    expect(
      coveredStops([stop('button "Right"', { left: 1024, top: 100, right: 1080, bottom: 128 })]),
    ).toHaveLength(1)
  })

  it('is not outside the window while any of it shows', () => {
    expect(coveredStops([stop('button "Edge"', at(-20))])).toEqual([])
    expect(coveredStops([stop('button "Edge"', at(760))])).toEqual([])
  })

  it('does not judge a control with no area', () => {
    expect(
      coveredStops([
        stop('input "x"', { left: 10, top: 10, right: 10, bottom: 10 }, [
          pinned('header (sticky)', header),
        ]),
      ]),
    ).toEqual([])
  })

  it('reads a fraction of a pixel as covered', () => {
    // A header laid out at 40.6 still covers a control whose foot is at 40.9.
    const near: Rect = { left: 0, top: 0, right: 1024, bottom: 40.6 }
    expect(encloses(near, { left: 10, top: 6, right: 90, bottom: 40.9 })).toBe(true)
    expect(encloses(near, { left: 10, top: 6, right: 90, bottom: 42 })).toBe(false)
  })

  it('says a box in whole pixels', () => {
    expect(boxWords({ left: 0.4, top: 0.6, right: 100.5, bottom: 41.2 })).toBe('0,1 to 101,41')
  })
})

describe('the page scrolls clear of the header (issue 536)', () => {
  const root = rulesOf('app.css').filter((rule) => rule.selector === 'html')
  const padding = root
    .flatMap((rule) => rule.declarations)
    .find((d) => d.property === 'scroll-padding-top')

  it('has the root carry a scroll-padding-top', () => {
    // Mutation: delete the declaration from `html` in app.css. The browser
    // brings a control it scrolls to up to the window's top edge, under the
    // header, and a person tabbing backwards cannot see where focus is.
    expect(padding, 'html { scroll-padding-top } in app.css').toBeDefined()
  })

  it('takes it from the header-clearance token, never a literal', () => {
    expect(padding?.value).toBe('var(--header-clearance)')
  })

  it('starts the token from the header’s height', () => {
    // Mutation: `--header-clearance` given a literal in scale.css. The rule is
    // that the clearance starts from the header's own height, so it follows
    // the header when the header changes; how much room is added is a design
    // choice this does not mirror.
    const token = rulesOf('scale.css')
      .flatMap((rule) => rule.declarations)
      .find((d) => d.property === '--header-clearance')
    expect(token?.value).toMatch(/^calc\(var\(--header-height\)/)
  })
})
