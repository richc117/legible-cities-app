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
// The links are the other half kept here (issue 227). A symbolic link's blob
// is its target, and `git grep` does not open one, so a link into someone's
// home folder passed every hook. The cases stage real links the way
// `git add -A` staged the one that was found, and one writes the index entry
// alone, the way a checkout on Windows holds a link.
//
// The script is bash, so this skips on Windows, where the hooks that run it
// do not run either.

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
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

/** One git command in a throwaway repository; what it printed. */
function gitIn(repo: string, args: string[], input?: string): string {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', input })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}

/** A real link, staged the way the one that was found was: `git add -A`. */
function stageLink(repo: string, path: string, target: string): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true })
  symlinkSync(target, join(repo, path))
  gitIn(repo, ['add', '-A'])
}

/** The same, committed with the hooks bypassed, which is what CI is for. */
function commitLink(repo: string, path: string, target: string, text: string): void {
  stageLink(repo, path, target)
  gitIn(repo, ['commit', '--quiet', '--no-verify', '-m', text])
}

/**
 * The id of something nobody wrote. It is a real id, of the right length
 * for this repository, and the object is in no store: asked for, git fails.
 * Nothing is deleted to make it, so no repository is damaged to be tested.
 */
function neverWritten(repo: string, what: string): string {
  return gitIn(repo, ['hash-object', '--stdin'], `never written: ${what}`).trim()
}

/** An entry written into the index as it stands, with nothing beside it. */
function stageEntry(repo: string, mode: string, id: string, path: string): void {
  gitIn(repo, ['update-index', '--add', '--cacheinfo', `${mode},${id},${path}`])
}

/**
 * A commit on `main` that names a tree nobody wrote: git lists it, prints
 * its message, and cannot say what it changed.
 */
function commitWithoutItsTree(repo: string): string {
  const who = 'Test <test@example.invalid> 0 +0000'
  const text = [
    `tree ${neverWritten(repo, 'a tree')}`,
    `parent ${gitIn(repo, ['rev-parse', 'HEAD']).trim()}`,
    `author ${who}`,
    `committer ${who}`,
    '',
    'Name a tree that is not here',
    '',
  ].join('\n')
  const id = gitIn(repo, ['hash-object', '-t', 'commit', '-w', '--stdin'], text).trim()
  gitIn(repo, ['update-ref', 'refs/heads/main', id])
  return gitIn(repo, ['rev-parse', '--short', id]).trim()
}

// Assembled at run time on purpose, like the paths further down: written
// out, a path under a home folder would fail the pass that reads every
// tracked file, which would be this file failing the scanner it tests.
const HOME_FOLDER = ['', 'Users', 'someone'].join('/')
const ADDRESS = ['someone', 'gmail.com'].join('@')

