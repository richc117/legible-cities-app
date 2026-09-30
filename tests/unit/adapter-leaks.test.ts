import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The kit's element rules are unlayered, so they stand wherever the app
// declares nothing (issue 273). What neutralises them is read here.
const adapter = readFileSync(
  resolve(__dirname, '../../src/renderer/src/styles/figui-adapter.css'),
  'utf8',
)

describe("the adapter neutralises the kit's leaks", () => {
  it("resets the kit's section padding and margin", () => {
    expect(adapter).toMatch(/^section\s*\{[^}]*padding:\s*0;[^}]*margin:\s*0;/m)
  })
  it.each(['text', 'icon'])("maps the kit's %s on a disabled fill", (kind) => {
    expect(adapter).toMatch(
      new RegExp(`^\\s*--figma-color-${kind}-ondisabled:\\s*var\\(--text-faint\\);`, 'm'),
    )
  })
})
