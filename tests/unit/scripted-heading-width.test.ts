// A heading the app focuses by script is as wide as its words, so its ring is
// (issue 564, DESIGN.md section 12).
//
// A heading is a block, so the ring on one that took focus ran the width of
// the column and read as a text field. The rule that fits it to its words is
// one selector, by the trait the headings share (`tabindex="-1"`) rather than
// by id, so that a heading added later is covered without being named. What
// the rule does to a box is measured in the end-to-end suite
// (`tests/e2e/accessibility.spec.ts`); this suite runs in node and cannot lay
// anything out, so it holds the rule as text: that it is there, that it
// reaches every scripted heading the interface draws, and that it leaves a
// cell's heading alone.
//
// Mutations, watched failing (`scripted-heading-width.mutations.json`): the
// `inline-size` line deleted, the `h3` dropped from the selector, and the
// exclusion of the cell heading dropped.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = resolve(__dirname, '../../src/renderer/src')
const css = readFileSync(resolve(src, 'styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The rule that sizes a heading made focusable by `tabindex="-1"`, as selector and body. */
const rule = [...css.matchAll(/([^{}]*\[tabindex=['"]-1['"]\][^{}]*)\{([^}]*)\}/g)]
  .map((m) => ({ selector: m[1].trim(), body: m[2] }))
  .find((r) => /\bh1\b/.test(r.selector))

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return walk(path)
    return name.endsWith('.tsx') ? [path] : []
  })
}

/** The level of every heading element a component draws with `tabIndex={-1}`, with the file it is in. */
const scripted = walk(src).flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(/<h([1-6])\b[^>]*\btabIndex=\{-1\}/g)].map((m) => ({
    file: file.slice(src.length + 1),
    level: Number(m[1]),
  })),
)

describe('a heading the app focuses by script', () => {
  it('is as wide as its words, and no wider than its column', () => {
    expect(rule, 'a rule on headings with tabindex="-1" in app.css').toBeDefined()
    expect(rule?.body).toMatch(/inline-size:\s*fit-content/)
    expect(rule?.body).toMatch(/max-inline-size:\s*100%/)
  })

  it('is reached by that rule wherever the interface draws one', () => {
    expect(scripted.length, 'the headings the interface focuses').toBeGreaterThanOrEqual(8)
    const levels = (/:is\(([^)]*)\)/.exec(rule?.selector ?? '')?.[1] ?? '')
      .split(',')
      .map((tag) => tag.trim())
    for (const { file, level } of scripted)
      expect(levels, `${file} draws an h${level} with tabIndex={-1}`).toContain(`h${level}`)
  })

  it('leaves a cell’s heading alone: its row is a band, and the ring is the band’s', () => {
    expect(rule?.selector).toMatch(/:not\(\.disclosure-heading\)/)
    const kit = readFileSync(resolve(src, 'kit/Disclosure.tsx'), 'utf8')
    expect(kit).toMatch(/<Heading className="disclosure-heading" tabIndex=\{-1\}/)
  })
})
