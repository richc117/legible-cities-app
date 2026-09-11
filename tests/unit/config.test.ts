import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeConfig, parseEnvFile, resolveConfig } from '../../src/main/config'
import { readFileSync } from 'node:fs'

// The app's LOOM pin, read rather than repeated, as the tests read the engine's.
const PIN = (
  JSON.parse(readFileSync(resolve(__dirname, '../../vendor/pins.json'), 'utf8')) as {
    loom: { commit: string }
  }
).loom.commit

// The default home is built with path.join and a relative value with
// path.resolve, so those expectations are too; an absolute value is kept
// verbatim on every platform (a rooted path counts as absolute on Windows).
const home = join('/ud', 'engine')

describe('parseEnvFile', () => {
  it('reads KEY=value, ignores comments and blanks, strips matching quotes', () => {
    const text = [
      '# a comment',
      '',
      'SCHEMATIC_HOME=/data/engine',
      "SCHEMATIC_FFMPEG='/opt/ffmpeg/bin/ffmpeg'",
      'SCHEMATIC_LOOM_BIN="/opt/loom"',
      'WEIRD=a=b=c',
      'NOEQUALS',
      '=novalue',
      '  SPACED  =  padded  ',
    ].join('\r\n')
    expect(parseEnvFile(text)).toEqual({
      SCHEMATIC_HOME: '/data/engine',
      SCHEMATIC_FFMPEG: '/opt/ffmpeg/bin/ffmpeg',
      SCHEMATIC_LOOM_BIN: '/opt/loom',
      WEIRD: 'a=b=c',
      SPACED: 'padded',
    })
  })
  it('does not interpolate', () => {
    expect(parseEnvFile('A=$HOME/x')).toEqual({ A: '$HOME/x' })
  })
})

describe('resolveConfig', () => {
  const base = { userData: '/ud', desktop: '/desk', loomPin: PIN, baseDir: '/repo' }

  it('defaults the home under userData and leaves the binaries unset', () => {
    const c = resolveConfig({ ...base, env: {} })
    expect(c.home).toBe(home)
    expect(c.loomBin).toBeNull()
    expect(c.ffmpeg).toBeNull()
    expect(c.loomCommit, 'no LOOM directory, no commit to report').toBeNull()
    expect(c.exportFolder).toBe(join('/desk', 'Legible Cities'))
    expect(c.sources.LEGIBLE_EXPORT_FOLDER).toBe('default')
    expect(c.engineCheckout).toBeNull()
    expect(c.fileFound).toBe(false)
    expect(c.sources.SCHEMATIC_HOME).toBe('default')
  })
  it('takes the file over the default and the environment over the file', () => {
    const c = resolveConfig({
      ...base,
      env: { SCHEMATIC_HOME: '/from-env' },
      fileText: 'SCHEMATIC_HOME=/from-file\nSCHEMATIC_FFMPEG=/file/ffmpeg\n',
    })
    expect(c.home).toBe('/from-env')
    expect(c.sources.SCHEMATIC_HOME).toBe('environment')
    expect(c.ffmpeg).toBe('/file/ffmpeg')
    expect(c.sources.SCHEMATIC_FFMPEG).toBe('.env.local')
    expect(c.fileFound).toBe(true)
  })
  it('treats an empty value as unset', () => {
    const c = resolveConfig({ ...base, env: { SCHEMATIC_HOME: '' }, fileText: 'SCHEMATIC_HOME=\n' })
    expect(c.home).toBe(home)
    expect(c.sources.SCHEMATIC_HOME).toBe('default')
  })
  it('resolves relative file values against the base directory', () => {
    const c = resolveConfig({ ...base, env: {}, fileText: 'LEGIBLE_ENGINE_CHECKOUT=../engine\n' })
    expect(c.engineCheckout).toBe(resolve('/repo', '../engine'))
  })
  it('names the LOOM commit only with a LOOM directory: the pin, unless a person says otherwise', () => {
    const withBin = resolveConfig({ ...base, env: { SCHEMATIC_LOOM_BIN: '/opt/loom' } })
    expect(withBin.loomCommit).toBe(PIN)
    expect(withBin.sources.SCHEMATIC_LOOM_COMMIT).toBe('default')
    const named = resolveConfig({
      ...base,
      env: { SCHEMATIC_LOOM_BIN: '/opt/loom' },
      fileText: 'SCHEMATIC_LOOM_COMMIT=abcdef0\n',
    })
    expect(named.loomCommit).toBe('abcdef0')
    expect(named.sources.SCHEMATIC_LOOM_COMMIT).toBe('.env.local')
    // The environment is not trimmed by a parser, so it is trimmed here; a
    // value that is only whitespace is no value and the pin stands.
    const spaced = resolveConfig({
      ...base,
      env: { SCHEMATIC_LOOM_BIN: '/opt/loom', SCHEMATIC_LOOM_COMMIT: ' abcdef0 ' },
    })
    expect(spaced.loomCommit).toBe('abcdef0')
    expect(spaced.sources.SCHEMATIC_LOOM_COMMIT).toBe('environment')
    const blank = resolveConfig({
      ...base,
      env: { SCHEMATIC_LOOM_BIN: '/opt/loom', SCHEMATIC_LOOM_COMMIT: '   ' },
    })
    expect(blank.loomCommit).toBe(PIN)
    expect(blank.sources.SCHEMATIC_LOOM_COMMIT).toBe('default')
    const alone = resolveConfig({ ...base, env: { SCHEMATIC_LOOM_COMMIT: 'abcdef0' } })
    expect(alone.loomCommit, 'a person who names a commit is believed').toBe('abcdef0')
  })
  it('reports unknown keys', () => {
    const c = resolveConfig({ ...base, env: {}, fileText: 'TYPO_KEY=1\nSCHEMATIC_HOME=/h\n' })
    expect(c.unknownKeys).toEqual(['TYPO_KEY'])
  })
})

