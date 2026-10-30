// A fixture for tests/unit/quarantine.test.ts, never run: a test tagged
// `@quarantine` and linked to no issue, which the test must refuse.
import { test } from '@playwright/test'

test('is quarantined for no issue', { tag: '@quarantine' }, async () => {})

test(
  'is quarantined for an annotation that is not an issue',
  { tag: ['@slow', '@quarantine'], annotation: { type: 'note', description: 'flaky' } },
  async () => {},
)
