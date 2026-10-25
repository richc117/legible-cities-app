// The design system's colour arithmetic, shared by the two unit tests that
// hold it: `tests/unit/contrast.test.ts` (the pairs) and
// `tests/unit/contrast-scoping.test.ts` (which ground each colour may be
// drawn on). Read from theme.css alone, because theme.css alone is what the
// app loads: the engine page's tokens.css is a drift-tested record nothing
// imports (ADR-044). Merging it in would let a token theme.css forgets
// resolve to the engine's old value and pass.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const stylesFolder = resolve(__dirname, '../../src/renderer/src/styles')

export type Theme = 'dark' | 'sepia'
export const THEMES: Theme[] = ['dark', 'sepia']

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

const theme = readFileSync(resolve(stylesFolder, 'theme.css'), 'utf8')

export function tokensFor(which: Theme): Record<string, string> {
  return block(theme, SELECTOR[which])
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
