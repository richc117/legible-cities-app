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
  DIAGNOSTICS_BUDGET,
  LOG_FLOOR,
  diagnosticsText,
  shortenHome,
  shortHomeFrom,
  tailLog,
  type DiagnosticsInput,
} from '../../src/main/diagnostics-text'
import { redactUrls } from '../../src/main/redact'

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
  firstRun: {
    finished: true,
    loom: { outcome: 'passed', ms: 14 },
    ffmpeg: {
      outcome: 'failed',
      kind: 'not-running',
      sentence: 'The bundled ffmpeg did not run, so exports cannot be made.',
      detail: 'ffmpeg exited with code 1.',
      ms: 20,
    },
  },
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
      '## Bundled tools',
      'Not every tool the app needs ran.',
      'LOOM: ran (14 ms).',
      'ffmpeg: The bundled ffmpeg did not run, so exports cannot be made. ffmpeg exited with code 1.',
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

  it("names the app by the version the build gave it, a candidate's -rc.N and a commit kept", () => {
    for (const version of ['1.0.0-rc.2', '1.0.0', '1.0.0+abc1234']) {
      const text = composeDiagnostics(input({ app: { name: 'Legible Cities', version } }))
      expect(text).toContain(`\n## App\n\nLegible Cities ${version}\n`)
    }
  })

  // The label is fixed at build time (issue 558), so what the main process
  // hands Settings and the diagnostics is held here from the source: both
  // read about().app.version, and it must be the label, not Electron's
  // app.getVersion(), which is package.json's X.Y.Z without the -rc.N. The
  // macOS About panel (issue 554) says the same label, so no call to it is left.
  it("is handed the build's release label for the app, not Electron's version", async () => {
    // Mutation: about() back on app.getVersion(), so a candidate says 1.0.0.
    const index = await readFile(join(__dirname, '../../src/main/index.ts'), 'utf8')
    expect(index).toContain('declare const __RELEASE_LABEL__: string')
    expect(index).toContain('app: { name: PRODUCT_NAME, version: __RELEASE_LABEL__ },')
    expect(index).not.toMatch(/\bgetVersion\s*\(/)
    // Mutation: either line gone, and AppKit falls back to the bundle's 1.0.0.
    expect(index).toContain('applicationVersion: __RELEASE_LABEL__,')
    expect(index).toMatch(/^\s+version: __RELEASE_LABEL__,$/m)
    const config = await readFile(join(__dirname, '../../electron.vite.config.ts'), 'utf8')
    expect(config).toContain('process.env.LEGIBLE_RELEASE_REF')
    expect(config).toContain('define: { __RELEASE_LABEL__: JSON.stringify(RELEASE_LABEL) },')
  })
})

/** `count` log lines, each `width` characters wide and numbered, so one can be told from another. */
const logOf = (name: string, count: number, width: number): string =>
  Array.from({ length: count }, (_, i) => `${name} line ${i} `.padEnd(width, '.')).join('\n')

/** The text between one `## ` heading and the next, heading included. */
const sectionOf = (text: string, title: string): string => {
  const from = text.indexOf(`## ${title}`)
  const next = text.indexOf('\n## ', from + 1)
  return text.slice(from, next === -1 ? undefined : next)
}

const TRIM = /^Trimmed to fit a GitHub issue: .*$/m