describe.skipIf(onWindows)('a symbolic link about to be committed', () => {
  it('is refused when it points into a home folder, by the name of the link', () => {
    const repo = repoWith(['Add a thing'])
    const target = `${HOME_FOLDER}/Developer/thing/node_modules`
    stageLink(repo, 'node_modules', target)
    const r = preflight([], repo)
    expect(r.code).toBe(1)
    expect(r.out).toContain('a symbolic link about to be committed')
    expect(r.out).toContain('node_modules: its target is an absolute path')
    // The target is the leak, and a CI log is public: it is never printed.
    expect(r.out).not.toContain(target)
    expect(r.out).not.toContain('someone')
    expect(r.out).not.toContain('preflight: clean')
  })

  it('is refused for an absolute target whatever it points at', () => {
    // None of these is on the never list, so only the rule about absolute
    // targets can refuse them. A drive letter and a share are absolute too.
    for (const target of ['/opt/thing', '/dev/null', 'C:\\tools\\thing', '\\\\host\\share']) {
      const repo = repoWith(['Add a thing'])
      stageLink(repo, 'deep/dir/link', target)
      const r = preflight([], repo)
      expect(r.code, `allowed: ${target}`).toBe(1)
      expect(r.out).toContain('deep/dir/link: its target is an absolute path')
    }
  })

  it('is refused when its target begins with what only a shell would expand', () => {
    // Nothing expands these in a link, so by its text each is a relative
    // path that stays inside the repository, and no other rule refuses it.
    for (const target of ['~/thing', '~someone/thing', '$HOME/thing', '%USERPROFILE%\\thing']) {
      const repo = repoWith(['Add a thing'])
      stageLink(repo, 'deep/dir/link', target)
      const r = preflight([], repo)
      expect(r.code, `allowed: ${target}`).toBe(1)
      expect(r.out).toContain(
        'deep/dir/link: its target begins with what only a shell would expand',
      )
      expect(r.out).not.toContain(target)
    }
  })

  it('is refused for a relative target that carries something on the never list', () => {
    // Both stay inside the repository, so only the pattern can refuse them.
    for (const target of [`..${HOME_FOLDER}/thing`, `notes/${ADDRESS}.txt`]) {
      const repo = repoWith(['Add a thing'])
      stageLink(repo, 'deep/dir/link', target)
      const r = preflight([], repo)
      expect(r.code, `allowed: ${target}`).toBe(1)
      expect(r.out).toContain('deep/dir/link: its target contains something that must not be')
      expect(r.out).not.toContain('someone')
    }
  })

  it('is refused when a relative target climbs out of the repository', () => {
    for (const [path, target] of [
      // The one that was found, as a worktree beside its checkout makes it.
      ['node_modules', '../checkout/node_modules'],
      ['deep/dir/link', '../../../f0.txt'],
      ['deep/dir/link', '..\\..\\..\\f0.txt'],
    ] as const) {
      const repo = repoWith(['Add a thing'])
      stageLink(repo, path, target)
      const r = preflight([], repo)
      expect(r.code, `allowed: ${path} -> ${target}`).toBe(1)
      expect(r.out).toContain(`${path}: its target climbs out of the repository`)
    }
  })

  it('is refused when it climbs after naming a folder, which may be a link', () => {
    // By its text this one stays inside, and the text is all there is to
    // read: were `other` a link, `..` would leave from wherever it points.
    const repo = repoWith(['Add a thing'])
    stageLink(repo, 'deep/dir/link', 'other/../f0.txt')
    const r = preflight([], repo)
    expect(r.code).toBe(1)
    expect(r.out).toContain('deep/dir/link: its target climbs back out of a folder it names')
  })

  it('passes a relative link that stays inside the repository', () => {
    const repo = repoWith(['Add a thing'])
    stageLink(repo, 'alias', 'f0.txt')
    stageLink(repo, 'deep/dir/up', '../../f0.txt')
    stageLink(repo, 'deep/here', './dir/up')
    // As far up as the top and no further.
    stageLink(repo, 'deep/dir/top', '../..')
    expect(gitIn(repo, ['ls-files', '-s']).match(/^120000 /gm)).toHaveLength(4)
    const r = preflight([], repo)
    expect(r.out).not.toContain('symbolic link')
    expect(r.code).toBe(0)
    expect(r.out).toContain('preflight: clean')
  })

  it('names every link it refuses, and only those', () => {
    const repo = repoWith(['Add a thing'])
    stageLink(repo, 'alias', 'f0.txt')
    stageLink(repo, 'first', '/opt/thing')
    // A name git would quote, were its listing read a line at a time.
    stageLink(repo, 'a folder/søndre link', '../../elsewhere')
    const r = preflight([], repo)
    expect(r.code).toBe(1)
    expect(r.out).toContain('first: its target is an absolute path')
    expect(r.out).toContain('a folder/søndre link: its target climbs out of the repository')
    expect(r.out).not.toContain('alias')
  })

  it('is refused when its target cannot be read', () => {
    // What was not read was not scanned, and clean would say it had been.
    const repo = repoWith(['Add a thing'])
    stageEntry(repo, '120000', neverWritten(repo, 'a target'), 'deep/dir/link')
    const r = preflight([], repo)
    expect(r.code).toBe(1)
    expect(r.out).toContain('deep/dir/link: its target could not be read')
    expect(r.out).not.toContain('preflight: clean')
  })

  it("leaves a submodule's entry alone", () => {
    // Mode 160000 names a commit in another repository. It is not a link,
    // there is no blob to read, and it is neither refused nor tripped over.
    const repo = repoWith(['Add a thing'])
    stageEntry(repo, '160000', gitIn(repo, ['rev-parse', 'HEAD']).trim(), 'vendor/sub')
    mkdirSync(join(repo, 'vendor/sub'), { recursive: true })
    expect(gitIn(repo, ['ls-files', '-s', 'vendor/sub'])).toMatch(/^160000 /)
    const r = preflight([], repo)
    expect(r.out).not.toContain('symbolic link')
    expect(r.code).toBe(0)
    expect(r.out).toContain('preflight: clean')
  })

  it('reads the index, not the working tree', () => {
    // Git for Windows may check a link out as a plain file that holds the
    // target. The entry is a link all the same, and it is the entry that
    // is committed. So: the entry written alone, and a plain file where the
    // link would be.
    const repo = repoWith(['Add a thing'])
    gitIn(repo, ['config', 'core.symlinks', 'false'])
    const id = gitIn(repo, ['hash-object', '-w', '--stdin'], '/opt/thing').trim()
    gitIn(repo, ['update-index', '--add', '--cacheinfo', `120000,${id},held-as-text`])
    writeFileSync(join(repo, 'held-as-text'), '/opt/thing')
    const r = preflight([], repo)
    expect(r.code).toBe(1)
    expect(r.out).toContain('held-as-text: its target is an absolute path')
  })
})

