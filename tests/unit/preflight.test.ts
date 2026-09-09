// The commit-message half of `bin/preflight`, and one trap in particular.
//
// A closing keyword in a *commit* message is not a leak; it is a different
// mistake caught in the same place. It was written when `main` reached two
// servers whose boards numbered the same issues differently, so `Closes #22`
// closed an issue on each and one of them was the wrong issue; three were
// closed that way by changes that had nothing to do with them. There is one
// board now (ADR-030), so the check is precautionary - but a commit message
// is for why a change was made, and a second remote would bring the hazard
// back without announcing itself.
//
// The trap the last tests pin: five commits already in this history carry
// one, so the whole-history pass must never gain this check. If it did,
// `bin/preflight` would fail forever over a mistake that cannot be unmade,
// and the first person to meet that would reach for `--no-verify`.
//
// That is proved against a repository built here rather than against this
// one, because `ci.yml` checks out shallow and a shallow clone has no
// history to prove anything about. The check against this repository is
// kept as well, and skips where the history is not there.
//
// The script is bash, so this skips on Windows, where the hooks that run it
// do not run either.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const PREFLIGHT = join(root, 'bin/preflight')
const onWindows = process.platform === 'win32'

let dir: string
let n = 0

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'lc-preflight-'))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

interface Run {
  code: number
  out: string
}

function preflight(args: string[], cwd = root): Run {
  const r = spawnSync(PREFLIGHT, args, { cwd, encoding: 'utf8' })
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

/** A commit message in a file, the way the `commit-msg` hook hands one over. */
function message(text: string): Run {
  const file = join(dir, `msg-${(n += 1)}.txt`)
  writeFileSync(file, text)
  return preflight(['--message-file', file])
}

/** A throwaway repository, so the range form is not pinned to real history. */
function repoWith(messages: string[]): string {
  const repo = mkdtempSync(join(dir, 'repo-'))
  const git = (...args: string[]): void => {
    const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  }
  git('init', '--quiet', '--initial-branch=main')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'core.hooksPath', '/dev/null')
  for (const [i, text] of messages.entries()) {
    writeFileSync(join(repo, `f${i}.txt`), `${i}\n`)
    git('add', '-A')
    git('commit', '--quiet', '--no-verify', '-m', text)
  }
  return repo
}

describe.skipIf(onWindows)('a commit message being written', () => {
  it('is refused for every spelling GitHub acts on', () => {
    for (const text of [
      'Closes #22.',
      'closes #22',
      'CLOSES #22',
      'Close #1',
      'Closed #1',
      'Fixes #3',
      'Fix #3',
      'fixed #3',
      'Resolves #7',
      'resolve #7',
      'resolved #7',
      'Closes: #1',
      'Closes owner/repo#5',
      'Closes https://github.com/owner/repo/issues/9',
      'Do a thing\n\nWhy it was done.\n\nCloses #22.\n',
    ]) {
      const r = message(text)
      expect(r.code, `allowed: ${JSON.stringify(text)}`).toBe(1)
      expect(r.out).toContain('closes an issue by number')
    }
  })

  it('says where the keyword belongs and how to name an issue without one', () => {
    const r = message('Do a thing\n\nCloses #22.\n')
    // The advice has to be actionable, or it trains people to bypass.
    expect(r.out).toContain('pull request body')
    expect(r.out).toContain('closes issue 22')
    // It says what it cost, so nobody deletes it as bureaucracy.
    expect(r.out).toContain('closed the wrong issue')
    expect(r.out).toContain('nothing has been committed')
  })

  it('allows naming an issue without closing it', () => {
    for (const text of [
      'closes issue 22 by hand',
      'Explain why #22 was wrong',
      'This closes the dialog',
      'Fix the layout run',
      'Resolve the ADR-023 contradiction',
      // A word that merely ends in a keyword, and a bare reference.
      'prefixes #22 in a word',
      'See #22 for the reasoning',
    ]) {
      expect(message(text).code, `refused: ${JSON.stringify(text)}`).toBe(0)
    }
  })

  it('still refuses what it refused before', () => {
    // Assembled at run time on purpose: written literally, this file would
    // trip the pass that reads every tracked file, which is the scan it is
    // testing. The same trick the never list itself needs.
    const sessionLink = ['https://claude', '.ai/', 'code/session_example'].join('')
    const machinePath = ['/Us', 'ers/someone/Developer/thing'].join('')
    for (const text of [sessionLink, machinePath, 'someone' + '@gmail' + '.com']) {
      const r = message(`Do a thing\n\n${text}\n`)
      expect(r.code, `allowed: ${text}`).toBe(1)
      expect(r.out).toContain('must not be public')
    }
  })

  it('passes a clean message', () => {
    const r = message('Do a thing\n\nWhy it was done.\n')
    expect(r.code).toBe(0)
    expect(r.out).toContain('commit message clean')
  })
})

