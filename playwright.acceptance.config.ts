import { defineConfig } from '@playwright/test'

// The acceptance run over a release's installed app (A6-04,
// tests/acceptance/acceptance.spec.ts): one test, one worker, and deadlines
// long enough for a real Los Angeles layout and three real exports on a
// runner nobody has timed. Its own folder and its own config, so neither
// `npm run test:e2e` (tests/e2e) nor `npm test` (tests/unit) picks it up.
//
//   LEGIBLE_ACCEPTANCE_APP=<installed app> npm run test:acceptance
export default defineConfig({
  testDir: 'tests/acceptance',
  testMatch: '*.spec.ts',
  workers: 1,
  retries: 0,
  // The whole checklist. Every wait inside it has a deadline of its own.
  timeout: 5 * 60 * 60_000,
  expect: { timeout: 30_000 },
  // A press on a control that never becomes available fails in a minute
  // rather than at the end of the run.
  use: { actionTimeout: 60_000 },
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  // Beside the record, and not under test-results/, which `npm run test:e2e` empties.
  outputDir: 'acceptance-results/playwright-output',
})
