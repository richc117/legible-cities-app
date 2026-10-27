import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// Two projects, and `npm test` runs both (ADR-059). A file's name says where
// it runs: `*.browser.test.tsx` in Chromium, every other test in Node.
//
// - `unit`: Node, as the suite always has. A rendered test opts into jsdom
//   with `// @vitest-environment jsdom` as its first line and renders
//   through `tests/support/render.tsx`; `tests/support/dom-setup.ts` stubs
//   what jsdom lacks and the app reaches, one named global.
// - `browser`: Playwright's Chromium, headless, through Vitest's browser
//   mode - not Electron, and not the end-to-end suite. It is for the tests
//   about what the kit does with focus, a popover or layout, which jsdom
//   cannot show, and it is kept small. Where the browser is missing, the
//   provider fails with Playwright's own install command (`npx playwright
//   install chromium`): a failure, never a skip.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    // Vitest's own defaults are 5s for a test and 10s for a hook, which
    // this suite never chose and which are not enough for it. Seventeen of
    // its files do real work - git repositories, temporary trees, packaged
    // app layouts - and Windows charges for every process it spawns:
    // release.test.ts's "drafts for a tag on main that has not moved" runs
    // in 311ms here and timed out at 5s on a Windows runner (issue 147),
    // a multiplier over sixteen, while check-vendored's packaged-app test
    // went the same way in the same run. Both passed when the identical
    // commit was re-run, which is what a budget that is a coin flip looks
    // like.
    //
    // 30s is measured, not picked: the slowest honest test in the suite is
    // 2.4s locally, so this is a twelvefold margin on the worst case and a
    // far larger one on the spawn-heavy tests that actually lost. A test
    // that hangs still fails, just not in a way that depends on which
    // runner it landed on. The *-real tests keep their own longer
    // timeouts, which win over this.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Both projects take the two budgets above and the JSX transform.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          exclude: ['tests/unit/**/*.browser.test.tsx'],
          environment: 'node',
          setupFiles: ['tests/support/dom-setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['tests/unit/**/*.browser.test.tsx'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            screenshotFailures: false,
          },
        },
      },
    ],
  },
})
