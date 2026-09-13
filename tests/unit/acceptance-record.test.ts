// The acceptance run's pure pieces (tests/acceptance/pure.mjs, A6-04): what
// a record is redacted to before it is pasted into a public issue, how a row
// is filled, how SHA256SUMS.txt is read, which log files a run may remove,
// and how the release's tag is asked whether it contains a commit. The run
// itself launches an installed app and is never part of `npm test`.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cell,
  fillStep,
  makeRedact,
  parseSums,
  RESULTS,
  tagContains,
  writtenSince,
} from '../acceptance/pure.mjs'
import { RunRecord } from '../acceptance/record'

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'lc-acceptance-unit-'))
  made.push(dir)
  return dir
}

/** No links to follow: the paths are made up. */
const noLinks = (path: string): string => {
  throw new Error(`no ${path}`)
}

describe('redact', () => {
  it('writes the home folder as ~ and the temporary folder as <temp>, the temporary first', () => {
    const redact = makeRedact({
      home: '/profiles/someone',
      temp: '/profiles/someone/tmp',
      platform: 'darwin',
      realpath: noLinks,
    })
    expect(redact('profile /profiles/someone/tmp/p and log /profiles/someone/Library/x')).toBe(
      'profile <temp>/p and log ~/Library/x',
    )
  })

  it('finds a path through its links, in either separator', () => {
    const redact = makeRedact({
      home: '/profiles/other',
      temp: '/var/folders/t',
      platform: 'darwin',
      realpath: (path) => (path === '/var/folders/t' ? '/private/var/folders/t' : path),
    })
    expect(redact('/private/var/folders/t/a and \\var\\folders\\t\\b')).toBe(
      '<temp>/a and <temp>\\b',
    )
  })

  it('ignores case on Windows, and only there', () => {
    const options = { home: 'D:\\Profiles\\Someone', temp: 'C:\\Temp', realpath: noLinks }
    expect(makeRedact({ ...options, platform: 'win32' })('d:\\profiles\\someone\\x')).toBe('~\\x')
    expect(makeRedact({ ...options, platform: 'linux' })('d:\\profiles\\someone\\x')).toBe(
      'd:\\profiles\\someone\\x',
    )
  })
})

describe('cell', () => {
  it('is one line with no bare pipe, redacted', () => {
    const redact = makeRedact({
      home: '/profiles/a',
      temp: '/tmp',
      platform: 'linux',
      realpath: noLinks,
    })
    expect(cell('first | second\nthird /profiles/a/x', redact)).toBe('first \\| second third ~/x')
  })
})

describe('fillStep', () => {
  const record = (): string => {
    const dir = scratch()
    const path = join(dir, 'record.md')
    const run = new RunRecord(path)
    run.step(7, 'pass', 'LA laid out', 'Lay out (LA: 14 s; Caltrain: 1 s)')
    return run.render()
  }

  it('replaces a row’s result and notes and keeps its title', () => {
    const filled = fillStep(record(), 21, 'fail', 'left: a | b')
    expect(filled).toContain('| 21 | Uninstall, and what is left | fail | left: a \\| b |')
    expect(filled).toContain('| 7 | Lay out (LA: 14 s; Caltrain: 1 s) | pass | LA laid out |')
  })

  it('refuses a result that is not one and a row that is not there', () => {
    expect(() => fillStep(record(), 21, 'fine' as never, '')).toThrow('fine is not a result')
    expect(() => fillStep('no table', 21, 'pass', '')).toThrow('no row for step 21')
  })

  it('knows every result the record can hold', () => {
    expect(RESULTS).toContain('pass, part not checked')
  })
})

describe('parseSums', () => {
  it('reads both of shasum’s forms and nothing else', () => {
    const a = 'a'.repeat(64)
    const b = 'b'.repeat(64)
    const sums = parseSums(`${a}  one.dmg\r\n${b} *two.exe\nnot a line\n${'c'.repeat(63)}  short\n`)
    expect([...sums.entries()]).toEqual([
      ['one.dmg', a],
      ['two.exe', b],
    ])
  })
})

describe('writtenSince', () => {
  it('is true for a file whose first stamped line is at or after the run, or has none', () => {
    const dir = scratch()
    const since = Date.parse('2026-09-13T12:00:00.000Z')
    const after = join(dir, 'after.log')
    const before = join(dir, 'before.log')
    const unstamped = join(dir, 'unstamped.log')
    writeFileSync(after, 'no stamp\n2026-09-13T12:00:01.000Z [config] x\n')
    writeFileSync(
      before,
      '2026-09-13T11:59:59.000Z [config] x\n2026-09-13T12:00:05.000Z [config] y\n',
    )
    writeFileSync(unstamped, 'nothing stamped\n')
    expect(writtenSince(after, since)).toBe(true)
    expect(writtenSince(before, since)).toBe(false)
    expect(writtenSince(unstamped, since)).toBe(true)
    expect(writtenSince(join(dir, 'missing.log'), since)).toBe(false)
  })
})

describe('tagContains', () => {
  type Answer = { status: number | null; stdout: string }
  const git = (answers: Record<string, Answer>) => {
    const asked: string[][] = []
    const run = (_command: string, args: string[]): Answer => {
      asked.push(args)
      return answers[args[0]] ?? { status: 128, stdout: '' }
    }
    return { run, asked }
  }
  const full = { status: 0, stdout: 'false\n' }

  it('answers null without a tag, and asks git nothing', () => {
    const { run, asked } = git({})
    expect(tagContains({ tag: '', commit: 'abc', cwd: '.', run })).toBeNull()
    expect(asked).toEqual([])
  })

  it('answers from merge-base in a full clone', () => {
    const contains = git({ 'rev-parse': full, 'merge-base': { status: 0, stdout: '' } })
    expect(tagContains({ tag: 'v1', commit: 'abc', cwd: '.', run: contains.run })).toBe(true)
    expect(contains.asked[1]).toEqual(['merge-base', '--is-ancestor', 'abc', 'refs/tags/v1'])
    const lacks = git({ 'rev-parse': full, 'merge-base': { status: 1, stdout: '' } })
    expect(tagContains({ tag: 'v1', commit: 'abc', cwd: '.', run: lacks.run })).toBe(false)
  })

  it('answers null for a shallow clone, and for a tag or commit git does not have', () => {
    const shallow = git({
      'rev-parse': { status: 0, stdout: 'true\n' },
      'merge-base': { status: 1, stdout: '' },
    })
    expect(tagContains({ tag: 'v1', commit: 'abc', cwd: '.', run: shallow.run })).toBeNull()
    const unknown = git({ 'rev-parse': full, 'merge-base': { status: 128, stdout: '' } })
    expect(tagContains({ tag: 'v1', commit: 'abc', cwd: '.', run: unknown.run })).toBeNull()
    const noGit = git({ 'rev-parse': { status: null, stdout: '' } })
    expect(tagContains({ tag: 'v1', commit: 'abc', cwd: '.', run: noGit.run })).toBeNull()
  })
})