describe.skipIf(onWindows)('a range of commits', () => {
  it('refuses a range whose message closes an issue', () => {
    const repo = repoWith(['Add a thing', 'Add another\n\nCloses #22.\n'])
    const r = preflight(['--commit-range', 'HEAD~1..HEAD'], repo)
    expect(r.code).toBe(1)
    expect(r.out).toContain('closes an issue by number')
  })

  it('passes a range that does not', () => {
    const repo = repoWith(['Add a thing', 'Add another\n\nNaming issue 22 only.\n'])
    const r = preflight(['--commit-range', 'HEAD~1..HEAD'], repo)
    expect(r.code).toBe(0)
    expect(r.out).toContain('commit messages clean')
  })

  it('looks only at the range it was given', () => {
    // The offending commit is outside the range, which is the whole point
    // of naming one: a branch is not answerable for the history it sits on.
    const repo = repoWith(['Old and wrong\n\nCloses #22.\n', 'New and clean'])
    const r = preflight(['--commit-range', 'HEAD~1..HEAD'], repo)
    expect(r.code).toBe(0)
  })
})

/** Whether this checkout can show the history the last test is about. */
const historyLog = spawnSync('git', ['log', '--format=%B', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
}).stdout
const historyCarriesOne = /closes #\d+/i.test(historyLog ?? '')
const WHY = historyCarriesOne ? '' : ' (skipped: a shallow clone has no history to read)'

describe.skipIf(onWindows)('the whole-history pass', () => {
  it('passes a history that carries a closing keyword', () => {
    // Hermetic, so it holds wherever it runs. Adding the check to pass 2
    // would turn this repository red for good.
    const repo = repoWith(['Old and wrong\n\nCloses #22.\n', 'New and clean'])
    const r = preflight([], repo)
    expect(r.out, 'the history pass must not gain this check').not.toContain(
      'closes an issue by number',
    )
    expect(r.code, 'a history carrying a closing keyword must still pass').toBe(0)
  })

  it.skipIf(!historyCarriesOne)(`still passes on this repository${WHY}`, () => {
    // The claim the comment at the top of this file makes, checked against
    // the real thing where the real thing is available.
    expect(preflight([]).out).not.toContain('closes an issue by number')
  })
})

describe('the checks are wired to run', () => {
  it('runs on the commit message from the commit-msg hook', () => {
    const config = spawnSync('cat', ['.pre-commit-config.yaml'], {
      cwd: root,
      encoding: 'utf8',
    }).stdout
    expect(config).toContain('bin/preflight --message-file')
    expect(config).toContain('stages: [commit-msg]')
  })

  it('runs again in CI over the commits a pull request adds', () => {
    const workflow = spawnSync('cat', ['.github/workflows/preflight.yml'], {
      cwd: root,
      encoding: 'utf8',
    }).stdout
    expect(workflow).toContain('bin/preflight --commit-range')
    expect(workflow).toContain("if: github.event_name == 'pull_request'")
  })
})
