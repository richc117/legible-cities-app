// A fixture for tests/unit/quarantine.test.ts, never run: one test
// quarantined as CONTRIBUTING.md asks, with the issue it is quarantined for.
import { test } from '@playwright/test'

test(
  'is quarantined for an issue',
  {
    tag: '@quarantine',
    annotation: { type: 'issue', description: 'https://github.com/example/app/issues/1' },
  },
  async () => {},
)

test('is not quarantined', async () => {})
