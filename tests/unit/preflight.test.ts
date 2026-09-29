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
// The last block holds the script to one sentence: it never says clean
// about something it could not read. An index, a history, a message file or
// a working tree that cannot be read is a refusal, in the script's own
// words and never in git's, which name files.
//
// Before that block come the states a healthy repository is ordinarily in -
// a detached HEAD, a linked worktree, a conflict, the second index git hands
// a hook - each of which must answer clean. A refusal of one of those would
// stop every commit, which is the failure a scanner is least forgiven.
//
// The script is bash, so this skips on Windows, where the hooks that run it
// do not run either.

import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
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

/**
 * The environment every git and every script here is given. git exports
 * where its repository, its working tree and its index are to whatever it
 * runs, a hook or `git rebase --exec 'npm test'`, and a git started with
 * those would make its throwaway commits in the repository they name: this
 * one. So nothing of git's is inherited, and a test that means one of those
 * variables passes it in `extra`.
 *
 * The ceiling is for the cases that need there to be no repository: git
 * looks upwards for one, and stops below the folder the throwaway ones are
 * made in, whatever a temporary folder happens to be inside.
 */
function env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const kept: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith('GIT_')) kept[name] = value
  }
  return { ...kept, GIT_CEILING_DIRECTORIES: tmpdir(), ...extra }
}

