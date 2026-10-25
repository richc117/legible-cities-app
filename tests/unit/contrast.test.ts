// The design system is proven by arithmetic, not by eye: every text and
// control pair in contracts/tokens.md, in both themes, recomputed from the
// token files. A value that drifts, or a theme that forgets a token, fails
// here before anyone squints at a screen.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  contrast,
  resolveToken,
  stylesFolder as styles,
  tokensFor,
  type Theme,
} from '../support/colour'

// Only these four stylesheets are read here, for the rules the pairs below
// assume. The "which ground" rule over every stylesheet under styles/, the
// five region files included, is `contrast-scoping.test.ts`.
const adapter = readFileSync(resolve(styles, 'figui-adapter.css'), 'utf8')
const app = readFileSync(resolve(styles, 'app.css'), 'utf8')
const panels = readFileSync(resolve(styles, 'panels.css'), 'utf8')

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
  // Text and a mark under the pointer. Added for the tab strip (A5-01),
  // which the notebook replaced (A5.5-23). The first pair still has users -
  // a rail step's number under the pointer (A5.5-21) and a Library row's.
  // The second has none today and is kept as a guard: an --accent mark on
  // a hovered row is the next thing anyone would draw there.
  ['--text-muted', '--surface-hover', 4.5],
  ['--accent', '--surface-hover', 3.0],
  // A running rail step that is also the current one: its state word in
  // --accent-text on the current step's --surface-selected (A5.6-09; the
  // retheme darkened --accent-text by day for exactly this ground).
  ['--accent-text', '--surface-selected', 4.5],
  // And the same word under the pointer, on --surface-hover.
  ['--accent-text', '--surface-hover', 4.5],
  // The accessibility pass (A6-07). A primary button's text on its fill:
  // the kit's brand fill is --accent-text. That began as a workaround, for
  // an --on-accent that reached only 4.40 on the old sepia accent; the
  // retheme's cobalt clears 4.5 either way, and the mapping stays because
  // --accent-text is the darker of the two and costs nothing. The hover
  // and pressed fills are checked below.
  ['--on-accent', '--accent-text', 4.5],
  // A kit button unavailable while a confirmation's action runs keeps its
  // label readable: the kit's disabled text on its disabled fill. The same
  // pair is a front door card's empty picture area (ADR-047): the `train`
  // glyph in --text-faint on --surface-sunken, decorative, and held to the
  // text threshold all the same.
  ['--text-faint', '--surface-sunken', 4.5],
  // The New project card's plus, where a picture would be (ADR-047): a
  // glyph in the accent on the picture area's sunken ground. A sample's
  // chip is --text-muted on --surface-sunken, above.
  ['--accent', '--surface-sunken', 3.0],
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
  // --text-faint, the hint in --error, the running station's ring in
  // --accent, the rail in --border-strong and as much of it as the run has
  // covered in --text.
  //
  // The line order's drag (issue 283) adds none either: the grip's glyph is
  // --text-muted, and --text under the pointer, on --surface; the carried
  // row is --surface-raised with a --border-strong edge, and the place, the
  // name and the grip on it are --text-muted and --text. All are above.
  //
  // Nor do cell 04's theme cards (A7-13): a card is --surface-raised and
  // --surface-hover under the pointer, its word --text on both, its checked
  // edge --text on both (a control's edge needs 3.0 and has far more, so
  // the text pairs above hold it), its disabled word --text-faint on
  // --surface-raised, and its focus ring --focus on the ground the cell
  // sits on. The picture area is --surface-sunken with a --border edge, the
  // card's picture and not the interface's. All are above, and the section
  // at the end of this file holds the one thing the pairs cannot: that the
  // checked edge and the focus ring are different colours.
  //
  // The combobox (issue 272). Its field is the date control's pairs:
  // --text on --surface, a --border-strong edge on the form's
  // --surface-raised. Its popup's options are --text on --surface-raised,
  // --surface-hover under the pointer and --surface-selected highlighted,
  // all above. The highlighted option also carries an edge in --focus inside
  // it, so it is told apart by more than its ground: that mark on that
  // ground is the one pair it adds.
  ['--focus', '--surface-selected', 3.0],
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
    // A disabled primary: the kit keeps its own light-dark(#fff, #2c2c2c)
    // unless the adapter maps the token (issue 273).
    ['primary disabled', '--figma-color-text-ondisabled', '--figma-color-bg-disabled'],
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

