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
// The page is one a checkout's engine wrote, where a checkout is named and
// holds one carrying the seam; otherwise the engine the interpreter runs
// draws one now, by map.build from the BART layout the determinism fixture
// commits, in a home seeded from it. Without either it skips, saying so,
// unless the determinism workflow opted in, where that fails. It reads the
// page; it does not run a browser, so what it proves about the policy is
// what the page *asks for*, not what Chromium then does with it. The
// end-to-end suite covers the second half by loading a page for real.

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pagePath, prepareProject, seedHome } from '../support/determinism'
import {
  ENGINE_TEST_MS,
  NO_ENGINE,
  enginePageTemplate,
  failIfRequired,
  localConfig,
  realInterpreter,
} from '../support/real-engine'
import { PAGE_PLAYING, PAGE_SPEED } from '../../src/renderer/src/transportState'
import { PAGE_SEAMS, VIEWER_METHODS } from '../../src/shared/viewer'

const CONFIG = localConfig()
const CHECKOUT = CONFIG.engineCheckout
const INTERPRETER = realInterpreter(CONFIG)

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
/** Where the page comes from: the checkout's, else one drawn now from the fixture. */
const SOURCE = PAGE !== null ? 'checkout' : INTERPRETER !== null ? 'fixture' : null
const WHY = SOURCE === null ? NO_ENGINE : ''

failIfRequired('the real generated page', SOURCE === null, 'no engine')

const made: string[] = []

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

/**
 * A page the engine draws now: the determinism fixture's project, drawn by
 * map.build from the fixture's stored layout in a home seeded from it,
 * which is the page the determinism test exports. Nothing is laid out and
 * nothing is downloaded.
 */
async function fixturePage(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'lc-viewer-real-'))
  made.push(dir)
  const home = join(dir, 'engine')
  seedHome(home)
  await prepareProject(INTERPRETER as string, home)
  return readFileSync(pagePath(home), 'utf8')
}

/**
 * The page template of the engine the seam is held to: the checkout's where
 * one is named, else the installed engine's, found through the interpreter.
 * The determinism workflow has no checkout, so this is how a check of the
 * template runs there too.
 */
const ENGINE_TEMPLATE =
  CHECKOUT === null && INTERPRETER === null ? null : enginePageTemplate(CHECKOUT, INTERPRETER)

describe.skipIf(CHECKOUT === null && INTERPRETER === null)(
  `the engine's page template${CHECKOUT === null && INTERPRETER === null ? NO_ENGINE : ''}`,
  () => {
    it('is found where the engine keeps it, and writes the seam as one object', () => {
      expect(ENGINE_TEMPLATE, 'no page.html in the checkout or the installed engine').not.toBeNull()
      const html = readFileSync(ENGINE_TEMPLATE as string, 'utf8')
      expect(html, 'the template no longer writes window.__present as one object').toContain(
        'window.__present = {',
      )
    })
  },
)

describe.skipIf(SOURCE === null)(`the real generated page${WHY}`, () => {
  let html = ''

  beforeAll(async () => {
    html = PAGE !== null ? readFileSync(PAGE, 'utf8') : await fixturePage()
  }, ENGINE_TEST_MS)

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

  // A press in cell 04 restyles the page in place through `setTheme`
  // instead of reloading the frame (issue 349), and the project's theme is
  // given to every page on load as the restore's first call. Both rest on
  // engine v0.11.0 (its issue 29): `setTheme(name)`, and `theme` in
  // `state()`. Named here rather than left to the loop above, for the same
  // reason as the five before it: that loop asserts the app's own list
  // against the page, so a branch that took `setTheme` out of the list
  // would take the assertion away with it. A page the engine wrote before
  // v0.11.0 fails this by design - rebuild the checkout's map to see it pass.
  it('still has setTheme, and still says which theme it is in', () => {
    expect(html, 'the page no longer has setTheme').toMatch(/^\s*setTheme\s*\(/m)
    // `state()` returns one object literal; `theme` is a key of it.
    expect(html, 'state() no longer reports the theme').toMatch(
      /^\s*state\s*\(\s*\)\s*\{[^}]*\btheme\s*:/m,
    )
  })

  // Cell 03's Trip section asks the page for a trip through `setTrip` and a
  // reloaded page is given its trip back by the same call (issue 272, spec
  // 030 FR-005 and FR-009). Both rest on engine v0.13.0 (its issue 49):
  // `setTrip(from, to)`, and `trip` in `state()`, which the restore reads to
  // know what to give back. Named here for the reason the two before it are:
  // the loop above asserts the app's own list, and would lose the assertion
  // with the method. A page the engine wrote before v0.13.0 fails this by
  // design - rebuild the checkout's map to see it pass.
  it('still has setTrip, and still says which trip it is showing', () => {
    expect(html, 'the page no longer has setTrip').toMatch(/^\s*setTrip\s*\(/m)
    expect(html, 'state() no longer reports the trip').toMatch(
      /^\s*state\s*\(\s*\)\s*\{[^}]*\btrip\s*:/m,
    )
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

/**
 * The engine's own page template at the checkout, which every page it draws
 * is made from. The pages under `out` may be from any engine the checkout
 * has been since they were drawn, which is the very thing the next test is
 * about, so the template is read rather than a page.
 */
function pageTemplate(): string | null {
  if (CHECKOUT === null) return null
  const path = join(CHECKOUT, 'src', 'schematic', 'page', 'page.html')
  return existsSync(path) ? path : null
}

const TEMPLATE = pageTemplate()
const TEMPLATE_WHY =
  CHECKOUT === null
    ? ' (skipped: LEGIBLE_ENGINE_CHECKOUT names no engine)'
    : TEMPLATE === null
      ? ' (skipped: the checkout has no page template where the engine keeps it)'
      : ''

// A page lacking any seam the pinned engine's page has is one an older engine
// drew, and is redrawn when its project opens (issue 465). That rests on
// `PAGE_SEAMS` being the pinned page's seam exactly: a method the engine adds
// and the list does not name would leave every page drawn before it judged
// current, and a method the list names and the engine has dropped would have
// every page redrawn on every open. So the two are held method for method, in
// both directions, against the template at the checkout, which is the pin's
// when `LEGIBLE_ENGINE_CHECKOUT` names the worktree `scripts/pin-engine.sh`
// makes.
describe.skipIf(TEMPLATE === null)(`the pinned engine's page template${TEMPLATE_WHY}`, () => {
  const html = TEMPLATE === null ? '' : readFileSync(TEMPLATE, 'utf8')

  it('has exactly the seam PAGE_SEAMS names', () => {
    const start = html.indexOf('window.__present = {')
    expect(start, 'the template no longer writes window.__present as one object').toBeGreaterThan(
      -1,
    )
    const end = html.indexOf('\n  };', start)
    expect(end, 'the seam object no longer closes where it did').toBeGreaterThan(start)
    // Each method of the object literal is a line at its first indentation,
    // a name and its parameters; everything inside a method is deeper.
    const methods = [...html.slice(start, end).matchAll(/^ {4}([A-Za-z_$][\w$]*)\s*\(/gm)].map(
      (m) => m[1],
    )
    expect(methods.length, 'the seam was read').toBeGreaterThan(10)
    expect([...methods].sort()).toEqual([...PAGE_SEAMS].sort())
  })
})
