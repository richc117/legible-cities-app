// "Which ground a colour may be drawn on" (docs/DESIGN.md, section 3.1), held
// in every stylesheet (issue 436, R10-02).
//
// The pair list in `contrast.test.ts` is sufficient only through that rule:
// five colours fall short of their threshold on some of the five grounds,
// and the list holds them on the two grounds that are safe. Nothing used to
// enforce the rule, and the contrast test read four of the nine stylesheets
// that draw anything. This test reads every `.css` file under `styles/`
// (the folder is listed, so a new region file is read without anyone
// remembering to add it) and does three things.
//
// 1. It holds the document's rule to the arithmetic, both ways: every
//    ground the rule allows clears the threshold in both themes, and every
//    ground it forbids fails in one of them or is named below as forbidden
//    out of caution and really does clear it. The numbers the document
//    prints are checked too.
// 2. It finds every use of the five restricted colours in the stylesheets
//    and refuses one whose ground nobody has stated: `GROUNDS` is that
//    statement, one line per rule, and a new use of --error, --warning,
//    --text-faint, --success-strong or --border-strong fails here until it
//    has a line. A line left behind for a rule that is gone fails too.
// 3. It holds each statement to the rule: the grounds a line names must be
//    ones every restricted colour that rule uses may be drawn on, and a rule
//    that paints its own ground must have named that one.
//
// **What it cannot prove.** Which ground a rule's element sits on depends on
// the element's ancestors and on the component that uses the class, which a
// stylesheet does not say. The statements in `GROUNDS` are claims, read from
// the components and reviewed; what is enforced is that a claim exists, that
// it is within the rule, and that a rule's own ground agrees with it. That the
// element in the running app really sits where the claim says is a check on
// the DOM, which this repository's unit layer has no place for yet (spec
// 038, FR-010), so it is not made here.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrast, resolveToken, THEMES, tokensFor, type Theme } from '../support/colour'
import { rulesOf, stylesheets, type Rule } from '../support/css-rules'

type Ground = 'surface' | 'raised' | 'sunken' | 'hover' | 'selected'
const GROUND_TOKEN: Record<Ground, string> = {
  surface: '--surface',
  raised: '--surface-raised',
  sunken: '--surface-sunken',
  hover: '--surface-hover',
  selected: '--surface-selected',
}
const GROUNDS_ALL = Object.keys(GROUND_TOKEN) as Ground[]

/** The colours the document restricts, and the contrast each must reach. */
const THRESHOLD: Record<string, number> = {
  '--error': 4.5,
  '--warning': 4.5,
  '--text-faint': 4.5,
  '--success-strong': 4.5,
  '--border-strong': 3.0,
}

/** The document's rule: where each restricted colour may be drawn. */
const ALLOWED: Record<string, Ground[]> = {
  '--error': ['surface', 'raised'],
  '--warning': ['surface', 'raised'],
  '--border-strong': ['surface', 'raised'],
  '--text-faint': ['surface', 'raised', 'sunken', 'hover'],
  '--success-strong': ['surface', 'raised', 'sunken', 'hover'],
}

/**
 * Grounds the rule forbids although the arithmetic would let them through,
 * because the document states the narrow rule that holds on every ground in
 * both themes and a colour that happens to clear a threshold on the hover
 * ground is not a reason to widen it. Each is checked to really clear.
 */
const FORBIDDEN_OUT_OF_CAUTION: Record<string, Ground[]> = {
  '--warning': ['hover'],
  '--border-strong': ['hover'],
}

/** The colours the document says clear their threshold on every ground. */
const EVERYWHERE: Record<string, number> = {
  '--text': 4.5,
  '--text-muted': 4.5,
  '--accent-text': 4.5,
  '--accent': 3.0,
  '--focus': 3.0,
}

/** The figures the document prints in that section: [token, ground, theme, figure]. */
const PRINTED: [string, Ground, Theme, string][] = [
  ['--error', 'sunken', 'dark', '4.03'],
  ['--error', 'selected', 'dark', '3.51'],
  ['--border-strong', 'sunken', 'sepia', '2.99'],
  ['--text-faint', 'selected', 'dark', '3.93'],
  ['--text-faint', 'selected', 'sepia', '4.18'],
  ['--success-strong', 'selected', 'sepia', '4.13'],
  ['--success-strong', 'selected', 'dark', '5.13'],
  ['--text-faint', 'sunken', 'dark', '4.51'],
  ['--text-faint', 'sunken', 'sepia', '4.59'],
]