// Cell 04's theme cards (A7-13, DESIGN.md 8.2). The checked card's edge is
// 2px of --text in place of its 1px --border, and the focus ring is --focus,
// which is --accent: the two are told apart by being different colours in
// both themes, and that is what choosing --text for the edge was for. The
// arithmetic cannot say it, so this does: the rules, and the tokens they
// resolve to. The same thing on the element, in both themes, is
// `tests/e2e/theme.spec.ts`.
describe('a checked theme card and a focused one are told apart (A7-13)', () => {
  const checked = rule(panels, '.theme-card:has(input:checked) {')
  const focused = rule(panels, '.theme-card:has(input:focus-visible) {')

  it('draws the checked edge in --text, twice as wide as the resting edge, never in --accent', () => {
    expect(checked).toMatch(/border:\s*calc\(2 \* var\(--border-width\)\) solid var\(--text\);/)
    expect(checked).not.toContain('--accent')
    expect(checked).not.toContain('--focus')
    // Taken from the card's own padding, so a checked card is its resting size.
    expect(checked).toMatch(/padding:\s*calc\(var\(--space-4-3\) - var\(--border-width\)\);/)
  })

  it('draws the focus ring on the card, in --focus, as the rest of the interface does', () => {
    expect(focused).toMatch(/outline:\s*var\(--focus-ring-width\) solid var\(--focus\);/)
    expect(focused).toMatch(/outline-offset:\s*var\(--focus-ring-offset\);/)
  })

  for (const which of ['dark', 'sepia'] as Theme[]) {
    it(`${which}: the edge and the ring are two colours, the edge clears 3.0 on a card in every state`, () => {
      const map = tokensFor(which)
      const edge = resolveToken(map, '--text')
      expect(edge, '--text is not the ring').not.toBe(resolveToken(map, '--focus'))
      // And not the accent either, which the ring is: if the two tokens ever
      // came apart, the edge would still be one of them.
      expect(edge).not.toBe(resolveToken(map, '--accent'))
      for (const ground of ['--surface-raised', '--surface-hover']) {
        expect(
          contrast(edge, resolveToken(map, ground)),
          `--text on ${ground}`,
        ).toBeGreaterThanOrEqual(3)
      }
    })
  }

  it('is held to the ratios the design document prints for it', () => {
    const printed =
      /\((\d+\.\d\d):1 on `--surface-raised` in Night, (\d+\.\d\d) in Parchment\)/.exec(design)
    expect(printed, 'DESIGN.md 8.2 prints the checked edge’s two ratios').not.toBeNull()
    const [night, parchment] = (['dark', 'sepia'] as Theme[]).map((which) => {
      const map = tokensFor(which)
      return contrast(resolveToken(map, '--text'), resolveToken(map, '--surface-raised')).toFixed(2)
    })
    expect([printed?.[1], printed?.[2]]).toEqual([night, parchment])
  })
})

// The cards share a row (A7-13). The kit's own stylesheet makes every
// `fieldset` a column flexbox with its children at their start, and a rule
// of the app's that leaves `display` out lets that stand: the div holding the
// cards then shrinks to its content and the grid repeats once, so the two
// stack in one narrow column. Every other fieldset of the app restates it.
// Where the cards land on the screen is `tests/e2e/theme.spec.ts`.
describe('the theme cards’ fieldset is not the kit’s column flexbox (A7-13)', () => {
  it('restates display, as the other fieldsets of the app do', () => {
    expect(rule(panels, '.theme-cards-group {')).toMatch(/display:\s*block;/)
    expect(rule(panels, '.theme-cards {')).toMatch(/display:\s*grid;/)
  })
})

// The two-tone ring (issue 436): a control drawn on a colour a person chose
// has an outline in --text and a band of --surface beside it, so that one of
// the two clears 3:1 on any colour at all. For any ground, the better of two
// colours is worst where they are equally far from it, at the square root of
// the ratio between them; so the pair is enough when that root is 3. The
// rule that draws it is held below.
describe('the two-tone ring clears 3:1 on any ground (issue 436)', () => {
  for (const which of ['dark', 'sepia'] as Theme[]) {
    it(`${which}: --text and --surface are far enough apart`, () => {
      const map = tokensFor(which)
      const between = contrast(resolveToken(map, '--text'), resolveToken(map, '--surface'))
      expect(
        Math.sqrt(between),
        `${between.toFixed(2)}:1 between ink and ground`,
      ).toBeGreaterThanOrEqual(3)
    })
    it(`${which}: the better of the two clears 3:1 on a spread of grounds`, () => {
      const map = tokensFor(which)
      const ink = resolveToken(map, '--text')
      const ground = resolveToken(map, '--surface')
      const worst = Math.min(
        ...[...Array(256).keys()]
          .filter((v) => v % 5 === 0)
          .map((v) => {
            const hex = `#${v.toString(16).padStart(2, '0').repeat(3)}`
            return Math.max(contrast(ink, hex), contrast(ground, hex))
          }),
      )
      expect(worst).toBeGreaterThanOrEqual(3)
    })
  }

  it('is what the colour picker draws on focus, both bands --focus-ring-width', () => {
    const picked = rule(panels, '.colour-picker .react-colorful__interactive:focus-visible {')
    expect(picked).toMatch(/outline:\s*var\(--focus-ring-width\) solid var\(--text\);/)
    expect(picked).toMatch(
      /box-shadow:\s*0 0 0 calc\(2 \* var\(--focus-ring-width\)\) var\(--surface\);/,
    )
  })
})
