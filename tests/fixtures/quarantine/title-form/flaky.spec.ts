// A fixture for tests/unit/quarantine.test.ts, never run: the tag written
// in a title, and on a describe, which quarantines every test inside it.
// The cap counts tags, so neither may stand; the test must refuse both.
import { test } from '@playwright/test'

test('is quarantined in its title @quarantine', async () => {})

test.describe(
  'a group',
  {
    tag: '@quarantine',
    annotation: { type: 'issue', description: 'https://github.com/example/app/issues/2' },
  },
  () => {
    test('is quarantined with the whole group', async () => {})
    test('is quarantined in its title, in a group @quarantine', async () => {})
  },
)
