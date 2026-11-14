// The page's drawing scaled for an enlarged picture of the map and put back
// (tests/acceptance/drawing.ts, issue 728), against a real SVG: a browser
// test (ADR-059), because only a browser lays out an SVG, measures it on
// screen and applies a CSS transform to it; jsdom does none of these.
//
// Mutations, watched failing (the mutation runner takes unit tests only, so
// they are recorded here, as the browser project's other tests record
// theirs):
// - scaleDrawing's `if (svg.hasAttribute('data-evidence-style')) return
//   'still scaled'` taken out: a drawing left marked is scaled again, its
//   scaled style saved as the original, and the second test reads
//   "expected 1 to be 'still scaled'";
// - restoreDrawing's `else svg.removeAttribute('style')` taken out, or its
//   first `svg.getAttribute('style')`: a drawing that had no style ends with
//   `style=""`, and the first test reads "null: expected '' to be null".

import { afterEach, describe, expect, it } from 'vitest'
import { restoreDrawing, scaleDrawing } from '../acceptance/drawing'

let holder: HTMLDivElement | null = null

/** A page's drawing: a root SVG holding `#linear-labels`, as the engine's page draws it. */
function drawing(style: string | null): SVGSVGElement {
  holder = document.createElement('div')
  holder.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">' +
    '<g id="linear-labels"><text x="10" y="20">Union Station</text></g></svg>'
  document.body.append(holder)
  const svg = holder.querySelector('svg') as SVGSVGElement
  if (style !== null) svg.setAttribute('style', style)
  return svg
}

afterEach(() => {
  holder?.remove()
  holder = null
})

describe('the page’s drawing, scaled and put back', () => {
  it('measures the scale, and puts the style back exactly, no attribute included', () => {
    const html = document.documentElement
    for (const style of [null, '', 'display: block; color: red;']) {
      const svg = drawing(style)
      const width = svg.getBoundingClientRect().width
      expect(scaleDrawing(html, { scale: 3, origin: { x: 0, y: 0 } })).toBeCloseTo(3)
      expect(svg.getBoundingClientRect().width).toBeCloseTo(width * 3)
      const back = restoreDrawing(html)
      expect(back.found).toBe(true)
      expect(back.measured).toBeCloseTo(1)
      expect(svg.getAttribute('style'), String(style)).toBe(style)
      expect(svg.getAttributeNames().filter((n) => n.startsWith('data-evidence'))).toEqual([])
      holder?.remove()
    }
  })

  it('never scales a drawing still marked from a picture before, and puts that one back', () => {
    const html = document.documentElement
    const svg = drawing('color: red;')
    expect(scaleDrawing(html, { scale: 2, origin: { x: 0, y: 0 } })).toBeCloseTo(2)
    // The restore did not happen: the next picture finds the drawing marked.
    expect(scaleDrawing(html, { scale: 2, origin: { x: 0, y: 0 } })).toBe('still scaled')
    const back = restoreDrawing(html)
    expect(back.found).toBe(true)
    expect(back.measured).toBeCloseTo(1)
    expect(svg.getAttribute('style')).toBe('color: red;')
    // With nothing of the test's on it, putting back finds nothing to do.
    expect(restoreDrawing(html)).toEqual({ found: false, measured: 1 })
  })
})
