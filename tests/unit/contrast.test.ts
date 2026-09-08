// The design system is proven by arithmetic, not by eye: every text and
// control pair in contracts/tokens.md, in both themes, recomputed from the
// token files. A value that drifts, or a theme that forgets a token, fails
// here before anyone squints at a screen.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const styles = resolve(__dirname, '../../src/renderer/src/styles')
const tokens = readFileSync(resolve(styles, 'tokens.css'), 'utf8')
const theme = readFileSync(resolve(styles, 'theme.css'), 'utf8')

type Theme = 'dark' | 'sepia'
// The token files write the attribute with either quote (prettier prefers
// single quotes; the engine's copy keeps double).
const SELECTOR: Record<Theme, RegExp> = {
  dark: /:root\s*\{/g,
  sepia: /:root\[data-theme=["']sepia["']\]\s*\{/g,
}

/** The declarations of one selector's block, comments stripped. */
function block(css: string, selector: RegExp): Record<string, string> {
  const out: Record<string, string> = {}
  const pattern = new RegExp(selector.source, 'g')
  for (;;) {
    const match = pattern.exec(css)
    if (match === null) return out
    const start = match.index
    const open = css.indexOf('{', start)
    const close = css.indexOf('}', open)
    const body = css.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, '')
    for (const declaration of body.split(';')) {
      const colon = declaration.indexOf(':')
      if (colon === -1) continue
      out[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim()
    }
    pattern.lastIndex = close
  }
}

export function tokensFor(which: Theme): Record<string, string> {
  return { ...block(tokens, SELECTOR[which]), ...block(theme, SELECTOR[which]) }
}

/** A token's value with var() references followed to a colour literal. */
export function resolveToken(map: Record<string, string>, name: string): string {
  let value = map[name]
  for (let i = 0; i < 10 && value !== undefined; i++) {
    const ref = /^var\((--[a-z0-9-]+)\)$/.exec(value)
    if (!ref) return value
    value = map[ref[1]]
  }
  throw new Error(`token ${name} does not resolve to a value`)
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`not a six-digit hex colour: ${hex}`)
  const channel = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const n = parseInt(m[1], 16)
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

export function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// [foreground, background, minimum]. Text 4.5; controls and icons 3.0.
const PAIRS: [string, string, number][] = [
  ['--text', '--surface', 4.5],
  ['--text', '--surface-raised', 4.5],
  ['--text', '--surface-sunken', 4.5],
  ['--text', '--surface-hover', 4.5],
  ['--text', '--surface-selected', 4.5],
  ['--text-muted', '--surface', 4.5],
  ['--text-muted', '--surface-raised', 4.5],
  ['--text-muted', '--surface-sunken', 4.5],
  ['--text-muted', '--surface-selected', 4.5],
  ['--text-faint', '--surface', 4.5],
  ['--text-faint', '--surface-raised', 4.5],
  ['--text-faint', '--surface-hover', 4.5],
  ['--surface', '--error', 4.5],
  ['--accent-text', '--surface', 4.5],
  ['--accent-text', '--surface-raised', 4.5],
  ['--success-strong', '--surface', 4.5],
  ['--success-strong', '--surface-raised', 4.5],
  ['--warning', '--surface', 4.5],
  ['--warning', '--surface-raised', 4.5],
  ['--error', '--surface', 4.5],
  ['--error', '--surface-raised', 4.5],
  ['--border-strong', '--surface', 3.0],
  ['--border-strong', '--surface-raised', 3.0],
  ['--accent', '--surface', 3.0],
  ['--accent', '--surface-raised', 3.0],
  ['--success', '--surface', 3.0],
  ['--success', '--surface-raised', 3.0],
  ['--focus', '--surface', 3.0],
  ['--focus', '--surface-raised', 3.0],
]

// The document's stated ratios, read from its two tables (docs/DESIGN.md,
// section 3.1): the ramp against the theme's ground, and the semantic
// tokens against `--bg` unless the row says otherwise. The arithmetic is
// the authority; a number in the document that disagrees is corrected.
const design = readFileSync(resolve(__dirname, '../../docs/DESIGN.md'), 'utf8')

function stated(): { name: string; theme: Theme; against: string; ratio: number }[] {
  const out: { name: string; theme: Theme; against: string; ratio: number }[] = []
  const ramp = design.slice(design.indexOf('| Step | Warm-dark'), design.indexOf('**Tier 3'))
  for (const row of ramp.matchAll(
    /^\| (\d+) \| `#[0-9a-f]{6}` \| ([\d.]+) \| `#[0-9a-f]{6}` \| ([\d.]+) \|/gm,
  )) {
    out.push({ name: `--tone-${row[1]}`, theme: 'dark', against: '--bg', ratio: Number(row[2]) })
    out.push({ name: `--tone-${row[1]}`, theme: 'sepia', against: '--bg', ratio: Number(row[3]) })
  }
  const semantic = design.slice(design.indexOf('**Tier 3'), design.indexOf('Status colours are'))
  for (const row of semantic.matchAll(/^\| `(--[a-z-]+)` \| [^|]* \| ([^|]*) \| ([^|]*) \|/gm)) {
    const name = row[1]
    const against = name === '--on-accent' ? '--accent' : '--bg'
    for (const [theme, cell] of [
      ['dark', row[2]],
      ['sepia', row[3]],
    ] as [Theme, string][]) {
      const number = /(\d+\.\d\d)/.exec(cell)
      if (number) out.push({ name, theme, against, ratio: Number(number[1]) })
    }
  }
  return out
}

describe("the design document's stated ratios are the arithmetic's", () => {
  const rows = stated()
  it('reads the two tables', () => {
    expect(rows.length).toBeGreaterThan(30)
  })
  for (const { name, theme, against, ratio } of rows) {
    it(`${theme}: ${name} on ${against} is ${ratio.toFixed(2)}`, () => {
      const map = tokensFor(theme)
      const computed = contrast(resolveToken(map, name), resolveToken(map, against))
      expect(Number(computed.toFixed(2))).toBe(ratio)
    })
  }
})

describe('the design tokens clear WCAG AA in both themes', () => {
  for (const which of ['dark', 'sepia'] as Theme[]) {
    const map = tokensFor(which)
    describe(which, () => {
      for (const [fg, bg, minimum] of PAIRS) {
        it(`${fg} on ${bg} ≥ ${minimum}`, () => {
          const ratio = contrast(resolveToken(map, fg), resolveToken(map, bg))
          expect(
            ratio,
            `${fg} ${resolveToken(map, fg)} on ${bg} ${resolveToken(map, bg)}`,
          ).toBeGreaterThanOrEqual(minimum)
        })
      }
      it('text on the accent clears the pair the document states', () => {
        const ratio = contrast(resolveToken(map, '--on-accent'), resolveToken(map, '--accent'))
        expect(ratio).toBeGreaterThanOrEqual(which === 'dark' ? 4.5 : 3.0)
      })
      it('has every ramp step and every semantic token', () => {
        for (let i = 0; i < 12; i++)
          expect(map[`--tone-${i}`], `--tone-${i}`).toMatch(/^#[0-9a-f]{6}$/)
        for (const name of [
          '--surface',
          '--surface-raised',
          '--surface-sunken',
          '--surface-hover',
          '--surface-selected',
          '--border-strong',
          '--text-muted',
          '--text-faint',
          '--accent',
          '--accent-text',
          '--on-accent',
          '--success',
          '--success-strong',
          '--warning',
          '--error',
          '--selection',
        ])
          expect(map[name], name).toBeDefined()
      })
    })
  }
  it('the ramp runs from the background to the text in both themes', () => {
    for (const which of ['dark', 'sepia'] as Theme[]) {
      const map = tokensFor(which)
      expect(map['--tone-0']).toBe(resolveToken(map, '--bg'))
      expect(map['--tone-11']).toBe(resolveToken(map, '--text'))
    }
  })
})
