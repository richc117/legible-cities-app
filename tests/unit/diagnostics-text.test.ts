// The diagnostics copy's text (A6-03): its order, a missing log, a bounded
// tail, and the home folder written as `~` however a log wrote it. No home
// folder in this file is anyone's: the POSIX ones are made under the
// temporary folder, and the Windows ones are assembled from pieces, so no
// literal path of that shape is committed (bin/preflight refuses one).

import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  areReports,
  composeDiagnostics,
  containsHome,
  diagnosticsText,
  shortenHome,
  shortHomeFrom,
  tailLog,
  type DiagnosticsInput,
} from '../../src/main/diagnostics-text'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function folder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'legible-cities-diagnostics-text-'))
  roots.push(root)
  return root
}

const input = (over: Partial<DiagnosticsInput> = {}): DiagnosticsInput => ({
  app: { name: 'Legible Cities', version: '1.2.3' },
  versions: { electron: '42.0.0', chrome: '140.0.1', node: '24.1.0' },
  os: { type: 'Darwin', release: '25.6.0', arch: 'arm64' },
  engine: { info: { engine: '0.8.2', protocol: 1 } },
  mainLog: 'main tail',
  engineLog: 'engine tail',
  reports: ['Bart — the map drawn for 2026-09-12'],
  ...over,
})

/** A Windows home, built from pieces so no literal of that shape is in the file. */
const windowsHome = ['C:', 'Users', 'Someone'].join('\\')

describe('the composed text', () => {
  it('reads in the order the spec gives', () => {
    const text = composeDiagnostics(input())
    const needles = [
      'Legible Cities 1.2.3',
      'Electron 42.0.0',
      'Chromium 140.0.1',
      'Node 24.1.0',
      'Darwin 25.6.0 (arm64)',
      '"engine": "0.8.2"',
      'main tail',
      'engine tail',
      'Bart — the map drawn for 2026-09-12',
    ]
    const at = needles.map((n) => text.indexOf(n))
    expect(
      at.every((i) => i >= 0),
      text,
    ).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })

  it('says why there is no engine answer, and that no map was drawn', () => {
    const text = composeDiagnostics(
      input({ engine: { absent: 'The engine is not running.' }, reports: [] }),
    )
    expect(text).toContain('The engine is not running.')
    expect(text).toContain('No map has been drawn since the app started.')
  })
})

