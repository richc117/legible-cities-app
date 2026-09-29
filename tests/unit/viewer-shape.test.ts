// The map's shape is one kind of box in both of its states, the plain map's
// and the export's preview's (issue 222). The viewer sends its frame to the
// planned address in the same commit that gives the shape its planned
// class, and while that class changed what kind of box the shape was, the
// frame's box was made again a few milliseconds after the frame had been
// sent somewhere. When that fell before the new document arrived, the
// document was left with nothing laid out: it took no focus, and a press of
// Tab passed over it. It was about one run in fifty on a macOS runner and
// never by hand, so a test that runs the app once would not notice it
// coming back.
//
// This holds the stylesheets, which is where it was. The other ways in - a
// style written on the element, a rule keyed on something else, a box
// further out - are held by the journey in tests/e2e/notebook-a11y.spec.ts,
// which reads what kind of box the frame and everything around it is in
// both states and compares them.

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const STYLES = resolve(__dirname, '../../src/renderer/src/styles')
const PLANNED = '.viewer-shape-planned'

/**
 * What a rule that names the planned state may not declare, on the shape or
 * on the frame inside it. `display` is the one measured: with the timing
 * forced, changing it alone left 13 documents of 360 empty. Changing
 * `container-type` alone left none of 360, which is not never, and the
 * planned state has no need of it or of `contain`. `all` carries a
 * `display` with it.
 */
const REMAKES_THE_BOX = ['display', 'container-type', 'contain', 'all']

interface Rule {
  file: string
  selectors: string[]
  declarations: Map<string, string>
}

/** Every rule of a stylesheet, the ones inside a query included. */
function rulesOf(text: string, file: string): Rule[] {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
    file,
    selectors: selectors.split(',').map((selector) => selector.trim()),
    declarations: new Map(
      body
        .split(';')
        .map((declaration) => declaration.split(':'))
        .filter((parts) => parts.length >= 2)
        .map(([property, ...value]) => [property.trim().toLowerCase(), value.join(':').trim()]),
    ),
  }))
}

/** What is wrong with these rules, one sentence for each; none is right. */
function refused(rules: Rule[]): string[] {
  return rules
    .filter((rule) => rule.selectors.some((selector) => selector.includes(PLANNED)))
    .flatMap((rule) =>
      REMAKES_THE_BOX.filter((property) => rule.declarations.has(property)).map(
        (property) =>
          `${rule.file}: "${rule.selectors.join(', ')}" sets ${property} for the planned state, which makes a box again under a frame that is being sent somewhere (issue 222)`,
      ),
    )
}

const rules: Rule[] = (readdirSync(STYLES, { recursive: true }) as string[])
  .filter((name) => name.endsWith('.css'))
  .flatMap((file) => rulesOf(readFileSync(join(STYLES, file), 'utf8'), file))

describe("the map's shape", () => {
  it('is a grid and a size container by its own rule, which no state changes', () => {
    const plain = rules.filter((rule) => rule.selectors.includes('.viewer-shape'))
    expect(plain, 'one rule for the shape itself').toHaveLength(1)
    expect(plain[0].file).toBe('panels.css')
    expect(plain[0].declarations.get('display')).toBe('grid')
    expect(plain[0].declarations.get('place-items')).toBe('center')
    // The planned frame is sized in the container's own units.
    expect(plain[0].declarations.get('container-type')).toBe('size')
  })

  it('is the same kind of box in its planned state, in every stylesheet', () => {
    expect(refused(rules)).toEqual([])
  })

  it('reads the stylesheets it judges: the planned frame is found, sized in the container’s units', () => {
    const frame = rules.filter((rule) => rule.selectors.includes(`${PLANNED} .viewer-frame`))
    expect(frame).toHaveLength(1)
    expect(frame[0].declarations.get('width')).toContain('cqw')
    expect(frame[0].declarations.get('height')).toContain('cqh')
  })
})

// The rule above finds nothing in the stylesheets as they are, so it is
// shown here finding what it is for.
describe('what the rule refuses', () => {
  it('refuses the rule this change took out, once for each of its two declarations', () => {
    const was = `${PLANNED} {\n  display: grid;\n  place-items: center;\n  container-type: size;\n}`
    expect(refused(rulesOf(was, 'panels.css'))).toEqual([
      expect.stringContaining('sets display for the planned state'),
      expect.stringContaining('sets container-type for the planned state'),
    ])
  })

  it.each([
    ['inside a query', `@media (min-width: 900px) {\n  ${PLANNED} { display: block; }\n}`],
    ['under another class', `.preview > .viewer-shape${PLANNED}:hover { display: block; }`],
    ['in a list of selectors', `.viewer, ${PLANNED} { display: block; }`],
    ['on the frame inside it', `${PLANNED} .viewer-frame { display: inline; }`],
    ['with the frame named in a test of it', `${PLANNED}:has(> .viewer-frame) { display: block; }`],
    ['in capitals', `${PLANNED} { DISPLAY: block; }`],
    ['as important', `${PLANNED} { display: block !important; }`],
    ['through all', `${PLANNED} { all: unset; }`],
    ['as containment', `${PLANNED} { contain: size; }`],
    ['behind a comment', `${PLANNED} { /* a grid */ display: grid; }`],
  ])('refuses one %s', (_, css) => {
    expect(refused(rulesOf(css, 'any.css'))).toHaveLength(1)
  })

  it.each([
    ['the frame’s size in the planned state', `${PLANNED} .viewer-frame { width: 100cqw; }`],
    ['a display on the plain shape', `.viewer-shape { display: grid; }`],
    ['a display on something else', `.viewer-shaped { display: block; } .cell { display: grid; }`],
    ['a property that only ends in one', `${PLANNED} { --display: block; }`],
  ])('leaves %s alone', (_, css) => {
    expect(refused(rulesOf(css, 'any.css'))).toEqual([])
  })
})