const ratio = (theme: Theme, token: string, ground: Ground): number => {
  const map = tokensFor(theme)
  return contrast(resolveToken(map, token), resolveToken(map, GROUND_TOKEN[ground]))
}
const clears = (token: string, ground: Ground, minimum: number): boolean =>
  THEMES.every((theme) => ratio(theme, token, ground) >= minimum)

const design = readFileSync(resolve(__dirname, '../../docs/DESIGN.md'), 'utf8')
const section = design.slice(
  design.indexOf('**Which ground a colour may be drawn on.**'),
  design.indexOf('**Tier 4, component tokens**'),
)

describe("the document's rule against the arithmetic (docs/DESIGN.md 3.1)", () => {
  it('has the section it is held to', () => {
    expect(section.length, 'the rule’s section is found').toBeGreaterThan(200)
  })

  for (const [token, grounds] of Object.entries(ALLOWED)) {
    for (const ground of grounds) {
      it(`${token} clears ${THRESHOLD[token]} on ${ground} in both themes`, () => {
        for (const theme of THEMES)
          expect(
            ratio(theme, token, ground),
            `${theme}: ${token} on ${GROUND_TOKEN[ground]}`,
          ).toBeGreaterThanOrEqual(THRESHOLD[token])
      })
    }
    for (const ground of GROUNDS_ALL.filter((g) => !grounds.includes(g))) {
      const cautious = FORBIDDEN_OUT_OF_CAUTION[token]?.includes(ground) === true
      it(
        cautious
          ? `${token} is kept off ${ground} though it clears there (the rule is the narrow one)`
          : `${token} falls short on ${ground} in at least one theme`,
        () => {
          expect(clears(token, ground, THRESHOLD[token])).toBe(cautious)
        },
      )
    }
  }

  for (const [token, minimum] of Object.entries(EVERYWHERE))
    it(`${token} clears ${minimum} on every ground in both themes`, () => {
      for (const ground of GROUNDS_ALL)
        for (const theme of THEMES)
          expect(
            ratio(theme, token, ground),
            `${theme}: ${token} on ${GROUND_TOKEN[ground]}`,
          ).toBeGreaterThanOrEqual(minimum)
    })

  for (const [token, ground, theme, figure] of PRINTED)
    it(`prints ${figure} for ${token} on ${ground} in ${theme}, as the arithmetic has it`, () => {
      expect(ratio(theme, token, ground).toFixed(2)).toBe(figure)
      expect(section, `the document prints ${figure}`).toContain(figure)
    })
})

// ---------------------------------------------------------------------------
// The statements. One line per rule that draws with a restricted colour:
// `file :: selector`, and `:: property` as well where the declaration is a
// custom property (the kit's names in figui-adapter.css, which are consumed
// wherever the kit draws them). A selector list is written as its first
// selector and the count of the rest, `(+2)`. Grounds are where the rule's
// element is drawn, read from the components that use it:
//
// - surface: the window and a cell (`.cell` is --surface), the header, the
//   rail, the settings page.
// - raised: a dialog, a popover, a card, the inspector over a narrow window,
//   a form in a dialog, a cell row under the pointer.
// - hover: a row under the pointer (`.entry`).
// - sunken: a field's disabled fill, a well, a card's picture area.
//
// A rule that holds its own ground says it, and it is checked below.