function preflight(
  args: string[],
  cwd = root,
  script = PREFLIGHT,
  extra: NodeJS.ProcessEnv = {},
): Run {
  const r = spawnSync(script, args, { cwd, encoding: 'utf8', env: env(extra) })
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

const CLEAN: Run = { code: 0, out: 'preflight: clean\n' }

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
    const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: env() })
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
function gitIn(
  repo: string,
  args: string[],
  input?: string,
  extra: NodeJS.ProcessEnv = {},
): string {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', input, env: env(extra) })
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
function stageEntry(
  repo: string,
  mode: string,
  id: string,
  path: string,
  extra: NodeJS.ProcessEnv = {},
): void {
  gitIn(repo, ['update-index', '--add', '--cacheinfo', `${mode},${id},${path}`], undefined, extra)
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

describe.skipIf(onWindows)('an option given nothing', () => {
  // A caller's variable that was never set. Each of these fell through to
  // the form that takes no option, or to a range git made up, scanned that
  // and called it clean, so the repository they run in is a clean one.
  it('is a usage error, and nothing is scanned in its place', () => {
    const repo = repoWith(['Add a thing'])
    for (const option of ['--message-file', '--commit-range']) {
      const r = preflight([option, ''], repo)
      expect(r.code, `${option} ''`).toBe(2)
      expect(r.out).toBe(
        `preflight: ${option} was given nothing to read\n` +
          'usage: preflight [--message-file FILE | --commit-range A..B]\n',
      )
    }
  })

  it('is one too when it is one side of a range', () => {
    // git takes HEAD for the side that is not there, so `..HEAD` is a range
    // with no commit in it: it can be read, and it would be clean.
    const repo = repoWith(['Add a thing', 'Add another\n\nCloses #22.\n'])
    for (const range of ['..', 'HEAD~1..', '..HEAD', '...', 'HEAD~1...', '...HEAD']) {
      const r = preflight(['--commit-range', range], repo)
      expect(r.code, `read: ${range}`).toBe(2)
      expect(r.out).toContain('this range names only one of its ends')
      expect(r.out).toContain(`\n${range}\n`)
      expect(r.out, `called clean: ${range}`).not.toContain('clean')
    }
  })

  it('leaves a range with both its ends as it was', () => {
    const repo = repoWith(['Add a thing', 'Add another'])
    for (const range of ['HEAD~1..HEAD', 'HEAD~1...HEAD', 'main']) {
      const r = preflight(['--commit-range', range], repo)
      expect(r, range).toEqual({
        code: 0,
        out: 'preflight: commit messages clean, and the links these commits add\n',
      })
    }
  })
})

describe.skipIf(onWindows)('a commit message in a file, from wherever it is named', () => {
  it('is read from where the caller stands, not from the top of the repository', () => {
    const repo = repoWith(['Add a thing'])
    const below = join(repo, 'docs')
    mkdirSync(below)
    writeFileSync(join(below, 'message.txt'), 'Do a thing\n\nWhy it was done.\n')
    writeFileSync(join(below, 'closes.txt'), 'Do a thing\n\nCloses #22.\n')
    const clean = { code: 0, out: 'preflight: commit message clean\n' }
    expect(preflight(['--message-file', 'message.txt'], below)).toEqual(clean)
    expect(preflight(['--message-file', '../docs/message.txt'], below)).toEqual(clean)
    expect(preflight(['--message-file', join(below, 'message.txt')], below)).toEqual(clean)
    expect(preflight(['--message-file', 'docs/message.txt'], repo)).toEqual(clean)
    const r = preflight(['--message-file', 'closes.txt'], below)
    expect(r.code).toBe(1)
    expect(r.out).toContain('closes an issue by number')
  })
})

describe.skipIf(onWindows)('a file about to be committed that cannot be read', () => {
  it('is refused by its path, where git grep answered as if it had looked', () => {
    const repo = repoWith(['Add a thing'])
    const id = neverWritten(repo, 'a file')
    stageEntry(repo, '100644', id, 'notes/ghost.txt')
    // What the file pass goes by, and why it is not enough: nothing found.
    const grep = spawnSync('git', ['grep', '--cached', '-nE', 'x', '--', '.'], {
      cwd: repo,
      encoding: 'utf8',
      env: env(),
    })
    expect(grep.status).toBe(1)
    expect(grep.stderr).toContain('unable to read')
    expect(preflight([], repo)).toEqual({
      code: 1,
      out:
        'preflight: a file about to be committed could not be read, so it was not scanned:\n' +
        'notes/ghost.txt\n',
    })
  })

  it('is the one named, among those that can be', () => {
    // git answers for the blobs in the order it was asked, with no path,
    // so the path is known by counting. Among others, and with a name git
    // would quote and an executable, the count has to hold.
    const repo = repoWith(['Add a thing', 'Add another'])
    const there = gitIn(repo, ['rev-parse', ':f0.txt']).trim()
    stageEntry(repo, '100644', there, 'a folder/first.txt')
    stageEntry(repo, '100755', neverWritten(repo, 'one'), 'a folder/søndre fil.txt')
    stageEntry(repo, '100644', there, 'a folder/third.txt')
    stageEntry(repo, '100644', neverWritten(repo, 'two'), 'z-last.txt')
    expect(preflight([], repo)).toEqual({
      code: 1,
      out:
        'preflight: a file about to be committed could not be read, so it was not scanned:\n' +
        'a folder/søndre fil.txt\n' +
        'z-last.txt\n',
    })
  })

  it('is refused too when git cannot be asked whether the files are there', () => {
    // A git put first on the path that fails that one question and is the
    // real one for every other.
    const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
    const shim = mkdtempSync(join(dir, 'shim-'))
    const asked = 'case "$*" in *--batch-check*) exit 128 ;; esac'
    writeFileSync(join(shim, 'git'), `#!/bin/sh\n${asked}\nexec '${real}' "$@"\n`)
    chmodSync(join(shim, 'git'), 0o755)
    const repo = repoWith(['Add a thing', 'Add another'])
    const r = preflight([], repo, PREFLIGHT, { PATH: `${shim}:${process.env.PATH}` })
    expect(r).toEqual({
      code: 1,
      out:
        'preflight: the files in the index could not be checked for being there ' +
        '(git cat-file answered 128, for 0 of 2), ' +
        'so not all of them are known to have been scanned.\n',
    })
  })
})

describe.skipIf(onWindows)('a file named as a commit is', () => {
  it('does not make the commit one that cannot be read', () => {
    const repo = repoWith(['Add a thing', 'Add another'])
    const short = gitIn(repo, ['rev-parse', '--short', 'HEAD']).trim()
    writeFileSync(join(repo, short), 'a file with the name of a commit\n')
    writeFileSync(join(repo, gitIn(repo, ['rev-parse', 'HEAD']).trim()), 'and its whole name\n')
    expect(preflight(['--commit-range', 'HEAD~1..HEAD'], repo)).toEqual({
      code: 0,
      out: 'preflight: commit messages clean, and the links these commits add\n',
    })
  })

  it('does not hide the link that commit adds, either', () => {
    const repo = repoWith(['Add a thing'])
    commitLink(repo, 'node_modules', '/opt/thing/node_modules', 'Add a link')
    const short = gitIn(repo, ['rev-parse', '--short', 'HEAD']).trim()
    writeFileSync(join(repo, short), 'a file with the name of a commit\n')
    const r = preflight(['--commit-range', 'HEAD~1..HEAD'], repo)
    expect(r.code).toBe(1)
    expect(r.out).toContain(`${short} node_modules: its target is an absolute path`)
    expect(r.out).not.toContain('could not be read')
  })
})

describe.skipIf(onWindows)('the states a healthy repository is ordinarily in', () => {
  it('is clean on a detached HEAD, which is what CI checks out', () => {
    const repo = repoWith(['Add a thing', 'Add another'])
    gitIn(repo, ['checkout', '--quiet', '--detach'])
    expect(spawnSync('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: repo, env: env() }).status).toBe(
      1,
    )
    expect(preflight([], repo)).toEqual(CLEAN)
  })

  it('is clean in a linked worktree, run from inside it', () => {
    const repo = repoWith(['Add a thing', 'Add another'])
    const linked = join(mkdtempSync(join(dir, 'linked-')), 'tree')
    gitIn(repo, ['worktree', 'add', '--quiet', '-b', 'side', linked])
    // Not a folder called .git there, but a file that says where it is.
    expect(readFileSync(join(linked, '.git'), 'utf8')).toMatch(/^gitdir: /)
    expect(preflight([], linked)).toEqual(CLEAN)
    mkdirSync(join(linked, 'below'))
    expect(preflight([], join(linked, 'below'))).toEqual(CLEAN)
  })

  it('refuses a link staged in a linked worktree, and not in the one beside it', () => {
    const repo = repoWith(['Add a thing'])
    const linked = join(mkdtempSync(join(dir, 'linked-')), 'tree')
    gitIn(repo, ['worktree', 'add', '--quiet', '-b', 'side', linked])
    stageLink(linked, 'node_modules', '../../elsewhere/node_modules')
    const r = preflight([], linked)
    expect(r.code).toBe(1)
    expect(r.out).toContain('node_modules: its target climbs out of the repository')
    expect(preflight([], repo)).toEqual(CLEAN)
  })

  it('is clean on an orphan branch with no commit yet', () => {
    const repo = repoWith(['Add a thing'])
    gitIn(repo, ['checkout', '--quiet', '--orphan', 'fresh'])
    expect(preflight([], repo)).toEqual(CLEAN)
  })

  it('is clean on a branch with no commit and an index with nothing in it', () => {
    const repo = mkdtempSync(join(dir, 'repo-'))
    gitIn(repo, ['init', '--quiet', '--initial-branch=main'])
    expect(gitIn(repo, ['ls-files', '-s'])).toBe('')
    expect(preflight([], repo)).toEqual(CLEAN)
  })

  it('is clean over an index with only a submodule in it', () => {
    // Entries, and not one of them with a blob to ask after.
    const repo = mkdtempSync(join(dir, 'repo-'))
    gitIn(repo, ['init', '--quiet', '--initial-branch=main'])
    stageEntry(repo, '160000', neverWritten(repo, 'a commit elsewhere'), 'vendor/sub')
    mkdirSync(join(repo, 'vendor/sub'), { recursive: true })
    expect(preflight([], repo)).toEqual(CLEAN)
  })

  it('is clean while a conflict is being settled', () => {
    const repo = repoWith(['Add a thing'])
    gitIn(repo, ['checkout', '--quiet', '-b', 'side'])
    writeFileSync(join(repo, 'f0.txt'), 'theirs\n')
    gitIn(repo, ['commit', '--quiet', '--no-verify', '-am', 'Say one thing'])
    gitIn(repo, ['checkout', '--quiet', 'main'])
    writeFileSync(join(repo, 'f0.txt'), 'ours\n')
    gitIn(repo, ['commit', '--quiet', '--no-verify', '-am', 'Say another'])
    const merge = spawnSync('git', ['merge', 'side'], { cwd: repo, encoding: 'utf8', env: env() })
    expect(merge.status).not.toBe(0)
    // One path, at the three stages of a conflict.
    expect(
      gitIn(repo, ['ls-files', '-s']).match(/^100644 [0-9a-f]+ [123]\tf0\.txt$/gm),
    ).toHaveLength(3)
    expect(preflight([], repo)).toEqual(CLEAN)
  })

  it('is clean over a file meant to be added and not added yet', () => {
    const repo = repoWith(['Add a thing'])
    writeFileSync(join(repo, 'later.txt'), 'not staged yet\n')
    gitIn(repo, ['add', '--intent-to-add', 'later.txt'])
    expect(preflight([], repo)).toEqual(CLEAN)
  })

  it('is clean in a shallow clone', () => {
    const repo = repoWith(['Add a thing', 'Add another', 'And another'])
    const shallow = join(mkdtempSync(join(dir, 'shallow-')), 'clone')
    gitIn(dir, ['clone', '--quiet', '--depth', '1', `file://${repo}`, shallow])
    expect(gitIn(shallow, ['rev-parse', '--is-shallow-repository']).trim()).toBe('true')
    expect(gitIn(shallow, ['rev-list', '--count', 'HEAD']).trim()).toBe('1')
    expect(preflight([], shallow)).toEqual(CLEAN)
  })

  it('is clean in a sparse checkout, where a file is tracked and not there', () => {
    const repo = repoWith(['Add a thing'])
    for (const folder of ['kept', 'left-out']) {
      mkdirSync(join(repo, folder))
      writeFileSync(join(repo, folder, 'file.txt'), `${folder}\n`)
    }
    gitIn(repo, ['add', '-A'])
    gitIn(repo, ['commit', '--quiet', '--no-verify', '-m', 'Add two folders'])
    gitIn(repo, ['sparse-checkout', 'set', 'kept'])
    expect(existsSync(join(repo, 'left-out/file.txt'))).toBe(false)
    expect(gitIn(repo, ['ls-files'])).toContain('left-out/file.txt')
    expect(preflight([], repo)).toEqual(CLEAN)
  })

  describe('and the second index git hands a hook', () => {
    // `git commit -a` and a commit of named paths build the commit in an
    // index of their own and tell the hook where it is. That index is what
    // will be committed, so that is the one to read.
    function withASecondIndex(): { repo: string; second: NodeJS.ProcessEnv } {
      const repo = repoWith(['Add a thing'])
      const file = join(repo, '.git/second-index')
      copyFileSync(join(repo, '.git/index'), file)
      return { repo, second: { GIT_INDEX_FILE: file } }
    }

    it('refuses a link that is only in that one', () => {
      const { repo, second } = withASecondIndex()
      const id = gitIn(repo, ['hash-object', '-w', '--stdin'], '/opt/thing/node_modules').trim()
      stageEntry(repo, '120000', id, 'node_modules', second)
      expect(preflight([], repo)).toEqual(CLEAN)
      const r = preflight([], repo, PREFLIGHT, second)
      expect(r.code).toBe(1)
      expect(r.out).toContain('node_modules: its target is an absolute path')
    })

    it('refuses a file on the never list that is only in that one', () => {
      const { repo, second } = withASecondIndex()
      const text = `see ${HOME_FOLDER}/thing\n`
      const id = gitIn(repo, ['hash-object', '-w', '--stdin'], text).trim()
      stageEntry(repo, '100644', id, 'notes.txt', second)
      expect(preflight([], repo)).toEqual(CLEAN)
      const r = preflight([], repo, PREFLIGHT, second)
      expect(r.code).toBe(1)
      expect(r.out).toContain('notes.txt:1:see ')
    })

    it('is clean over a clean one, whatever the first one holds', () => {
      const { repo, second } = withASecondIndex()
      const id = gitIn(repo, ['hash-object', '-w', '--stdin'], '/opt/thing/node_modules').trim()
      stageEntry(repo, '120000', id, 'node_modules')
      expect(preflight([], repo).code).toBe(1)
      // The link is in the working tree's view of things, as an entry with
      // no file: the look for private files does not mind it.
      expect(preflight([], repo, PREFLIGHT, second)).toEqual(CLEAN)
    })
  })
})

describe.skipIf(onWindows)('the helpers of this file', () => {
  it('do not follow what git exports to what it runs', () => {
    // As under `git rebase --exec 'npm test'`. Were these followed, the
    // throwaway repository would be made where they say, and its commits
    // with it.
    const told = mkdtempSync(join(dir, 'told-'))
    const before = { ...process.env }
    process.env.GIT_DIR = join(told, 'named.git')
    process.env.GIT_WORK_TREE = told
    process.env.GIT_INDEX_FILE = join(told, 'named-index')
    try {
      const repo = repoWith(['Add a thing'])
      expect(existsSync(join(repo, '.git/HEAD'))).toBe(true)
      expect(existsSync(join(told, 'named.git'))).toBe(false)
      expect(existsSync(join(told, 'named-index'))).toBe(false)
      expect(gitIn(repo, ['rev-list', '--count', 'HEAD']).trim()).toBe('1')
      expect(preflight([], repo)).toEqual(CLEAN)
    } finally {
      for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) {
        if (before[name] === undefined) delete process.env[name]
        else process.env[name] = before[name]
      }
    }
  })
})

/** A repository whose index is not one: what was there, written over. */
function withoutAnIndex(): string {
  const repo = repoWith(['Add a thing'])
  writeFileSync(join(repo, '.git/index'), 'not an index at all')
  return repo
}

/**
 * A history that cannot be read to its end: the tip is there, and so is the
 * commit before it, which names a parent nobody wrote. git prints the tip
 * and then fails. Made with git's own plumbing, which takes a parent's id
 * on trust, so nothing is deleted to make it.
 */
function withoutAParent(message: string): string {
  const repo = repoWith(['Add a thing'])
  const who = 'Test <test@example.invalid> 0 +0000'
  const tree = gitIn(repo, ['rev-parse', 'HEAD^{tree}']).trim()
  const commit = (parent: string, text: string): string =>
    gitIn(
      repo,
      ['hash-object', '-t', 'commit', '-w', '--stdin'],
      [`tree ${tree}`, `parent ${parent}`, `author ${who}`, `committer ${who}`, '', text, ''].join(
        '\n',
      ),
    ).trim()
  const before = commit(neverWritten(repo, 'a parent'), 'Names a parent nobody wrote')
  gitIn(repo, ['update-ref', 'refs/heads/main', commit(before, message)])
  return repo
}

/** What git says of its own accord, and where the repository is. */
function expectOnlyItsOwnWords(r: Run, repo: string): void {
  expect(r.out).not.toMatch(/fatal|error:|warning:/i)
  expect(r.out).not.toContain('.git')
  expect(r.out).not.toContain(repo)
  for (const line of r.out.trim().split('\n')) expect(line).toMatch(/^preflight: /)
}

describe.skipIf(onWindows)('what could not be read is not called clean', () => {
  it('refuses to search the files of an index it cannot read', () => {
    const repo = withoutAnIndex()
    const r = preflight([], repo)
    expect(r.code).toBe(1)
    expect(r.out).toMatch(
      /preflight: the files in the index could not be searched \(git grep answered \d+\), so none of them was scanned\./,
    )
    expect(r.out).not.toContain('clean')
    expectOnlyItsOwnWords(r, repo)
  })

  it('refuses to look for links in an index it cannot read', () => {
    const repo = withoutAnIndex()
    const r = preflight([], repo)
    expect(r.code).toBe(1)
    expect(r.out).toMatch(
      /preflight: the index could not be read \(git ls-files answered \d+\), so no link in it was scanned\./,
    )
    expect(r.out).not.toContain('clean')
  })

  it('refuses to look for private files in a working tree it cannot list', () => {
    const repo = withoutAnIndex()
    const r = preflight([], repo)
    expect(r.code).toBe(1)
    expect(r.out).toMatch(
      /preflight: the working tree could not be listed \(git status answered \d+\), so it was not looked through/,
    )
  })

  it('refuses a history it cannot read to the end', () => {
    const repo = withoutAParent('Add another')
    const r = preflight([], repo)
    expect(r.code).toBe(1)
    expect(r.out).toMatch(
      /preflight: the commit messages in the history could not be read \(git log answered \d+\), so not all of them/,
    )
    expect(r.out).not.toContain('clean')
    expectOnlyItsOwnWords(r, repo)
  })

  it('still reports what it did read of such a history', () => {
    const repo = withoutAParent(`Write to ${ADDRESS}`)
    const r = preflight([], repo)
    expect(r.code).toBe(1)
    expect(r.out).toContain('the commit messages in the history could not be read')
    expect(r.out).toContain('an unpushed commit message contains something that must not be')
  })

  it('refuses a branch whose own reference cannot be read', () => {
    // HEAD names no commit here either, as on a branch with none yet, and
    // git will say so in the same words. It is not the same thing. What
    // tells them apart is whether git can say which branch HEAD is on.
    for (const written of ['not a reference\n', '', 'abc123\n']) {
      const repo = repoWith(['Add a thing'])
      writeFileSync(join(repo, '.git/refs/heads/main'), written)
      const r = preflight([], repo)
      expect(r.code, `read: ${JSON.stringify(written)}`).toBe(1)
      expect(r.out).toContain('preflight: the history could not be read')
      expect(r.out).not.toContain('clean')
    }
  })

  it('refuses a branch whose reference names a commit that is not there', () => {
    // This one HEAD does name, so it is the reading of the history that
    // fails, and says so.
    const repo = repoWith(['Add a thing'])
    writeFileSync(join(repo, '.git/refs/heads/main'), `${neverWritten(repo, 'a commit')}\n`)
    const r = preflight([], repo)
    expect(r.code).toBe(1)
    expect(r.out).toContain('the commit messages in the history could not be read')
    expect(r.out).not.toContain('clean')
  })

  it('passes a repository nothing has been committed to yet', () => {
    // Nothing to read is not a failure to read, and a first commit must
    // be able to pass its own hook.
    const repo = mkdtempSync(join(dir, 'repo-'))
    gitIn(repo, ['init', '--quiet', '--initial-branch=main'])
    writeFileSync(join(repo, 'f0.txt'), '0\n')
    gitIn(repo, ['add', '-A'])
    const r = preflight([], repo)
    expect(r.out).toBe('preflight: clean\n')
    expect(r.code).toBe(0)
  })

  it('refuses where there is no repository to read', () => {
    const nowhere = mkdtempSync(join(dir, 'plain-'))
    for (const args of [[], ['--commit-range', 'HEAD~1..HEAD']]) {
      const r = preflight(args, nowhere)
      expect(r.code).toBe(1)
      expect(r.out).toMatch(
        /^preflight: no repository could be read from here \(git rev-parse answered \d+\), so nothing was scanned\.\n$/,
      )
    }
  })

  it('scans a commit message where there is no repository, since it needs none', () => {
    const nowhere = mkdtempSync(join(dir, 'plain-'))
    const clean = join(nowhere, 'clean.txt')
    const closes = join(nowhere, 'closes.txt')
    writeFileSync(clean, 'Do a thing\n\nWhy it was done.\n')
    writeFileSync(closes, 'Do a thing\n\nCloses #22.\n')
    expect(preflight(['--message-file', clean], nowhere)).toEqual({
      code: 0,
      out: 'preflight: commit message clean\n',
    })
    expect(preflight(['--message-file', closes], nowhere).code).toBe(1)
  })

  it('refuses a commit message it cannot read', () => {
    for (const file of [join(dir, 'no-such-message.txt'), dir]) {
      const r = preflight(['--message-file', file])
      expect(r.code).toBe(1)
      expect(r.out).toContain('preflight: this commit message could not be read')
      expect(r.out).toContain('so it was not scanned')
      expect(r.out).not.toContain('clean')
      // Not grep's words, which name the file.
      expect(r.out).not.toContain(file)
    }
  })

  describe('and neither is a search that could not be run', () => {
    // The pattern is the script's own, so the way to a search that cannot
    // be run is a copy of the script whose pattern grep cannot compile. It
    // is what a slip while adding to the never list would make, and before
    // this it made a script that called everything clean.
    let broken: string

    beforeAll(() => {
      const text = readFileSync(PREFLIGHT, 'utf8')
      expect(text.match(/^pattern='/gm)).toHaveLength(1)
      broken = join(dir, 'preflight-with-a-pattern-that-cannot-compile')
      writeFileSync(broken, text.replace(/^pattern='/m, "pattern='("))
      chmodSync(broken, 0o755)
    })

    it('in a commit message', () => {
      const file = join(dir, 'a-message.txt')
      writeFileSync(file, `Do a thing\n\n${HOME_FOLDER}/thing\n`)
      const r = preflight(['--message-file', file], root, broken)
      expect(r.code).toBe(1)
      expect(r.out).toMatch(
        /^preflight: this commit message could not be searched \(grep answered \d+\), so it was not scanned\.\n$/,
      )
    })

    it('in the index, its links and the history', () => {
      const repo = repoWith(['Add a thing'])
      stageLink(repo, 'alias', 'f0.txt')
      const r = preflight([], repo, broken)
      expect(r.code).toBe(1)
      expect(r.out).toMatch(
        /the files in the index could not be searched \(git grep answered \d+\)/,
      )
      expect(r.out).toContain('alias: its target could not be searched')
      expect(r.out).toMatch(
        /the commit messages in the history could not be searched \(grep answered \d+\)/,
      )
      expect(r.out).not.toContain('clean')
    })

    it('in a range of commits', () => {
      const repo = repoWith(['Add a thing', 'Add another'])
      const r = preflight(['--commit-range', 'HEAD~1..HEAD'], repo, broken)
      expect(r.code).toBe(1)
      expect(r.out).toMatch(
        /the messages of this range could not be searched \(grep answered \d+\)/,
      )
      expect(r.out).not.toContain('clean')
    })

    it('in the listing of a range that could be read a moment before', () => {
      // The range is checked and then listed, and the listing says how git
      // answered it. To part the two, a git put first on the path that
      // fails the listing alone and is the real one for everything else.
      const real = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
      const shim = mkdtempSync(join(dir, 'shim-'))
      const asked = 'case "$*" in *--abbrev-commit*) exit 128 ;; esac'
      writeFileSync(join(shim, 'git'), `#!/bin/sh\n${asked}\nexec '${real}' "$@"\n`)
      chmodSync(join(shim, 'git'), 0o755)
      const repo = repoWith(['Add a thing', 'Add another'])
      const r = spawnSync(PREFLIGHT, ['--commit-range', 'HEAD~1..HEAD'], {
        cwd: repo,
        encoding: 'utf8',
        env: env({ PATH: `${shim}:${process.env.PATH}` }),
      })
      expect(`${r.stdout}${r.stderr}`).toBe(
        'preflight: the commits of this range could not be listed (git rev-list answered 128), ' +
          'so not all of their links were scanned.\n',
      )
      expect(r.status).toBe(1)
    })

    it('in the look for private files', () => {
      // That search has a pattern of its own, so a broken never list does
      // not reach it. The way to it is a grep that cannot run it: one put
      // first on the path, which fails for that pattern alone and hands
      // every other search to the real one. It fails the first of two
      // searches in a row, where only the last one's answer is kept unless
      // it is asked for.
      const real = spawnSync('sh', ['-c', 'command -v grep'], { encoding: 'utf8' }).stdout.trim()
      const shim = mkdtempSync(join(dir, 'shim-'))
      const asked = 'case "$*" in *settings*) exit 2 ;; esac'
      writeFileSync(join(shim, 'grep'), `#!/bin/sh\n${asked}\nexec '${real}' "$@"\n`)
      chmodSync(join(shim, 'grep'), 0o755)
      const repo = repoWith(['Add a thing'])
      const r = spawnSync(PREFLIGHT, [], {
        cwd: repo,
        encoding: 'utf8',
        env: env({ PATH: `${shim}:${process.env.PATH}` }),
      })
      expect(`${r.stdout}${r.stderr}`).toBe(
        "preflight: the working tree's listing could not be searched (grep answered 2), " +
          'so it was not looked through for private files.\n',
      )
      expect(r.status).toBe(1)
    })
  })

  describe('and what could be read is as it was', () => {
    it('says one line of a clean tree', () => {
      const repo = repoWith(['Add a thing'])
      expect(preflight([], repo)).toEqual({ code: 0, out: 'preflight: clean\n' })
    })

    it('refuses a file on the never list in the words it always has', () => {
      const repo = repoWith(['Add a thing'])
      writeFileSync(join(repo, 'notes.txt'), `a line\nsee ${HOME_FOLDER}/thing\n`)
      gitIn(repo, ['add', '-A'])
      expect(preflight([], repo)).toEqual({
        code: 1,
        out: [
          'preflight: files about to be committed contain something that must not be public:',
          `notes.txt:2:see ${HOME_FOLDER}/thing`,
          '',
        ].join('\n'),
      })
    })

    it('refuses a private file in the working tree in the words it always has', () => {
      const repo = repoWith(['Add a thing'])
      writeFileSync(join(repo, '.env'), 'X=1\n')
      writeFileSync(join(repo, '.env.example'), 'X=\n')
      expect(preflight([], repo)).toEqual({
        code: 1,
        out: [
          'preflight: a private file is in the working tree and not ignored:',
          '?? .env',
          '',
        ].join('\n'),
      })
    })
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
  env: env(),
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
    // the real thing where the real thing is available. That the closing
    // text is absent is not enough: a script that printed nothing at all,
    // or refused for another reason, would not print it either.
    const r = preflight([])
    expect(r.out).not.toContain('closes an issue by number')
    expect(r).toEqual(CLEAN)
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
