// A fixture for tests/unit/quarantine.test.ts, never run: four tests
// quarantined, one more than the cap of three allows.
import { test } from '@playwright/test'

test(
  'quarantined number 11',
  {
    tag: '@quarantine',
    annotation: { type: 'issue', description: 'https://github.com/example/app/issues/11' },
  },
  async () => {},
)

test(
  'quarantined number 12',
  {
    tag: '@quarantine',
    annotation: { type: 'issue', description: 'https://github.com/example/app/issues/12' },
  },
  async () => {},
)

test(
  'quarantined number 13',
  {
    tag: '@quarantine',
    annotation: { type: 'issue', description: 'https://github.com/example/app/issues/13' },
  },
  async () => {},
)

test(
  'quarantined number 14',
  {
    tag: '@quarantine',
    annotation: { type: 'issue', description: 'https://github.com/example/app/issues/14' },
  },
  async () => {},
)
