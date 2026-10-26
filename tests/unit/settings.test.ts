// The settings shape and its defensive reader, the theme's arithmetic and
// the sizes a person reads. All pure, all in Node: a settings file that has
// been half written, hand edited or written by a newer app must start the
// app, not stop it.

import { describe, expect, it } from 'vitest'
import {
  APP_THEMES,
  DEFAULT_SETTINGS,
  describeSize,
  formatBytes,
  isAppTheme,
  isStorableFolder,
  parseSettings,
  parseWindowBounds,
  SETTINGS_VERSION,
  themeAttribute,
  THEME_LABELS,
  type AppSettings,
} from '../../src/shared/settings'

// Built rather than written out: a literal machine path in a committed file
// is what bin/preflight refuses, and what this file would otherwise carry.
const posix = (...parts: string[]): string => '/' + parts.join('/')

describe('isAppTheme', () => {
  it('knows the three and nothing else', () => {
    for (const theme of APP_THEMES) expect(isAppTheme(theme)).toBe(true)
    for (const other of ['', 'dark', 'light', 'Sepia', null, 1, {}])
      expect(isAppTheme(other)).toBe(false)
  })
  it('has a word for each', () => {
    for (const theme of APP_THEMES) expect(THEME_LABELS[theme]).toBeTruthy()
  })
})

describe('isStorableFolder', () => {
  it('takes an absolute path on either platform', () => {
    expect(isStorableFolder(posix('people', 'someone', 'Maps'))).toBe(true)
    expect(isStorableFolder('C:\\Maps')).toBe(true)
    expect(isStorableFolder('C:/Maps')).toBe(true)
    expect(isStorableFolder('\\\\server\\share\\Maps')).toBe(true)
  })
  it('refuses a relative path, whatever it would be relative to', () => {
    for (const value of ['', 'Maps', './Maps', '../Maps', 'C:', '\\\\'])
      expect(isStorableFolder(value), value).toBe(false)
  })
  it('refuses a control character, a NUL and anything that is not a string', () => {
    expect(isStorableFolder(posix('Maps') + '\u0000etc')).toBe(false)
    expect(isStorableFolder(posix('Maps') + '\n')).toBe(false)
    expect(isStorableFolder(posix('a'.repeat(5000)))).toBe(false)
    for (const value of [null, undefined, 3, {}, [posix('Maps')]])
      expect(isStorableFolder(value)).toBe(false)
  })
})

