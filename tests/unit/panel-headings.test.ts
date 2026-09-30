import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// A heading inside a cell is one rule in notebook.css (issue 281). It was
// six, one per panel in panels.css, and they drifted: one sat four pixels
// below where the others sat twelve. A panel that wants a different heading
// says so in notebook.css, where the others are, not in its own block.
const styles = resolve(__dirname, '../../src/renderer/src/styles')
const panels = readFileSync(resolve(styles, 'panels.css'), 'utf8')
const notebook = readFileSync(resolve(styles, 'notebook.css'), 'utf8')

describe("a cell's headings share one rule", () => {
  it('declares no h3 rule scoped to a panel in panels.css', () => {
    // Any selector that names an h3, however it is scoped.
    const rules = panels.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(rules.match(/[^{}]*\bh3\b[^{}]*\{/g) ?? []).toEqual([])
  })

  it("has the one rule, and the one heading that opens the cell's body with nothing above", () => {
    expect(notebook).toMatch(
      /\.cell-body h3\s*\{[^}]*margin:\s*var\(--space-4-6\) 0 var\(--space-4-3\)/,
    )
    expect(notebook).toMatch(
      /\.cell-body > section:first-child > h3:first-child\s*\{[^}]*margin-top:\s*0/,
    )
  })
})
