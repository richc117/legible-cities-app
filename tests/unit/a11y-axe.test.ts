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
    const j = judgeAxe([violation('button-name', '#a')], [], 'Settings', known)
    expect(j.failures).toEqual(['button-name: #a'])
  })

  it('excuses the known rule on the known cards, and says so', () => {
    const v = violation('label-content-name-mismatch', 'li:nth-child(2) > .card', [CARD])
    const j = judgeAxe([v], [], 'Library', known)
    expect(j.failures).toEqual([])
    expect(j.stale).toEqual([])
    expect(j.excused).toEqual(['label-content-name-mismatch: li:nth-child(2) > .card (issue 707)'])
  })

  it('still fails the same rule on an element that is not a sample card', () => {
    const v = violation('label-content-name-mismatch', '#elsewhere', [])
    expect(judgeAxe([v], [], 'Library', known).failures).toEqual([
      'label-content-name-mismatch: #elsewhere',
    ])
  })

  it('still fails another rule on a sample card', () => {
    const v = violation('color-contrast', '.card', [CARD])
    expect(judgeAxe([v], [], 'Library', known).failures).toEqual(['color-contrast: .card'])
  })

  it('fails an entry that matched nothing on a sweep it is expected on', () => {
    const j = judgeAxe([], [], 'Library', known)
    expect(j.stale).toHaveLength(1)
    expect(j.stale[0]).toContain('issue 707')
  })

  it('does not ask for an entry on a sweep it is not expected on', () => {
    expect(judgeAxe([], [], 'Settings', known).stale).toEqual([])
  })

  it('lists incomplete results and never drops them', () => {
    const j = judgeAxe([], [violation('color-contrast', '#maybe')], 'Settings', known)
    expect(j.incomplete).toEqual(['color-contrast: #maybe'])
  })

  it('has the one entry the issue starts with', () => {
    expect(KNOWN_FINDINGS).toHaveLength(1)
    expect(KNOWN_FINDINGS[0]).toMatchObject({ rule: 'label-content-name-mismatch', issue: 707 })
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
