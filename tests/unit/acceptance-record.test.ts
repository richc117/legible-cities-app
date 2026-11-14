// The acceptance run's pure pieces (tests/acceptance/pure.mjs, A6-04): what
// a record is redacted to before it is pasted into a public issue, how a row
// is filled, how SHA256SUMS.txt is read, which log files a run may remove,
// and how the release's tag is asked whether it contains a commit. The run
// itself launches an installed app and is never part of `npm test`.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cell,
  checkBuildRun,
  checkDispatch,
  fillStep,
  makeRedact,
  parseSums,
  recordKind,
  rehearsalVersion,
  requireCandidateRecord,
  RESULTS,
  tagContains,
  tagSourceContains,
  writtenSince,
} from '../acceptance/pure.mjs'
import { FIELDS, RunRecord, STEP_TITLES } from '../acceptance/record'

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

// A feature told from the tag's own source, so its row needs no commit a
// squash merge would replace (issue 558's release label).
describe('tagSourceContains', () => {
  type Answer = { status: number | null; stdout: string; error?: Error }
  // Each of the three questions answered on its own: whether the tag is
  // there, whether its tree has the path, and the file's text.
  type Asked = 'tag' | 'path' | 'read'
  const git = (answers: Partial<Record<Asked, Answer>>) => {
    const asked: string[][] = []
    const run = (_command: string, args: string[]): Answer => {
      asked.push(args)
      const which: Asked =
        args[0] === 'cat-file' ? 'read' : args[3].endsWith('^{commit}') ? 'tag' : 'path'
      return answers[which] ?? { status: 128, stdout: '' }
    }
    return { run, asked }
  }
  const ok = { status: 0, stdout: 'f'.repeat(40) + '\n' }
  const ask = (run: ReturnType<typeof git>['run'], tag = 'v1.0.0-rc.2') =>
    tagSourceContains({ tag, path: 'src/main/index.ts', text: '__RELEASE_LABEL__', cwd: '.', run })

  it("answers from the tag's own file, true where it holds the text and false where not", () => {
    // Mutation: the file's text not read, every tag that has the file a yes,
    // so a release from before the label is expected to say its -rc.<N>.
    const holds = git({
      tag: ok,
      path: ok,
      read: { status: 0, stdout: 'version: __RELEASE_LABEL__ },\n' },
    })
    expect(ask(holds.run)).toBe(true)
    expect(holds.asked).toEqual([
      ['rev-parse', '--verify', '--quiet', 'refs/tags/v1.0.0-rc.2^{commit}'],
      ['rev-parse', '--verify', '--quiet', 'refs/tags/v1.0.0-rc.2:src/main/index.ts'],
      ['cat-file', 'blob', 'refs/tags/v1.0.0-rc.2:src/main/index.ts'],
    ])
    const lacks = git({
      tag: ok,
      path: ok,
      read: { status: 0, stdout: 'version: app.getVersion() },\n' },
    })
    expect(ask(lacks.run)).toBe(false)
  })

  it('answers false for a tag whose tree has no such file, and asks for no text', () => {
    // Mutation: git's "no such path" read as git failing, so a tag from
    // before the file is recorded as not checked rather than judged.
    const noFile = git({ tag: ok, path: { status: 1, stdout: '' } })
    expect(ask(noFile.run)).toBe(false)
    expect(noFile.asked).toHaveLength(2)
  })

  it('answers null without a tag, for a tag this clone lacks, and without git', () => {
    // Mutation: a tag git does not have read as one without the feature,
    // so a run from a clone that lacks it judges the row by the older rule.
    const none = git({})
    expect(ask(none.run, '')).toBeNull()
    expect(none.asked).toEqual([])
    const unknown = git({ tag: { status: 1, stdout: '' }, path: { status: 1, stdout: '' } })
    expect(ask(unknown.run)).toBeNull()
    expect(unknown.asked).toHaveLength(1)
    const noGit = git({ tag: { status: null, stdout: '' }, path: { status: 1, stdout: '' } })
    expect(ask(noGit.run)).toBeNull()
    const pathFails = git({ tag: ok, path: { status: 128, stdout: '' } })
    expect(ask(pathFails.run)).toBeNull()
  })

  it('answers null when reading the file fails or times out, whatever it printed', () => {
    // Mutation: the read's failure ignored, so a timed-out read that
    // printed part of the file, or none, reads as a tag without the feature.
    const timedOut = git({
      tag: ok,
      path: ok,
      read: { status: null, stdout: '', error: new Error('spawnSync git ETIMEDOUT') },
    })
    expect(ask(timedOut.run)).toBeNull()
    const failed = git({ tag: ok, path: ok, read: { status: 128, stdout: '' } })
    expect(ask(failed.run)).toBeNull()
  })
})

