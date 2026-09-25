// Two things about the real generated page that only the real page can
// settle, and that this branch's documents claimed without checking.
//
//   1. The page still has every method the app names. If the engine renames
//      one, nothing else fails: the app just answers "this map cannot do
//      that" at run time, to a person, months later.
//   2. The policy the app serves generated pages with does not block
//      anything the page needs. `default-src 'none'` covers fonts, workers
//      and every fetch, and `script-src 'unsafe-inline'` does not allow
//      `eval` or `new Function`. A page that used any of them would lose
//      its typeface or its animation silently.
//   3. The page still starts at the speed and the play cell 03's transport
//      shows before anyone has pressed anything (A5.5-16). The seam cannot
//      be asked either of those (engine issue 29), so the app's controls
//      state the page's own defaults, and only the page can say whether
//      they are still its own. `animate.py` inlines present.js into every
//      generated page, so its fallbacks are in what is read here.
//
// Gated like the other real-engine tests: it needs a checkout whose layout
// cache is warm, and skips saying so without one. It reads a page the engine
// wrote; it does not run a browser, so what it proves about the policy is
// what the page *asks for*, not what Chromium then does with it. The
// end-to-end suite covers the second half by loading a page for real.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../../src/main/config'
import { PAGE_PLAYING, PAGE_SPEED } from '../../src/renderer/src/transportState'
import { VIEWER_METHODS } from '../../src/shared/viewer'

const repo = resolve(__dirname, '../..')

function checkout(): string | null {
  let fileText: string | undefined
  try {
    fileText = readFileSync(join(repo, '.env.local'), 'utf8')
  } catch {
    fileText = undefined
  }
  return resolveConfig({
    fileText,
    env: process.env,
    userData: tmpdir(),
    desktop: tmpdir(),
    loomPin: '',
    baseDir: repo,
  }).engineCheckout
}

const CHECKOUT = checkout()

/**
 * A page the engine has written **with this seam**. A checkout can hold
 * pages from before the seam existed, and testing one of those would say
 * nothing about today's engine, so the seam is the thing looked for.
 */
function generatedPage(): string | null {
  if (CHECKOUT === null) return null
  const out = join(CHECKOUT, 'out')
  if (!existsSync(out)) return null
  const walk = (dir: string, depth = 0): string | null => {
    if (depth > 2) return null
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isFile() && entry.name.endsWith('.html')) {
        if (readFileSync(path, 'utf8').includes('__present')) return path
      } else if (entry.isDirectory()) {
        const found = walk(path, depth + 1)
        if (found !== null) return found
      }
    }
    return null
  }
  return walk(out)
}

const PAGE = generatedPage()
const WHY =
  CHECKOUT === null
    ? ' (skipped: LEGIBLE_ENGINE_CHECKOUT names no engine)'
    : PAGE === null
      ? ' (skipped: the checkout has no page carrying the seam; run a map build once)'
      : ''

describe.skipIf(PAGE === null)(`the real generated page${WHY}`, () => {
  const html = PAGE === null ? '' : readFileSync(PAGE, 'utf8')

  it('still exposes every method the app names', () => {
    // The seam is written as `window.__present = { name(…) {…}, … }`, so each
    // method appears as a property at the start of a line in that object.
    for (const method of VIEWER_METHODS) {
      expect(html, `the page no longer has ${method}`).toMatch(
        new RegExp(`^\\s*${method}\\s*\\(`, 'm'),
      )
    }
  })

  // The five cell 03's transport is built on (A5.5-16), named here rather
  // than left to the loop above: that loop asserts the app's own list
  // against the page, so a branch that shrank `VIEWER_METHODS` would take
  // the assertion away with the method. These five are a feature's
  // dependency and are asserted whatever the list says.
  it('still has the five the transport drives', () => {
    for (const method of ['seek', 'setPlaying', 'setSpeed', 'bounds', 'state']) {
      expect(html, `the transport has no ${method} to drive`).toMatch(
        new RegExp(`^\\s*${method}\\s*\\(`, 'm'),
      )
    }
  })

  // The app's address names neither `speed` nor `play`, so what an
  // untouched page is doing is what present.js falls back to - and the
  // transport shows those two values before a person has pressed anything
  // (`PAGE_SPEED`, `PAGE_PLAYING` in `transportState.ts`). They are the
  // engine's numbers and not ours, and nothing else would fail if they
  // moved: the control would simply say the map was at a speed it was not.
  // present.js is inlined into every generated page, so this reads the
  // engine's own source.
  it('still starts at the speed and the play the app’s controls assume', () => {
    expect(PAGE_PLAYING, 'the page plays from load').toBe(true)
    expect(html, `present.js no longer defaults the speed to ${PAGE_SPEED}`).toMatch(
      new RegExp(`num\\(\\s*["']speed["']\\s*,\\s*${PAGE_SPEED}\\s*\\)`),
    )
    expect(html, 'present.js no longer defaults play to on').toMatch(
      /on\(\s*["']play["']\s*,\s*true\s*\)/,
    )
  })

  it('asks for nothing the project policy refuses', () => {
    // `default-src 'none'` means no font file, no worker, no fetch of a
    // sibling asset; `script-src 'unsafe-inline'` means no eval.
    expect(html, 'a web font would lose its typeface silently').not.toMatch(/@font-face/i)
    expect(html, 'a worker would be blocked').not.toMatch(/new\s+Worker\s*\(/)
    expect(html, 'eval is not allowed by the policy').not.toMatch(/\beval\s*\(/)
    expect(html, 'new Function is eval by another name').not.toMatch(/new\s+Function\s*\(/)
    // A fetch of a sibling asset would be refused; the page is one file.
    expect(html).not.toMatch(/\bfetch\s*\(/)
    expect(html).not.toMatch(/XMLHttpRequest/)
    // An external stylesheet or script would be refused too.
    expect(html).not.toMatch(/<link[^>]+rel=["']?stylesheet/i)
    expect(html).not.toMatch(/<script[^>]+\bsrc=/i)
  })

  it('is one self-contained file, which is why the policy allows inline', () => {
    expect(html).toMatch(/<script>/)
    expect(html).toMatch(/<style>/)
    expect(html.length).toBeGreaterThan(10_000)
  })
})
