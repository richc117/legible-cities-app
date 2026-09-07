// Which interpreter runs the engine, in what order it is looked for, and
// what environment it gets. Pure functions; every platform's path shape.

import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { engineCommand, engineEnvironment, resolveInterpreter } from '../../src/main/interpreter'

const existing =
  (...paths: string[]) =>
  (p: string) =>
    paths.includes(p)
const base = { resourcesPath: '/app/resources', platform: 'darwin' as const }

describe('resolveInterpreter', () => {
  it('takes an explicit key first, as a path or as a command name', () => {
    expect(
      resolveInterpreter({
        ...base,
        packaged: false,
        config: { enginePython: '/opt/py/bin/python3', engineCheckout: '/eng' },
        exists: existing('/opt/py/bin/python3', join('/eng', '.venv', 'bin', 'python')),
      }),
    ).toEqual({ interpreter: '/opt/py/bin/python3', origin: 'LEGIBLE_ENGINE_PYTHON' })
    expect(
      resolveInterpreter({
        ...base,
        packaged: true,
        config: { enginePython: 'python3', engineCheckout: null },
        exists: () => false,
      }),
    ).toEqual({ interpreter: 'python3', origin: 'LEGIBLE_ENGINE_PYTHON' })
  })
  it('refuses an explicit path that does not exist, naming the key and not the path', () => {
    const r = resolveInterpreter({
      ...base,
      packaged: false,
      config: { enginePython: '/nowhere/python', engineCheckout: '/eng' },
      exists: existing(join('/eng', '.venv', 'bin', 'python')),
    })
    expect(r.interpreter).toBeNull()
    if (r.interpreter === null) {
      expect(r.reason).toContain('LEGIBLE_ENGINE_PYTHON')
      expect(r.reason).not.toContain('/nowhere')
      expect(r.detail).toContain('/nowhere/python')
    }
  })
  it('uses the checkout venv in development, with the Windows layout on win32', () => {
    expect(
      resolveInterpreter({
        ...base,
        packaged: false,
        config: { enginePython: null, engineCheckout: '/eng' },
        exists: existing(join('/eng', '.venv', 'bin', 'python')),
      }),
    ).toEqual({ interpreter: join('/eng', '.venv', 'bin', 'python'), origin: 'engine checkout' })
    const windows = join('C:\\eng', '.venv', 'Scripts', 'python.exe')
    expect(
      resolveInterpreter({
        ...base,
        platform: 'win32',
        packaged: false,
        config: { enginePython: null, engineCheckout: 'C:\\eng' },
        exists: existing(windows),
      }),
    ).toEqual({ interpreter: windows, origin: 'engine checkout' })
  })
  it('says what to do when development has no checkout or the checkout has no venv', () => {
    const none = resolveInterpreter({
      ...base,
      packaged: false,
      config: { enginePython: null, engineCheckout: null },
      exists: () => false,
    })
    expect(none.interpreter).toBeNull()
    if (none.interpreter === null) expect(none.reason).toContain('LEGIBLE_ENGINE_CHECKOUT')
    const noVenv = resolveInterpreter({
      ...base,
      packaged: false,
      config: { enginePython: null, engineCheckout: '/eng' },
      exists: () => false,
    })
    expect(noVenv.interpreter).toBeNull()
    if (noVenv.interpreter === null) {
      expect(noVenv.reason).toContain('uv venv')
      expect(noVenv.reason).not.toContain('/eng')
      expect(noVenv.detail).toContain(join('/eng', '.venv'))
    }
  })
  it('uses the bundled runtime when packaged and never the checkout', () => {
    const bundled = join('/app/resources', 'python', 'bin', 'python3')
    expect(
      resolveInterpreter({
        ...base,
        packaged: true,
        config: { enginePython: null, engineCheckout: '/eng' },
        exists: existing(bundled, join('/eng', '.venv', 'bin', 'python')),
      }),
    ).toEqual({ interpreter: bundled, origin: 'bundled runtime' })
    expect(
      resolveInterpreter({
        ...base,
        platform: 'win32',
        packaged: true,
        config: { enginePython: null, engineCheckout: null },
        exists: existing(join('/app/resources', 'python', 'python.exe')),
      }),
    ).toEqual({
      interpreter: join('/app/resources', 'python', 'python.exe'),
      origin: 'bundled runtime',
    })
    const missing = resolveInterpreter({
      ...base,
      packaged: true,
      config: { enginePython: null, engineCheckout: '/eng' },
      exists: existing(join('/eng', '.venv', 'bin', 'python')),
    })
    expect(missing.interpreter).toBeNull()
    if (missing.interpreter === null) expect(missing.reason).toContain('reinstall')
  })
})

describe('engineCommand', () => {
  it('is an argument list, never a shell string', () => {
    expect(engineCommand('/py bin/python')).toEqual(['/py bin/python', '-m', 'schematic.serve'])
  })
})

describe('engineEnvironment', () => {
  const config = { home: '/data/engine', loomBin: null, ffmpeg: null }
  const env = {
    PATH: '/usr/bin',
    HOME: '/u/x',
    DOCKER_HOST: 'unix:///x.sock',
    AWS_SECRET_ACCESS_KEY: 'nope',
    GITHUB_TOKEN: 'nope',
    ELECTRON_RUN_AS_NODE: '1',
    PYTHONPATH: '/fake',
    HTTPS_PROXY: 'http://proxy:3128',
  }
  it('carries the allowlist, the engine keys and the Python flags, nothing else', () => {
    const out = engineEnvironment({ config, base: env, development: false })
    expect(out).toEqual({
      PATH: '/usr/bin',
      HOME: '/u/x',
      DOCKER_HOST: 'unix:///x.sock',
      HTTPS_PROXY: 'http://proxy:3128',
      SCHEMATIC_HOME: '/data/engine',
      SCHEMATIC_LOG: 'info',
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
    })
    expect(Object.keys(out)).not.toContain('AWS_SECRET_ACCESS_KEY')
    expect(Object.keys(out)).not.toContain('ELECTRON_RUN_AS_NODE')
    expect(Object.keys(out)).not.toContain('PYTHONPATH')
  })
  it('passes PYTHONPATH through in development only', () => {
    expect(engineEnvironment({ config, base: env, development: true }).PYTHONPATH).toBe('/fake')
  })
  it('matches names case-insensitively on Windows, where the variable is Path', () => {
    const out = engineEnvironment({
      config,
      base: { Path: 'C:\\bin', SystemRoot: 'C:\\Windows', Secret: 'no', temp: 'C:\\t' },
      development: false,
      platform: 'win32',
    })
    expect(out.Path).toBe('C:\\bin')
    expect(out.SystemRoot).toBe('C:\\Windows')
    expect(out.temp).toBe('C:\\t')
    expect(Object.keys(out)).not.toContain('Secret')
    const posix = engineEnvironment({
      config,
      base: { Path: 'x' },
      development: false,
      platform: 'darwin',
    })
    expect(posix.Path).toBeUndefined()
  })
  it('adds the optional engine keys when set, and the log level asked for', () => {
    const out = engineEnvironment({
      config: { home: '/h', loomBin: '/loom', ffmpeg: '/ff/ffmpeg' },
      base: {},
      development: false,
      logLevel: 'debug',
    })
    expect(out.SCHEMATIC_LOOM_BIN).toBe('/loom')
    expect(out.SCHEMATIC_FFMPEG).toBe('/ff/ffmpeg')
    expect(out.SCHEMATIC_LOG).toBe('debug')
  })
})