describe('STEP_TITLES', () => {
  // The record the run writes is the checklist's own results template, and a
  // person pastes one beside the other: a step renamed in one place and not
  // the other is a row nobody can match to its step (A5.6-08).
  const checklist = readFileSync(resolve(__dirname, '../../docs/acceptance.md'), 'utf8')

  it('is the results template, row for row', () => {
    const rows = [...checklist.matchAll(/^\| (\d+) \| (.+?) \| pass \/ fail \| \|$/gm)].map(
      ([, n, title]) => [Number(n), title],
    )
    expect(rows).toEqual(Object.entries(STEP_TITLES).map(([n, title]) => [Number(n), title]))
  })

  it('names every step as its heading does, the time left blank there', () => {
    const headings = [...checklist.matchAll(/^### (\d+)\. (.+)$/gm)].map(([, n, title]) => [
      Number(n),
      title,
    ])
    expect(headings).toEqual(
      Object.entries(STEP_TITLES).map(([n, title]) => [
        Number(n),
        title.replace(/ \(.*___.*\)$/, ''),
      ]),
    )
  })
})

describe('FIELDS', () => {
  // record.ts drops a field it does not list (applyPrior takes only FIELDS),
  // so a row added to the template and not here is a value the workflow
  // computed and the record never shows.
  const checklist = readFileSync(resolve(__dirname, '../../docs/acceptance.md'), 'utf8')

  it("is the results template's run table, row for row", () => {
    const table = /\n## Acceptance run\n\n\| \| \|\n\|---\|---\|\n((?:\| .*\|\n)+)/.exec(checklist)
    expect(table, 'the results template opens with its run table').not.toBeNull()
    const names = (table as RegExpExecArray)[1]
      .trim()
      .split('\n')
      .map((row) => row.split('|')[1].trim())
    expect(names).toEqual([...FIELDS])
  })
})

