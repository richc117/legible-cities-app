// The export preview's box is one kind of box in every state (issue 222's
// class of failure, kept after ADR-046 removed the map's own form of it).
//
// Cell 06's preview frame is sent to a new address on every plan, in the
// commit that changes the choice. A change of what kind of box surrounds a
// frame that has just been sent somewhere makes the frame's box again, and
// when that lands before the new document arrives the document is left with
// nothing laid out: it takes no focus and draws nothing, and it does not
// recover (about one run in fifty on a macOS runner, never by hand). With the
// timing forced, a change of `display` alone did it, 13 documents of 360;
// `container-type` alone left none of 360, which is not never.
//
// The base rules for the preview and its frame may say what kind of box they
// are, once. A rule that depends on anything else - another class, an
// attribute, `:has`, `:not`, a query - may not. This holds the stylesheets;
// a style written on the element and a box further out are the journey's in
// tests/e2e/notebook-a11y.spec.ts.

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const STYLES = resolve(__dirname, '../../src/renderer/src/styles')
const PREVIEW = /\.export-(preview|frame)\b/
const REMAKES_THE_BOX = ['display', 'container-type', 'contain', 'all']

interface Rule {
  selector: string
  /** Inside an at-rule (a media or container query, supports). */
  nested: boolean
  properties: string[]
}

/** Every rule of a stylesheet, with whether it sits inside an at-rule. */
export function rulesOf(text: string): Rule[] {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: Rule[] = []
  const stack: { prelude: string; start: number }[] = []
  let prelude = ''
  for (let i = 0; i < css.length; i += 1) {
    const char = css[i]
    if (char === '{') {
      stack.push({ prelude: prelude.trim(), start: i })
      prelude = ''
    } else if (char === '}') {
      const block = stack.pop()
      prelude = ''
      if (block === undefined) continue
      const body = css.slice(block.start + 1, i)
      if (block.prelude.startsWith('@') || body.includes('{')) continue
      rules.push({
        selector: block.prelude,
        nested: stack.some((open) => open.prelude.startsWith('@')),
        properties: body
          .split(';')
          .map((declaration) => declaration.split(':')[0].trim().toLowerCase())
          .filter(Boolean),
      })
    } else if (char !== undefined && stack.length >= 0) {
      prelude += char
    }
  }
  return rules
}

/** A selector that is only the preview or its frame, with nothing else in it. */
const isBase = (selector: string): boolean => /^\.export-(preview|frame)$/.test(selector.trim())

/** What is wrong with these rules, one sentence each; none is right. */
export function refused(rules: Rule[]): string[] {
  return rules.flatMap((rule) =>
    rule.selector
      .split(',')
      .map((selector) => selector.trim())
      .filter((selector) => PREVIEW.test(selector))
      .flatMap((selector) => {
        const dependent = rule.nested || !isBase(selector)
        if (!dependent) return []
        return rule.properties
          .filter((property) => REMAKES_THE_BOX.includes(property))
          .map(
            (property) =>
              `${selector}${rule.nested ? ' (inside a query)' : ''} sets ${property}, which remakes the frame's box in a state`,
          )
      }),
  )
}

describe("the export preview's box is one kind in every state", () => {
  it('has no rule that remakes it depending on anything', () => {
    const found = readdirSync(STYLES)
      .filter((file) => file.endsWith('.css'))
      .flatMap((file) =>
        refused(rulesOf(readFileSync(join(STYLES, file), 'utf8'))).map((why) => `${file}: ${why}`),
      )
    expect(found).toEqual([])
  })

  it('does look at the preview and its frame, so the test above is not empty', () => {
    const all = readdirSync(STYLES)
      .filter((file) => file.endsWith('.css'))
      .flatMap((file) => rulesOf(readFileSync(join(STYLES, file), 'utf8')))
    expect(all.some((rule) => isBase(rule.selector) && rule.selector.includes('preview'))).toBe(
      true,
    )
    expect(all.some((rule) => isBase(rule.selector) && rule.selector.includes('frame'))).toBe(true)
  })

  it('refuses what it should, and allows what it should', () => {
    const bad = [
      '.export-preview[data-ratio] { display: flex }',
      '.export-frame.tall { container-type: size }',
      '.export-preview:has(.x) { contain: layout }',
      '@media (min-width: 40rem) { .export-frame { display: none } }',
      '.cell.open .export-preview { all: unset }',
    ]
    for (const css of bad) expect(refused(rulesOf(css)), css).not.toEqual([])
    const fine = [
      '.export-preview { display: grid; container-type: inline-size }',
      '.export-frame { display: block }',
      '.export-preview[data-ratio] { width: 10px }',
      '@media (prefers-reduced-motion: reduce) { .export-frame { transition: none } }',
    ]
    for (const css of fine) expect(refused(rulesOf(css)), css).toEqual([])
  })
})
