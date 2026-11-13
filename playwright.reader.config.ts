import { defineConfig } from '@playwright/test'

// The scripted VoiceOver run over a release's installed app (issue 691,
// tests/reader/voiceover.spec.ts): one test, one worker, no retries, since
// a row heard on a second try says nothing about the first. Its own folder
// and its own config, so neither `npm run test:e2e` (tests/e2e) nor
// `npm test` (tests/unit) picks it up. It starts VoiceOver and takes the
// keyboard: run it on a hosted runner (acceptance.yml's `reader` job).
//
//   LEGIBLE_READER_APP=<installed app> npm run test:reader
export default defineConfig({
  testDir: 'tests/reader',
  testMatch: '*.spec.ts',
  workers: 1,
  retries: 0,
  // The whole walkthrough, with two real layouts and an export in it. Every
  // wait inside it has a deadline of its own.
  timeout: 2 * 60 * 60_000,
  expect: { timeout: 30_000 },
  use: { actionTimeout: 30_000 },
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  // Beside the transcript, and not under test-results/, which `npm run test:e2e` empties.
  outputDir: 'reader-results/playwright-output',
  captureGitInfo: { commit: false, diff: false },
})