describe('the sitting', () => {
  // docs/acceptance-sitting.md is the person's part of the gate (ADR-063):
  // ten items in order, each opening on the minutes it takes, adding up to
  // the time the page says the sitting takes, and a results form whose rows
  // are the items, so a row in the issue can be matched to its item.
  const sitting = readFileSync(resolve(__dirname, '../../docs/acceptance-sitting.md'), 'utf8')
  const headings = [...sitting.matchAll(/^### (\d+)\. (.+)$/gm)].map(([, n, title]) => ({
    n: Number(n),
    title: title!,
  }))
  const minutes = [...sitting.matchAll(/^### (\d+)\. .+\n\n\*\*(\d+) minutes?\.\*\*/gm)].map(
    ([, n, m]) => [Number(n), Number(m)] as const,
  )

  it('has ten items, numbered in order, each opening on its minutes', () => {
    expect(headings.map((h) => h.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(
      minutes.map(([n]) => n),
      'every item opens on a line "**<n> minutes.**"',
    ).toEqual(headings.map((h) => h.n))
  })

  it('adds up to the time it says the sitting takes', () => {
    const said = /about (\d+)\s+minutes/i.exec(sitting)
    expect(said, 'the page says how long the sitting takes').not.toBeNull()
    const total = minutes.reduce((sum, [, m]) => sum + m, 0)
    expect(total).toBe(Number(said![1]))
  })

  it('has a results form with a row for each item, by its title', () => {
    const rows = [...sitting.matchAll(/^\| (\d+) \| (.+?) \| fine \/ finding \| \|$/gm)].map(
      ([, n, title]) => [Number(n), title],
    )
    expect(rows).toEqual(headings.map((h) => [h.n, h.title]))
  })
})

describe('the gate documents', () => {
  // The gate's documents send a reader to each other by heading (ADR-063
  // made them one gate), and a renamed heading breaks a link silently on
  // GitHub. Each link to a heading in a Markdown file must land on one.
  const docs = resolve(__dirname, '../../docs')
  const GATE = [
    'acceptance.md',
    'acceptance-sitting.md',
    'acceptance-stranger.md',
    'accessibility.md',
    'releasing.md',
  ]
  // A heading another pull request adds, allowed to be missing until it
  // lands; once it is there, the test below fails until its entry goes.
  const PENDING = new Set<string>([])

  /** GitHub's anchor for a heading's text. */
  const slug = (text: string): string =>
    text
      .replace(/[`*_]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s/g, '-')

  /** Every anchor a document's headings make, outside fenced blocks, a repeat numbered as GitHub does. */
  const anchorsOf = (text: string): Set<string> => {
    const seen = new Map<string, number>()
    const anchors = new Set<string>()
    let fenced = false
    for (const line of text.split('\n')) {
      if (/^\s*```/.test(line)) fenced = !fenced
      const heading = fenced ? null : /^#{1,6} (.+)$/.exec(line)
      if (!heading) continue
      const base = slug(heading[1]!)
      const count = seen.get(base) ?? 0
      seen.set(base, count + 1)
      anchors.add(count === 0 ? base : `${base}-${count}`)
    }
    return anchors
  }

  /** The anchors of a document named from docs/, or null where there is none. */
  const anchorsIn = (file: string): Set<string> | null => {
    try {
      return anchorsOf(readFileSync(join(docs, file), 'utf8'))
    } catch {
      return null
    }
  }

  /** A Markdown link to a heading: an optional relative path to a `.md`, then `#` and the anchor. */
  const LINK = /\]\(((?:[\w.-]+\/)*[\w.-]+\.md)?#([^)\s]+)\)/g

  /** Every link to a heading in a document under docs/, as `<path from docs/>#<anchor>`. */
  const linksIn = (name: string): string[] =>
    [...readFileSync(join(docs, name), 'utf8').matchAll(LINK)].map(
      ([, linked, anchor]) => `${posix.normalize(linked ?? name)}#${anchor}`,
    )

  it('makes anchors as GitHub does', () => {
    expect([...anchorsOf('# 22. Update over 0.1.0\n## The reviewer’s protocol\n')]).toEqual([
      '22-update-over-010',
      'the-reviewers-protocol',
    ])
    expect([
      ...anchorsOf('## A, b\n```\n## Not one\n```\n## A, b\n### `code` (optional)\n'),
    ]).toEqual(['a-b', 'a-b-1', 'code-optional'])
  })

  it('reads links by any relative path', () => {
    // linksIn reads the docs with LINK; the same pattern is checked here on a sample.
    const sample = '[a](../README.md#x) [b](adr/README.md#y) [c](#z) [d](acceptance.md#w)'
    const found = [...sample.matchAll(LINK)].map((m) => `${m[1] ?? 'here.md'}#${m[2]}`)
    expect(found).toEqual(['../README.md#x', 'adr/README.md#y', 'here.md#z', 'acceptance.md#w'])
  })

  it('links only to headings that are there', () => {
    const broken: string[] = []
    let links = 0
    for (const name of GATE)
      for (const target of linksIn(name)) {
        links += 1
        if (PENDING.has(target)) continue
        const [file, anchor] = target.split('#') as [string, string]
        const anchors = anchorsIn(file)
        if (anchors === null) broken.push(`${name}: ${target} (no such document)`)
        else if (!anchors.has(anchor)) broken.push(`${name}: ${target}`)
      }
    expect(links, 'the documents link to headings').toBeGreaterThan(40)
    expect(broken, 'links to a heading that is not there').toEqual([])
  })

  it('has no pending heading that has landed', () => {
    const landed = [...PENDING].filter((target) => {
      const [file, anchor] = target.split('#') as [string, string]
      return anchorsIn(file)?.has(anchor) === true
    })
    expect(landed, 'these headings are there now: take them out of PENDING').toEqual([])
  })
})

describe('checkDispatch', () => {
  it('takes a tag alone, or a run id alone', () => {
    expect(checkDispatch({ tag: 'v1.0.0-rc.4' })).toEqual({ kind: 'tag', tag: 'v1.0.0-rc.4' })
    expect(checkDispatch({ tag: '', run: '42' })).toEqual({ kind: 'rehearsal', run: '42' })
  })

  it('refuses both, with a sentence', () => {
    expect(() => checkDispatch({ tag: 'v1.0.0', run: '42' })).toThrow(/not both/)
  })

  it('refuses spaces around either input, rather than trimming what the workflow uses as given', () => {
    expect(() => checkDispatch({ tag: 'v1.0.0', run: ' ' })).toThrow(/spaces around/)
    expect(() => checkDispatch({ run: '42 ' })).toThrow(/spaces around/)
    expect(() => checkDispatch({ tag: ' v1.0.0' })).toThrow(/spaces around/)
  })

  it('refuses neither, with a sentence', () => {
    expect(() => checkDispatch({ tag: '', run: '' })).toThrow(/neither was given/)
    expect(() => checkDispatch({})).toThrow(/neither was given/)
  })

  it('refuses a tag that names no Release, and a run that is not an id', () => {
    expect(() => checkDispatch({ tag: 'main' })).toThrow(/neither v<X.Y.Z>/)
    expect(() => checkDispatch({ run: 'abc' })).toThrow(/not a run id/)
  })
})

describe('checkBuildRun', () => {
  const sha = 'a'.repeat(40)
  const good = {
    workflowDatabaseId: 1234,
    event: 'push',
    headSha: sha,
    headBranch: 'main',
    jobs: [
      { name: 'vendor', conclusion: 'success' },
      { name: 'package (darwin-arm64)', conclusion: 'success' },
      { name: 'package (win-x64)', conclusion: 'success' },
    ],
  }

  it('gives the commit and ref of a build run whose package jobs succeeded', () => {
    expect(checkBuildRun(good, '1234')).toEqual({
      commit: sha,
      branch: 'main',
      ref: 'refs/heads/main',
    })
  })

  it('names a tag push by its tag, and a branch by its branch', () => {
    const tagged = { ...good, headBranch: 'v1.0.0-rc.4' }
    expect(checkBuildRun(tagged, 1234).ref).toBe('refs/tags/v1.0.0-rc.4')
    expect(checkBuildRun({ ...good, headBranch: 'feature/x' }, 1234).ref).toBe(
      'refs/heads/feature/x',
    )
    expect(
      checkBuildRun({ ...good, event: 'workflow_dispatch', headBranch: 'main' }, 1234).ref,
    ).toBe('refs/heads/main')
  })

  it('refuses a build run dispatched on a tag, rather than judge it a branch build', () => {
    expect(() =>
      checkBuildRun({ ...good, event: 'workflow_dispatch', headBranch: 'v1.0.0-rc.4' }, 1234),
    ).toThrow(
      'a build run dispatched on a tag (v1.0.0-rc.4): accept the tag itself with tag=v1.0.0-rc.4',
    )
  })

  it('refuses a run of another workflow, by id and not by name', () => {
    expect(() => checkBuildRun({ ...good, workflowDatabaseId: 99 }, 1234)).toThrow(/not build.yml/)
    expect(() => checkBuildRun(good, '')).toThrow(/not build.yml/)
  })

  it('refuses a run with a package job that did not succeed, naming it', () => {
    const jobs = [...good.jobs, { name: 'package (darwin-x64)', conclusion: 'failure' }]
    expect(() => checkBuildRun({ ...good, jobs }, 1234)).toThrow(
      /package \(darwin-x64\) is failure/,
    )
  })

  it('refuses a run with no package jobs, and one that names no commit', () => {
    expect(() => checkBuildRun({ ...good, jobs: [good.jobs[0]] }, 1234)).toThrow(/no package jobs/)
    expect(() => checkBuildRun({ ...good, headSha: '' }, 1234)).toThrow(/no commit/)
    expect(() => checkBuildRun(null, 1234)).toThrow(/could not be read/)
  })
})

describe('a rehearsal and its record', () => {
  it('says the version a build reports: X.Y.Z+<sha7> for main or a branch, the tag for a tag push', () => {
    const commit = 'abcdef0123456789abcdef0123456789abcdef01'
    expect(rehearsalVersion('1.0.0', 'refs/heads/main', commit)).toBe('1.0.0+abcdef0')
    expect(rehearsalVersion('1.0.0', 'refs/heads/feature/x', commit)).toBe('1.0.0+abcdef0')
    expect(rehearsalVersion('1.0.0', 'refs/tags/v1.0.0-rc.4', commit)).toBe('1.0.0-rc.4')
    expect(() => rehearsalVersion('1.0.1', 'refs/tags/v1.0.0-rc.4', commit)).toThrow(/package.json/)
  })

  const rehearsal = () => {
    const dir = scratch()
    const prior = join(dir, 'prior.json')
    writeFileSync(
      prior,
      JSON.stringify({ rehearsal: { run: '77', commit: 'b'.repeat(40), ref: 'refs/heads/main' } }),
    )
    const record = new RunRecord(join(dir, 'r.md'))
    record.applyPrior(prior)
    return record
  }

  it('heads a rehearsal record as one, with its run and commit, and a candidate record plainly', () => {
    const text = rehearsal().render()
    expect(text).toContain("## Acceptance run: REHEARSAL, not a candidate's run")
    expect(text).toContain('build run 77 at commit bbbbbbb')
    expect(recordKind(text)).toBe('rehearsal')
    const candidate = new RunRecord(join(scratch(), 'c.md')).render()
    expect(candidate).not.toContain('REHEARSAL')
    expect(recordKind(candidate)).toBe('candidate')
  })

  it('reads a record with Windows line ends the same', () => {
    expect(recordKind(rehearsal().render().replace(/\n/g, '\r\n'))).toBe('rehearsal')
    expect(recordKind(new RunRecord(join(scratch(), 'c.md')).render().replace(/\n/g, '\r\n'))).toBe(
      'candidate',
    )
  })

  it("is refused where a candidate's record is required, and a candidate's is let through", () => {
    expect(() => requireCandidateRecord(rehearsal().render())).toThrow(/rehearsal/)
    const candidate = new RunRecord(join(scratch(), 'c.md')).render()
    expect(requireCandidateRecord(candidate)).toBe(candidate)
    expect(() => requireCandidateRecord('hello')).toThrow(/not an acceptance record/)
  })

  it('is refused by the CLI candidate check, with a sentence and a failing exit', () => {
    const dir = scratch()
    const cli = resolve(__dirname, '../acceptance/record-cli.mjs')
    const file = join(dir, 'r.md')
    writeFileSync(file, rehearsal().render())
    const refused = spawnSync('node', [cli, 'candidate', file], {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    })
    expect(refused.status).toBe(1)
    expect(refused.stderr).toMatch(/rehearsal/)
    writeFileSync(file, new RunRecord(join(dir, 'x.md')).render())
    expect(
      spawnSync('node', [cli, 'candidate', file], {
        encoding: 'utf8',
        timeout: 30_000,
        windowsHide: true,
      }).status,
    ).toBe(0)
  })

  it('has the CLI refuse a dispatch of both or neither, and name what it is given', () => {
    const cli = resolve(__dirname, '../acceptance/record-cli.mjs')
    const run = (...args: string[]) =>
      spawnSync('node', [cli, 'dispatch', ...args], {
        encoding: 'utf8',
        timeout: 30_000,
        windowsHide: true,
      })
    expect(run('v1.0.0', '5').status).toBe(1)
    expect(run('', '').status).toBe(1)
    expect(run('v1.0.0', '').stdout.trim()).toBe('tag')
    expect(run('', '5').stdout.trim()).toBe('rehearsal')
  })
})

/** What a rehearsal says of the attestation it has none of, in the record and the summaries. */
const NOT_ATTESTED = 'not verified (a rehearsal; no attestation)'

interface Step {
  job: string
  name: string
  text: string
  if: string
  shell: string
  run: string
  minutes: number
}

/** The steps of each job in a workflow, read by indentation as the workflow is written. */
function stepsOf(workflow: string): Step[] {
  const jobs = workflow.slice(workflow.indexOf('\njobs:\n'))
  const out: Step[] = []
  for (const section of jobs.split(/\n(?= {2}[a-z][\w-]*:\n)/)) {
    const job = /^ {2}([a-z][\w-]*):\n/.exec(section)?.[1]
    if (job === undefined) continue
    for (const text of section.split(/\n(?= {6}- )/).filter((b) => b.startsWith('      - '))) {
      const block = /^ {8}run: \|\n((?:(?: {10}[^\n]*)?\n)*)/m.exec(`${text}\n`)
      out.push({
        job,
        name: /^ {6}- (?:name|uses): (.+)$/m.exec(text)?.[1] ?? '',
        text,
        if: /^ {8}if: (.+)$/m.exec(text)?.[1] ?? '',
        shell: /^ {8}shell: (\w+)$/m.exec(text)?.[1] ?? 'bash',
        run:
          block !== null
            ? block[1].replace(/^ {10}/gm, '')
            : (/^ {8}run: (.+)$/m.exec(text)?.[1] ?? ''),
        minutes: Number(/^ {8}timeout-minutes: (\d+)$/m.exec(text)?.[1] ?? NaN),
      })
    }
  }
  return out
}

describe('acceptance.yml, dispatched with a run', () => {
  const workflow = readFileSync(
    resolve(__dirname, '../../.github/workflows/acceptance.yml'),
    'utf8',
  )
  const rehearsalStep = workflow.slice(
    workflow.indexOf('- name: Step 1, rehearsal'),
    workflow.indexOf('- name: Step 1, download the installer and check it'),
  )

  it('takes a run input beside the tag, neither required', () => {
    expect(workflow).toMatch(
      /inputs:\n {6}tag:[\s\S]*?required: false[\s\S]*? {6}run:[\s\S]*?required: false/,
    )
    expect(workflow).toContain('node "$cli" dispatch "$TAG" "$BUILD_RUN"')
  })

  it('downloads the installers of the run, and says what it could not check', () => {
    expect(rehearsalStep).toContain('gh run download "$BUILD_RUN"')
    expect(rehearsalStep).toContain('--name "installer-$TARGET"')
    expect(rehearsalStep).toContain('field \'Matches SHA256SUMS.txt?\' "$sums"')
    expect(rehearsalStep).toContain(
      "sums='not checked (a rehearsal; no Release, so no SHA256SUMS.txt)'",
    )
  })

  it("never records a rehearsal's step 1 as a pass, nor its checksum or attestation as yes", () => {
    expect(rehearsalStep).toContain(`attestation='${NOT_ATTESTED}'`)
    expect(rehearsalStep).toContain('field \'Attestation verified?\' "$attestation"')
    const results = [...rehearsalStep.matchAll(/ step 1 '?([a-z, ]+?)'? "/g)].map(([, r]) => r)
    expect(results).toEqual(['fail', 'fail', 'not automated'])
    expect(rehearsalStep).not.toMatch(/\? '?yes'?\n/)
    // The checklist quotes the record's words.
    const checklist = readFileSync(resolve(__dirname, '../../docs/acceptance.md'), 'utf8')
    expect(checklist.replace(/\s+/g, ' ')).toContain(NOT_ATTESTED)
  })

  it('keys both checkouts of at-tag on the dispatch result, never on the raw inputs', () => {
    expect(workflow).toMatch(/if: \$\{\{ env\.KIND == 'tag' \}\}\n {8}with:\n {10}ref: refs\/tags/)
    expect(workflow).toMatch(
      /if: \$\{\{ env\.KIND == 'rehearsal' \}\}\n {8}with:\n {10}ref: \$\{\{ env\.REHEARSAL_SHA/,
    )
    expect(workflow).not.toMatch(/if: \$\{\{ inputs\./)
  })

  it('has no bash 4 construct, for the macOS runner may have 3.2', () => {
    expect(workflow).not.toMatch(/mapfile|readarray|declare -A|\$\{[a-z_]+(,,|\^\^)\}|&>>/)
  })

  it("leaves the tag's step 1, with its checksum and attestation, to a tag alone", () => {
    const step = workflow.slice(
      workflow.indexOf('- name: Step 1, download the installer and check it'),
    )
    expect(step.slice(0, 120)).toContain("if: ${{ env.KIND == 'tag' }}")
    expect(workflow).toContain('gh attestation verify "$subject"')
    expect(rehearsalStep).not.toContain('gh attestation verify')
  })

  const steps = stepsOf(workflow)
  const step = (job: string, name: string): Step => {
    const found = steps.filter((s) => s.job === job && s.name === name)
    expect(found, `${job} has one step named ${name}`).toHaveLength(1)
    return found[0]!
  }

  it('reads both jobs and their steps', () => {
    expect([...new Set(steps.map((s) => s.job))]).toEqual(['acceptance', 'reader'])
    expect(steps.length).toBeGreaterThan(30)
  })

  it("finds the app by the Release's tag only in a step that runs for a tag alone", () => {
    // A step that reads the Release, its tag or its attestation has nothing
    // to read in a rehearsal: it runs on the dispatch's own result, a tag.
    const byTag =
      /gh release download "\$TAG"|refs\/tags\/\$\{?TAG|gh attestation verify|refs\/tags\/\$\{\{ inputs\.tag/
    const reading = steps.filter((s) => byTag.test(s.text.replace(/^\s*#.*$/gm, '')))
    expect(reading.map((s) => `${s.job}: ${s.name}`)).toEqual([
      'acceptance: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
      'acceptance: Step 1, download the installer and check it',
      'reader: The Mac app',
    ])
    for (const s of reading) expect(s.if, `${s.job}: ${s.name}`).toBe("${{ env.KIND == 'tag' }}")
  })

  it('checks the dispatch and the build run in both jobs, the run by its workflow id', () => {
    for (const job of ['acceptance', 'reader']) {
      const check = step(job, 'Refuse a dispatch that names no Release and no build run')
      expect(check.if, job).toBe('')
      expect(check.run, job).toContain('node "$cli" dispatch "$TAG" "$BUILD_RUN"')
      expect(check.run, job).toContain('echo "KIND=$kind" >> "$GITHUB_ENV"')
      expect(check.run, job).toContain('--json workflowDatabaseId,')
      expect(check.run, job).toContain('actions/workflows/build.yml" --jq .id')
      expect(check.run, job).toContain(
        'node "$cli" build-run "$RUNNER_TEMP/build-run.json" "$build_id"',
      )
      // Before any step that asks which it was.
      const mine = steps.filter((s) => s.job === job)
      const first = mine.findIndex((s) => s.if.includes('env.KIND'))
      expect(mine.indexOf(check), job).toBeLessThan(first)
    }
    expect(workflow.match(/^ {6}BUILD_RUN: \$\{\{ inputs\.run \}\}$/gm)).toHaveLength(2)
  })

  it("gives the reader the build run's own Mac app in a rehearsal, and never says it is attested", () => {
    const app = step('reader', 'The Mac app, rehearsal')
    expect(app.if).toBe("${{ env.KIND == 'rehearsal' }}")
    expect(app.run).toContain(
      'gh run download "$BUILD_RUN" --repo "$GITHUB_REPOSITORY" --name installer-darwin-arm64',
    )
    expect(app.run).toContain('echo "LEGIBLE_READER_APP=$apps/Legible Cities.app"')
    expect(app.run).toContain(`Attestation verified? ${NOT_ATTESTED}`)
    expect(app.run).not.toMatch(/gh release download|gh attestation verify|\? yes/)
  })

  it("withholds the run's id from a rehearsal's walk, so it writes no clause", () => {
    const walk = step('reader', 'The walkthrough, heard')
    const unset = walk.run.indexOf('if [ "$KIND" != tag ]; then unset GITHUB_RUN_ID; fi')
    expect(unset).toBeGreaterThan(-1)
    expect(unset).toBeLessThan(walk.run.indexOf('npm run test:reader'))
    // What that relies on: the spec writes a clause only when every fact,
    // the run's id among them, was read.
    const spec = readFileSync(resolve(__dirname, '../reader/voiceover.spec.ts'), 'utf8')
    expect(spec).toContain("run: process.env.GITHUB_RUN_ID ?? '',")
    expect(spec).toContain("if (Object.values(read).every((v) => v !== null && v !== '')) facts")
    expect(spec).toMatch(/if \(facts !== null\) \{\n {4}const clauses = clausesByTable/)
    expect(step('reader', "The transcript, as the job's summary").run).toContain(
      'if [ "${KIND:-}" = rehearsal ]; then',
    )
  })

  it("makes step 22's update with the build run's own installer", () => {
    expect(rehearsalStep).toContain('echo "ASSET=$rel" >> "$GITHUB_ENV"')
    expect(step('acceptance', 'Step 22, install the release over 0.1.0 on macOS').run).toContain(
      '"$DOWNLOAD/$ASSET"',
    )
    expect(step('acceptance', 'Step 22, install the release over 0.1.0 on Windows').run).toContain(
      '(Join-Path $env:DOWNLOAD $env:ASSET)',
    )
    for (const s of steps.filter((s) => s.name.startsWith('Step 22, '))) {
      expect(s.text, s.name).not.toMatch(/\$TAG|\$env:TAG|inputs\.tag|env\.KIND/)
    }
  })

  it("keeps the acceptance job's rehearsal step 1 to a rehearsal", () => {
    expect(step('acceptance', "Step 1, rehearsal, download the build run's installer").if).toBe(
      "${{ env.KIND == 'rehearsal' }}",
    )
  })

  it("heads a rehearsal's summary as one, and gives only a candidate's an issue title", () => {
    const summary = step('acceptance', "The record, as the job's summary").run
    const branches =
      /if \[ "\$KIND" = rehearsal \]; then\n([\s\S]*?)\n {4}else\n([\s\S]*?)\n {4}fi\n/.exec(
        summary,
      )
    expect(branches, 'the summary branches on a rehearsal').not.toBeNull()
    const [, then, otherwise] = branches as RegExpExecArray
    expect(then).toContain("**REHEARSAL, not a candidate's run:** build run $BUILD_RUN")
    expect(then).toContain('Issue title: none; a rehearsal has no issue.')
    expect(then).not.toContain('A6-04 run')
    expect(otherwise).toContain('Issue title: \\`A6-04 run: ')
  })

  it("names every artefact of a rehearsal apart, so its evidence is never fetched as a candidate's", () => {
    const uploads = steps.filter((s) => s.name.startsWith('actions/upload-artifact@'))
    expect(uploads.map((s) => s.job)).toEqual([...Array<string>(6).fill('acceptance'), 'reader'])
    for (const upload of uploads) {
      expect(/^ {10}name: (.+)$/m.exec(upload.text)?.[1], upload.job).toMatch(
        /^\$\{\{ env\.KIND == 'rehearsal' && 'rehearsal-' \|\| '' \}\}(acceptance|reader)-/,
      )
    }
    // The protocol says why its download fails on a rehearsal.
    const checklist = readFileSync(resolve(__dirname, '../../docs/acceptance.md'), 'utf8')
    expect(checklist.replace(/\s+/g, ' ')).toContain(
      "`rehearsal-acceptance-evidence-<target>` and the like, so this download fails on a rehearsal's run, by design.",
    )
  })

  it("has the gate check that a record is a candidate's before it goes on the gate issue", () => {
    const releasing = readFileSync(resolve(__dirname, '../../docs/releasing.md'), 'utf8')
    const automated = releasing.slice(
      releasing.indexOf('- **The automated run**'),
      releasing.indexOf('- **The scripted VoiceOver run**'),
    )
    expect(automated.replace(/\s+/g, ' ')).toContain(
      "Before a system's record goes on the gate issue, run `node tests/acceptance/record-cli.mjs candidate <record.md>` over it.",
    )
  })

  it('gives the reader job time for every step of either kind', () => {
    const limit = Number(
      /\n {2}reader:\n[\s\S]*?\n {4}timeout-minutes: (\d+)\n/.exec(workflow)?.[1],
    )
    const reader = steps.filter((s) => s.job === 'reader')
    for (const s of reader) expect(s.minutes, s.name).toBeGreaterThan(0)
    for (const kind of ['tag', 'rehearsal']) {
      const other = kind === 'tag' ? 'rehearsal' : 'tag'
      const total = reader
        .filter((s) => !s.if.includes(`env.KIND == '${other}'`))
        .reduce((sum, s) => sum + s.minutes, 0)
      expect(total, kind).toBeLessThanOrEqual(limit)
    }
  })
})

// macOS runs a workflow's bash steps with a bash that may be 3.2, where a
// construct a newer bash parses (a bare case pattern inside $( ... )) is a
// syntax error and the step dies before it runs a line.
describe.skipIf(process.platform === 'win32' || !existsSync('/bin/bash'))(
  "acceptance.yml's bash, under /bin/bash",
  () => {
    it('parses every bash step', () => {
      const workflow = readFileSync(
        resolve(__dirname, '../../.github/workflows/acceptance.yml'),
        'utf8',
      )
      const bash = stepsOf(workflow).filter((s) => s.shell === 'bash' && s.run !== '')
      expect(bash.length).toBeGreaterThan(20)
      const dir = scratch()
      for (const [i, s] of bash.entries()) {
        const file = join(dir, `step-${i}.sh`)
        // GitHub fills in each expression before bash reads the script.
        writeFileSync(file, s.run.replace(/\$\{\{[^}]*\}\}/g, 'X'))
        const r = spawnSync('/bin/bash', ['-n', file], {
          encoding: 'utf8',
          timeout: 10_000,
          windowsHide: true,
        })
        expect(r.stderr, `${s.job}: ${s.name}`).toBe('')
        expect(r.status, `${s.job}: ${s.name}`).toBe(0)
      }
    })
  },
)

// The acceptance specs run under Playwright, whose loader compiles each
// module it imports and cannot read one that uses import.meta: the first
// rehearsal's steps 3 to 20 never started, on a module Vitest loads
// happily. So the specs' own import graph is held to that, and Playwright
// is asked to load them as the workflow's step does.
describe("the acceptance specs' imports, as Playwright loads them", () => {
  const repo = resolve(__dirname, '../..')
  const SPECS = ['tests/acceptance/acceptance.spec.ts', 'tests/acceptance/upgrade.spec.ts']

  /** Every file of the repository a spec reaches through relative imports. */
  const graph = (): string[] => {
    const seen = new Set<string>()
    const visit = (file: string): void => {
      if (seen.has(file)) return
      seen.add(file)
      const text = readFileSync(file, 'utf8')
      for (const [, spec] of text.matchAll(/(?:from|import)\s*\(?\s*'(\.{1,2}\/[^']+)'/g)) {
        const base = resolve(file, '..', spec!)
        const found = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find(
          (candidate) => existsSync(candidate) && !statSync(candidate).isDirectory(),
        )
        expect(found, `${file} imports ${spec}`).toBeDefined()
        visit(found!)
      }
    }
    for (const spec of SPECS) visit(join(repo, spec))
    return [...seen].map((file) => posix.normalize(file.slice(repo.length + 1).replace(/\\/g, '/')))
  }

  it('reaches no module that uses import.meta', () => {
    const files = graph()
    expect(files).toEqual(expect.arrayContaining(['tests/acceptance/pure.mjs']))
    expect(files.length).toBeGreaterThan(10)
    // Code only: a comment may name it.
    const code = (file: string): string =>
      readFileSync(join(repo, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
    const using = files.filter((file) => /\bimport\.meta\b/.test(code(file)))
    expect(using, 'modules Playwright cannot load').toEqual([])
  })

  it('lists both specs under Playwright, with no app to run them on', () => {
    const env = { ...process.env }
    delete env.LEGIBLE_ACCEPTANCE_APP
    delete env.LEGIBLE_UPGRADE_APP
    // On a CI runner the spec refuses to run with no app named (it has lost
    // its install step); here no app is the point, so this listing is not CI's.
    delete env.CI
    delete env.GITHUB_ACTIONS
    const listed = spawnSync(
      process.execPath,
      [
        join(repo, 'node_modules', '@playwright', 'test', 'cli.js'),
        'test',
        '-c',
        'playwright.acceptance.config.ts',
        '--list',
      ],
      { cwd: repo, encoding: 'utf8', env, timeout: 120_000, windowsHide: true },
    )
    const said = `${listed.stdout}\n${listed.stderr}`
    expect(said).not.toMatch(/SyntaxError|Error:/)
    expect(listed.status, said).toBe(0)
    expect(said).toContain('Total: 2 tests in 2 files')
  })
})
