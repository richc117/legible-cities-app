// The page's drawing scaled for an enlarged picture of the map, and put back
// (tests/acceptance/evidence.ts, `redrawnCapture`'s second route). Both run
// inside the map's frame through Playwright's `evaluate`, which sends a
// function's text and nothing else: so each is self-contained, with no
// import, no closure and no helper. tests/unit/drawing.browser.test.tsx
// runs them against a real SVG in Chromium.
//
// This is the test's alone. It sets an inline style on the page's root SVG
// that the page never reads and the app never drives (the app drives the
// page through `window.__present`, from the main process), and marks the
// SVG with `data-evidence-*` attributes holding what it found, so the
// drawing can be put back exactly, "no style attribute" included.

/**
 * The root SVG of the page's drawing (the one holding `#linear-labels`)
 * scaled by `scale` about `origin`, in the frame's CSS pixels; the scale it
 * then measures on screen, or null where there is no drawing. A drawing
 * still marked from a picture before was not put back: its style is not the
 * page's own, so it is neither saved as the original nor scaled again, and
 * 'still scaled' comes back.
 */
export function scaleDrawing(
  html: HTMLElement,
  { scale, origin }: { scale: number; origin: { x: number; y: number } },
): number | null | 'still scaled' {
  const group = html.ownerDocument.querySelector('#linear-labels')
  let svg = group instanceof SVGElement ? group.ownerSVGElement : null
  while (svg?.ownerSVGElement) svg = svg.ownerSVGElement
  if (svg === null || svg === undefined) return null
  if (svg.hasAttribute('data-evidence-style')) return 'still scaled'
  const box = svg.getBoundingClientRect()
  svg.setAttribute('data-evidence-had-style', svg.hasAttribute('style') ? '1' : '0')
  svg.setAttribute('data-evidence-style', svg.getAttribute('style') ?? '')
  svg.setAttribute('data-evidence-width', String(box.width))
  svg.style.transformOrigin = `${origin.x - box.left}px ${origin.y - box.top}px`
  svg.style.transform = `scale(${scale})`
  const now = svg.getBoundingClientRect()
  return box.width > 0 ? now.width / box.width : null
}

/**
 * The drawing put back as `scaleDrawing` found it, its style exactly (or
 * none, where it had none) and the marks taken off: whether the test's
 * marks were found on it, and the scale it then measures against its width
 * before (1 where nothing of the test's was on it).
 */
export function restoreDrawing(html: HTMLElement): { found: boolean; measured: number | null } {
  const svg = html.ownerDocument.querySelector('svg[data-evidence-style]')
  if (!(svg instanceof SVGElement)) return { found: false, measured: 1 }
  // Reading the attribute first makes Chromium write the inline style the
  // transform set into it now: left unwritten, it is written after the
  // removal, and the drawing ends with an empty `style=""` it never had.
  // Emptying `style.cssText` first does not help (the browser test shows
  // the same `style=""`): the read is what settles it.
  svg.getAttribute('style')
  if (svg.getAttribute('data-evidence-had-style') === '1')
    svg.setAttribute('style', svg.getAttribute('data-evidence-style') ?? '')
  else svg.removeAttribute('style')
  const width = Number(svg.getAttribute('data-evidence-width'))
  for (const name of ['data-evidence-had-style', 'data-evidence-style', 'data-evidence-width'])
    svg.removeAttribute(name)
  return { found: true, measured: width > 0 ? svg.getBoundingClientRect().width / width : null }
}
