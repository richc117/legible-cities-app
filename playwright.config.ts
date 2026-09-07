import { defineConfig } from '@playwright/test'

// Electron only: no browser projects, one application at a time. The test
// launches the built app from package.json's "main" (research.md section 3).
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: 'test-results',
})