const GROUNDS: Record<string, Ground[]> = {
  // The header and the shell.
  "app.css :: .engine-status[data-state='restarting'] .icon": ['surface'],
  "app.css :: .engine-status[data-state='unavailable'] .icon (+2)": ['surface'],
  // The inspector sits on --surface beside the main region and on
  // --surface-raised over it on a narrow window.
  'app.css :: .job-meta': ['surface', 'raised'],
  'app.css :: .job .message.error': ['surface', 'raised'],
  // A library row, and the same row under the pointer.
  'app.css :: .entry-meta': ['surface', 'raised', 'hover'],
  'app.css :: .message.error': ['surface', 'raised'],
  'app.css :: .notice.error': ['surface', 'raised'],
  'app.css :: .settings .pending': ['surface'],
  // The date control and the combobox's field: the edge is drawn on the
  // form's ground, a cell's or a dialog's, around the field's own --surface.
  "app.css :: .field input[type='date']": ['surface', 'raised'],
  "app.css :: .field input[type='date']:disabled": ['surface'],
  'app.css :: .combobox input': ['surface', 'raised'],
  // The progress line, in a cell and in a job of the inspector.
  'app.css :: .progress .line': ['surface', 'raised'],
  'app.css :: .progress .core': ['surface', 'raised'],
  'app.css :: .progress .mark-pending': ['surface', 'raised'],
  'app.css :: .progress .mark-failed': ['surface', 'raised'],
  'app.css :: .progress .label': ['surface', 'raised'],

  // The kit's names. A fill, a text or an edge is drawn by a kit control the
  // app puts in a cell or a dialog; the filled pairs are held by the contrast
  // test, and a disabled control's label is --text-faint on --surface-sunken
  // (its fill), which the document holds.
  'figui-adapter.css :: :root (+12) :: --figma-color-bg-danger': ['surface', 'raised'],
  'figui-adapter.css :: :root (+12) :: --figma-color-bg-danger-hover': ['surface', 'raised'],
  'figui-adapter.css :: :root (+12) :: --figma-color-bg-danger-pressed': ['surface', 'raised'],
  'figui-adapter.css :: :root (+12) :: --figma-color-bg-warning': ['surface', 'raised'],
  'figui-adapter.css :: :root (+12) :: --figma-color-text-tertiary': ['surface', 'raised'],
  'figui-adapter.css :: :root (+12) :: --figma-color-text-disabled': [
    'surface',
    'raised',
    'sunken',
  ],
  'figui-adapter.css :: :root (+12) :: --figma-color-text-ondisabled': [
    'surface',
    'raised',
    'sunken',
  ],
  'figui-adapter.css :: :root (+12) :: --figma-color-text-danger': ['surface', 'raised'],
  'figui-adapter.css :: :root (+12) :: --figma-color-text-warning': ['surface', 'raised'],
  'figui-adapter.css :: :root (+12) :: --figma-color-text-success': ['surface', 'raised'],
  'figui-adapter.css :: :root (+12) :: --figma-color-icon-tertiary': ['surface', 'raised'],
  'figui-adapter.css :: :root (+12) :: --figma-color-icon-disabled': [
    'surface',
    'raised',
    'sunken',
  ],
  'figui-adapter.css :: :root (+12) :: --figma-color-icon-ondisabled': [
    'surface',
    'raised',
    'sunken',
  ],
  'figui-adapter.css :: :root (+12) :: --figma-color-icon-danger': ['surface', 'raised'],
  'figui-adapter.css :: :root (+12) :: --figma-color-icon-warning': ['surface', 'raised'],
  'figui-adapter.css :: :root (+12) :: --figma-color-border-strong': ['surface', 'raised'],
  'figui-adapter.css :: :root (+12) :: --figma-color-border-danger': ['surface', 'raised'],
  'figui-adapter.css :: :root (+12) :: --figma-color-border-danger-strong': ['surface', 'raised'],
  // The resting edges the kit does not draw: a text field's host, a select
  // and a checkbox, on a cell's or a dialog's ground.
  'figui-adapter.css :: fig-input-text:not(:focus-within):not(:hover)': ['surface', 'raised'],
  'figui-adapter.css :: fig-dropdown > select': ['surface', 'raised'],
  "figui-adapter.css :: input[type='checkbox']:not(.switch):not(:checked) (+1)": [
    'surface',
    'raised',
  ],
  // A kit button unavailable keeps its label on the sunken fill it points
  // the fill tokens at.
  'figui-adapter.css :: fig-button[data-unavailable] :: --figma-color-text': ['sunken'],
  'figui-adapter.css :: fig-button[data-unavailable] :: --figma-color-text-onbrand': ['sunken'],
  'figui-adapter.css :: fig-button[data-unavailable] :: --figma-color-text-onbrand-secondary': [
    'sunken',
  ],
  'figui-adapter.css :: fig-button[data-unavailable] :: --figma-color-text-ondanger': ['sunken'],
  'figui-adapter.css :: fig-button[data-unavailable] :: --figma-color-text-ondanger-secondary': [
    'sunken',
  ],
  // A placeholder is drawn on the field's raised fill (DESIGN.md 3.1).
  'figui-adapter.css :: fig-input-text input::placeholder': ['raised'],

  // A cell's state word: on the cell's row, --surface, and --surface-raised
  // under the pointer.
  "notebook.css :: .cell[data-state='stale'] .cell-state": ['surface', 'raised'],
  "notebook.css :: .cell[data-state='error'] .cell-state": ['surface', 'raised'],

  // The carried row has its own ground and a control's edge around it.
  'panels.css :: .line-row-group[data-dragged]': ['raised'],
  // A line's chip, in its row on the cell's ground.
  'panels.css :: .colour-chip': ['surface', 'raised'],
  // A hidden line's words, on the cell's ground ("4.5 on the cell's ground").
  'panels.css :: .line-row-group[data-hidden] .line-name (+2)': ['surface'],
  'panels.css :: .card-picture': ['sunken'],
  "panels.css :: .histogram tr[data-kept='false'] td": ['surface'],
  'panels.css :: .explain-trigger': ['surface', 'raised'],
  'panels.css :: .export-choices textarea': ['surface', 'raised'],
  'panels.css :: .export-choices textarea:disabled': ['sunken'],
  'panels.css :: .check:has(input:disabled)': ['surface', 'raised'],
  'panels.css :: .theme-card:has(input:disabled) (+1)': ['raised'],

  // The rail is --surface. A step under the pointer or the current one, the
  // two grounds the colours are not allowed on, are given --text-muted by the
  // rules that follow these (rail.css), and are held by the cases below.
  "rail.css :: .rail-step[data-state='stale'] .rail-state": ['surface'],
  "rail.css :: .rail-step[data-state='error'] .rail-state": ['surface'],
  'rail.css :: .output-gone': ['surface'],
}

