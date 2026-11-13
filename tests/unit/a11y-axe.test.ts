// @vitest-environment jsdom
// The rule for what to do with axe's findings (issue 692): over made-up
// findings, since what only the running app shows - what axe finds on which
// screen - is the sweep's, in `tests/e2e/`.

import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  KNOWN_FINDINGS,
  judgeAxe,
  selectorsMatching,
  type AxeResult,
  type KnownFinding,
} from '../support/a11y-axe'

const CARD = 'ul[aria-label="Presets"] > li > button.card'
const known: KnownFinding[] = [
  { rule: 'label-content-name-mismatch', selector: CARD, issue: 707, expectedOn: ['Library'] },
]
const violation = (id: string, target: string, matches: string[] = []): AxeResult => ({
  id,
  impact: 'serious',
  nodes: [{ target: [target], matches }],
})

describe('judgeAxe', () => {
  it('fails a violation nothing excuses', () => {
    const j = judgeAxe(
      [violation('button-name', '#a')],
      [],
      { where: 'Settings', theme: 'Night' },
      known,
    )
    expect(j.failures).toEqual(['button-name: #a'])
  })

  it('excuses the known rule on the known cards, and says so', () => {
    const v = violation('label-content-name-mismatch', 'li:nth-child(2) > .card', [CARD])
    const j = judgeAxe([v], [], { where: 'Library', theme: 'Night' }, known)
    expect(j.failures).toEqual([])
    expect(j.stale).toEqual([])
    expect(j.excused).toEqual(['label-content-name-mismatch: li:nth-child(2) > .card (issue 707)'])
  })

  it('still fails the same rule on an element that is not a sample card', () => {
    const v = violation('label-content-name-mismatch', '#elsewhere', [])
    expect(judgeAxe([v], [], { where: 'Library', theme: 'Night' }, known).failures).toEqual([
      'label-content-name-mismatch: #elsewhere',
    ])
  })

  it('still fails another rule on a sample card', () => {
    const v = violation('color-contrast', '.card', [CARD])
    expect(judgeAxe([v], [], { where: 'Library', theme: 'Night' }, known).failures).toEqual([
      'color-contrast: .card',
    ])
  })

  it('fails an entry that matched nothing on a sweep it is expected on', () => {
    const j = judgeAxe([], [], { where: 'Library', theme: 'Night' }, known)
    expect(j.stale).toHaveLength(1)
    expect(j.stale[0]).toContain('issue 707')
  })

  it('does not ask for an entry on a sweep it is not expected on', () => {
    expect(judgeAxe([], [], { where: 'Settings', theme: 'Night' }, known).stale).toEqual([])
  })

  it('lists incomplete results and never drops them', () => {
    const j = judgeAxe(
      [],
      [violation('color-contrast', '#maybe')],
      { where: 'Settings', theme: 'Night' },
      known,
    )
    expect(j.incomplete).toEqual(['color-contrast: #maybe'])
  })

  it('judges an entry in its themes alone, for excuses and for staleness', () => {
    const night: KnownFinding[] = [
      {
        rule: 'color-contrast',
        selector: '.w',
        issue: 710,
        expectedOn: ['Screen'],
        themes: ['Night'],
      },
    ]
    const v = [violation('color-contrast', '#w', ['.w'])]
    expect(judgeAxe(v, [], { where: 'Screen', theme: 'Night' }, night).failures).toEqual([])
    expect(judgeAxe(v, [], { where: 'Screen', theme: 'Parchment' }, night).failures).toEqual([
      'color-contrast: #w',
    ])
    expect(judgeAxe([], [], { where: 'Screen', theme: 'Night' }, night).stale).toHaveLength(1)
    expect(judgeAxe([], [], { where: 'Screen', theme: 'Parchment' }, night).stale).toEqual([])
  })

  it('holds the list as it stands: label in name under 707, contrast under 710', () => {
    expect(KNOWN_FINDINGS.length).toBeGreaterThan(0)
    for (const k of KNOWN_FINDINGS) {
      if (k.rule === 'label-content-name-mismatch') expect(k.issue).toBe(707)
      else if (k.rule === 'color-contrast') expect(k.issue).toBe(710)
      else throw new Error(`${k.rule} is on the list with no decided issue`)
      expect(k.expectedOn.length).toBeGreaterThan(0)
    }
    // Contrast is Night's alone, and the project cards have an entry of their own.
    const contrast = KNOWN_FINDINGS.filter((k) => k.rule === 'color-contrast')
    expect(contrast.every((k) => k.themes?.join() === 'Night')).toBe(true)
    expect(KNOWN_FINDINGS.some((k) => k.selector.includes('Projects'))).toBe(true)
  })
})

describe('selectorsMatching', () => {
  const page = (html: string): Document => new DOMParser().parseFromString(html, 'text/html')
  const CARD_SELECTOR = 'ul[aria-label="Presets"] > li > button.card'

  it('names the selectors the one element matches', () => {
    const d = page('<ul aria-label="Presets"><li><button class="card" id="a">x</button></li></ul>')
    expect(selectorsMatching(d, '#a', [CARD_SELECTOR, 'p'])).toEqual([CARD_SELECTOR])
  })

  it('gives nothing for an element that is not a sample card', () => {
    const d = page('<ul aria-label="Projects"><li><button class="card" id="a">x</button></li></ul>')
    expect(selectorsMatching(d, '#a', [CARD_SELECTOR])).toEqual([])
  })

  it('gives nothing when the selector names several elements', () => {
    const d = page(
      '<ul aria-label="Presets"><li><button class="card">x</button></li>' +
        '<li><button class="card">y</button></li></ul><p class="card">z</p>',
    )
    expect(selectorsMatching(d, '.card', [CARD_SELECTOR])).toEqual([])
  })

  it('gives nothing when the selector names none, or does not parse', () => {
    const d = page('<p id="a">x</p>')
    expect(selectorsMatching(d, '#missing', ['p'])).toEqual([])
    expect(selectorsMatching(d, '((', ['p'])).toEqual([])
  })
})

describe('the sweeps a known finding is expected on', () => {
  const dir = resolve(__dirname, '../e2e')
  const labels = new Set<string>()
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const text = readFileSync(resolve(dir, file), 'utf8')
    for (const m of text.matchAll(/sweep\(\s*page,\s*(['"])(.*?)\1/g)) labels.add(m[2])
  }

  it('each is the label of a sweep under tests/e2e', () => {
    expect(labels.size).toBeGreaterThan(10)
    for (const entry of KNOWN_FINDINGS) {
      for (const where of entry.expectedOn) {
        expect(labels.has(where), `no sweep(page, '${where}'`).toBe(true)
      }
    }
  })
})
