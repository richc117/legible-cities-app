// Every icon the interface can name resolves to a vendored file of the
// right weight, every vendored file is a plain SVG with no script, and the
// notice travels with them.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ICON_NAMES, iconMarkup } from '../../src/renderer/src/icons/Icon'

const dir = resolve(__dirname, '../../src/renderer/src/icons')

describe('icons', () => {
  it('resolve at both sizes, and the mark', () => {
    for (const name of ICON_NAMES) {
      expect(iconMarkup(name, 16), `${name} 16`).toMatch(/^<svg/)
      expect(iconMarkup(name, 24), `${name} 24`).toMatch(/^<svg/)
    }
    expect(iconMarkup('mark', 16)).toMatch(/^<svg/)
    expect(iconMarkup('play', 16, true)).toMatch(/^<svg/)
    expect(() => iconMarkup('train', 16, true)).toThrow('no icon file')
  })
  it('are plain SVG files with no script and currentColor only', () => {
    const files = readdirSync(join(dir, 'phosphor')).filter((f) => f.endsWith('.svg'))
    expect(files.length).toBeGreaterThan(30)
    for (const file of [...files.map((f) => join('phosphor', f)), 'mark.svg']) {
      const text = readFileSync(join(dir, file), 'utf8')
      expect(text, file).toMatch(/^<svg/)
      expect(text, file).not.toMatch(/<script|on[a-z]+=|javascript:/i)
      expect(text, file).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    }
  })
  it('carry the notice and say where they came from', () => {
    expect(existsSync(join(dir, 'phosphor', 'LICENSE'))).toBe(true)
    expect(readFileSync(join(dir, 'phosphor', 'LICENSE'), 'utf8')).toMatch(/MIT License/)
    expect(readFileSync(join(dir, 'phosphor', 'README.md'), 'utf8')).toMatch(
      /@phosphor-icons\/core.*2\.1\.1/,
    )
  })
})