// ---------------------------------------------------------------------------

interface Use {
  key: string
  rule: Rule
  tokens: string[]
  /** The ground the rule's own `background` paints, when it paints one. */
  paints: Ground | null
  /** Whether a foreground property (text, fill, stroke) takes a restricted colour. */
  foreground: boolean
}

/** A selector list as its first selector and the count of the rest. */
function labelOf(selector: string): string {
  const parts: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) {
      parts.push(selector.slice(from, i).trim())
      from = i + 1
    }
  }
  parts.push(selector.slice(from).trim())
  return parts.length === 1 ? parts[0] : `${parts[0]} (+${parts.length - 1})`
}

const TOKEN_FILES = new Set(['theme.css', 'tokens.css', 'scale.css'])
const RESTRICTED = Object.keys(ALLOWED)

function uses(): Use[] {
  const out = new Map<string, Use>()
  for (const file of stylesheets()) {
    if (TOKEN_FILES.has(file)) continue
    for (const rule of rulesOf(file)) {
      const painted = rule.declarations.find((d) => /^background(-color)?$/.test(d.property))
      const paintedWith = /^var\((--surface[a-z-]*)\)$/.exec(painted?.value ?? '')?.[1]
      const paints = GROUNDS_ALL.find((g) => GROUND_TOKEN[g] === paintedWith) ?? null
      for (const d of rule.declarations) {
        const tokens = RESTRICTED.filter((t) => new RegExp(`var\\(${t}\\)`).test(d.value))
        if (tokens.length === 0) continue
        const custom = d.property.startsWith('--')
        const key = `${file} :: ${labelOf(rule.selector)}${custom ? ` :: ${d.property}` : ''}`
        const seen = out.get(key)
        const foreground = /^(color|fill|stroke)$/.test(d.property) || custom
        if (seen) {
          seen.tokens = [...new Set([...seen.tokens, ...tokens])]
          seen.foreground ||= foreground
        } else out.set(key, { key, rule, tokens, paints, foreground })
      }
    }
  }
  return [...out.values()]
}

