import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeConfig, parseEnvFile, resolveConfig } from '../../src/main/config'

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
  const base = { userData: '/ud', baseDir: '/repo' }

  it('defaults the home under userData and leaves the binaries unset', () => {
    const c = resolveConfig({ ...base, env: {} })
    expect(c.home).toBe(home)
    expect(c.loomBin).toBeNull()
    expect(c.ffmpeg).toBeNull()
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
  it('reports unknown keys', () => {
    const c = resolveConfig({ ...base, env: {}, fileText: 'TYPO_KEY=1\nSCHEMATIC_HOME=/h\n' })
    expect(c.unknownKeys).toEqual(['TYPO_KEY'])
  })
})

describe('describeConfig', () => {
  const base = { userData: '/ud', baseDir: '/repo' }

  it('names every location and its source, and what is unset', () => {
    const c = resolveConfig({ ...base, env: {}, fileText: 'SCHEMATIC_LOOM_BIN=/opt/loom\n' })
    expect(describeConfig(c, { development: true })).toEqual([
      `SCHEMATIC_HOME=${home} (default)`,
      'SCHEMATIC_LOOM_BIN=/opt/loom (.env.local)',
      'SCHEMATIC_FFMPEG unset - nothing in this build needs it; set it in .env.local',
    ])
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
