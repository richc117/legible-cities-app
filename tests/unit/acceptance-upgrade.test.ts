// The update over 0.1.0's pure pieces (tests/acceptance/upgrade.mjs, step
// 22): Made read in either version's words and compared as a moment, what
// the phases write in upgrade.json and how it is read back, the record's
// row, and the record CLI's `step 22`. The phases themselves launch two
// installed versions and are never part of `npm test`.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fillField } from '../acceptance/pure.mjs'
import { RunRecord } from '../acceptance/record'
import {
  NOT_AUTOMATED,
  localFields,
  madeAt,
  parseMade,
  readUpgrade,
  sameMade,
  seedOf,
  upgradeRow,
  type Upgrade,
} from '../acceptance/upgrade.mjs'

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'lc-upgrade-unit-'))
  made.push(dir)
  return dir
}

/** One moment in 0.1.0's words and in the later versions' (dates.ts's own example). */
const OLD = '9/29/2026, 7:16:51 PM'
const NEW = '29 September 2026 at 7:16 PM'
/** That moment, as the record holds it, and the zone the runner read it in. */
const ISO = '2026-09-30T02:16:51.412Z'
const LOS_ANGELES = 'America/Los_Angeles'

describe('parseMade', () => {
  it("reads 0.1.0's toLocaleString, with its seconds", () => {
    expect(parseMade(OLD)).toEqual({
      year: 2026,
      month: 9,
      day: 29,
      hour: 19,
      minute: 16,
      second: 51,
    })
  })

  it('reads the narrow no-break space ICU puts before AM', () => {
    expect(parseMade('9/29/2026, 7:16:51\u202fPM')).toEqual(parseMade(OLD))
  })

  it("reads the later versions' words, with no seconds, in either hour cycle", () => {
    expect(parseMade(NEW)).toEqual({
      year: 2026,
      month: 9,
      day: 29,
      hour: 19,
      minute: 16,
      second: null,
    })
    expect(parseMade('29 September 2026 at 21:57')).toMatchObject({ hour: 21, minute: 57 })
    expect(parseMade('2 March 2026 at 7:05 PM')).toMatchObject({ month: 3, day: 2, hour: 19 })
  })

  it('turns the 12-hour clock into the 24-hour one at both ends of the day', () => {
    expect(parseMade('9/29/2026, 12:05:00 AM')?.hour).toBe(0)
    expect(parseMade('9/29/2026, 12:05:00 PM')?.hour).toBe(12)
    expect(parseMade('9/29/2026, 9:57:17 PM')?.hour).toBe(21)
  })

  it('answers null for anything neither version writes', () => {
    for (const text of [
      'c7d405e8',
      '',
      '29/9/2026, 19:16:51',
      '2026-09-30T02:16:51Z',
      '31 Smarch 2026 at 9:57 AM',
      '30 February 2026 at 9:57 AM',
      '29 September 2026 at 13:57 PM',
      '29 September 2026 at 7:61 PM',
      '9/29/2026, 7:16:61 PM',
    ]) {
      expect(parseMade(text), text).toBeNull()
    }
  })
})

describe('madeAt', () => {
  it("holds either version's words to the record's moment, read on the runner's clock", () => {
    expect(localFields(ISO, LOS_ANGELES)).toEqual({
      year: 2026,
      month: 9,
      day: 29,
      hour: 19,
      minute: 16,
      second: 51,
    })
    expect(madeAt(OLD, ISO, LOS_ANGELES)).toBe(true)
    expect(madeAt(NEW, ISO, LOS_ANGELES)).toBe(true)
  })

  it('to the second where the words give one, and to the minute always', () => {
    expect(madeAt('9/29/2026, 7:16:52 PM', ISO, LOS_ANGELES)).toBe(false)
    expect(madeAt('29 September 2026 at 7:17 PM', ISO, LOS_ANGELES)).toBe(false)
    expect(madeAt('30 September 2026 at 7:16 PM', ISO, LOS_ANGELES)).toBe(false)
  })

  it('on the clock it was read on, not UTC', () => {
    expect(madeAt(NEW, ISO, 'UTC')).toBe(false)
    expect(madeAt('30 September 2026 at 02:16', ISO, 'UTC')).toBe(true)
  })

  it('is false for words it cannot read, or a record with no moment', () => {
    expect(madeAt('c7d405e8', ISO, LOS_ANGELES)).toBe(false)
    expect(madeAt(NEW, 'not a moment', LOS_ANGELES)).toBe(false)
  })
})

describe('sameMade', () => {
  it("is true for one moment in 0.1.0's words and in the later versions', which differ as text", () => {
    expect(OLD).not.toBe(NEW)
    expect(sameMade(OLD, NEW)).toBe(true)
    expect(sameMade(NEW, OLD)).toBe(true)
  })

  it('is false for another minute, another day, another second, or words it cannot read', () => {
    expect(sameMade(OLD, '29 September 2026 at 7:17 PM')).toBe(false)
    expect(sameMade(OLD, '28 September 2026 at 7:16 PM')).toBe(false)
    expect(sameMade(OLD, '9/29/2026, 7:16:52 PM')).toBe(false)
    expect(sameMade(OLD, 'c7d405e8')).toBe(false)
    expect(sameMade('', '')).toBe(false)
  })
})

