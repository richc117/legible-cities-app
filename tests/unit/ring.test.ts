// The verdict the accessibility sweep gives a focus ring (issue 436, R10-03):
// at least 2 CSS pixels thick and at least 3:1 against the ground it is drawn
// on. The page measures; this is the rule over what it measured, and the only
// part of the check that runs without Electron (tests/support/ring.ts). That
// the page measures what it says is the sweep itself, in the end-to-end suite.

import { describe, expect, it } from 'vitest'
import { MIN_RING_CONTRAST, MIN_RING_WIDTH, weakRings, type RingReading } from '../support/ring'

const ring = (over: Partial<RingReading> = {}): RingReading => ({
  kind: 'outline',
  width: 2,
  colour: 'rgb(0, 0, 255)',
  ground: 'rgb(26, 20, 16)',
  ratio: 6.78,
  ...over,
})

describe('the ring rule', () => {
  it('is two pixels and 3:1', () => {
    expect([MIN_RING_WIDTH, MIN_RING_CONTRAST]).toEqual([2, 3])
  })

  it('passes the interface’s own ring: 2px, --focus on --surface', () => {
    expect(weakRings([{ control: 'button "Lay out"', rings: [ring()] }])).toEqual([])
  })

  it('names a ring that is one pixel thick', () => {
    const found = weakRings([{ control: 'select "Width"', rings: [ring({ width: 1 })] }])
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('select "Width"')
    expect(found[0]).toContain('outline 1px')
  })

  it('names a ring under 3:1 against its ground, and says the ratio', () => {
    const found = weakRings([{ control: 'a', rings: [ring({ ratio: 2.99 })] }])
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('2.99:1')
  })

  it('takes the boundaries as passing', () => {
    expect(weakRings([{ control: 'a', rings: [ring({ width: 2, ratio: 3 })] }])).toEqual([])
  })

  it('names a ring whose ground or colour could not be read, never passing it by default', () => {
    const found = weakRings([
      { control: 'a', rings: [ring({ ground: null, ratio: null })] },
      { control: 'b', rings: [ring({ colour: 'color(srgb 0 0 1)', ratio: null })] },
    ])
    expect(found).toHaveLength(2)
    expect(found[0]).toContain('unmeasured')
  })

  it('passes a control on one ring that holds, whatever else it draws', () => {
    // A halo under the ring: 6px in the ground's own colour, ratio 1.
    const halo = ring({ kind: 'shadow', width: 6, colour: 'rgb(26, 20, 16)', ratio: 1 })
    expect(weakRings([{ control: 'skip link', rings: [halo, ring()] }])).toEqual([])
    expect(weakRings([{ control: 'skip link', rings: [halo] }])).toHaveLength(1)
  })

  it('names a control that shows something which is no ring at all', () => {
    const found = weakRings([{ control: 'a', rings: [] }])
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('no outline and no hard-edged shadow')
  })

  it('reports each weak control once, with every ring it drew', () => {
    const found = weakRings([
      { control: 'ok', rings: [ring()] },
      { control: 'thin', rings: [ring({ width: 1 }), ring({ kind: 'shadow', width: 1 })] },
    ])
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/outline 1px.*; shadow 1px/)
  })

  describe('a ring of two bands, for a control drawn on a colour a person chose', () => {
    // The colour picker's area on its own hue: the interface's usual ring
    // (cobalt) is 1.12:1 there. The two-tone ring is the theme's ink as an
    // outline with its ground as a band just outside it. Here each band is
    // one pixel (the outline, and a shadow of spread 2 whose first pixel
    // lies under the outline), so neither is a ring on its own: only the two
    // together are two pixels thick.
    const outline = ring({ element: 0, offset: 0, width: 1, ratio: 1.3 })
    const band = ring({ kind: 'shadow', element: 0, width: 2, ratio: 6.1 })

    it('passes on the band that clears, the two together two pixels thick', () => {
      expect(weakRings([{ control: 'div "Color"', rings: [outline, band] }])).toEqual([])
    })

    it('passes on the outline when it is the better band', () => {
      expect(
        weakRings([
          {
            control: 'a',
            rings: [
              { ...outline, ratio: 5 },
              { ...band, ratio: 1.1 },
            ],
          },
        ]),
      ).toEqual([])
    })

    it('fails when neither band clears 3:1, and says it was read as two bands', () => {
      const found = weakRings([
        { control: 'div "Color"', rings: [outline, { ...band, ratio: 1.5 }] },
      ])
      expect(found).toHaveLength(1)
      expect(found[0]).toContain('two-tone')
      expect(found[0]).toContain('1.50:1')
    })

    it('counts the shadow only where the outline does not cover it', () => {
      // A 1px shadow wholly under a 1px outline at no offset is no second band.
      expect(
        weakRings([{ control: 'a', rings: [outline, { ...band, width: 1, ratio: 6 }] }]),
      ).toHaveLength(1)
    })

    it('counts an inset shadow whole, which no outline covers', () => {
      expect(
        weakRings([
          { control: 'a', rings: [outline, { ...band, width: 1, inset: true, ratio: 6 }] },
        ]),
      ).toEqual([])
    })

    it('does not pair rings of two different elements', () => {
      const good = { ...outline, ratio: 5 }
      const weak = { ...band, ratio: 1.1 }
      expect(weakRings([{ control: 'a', rings: [good, weak] }])).toEqual([])
      expect(weakRings([{ control: 'a', rings: [good, { ...weak, element: 1 }] }])).toHaveLength(1)
    })

    it('needs the pair to be two pixels thick in all, as a single ring does', () => {
      expect(
        weakRings([
          {
            control: 'a',
            rings: [
              { ...outline, width: 0.5 },
              { ...band, width: 1 },
            ],
          },
        ]),
      ).toHaveLength(1)
    })
  })
})
