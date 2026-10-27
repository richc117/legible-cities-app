import { defineConfig } from 'vitest/config'

// The tests that start a real Vitest of their own, wait for a test to be
// inside it, or send signals (`*.live.test.ts`; today the mutation job's,
// tests/unit/mutations-runner.live.test.ts). They are kept out of `npm test`
// (vitest.config.ts excludes them) and run as a step of their own:
// `npm run test:live`. One file at a time and no retry: a retry would turn
// the race a test exists to expose into a pass.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.live.test.ts'],
    environment: 'node',
    // The same budgets as vitest.config.ts, which explains them.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    retry: 0,
    fileParallelism: false,
  },
})
