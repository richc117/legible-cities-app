// Under `prefers-reduced-motion: reduce` every transition and animation in
// the interface is off (docs/DESIGN.md, section 7; constitution principle
// VI). The stylesheet does it once, for everything, with `!important`, so a
// transition written anywhere in it is covered; this test keeps that rule
// in place and keeps a transition that is only meant for full motion behind
// its own query. The end-to-end sweep checks the running app, including the
// kit's shadow roots (tests/e2e/accessibility.spec.ts, A6-07).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const app = readFileSync(resolve(__dirname, '../../src/renderer/src/styles/app.css'), 'utf8')
const css = app.replace(/\/\*[\s\S]*?\*\//g, '')
const REDUCE = '@media (prefers-reduced-motion: reduce)'
/** The reduce block, from its query to the brace that closes it. */
const reduceBlock = (): string => {
  const at = css.indexOf(REDUCE)
  return at === -1 ? '' : css.slice(at, css.indexOf('}\n}', at) + 3)
}

describe('reduced motion', () => {
  it('turns every transition and animation off, pseudo-elements and the backdrop included', () => {
    const block = reduceBlock()
    expect(block).not.toBe('')
    for (const selector of ['*,', '*::before,', '*::after,', 'dialog::backdrop'])
      expect(block, selector).toContain(selector)
    expect(block).toMatch(/transition:\s*none\s*!important/)
    expect(block).toMatch(/animation:\s*none\s*!important/)
  })

  it('declares no animation at all: nothing loops and nothing moves while idle', () => {
    const rest = css.replace(reduceBlock(), '')
    expect(rest).not.toMatch(/(^|[\s;{])animation(-name)?\s*:/m)
    expect(css).not.toMatch(/@keyframes/)
  })
})