describe('parseSettings', () => {
  const full: AppSettings = {
    version: SETTINGS_VERSION,
    engineFolder: posix('data', 'engine'),
    exportFolder: posix('data', 'exports'),
    theme: 'sepia',
    window: { x: -1200, y: 40, width: 1280, height: 800, maximized: false },
  }

  it('reads a whole file', () => {
    expect(parseSettings(JSON.parse(JSON.stringify(full)))).toEqual(full)
  })

  it('gives the defaults for anything that is not an object', () => {
    for (const json of [null, undefined, 3, 'text', [], [1, 2]])
      expect(parseSettings(json)).toEqual(DEFAULT_SETTINGS)
  })

  it('takes each field on its own: a bad one does not lose the rest', () => {
    const read = parseSettings({
      version: 1,
      engineFolder: 'relative/engine',
      exportFolder: full.exportFolder,
      theme: 'mauve',
    })
    expect(read.engineFolder, 'a relative folder is dropped').toBeNull()
    expect(read.exportFolder).toBe(full.exportFolder)
    expect(read.theme).toBe('system')
  })

  it('defaults a missing or impossible version, and keeps a newer one', () => {
    expect(parseSettings({}).version).toBe(SETTINGS_VERSION)
    expect(parseSettings({ version: 0 }).version).toBe(SETTINGS_VERSION)
    expect(parseSettings({ version: 1.5 }).version).toBe(SETTINGS_VERSION)
    expect(parseSettings({ version: 'two' }).version).toBe(SETTINGS_VERSION)
    expect(parseSettings({ version: 9 }).version, 'a newer file is still read').toBe(9)
  })

  it('never throws, whatever it is given', () => {
    const nasty = { version: {}, engineFolder: [], exportFolder: 0, theme: [] }
    expect(() => parseSettings(nasty)).not.toThrow()
    expect(parseSettings(nasty)).toEqual(DEFAULT_SETTINGS)
  })
  // Every file written before issue 549 has no window, and an older app
  // reads a newer file by dropping what it does not know.
  it('reads a file with no window as no window, and drops a key it does not know', () => {
    const before: Record<string, unknown> = { ...full }
    delete before.window
    expect(parseSettings(before)).toEqual({ ...full, window: null })
    expect(parseSettings({ ...full, sidebar: { open: true } })).toEqual(full)
  })

  it('reads a window of the wrong shape as none, and keeps everything else', () => {
    const good = full.window as NonNullable<AppSettings['window']>
    const wrong: unknown[] = [
      'left',
      7,
      [],
      [good.x, good.y, good.width, good.height],
      {},
      { ...good, x: '10' },
      { ...good, y: null },
      { ...good, width: 0 },
      { ...good, height: -480 },
      { ...good, width: 1280.5 },
      { ...good, x: Number.NaN },
      { ...good, y: Number.POSITIVE_INFINITY },
      { ...good, x: 1e12 },
      { ...good, maximized: 'yes' },
      { x: good.x, y: good.y, width: good.width, height: good.height },
    ]
    for (const window of wrong) {
      expect(() => parseSettings({ ...full, window }), JSON.stringify(window)).not.toThrow()
      expect(parseSettings({ ...full, window }), JSON.stringify(window)).toEqual({
        ...full,
        window: null,
      })
    }
  })

  it('reads a window whole, and carries nothing else that was beside it', () => {
    const good = full.window as NonNullable<AppSettings['window']>
    expect(parseWindowBounds({ ...good, display: 2 })).toEqual(good)
    expect(
      parseWindowBounds({ ...good, width: 1, height: 1 }),
      'a small one is raised later',
    ).toEqual({ ...good, width: 1, height: 1 })
  })
})

describe('themeAttribute', () => {
  it('names sepia and nothing for warm dark, which is the bare :root', () => {
    expect(themeAttribute('sepia', false)).toBe('sepia')
    expect(themeAttribute('sepia', true)).toBe('sepia')
    expect(themeAttribute('warm-dark', true)).toBeNull()
    expect(themeAttribute('warm-dark', false)).toBeNull()
  })
  it('follows the system when told to', () => {
    expect(themeAttribute('system', true)).toBe('sepia')
    expect(themeAttribute('system', false)).toBeNull()
  })
})

describe('formatBytes', () => {
  it('reads whole bytes below a kilobyte', () => {
    expect(formatBytes(0)).toBe('0 bytes')
    expect(formatBytes(1), 'one of anything is not plural').toBe('1 byte')
    expect(formatBytes(999)).toBe('999 bytes')
  })
  it('steps by a thousand, with one decimal', () => {
    expect(formatBytes(1000)).toBe('1.0 kB')
    expect(formatBytes(1234)).toBe('1.2 kB')
    expect(formatBytes(12_400_000)).toBe('12.4 MB')
    expect(formatBytes(3_000_000_000)).toBe('3.0 GB')
  })
  it('says nothing rather than NaN for a number that is not one', () => {
    expect(formatBytes(Number.NaN)).toBe('0 bytes')
    expect(formatBytes(-5)).toBe('0 bytes')
  })
})

describe('describeSize', () => {
  const size = { bytes: 0, files: 0, partial: false, missing: false }
  it('says empty for a folder that is not there, and why', () => {
    expect(describeSize({ ...size, missing: true })).toMatch(/not there/)
  })
  it('says empty for a folder with nothing in it', () => {
    expect(describeSize(size)).toBe('empty')
  })
  it('counts one file and many', () => {
    expect(describeSize({ ...size, bytes: 2048, files: 1 })).toBe('2.0 kB in 1 file')
    expect(describeSize({ ...size, bytes: 2048, files: 4 })).toBe('2.0 kB in 4 files')
  })
  it('says a capped walk is a floor', () => {
    expect(describeSize({ bytes: 1000, files: 2, partial: true, missing: false })).toMatch(
      /counted so far$/,
    )
  })
})
