// A heading the app focuses by script is as wide as its words, so its ring is
// (issue 564, DESIGN.md section 12).
//
// A heading is a block, so the ring on one that took focus ran the width of
// the column and read as a text field. The rule that fits it to its words is
// one selector, by the trait the headings share (`tabindex="-1"`) rather than
// by id, so that a heading added later is covered without being named. What
// the rule does to a box is measured in the end-to-end suite
// (`tests/e2e/accessibility.spec.ts`, and `tuning.spec.ts` for the layout
// tuning's heading); this suite runs in node and cannot lay anything out, so
// it holds the rule as text: that it is there, that it reaches every scripted
// heading the interface draws, and that it leaves a cell's heading alone.
//
// The headings are found by parsing the components with the TypeScript
// compiler, not by a list kept in step with them. The scan covers every
// literal heading tag (`<h1>` to `<h6>`) written with a `tabIndex` of -1 and
// every `Disclosure` given a `heading=`, which draws one with `tabIndex={-1}`
// of its own; where that `heading={…}` is a variable, its level is read from
// the file's own `as 'hN'` cast. A heading made any other way, such as an
// element chosen by a component's prop and not by a `Disclosure`, is not
// seen. The list below is exact, so a new one changes this test where a
// person sees it, and is then covered by the rule or exempted on purpose.
//
// Mutations, watched failing (`scripted-heading-width.mutations.json`): each
// of the rule's two declarations deleted, the `h3` dropped from the selector,
// the cell heading's exemption dropped, that exemption widened back to every
// kit heading, and a scripted heading removed from the source.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'
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

/** `tabIndex="-1"`, `tabIndex={-1}`, or an expression that can be -1, such as `{open ? -1 : 0}`. */
const SCRIPTED = /\btabIndex=(?:"-1"|\{[^}]*-1[^}]*\})/

/**
 * Every JSX opening tag in a file, with its tag name and its attributes as
 * written. The file is parsed by the TypeScript compiler, so a quote in JSX
 * text, a comment inside braces or a `>` inside an arrow function is read as
 * the language reads it, which no pattern over the text does.
 */
function tagsOf(file: string, text: string): { tag: string; attributes: Map<string, string> }[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const tags: { tag: string; attributes: Map<string, string> }[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = new Map<string, string>()
      for (const property of node.attributes.properties)
        if (ts.isJsxAttribute(property))
          attributes.set(
            property.name.getText(source),
            property.initializer?.getText(source) ?? 'true',
          )
      tags.push({ tag: node.tagName.getText(source), attributes })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return tags
}

/** What the interface draws as a heading it focuses by script: `<file>: <element>`. */
const found = walk(src)
  .flatMap((file) => {
    const text = readFileSync(file, 'utf8')
    const name = file.slice(src.length + 1).replace(/\\/g, '/')
    const tags = tagsOf(file, text)
    const headings = tags
      .filter(({ tag, attributes }) => /^h[1-6]$/.test(tag) && SCRIPTED.test(scripted(attributes)))
      .map(({ tag }) => `${name}: ${tag}`)
    // A Disclosure with a `heading` draws that element, a literal ("h3") or,
    // for the notebook's cells, a variable the file types as `'h2' | 'h3'`.
    const disclosures = tags
      .filter(({ tag, attributes }) => tag === 'Disclosure' && attributes.has('heading'))
      .map(({ attributes }) => {
        const literal = /^"(h[1-6])"$/.exec(attributes.get('heading') ?? '')?.[1]
        const levels = literal ?? /as ((?:'h[1-6]'(?: \| )?)+)/.exec(text)?.[1] ?? '?'
        return `${name}: Disclosure ${levels.replace(/'/g, '')}`
      })
    return [...headings, ...disclosures]
  })
  .sort()

/** An element's `tabIndex` attribute as it was written, for `SCRIPTED` to read. */
function scripted(attributes: Map<string, string>): string {
  const value = attributes.get('tabIndex')
  return value === undefined ? '' : `tabIndex=${value}`
}

const levelsOf = (entry: string): string[] =>
  entry.replace(/^.*: (?:Disclosure )?/, '').split(' | ')

describe('a heading the app focuses by script', () => {
  it('is as wide as its words, and no wider than its column', () => {
    expect(rule, 'a rule on headings with tabindex="-1" in app.css').toBeDefined()
    expect(rule?.body).toMatch(/inline-size:\s*fit-content/)
    expect(rule?.body).toMatch(/max-inline-size:\s*100%/)
  })

  it('is each literal heading tag and each Disclosure with heading= the interface draws, and this list is exact', () => {
    expect(found).toEqual([
      'FeedList.tsx: h2',
      'Inspector.tsx: h2',
      'Jobs.tsx: h3',
      'LayoutTuning.tsx: Disclosure h3',
      'Library.tsx: h1',
      'SampleCities.tsx: h2',
      'Settings.tsx: h1',
      'Settings.tsx: h2',
      'Settings.tsx: h2',
      'notebook/Cell.tsx: Disclosure h2 | h3',
      'notebook/Outputs.tsx: h2',
      'notebook/ProjectHeader.tsx: h1',
    ])
  })

  it('is reached by that rule at every level the interface uses', () => {
    const selected = (/:is\(([^)]*)\)/.exec(rule?.selector ?? '')?.[1] ?? '')
      .split(',')
      .map((tag) => tag.trim())
    for (const entry of found)
      for (const level of levelsOf(entry))
        expect(selected, `${entry} is not reached by the rule`).toContain(level)
  })

  it('leaves a cell’s heading alone, found by its band and not by the kit’s class', () => {
    // The cell's heading holds one `.cell-head` button, the band that fills
    // the cell. The layout tuning's heading is drawn by the same kit control
    // and holds a toggle that is only its words, so exempting every kit
    // heading (`.disclosure-heading`) would bring the full-width ring back
    // there.
    expect(rule?.selector).toMatch(/:not\(:has\(>\s*\.cell-head\)\)/)
    expect(rule?.selector).not.toContain('disclosure-heading')
    const kit = readFileSync(resolve(src, 'kit/Disclosure.tsx'), 'utf8')
    expect(kit, 'the toggle is the heading’s direct child').toMatch(
      /<Heading[^>]*>\s*\{toggle\}\s*<\/Heading>/,
    )
    expect(kit, 'the toggle is the button itself, not something wrapped round it').toMatch(
      /const toggle = \(\s*<button/,
    )
    const disclosuresIn = (file: string): { attributes: Map<string, string> }[] =>
      tagsOf(file, readFileSync(resolve(src, file), 'utf8')).filter(
        ({ tag }) => tag === 'Disclosure',
      )
    const cell = disclosuresIn('notebook/Cell.tsx')
    expect(cell).toHaveLength(1)
    expect(cell[0].attributes.get('className')).toBe('"cell-head"')
    for (const { attributes } of disclosuresIn('LayoutTuning.tsx'))
      expect(attributes.get('className')).not.toContain('cell-head')
  })
})