describe('the stylesheets are read, all of them', () => {
  it('lists the folder, and finds rules in every one', () => {
    const files = stylesheets()
    // The five region files the contrast test does not read, by name, so
    // that the folder being read is not only the four it does.
    for (const region of ['export.css', 'notebook.css', 'preview.css', 'project.css', 'rail.css'])
      expect(files, region).toContain(region)
    for (const file of files) expect(rulesOf(file).length, file).toBeGreaterThan(0)
  })
})

describe('every use of a restricted colour has a stated ground', () => {
  const found = uses()

  it('finds the uses (a reader that finds none would pass everything)', () => {
    expect(found.length).toBeGreaterThan(40)
    expect(new Set(found.map((u) => u.rule.file)).size).toBeGreaterThanOrEqual(5)
  })

  it('has a line in GROUNDS for each, and none for a rule that is gone', () => {
    const keys = found.map((u) => u.key)
    expect(
      keys.filter((key) => GROUNDS[key] === undefined),
      'a restricted colour is used where no ground is stated: add the rule to GROUNDS with the ground it is drawn on',
    ).toEqual([])
    expect(
      Object.keys(GROUNDS).filter((key) => !keys.includes(key)),
      'a statement about a rule that no longer uses a restricted colour',
    ).toEqual([])
  })

  it('states grounds every colour the rule uses may be drawn on', () => {
    const wrong: string[] = []
    for (const use of found) {
      const stated = GROUNDS[use.key] ?? []
      if (stated.length === 0) wrong.push(`${use.key}: no ground`)
      for (const token of use.tokens)
        for (const ground of stated)
          if (!ALLOWED[token].includes(ground))
            wrong.push(`${use.key}: ${token} is not to be drawn on ${ground}`)
    }
    expect(wrong).toEqual([])
  })

  it("agrees with a rule's own ground where it paints one", () => {
    const wrong: string[] = []
    for (const use of found) {
      if (use.paints === null) continue
      const stated = GROUNDS[use.key] ?? []
      // Inside the edge, whatever the rule draws.
      for (const token of use.tokens)
        if (!ALLOWED[token].includes(use.paints))
          wrong.push(`${use.key}: ${token} on its own ${use.paints} ground`)
      // A text, fill or stroke is drawn on that ground and nothing else; an
      // edge is drawn between it and what surrounds it, so is left to the claim.
      if (use.foreground && (stated.length !== 1 || stated[0] !== use.paints))
        wrong.push(`${use.key}: paints ${use.paints} but states ${stated.join(', ')}`)
    }
    expect(wrong).toEqual([])
  })
})

describe('the rail gives the two grounds it forbids a plain colour (rail.css)', () => {
  // `--warning` and `--error` are stated on --surface for a rail step's state
  // word, which is true at rest. The step under the pointer is --surface-hover
  // and the current one --surface-selected, grounds neither may be drawn on,
  // so a rule for each takes the word back to --text-muted. This holds those
  // rules: delete them and the claim above is false with the test green.
  const rules = rulesOf('rail.css')
  const colourOf = (selector: RegExp): string | undefined =>
    rules
      .filter((r) => selector.test(r.selector))
      .flatMap((r) => r.declarations)
      .find((d) => d.property === 'color')?.value

  it('on hover', () => {
    expect(colourOf(/\.rail-step:hover\[data-state='stale'\] \.rail-state/)).toBe(
      'var(--text-muted)',
    )
    expect(colourOf(/\.rail-step:hover\[data-state='error'\] \.rail-state/)).toBe(
      'var(--text-muted)',
    )
  })
  it('on the current step', () => {
    expect(colourOf(/\.rail-step\[aria-current='step'\]\[data-state='stale'\] \.rail-state/)).toBe(
      'var(--text-muted)',
    )
    expect(colourOf(/\.rail-step\[aria-current='step'\]\[data-state='error'\] \.rail-state/)).toBe(
      'var(--text-muted)',
    )
  })
})
