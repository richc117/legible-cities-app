import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The kit's element rules are unlayered, so they stand wherever the app
// declares nothing (issue 273). What neutralises them is read here.
const adapter = readFileSync(
  resolve(__dirname, '../../src/renderer/src/styles/figui-adapter.css'),
  'utf8',
)

const app = readFileSync(resolve(__dirname, '../../src/renderer/src/styles/app.css'), 'utf8')

describe("the adapter neutralises the kit's leaks", () => {
  it("resets the kit's section padding and margin", () => {
    expect(adapter).toMatch(/^section\s*\{[^}]*padding:\s*0;[^}]*margin:\s*0;/m)
  })
  it.each(['text', 'icon'])("maps the kit's %s on a disabled fill", (kind) => {
    expect(adapter).toMatch(
      new RegExp(`^\\s*--figma-color-${kind}-ondisabled:\\s*var\\(--text-faint\\);`, 'm'),
    )
  })
  it('gives panels stacked in a cell body a gap of their own', () => {
    expect(adapter).toMatch(
      /\.cell-body > section \+ section\s*\{[^}]*margin-top:\s*var\(--space-4-6\)/,
    )
  })
})

describe('the row-like buttons keep their own ground on a press', () => {
  it.each(['.entry', '.rail-step', '.cell-head'])(
    '%s is its own height and pressed ground',
    (row) => {
      expect(app).toMatch(new RegExp(`${row.replace('.', '\\.')}:hover:active`))
      expect(app).toMatch(/\.entry,\s*\.rail-step,\s*\.cell-head\s*\{[^}]*height:\s*auto/)
    },
  )
})