describe('describeConfig', () => {
  const base = { userData: '/ud', desktop: '/desk', loomPin: PIN, baseDir: '/repo' }

  it('names every location and its source, and what is unset', () => {
    const c = resolveConfig({ ...base, env: {}, fileText: 'SCHEMATIC_LOOM_BIN=/opt/loom\n' })
    expect(describeConfig(c, { development: true })).toEqual([
      `SCHEMATIC_HOME=${home} (default)`,
      'SCHEMATIC_LOOM_BIN=/opt/loom (.env.local)',
      `SCHEMATIC_LOOM_COMMIT=${PIN} (default)`,
      'SCHEMATIC_FFMPEG unset - nothing in this build needs it; set it in .env.local',
      `LEGIBLE_EXPORT_FOLDER=${join('/desk', 'Legible Cities')} (default)`,
    ])
  })
  it('names the LOOM commit and its source only when there is one', () => {
    const c = resolveConfig({ ...base, env: { SCHEMATIC_LOOM_BIN: '/opt/loom' } })
    expect(describeConfig(c, { development: false })).toContain(
      `SCHEMATIC_LOOM_COMMIT=${PIN} (default)`,
    )
    const without = resolveConfig({ ...base, env: {} })
    expect(describeConfig(without, { development: false }).join('\n')).not.toContain(
      'SCHEMATIC_LOOM_COMMIT',
    )
  })
  it('says when the file is absent in development, and not in a packaged build', () => {
    const c = resolveConfig({ ...base, env: {} })
    expect(describeConfig(c, { development: true })).toContain(
      '.env.local not found; using defaults',
    )
    expect(describeConfig(c, { development: false })).not.toContain(
      '.env.local not found; using defaults',
    )
  })
  it('points at the environment, not the file, in a packaged build', () => {
    const c = resolveConfig({ ...base, env: {} })
    const lines = describeConfig(c, { development: false })
    expect(lines).toContain(
      'SCHEMATIC_LOOM_BIN unset - nothing in this build needs it; set it in the environment',
    )
    expect(lines.join('\n')).not.toContain('.env.local')
  })
  it('mentions the engine checkout only when set, and unknown keys', () => {
    const c = resolveConfig({
      ...base,
      env: {},
      fileText: 'LEGIBLE_ENGINE_CHECKOUT=/eng\nOOPS=1\n',
    })
    const lines = describeConfig(c, { development: true })
    expect(lines).toContain('LEGIBLE_ENGINE_CHECKOUT=/eng (.env.local)')
    expect(lines).toContain('.env.local: unknown key OOPS ignored')
  })
})

describe('LEGIBLE_ENGINE_PYTHON', () => {
  const base = { userData: '/ud', desktop: '/desk', loomPin: PIN, baseDir: '/repo' }

  it('is unset by default and absent from the log', () => {
    const c = resolveConfig({ ...base, env: {} })
    expect(c.enginePython).toBeNull()
    expect(c.sources.LEGIBLE_ENGINE_PYTHON).toBe('default')
    expect(describeConfig(c, { development: true }).join('\n')).not.toContain(
      'LEGIBLE_ENGINE_PYTHON',
    )
  })
  it('keeps a bare command name for the spawn to resolve', () => {
    const c = resolveConfig({ ...base, env: { LEGIBLE_ENGINE_PYTHON: 'python3' } })
    expect(c.enginePython).toBe('python3')
    expect(describeConfig(c, { development: false })).toContain(
      'LEGIBLE_ENGINE_PYTHON=python3 (environment)',
    )
  })
  it('resolves a relative path against the base directory and keeps an absolute one', () => {
    expect(
      resolveConfig({ ...base, fileText: 'LEGIBLE_ENGINE_PYTHON=.venv/bin/python', env: {} })
        .enginePython,
    ).toBe(resolve('/repo', '.venv/bin/python'))
    expect(
      resolveConfig({ ...base, env: { LEGIBLE_ENGINE_PYTHON: '/opt/py/bin/python3' } })
        .enginePython,
    ).toBe('/opt/py/bin/python3')
  })
  it('is a known key, not an unknown one', () => {
    const c = resolveConfig({ ...base, fileText: 'LEGIBLE_ENGINE_PYTHON=python', env: {} })
    expect(c.unknownKeys).toEqual([])
    expect(c.sources.LEGIBLE_ENGINE_PYTHON).toBe('.env.local')
  })
})
