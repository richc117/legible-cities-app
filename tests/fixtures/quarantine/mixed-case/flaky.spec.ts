// A fixture for tests/unit/quarantine.test.ts, never run: the tag in a case
// of its own. Playwright's `--grep-invert` matches without regard to case, so
// this test is left out of the required suite and the scan must count it.
import { test } from '@playwright/test'

test(
  'is quarantined under a tag in mixed case',
  {
    tag: '@Quarantine',
    annotation: { type: 'issue', description: 'https://github.com/example/app/issues/3' },
  },
  async () => {},
)