describe.skipIf(onWindows)('the links a range of commits adds', () => {
  it('refuses a link committed with the hooks bypassed, by commit and by name', () => {
    const repo = repoWith(['Add a thing'])
    commitLink(repo, 'node_modules', `${HOME_FOLDER}/Developer/thing/node_modules`, 'Add a link')
    const commit = gitIn(repo, ['rev-parse', '--short', 'HEAD']).trim()
    const r = preflight(['--commit-range', 'HEAD~1..HEAD'], repo)
    expect(r.code).toBe(1)
    expect(r.out).toContain('a commit in this range adds a symbolic link')
    expect(r.out).toContain(`${commit} node_modules: its target is an absolute path`)
    expect(r.out).not.toContain('someone')
    expect(r.out).not.toContain('commit messages clean')
  })

  it('refuses by the same three rules as the index', () => {
    const repo = repoWith(['Add a thing'])
    commitLink(repo, 'deep/dir/named', `..${HOME_FOLDER}/thing`, 'Add a link')
    commitLink(repo, 'deep/dir/climbs', '../../../f0.txt', 'Add another')
    commitLink(repo, 'deep/dir/absolute', '/opt/thing', 'And another')
    const r = preflight(['--commit-range', 'HEAD~3..HEAD'], repo)
    expect(r.code).toBe(1)
    expect(r.out).toContain('deep/dir/named: its target contains something that must not be')
    expect(r.out).toContain('deep/dir/climbs: its target climbs out of the repository')
    expect(r.out).toContain('deep/dir/absolute: its target is an absolute path')
  })

  it('refuses a link that an existing one was repointed to', () => {
    const repo = repoWith(['Add a thing'])
    commitLink(repo, 'alias', 'f0.txt', 'Add a link that stays inside')
    rmSync(join(repo, 'alias'))
    commitLink(repo, 'alias', '/opt/thing', 'Repoint it')
    const r = preflight(['--commit-range', 'HEAD~1..HEAD'], repo)
    expect(r.code).toBe(1)
    expect(r.out).toContain('alias: its target is an absolute path')
  })

  it('refuses one that a later commit in the range took out again', () => {
    // The index pass cannot see this one: the link is gone from the tree,
    // and still in a commit the branch carries in public.
    const repo = repoWith(['Add a thing'])
    commitLink(repo, 'node_modules', '/opt/thing/node_modules', 'Add a link')
    gitIn(repo, ['rm', '--quiet', 'node_modules'])
    gitIn(repo, ['commit', '--quiet', '--no-verify', '-m', 'Take it out'])
    expect(preflight([], repo).code).toBe(0)
    const r = preflight(['--commit-range', 'HEAD~2..HEAD'], repo)
    expect(r.code).toBe(1)
    expect(r.out).toContain('node_modules: its target is an absolute path')
  })

  it('reads a link that a merge itself adds', () => {
    // In neither parent, so only the merge carries it, and git shows
    // nothing for a merge unless it is asked to compare it with a parent.
    const repo = repoWith(['Add a thing'])
    gitIn(repo, ['checkout', '--quiet', '-b', 'side'])
    writeFileSync(join(repo, 'side.txt'), 'side\n')
    gitIn(repo, ['add', '-A'])
    gitIn(repo, ['commit', '--quiet', '--no-verify', '-m', 'Add a file on a branch'])
    gitIn(repo, ['checkout', '--quiet', 'main'])
    gitIn(repo, ['merge', '--quiet', '--no-ff', '--no-commit', 'side'])
    commitLink(repo, 'made-in-the-merge', '/opt/thing', 'Merge it')
    expect(gitIn(repo, ['rev-list', '--parents', '-1', 'HEAD']).trim().split(' ')).toHaveLength(3)
    const r = preflight(['--commit-range', 'HEAD~1..HEAD'], repo)
    expect(r.code).toBe(1)
    expect(r.out).toContain('made-in-the-merge: its target is an absolute path')
  })

  it('names a link git would quote, as it is called', () => {
    const repo = repoWith(['Add a thing'])
    commitLink(repo, 'a folder/søndre link', '../../elsewhere', 'Add a link')
    const r = preflight(['--commit-range', 'HEAD~1..HEAD'], repo)
    expect(r.code).toBe(1)
    expect(r.out).toContain('a folder/søndre link: its target climbs out of the repository')
  })

  it('refuses a link whose target begins with what only a shell would expand', () => {
    const repo = repoWith(['Add a thing'])
    commitLink(repo, 'deep/dir/link', '~someone/thing', 'Add a link')
    const r = preflight(['--commit-range', 'HEAD~1..HEAD'], repo)
    expect(r.code).toBe(1)
    expect(r.out).toContain('deep/dir/link: its target begins with what only a shell')
  })

  it('refuses a link whose target cannot be read', () => {
    // A commit made from a tree that names a blob nobody wrote.
    const repo = repoWith(['Add a thing'])
    stageEntry(repo, '120000', neverWritten(repo, 'a target'), 'deep/dir/link')
    const tree = gitIn(repo, ['write-tree', '--missing-ok']).trim()
    const made = gitIn(repo, ['commit-tree', '-p', 'HEAD', '-m', 'Add a link', tree]).trim()
    gitIn(repo, ['update-ref', 'refs/heads/main', made])
    const r = preflight(['--commit-range', 'HEAD~1..HEAD'], repo)
    expect(r.code).toBe(1)
    expect(r.out).toContain('deep/dir/link: its target could not be read')
    expect(r.out).not.toContain('clean')
  })

  it("leaves a submodule's entry alone", () => {
    const repo = repoWith(['Add a thing'])
    stageEntry(repo, '160000', gitIn(repo, ['rev-parse', 'HEAD']).trim(), 'vendor/sub')
    mkdirSync(join(repo, 'vendor/sub'), { recursive: true })
    gitIn(repo, ['commit', '--quiet', '--no-verify', '-m', 'Add a submodule'])
    expect(gitIn(repo, ['ls-tree', '-r', 'HEAD', 'vendor/sub'])).toMatch(/^160000 commit /)
    const r = preflight(['--commit-range', 'HEAD~1..HEAD'], repo)
    expect(r.out).not.toContain('symbolic link')
    expect(r.code).toBe(0)
    expect(r.out).toContain('commit messages clean')
  })

  it('refuses a commit it cannot read, by name, and does not call the range clean', () => {
    const repo = repoWith(['Add a thing'])
    const commit = commitWithoutItsTree(repo)
    // The range itself can be read: the commit is there, its tree is not.
    expect(gitIn(repo, ['rev-list', 'HEAD~1..HEAD']).trim()).not.toBe('')
    const r = preflight(['--commit-range', 'HEAD~1..HEAD'], repo)
    expect(r.code).toBe(1)
    expect(r.out).toContain('a commit in this range could not be read')
    expect(r.out).toContain(`\n${commit}\n`)
    expect(r.out).not.toContain('clean')
  })

  it('passes a range whose links stay inside the repository', () => {
    const repo = repoWith(['Add a thing'])
    commitLink(repo, 'deep/dir/up', '../../f0.txt', 'Add a link that stays inside')
    const r = preflight(['--commit-range', 'HEAD~1..HEAD'], repo)
    expect(r.out).not.toContain('symbolic link')
    expect(r.code).toBe(0)
    expect(r.out).toContain('commit messages clean')
  })

  it('looks only at the range it was given', () => {
    const repo = repoWith(['Add a thing'])
    commitLink(repo, 'node_modules', '/opt/thing/node_modules', 'Old and wrong')
    writeFileSync(join(repo, 'new.txt'), 'new\n')
    gitIn(repo, ['add', '-A'])
    gitIn(repo, ['commit', '--quiet', '--no-verify', '-m', 'New and clean'])
    const r = preflight(['--commit-range', 'HEAD~1..HEAD'], repo)
    expect(r.code).toBe(0)
  })
})