// ------------------------------------------------------------ upgrade.json

const HASH = 'a'.repeat(64)
const seed = {
  version: '0.1.0',
  userData: '/runner/Library/Application Support/Legible Cities',
  exportFolder: '/runner/temp/exports',
  projectFile: '/runner/Library/Application Support/Legible Cities/engine/projects/p/project.json',
  projectVersion: 1,
  layout: 'c7d405e8',
  layoutId: 'c7d405e8a1b2c3d4',
  made: OLD,
  madeIso: ISO,
  date: '2026-09-29',
  projectSha256: HASH,
  exportFile: '/runner/temp/exports/LA Metro Rail/la-metro-rail-instagram-post.png',
  exportSha256: 'b'.repeat(64),
}
const passed = (note: string) => ({ ok: true, problems: [], notes: [note] })
const whole = (): Upgrade => ({
  record: 1,
  seed: { ...seed },
  after: { version: '1.0.0', projectSha256: 'c'.repeat(64) },
  phases: { seed: passed('seeded.'), after: passed('updated.'), back: passed('went back.') },
})
const text = (value: unknown): string => JSON.stringify(value)

describe('readUpgrade', () => {
  it('reads back what the three phases wrote', () => {
    expect(readUpgrade(text(whole()))).toEqual(whole())
    expect(seedOf(readUpgrade(text(whole())))).toEqual(seed)
  })

  it('reads a run the seed began, before it had anything to write down', () => {
    const begun = readUpgrade(text({ record: 1, phases: {} }))
    expect(() => seedOf(begun)).toThrow('the seed wrote nothing down')
  })

  it('refuses what is not JSON, another record, and phases it does not know', () => {
    expect(() => readUpgrade('{')).toThrow('not JSON')
    expect(() => readUpgrade(text({ ...whole(), record: 2 }))).toThrow('record 2, not 1')
    expect(() => readUpgrade(text({ record: 1 }))).toThrow('phases is not an object')
    expect(() => readUpgrade(text({ ...whole(), phases: { install: passed('x') } }))).toThrow(
      'names a phase install',
    )
  })

  it('refuses a phase that does not say whether it passed, or passed with problems', () => {
    const noVerdict = { ...whole(), phases: { seed: { problems: [], notes: [] } } }
    expect(() => readUpgrade(text(noVerdict))).toThrow('does not say whether it passed')
    const both = { ...whole(), phases: { seed: { ok: true, problems: ['x'], notes: [] } } }
    expect(() => readUpgrade(text(both))).toThrow('passed with problems')
    const noLists = { ...whole(), phases: { seed: { ok: false, problems: 'x', notes: [] } } }
    expect(() => readUpgrade(text(noLists))).toThrow('no list of problems')
  })

  it('refuses a seed with a field missing or of the wrong kind', () => {
    for (const field of Object.keys(seed)) {
      const lacking: Record<string, unknown> = { ...seed }
      delete lacking[field]
      expect(() => readUpgrade(text({ ...whole(), seed: lacking })), field).toThrow(
        `seed has no ${field}`,
      )
    }
    for (const [field, value] of [
      ['projectSha256', 'not a hash'],
      ['exportSha256', HASH.toUpperCase()],
      ['madeIso', 'yesterday'],
      ['date', '29 September 2026'],
      ['projectVersion', '1'],
      ['layoutId', ''],
    ] as const) {
      expect(
        () => readUpgrade(text({ ...whole(), seed: { ...seed, [field]: value } })),
        field,
      ).toThrow(`seed.${field} is not one`)
    }
  })

  it('refuses what after wrote for back where it is not whole', () => {
    expect(() => readUpgrade(text({ ...whole(), after: { version: '1.0.0' } }))).toThrow(
      'after has no projectSha256',
    )
    expect(() =>
      readUpgrade(text({ ...whole(), after: { version: '1.0.0', projectSha256: 'x' } })),
    ).toThrow('after.projectSha256 is not one')
  })
})

// ----------------------------------------------------------------- the row

const ALL_SUCCEEDED = [
  ['install 0.1.0', 'success'],
  ['seed', 'success'],
  ['install the release over it', 'success'],
  ['after', 'success'],
  ['install 0.1.0 again', 'success'],
  ['back', 'success'],
] as const

