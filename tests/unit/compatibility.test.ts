// What docs/compatibility.md ("What 1.0 keeps") says in a sentence about the
// settings file, held to the code that does it, so that changing the
// behaviour changes the document in the same pull request.
//
// The document's other promise, that a record from a later version opens
// read-only and is never written, is held where the store is tested, and
// `compatibility.mutations.json` runs those tests against the guard
// (`readOnly: version > RECORD_VERSION` in `src/main/record/parse.ts`):
//   - projects-store.test.ts, "marks a record from a later version read-only"
//   - projects-store.test.ts, "refuses a record from a later version and
//     leaves it as it was"
// What an earlier build keeps of a record's unknown keys is
// record-carries.test.ts.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SETTINGS_FILE, SettingsStore } from '../../src/main/settings'
import { parseSettings } from '../../src/shared/settings'

// Keys no build has: stand-ins for whatever a later 1.x adds to settings.json.
const LATER = { sidebar: { open: true }, density: 'compact' }

describe('the settings file, as "Your settings" describes it', () => {
  it('reads the settings it knows and none that it does not', () => {
    const read = parseSettings({ version: 1, theme: 'sepia', ...LATER })
    expect(Object.keys(read).sort()).toEqual(
      ['engineFolder', 'exportFolder', 'theme', 'version', 'window'].sort(),
    )
    expect(read.theme).toBe('sepia')
  })

  describe('on disk', () => {
    let dir: string
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'legible-cities-compat-'))
    })
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true })
    })

    it('leaves out a setting it does not know when it saves, and keeps the ones it does', async () => {
      const file = join(dir, SETTINGS_FILE)
      await writeFile(file, JSON.stringify({ version: 1, theme: 'sepia', ...LATER }))
      const store = new SettingsStore(dir, () => undefined)
      await store.update((stored) => ({ ...stored, engineFolder: null, theme: 'warm-dark' }))
      const written = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
      expect(Object.keys(written).sort()).toEqual(
        ['engineFolder', 'exportFolder', 'theme', 'version', 'window'].sort(),
      )
      expect(written.theme).toBe('warm-dark')
    })
  })
})