describe.skipIf(onWindows)('a range of commits that cannot be read', () => {
  it('is refused, and nothing is called clean', () => {
    // One commit, so there is no fifth parent; a name that is no commit; the
    // id a push gives as the base of a branch that is new; and an option,
    // which git would follow rather than read.
    const repo = repoWith(['Add a thing'])
    for (const range of ['no-such-ref..HEAD', 'HEAD~5..HEAD', `${'0'.repeat(40)}..HEAD`, '--all']) {
      const r = preflight(['--commit-range', range], repo)
      expect(r.code, `read: ${range}`).toBe(1)
      expect(r.out).toContain('could not be read, so nothing in it was scanned')
      expect(r.out).toContain(range)
      expect(r.out, `called clean: ${range}`).not.toContain('clean')
    }
  })

  it('is refused though what it would have found is in the history', () => {
    // The old behaviour at its worst: a keyword and a link, both there to
    // find, and a range that names neither, reported clean.
    const repo = repoWith(['Add a thing', 'Add another\n\nCloses #22.\n'])
    commitLink(repo, 'node_modules', '/opt/thing/node_modules', 'Add a link')
    const r = preflight(['--commit-range', 'main~9..main'], repo)
    expect(r.code).toBe(1)
    expect(r.out).not.toContain('clean')
  })

  it('is read the same way by the check and by what reads it afterwards', () => {
    // A range that is also the name of a file is one git will not guess
    // at. Were the check to read it and the passes not, they would find
    // nothing, which is the silence the check is there to end.
    const repo = repoWith(['Add a thing', 'Add another\n\nCloses #22.\n'])
    writeFileSync(join(repo, 'main'), 'a file with the name of the branch\n')
    commitLink(repo, 'node_modules', '/opt/thing/node_modules', 'Add a link')
    const r = preflight(['--commit-range', 'main'], repo)
    expect(r.code).toBe(1)
    expect(r.out).not.toContain('could not be read')
    expect(r.out).toContain('closes an issue by number')
    expect(r.out).toContain('node_modules: its target is an absolute path')
  })

  it('is not an empty range, which can be read and is clean', () => {
    // A branch with no commits of its own must not turn red.
    const repo = repoWith(['Add a thing'])
    expect(gitIn(repo, ['rev-list', 'HEAD..HEAD'])).toBe('')
    const r = preflight(['--commit-range', 'HEAD..HEAD'], repo)
    expect(r.out).not.toContain('could not be read')
    expect(r.code).toBe(0)
    expect(r.out).toContain('commit messages clean')
  })
})

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
