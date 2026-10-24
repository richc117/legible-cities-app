// An empty message takes no room, but an empty live region is not taken out
// of the accessibility tree (issue 466, after issue 330).
//
// `.message:empty { display: none }` removed a live region from the tree
// whenever it was empty, and Settings' licence line is one. A region that is
// absent when its text arrives is "inserted with text", which a screen reader
// announces unreliably, and the pass through empty an announcer makes was no
// pass at all. jsdom would not help: it computes no layout and this suite
// runs in node, so the rule is judged as text: which selectors reach a
// `display: none`, and that the live region the screen draws carries what
// those selectors turn on.
//
// Mutation, watched failing: the old rule put back, `.message:empty {
// display: none; }` in place of the two rules; the first and the second test
// fail, on the `display: none` rule matching a live region and on there
// being no rule that keeps an empty one laid out.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = resolve(__dirname, '../../src/renderer/src')
const css = readFileSync(resolve(src, 'styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Every rule whose selector mentions `.message:empty`, as selector and body. */
const rules = [...css.matchAll(/([^{}]*\.message:empty[^{}]*)\{([^}]*)\}/g)].map((m) => ({
  selector: m[1].trim(),
  body: m[2],
}))

const hidesWithDisplay = (body: string): boolean => /display:\s*none/.test(body)

describe('an empty message', () => {
  it('is display: none only where it is not a live region', () => {
    const hiding = rules.filter((rule) => hidesWithDisplay(rule.body))
    expect(hiding.length, 'a non-live empty message takes no room').toBeGreaterThan(0)
    for (const rule of hiding) {
      // Excluded by its own selector: the `:not(...)` names both ways a
      // region is live here, and a bare `.message:empty` would not.
      const excluded = /:not\(([^)]*)\)/.exec(rule.selector)?.[1] ?? ''
      expect(excluded, `${rule.selector} matches a status region`).toContain("[role='status']")
      expect(excluded, `${rule.selector} matches an aria-live region`).toContain('[aria-live]')
    }
  })

  it('stays laid out in the tree when it is a live region, out of the flow', () => {
    const live = rules.filter(
      (rule) => !hidesWithDisplay(rule.body) && /\[role='status'\]/.test(rule.selector),
    )
    expect(live, 'a rule for the empty live region').toHaveLength(1)
    expect(live[0].selector).toContain('[aria-live]')
    // Out of the flow like `.visually-hidden`, so it adds no gap in a flex
    // or grid parent, and drawn at no size and clipped, so nothing shows.
    expect(live[0].body).toMatch(/position:\s*absolute/)
    expect(live[0].body).toMatch(/clip-path:\s*inset\(50%\)/)
  })

  it("is what Settings' licence line is: a message, a status region, aria-live", () => {
    const settings = readFileSync(resolve(src, 'Settings.tsx'), 'utf8')
    expect(settings).toMatch(
      /<LiveRegion region=\{licenceLine\} className="message" role="status" aria-live="polite" \/>/,
    )
  })
})
