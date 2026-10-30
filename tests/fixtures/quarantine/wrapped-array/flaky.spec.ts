// A fixture for tests/unit/quarantine.test.ts, never run: the tag in an array
// wrapped over several lines, which has the tag on a line of its own (prettier would join them).
import { test } from '@playwright/test'

test(
  'is quarantined in a wrapped array',
  {
    // prettier-ignore
    tag: [
      '@slow',
      '@quarantine',
    ],
    annotation: { type: 'issue', description: 'https://github.com/example/app/issues/4' },
  },
  async () => {},
)
