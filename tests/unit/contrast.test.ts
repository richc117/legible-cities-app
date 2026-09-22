// The design system is proven by arithmetic, not by eye: every text and
// control pair in contracts/tokens.md, in both themes, recomputed from the
// token files. A value that drifts, or a theme that forgets a token, fails
// here before anyone squints at a screen.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const styles = resolve(__dirname, '../../src/renderer/src/styles')
// theme.css alone, because theme.css alone is what the app loads: the
// engine page's tokens.css is a drift-tested record nothing imports
// (ADR-044). Merging it here would let a token theme.css forgets resolve
// to the engine's old value and pass.
const theme = readFileSync(resolve(styles, 'theme.css'), 'utf8')
const adapter = readFileSync(resolve(styles, 'figui-adapter.css'), 'utf8')
const app = readFileSync(resolve(styles, 'app.css'), 'utf8')

type Theme = 'dark' | 'sepia'
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
  // A cell's state (ADR-045, section 8.2) adds no pair: its word is
  // --text-muted, --accent-text, --warning or --error on --surface or
  // --surface-raised, all above, and the running station's ring is --accent
  // at 3.0 as a mark rather than text. A state drawn in any other colour, or
  // on any other ground, adds its pair here.
  // The tab strip (A5-01): a tab not chosen, under the pointer, and the
  // chosen tab's underline there too. On the panel's own ground the tabs
  // and the export tab's switches use pairs already above: --text and
  // --text-muted for a tab, --accent for the underline and a checkbox,
  // --text-faint for a switch an export holds.
  ['--text-muted', '--surface-hover', 4.5],
  ['--accent', '--surface-hover', 3.0],
  // The accessibility pass (A6-07). A primary button's text on its fill:
  // the kit's brand fill is --accent-text. That began as a workaround, for
  // an --on-accent that reached only 4.40 on the old sepia accent; the
  // retheme's cobalt clears 4.5 either way, and the mapping stays because
  // --accent-text is the darker of the two and costs nothing. The hover
  // and pressed fills are checked below.
  ['--on-accent', '--accent-text', 4.5],
  // A kit button unavailable while a confirmation's action runs keeps its
  // label readable: the kit's disabled text on its disabled fill.
  ['--text-faint', '--surface-sunken', 4.5],
  // A kit text field's placeholder, on the field's raised fill, is
  // --text-faint on --surface-raised, above; its resting edge, and the
  // select's, the checkbox's and the date control's, --border-strong on
  // --surface and --surface-raised, above too. The focus ring is drawn
  // outside the control at an offset, so it always sits on the ground the
  // control does: --focus on --surface and --surface-raised, above. The one
  // control whose ring lies over something else is "Skip past the map"
  // (issue 106), over the engine's page in the project's theme; it carries
  // a --surface halo under its ring, so the pair is still --focus on
  // --surface.
  //
  // The inspector (A1-03) adds no pair of its own. Beside the main region
  // it sits on --surface, and over it on a narrow window on
  // --surface-raised, and every pair it uses is above on both grounds: a
  // job's title and the disclosure's summary in --text, its label and
  // detail in --text-muted, its time and the progress line's labels in
  // --text-faint, the hint in --error, the running mark in --accent and the
  // line in --border-strong.
]

/**
 * A colour the adapter mixes, `color-mix(in srgb, var(--a) N%, var(--b))`,
 * as the six-digit hex Chromium paints for two opaque colours: each channel
 * interpolated in sRGB and rounded.
 */