describe('the budget', () => {
  it.each([
    ['twenty 64 KB reports', 64 * 1024],
    ['twenty 4 KB reports, some of which fit', 4 * 1024],
  ])('holds %s and two 256 KB logs to the budget, and counts what is left', (_, size) => {
    const reports = Array.from({ length: 20 }, (_, i) => `report ${i} `.padEnd(size, 'r'))
    const text = composeDiagnostics(
      input({
        mainLog: logOf('main', 2600, 100),
        engineLog: logOf('engine', 2600, 100),
        reports,
      }),
    )
    expect(text.length).toBeLessThanOrEqual(DIAGNOSTICS_BUDGET)
    const line = TRIM.exec(text)?.[0]
    expect(line).toMatch(
      /^Trimmed to fit a GitHub issue: main\.log keeps its last (\d+) lines, engine\.log (\d+), and (\d+) of 20 map reports\./,
    )
    const [, main, engine, kept] = /last (\d+) lines, engine\.log (\d+), and (\d+) of/.exec(line!)!
    const linesIn = (title: string): number =>
      sectionOf(text, title)
        .split('\n')
        .filter((l) => / line \d+ \./.test(l)).length
    expect(linesIn('main.log')).toBe(Number(main))
    expect(linesIn('engine.log')).toBe(Number(engine))
    // The reports crowd the logs down to their floor and no further.
    expect(Number(main)).toBe(LOG_FLOOR)
    expect(Number(engine)).toBe(LOG_FLOOR)
    expect(text).toContain('main line 2599 ')
    expect(text).toContain(`engine line ${2600 - LOG_FLOOR} `)
    expect(text).not.toContain(`engine line ${2599 - LOG_FLOOR} `)
    expect(text.match(/^report \d+ /gm)?.length ?? 0).toBe(Number(kept))
  })

  it('drops the oldest lines and keeps the newest', () => {
    const text = composeDiagnostics(
      input({ mainLog: logOf('main', 200, 150), engineLog: logOf('engine', 200, 150) }),
    )
    expect(text.length).toBeLessThanOrEqual(DIAGNOSTICS_BUDGET)
    expect(text).toContain('main line 199 ')
    expect(text).toContain('engine line 199 ')
    expect(text).not.toContain('main line 0 ')
    expect(text).not.toContain('engine line 0 ')
    // The lines kept are one run to the end, none missing in between.
    const kept = text.match(/main line (\d+) /g)!.map((l) => Number(/\d+/.exec(l)![0]))
    expect(kept).toEqual(Array.from({ length: kept.length }, (_, i) => 199 - kept.length + 1 + i))
    // The map report was not touched, since the logs gave enough.
    expect(text).toContain('Bart — the map drawn for 2026-09-12')
  })

  it('takes from the longer log first, and leaves a short one whole', () => {
    const text = composeDiagnostics(
      input({ mainLog: logOf('main', 400, 150), engineLog: logOf('engine', 10, 150) }),
    )
    expect(text.length).toBeLessThanOrEqual(DIAGNOSTICS_BUDGET)
    expect(text).toMatch(/engine\.log 10, and 1 of 1 map report\./)
    expect(text).toContain('engine line 0 ')
    expect(text).not.toContain('main line 0 ')
    expect(text).toContain('main line 399 ')
  })

  it('drops the oldest map reports once the logs are down to their floor, and not before', () => {
    const reports = Array.from({ length: 3 }, (_, i) => `report ${i} `.padEnd(20_000, 'r'))
    // A log of 100 short lines: the floor is the newest 20 of them.
    const text = composeDiagnostics(
      input({ reports, mainLog: logOf('main', 100, 40), engineLog: logOf('engine', 5, 40) }),
    )
    expect(text.length).toBeLessThanOrEqual(DIAGNOSTICS_BUDGET)
    expect(text).not.toContain('report 0 ')
    expect(text).toContain('report 1 ')
    expect(text).toContain('report 2 ')
    expect(text).toContain(`main.log keeps its last ${LOG_FLOOR} lines, engine.log 5, and 2 of 3`)
    expect(text).toContain(`main line ${99 - LOG_FLOOR + 1} `)
    expect(text).not.toContain(`main line ${99 - LOG_FLOOR} `)
    expect(text).toContain('engine line 0 ')
  })

  it('takes lines from below the floor only when nothing else is left to take', () => {
    // Twenty lines of 3,000 characters are 60,000: the floor itself does not fit.
    const text = composeDiagnostics(
      input({
        mainLog: logOf('main', 30, 3000),
        engineLog: logOf('engine', 30, 3000),
        reports: ['report 0 '.padEnd(500, 'r'), 'report 1 '.padEnd(500, 'r')],
      }),
    )
    expect(text.length).toBeLessThanOrEqual(DIAGNOSTICS_BUDGET)
    expect(text).toContain('and 0 of 2 map reports')
    const kept = (title: string): number =>
      (sectionOf(text, title).match(/ line \d+ \./g) ?? []).length
    expect(kept('main.log')).toBeLessThan(LOG_FLOOR)
    expect(kept('engine.log')).toBeLessThan(LOG_FLOOR)
    expect(kept('main.log')).toBeGreaterThan(0)
    expect(text).toContain('main line 29 ')
    expect(text).toContain('engine line 29 ')
    expect(text).not.toContain('main line 0 ')
  })

  it('reads correctly for a log of one line, and for one of none', () => {
    const big = (name: string): string => `${name} `.padEnd(30_000, 'r')
    const one = composeDiagnostics(
      input({ reports: [big('report 0'), big('report 1')], mainLog: 'only line' }),
    )
    expect(one.length).toBeLessThanOrEqual(DIAGNOSTICS_BUDGET)
    expect(one).toContain(
      'main.log keeps its last line, engine.log 1 line, and 1 of 2 map reports. The whole logs',
    )
    expect(one).toContain('## main.log, the last line\n\nonly line')
    // One line bigger than the whole budget goes, after the one report.
    const none = composeDiagnostics(
      input({ mainLog: 'm'.repeat(60_000), engineLog: 'e'.repeat(60_000) }),
    )
    expect(none.length).toBeLessThanOrEqual(DIAGNOSTICS_BUDGET)
    expect(none).toContain('main.log keeps no lines, engine.log no lines, and 0 of 1 map report.')
    expect(none).toContain('## main.log, no lines kept\n\nNo lines kept.')
    expect(none).not.toMatch(/\b1 lines\b|\b0 lines\b/)
  })

  it('keeps the five head sections byte for byte', () => {
    const head = (text: string): string =>
      text.slice(text.indexOf('## App'), text.indexOf('## main.log'))
    const whole = composeDiagnostics(input())
    const trimmed = composeDiagnostics(
      input({ mainLog: logOf('main', 2000, 100), engineLog: logOf('engine', 2000, 100) }),
    )
    expect(trimmed).toMatch(TRIM)
    expect(head(trimmed)).toBe(head(whole))
    expect(head(whole)).toContain('## Bundled tools')
    // And the line goes under the heading, before the first section.
    expect(trimmed.indexOf('Trimmed to fit')).toBeGreaterThan(trimmed.indexOf('# Legible Cities'))
    expect(trimmed.indexOf('Trimmed to fit')).toBeLessThan(trimmed.indexOf('## App'))
  })

  it('leaves a copy under the budget as it was, with no line saying otherwise', () => {
    const text = composeDiagnostics(input({ mainLog: logOf('main', 200, 100) }))
    expect(text.length).toBeLessThan(DIAGNOSTICS_BUDGET)
    expect(text).not.toMatch(TRIM)
    expect(text).toContain('## main.log, the last 200 lines')
    expect(text).toContain('main line 0 ')
    expect(text).toContain('main line 199 ')
  })

  it('names the lines a trimmed log really keeps, not 200', () => {
    const text = composeDiagnostics(
      input({ mainLog: logOf('main', 200, 150), engineLog: logOf('engine', 200, 150) }),
    )
    const main = /main\.log keeps its last (\d+) lines/.exec(text)![1]
    expect(text).toContain(`## main.log, the last ${main} lines`)
    expect(text).not.toContain('the last 200 lines')
  })

  it('holds the finished copy to the budget when redaction makes lines longer, and still hides the home', async () => {
    const home = join(await folder(), 'someone')
    // Short query values become <redacted>, which is longer than they were.
    // The home is on one line only, so what grows is not what shrinks.
    const url = 'https://example.org/g.zip?a=1&b=2&c=3'
    const lines = (name: string): string[] =>
      Array.from({ length: 600 }, (_, i) => `${name} line ${i} ${url}`)
    const mainLines = lines('main')
    mainLines[599] += ` ${home}/x`
    // The logs and one report each carry the same URL, so that leaving any
    // one of them unfinished is enough to take the copy over the budget.
    const report = `a map report ${Array.from({ length: 400 }, () => url).join(' ')}`
    const given = input({
      mainLog: mainLines.join('\n'),
      engineLog: lines('engine').join('\n'),
      reports: [report],
    })
    // The premise: what composes within the budget raw is over it once redacted.
    expect(redactUrls(composeDiagnostics(given)).length).toBeGreaterThan(DIAGNOSTICS_BUDGET)
    const text = diagnosticsText(given, [home], 'linux')
    expect(text.length).toBeLessThanOrEqual(DIAGNOSTICS_BUDGET)
    expect(text).toMatch(TRIM)
    expect(text).toContain('<redacted>')
    expect(text).toContain('main line 599 ')
    expect(text).toContain('engine line 599 ')
    expect(text).toContain('a map report ')
    expect(text).toContain('~/x')
    expect(text).not.toContain(home)
  })

  it('finishes the engine sentence too, since the head is never cut', () => {
    const absent = Array.from({ length: 800 }, () => 'https://example.org/?a=1&b=2').join(' ')
    const given = input({
      engine: { absent },
      mainLog: logOf('main', 400, 100),
      engineLog: logOf('engine', 400, 100),
    })
    expect(redactUrls(composeDiagnostics(given)).length).toBeGreaterThan(DIAGNOSTICS_BUDGET)
    const text = diagnosticsText(given, [], 'linux')
    expect(text.length).toBeLessThanOrEqual(DIAGNOSTICS_BUDGET)
    expect(text).toContain('<redacted>')
  })

  it('trims at one character over the budget and not at the budget', () => {
    const base = composeDiagnostics(input({ mainLog: '' })).length
    const at = composeDiagnostics(input({ mainLog: 'x'.repeat(DIAGNOSTICS_BUDGET - base) }))
    expect(at.length).toBe(DIAGNOSTICS_BUDGET)
    expect(at).not.toMatch(TRIM)
    const over = composeDiagnostics(input({ mainLog: 'x'.repeat(DIAGNOSTICS_BUDGET - base + 1) }))
    expect(over).toMatch(TRIM)
    expect(over.length).toBeLessThanOrEqual(DIAGNOSTICS_BUDGET)
  })

  it('counts the reports in the singular for one, and says there were none for none', () => {
    const long = { mainLog: logOf('main', 400, 150), engineLog: logOf('engine', 400, 150) }
    const one = composeDiagnostics(input({ ...long, reports: ['one report'] }))
    expect(one).toMatch(/, and 1 of 1 map report\. The whole logs/)
    const none = composeDiagnostics(input({ ...long, reports: [] }))
    expect(none).toMatch(/, and no map reports\. The whole logs/)
    expect(none).not.toMatch(/\b0 of 0\b/)
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