describe('the home folder', () => {
  it('is written as ~ in a POSIX path, and only as a whole folder name', async () => {
    const home = join(await folder(), 'al')
    const text = `a ${home}/engine b ${home} c ${home}ice d`
    expect(shortenHome(text, [home], 'linux')).toBe(`a ~/engine b ~ c ${home}ice d`)
    expect(containsHome(shortenHome(text, [home], 'linux'), [home], 'linux')).toBe(false)
  })

  it('is found in either separator, doubled backslashes and any case on Windows', () => {
    const forward = windowsHome.replace(/\\/g, '/')
    const doubled = windowsHome.replace(/\\/g, '\\\\')
    const text = [
      `${windowsHome}\\AppData\\Roaming`,
      `${forward}/AppData`,
      `${doubled}\\\\AppData`,
      `${windowsHome.toLowerCase()}\\Desktop`,
      `${windowsHome.toUpperCase()}`,
    ].join('\n')
    const short = shortenHome(text, [windowsHome], 'win32')
    expect(short).toBe(
      ['~\\AppData\\Roaming', '~/AppData', '~\\\\AppData', '~\\Desktop', '~'].join('\n'),
    )
    expect(containsHome(short, [windowsHome], 'win32')).toBe(false)
    expect(containsHome(text, [windowsHome], 'win32')).toBe(true)
  })

  it('ends at a full stop that ends a sentence, and not at one that carries on into a name', async () => {
    const home = join(await folder(), 'someone')
    expect(shortenHome(`not writable: ${home}.`, [home], 'linux')).toBe('not writable: ~.')
    expect(shortenHome(`in ${home}. Then`, [home], 'linux')).toBe('in ~. Then')
    expect(shortenHome(`${home}/notes.txt`, [home], 'linux')).toBe('~/notes.txt')
    // A folder beside the home whose name only starts with it is not the home.
    expect(shortenHome(`${home}.old/x`, [home], 'linux')).toBe(`${home}.old/x`)
    expect(shortenHome(`${home}~1`, [home], 'linux')).toBe(`${home}~1`)
    expect(containsHome(`not writable: ${home}.`, [home], 'linux')).toBe(true)
  })

  it('is found in the 8.3 short form Windows writes the temporary folder in', () => {
    // A user name longer than eight characters: RUNNER~1 for runneradmin.
    const home = ['C:', 'Users', 'runneradmin'].join('\\')
    const temp = ['C:', 'Users', 'RUNNER~1', 'AppData', 'Local', 'Temp'].join('\\')
    const text = `SCHEMATIC_HOME=${temp}\\legible-cities-x\\engine (environment)`
    const short = shortenHome(text, [home], 'win32')
    expect(short).toBe(
      'SCHEMATIC_HOME=~\\AppData\\Local\\Temp\\legible-cities-x\\engine (environment)',
    )
    expect(containsHome(text, [home], 'win32')).toBe(true)
    expect(containsHome(short, [home], 'win32')).toBe(false)
    // Spaces and full stops are not in a short name, and any number follows the tilde.
    const spaced = ['C:', 'Users', 'Mary Ann.Smith'].join('\\')
    const spacedTemp = ['C:', 'Users', 'MARYAN~12', 'AppData'].join('\\')
    expect(shortenHome(spacedTemp, [spaced], 'win32')).toBe('~\\AppData')
    // Not on Linux, where a tilde in a name is only a tilde.
    expect(shortenHome(temp, [home], 'linux')).toBe(temp)
  })

  it('is found in the short form of a dotted name, extension and all', () => {
    // john.smith is JOHN~1.SMI: the stem is the part before the last full stop.
    const home = ['C:', 'Users', 'john.smith'].join('\\')
    const temp = ['C:', 'Users', 'JOHN~1.SMI', 'AppData', 'Local', 'Temp'].join('\\')
    expect(shortenHome(temp, [home], 'win32')).toBe('~\\AppData\\Local\\Temp')
    expect(shortenHome(['C:', 'Users', 'JOHN~2'].join('\\') + '.', [home], 'win32')).toBe('~.')
  })

  it('derives the short home from the temporary folder, and only when the two line up', () => {
    const home = ['C:', 'Users', 'runneradmin'].join('\\')
    const raw = ['C:', 'Users', 'RUNNER~1', 'AppData', 'Local', 'Temp'].join('\\')
    const real = ['C:', 'Users', 'runneradmin', 'AppData', 'Local', 'Temp'].join('\\')
    expect(shortHomeFrom(home, raw, real)).toBe(['C:', 'Users', 'RUNNER~1'].join('\\'))
    // Already long: nothing to derive.
    expect(shortHomeFrom(home, real, real)).toBeNull()
    // A temporary folder outside the home says nothing about it.
    const elsewhere = ['D:', 'Temp'].join('\\')
    expect(shortHomeFrom(home, elsewhere, elsewhere)).toBeNull()
    // The folders after the home differ: the prefix is not the home written short.
    const other = ['C:', 'Users', 'runneradmin', 'AppData', 'Local', 'Other'].join('\\')
    expect(shortHomeFrom(home, raw, other)).toBeNull()
  })

  it('is found percent-encoded, as in a file URL, and replaced there too', async () => {
    const home = join(await folder(), 'Some One', 'josé')
    const url = `file://${encodeURI(home.replace(/\\/g, '/'))}/engine/out/index.html`
    const short = shortenHome(url, [home], 'linux')
    expect(short).toBe('file://~/engine/out/index.html')
    expect(containsHome(url, [home], 'linux')).toBe(true)
    expect(containsHome(short, [home], 'linux')).toBe(false)
  })

  it('refuses a copy whose home is still there once percent-escapes are decoded', async () => {
    const home = join(await folder(), 'josé')
    // Lower-case escapes, which the replacement does not write, on a platform that keeps case.
    const encoded = encodeURI(home).replace(/%[0-9A-F]{2}/g, (e) => e.toLowerCase())
    expect(encoded).not.toBe(encodeURI(home))
    expect(shortenHome(encoded, [home], 'linux')).toBe(encoded)
    expect(containsHome(encoded, [home], 'linux')).toBe(true)
    expect(() => diagnosticsText(input({ mainLog: encoded }), [home], 'linux')).toThrow(
      /still named your home folder/,
    )
  })

  it('keeps case on Linux, where two folders can differ only by it', async () => {
    const home = join(await folder(), 'Someone')
    const other = home.replace('Someone', 'someone')
    expect(shortenHome(other, [home], 'linux')).toBe(other)
  })

  it('is replaced through its real path too, the longer first', async () => {
    const root = await folder()
    const home = join(root, 'h')
    const real = join(root, 'volumes', 'data', 'h')
    expect(shortenHome(`${real}/x and ${home}/y`, [home, real], 'linux')).toBe('~/x and ~/y')
  })

  it('ignores a home that is the root or nothing, rather than replacing every separator', () => {
    expect(shortenHome('/a/b', ['/', ''], 'linux')).toBe('/a/b')
  })

  it('takes the secrets out of a URL an older log still holds whole', () => {
    const text = diagnosticsText(
      input({
        engineLog: "[engine] stderr: FeedError('https://example.org/g.zip?api_key=k1')",
      }),
      [],
      'linux',
    )
    expect(text).not.toContain('k1')
    expect(text).toContain("FeedError('https://example.org/g.zip?api_key=<redacted>')")
  })

  it('is absent from the finished copy, even when every section named it', async () => {
    const home = join(await folder(), 'someone')
    const text = diagnosticsText(
      input({
        engine: { info: { home: `${home}/engine`, ffmpeg: `${home}/bin/ffmpeg` } },
        mainLog: `[config] SCHEMATIC_HOME=${home}/engine`,
        engineLog: `[engine] stderr: File "${home}/lib/x.py"`,
        reports: [`${home} in a report`],
      }),
      [home],
      'darwin',
    )
    expect(text).not.toContain(home)
    expect(text).toContain('"home": "~/engine"')
    expect(text).toContain('SCHEMATIC_HOME=~/engine')
  })
})