export function resolveMix(map: Record<string, string>, value: string): string {
  const m = /^color-mix\(in srgb, var\((--[a-z0-9-]+)\) (\d+)%, var\((--[a-z0-9-]+)\)\)$/.exec(
    value,
  )
  if (!m) return resolveToken({ ...map, __value: value }, '__value')
  const a = parseInt(resolveToken(map, m[1]).slice(1), 16)
  const b = parseInt(resolveToken(map, m[3]).slice(1), 16)
  const p = Number(m[2]) / 100
  const channel = (shift: number): string =>
    Math.round(((a >> shift) & 255) * p + ((b >> shift) & 255) * (1 - p))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(16)}${channel(8)}${channel(0)}`
}

/** One declaration of the adapter's token mapping, which is the same for both themes. */
function mapping(name: string): string {
  const m = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(adapter)
  if (!m) throw new Error(`the adapter does not map ${name}`)
  return m[1].trim()
}

/** The declarations of the first rule whose selector list starts with this text. */
function rule(css: string, selector: string): string {
  const at = css.indexOf(selector)
  if (at === -1) throw new Error(`no rule for ${selector}`)
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
}

describe("the kit's filled buttons hold their text in both themes (A6-07)", () => {
  const fills: [string, string, string][] = [
    ['primary', '--figma-color-text-onbrand', '--figma-color-bg-brand'],
    ['primary under the pointer', '--figma-color-text-onbrand', '--figma-color-bg-brand-hover'],
    ['primary pressed', '--figma-color-text-onbrand', '--figma-color-bg-brand-pressed'],
    ['destructive', '--figma-color-text-ondanger', '--figma-color-bg-danger'],
    [
      'destructive under the pointer',
      '--figma-color-text-ondanger',
      '--figma-color-bg-danger-hover',
    ],
    ['destructive pressed', '--figma-color-text-ondanger', '--figma-color-bg-danger-pressed'],
  ]
  for (const which of ['dark', 'sepia'] as Theme[]) {
    const map = tokensFor(which)
    for (const [what, text, fill] of fills) {
      it(`${which}: ${what} ≥ 4.5`, () => {
        const fg = resolveMix(map, mapping(text))
        const bg = resolveMix(map, mapping(fill))
        expect(contrast(fg, bg), `${text} ${fg} on ${fill} ${bg}`).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})

describe('the resting edges and the placeholder the pairs above assume (A6-07)', () => {
  it('draws a text field, a select, a checkbox and the date control with --border-strong', () => {
    expect(rule(adapter, 'fig-input-text:not(:focus-within)')).toContain('var(--border-strong)')
    expect(rule(adapter, 'fig-dropdown > select')).toContain('var(--border-strong)')
    expect(rule(adapter, "input[type='checkbox']:not(.switch):not(:checked)")).toContain(
      'var(--border-strong)',
    )
    expect(rule(app, ".field input[type='date'] {")).toContain('var(--border-strong)')
  })
  it("gives a kit field's placeholder the faint text token", () => {
    expect(rule(adapter, 'fig-input-text input::placeholder')).toContain('var(--text-faint)')
  })
})

// The document's stated ratios, read from its two tables (docs/DESIGN.md,
// section 3.1): the ramp against the theme's ground, and the semantic
// tokens against `--bg` unless the row says otherwise. The arithmetic is
// the authority; a number in the document that disagrees is corrected.
const design = readFileSync(resolve(__dirname, '../../docs/DESIGN.md'), 'utf8')

function stated(): { name: string; theme: Theme; against: string; ratio: number }[] {
  const out: { name: string; theme: Theme; against: string; ratio: number }[] = []
  const ramp = design.slice(design.indexOf('| Step | Night'), design.indexOf('**Tier 3'))
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
      // Both themes now, where the light one was allowed 3.0 while its
      // accent managed 4.40 under the ground (ADR-044).
      it('text on the accent clears 4.5', () => {
        const ratio = contrast(resolveToken(map, '--on-accent'), resolveToken(map, '--accent'))
        expect(ratio).toBeGreaterThanOrEqual(4.5)
      })
      it('has every ramp step and every semantic token', () => {
        for (let i = 0; i < 12; i++)
          expect(map[`--tone-${i}`], `--tone-${i}`).toMatch(/^#[0-9a-f]{6}$/)
        for (const name of [
          // The ground and ink this file owns since ADR-044. --border is
          // here because nothing else reaches it: every other one is
          // resolved through a pair or a surface above, so a theme that
          // dropped it would paint every divider in currentColor with a
          // green suite. The identity six are here for the same reason -
          // nothing consumes them yet, so only this holds the two blocks
          // symmetric.
          '--bg',
          '--bg-soft',
          '--text',
          '--muted',
          '--border',
          '--focus',
          '--line-vermilion',
          '--line-cobalt',
          '--line-saffron',
          '--line-jade',
          '--station-fill',
          '--station-ink',
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
