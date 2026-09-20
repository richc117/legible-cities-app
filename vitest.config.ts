import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    environment: 'node',
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
  },
})