describe('a log tail', () => {
  it('is the last 200 lines', async () => {
    const dir = await folder()
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`)
    await writeFile(join(dir, 'main.log'), lines.join('\n') + '\n')
    const tail = (await tailLog(dir, 'main')).split('\n')
    expect(tail).toHaveLength(200)
    expect(tail[0]).toBe('line 300')
    expect(tail[199]).toBe('line 499')
  })

  it('reads a bounded end of a large file, starting on a whole line', async () => {
    const dir = await folder()
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i} ${'x'.repeat(40)}`)
    await writeFile(join(dir, 'engine.log'), lines.join('\n') + '\n')
    const tail = (await tailLog(dir, 'engine', 200, 1024)).split('\n')
    expect(tail.length).toBeLessThan(200)
    expect(tail[0]).toMatch(/^line \d+ x+$/)
    expect(tail[tail.length - 1]).toBe(lines[999])
  })

  it('is not topped up from the older file when the current one was read only in part', async () => {
    const dir = await folder()
    await writeFile(join(dir, 'main.old.log'), 'old 1\nold 2\n')
    const long = Array.from({ length: 100 }, (_, i) => `line ${i} ${'x'.repeat(40)}`)
    await writeFile(join(dir, 'main.log'), long.join('\n') + '\n')
    const tail = await tailLog(dir, 'main', 200, 1024)
    expect(tail).not.toContain('old')
    expect(tail.split('\n').length).toBeLessThan(200)
  })

  it('is topped up from the file before the last rotation', async () => {
    const dir = await folder()
    await writeFile(join(dir, 'main.old.log'), 'old 1\nold 2\n')
    await writeFile(join(dir, 'main.log'), 'new 1\n')
    expect(await tailLog(dir, 'main', 2)).toBe('old 2\nnew 1')
  })

  it.skipIf(process.platform === 'win32')(
    'does not follow a symbolic link planted where the log should be',
    async () => {
      const dir = await folder()
      const secret = join(dir, 'elsewhere.txt')
      await writeFile(secret, 'not a log\n')
      await symlink(secret, join(dir, 'main.log'))
      const tail = await tailLog(dir, 'main')
      expect(tail).not.toContain('not a log')
      expect(tail).toMatch(/^main\.log could not be read \(/)
    },
  )

  it('says so when the log does not exist yet', async () => {
    const dir = await folder()
    expect(await tailLog(dir, 'engine')).toBe('There is no engine.log yet.')
  })
})

describe('the reports from the page', () => {
  it('are at most twenty strings of at most 64 KB each', () => {
    expect(areReports([])).toBe(true)
    expect(areReports(Array.from({ length: 20 }, () => 'r'))).toBe(true)
    expect(areReports(Array.from({ length: 21 }, () => 'r'))).toBe(false)
    expect(areReports(['é'.repeat(32 * 1024)])).toBe(true)
    expect(areReports(['é'.repeat(32 * 1024 + 1)]), 'bytes, not code units').toBe(false)
    expect(areReports('r')).toBe(false)
    expect(areReports([{}])).toBe(false)
    // A sparse array: \`every\` would skip the hole and pass it.
    const sparse = new Array<string>(2)
    sparse[1] = 'a report'
    expect(areReports(sparse)).toBe(false)
  })
})

// Constitution IV: nothing this feature adds can reach the network. Read
// from the source, because a module that opens no connection in a test can
// still hold the code that would.
describe('no telemetry', () => {
  it('the log and diagnostics modules import no network module and call no fetch', async () => {
    for (const file of ['log.ts', 'log-file.ts', 'diagnostics-text.ts', 'redact.ts']) {
      const source = await readFile(join(__dirname, '../../src/main', file), 'utf8')
      expect(source, file).not.toMatch(
        /from ['"](node:)?(net|http|https|http2|dgram|tls|dns)['"]|\bfetch\s*\(|\bnet\./,
      )
    }
  })
})
