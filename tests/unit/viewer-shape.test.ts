// The map's shape is one kind of box in both of its states, the plain map's
// and the export's preview's (issue 222). The viewer sends its frame to the
// planned address in the same commit that gives the shape its planned
// class, and while that class changed the shape's `display` the frame's box
// was made again a few milliseconds after the frame had been sent
// somewhere. When that fell before the new document arrived, the document
// was left with nothing laid out: it took no focus, a press of Tab passed
// over it, and the preview would have been blank. It happened about once in
// thirty under a forced timing and never by hand, so no end-to-end test
// holds it; what holds it is that the two states cannot differ in `display`
// again without this test saying why not.

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const STYLES = resolve(__dirname, '../../src/renderer/src/styles')

interface Rule {
  file: string
  selectors: string[]
  declarations: Map<string, string>
}

/** Every rule of every stylesheet, the ones inside a query included. */
const rules: Rule[] = readdirSync(STYLES)
  .filter((name) => name.endsWith('.css'))
  .flatMap((file) => {
    const css = readFileSync(join(STYLES, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
      file,
      selectors: selectors.split(',').map((selector) => selector.trim()),
      declarations: new Map(
        body
          .split(';')
          .map((declaration) => declaration.split(':'))
          .filter((parts) => parts.length >= 2)
          .map(([property, ...value]) => [property.trim(), value.join(':').trim()]),
      ),
    }))
  })

/** What a selector styles: its last compound, after every combinator. */
const subject = (selector: string): string => selector.split(/[\s>+~]+/).pop() ?? ''

describe("the map's shape", () => {
  it('is a grid and a size container whichever state it is in', () => {
    const plain = rules.filter((rule) => rule.selectors.includes('.viewer-shape'))
    expect(plain, 'one rule for the shape itself').toHaveLength(1)
    expect(plain[0].file).toBe('panels.css')
    expect(plain[0].declarations.get('display')).toBe('grid')
    expect(plain[0].declarations.get('place-items')).toBe('center')
    // The planned frame is sized in the container's own units.
    expect(plain[0].declarations.get('container-type')).toBe('size')
  })

  it('is given no display by its planned state, in any stylesheet', () => {
    const planned = rules.filter((rule) =>
      rule.selectors.some((selector) => subject(selector).includes('.viewer-shape-planned')),
    )
    for (const rule of planned)
      expect(
        rule.declarations.has('display'),
        `${rule.file}: ${rule.selectors.join(', ')} changes the display of a box whose frame is being sent somewhere (issue 222)`,
      ).toBe(false)
  })

  it('reads the stylesheets it judges: the planned frame is found, sized in the container’s units', () => {
    const frame = rules.filter((rule) =>
      rule.selectors.includes('.viewer-shape-planned .viewer-frame'),
    )
    expect(frame).toHaveLength(1)
    expect(frame[0].declarations.get('width')).toContain('cqw')
    expect(frame[0].declarations.get('height')).toContain('cqh')
  })
})