describe('upgradeRow', () => {
  it('passes, in part, only where every step succeeded and every phase passed', () => {
    const row = upgradeRow(whole(), ALL_SUCCEEDED)
    expect(row.result).toBe('pass, part not automated')
    expect(row.previous).toBe('0.1.0')
    expect(row.notes).toBe(`seeded. updated. went back. ${NOT_AUTOMATED}`)
    expect(row.notes).not.toMatch(/Failed/)
  })

  it('fails on a step of the workflow that did not succeed, whatever its word', () => {
    for (const outcome of ['failure', 'cancelled', 'skipped', '']) {
      const outcomes = ALL_SUCCEEDED.map(([name, o]) =>
        name === 'install the release over it' ? ([name, outcome] as const) : ([name, o] as const),
      )
      const row = upgradeRow(whole(), outcomes)
      expect(row.result, outcome).toBe('fail')
      expect(row.notes).toMatch(
        new RegExp(`^Failed: install the release over it: ${outcome || 'did not run'}\\.`),
      )
    }
  })

  it('fails on a phase that wrote nothing, or did not pass', () => {
    const noBack = whole()
    delete noBack.phases.back
    expect(upgradeRow(noBack, ALL_SUCCEEDED)).toMatchObject({ result: 'fail' })
    expect(upgradeRow(noBack, ALL_SUCCEEDED).notes).toContain(
      'Failed: the back phase wrote nothing.',
    )

    const problem = whole()
    problem.phases.after = { ok: false, problems: ['Made is another moment.'], notes: [] }
    const row = upgradeRow(problem, ALL_SUCCEEDED)
    expect(row.result).toBe('fail')
    expect(row.notes).toContain('Failed: after: Made is another moment.')

    const silent = whole()
    silent.phases.seed = { ok: false, problems: [], notes: [] }
    expect(upgradeRow(silent, ALL_SUCCEEDED)).toMatchObject({ result: 'fail' })
    expect(upgradeRow(silent, ALL_SUCCEEDED).notes).toContain('Failed: seed: did not pass.')
  })

  it('fails with the sentence where upgrade.json could not be read, and knows no version', () => {
    const row = upgradeRow('upgrade.json is not JSON', ALL_SUCCEEDED)
    expect(row.result).toBe('fail')
    expect(row.notes).toMatch(/^Failed: upgrade\.json is not JSON\. /)
    expect(row.previous).toMatch(/^not known/)
  })
})

describe('fillField', () => {
  const record = '| | |\n|---|---|\n| Previous version installed | x |\n| Date | 2026-01-01 |\n'

  it("replaces one field's value, redacted, and leaves the others", () => {
    const redact = (t: string): string => t.replace('/profiles/someone', '~')
    expect(
      fillField(record, 'Previous version installed', '0.1.0 at /profiles/someone', redact),
    ).toBe('| | |\n|---|---|\n| Previous version installed | 0.1.0 at ~ |\n| Date | 2026-01-01 |\n')
  })

  it('refuses a field the record has no row for', () => {
    expect(() => fillField(record, 'Machine', 'x')).toThrow('no row for Machine')
  })
})

// --------------------------------------------------------------- the CLI

const CLI = resolve(__dirname, '../acceptance/record-cli.mjs')
const runCli = (args: string[]): { status: number | null; stdout: string; stderr: string } => {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}
const rowOf = (markdown: string, start: string): string =>
  markdown.split('\n').find((line) => line.startsWith(start)) ?? ''

describe('record-cli step 22', () => {
  const outcomeArgs = ALL_SUCCEEDED.map(([name, outcome]) => `${name}=${outcome}`)

  it('writes the row and the previous version into the record the spec wrote', () => {
    const dir = scratch()
    const recordPath = join(dir, 'acceptance-macos.md')
    const upgradePath = join(dir, 'upgrade.json')
    new RunRecord(recordPath).write()
    writeFileSync(upgradePath, text(whole()))
    const run = runCli(['step', '22', recordPath, upgradePath, ...outcomeArgs])
    expect(run.status, run.stderr).toBe(0)
    const written = readFileSync(recordPath, 'utf8')
    expect(rowOf(written, '| 22 |')).toMatch(
      /^\| 22 \| Update over 0\.1\.0 \| pass, part not automated \| seeded\. updated\. went back\. Not automated: /,
    )
    expect(rowOf(written, '| Previous version installed |')).toBe(
      '| Previous version installed | 0.1.0 |',
    )
  })

  it('writes a failure, and exits 1, where a phase failed or nothing was written down', () => {
    const dir = scratch()
    const recordPath = join(dir, 'acceptance-windows.md')
    new RunRecord(recordPath).write()
    const run = runCli(['step', '22', recordPath, join(dir, 'upgrade.json'), ...outcomeArgs])
    expect(run.status).toBe(1)
    const written = readFileSync(recordPath, 'utf8')
    expect(rowOf(written, '| 22 |')).toMatch(
      /^\| 22 \| Update over 0\.1\.0 \| fail \| Failed: there is no upgrade\.json: no phase ran\. /,
    )
    expect(rowOf(written, '| Previous version installed |')).toMatch(/\| not known: /)
  })

  it('takes step 22 only, and every outcome as name=outcome', () => {
    const dir = scratch()
    const recordPath = join(dir, 'r.md')
    new RunRecord(recordPath).write()
    expect(runCli(['step', '21', recordPath, join(dir, 'u.json'), 'a=success']).stderr).toMatch(
      /step takes 22/,
    )
    expect(runCli(['step', '22', recordPath, join(dir, 'u.json'), 'success']).stderr).toMatch(
      /is not name=outcome/,
    )
    expect(runCli(['step', '22', recordPath, join(dir, 'u.json')]).stderr).toMatch(
      /needs the outcome/,
    )
  })
})
