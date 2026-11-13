// The release job's decisions (specs/025-release-on-a-tag, SC-002): which
// tags draft a Release and which are refused, what the assets are and when
// a missing installer stops the draft, the notes filled from the committed
// template, what is done about a Release already on GitHub, and the check
// of the draft after the upload. Fixture folders stand in for the
// downloaded artefacts and a temporary repository for main's history;
// nothing here talks to GitHub or launches anything.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const repo = resolve(__dirname, '../..')
const SCRIPT = join(repo, 'scripts', 'release.mjs')
const PINS_FILE = join(repo, 'vendor', 'pins.json')
const PINS = JSON.parse(readFileSync(PINS_FILE, 'utf8')) as {
  engine: { version: string; tag: string }
  loom: { commit: string }
  loom_windows_port: { commit: string }
  loom_windows_static: { zlib: { version: string }; bzip2: { version: string } }
  ffmpeg: { version: string; x264: { commit: string }; zlib: { version: string } }
  python: { version: string }
  electron_ffmpeg: {
    electron: { version: string; tag: string; commit: string }
    chromium: { version: string; commit: string }
    ffmpeg: { commit: string; tree: string }
    chromium_trees: Record<string, { tree: string }>
    chromium_deps: Record<string, { repo: string; commit: string; tree: string }>
    electron_files: Record<string, string>
  }
}
const PKG = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as {
  version: string
  devDependencies: Record<string, string>
}
const PINS_SHA = createHash('sha256').update(readFileSync(PINS_FILE)).digest('hex')
const LOCK = JSON.parse(readFileSync(join(repo, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, { version?: string }>
}
const ELECTRON = LOCK.packages['node_modules/electron']?.version ?? 'none'
const ELECTRON_SOURCE = `electron-ffmpeg-${PINS.electron_ffmpeg.electron.version}-source.tar.xz`
// An Electron no pins will be for, so the refusals do not start passing
// vacuously, or failing, when the pins move to the version they name.
const OTHER_ELECTRON = '99.0.0'

type Decision =
  { ok: false; reason: string } | { ok: true; name: string; version: string; prerelease: boolean }
type Action =
  | { action: 'create' }
  | { action: 'update'; id: number; stale: string[] }
  | { action: 'refuse'; reason: string }
interface Release {
  id: number
  tag_name: string
  draft: boolean
  assets?: { name: string; size?: number; digest?: string | null }[]
}
interface FileEntry {
  name: string
  size: number
  sha256: string
}
interface AssembleInput {
  downloaded: string
  out: string
  tag: string
  pins: unknown
  pinsSha256: string
  packageVersion: string
  electronVersion?: string | null
  runId?: string | null
  epoch?: number
  tar?: (archive: string, parent: string, name: string, epoch: number) => void
}
interface Module {
  parseTag(tag: string): { version: string; rc: number | null; label: string } | null
  releaseLabel(pkgVersion: string, ref: string | null | undefined, commit?: string | null): string
  buildCommit(env: Record<string, string | undefined>, cwd: string): string | null
  installedElectron(root: string): string | null
  decide(input: {
    tag: string
    packageVersion: string
    onMain: boolean | string
    tagNow: { run: string; remote: string | null } | string
  }): Decision
  parseLsRemote(text: string, tag: string): string | null
  remoteTagCommit(
    cwd: string,
    remote: string,
    tag: string,
    options?: {
      attempts?: number
      delayMs?: number
      run?: (
        cwd: string,
        args: string[],
      ) => { error?: Error; status: number | null; stdout: string; stderr: string }
    },
  ): string | null | { error: string }
  tagCommit(cwd: string, tag: string): { commit: string } | { error: string }
  isOnMain(cwd: string, commit: string, mainRef: string): boolean | string
  assetNames(label: string, pins: unknown): string[]
  checkManifest(
    manifest: unknown,
    expected: { target: string; pinsSha256: string; packageVersion: string; runId?: string | null },
  ): string[]
  assemble(input: AssembleInput): { problems: string[]; files: string[] }
  formatSums(entries: { name: string; sha256: string }[]): string
  parseSums(text: string): Map<string, string>
  notesValues(input: {
    tag: string
    pins: unknown
    pkg: unknown
    repository: string
    changelog: string
  }): Record<string, string>
  changelogSection(text: string, version: string, options: { final: boolean }): string
  changelogParts(
    section: string,
    version: string,
  ): { changes: string; knownIssues: string; security: string | null }
  fillNotes(template: string, values: Record<string, string>): { text: string; problems: string[] }
  parseReleases(text: string): Release[]
  releaseAction(releases: Release[], tag: string, names: string[]): Action
  verifyUploaded(
    releases: Release[],
    tag: string,
    files: FileEntry[],
  ): { problems: string[]; unverified: string[] }
  formatOutputs(values: Record<string, string | boolean>): string
  NOTES_TEMPLATE: string
  CHANGELOG: string
  NO_KNOWN_VULNERABILITY: string
  SUMS: string
}
// A URL built at run time, so the type checker does not look for
// declarations of a plain JavaScript module.
const load = (): Promise<Module> => import(pathToFileURL(SCRIPT).href) as Promise<Module>

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-release-test-'))
  made.push(dir)
  return dir
}
function put(path: string, content: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
const sha = (content: string | Buffer): string => createHash('sha256').update(content).digest('hex')

/** A run whose tag still names the commit it built. */
const HERE = { run: 'c'.repeat(40), remote: 'c'.repeat(40) }

/**
 * A changelog in the committed one's form (Keep a Changelog 1.1.0): an
 * Unreleased section, a candidate's undated one and a released one with its
 * Security, then the link references, which belong to no section.
 */
const CHANGES = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '### Added',
  '',
  '- Not released yet.',
  '',
  '## [0.2.0]',
  '',
  '### Added',
  '',
  '- A second cell.',
  '',
  '### Fixed',
  '',
  '- A first fault.',
  '',
  '### Known issues',
  '',
  '- Unsigned.',
  '',
  '## [0.1.0] - 2026-10-08',
  '',
  '### Added',
  '',
  '- The first release.',
  '',
  '### Security',
  '',
  'None.',
  '',
  '### Known issues',
  '',
  '- No update.',
  '',
  '[Unreleased]: https://example.invalid/compare/v0.1.0...HEAD',
  '[0.1.0]: https://example.invalid/releases/tag/v0.1.0',
  '',
].join('\n')

describe('parseTag', () => {
  it('reads a final tag and a release-candidate tag', async () => {
    const { parseTag } = await load()
    expect(parseTag('v0.1.0')).toEqual({ version: '0.1.0', rc: null, label: '0.1.0' })
    expect(parseTag('v0.1.0-rc.1')).toEqual({ version: '0.1.0', rc: 1, label: '0.1.0-rc.1' })
    expect(parseTag('v10.20.30-rc.12')).toEqual({
      version: '10.20.30',
      rc: 12,
      label: '10.20.30-rc.12',
    })
  })

  it.each([
    '0.1.0',
    'v0.1',
    'v0.1.0.0',
    'v01.0.0',
    'v0.1.0-rc',
    'v0.1.0-rc.0',
    'v0.1.0-rc.01',
    'v0.1.0-beta.1',
    'v0.1.0-rc.1.2',
    'v0.1.0+build',
    'v0.1.0\n',
    '\nv0.1.0',
    'v00.1.0',
    'v0.01.0',
    'vfoo',
    'v 0.1.0',
    '',
  ])('refuses %j', async (tag) => {
    const { parseTag } = await load()
    expect(parseTag(tag)).toBeNull()
  })
})

// The version the app reports (issue 558): electron.vite.config.ts builds
// it in, from build.yml's LEGIBLE_RELEASE_REF and the commit.
describe('releaseLabel', () => {
  const SHA = 'abc1234def5678abc1234def5678abc1234def56'

  it.each([
    ['a candidate tag, its -rc.N kept', 'refs/tags/v1.0.0-rc.2', SHA, '1.0.0-rc.2'],
    ['a final tag', 'refs/tags/v1.0.0', SHA, '1.0.0'],
    ['a branch, with the commit as build metadata', 'refs/heads/main', SHA, '1.0.0+abc1234'],
    ['a pull request', 'refs/pull/7/merge', SHA, '1.0.0+abc1234'],
    ['no ref, as in a local build', undefined, SHA, '1.0.0+abc1234'],
    ['a short commit', '', 'abc1234', '1.0.0+abc1234'],
    ['a tag that is no release tag', 'refs/tags/v1.0.0-beta.1', SHA, '1.0.0+abc1234'],
    ['a branch named like a tag', 'refs/heads/v2.0.0', SHA, '1.0.0+abc1234'],
    ['nothing at all', undefined, undefined, '1.0.0'],
    ['a branch with no commit known', 'refs/heads/main', null, '1.0.0'],
  ])('%s', async (_, ref, commit, label) => {
    // Mutations: the -rc.N stripped; a tag for another version accepted.
    const { releaseLabel } = await load()
    expect(releaseLabel('1.0.0', ref, commit)).toBe(label)
  })

  it.each(['refs/tags/v1.0.1', 'refs/tags/v0.1.0-rc.2', 'refs/tags/v2.0.0'])(
    'throws for %s, a tag for another version than package.json',
    async (ref) => {
      const { releaseLabel } = await load()
      expect(() => releaseLabel('1.0.0', ref, SHA)).toThrow(
        /is for version .*package\.json says 1\.0\.0/,
      )
    },
  )

  it('throws for a package.json version that is not X.Y.Z, and a commit that is not hex', async () => {
    const { releaseLabel } = await load()
    expect(() => releaseLabel('1.0.0-rc.1', 'refs/heads/main', SHA)).toThrow(/not X\.Y\.Z/)
    expect(() => releaseLabel('1.0.0', 'refs/heads/main', 'HEAD')).toThrow(/not a commit id/)
  })
})

describe('decide', () => {
  it('drafts a final Release for v<version> on main', async () => {
    const { decide } = await load()
    expect(decide({ tag: 'v0.1.0', packageVersion: '0.1.0', onMain: true, tagNow: HERE })).toEqual({
      ok: true,
      name: 'Legible Cities 0.1.0',
      version: '0.1.0',
      prerelease: false,
    })
  })

  it('drafts a prerelease for v<version>-rc.<N>', async () => {
    const { decide } = await load()
    expect(
      decide({ tag: 'v0.1.0-rc.1', packageVersion: '0.1.0', onMain: true, tagNow: HERE }),
    ).toEqual({
      ok: true,
      name: 'Legible Cities 0.1.0-rc.1',
      version: '0.1.0-rc.1',
      prerelease: true,
    })
  })

  it('refuses a tag for another version, naming both', async () => {
    const { decide } = await load()
    for (const tag of ['v0.1.1', 'v0.1.1-rc.1', 'v0.0.9']) {
      const decision = decide({ tag, packageVersion: '0.1.0', onMain: true, tagNow: HERE })
      expect(decision.ok).toBe(false)
      if (decision.ok) continue
      expect(decision.reason).toContain(tag.slice(1).replace(/-rc\.\d+$/, ''))
      expect(decision.reason).toContain('package.json says 0.1.0')
    }
  })

  it('refuses a tag that is not a release tag, before asking git anything', async () => {
    const { decide } = await load()
    const decision = decide({
      tag: 'v0.1.0-beta.1',
      packageVersion: '0.1.0',
      onMain: 'not asked',
      tagNow: 'not asked',
    })
    expect(decision).toEqual({
      ok: false,
      reason: expect.stringContaining('neither v<X.Y.Z> nor v<X.Y.Z>-rc.<N>'),
    })
  })

  it('refuses a commit that is not on main, and one it could not place', async () => {
    const { decide } = await load()
    const off = decide({ tag: 'v0.1.0', packageVersion: '0.1.0', onMain: false, tagNow: HERE })
    expect(off).toEqual({ ok: false, reason: expect.stringContaining('not on main') })
    const unknown = decide({
      tag: 'v0.1.0',
      packageVersion: '0.1.0',
      onMain: 'no origin/main',
      tagNow: HERE,
    })
    expect(unknown).toEqual({ ok: false, reason: expect.stringContaining('no origin/main') })
  })

  it('refuses a tag moved or deleted since the push that started the run', async () => {
    const { decide } = await load()
    const base = { tag: 'v0.1.0', packageVersion: '0.1.0', onMain: true }
    const moved = decide({ ...base, tagNow: { run: 'a'.repeat(40), remote: 'b'.repeat(40) } })
    expect(moved).toEqual({ ok: false, reason: expect.stringContaining('was moved') })
    if (!moved.ok) {
      expect(moved.reason).toContain('a'.repeat(40))
      expect(moved.reason).toContain('b'.repeat(40))
    }
    const gone = decide({ ...base, tagNow: { run: 'a'.repeat(40), remote: null } })
    expect(gone).toEqual({ ok: false, reason: expect.stringContaining('no longer on the remote') })
    const unasked = decide({ ...base, tagNow: 'ls-remote failed' })
    expect(unasked).toEqual({ ok: false, reason: expect.stringContaining('ls-remote failed') })
    // A moved tag is refused even where main would also refuse it.
    const both = decide({
      ...base,
      onMain: false,
      tagNow: { run: 'a'.repeat(40), remote: 'b'.repeat(40) },
    })
    expect(both).toEqual({ ok: false, reason: expect.stringContaining('was moved') })
  })

  it('reads where a tag points from ls-remote, peeled when annotated', async () => {
    const { parseLsRemote } = await load()
    const tag = 'v0.1.0'
    const object = '1'.repeat(40)
    const commit = '2'.repeat(40)
    expect(
      parseLsRemote(`${object}\trefs/tags/v0.1.0\n${commit}\trefs/tags/v0.1.0^{}\n`, tag),
    ).toBe(commit)
    expect(parseLsRemote(`${commit}\trefs/tags/v0.1.0\n`, tag)).toBe(commit)
    expect(parseLsRemote(`${commit}\trefs/tags/v0.1.0-rc.1\n`, tag)).toBeNull()
    expect(parseLsRemote('', tag)).toBeNull()
  })

  it('refuses when package.json is not at a plain X.Y.Z', async () => {
    const { decide } = await load()
    for (const packageVersion of ['0.1.0-rc.1', '0.1', '']) {
      const decision = decide({ tag: 'v0.1.0', packageVersion, onMain: true, tagNow: HERE })
      expect(decision.ok).toBe(false)
    }
  })

  it("agrees with the committed package.json: the candidates are 1.0.0's", async () => {
    const { decide } = await load()
    expect(PKG.version).toBe('1.0.0')
    expect(
      decide({ tag: 'v1.0.0-rc.1', packageVersion: PKG.version, onMain: true, tagNow: HERE }).ok,
    ).toBe(true)
  })

  it('from the command line, fails naming both versions and outputs nothing', () => {
    const run = spawnSync(process.execPath, [SCRIPT, 'decide', 'v9.9.9'], {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, GITHUB_OUTPUT: '' },
    })
    expect(run.status).toBe(1)
    expect(run.stdout).toBe('')
    expect(run.stderr).toContain('9.9.9')
    expect(run.stderr).toContain(`package.json says ${PKG.version}`)
    expect(run.stderr).toContain('Nothing was drafted')
  })
})

describe('the tag, main and the remote, over real repositories', () => {
  interface Repositories {
    /** A clone, as the release job's checkout is, with origin a bare repository. */
    dir: string
    origin: string
    main: string
    side: string
    git: (...args: string[]) => string
  }

  /**
   * A bare origin and a clone of it: package.json at 0.1.0 on main, tagged
   * v0.1.0 (annotated) and pushed; a side branch tagged v0.1.0-rc.1 and
   * pushed. No network: origin is a folder.
   */
  function repositories(): Repositories {
    const root = scratch()
    const hooks = join(root, 'no-hooks')
    mkdirSync(hooks)
    const origin = join(root, 'origin.git')
    const dir = join(root, 'work')
    const run = (cwd: string, args: string[]): string => {
      const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000 })
      if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
      return result.stdout.trim()
    }
    run(root, ['init', '--quiet', '--bare', '--initial-branch=main', origin])
    run(root, ['clone', '--quiet', origin, dir])
    const git = (...args: string[]): string => run(dir, args)
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'commit.gpgsign', 'false')
    git('config', 'tag.gpgsign', 'false')
    git('config', 'core.hooksPath', hooks)
    git('checkout', '--quiet', '-B', 'main')
    writeFileSync(join(dir, 'package.json'), '{ "name": "t", "version": "0.1.0" }\n')
    git('add', 'package.json')
    git('commit', '--quiet', '-m', 'on main')
    const main = git('rev-parse', 'HEAD')
    // Annotated, as a maintainer's tag may be: its commit is peeled.
    git('tag', '-a', 'v0.1.0', '-m', 'the release')
    git('push', '--quiet', 'origin', 'main', 'v0.1.0')
    git('checkout', '--quiet', '-b', 'side')
    writeFileSync(join(dir, 'b.txt'), 'b\n')
    git('add', 'b.txt')
    git('commit', '--quiet', '-m', 'off main')
    const side = git('rev-parse', 'HEAD')
    git('tag', 'v0.1.0-rc.1')
    git('push', '--quiet', 'origin', 'v0.1.0-rc.1')
    git('fetch', '--quiet', 'origin')
    return { dir, origin, main, side, git }
  }

  /** `release.mjs decide` against the clone, its outputs in a file as on a runner. */
  function decideCli(repos: Repositories, args: string[]) {
    const outputs = join(scratch(), 'outputs.txt')
    writeFileSync(outputs, '')
    const env: NodeJS.ProcessEnv = { ...process.env, GITHUB_OUTPUT: outputs }
    delete env.GITHUB_SHA
    const result = spawnSync(
      process.execPath,
      [SCRIPT, 'decide', ...args, '--repo', repos.dir, '--main', 'refs/remotes/origin/main'],
      { encoding: 'utf8', timeout: 60_000, env },
    )
    return { ...result, outputs: readFileSync(outputs, 'utf8') }
  }

  it("takes the build's commit from GITHUB_SHA, else from the checkout itself, else none", async () => {
    // Mutation: the checkout test dropped, so a folder inside another
    // repository (an unpacked source archive) takes that repository's commit.
    const { buildCommit } = await load()
    const { dir, side } = repositories()
    expect(buildCommit({}, dir)).toBe(side)
    expect(buildCommit({ GITHUB_SHA: 'f'.repeat(40) }, dir)).toBe('f'.repeat(40))
    const unpacked = join(dir, 'unpacked')
    mkdirSync(unpacked)
    expect(buildCommit({}, unpacked)).toBeNull()
    expect(buildCommit({}, scratch())).toBeNull()
  })

  it("says why when git cannot name the build's commit, and goes on without one", async () => {
    // Mutation: the warning dropped, so a build that reports the bare
    // version says nothing of why it lost its commit.
    const { buildCommit } = await load()
    const broken = scratch()
    mkdirSync(join(broken, '.git'))
    const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      expect(buildCommit({}, broken)).toBeNull()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toMatch(
        /^git could not name the commit built, so the app reports the bare version: .*not a git repository/,
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('peels a tag to its commit, and says when there is no such tag', async () => {
    const { tagCommit } = await load()
    const { dir, main, side } = repositories()
    expect(tagCommit(dir, 'v0.1.0')).toEqual({ commit: main })
    expect(tagCommit(dir, 'v0.1.0-rc.1')).toEqual({ commit: side })
    expect(tagCommit(dir, 'v0.2.0')).toEqual({ error: expect.stringContaining('no tag v0.2.0') })
  })

  it('places a commit on main or off it, and says when main is not there', async () => {
    const { isOnMain } = await load()
    const { dir, main, side } = repositories()
    expect(isOnMain(dir, main, 'refs/remotes/origin/main')).toBe(true)
    expect(isOnMain(dir, side, 'refs/remotes/origin/main')).toBe(false)
    expect(isOnMain(dir, main, 'refs/remotes/upstream/main')).toEqual(
      expect.stringContaining('not in this checkout'),
    )
  })

  it('asks the remote where a tag points, peeled, and says when it has none', async () => {
    const { remoteTagCommit } = await load()
    const { dir, main, side } = repositories()
    expect(remoteTagCommit(dir, 'origin', 'v0.1.0')).toBe(main)
    expect(remoteTagCommit(dir, 'origin', 'v0.1.0-rc.1')).toBe(side)
    expect(remoteTagCommit(dir, 'origin', 'v0.2.0')).toBeNull()
    expect(remoteTagCommit(dir, 'nowhere', 'v0.1.0', { delayMs: 0 })).toEqual({
      error: expect.stringContaining('after 3 attempts'),
    })
  })

  it('asks the remote again after a failure, and gives the last message after three', async () => {
    const { remoteTagCommit } = await load()
    const commit = '3'.repeat(40)
    const calls: string[][] = []
    const flaky = (_cwd: string, args: string[]) => {
      calls.push(args)
      return calls.length < 3
        ? { status: 128, stdout: '', stderr: `fatal: blip ${calls.length}` }
        : { status: 0, stdout: `${commit}\trefs/tags/v0.1.0\n`, stderr: '' }
    }
    expect(remoteTagCommit('.', 'origin', 'v0.1.0', { delayMs: 0, run: flaky })).toBe(commit)
    expect(calls).toHaveLength(3)
    expect(calls[0]).toEqual(['ls-remote', 'origin', 'refs/tags/v0.1.0', 'refs/tags/v0.1.0^{}'])

    calls.length = 0
    const down = (_cwd: string, args: string[]) => {
      calls.push(args)
      return { status: 128, stdout: '', stderr: `fatal: unreachable ${calls.length}` }
    }
    expect(remoteTagCommit('.', 'origin', 'v0.1.0', { delayMs: 0, run: down })).toEqual({
      error: 'git ls-remote exited 128: fatal: unreachable 3 (after 3 attempts)',
    })
    expect(calls).toHaveLength(3)
    // A spawn that fails outright is retried the same way.
    const missing = () => ({
      error: new Error('spawn git ENOENT'),
      status: null,
      stdout: '',
      stderr: '',
    })
    expect(
      remoteTagCommit('.', 'origin', 'v0.1.0', { delayMs: 0, attempts: 2, run: missing }),
    ).toEqual({
      error: 'spawn git ENOENT (after 2 attempts)',
    })
  })

  it('from the command line, drafts for a tag on main that has not moved', () => {
    const repos = repositories()
    const result = decideCli(repos, ['v0.1.0', '--run-commit', repos.main])
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.outputs).toBe('name=Legible Cities 0.1.0\nversion=0.1.0\nprerelease=false\n')
    // Without --run-commit or GITHUB_SHA, the local tag's commit is the run's.
    expect(decideCli(repos, ['v0.1.0']).status).toBe(0)
  })

  it('from the command line, refuses a tag off main, and one moved since the run began', () => {
    const repos = repositories()
    const off = decideCli(repos, ['v0.1.0-rc.1', '--run-commit', repos.side])
    expect(off.status).toBe(1)
    expect(off.stderr).toContain('not on main')
    expect(off.outputs).toBe('')

    // The run built main's commit; then the tag was moved and force-pushed.
    repos.git('tag', '-f', '-a', 'v0.1.0', '-m', 'moved', repos.side)
    repos.git('push', '--quiet', '--force', 'origin', 'v0.1.0')
    repos.git('tag', '-f', 'v0.1.0', repos.main)
    const moved = decideCli(repos, ['v0.1.0', '--run-commit', repos.main])
    expect(moved.status).toBe(1)
    expect(moved.stderr).toContain('was moved')
    expect(moved.stderr).toContain(repos.side)
    expect(moved.outputs).toBe('')

    // And deleted from the remote.
    repos.git('push', '--quiet', 'origin', ':refs/tags/v0.1.0')
    const gone = decideCli(repos, ['v0.1.0', '--run-commit', repos.main])
    expect(gone.status).toBe(1)
    expect(gone.stderr).toContain('no longer on the remote')
  })

  it('from the command line, refuses an unknown option', () => {
    const repos = repositories()
    expect(decideCli(repos, ['v0.1.0', '--publish']).status).toBe(2)
  })
})

// -- the downloaded artefacts --

type Target = 'darwin-arm64' | 'darwin-x64' | 'win-x64'
const TARGETS: Target[] = ['darwin-arm64', 'darwin-x64', 'win-x64']

interface Downloads {
  skip?: Target
  extraInstaller?: Target
  manifest?: (target: Target) => Record<string, unknown>
  emptySource?: string
  noToolchain?: boolean
  electronSource?: string[]
}

function manifestFor(target: Target): Record<string, unknown> {
  return {
    manifest: 1,
    target,
    pins_sha256: PINS_SHA,
    build: { commit: 'c0ffee', run: '42' },
    app: { name: 'Legible Cities', version: PKG.version, electron: ELECTRON },
  }
}

/** The artefacts as the release job downloads them, one folder each. */
function downloads(options: Downloads = {}): string {
  const root = join(scratch(), 'downloaded')
  for (const target of TARGETS) {
    if (target === options.skip) continue
    const dir = join(root, `installer-${target}`)
    const installer =
      target === 'win-x64'
        ? `Legible Cities Setup ${PKG.version}.exe`
        : `Legible Cities-${PKG.version}${target === 'darwin-arm64' ? '-arm64' : ''}.dmg`
    put(join(dir, 'release', installer), `installer for ${target}`)
    if (options.extraInstaller === target) {
      put(join(dir, 'release', `another${target === 'win-x64' ? '.exe' : '.dmg'}`), 'x')
    }
    put(
      join(dir, 'vendor', `manifest-${target}.json`),
      JSON.stringify((options.manifest ?? manifestFor)(target)),
    )
  }
  for (const source of ['ffmpeg-source', 'loom-source', 'engine-source']) {
    mkdirSync(join(root, source), { recursive: true })
    if (source !== options.emptySource) put(join(root, source, 'BUILD.txt'), `${source}\n`)
  }
  // Packed by its job: one .tar.xz, attached as it is.
  mkdirSync(join(root, 'electron-ffmpeg-source'), { recursive: true })
  for (const name of options.electronSource ?? [ELECTRON_SOURCE]) {
    put(join(root, 'electron-ffmpeg-source', name), `xz of ${name}`)
  }
  if (!options.noToolchain) {
    put(
      join(root, 'loom-windows-toolchain', 'TOOLCHAIN-win-x64.txt'),
      'mingw-w64-ucrt-x86_64-zlib\n',
    )
  }
  return root
}

/**
 * Stands in for tar: records the call, with the folder's files and the
 * time given, and writes a file naming what it archived.
 */
function fakeTar(calls: string[][]) {
  return (archive: string, parent: string, name: string, epoch: number): void => {
    const files = readdirSync(join(parent, name)).sort().join(',')
    calls.push([archive, name, files, String(epoch)])
    writeFileSync(archive, `tar of ${name}`)
  }
}

describe('assemble', () => {
  const base = (downloaded: string, out: string, tag = `v${PKG.version}-rc.1`): AssembleInput => ({
    downloaded,
    out,
    tag,
    pins: PINS,
    pinsSha256: PINS_SHA,
    packageVersion: PKG.version,
    electronVersion: ELECTRON,
    runId: '42',
    epoch: 1789000000,
  })

  it('renames each installer for its machine, archives each source, and sums them all', async () => {
    const { assemble, assetNames, parseSums, SUMS } = await load()
    const out = join(scratch(), 'assets')
    const calls: string[][] = []
    const result = assemble({ ...base(downloads(), out), tar: fakeTar(calls) })
    expect(result.problems).toEqual([])
    const label = `${PKG.version}-rc.1`
    const loom = PINS.loom.commit.slice(0, 12)
    expect([...result.files].sort()).toEqual(
      [
        `Legible-Cities-${label}-mac-arm64.dmg`,
        `Legible-Cities-${label}-mac-x64.dmg`,
        `Legible-Cities-${label}-windows-x64-setup.exe`,
        `ffmpeg-${PINS.ffmpeg.version}-source.tar`,
        `loom-${loom}-source.tar`,
        `legible-cities-engine-${PINS.engine.version}-source.tar`,
        ELECTRON_SOURCE,
        SUMS,
      ].sort(),
    )
    expect([...result.files].sort()).toEqual([...assetNames(label, PINS)].sort())
    expect(readFileSync(join(out, `Legible-Cities-${label}-mac-x64.dmg`), 'utf8')).toBe(
      'installer for darwin-x64',
    )
    // Each folder archived whole at the commit's time; LOOM's with the
    // Windows record beside its BUILD.txt.
    expect(calls.map(([, name, files, epoch]) => [name, files, epoch]).sort()).toEqual(
      [
        [`ffmpeg-${PINS.ffmpeg.version}-source`, 'BUILD.txt', '1789000000'],
        [`legible-cities-engine-${PINS.engine.version}-source`, 'BUILD.txt', '1789000000'],
        [`loom-${loom}-source`, 'BUILD.txt,TOOLCHAIN-win-x64.txt', '1789000000'],
      ].sort(),
    )
    // The source of Electron's FFmpeg library is attached as its job packed
    // it, never archived again.
    expect(readFileSync(join(out, ELECTRON_SOURCE), 'utf8')).toBe(`xz of ${ELECTRON_SOURCE}`)
    const sumsText = readFileSync(join(out, SUMS), 'utf8')
    const sums = parseSums(sumsText)
    expect(sums.size).toBe(7)
    for (const name of result.files.filter((file) => file !== SUMS)) {
      expect(sums.get(name), name).toBe(sha(readFileSync(join(out, name))))
    }
    // Sorted, two spaces, as sha256sum -c and shasum -a 256 -c read it.
    const lines = sumsText.trimEnd().split('\n')
    expect(lines.map((line) => line.slice(66))).toEqual(lines.map((line) => line.slice(66)).sort())
    expect(lines.every((line) => /^[0-9a-f]{64} {2}\S+$/.test(line))).toBe(true)
  })

  it('refuses when a packaging job left no installer, and writes nothing', async () => {
    const { assemble } = await load()
    for (const skip of TARGETS) {
      const out = join(scratch(), 'assets')
      const calls: string[][] = []
      const result = assemble({ ...base(downloads({ skip }), out), tar: fakeTar(calls) })
      expect(result.problems).toEqual([
        expect.stringContaining(`installer-${skip} was not downloaded`),
      ])
      expect(result.files).toEqual([])
      expect(existsSync(out)).toBe(false)
      expect(calls).toEqual([])
    }
  })

  it('refuses an artefact holding two installers', async () => {
    const { assemble } = await load()
    const out = join(scratch(), 'assets')
    const result = assemble({
      ...base(downloads({ extraInstaller: 'win-x64' }), out),
      tar: fakeTar([]),
    })
    expect(result.problems).toEqual([
      expect.stringContaining('installer-win-x64 holds 2 .exe files'),
    ])
  })

  it('refuses a missing or empty source artefact', async () => {
    const { assemble } = await load()
    const out = join(scratch(), 'assets')
    const result = assemble({
      ...base(downloads({ emptySource: 'loom-source' }), out),
      tar: fakeTar([]),
    })
    expect(result.problems).toEqual([expect.stringContaining('loom-source')])
  })

  it("refuses without the source of Electron's FFmpeg library, or with one for another Electron", async () => {
    const { assemble } = await load()
    const cases: [string[], string][] = [
      [[], 'electron-ffmpeg-source was not downloaded, or is empty'],
      [['electron-ffmpeg-44.1.0-source.tar.xz'], `not exactly ${ELECTRON_SOURCE}`],
      [[ELECTRON_SOURCE, 'BUILD.txt'], `not exactly ${ELECTRON_SOURCE}`],
    ]
    for (const [electronSource, says] of cases) {
      const out = join(scratch(), 'assets')
      const calls: string[][] = []
      const result = assemble({
        ...base(downloads({ electronSource }), out),
        tar: fakeTar(calls),
      })
      expect(result.problems).toEqual([expect.stringContaining(says)])
      expect(existsSync(out)).toBe(false)
      expect(calls).toEqual([])
    }
  })

  it('refuses when package-lock.json installs another Electron than the pins are for', async () => {
    const { assemble } = await load()
    const out = join(scratch(), 'assets')
    const result = assemble({
      ...base(downloads(), out),
      electronVersion: OTHER_ELECTRON,
      tar: fakeTar([]),
    })
    expect(result.problems).toEqual([
      expect.stringContaining(
        `installs Electron ${OTHER_ELECTRON}, and vendor/pins.json's electron_ffmpeg is for Electron ${PINS.electron_ffmpeg.electron.version}`,
      ),
    ])
    expect(existsSync(out)).toBe(false)
  })

  it("refuses LOOM's source without the Windows tools' record", async () => {
    const { assemble } = await load()
    const out = join(scratch(), 'assets')
    const result = assemble({
      ...base(downloads({ noToolchain: true }), out),
      tar: fakeTar([]),
    })
    expect(result.problems).toEqual([expect.stringContaining('loom-windows-toolchain')])
    expect(existsSync(out)).toBe(false)
  })

  it('refuses installers built from other pins, another version or another run', async () => {
    const { assemble } = await load()
    const cases: [(target: Target) => Record<string, unknown>, string][] = [
      [(t) => ({ ...manifestFor(t), pins_sha256: 'f'.repeat(64) }), 'written from pins'],
      [(t) => ({ ...manifestFor(t), app: { version: '0.0.9' } }), 'app version 0.0.9'],
      [(t) => ({ ...manifestFor(t), build: { run: '41' } }), 'run 41'],
      [(t) => ({ ...manifestFor(t), target: 'darwin-x64' }), 'written for darwin-x64'],
    ]
    for (const [manifest, says] of cases) {
      const out = join(scratch(), 'assets')
      const result = assemble({ ...base(downloads({ manifest }), out), tar: fakeTar([]) })
      expect(result.problems.length, says).toBeGreaterThan(0)
      expect(result.problems.join('\n')).toContain(says)
      expect(existsSync(out)).toBe(false)
    }
  })

  it('refuses a folder that already holds files', async () => {
    const { assemble } = await load()
    const out = join(scratch(), 'assets')
    put(join(out, 'old.dmg'), 'x')
    const result = assemble({ ...base(downloads(), out), tar: fakeTar([]) })
    expect(result.problems).toEqual([expect.stringContaining('is not empty')])
  })
})

describe('checkManifest', () => {
  it('accepts a manifest from this run, and ignores the run when none is known', async () => {
    const { checkManifest } = await load()
    const expected = { target: 'darwin-arm64', pinsSha256: PINS_SHA, packageVersion: PKG.version }
    expect(checkManifest(manifestFor('darwin-arm64'), { ...expected, runId: '42' })).toEqual([])
    expect(checkManifest(manifestFor('darwin-arm64'), { ...expected, runId: null })).toEqual([])
    expect(checkManifest(null, expected)).toEqual([expect.stringContaining('not a JSON object')])
  })
})

describe('sums', () => {
  it('writes and reads SHA256SUMS.txt', async () => {
    const { formatSums, parseSums } = await load()
    const text = formatSums([
      { name: 'b.tar', sha256: 'b'.repeat(64) },
      { name: 'a.dmg', sha256: 'a'.repeat(64) },
    ])
    expect(text).toBe(`${'a'.repeat(64)}  a.dmg\n${'b'.repeat(64)}  b.tar\n`)
    expect([...parseSums(text)]).toEqual([
      ['a.dmg', 'a'.repeat(64)],
      ['b.tar', 'b'.repeat(64)],
    ])
  })
})

describe('the notes', () => {
  const template = (): string => readFileSync(join(repo, '.github', 'release-notes.md'), 'utf8')

  it('fill the committed template completely, from the pins and the tag', async () => {
    const { notesValues, fillNotes, assetNames, NOTES_TEMPLATE } = await load()
    expect(NOTES_TEMPLATE).toBe(join(repo, '.github', 'release-notes.md'))
    const values = notesValues({
      tag: 'v0.1.0',
      pins: PINS,
      pkg: PKG,
      repository: 'owner/app',
      changelog: CHANGES,
    })
    const { text, problems } = fillNotes(template(), values)
    expect(problems).toEqual([])
    expect(text).not.toMatch(/\{\{|\}\}/)
    for (const name of assetNames('0.1.0', PINS)) expect(text).toContain(name)
    expect(text).toContain('https://github.com/owner/app/blob/v0.1.0/docs/install.md')
    expect(text).toContain('https://github.com/owner/app/archive/refs/tags/v0.1.0.tar.gz')
    for (const value of [
      PINS.engine.tag,
      PINS.loom.commit,
      PINS.loom_windows_port.commit,
      PINS.ffmpeg.version,
      PINS.ffmpeg.x264.commit,
      PINS.ffmpeg.zlib.version,
      `bzip2 ${PINS.loom_windows_static.bzip2.version}`,
      PINS.python.version,
      PKG.devDependencies.electron,
      ELECTRON_SOURCE,
      `Chromium's FFmpeg at commit \`${PINS.electron_ffmpeg.ffmpeg.commit}\`, as Chromium ${PINS.electron_ffmpeg.chromium.version} and Electron ${PINS.electron_ffmpeg.electron.version} build it`,
      `the FFmpeg library inside Electron ${PINS.electron_ffmpeg.electron.version}:`,
    ]) {
      expect(text).toContain(value)
    }
    expect(text).toContain('not signed')
    expect(text).toContain('does not check for updates')
    expect(text).not.toContain('release candidate')
  })

  it('say a release candidate is one', async () => {
    const { notesValues, fillNotes } = await load()
    const values = notesValues({
      tag: 'v0.1.0-rc.2',
      pins: PINS,
      pkg: PKG,
      repository: 'o/a',
      changelog: CHANGES,
    })
    const { text, problems } = fillNotes(template(), values)
    expect(problems).toEqual([])
    expect(text.startsWith('> **A release candidate.**')).toBe(true)
    // The app built from the tag reports the tag's version (issue 558).
    expect(text).toContain(': the app inside reports version 0.1.0-rc.2. Use it')
    expect(text).toContain('Legible-Cities-0.1.0-rc.2-mac-arm64.dmg')
  })

  it("fill What changed and Known issues from the tag's section, under their headings", async () => {
    // Mutation: Known issues left among the changes, so it is said twice.
    const { notesValues, fillNotes } = await load()
    const values = notesValues({
      tag: 'v0.2.0-rc.1',
      pins: PINS,
      pkg: PKG,
      repository: 'o/a',
      changelog: CHANGES,
    })
    const { text, problems } = fillNotes(template(), values)
    expect(problems).toEqual([])
    expect(text).toContain(
      [
        '## What changed',
        '',
        '### Added',
        '',
        '- A second cell.',
        '',
        '### Fixed',
        '',
        '- A first fault.',
        '',
        '## Known issues',
        '',
        '- Unsigned.',
        '',
        '## Which file to download',
      ].join('\n'),
    )
    expect(text).not.toContain('Not released yet')
  })

  it("carry a final's Security, and say none is fixed where it says None.", async () => {
    // Mutation: "None." copied as it is, which says nothing a reader can
    // take as "no publicly known vulnerability is fixed".
    const { notesValues, fillNotes, NO_KNOWN_VULNERABILITY } = await load()
    const fill = (changelog: string, tag: string): string => {
      const values = notesValues({ tag, pins: PINS, pkg: PKG, repository: 'o/a', changelog })
      const { text, problems } = fillNotes(template(), values)
      expect(problems).toEqual([])
      return text
    }
    expect(NO_KNOWN_VULNERABILITY).toBe('No publicly known vulnerability is fixed in this release.')
    expect(fill(CHANGES, 'v0.1.0')).toContain(
      `- The first release.\n\n## Security\n\n${NO_KNOWN_VULNERABILITY}\n\n## Known issues\n\n- No update.\n`,
    )
    const fixed = CHANGES.replace('\nNone.\n', '\n- A feed could reach a local address.\n')
    const text = fill(fixed, 'v0.1.0')
    expect(text).toContain(
      '## Security\n\n- A feed could reach a local address.\n\n## Known issues',
    )
    expect(text).not.toContain(NO_KNOWN_VULNERABILITY)
  })

  it("make the changelog's relative links absolute, at the tag", async () => {
    // Mutation: the links copied as they are, which lead nowhere from the
    // Releases page.
    const { notesValues, fillNotes } = await load()
    const linked = CHANGES.replace(
      '- A second cell.',
      '- A second cell ([the guide](docs/install.md#updating), [here](#top), [away](https://a.example/b)).',
    ).replace('- Unsigned.', '- Unsigned ([support](SUPPORT.md)).')
    const values = notesValues({
      tag: 'v0.2.0-rc.1',
      pins: PINS,
      pkg: PKG,
      repository: 'o/a',
      changelog: linked,
    })
    const { text } = fillNotes(template(), values)
    expect(text).toContain(
      '- A second cell ([the guide](https://github.com/o/a/blob/v0.2.0-rc.1/docs/install.md#updating), [here](#top), [away](https://a.example/b)).',
    )
    expect(text).toContain(
      '- Unsigned ([support](https://github.com/o/a/blob/v0.2.0-rc.1/SUPPORT.md)).',
    )
  })

  it('refuse a section that names no change, or says nothing of its known issues', async () => {
    // Mutation: the Known issues rule dropped, so the heading in the notes is empty.
    const { changelogParts } = await load()
    expect(() => changelogParts('### Known issues\n\n- One.', '9.9.9')).toThrow(
      'says nothing about what changed',
    )
    expect(() => changelogParts('### Added\n\n- One.', '9.9.9')).toThrow('### Known issues')
    expect(() => changelogParts('### Added\n\n- One.\n\n### Known issues\n', '9.9.9')).toThrow(
      '### Known issues',
    )
    expect(changelogParts('### Added\n\n- One.\n\n### Known issues\n\nNone.', '9.9.9')).toEqual({
      changes: '### Added\n\n- One.',
      knownIssues: 'None.',
      security: null,
    })
  })

  it('count a change heading with nothing under it as no change, and leave it out', async () => {
    // Mutation: a heading alone counted as a change, so "What changed" can
    // hold nothing but "### Added".
    const { changelogParts } = await load()
    expect(() => changelogParts('### Added\n\n### Known issues\n\nNone.', '9.9.9')).toThrow(
      'says nothing about what changed',
    )
    expect(
      changelogParts('### Added\n\n### Fixed\n\n- One.\n\n### Known issues\n\nNone.', '9.9.9')
        .changes,
    ).toBe('### Fixed\n\n- One.')
  })

  it("name the changelog's three keys once each, under their headings and before the downloads", async () => {
    // Mutation: {{known_issues}} gone from the template, its heading left empty.
    const { notesValues } = await load()
    const text = template()
    const keys = [...text.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((match) => match[1])
    for (const key of ['changes', 'security', 'known_issues']) {
      expect(
        keys.filter((named) => named === key),
        key,
      ).toHaveLength(1)
    }
    expect(text).toContain(
      '## What changed\n\n{{changes}}\n\n{{security}}## Known issues\n\n{{known_issues}}\n\n## Which file to download\n',
    )
    const values = notesValues({
      tag: 'v0.1.0',
      pins: PINS,
      pkg: PKG,
      repository: 'o/a',
      changelog: CHANGES,
    })
    expect(keys.filter((key) => !Object.hasOwn(values, key))).toEqual([])
  })

  it('from the command line, write the filled notes to the file named', () => {
    // The committed CHANGELOG.md, so the next candidate of package.json's
    // version can be drafted.
    const tag = `v${PKG.version}-rc.1`
    const out = join(scratch(), 'notes.md')
    const result = spawnSync(process.execPath, [SCRIPT, 'notes', tag, out], {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, GITHUB_REPOSITORY: 'owner/app' },
    })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    const text = readFileSync(out, 'utf8')
    expect(text).toBe(result.stdout)
    expect(text).toContain(`https://github.com/owner/app/blob/${tag}/docs/install.md`)
    expect(text).toContain('## What changed\n\n### ')
    expect(text).not.toMatch(/\{\{|\}\}/)

    const bad = join(scratch(), 'bad.md')
    const refused = spawnSync(process.execPath, [SCRIPT, 'notes', 'v0.1', bad], {
      encoding: 'utf8',
      timeout: 30_000,
    })
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('not a release tag')
    expect(existsSync(bad)).toBe(false)

    const missing = spawnSync(process.execPath, [SCRIPT, 'notes', 'v99.0.0-rc.1', bad], {
      encoding: 'utf8',
      timeout: 30_000,
    })
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('CHANGELOG.md has no section for 99.0.0')
    expect(missing.stderr).toContain('No notes were written.')
    expect(existsSync(bad)).toBe(false)
  })

  it('refuse a template naming a value nothing fills', async () => {
    const { fillNotes } = await load()
    expect(fillNotes('{{known}} and {{unknown}}', { known: 'yes' })).toEqual({
      text: 'yes and {{unknown}}',
      problems: [expect.stringContaining('{{unknown}}')],
    })
    expect(fillNotes('a {{ bad-key }}', {}).problems).toEqual([
      expect.stringContaining('brace pair'),
    ])
  })
})

describe('changelogSection', () => {
  it("reads a candidate's section, dated or not, up to the next version or the links", async () => {
    // Mutation: the section runs on into the link references at the foot.
    const { changelogSection } = await load()
    expect(changelogSection(CHANGES, '0.2.0', { final: false })).toBe(
      '### Added\n\n- A second cell.\n\n### Fixed\n\n- A first fault.\n\n### Known issues\n\n- Unsigned.',
    )
    const dated = changelogSection(CHANGES, '0.1.0', { final: false })
    expect(dated.startsWith('### Added\n\n- The first release.')).toBe(true)
    expect(dated.endsWith('- No update.')).toBe(true)
    expect(changelogSection(CHANGES.replaceAll('\n', '\r\n'), '0.2.0', { final: false })).toBe(
      changelogSection(CHANGES, '0.2.0', { final: false }),
    )
  })

  it('refuses a version with no section, naming the heading to add', async () => {
    // Mutation: an empty section answered for a missing one.
    const { changelogSection } = await load()
    expect(() => changelogSection(CHANGES, '0.3.0', { final: false })).toThrow(
      'CHANGELOG.md has no section for 0.3.0: add "## [0.3.0]"',
    )
    expect(() => changelogSection(CHANGES, '0.1', { final: false })).toThrow('no section for 0.1')
  })

  it('refuses a final whose section is not dated, and a heading in neither form', async () => {
    // Mutation: the date rule dropped, so a final's notes come from a
    // section that does not say when it was released.
    const { changelogSection } = await load()
    expect(() => changelogSection(CHANGES, '0.2.0', { final: true })).toThrow(
      "is not dated, and a final release's is",
    )
    const soon = CHANGES.replace('## [0.2.0]', '## [0.2.0] - soon')
    expect(() => changelogSection(soon, '0.2.0', { final: false })).toThrow(
      'is neither "## [0.2.0]" nor "## [0.2.0] - YYYY-MM-DD"',
    )
    const yanked = CHANGES.replace('## [0.1.0] - 2026-10-08', '## [0.1.0] - 2026-10-08 [YANKED]')
    expect(changelogSection(yanked, '0.1.0', { final: true })).toBe(
      changelogSection(CHANGES, '0.1.0', { final: true }),
    )
  })

  it('refuses a final with no Security or an empty one, and takes "None."', async () => {
    // Mutation: the Security rule dropped, so a final's notes can be silent
    // on whether it fixes a vulnerability.
    const { changelogSection } = await load()
    const dated = CHANGES.replace('## [0.2.0]', '## [0.2.0] - 2026-11-01')
    expect(() => changelogSection(dated, '0.2.0', { final: true })).toThrow('has no "### Security"')
    expect(changelogSection(dated, '0.2.0', { final: false })).toContain('- A first fault.')
    const empty = CHANGES.replace('\nNone.\n', '\n')
    expect(() => changelogSection(empty, '0.1.0', { final: true })).toThrow('has no "### Security"')
    expect(changelogSection(CHANGES, '0.1.0', { final: true })).toContain('### Security\n\nNone.')
  })

  it("finds package.json's version in the committed changelog, ready for its next candidate", async () => {
    // Mutation: the section renamed for another version.
    const { changelogSection, changelogParts, CHANGELOG } = await load()
    expect(CHANGELOG).toBe(join(repo, 'CHANGELOG.md'))
    const text = readFileSync(CHANGELOG, 'utf8')
    const section = changelogSection(text, PKG.version, { final: false })
    const parts = changelogParts(section, PKG.version)
    expect(parts.changes).toMatch(/^### (Added|Changed|Deprecated|Removed|Fixed)$/m)
    expect(text).toMatch(/^## \[Unreleased\]$/m)
    expect(text).toMatch(/^## \[0\.1\.0\] - 2026-10-08$/m)
  })
})

describe('what is on GitHub already', () => {
  const names = ['a.dmg', 'SHA256SUMS.txt']

  it('creates a draft when the tag has no Release, whatever other tags have', async () => {
    const { releaseAction } = await load()
    expect(releaseAction([], 'v0.1.0', names)).toEqual({ action: 'create' })
    expect(releaseAction([{ id: 1, tag_name: 'v0.0.9', draft: false }], 'v0.1.0', names)).toEqual({
      action: 'create',
    })
  })

  it('updates the one draft, removing the assets this run does not attach', async () => {
    const { releaseAction, parseReleases } = await load()
    const releases = parseReleases(
      [
        JSON.stringify({
          id: 7,
          tag_name: 'v0.1.0-rc.1',
          draft: true,
          assets: [{ name: 'a.dmg' }, { name: 'old.dmg' }],
        }),
        '',
        JSON.stringify({ id: 3, tag_name: 'v0.0.9', draft: false, assets: [] }),
      ].join('\n'),
    )
    expect(releaseAction(releases, 'v0.1.0-rc.1', names)).toEqual({
      action: 'update',
      id: 7,
      stale: ['old.dmg'],
    })
  })

  it('refuses a published Release for the tag, and never touches it', async () => {
    const { releaseAction } = await load()
    const action = releaseAction(
      [
        { id: 9, tag_name: 'v0.1.0', draft: false },
        { id: 10, tag_name: 'v0.1.0', draft: true },
      ],
      'v0.1.0',
      names,
    )
    expect(action).toEqual({ action: 'refuse', reason: expect.stringContaining('published') })
  })

  it('refuses more than one draft for the tag', async () => {
    const { releaseAction } = await load()
    const action = releaseAction(
      [
        { id: 1, tag_name: 'v0.1.0', draft: true },
        { id: 2, tag_name: 'v0.1.0', draft: true },
      ],
      'v0.1.0',
      names,
    )
    expect(action).toEqual({ action: 'refuse', reason: expect.stringContaining('2 draft') })
  })
})

describe('the draft after the upload', () => {
  const files: FileEntry[] = [
    { name: 'a.dmg', size: 3, sha256: 'a'.repeat(64) },
    { name: 'SHA256SUMS.txt', size: 70, sha256: 'c'.repeat(64) },
  ]
  const draft = (assets: Release['assets'], draftFlag = true): Release[] => [
    { id: 1, tag_name: 'v0.1.0', draft: draftFlag, assets },
  ]

  it('agrees when every file is there at its size and digest', async () => {
    const { verifyUploaded } = await load()
    expect(
      verifyUploaded(
        draft([
          { name: 'a.dmg', size: 3, digest: `sha256:${'a'.repeat(64)}` },
          { name: 'SHA256SUMS.txt', size: 70, digest: null },
        ]),
        'v0.1.0',
        files,
      ),
    ).toEqual({ problems: [], unverified: ['SHA256SUMS.txt'] })
  })

  it('names a missing file, an extra one, a wrong size and a wrong digest', async () => {
    const { verifyUploaded } = await load()
    const { problems } = verifyUploaded(
      draft([
        { name: 'a.dmg', size: 4, digest: `sha256:${'b'.repeat(64)}` },
        { name: 'stray.exe', size: 1 },
      ]),
      'v0.1.0',
      files,
    )
    expect(problems.join('\n')).toContain('SHA256SUMS.txt is not on the draft')
    expect(problems.join('\n')).toContain('stray.exe is on the draft')
    expect(problems.join('\n')).toContain('4 bytes on the draft and 3 here')
    expect(problems.join('\n')).toContain(`not sha256:${'a'.repeat(64)}`)
  })

  it('refuses when the Release for the tag is not one draft', async () => {
    const { verifyUploaded } = await load()
    expect(verifyUploaded(draft([], false), 'v0.1.0', files).problems).toEqual([
      expect.stringContaining('expected one draft'),
    ])
    expect(verifyUploaded([], 'v0.1.0', files).problems.length).toBe(1)
  })
})

describe('formatOutputs', () => {
  it('writes key=value, and the delimited form for a value with a line break', async () => {
    const { formatOutputs } = await load()
    expect(formatOutputs({ name: 'Legible Cities 0.1.0', prerelease: false })).toBe(
      'name=Legible Cities 0.1.0\nprerelease=false\n',
    )
    expect(formatOutputs({ list: 'a\nb' })).toBe('list<<EOF_RELEASE\na\nb\nEOF_RELEASE\n')
    expect(formatOutputs({ list: 'EOF_RELEASE\nb' })).toBe(
      'list<<EOF_RELEASE_\nEOF_RELEASE\nb\nEOF_RELEASE_\n',
    )
  })
})

// The workflow cannot be run without a tag, so its shape is held here: the
// trigger reaches tags and still reaches branches, and only the release job,
// only on a tag, can write.
describe('build.yml', () => {
  const workflow = readFileSync(join(repo, '.github', 'workflows', 'build.yml'), 'utf8')
  const jobs = workflow.slice(workflow.indexOf('\njobs:\n'))
  const release = jobs.slice(jobs.indexOf('\n  release:\n'), jobs.indexOf('\n  attest:\n'))

  it('runs on a v tag and still on branches', () => {
    expect(workflow).toMatch(/\n {2}push:\n {4}branches: \['\*\*'\]\n {4}tags: \['v\*'\]\n/)
  })

  it('builds a branch that changes what the app reports as its version', () => {
    // Mutation: the config left out of the path filter, so a branch that
    // changes only how the label is built packages no installer to show it.
    const on = workflow.slice(workflow.indexOf('\non:\n'), workflow.indexOf('\npermissions:\n'))
    const paths = [...on.matchAll(/^ {6}- '([^']+)'$/gm)].map((match) => match[1])
    expect(paths).toEqual(
      expect.arrayContaining(['electron.vite.config.ts', 'scripts/release.mjs']),
    )
  })

  it('reads by default, and gives contents: write to the release job alone, on a tag', () => {
    expect(workflow.slice(0, workflow.indexOf('\njobs:\n'))).toMatch(
      /\npermissions:\n {2}contents: read\n/,
    )
    expect(workflow.match(/contents: write/g)).toHaveLength(1)
    expect(release).toContain('contents: write')
    expect(release).toContain("startsWith(github.ref, 'refs/tags/v')")
    expect(release).toContain("github.event_name == 'push'")
    expect(release).toContain("needs.package.result == 'success'")
    expect(release).toContain("needs.vendor.result == 'success'")
    expect(release).toContain('persist-credentials: false')
    expect(release.match(/GH_TOKEN/g)).toHaveLength(1)
  })

  it('drafts and never publishes, and a rerun keeps the notes in the draft', () => {
    expect(release).toContain('gh release create "$TAG" --draft')
    expect(release).toContain('--draft=true')
    expect(release).not.toMatch(/--latest|--draft=false|draft=false/)
    const edit = release.split('\n').find((line) => line.includes('gh release edit'))
    expect(edit).toBeDefined()
    expect(edit).not.toContain('--notes')
    expect(release.match(/--notes-file/g)).toHaveLength(1)
  })

  it('pins every action the writing job uses to a full commit', () => {
    const uses = release.match(/uses: \S+/g) ?? []
    expect(uses.length).toBeGreaterThan(0)
    for (const line of uses) expect(line).toMatch(/^uses: actions\/[a-z-]+@[0-9a-f]{40}$/)
  })

  it("asks where the tag points now, with this run's commit", () => {
    expect(release).toContain('--run-commit "$GITHUB_SHA"')
  })

  it('builds the app knowing the ref, through the environment and never the script', () => {
    // Mutation: the env line dropped, so a candidate built from its tag
    // reports 1.0.0+<sha7> instead of 1.0.0-rc.N (issue 558).
    const pkg = jobs.slice(jobs.indexOf('\n  package:\n'), jobs.indexOf('\n  release:\n'))
    const at = pkg.indexOf('      - name: Build the app\n')
    expect(at).toBeGreaterThan(0)
    // The step runs to the blank line after it; the ref is an env value,
    // so no ${{ }} reaches a shell, and nothing else is set.
    const step = pkg.slice(at, pkg.indexOf('\n\n', at))
    expect(step).toBe(
      [
        '      - name: Build the app',
        '        run: npm run build',
        '        env:',
        '          LEGIBLE_RELEASE_REF: ${{ github.ref }}',
      ].join('\n'),
    )
  })

  it("packages no installer without the source of Electron's FFmpeg library, checked before installing", () => {
    const pkg = jobs.slice(jobs.indexOf('\n  package:\n'), jobs.indexOf('\n  release:\n'))
    const download = pkg.indexOf('name: electron-ffmpeg-source')
    const refuse = pkg.indexOf(
      "name: Refuse to package without the source of Electron's FFmpeg library",
    )
    const install = pkg.indexOf('run: npm ci')
    expect(download).toBeGreaterThan(0)
    expect(refuse).toBeGreaterThan(download)
    expect(install).toBeGreaterThan(refuse)
    expect(pkg).toContain(
      'archive="electron-ffmpeg-source/electron-ffmpeg-$electron-source.tar.xz"',
    )
    expect(pkg).toContain("packages['node_modules/electron'].version")
    expect(release).toContain('name: electron-ffmpeg-source')
    expect(release).toContain('path: downloaded/electron-ffmpeg-source')
  })
})

// Signing mode (issue 686, ADR-062). It cannot be run without the
// certificate, the notary's key, an environment and a repository variable
// only the maintainer can make, so its shape is held here: which runs are
// signing runs, which job is handed which secret and nothing beyond it,
// that the job holding the notary's key runs no npm code, and that a
// Release waits for it. Each shell step is also run as a runner runs it,
// with electron-builder, node, codesign and spctl played by stand-ins that
// write down what they were given.
describe('build.yml, signing mode', () => {
  const workflow = readFileSync(join(repo, '.github', 'workflows', 'build.yml'), 'utf8')
  /** What GitHub reads: the workflow without its comment lines. */
  const code = workflow
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
  const jobs = code.slice(code.indexOf('\njobs:\n'))
  const jobNames = [...jobs.matchAll(/^ {2}([a-z-]+):$/gm)].map((match) => match[1])
  /** A job, as its own keys (`head`) and its steps, each from its `- ` line to the next one's. */
  const jobOf = (
    name: string,
  ): { head: string; steps: { name: string | null; text: string }[] } => {
    const start = jobs.indexOf(`\n  ${name}:\n`)
    expect(start, `a job named ${name}`).toBeGreaterThanOrEqual(0)
    const next = jobNames[jobNames.indexOf(name) + 1]
    const text = jobs.slice(
      start,
      next === undefined ? jobs.length : jobs.indexOf(`\n  ${next}:\n`),
    )
    const at = text.indexOf('\n    steps:\n')
    if (at < 0) return { head: text, steps: [] }
    return {
      head: text.slice(0, at),
      steps: text
        .slice(at + '\n    steps:\n'.length)
        .split(/\n(?= {6}- )/)
        .map((step) => ({ name: /^ {6}- name: (.+)$/m.exec(step)?.[1] ?? null, text: step })),
    }
  }
  const pkg = jobOf('package')
  const notarize = jobOf('notarize')
  const release = jobOf('release')
  type Job = typeof pkg
  const step = (job: Job, name: string): string => {
    const found = job.steps.filter((candidate) => candidate.name === name)
    expect(found, `one step named ${name}`).toHaveLength(1)
    return found[0].text
  }
  const at = (job: Job, name: string): number =>
    job.steps.findIndex((candidate) => candidate.name === name)
  /** A step's `run: |` block, dedented. */
  const script = (job: Job, name: string): string => {
    const block = /\n {8}run: \|\n((?: {10}[^\n]*(?:\n|$)|\n)+)/.exec(step(job, name))
    expect(block, `${name} runs a script`).not.toBeNull()
    return (block as RegExpExecArray)[1].replace(/^ {10}/gm, '')
  }
  /** A job-level key's value, as written. */
  const key = (job: Job, name: string): string => {
    const found = new RegExp(`^ {4}${name}: (.+)$`, 'm').exec(job.head)
    expect(found, `the job sets ${name}`).not.toBeNull()
    return (found as RegExpExecArray)[1]
  }

  const REFUSE_DISPATCH = 'Refuse a dispatch that asks to sign while MAC_SIGNING is not on'
  const REFUSE_SIGN = 'Refuse to sign without the certificate and the Team ID'
  const REFUSE_NOTARISE = "Refuse to notarise without the notary's key"
  const DOWNLOAD = 'Download the signed disk image'
  const REFUSE_DOWNLOAD = 'Refuse a download that holds anything but the image and its manifest'
  const GATEKEEPER = "Turn Gatekeeper's assessments on if they are off"
  const NOTARISE = 'Notarise and staple the disk image'
  const VERIFY_IMAGE = 'Verify the notarised disk image'
  const EVENT =
    "((github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')) || (github.event_name == 'workflow_dispatch' && inputs.sign == true))"
  /** Signing mode, for a run. */
  const MODE = `vars.MAC_SIGNING == 'on' && ${EVENT}`
  /** Signing mode, for one target of the packaging matrix. */
  const MAC = `startsWith(matrix.target, 'darwin-') && ${MODE}`

  interface Context {
    target?: string
    github: { event_name: string; ref: string }
    inputs?: { sign?: boolean | null }
    vars?: { MAC_SIGNING?: string }
    needs?: Record<string, { result: string }>
  }
  /**
   * An expression evaluated as written. It uses only what JavaScript reads
   * the same way: function calls, ==, !=, !, && and ||, the last two giving
   * back the operand they stopped on. (GitHub compares strings without
   * regard to case, so `ON` would also switch signing on there; nothing here
   * depends on that.) What GitHub does with an `environment` of '' is not
   * something a test here can show: a branch build shows it (ADR-062).
   */
  const evaluate = (expression: string, context: Context): unknown =>
    new Function(
      'startsWith',
      'cancelled',
      'matrix',
      'github',
      'inputs',
      'vars',
      'needs',
      `return (${expression})`,
    )(
      (text: string, prefix: string) => text.startsWith(prefix),
      () => false,
      { target: context.target },
      context.github,
      context.inputs ?? {},
      context.vars ?? {},
      context.needs ?? {},
    )
  const inner = (value: string): string => {
    const found = /^\$\{\{ ([\s\S]+) \}\}$/.exec(value.trim())
    expect(found, `${value} is one expression`).not.toBeNull()
    return (found as RegExpExecArray)[1]
  }
  const ON = { MAC_SIGNING: 'on' }
  const branch = { event_name: 'push', ref: 'refs/heads/686-developer-id' }
  const main = { event_name: 'push', ref: 'refs/heads/main' }
  const tag = { event_name: 'push', ref: 'refs/tags/v1.0.0-rc.4' }
  const dispatch = { event_name: 'workflow_dispatch', ref: 'refs/heads/main' }

  it('is asked for on a dispatch by a boolean input that is off unless ticked', () => {
    expect(code).toMatch(
      /\non:\n {2}workflow_dispatch:\n {4}inputs:\n {6}sign:\n {8}description: '[^'\n]+'\n {8}type: boolean\n {8}default: false\n {2}push:\n/,
    )
  })

  it('builds a branch that changes the release config or either script', () => {
    const on = workflow.slice(workflow.indexOf('\non:\n'), workflow.indexOf('\npermissions:\n'))
    const paths = [...on.matchAll(/^ {6}- '([^']+)'$/gm)].map((match) => match[1])
    expect(paths).toEqual(
      expect.arrayContaining([
        'electron-builder.yml',
        'electron-builder.release.yml',
        'scripts/notarize-dmg.mjs',
        'scripts/verify-mac-signing.mjs',
      ]),
    )
    for (const path of paths.filter((entry) => !entry.includes('*'))) {
      expect(existsSync(join(repo, path)), path).toBe(true)
    }
  })

  it('writes one condition wherever a job decides whether it signs', () => {
    // Mutation: the copies drifting apart, so a job signs outside the
    // environment (and finds no secret), sits in it without signing, or
    // notarises what was never signed.
    expect(key(pkg, 'environment')).toBe(`\${{ ${MAC} && 'release-signing' || '' }}`)
    expect(/^ {6}SIGN: (.+)$/m.exec(pkg.head)?.[1]).toBe(`\${{ ${MAC} }}`)
    expect(key(notarize, 'if')).toBe(
      `\${{ !cancelled() && needs.package.result == 'success' && ${MODE} }}`,
    )
    expect(key(notarize, 'environment')).toBe(`\${{ ${MODE} && 'release-notarize' || '' }}`)
    // Two jobs, each naming its own environment once, as a value: a job
    // that named one outright would have GitHub make it, with no rule and
    // no reviewer, on a branch run.
    expect(code.match(/^\s*environment:/gm)).toHaveLength(2)
    expect(code.match(/'release-signing'/g)).toHaveLength(1)
    expect(code.match(/'release-notarize'/g)).toHaveLength(1)
    // Packaging takes minutes with or without a certificate: main's limit.
    expect(key(pkg, 'timeout-minutes')).toBe('60')
  })

  it('signs a Mac target only with the variable on, on a v tag or a dispatch that asked', () => {
    // Mutation: the variable left out, so every v tag waits on Apple and on
    // a certificate, and a candidate cannot be cut before either exists.
    const environment = inner(key(pkg, 'environment'))
    const sign = inner((/^ {6}SIGN: (.+)$/m.exec(pkg.head) as RegExpExecArray)[1])
    const cases: [string, Context['github'], Context['inputs'], Context['vars'], boolean][] = [
      // With the variable off or unset, nothing signs: a v tag builds ad
      // hoc, exactly as it did before there was anything to sign with.
      ['darwin-arm64', tag, {}, {}, false],
      ['darwin-x64', tag, {}, { MAC_SIGNING: '' }, false],
      ['darwin-arm64', tag, {}, { MAC_SIGNING: 'off' }, false],
      ['darwin-arm64', tag, {}, { MAC_SIGNING: 'true' }, false],
      ['darwin-arm64', dispatch, { sign: true }, {}, false],
      // With it on: a Mac target, on a v tag or a dispatch that asked.
      ['darwin-arm64', tag, {}, ON, true],
      ['darwin-x64', tag, {}, ON, true],
      ['win-x64', tag, {}, ON, false],
      ['darwin-arm64', dispatch, { sign: true }, ON, true],
      ['darwin-x64', dispatch, { sign: true }, ON, true],
      ['win-x64', dispatch, { sign: true }, ON, false],
      ['darwin-arm64', dispatch, { sign: false }, ON, false],
      ['darwin-arm64', dispatch, {}, ON, false],
      // And never a branch, whatever the variable says.
      ['darwin-arm64', branch, {}, ON, false],
      ['darwin-x64', main, {}, ON, false],
      // A dispatch from a tag signs only if it asks; a tag that is not a
      // v tag, and a branch named like one, never do.
      ['darwin-arm64', { event_name: 'workflow_dispatch', ref: 'refs/tags/v1.0.0' }, {}, ON, false],
      ['darwin-arm64', { event_name: 'push', ref: 'refs/tags/nightly' }, {}, ON, false],
      ['darwin-arm64', { event_name: 'push', ref: 'refs/heads/v1' }, {}, ON, false],
      // `sign` belongs to a dispatch: on any other event it changes nothing.
      ['darwin-arm64', main, { sign: true }, ON, false],
    ]
    for (const [target, github, inputs, vars, signing] of cases) {
      const label = `${target} ${github.event_name} ${github.ref} ${JSON.stringify(inputs)} ${JSON.stringify(vars)}`
      const context = { target, github, inputs, vars }
      expect(evaluate(environment, context), label).toBe(signing ? 'release-signing' : '')
      expect(evaluate(sign, context), label).toBe(signing)
    }
  })

  it('notarises only in a signing run whose every packaging job succeeded', () => {
    const condition = inner(key(notarize, 'if'))
    const environment = inner(key(notarize, 'environment'))
    const packaged = { package: { result: 'success' } }
    const cases: [Context, boolean][] = [
      [{ github: tag, vars: ON, needs: packaged }, true],
      [{ github: dispatch, inputs: { sign: true }, vars: ON, needs: packaged }, true],
      [{ github: tag, vars: ON, needs: { package: { result: 'failure' } } }, false],
      [{ github: tag, vars: {}, needs: packaged }, false],
      [{ github: branch, vars: ON, needs: packaged }, false],
      [{ github: dispatch, inputs: {}, vars: ON, needs: packaged }, false],
      [{ github: dispatch, inputs: { sign: true }, vars: {}, needs: packaged }, false],
    ]
    for (const [context, runs] of cases) {
      expect(evaluate(condition, context), JSON.stringify(context)).toBe(runs)
    }
    // The environment follows the run, not the packaging jobs' result: it
    // is the empty string on every run that is not a signing run.
    expect(evaluate(environment, { github: tag, vars: ON })).toBe('release-notarize')
    expect(evaluate(environment, { github: tag, vars: {} })).toBe('')
    expect(evaluate(environment, { github: branch, vars: ON })).toBe('')
    expect(evaluate(environment, { github: dispatch, inputs: {}, vars: ON })).toBe('')
  })

  it('refuses a dispatch that asks to sign while the variable is off, and only that', () => {
    const refusal = step(pkg, REFUSE_DISPATCH)
    const condition = inner((/^ {8}if: (.+)$/m.exec(refusal) as RegExpExecArray)[1])
    const asked = { sign: true }
    const cases: [Context, boolean][] = [
      [{ target: 'darwin-arm64', github: dispatch, inputs: asked, vars: {} }, true],
      [
        { target: 'darwin-x64', github: dispatch, inputs: asked, vars: { MAC_SIGNING: 'off' } },
        true,
      ],
      // Windows is not signed either way, and builds.
      [{ target: 'win-x64', github: dispatch, inputs: asked, vars: {} }, false],
      [{ target: 'darwin-arm64', github: dispatch, inputs: asked, vars: ON }, false],
      [{ target: 'darwin-arm64', github: dispatch, inputs: {}, vars: {} }, false],
      // A v tag with the variable off is not refused: it builds ad hoc.
      [{ target: 'darwin-arm64', github: tag, inputs: {}, vars: {} }, false],
      [{ target: 'darwin-arm64', github: branch, inputs: {}, vars: {} }, false],
    ]
    for (const [context, refused] of cases) {
      expect(evaluate(condition, context), JSON.stringify(context)).toBe(refused)
    }
    expect(at(pkg, REFUSE_DISPATCH)).toBe(1)
  })

  it('drafts a Release only when notarising succeeded, or was skipped with signing off', () => {
    // Mutation: a skipped notarising job let through whatever the reason, so
    // a signing run drafts a Release with no Mac installer notarised.
    expect(/^ {4}needs: \[(.+)\]$/m.exec(release.head)?.[1]).toBe('vendor, package, notarize')
    const folded = /\n {4}if: >-\n((?: {6}[^\n]*\n)+)/.exec(`${release.head}\n`)
    expect(folded, 'the release job has a folded condition').not.toBeNull()
    const condition = inner(
      (folded as RegExpExecArray)[1]
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' '),
    )
    const results = (packaged: string, notarised: string): Context['needs'] => ({
      vendor: { result: 'success' },
      package: { result: packaged },
      notarize: { result: notarised },
    })
    const cases: [Context, boolean][] = [
      // Signing off: the notarising jobs are skipped, and the tag's Release
      // is drafted from the ad-hoc installers, as before.
      [{ github: tag, vars: {}, needs: results('success', 'skipped') }, true],
      [{ github: tag, vars: { MAC_SIGNING: 'off' }, needs: results('success', 'skipped') }, true],
      // Signing on: only notarised installers.
      [{ github: tag, vars: ON, needs: results('success', 'success') }, true],
      [{ github: tag, vars: ON, needs: results('success', 'skipped') }, false],
      [{ github: tag, vars: ON, needs: results('success', 'failure') }, false],
      [{ github: tag, vars: ON, needs: results('success', 'cancelled') }, false],
      [{ github: tag, vars: {}, needs: results('success', 'failure') }, false],
      // And what always held.
      [{ github: tag, vars: {}, needs: results('failure', 'skipped') }, false],
      [{ github: main, vars: {}, needs: results('success', 'skipped') }, false],
      [
        {
          github: dispatch,
          inputs: { sign: true },
          vars: ON,
          needs: results('success', 'success'),
        },
        false,
      ],
    ]
    for (const [context, drafts] of cases) {
      expect(evaluate(condition, context), JSON.stringify(context)).toBe(drafts)
    }
  })

  it('names ten secrets in all, each half in the one job that joins its environment', () => {
    // Mutation: the notary's key named in the packaging job, in its own env
    // or in a step, or the two jobs put in one environment: either way the
    // key is back within reach of the job that runs npm's code.
    const named: { job: string; where: string; line: string }[] = []
    for (const name of jobNames) {
      const job = jobOf(name)
      for (const line of job.head.split('\n').filter((text) => text.includes('secrets.'))) {
        named.push({ job: name, where: '(the job itself)', line: line.trim() })
      }
      for (const candidate of job.steps) {
        for (const line of candidate.text.split('\n').filter((text) => text.includes('secrets.'))) {
          named.push({ job: name, where: candidate.name ?? '(unnamed step)', line: line.trim() })
        }
      }
    }
    const has = (job: string, where: string, names: string[]) =>
      names.map((name) => ({ job, where, line: `HAS_${name}: \${{ secrets.${name} != '' }}` }))
    const value = (job: string, where: string, names: string[]) =>
      names.map((name) => ({ job, where, line: `${name}: \${{ secrets.${name} }}` }))
    const certificate = ['MAC_CERT_P12_BASE64', 'MAC_CERT_PASSWORD']
    const notary = ['NOTARY_KEY_P8', 'NOTARY_KEY_ID', 'NOTARY_ISSUER_ID']
    expect(named).toEqual([
      // The packaging job: the certificate, and whether it was given. It
      // never names the notary's key, not even to ask whether there is one.
      ...has('package', REFUSE_SIGN, certificate),
      ...value('package', 'Package', certificate),
      // The notarising job: the notary's key, and nothing of the certificate.
      ...has('notarize', REFUSE_NOTARISE, notary),
      ...value('notarize', NOTARISE, notary),
    ])
    // Nothing the walk above could have missed: outside the jobs, on a line
    // of its own shape, or by another road to every secret at once.
    expect(code.match(/secrets\./g)).toHaveLength(10)
    expect(code).not.toMatch(/\bsecrets\s*[:[]|toJSON\(\s*secrets|secrets\s*\)/)
    // Each half is an environment's of its own, and one job joins each: a
    // job cannot be handed a secret of an environment it is not in, so the
    // packaging job, which runs npm's code, is out of the key's reach by
    // where the key is kept, not by what the job happens to name.
    const joins = (job: Job): string[] =>
      [...job.head.matchAll(/^ {4}environment: .*$/gm)].flatMap((line) =>
        [...line[0].matchAll(/'(release-[a-z-]+)'/g)].map((match) => match[1]),
      )
    const half = (job: string): string[] => [
      ...new Set(
        named
          .filter((entry) => entry.job === job)
          .map((entry) => (/secrets\.([A-Z0-9_]+)/.exec(entry.line) as RegExpExecArray)[1]),
      ),
    ]
    expect(joins(pkg)).toEqual(['release-signing'])
    expect(half('package')).toEqual(certificate)
    expect(joins(notarize)).toEqual(['release-notarize'])
    expect(half('notarize')).toEqual(notary)
    for (const name of jobNames.filter((other) => !['package', 'notarize'].includes(other))) {
      expect(joins(jobOf(name)), name).toEqual([])
      expect(jobOf(name).head, name).not.toMatch(/^ {4}environment:/m)
    }
  })

  it('never gives electron-builder a certificate or a notary variable under its own name at a step', () => {
    // An empty CSC_LINK at the step is read as a certificate to load and
    // fails every Mac build, the ad-hoc ones included; any APPLE_ variable
    // and electron-builder notarises the app itself.
    expect(code).not.toMatch(/^\s*(WIN_)?CSC_[A-Z_]+:/m)
    expect(workflow).not.toContain('APPLE_')
    expect(code).not.toMatch(/-c\.(mac|dmg)\./)
  })

  it('refuses in the packaging job before anything is installed, and hands a signed image on under another name', () => {
    // Mutation: a signed, unnotarised image uploaded as the installer, so
    // the release job can draft with it if notarising is skipped.
    const install = pkg.steps.findIndex((candidate) => candidate.text.includes('run: npm ci'))
    expect(at(pkg, REFUSE_SIGN)).toBe(2)
    expect(at(pkg, REFUSE_SIGN)).toBeLessThan(install)
    expect(pkg.steps[0].text.trim().split('\n')[0]).toBe(
      '- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
    )
    expect(step(pkg, REFUSE_SIGN)).toMatch(/\n {8}if: env\.SIGN == 'true'\n/)
    // Nothing of the notary's is left in this job: no key, no script, no step.
    const packaging = [pkg.head, ...pkg.steps.map((candidate) => candidate.text)].join('\n')
    expect(packaging).not.toMatch(/NOTARY|notarize-dmg|notarytool|stapler/)
    const upload = pkg.steps[pkg.steps.length - 1].text
    expect(upload).toContain(
      "name: ${{ env.SIGN == 'true' && 'unnotarised' || 'installer' }}-${{ matrix.target }}",
    )
    expect(upload).toContain('if-no-files-found: error')
  })

  it('notarises on a runner that checks out three files and runs no npm code', () => {
    // Mutation: `npm ci` in the notarising job, so every package the app
    // depends on runs on the runner that holds the notary's key.
    expect(key(notarize, 'needs')).toBe('package')
    expect(key(notarize, 'runs-on')).toBe('${{ matrix.os }}')
    // The two Macs of the packaging matrix, on the runners that built them.
    const targets = (job: Job): string[] =>
      [...job.head.matchAll(/- \{ os: ([\w-]+), +target: ([\w-]+)/g)].map((m) => `${m[1]} ${m[2]}`)
    expect(targets(notarize)).toEqual(targets(pkg).filter((entry) => entry.includes(' darwin-')))
    expect(targets(notarize)).toHaveLength(2)
    expect(
      notarize.steps.map((candidate) => candidate.name ?? candidate.text.trim().split('\n')[0]),
    ).toEqual([
      '- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
      REFUSE_NOTARISE,
      '- uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0',
      DOWNLOAD,
      REFUSE_DOWNLOAD,
      GATEKEEPER,
      NOTARISE,
      VERIFY_IMAGE,
      "Upload the notary's log",
      '- uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2',
    ])
    const checkout = notarize.steps[0].text
    expect(checkout).toContain('persist-credentials: false')
    expect(checkout).toContain('sparse-checkout-cone-mode: false')
    const sparse = /sparse-checkout: \|\n((?: {12}\S[^\n]*\n)+)/.exec(checkout)
    expect(
      sparse?.[1]
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    ).toEqual([
      'scripts/notarize-dmg.mjs',
      'scripts/verify-mac-signing.mjs',
      'electron-builder.release.yml',
    ])
    const whole = [notarize.head, ...notarize.steps.map((candidate) => candidate.text)].join('\n')
    // No npm, no npx, no cache of packages, nothing of the app's own.
    expect(whole).not.toMatch(/\bnp[mx]\b|launch-packaged|check-vendored|\bout\//)
    // The only programs of this repository's that run are the two scripts.
    const nodes = whole.split('\n').filter((line) => /\bnode /.test(line))
    expect(nodes).toHaveLength(2)
    for (const line of nodes)
      expect(line).toMatch(/\bnode scripts\/(notarize-dmg|verify-mac-signing)\.mjs /)
    // Every action is GitHub's own, pinned to a commit.
    const uses = whole.match(/uses: \S+ # \S+/g) ?? []
    expect(uses).toHaveLength(5)
    for (const line of uses) expect(line).toMatch(/^uses: actions\/[a-z-]+@[0-9a-f]{40} # v\d/)
  })

  it('unpacks the signed image beside nothing, and refuses it before the key exists unless it is that and its manifest', () => {
    // Mutation: the download left to land in the workspace, where a file
    // named like a script of this job's, shipped by a packaging step that
    // has turned hostile, replaces the script and is run with the key.
    const download = step(notarize, DOWNLOAD)
    expect(download).toContain('name: unnotarised-${{ matrix.target }}')
    expect(download).toMatch(/\n {10}path: \$\{\{ runner\.temp \}\}\/signed(\n|$)/)
    // Not the workspace, by any spelling of it.
    expect(download).not.toMatch(/github\.workspace|GITHUB_WORKSPACE|path: \.\/?(\n|$)/)
    // The refusal is the very next step, and the key is written two steps
    // later, in the one step that names it: nothing of the download is used
    // in between.
    expect(at(notarize, REFUSE_DOWNLOAD)).toBe(at(notarize, DOWNLOAD) + 1)
    expect(at(notarize, REFUSE_DOWNLOAD)).toBeLessThan(at(notarize, NOTARISE))
    const writesKey = notarize.steps
      .filter((candidate) => candidate.text.includes('notary-key.p8'))
      .map((candidate) => candidate.name)
    expect(writesKey).toEqual([NOTARISE])
    // And every later step takes the image from where it was unpacked.
    for (const name of [NOTARISE, VERIFY_IMAGE]) {
      expect(script(notarize, name), name).toContain('images=("$RUNNER_TEMP/signed/release/"*.dmg)')
      expect(script(notarize, name), name).not.toMatch(/\(release\/\*\.dmg\)/)
    }
  })

  it('takes the signed image from the packaging job and gives the release job the installer', () => {
    // What it takes is the artefact a signing run's packaging job makes, by
    // the name that job gives it, and not the installer it is about to
    // become.
    const taking = /\n {8}with:\n {10}name: (\S.*)\n/.exec(step(notarize, DOWNLOAD))
    expect(taking?.[1]).toBe('unnotarised-${{ matrix.target }}')
    expect(pkg.steps[pkg.steps.length - 1].text).toContain(
      "name: ${{ env.SIGN == 'true' && 'unnotarised' || 'installer' }}-${{ matrix.target }}",
    )
    const upload = notarize.steps[notarize.steps.length - 1].text
    expect(upload).toContain('name: installer-${{ matrix.target }}')
    // From the folder the download was unpacked into, so the artefact's own
    // two folders are release/ and vendor/, as an unsigned build's are.
    expect(upload).toMatch(
      /path: \|\n {12}\$\{\{ runner\.temp \}\}\/signed\/release\/\*\.dmg\n {12}\$\{\{ runner\.temp \}\}\/signed\/vendor\/manifest-\$\{\{ matrix\.target \}\}\.json\n/,
    )
    expect(upload).toContain('if-no-files-found: error')
    // Stapled and checked before it is the installer.
    const order = [REFUSE_DOWNLOAD, GATEKEEPER, NOTARISE, VERIFY_IMAGE].map((name) =>
      at(notarize, name),
    )
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(notarize.steps.length - 1).toBeGreaterThan(at(notarize, VERIFY_IMAGE))
    // The release job's downloads are what they were.
    const taken = release.steps
      .map((candidate) => /name: (installer-[\w-]+)/.exec(candidate.text)?.[1])
      .filter(Boolean)
    expect(taken).toEqual(['installer-darwin-arm64', 'installer-darwin-x64', 'installer-win-x64'])
  })

  it("uploads the notary's log whatever happened", () => {
    const log = step(notarize, "Upload the notary's log")
    expect(log).toContain('if: ${{ always() }}')
    expect(log).toContain('name: notary-log-${{ matrix.target }}')
    expect(log).toContain('path: ${{ runner.temp }}/notary-log/')
    expect(script(notarize, NOTARISE)).toContain(
      '--log "$RUNNER_TEMP/notary-log/notary-log-$TARGET.json"',
    )
  })

  it("gives each step longer than its script's own worst case, and the job longer than both", async () => {
    // Mutation: a step limit inside the script's worst case, so the runner
    // stops the script before notarytool gives up and prints the id.
    const minutes = (text: string): number =>
      Number((/^ {4,8}timeout-minutes: (\d+)$/m.exec(text) as RegExpExecArray)[1])
    const notary = (await import(
      pathToFileURL(join(repo, 'scripts', 'notarize-dmg.mjs')).href
    )) as { WORST_CASE_MS: number }
    const verifier = (await import(
      pathToFileURL(join(repo, 'scripts', 'verify-mac-signing.mjs')).href
    )) as { worstCaseMs(mode: string, options?: { notarized?: boolean }): number }
    // The figures the workflow's comments give.
    expect(notary.WORST_CASE_MS / 60_000).toBe(84)
    expect(verifier.worstCaseMs('dmg') / 60_000).toBe(76.5)
    const notarising = minutes(step(notarize, NOTARISE))
    const verifying = minutes(step(notarize, VERIFY_IMAGE))
    expect(notarising).toBe(90)
    expect(notarising * 60_000).toBeGreaterThan(notary.WORST_CASE_MS)
    expect(verifying).toBe(80)
    expect(verifying * 60_000).toBeGreaterThan(verifier.worstCaseMs('dmg'))
    expect(Number(key(notarize, 'timeout-minutes'))).toBeGreaterThanOrEqual(notarising + verifying)
  })

  describe.skipIf(process.platform === 'win32')('its steps, run as a runner runs them', () => {
    const SYSTEM = '/usr/bin:/bin'
    /** A folder standing in for the checkout, with stand-ins for the named commands first on PATH. */
    function workspace(stubs: Record<string, string>): { dir: string; path: string; log: string } {
      const dir = scratch()
      for (const [name, body] of Object.entries(stubs)) {
        const file = join(dir, 'bin', name)
        put(file, `#!/bin/bash\n${body}\n`)
        chmodSync(file, 0o755)
      }
      return { dir, path: `${join(dir, 'bin')}:${SYSTEM}`, log: join(dir, 'stub.log') }
    }
    /** As a `shell: bash` step: `-e` and pipefail on before the first line. */
    function run(text: string, cwd: string, env: Record<string, string>) {
      const file = join(scratch(), 'step.sh')
      writeFileSync(file, text)
      return spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', file], {
        cwd,
        env,
        encoding: 'utf8',
        timeout: 30_000,
      })
    }
    /** What a stand-in was called with, one call a line, its arguments tab-separated. */
    const RECORD =
      'printf "%s" "$(basename "$0")" >> "$STUB_LOG"; for a in "$@"; do printf "\\t%s" "$a" >> "$STUB_LOG"; done; printf "\\n" >> "$STUB_LOG"'
    const config = (identity: string): string =>
      `extends: ./electron-builder.yml\nmac:\n  # the team\n  identity: '${identity}'\n  notarize: false\ndmg:\n  sign: true\n`
    /** The two refusals, each with the secrets its job is asked about. */
    const REFUSALS: {
      job: Job
      name: string
      environment: string
      secrets: string[]
      passes: string
    }[] = [
      {
        job: pkg,
        name: REFUSE_SIGN,
        environment: 'release-signing',
        secrets: ['MAC_CERT_P12_BASE64', 'MAC_CERT_PASSWORD'],
        passes:
          'signing mode: every secret this job is given has a value, and the identity is team ABCDE12345\n',
      },
      {
        job: notarize,
        name: REFUSE_NOTARISE,
        environment: 'release-notarize',
        secrets: ['NOTARY_KEY_P8', 'NOTARY_KEY_ID', 'NOTARY_ISSUER_ID'],
        passes: 'signing mode: every secret this job is given has a value\n',
      },
    ]
    const every = (secrets: string[]): Record<string, string> =>
      Object.fromEntries(secrets.map((name) => [`HAS_${name}`, 'true']))

    it('each refusal passes with every secret its job is given', () => {
      for (const refusal of REFUSALS) {
        const { dir, path } = workspace({})
        put(join(dir, 'electron-builder.release.yml'), config('ABCDE12345'))
        const result = run(script(refusal.job, refusal.name), dir, {
          PATH: path,
          ...every(refusal.secrets),
        })
        expect(result.stderr, refusal.name).toBe('')
        expect(result.status, refusal.name).toBe(0)
        expect(result.stdout, refusal.name).toBe(refusal.passes)
      }
    })

    it('each refusal names every secret that is empty, and only those', () => {
      for (const refusal of REFUSALS) {
        const { dir, path } = workspace({})
        put(join(dir, 'electron-builder.release.yml'), config('ABCDE12345'))
        const last = refusal.secrets[refusal.secrets.length - 1]
        const one = run(script(refusal.job, refusal.name), dir, {
          PATH: path,
          ...every(refusal.secrets),
          [`HAS_${last}`]: 'false',
        })
        expect(one.status, refusal.name).toBe(1)
        expect(one.stdout, refusal.name).toBe(
          `::error::signing mode, and the ${refusal.environment} environment gave this job no value for: ${last}\n`,
        )
        // A job outside the environment is told nothing at all.
        const none = run(script(refusal.job, refusal.name), dir, { PATH: path })
        expect(none.status, refusal.name).toBe(1)
        expect(none.stdout, refusal.name).toContain(`no value for: ${refusal.secrets.join(' ')}\n`)
        // And neither job is asked about the other's half.
        const others = REFUSALS.filter((other) => other !== refusal).flatMap(
          (other) => other.secrets,
        )
        for (const name of others) expect(none.stdout, refusal.name).not.toContain(name)
      }
    })

    it('the packaging job refuses the placeholder, and an identity that is not a Team ID', () => {
      const { dir, path } = workspace({})
      const refused = (text: string) => {
        put(join(dir, 'electron-builder.release.yml'), text)
        return run(script(pkg, REFUSE_SIGN), dir, { PATH: path, ...every(REFUSALS[0].secrets) })
      }
      const placeholder = refused(config('TEAMID_TBD'))
      expect(placeholder.status).toBe(1)
      expect(placeholder.stdout).toBe(
        '::error::electron-builder.release.yml still names the placeholder TEAMID_TBD as its identity: write the Developer ID Team ID there before signing\n',
      )
      for (const identity of ['abcde12345', 'ABCDE1234', 'ABCDE123456', '-', '']) {
        const result = refused(config(identity))
        expect(result.status, identity).toBe(1)
        expect(result.stdout, identity).toContain('mac.identity is not a Team ID')
      }
      // Unquoted, an all-digit team would reach electron-builder as a number.
      expect(refused(config('ABCDE12345').replace(/'/g, '')).status).toBe(1)
      // The committed config: refused while it holds the placeholder, let
      // through once a Team ID stands there.
      const committed = readFileSync(join(repo, 'electron-builder.release.yml'), 'utf8')
      expect(refused(committed).status).toBe(committed.includes("identity: 'TEAMID_TBD'") ? 1 : 0)
    })

    it('the refused dispatch says what to do, and fails', () => {
      const { dir, path } = workspace({})
      const result = run(script(pkg, REFUSE_DISPATCH), dir, { PATH: path })
      expect(result.status).toBe(1)
      expect(result.stdout).toContain(
        "::error::this dispatch asked to sign, and the repository variable MAC_SIGNING is not 'on'",
      )
      expect(result.stdout).toContain('docs/repository-settings.md')
    })

    const NPX = [
      '{ printf "args"; for a in "$@"; do printf "\\t%s" "$a"; done; printf "\\n"',
      '  for name in CSC_LINK CSC_KEY_PASSWORD MAC_CERT_P12_BASE64 MAC_CERT_PASSWORD; do',
      '    if [ -n "${!name+set}" ]; then printf "%s=%s\\n" "$name" "${!name}"; else printf "%s is unset\\n" "$name"; fi',
      '  done; } > "$STUB_LOG"',
    ].join('\n')

    it('packaging gives electron-builder the certificate and the release config in signing mode', () => {
      const { dir, path, log } = workspace({ npx: NPX })
      const result = run(script(pkg, 'Package'), dir, {
        PATH: path,
        STUB_LOG: log,
        SIGN: 'true',
        BUILDER_ARGS: '--mac dmg --arm64',
        MAC_CERT_P12_BASE64: 'cDEyLWJ5dGVz',
        MAC_CERT_PASSWORD: 'a password',
      })
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
        'args\telectron-builder\t--mac\tdmg\t--arm64\t--config\telectron-builder.release.yml\t--publish\tnever',
        'CSC_LINK=cDEyLWJ5dGVz',
        'CSC_KEY_PASSWORD=a password',
        'MAC_CERT_P12_BASE64 is unset',
        'MAC_CERT_PASSWORD is unset',
      ])
    })

    it('packaging sets no certificate variable at all outside signing mode, not even an empty one', () => {
      // Mutation: CSC_LINK exported before the branch, so an ad-hoc build
      // hands electron-builder an empty certificate and fails.
      const { dir, path, log } = workspace({ npx: NPX })
      // As GitHub gives a job outside the environment: the names, empty.
      for (const values of [
        { MAC_CERT_P12_BASE64: '', MAC_CERT_PASSWORD: '' },
        { MAC_CERT_P12_BASE64: 'cDEyLWJ5dGVz', MAC_CERT_PASSWORD: 'a password' },
      ]) {
        const result = run(script(pkg, 'Package'), dir, {
          PATH: path,
          STUB_LOG: log,
          SIGN: 'false',
          BUILDER_ARGS: '--win nsis --x64',
          ...values,
        })
        expect(result.status).toBe(0)
        expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
          'args\telectron-builder\t--win\tnsis\t--x64\t--publish\tnever',
          'CSC_LINK is unset',
          'CSC_KEY_PASSWORD is unset',
          'MAC_CERT_P12_BASE64 is unset',
          'MAC_CERT_PASSWORD is unset',
        ])
      }
    })

    const VERIFY = "Verify the Mac app's signature"

    it('the verify step checks the seal, then ad hoc or the Developer ID by the mode', () => {
      const { dir, path, log } = workspace({ codesign: RECORD, node: RECORD })
      const calls = (env: Record<string, string>): string[] => {
        rmSync(log, { force: true })
        const result = run(script(pkg, VERIFY), dir, { PATH: path, STUB_LOG: log, ...env })
        expect(result.status).toBe(0)
        return readFileSync(log, 'utf8').trim().split('\n')
      }
      expect(calls({ TARGET: 'darwin-arm64', SIGN: 'false' })).toEqual([
        'codesign\t--verify\t--deep\t--strict\t--verbose=2\trelease/mac-arm64/Legible Cities.app',
        'node\tscripts/verify-mac-signing.mjs\tadhoc\trelease/mac-arm64/Legible Cities.app',
      ])
      expect(calls({ TARGET: 'darwin-x64', SIGN: 'true' })).toEqual([
        'codesign\t--verify\t--deep\t--strict\t--verbose=2\trelease/mac/Legible Cities.app',
        'node\tscripts/verify-mac-signing.mjs\tdeveloper-id\trelease/mac/Legible Cities.app\t--team-from\telectron-builder.release.yml',
      ])
      // And a check that refuses fails the step.
      const refusing = workspace({ codesign: RECORD, node: `${RECORD}\nexit 1` })
      expect(
        run(script(pkg, VERIFY), refusing.dir, {
          PATH: refusing.path,
          STUB_LOG: refusing.log,
          TARGET: 'darwin-arm64',
          SIGN: 'false',
        }).status,
      ).toBe(1)
    })

    it('the verify step says whether Gatekeeper is on, and fails on neither answer', () => {
      // Every Mac build prints it, so it is known before a signing run's
      // verdicts rest on it; only the notarising job acts on it.
      const said = (spctl: string) => {
        const { dir, path, log } = workspace({ codesign: RECORD, node: RECORD, spctl })
        return run(script(pkg, VERIFY), dir, {
          PATH: path,
          STUB_LOG: log,
          TARGET: 'darwin-arm64',
          SIGN: 'false',
        })
      }
      const on = said('echo "assessments enabled"')
      expect(on.status).toBe(0)
      expect(on.stdout).toContain('Gatekeeper on this runner: assessments enabled\n')
      const off = said('echo "assessments disabled"; exit 1')
      expect(off.status).toBe(0)
      expect(off.stdout).toContain('Gatekeeper on this runner: assessments disabled\n')
    })

    // A Gatekeeper that is on once a file exists, and the two spellings of
    // the option that turns it on, each of which can be made to fail.
    const SPCTL = [
      RECORD,
      'case "$1" in',
      '  --status) if [ -f "$STUB_STATE" ]; then echo "assessments enabled"; else echo "assessments disabled"; exit 1; fi ;;',
      '  --global-enable) if [ "${STUB_GLOBAL:-works}" = works ]; then touch "$STUB_STATE"; else echo "spctl: unknown option" >&2; exit 1; fi ;;',
      '  --master-enable) if [ "${STUB_MASTER:-works}" = works ]; then touch "$STUB_STATE"; else exit 1; fi ;;',
      'esac',
    ].join('\n')
    const gatekeeper = (env: Record<string, string>, on: boolean) => {
      const { dir, path, log } = workspace({ spctl: SPCTL, sudo: `${RECORD}\nexec "$@"` })
      const state = join(dir, 'assessments-on')
      if (on) writeFileSync(state, '')
      const result = run(script(notarize, GATEKEEPER), dir, {
        PATH: path,
        STUB_LOG: log,
        STUB_STATE: state,
        ...env,
      })
      const calls = readFileSync(log, 'utf8').trim().split('\n')
      return { result, sudo: calls.filter((call) => call.startsWith('sudo\t')) }
    }

    it('notarising leaves a Gatekeeper that is on alone, and says so twice', () => {
      const { result, sudo } = gatekeeper({}, true)
      expect(result.status).toBe(0)
      expect(result.stdout).toBe(
        'Gatekeeper before: assessments enabled\nGatekeeper after: assessments enabled\n',
      )
      expect(sudo).toEqual([])
    })

    it('notarising turns a Gatekeeper that is off on, by whichever spelling the runner takes', () => {
      const first = gatekeeper({}, false)
      expect(first.result.status).toBe(0)
      expect(first.result.stdout).toBe(
        'Gatekeeper before: assessments disabled\nGatekeeper after: assessments enabled\n',
      )
      expect(first.sudo).toEqual(['sudo\tspctl\t--global-enable'])
      const second = gatekeeper({ STUB_GLOBAL: 'fails' }, false)
      expect(second.result.status).toBe(0)
      expect(second.result.stdout).toContain('Gatekeeper after: assessments enabled\n')
      expect(second.sudo).toEqual(['sudo\tspctl\t--global-enable', 'sudo\tspctl\t--master-enable'])
    })

    it('notarising fails, with a sentence, only where Gatekeeper will not come on', () => {
      // Mutation: the status after not read, so the checks run on a machine
      // that accepts everything, and their verdicts are the setting's.
      const { result, sudo } = gatekeeper({ STUB_GLOBAL: 'fails', STUB_MASTER: 'fails' }, false)
      expect(result.status).toBe(1)
      expect(result.stdout).toBe(
        [
          'Gatekeeper before: assessments disabled',
          'Gatekeeper after: assessments disabled',
          "::error::Gatekeeper's assessments are off on this runner and could not be turned on, so spctl's verdicts here would prove nothing about the image",
          '',
        ].join('\n'),
      )
      expect(sudo).toHaveLength(2)
    })

    // Put together from pieces, so this file never holds a key's marker
    // whole, which bin/preflight refuses wherever it finds one.
    const DASHES = '-'.repeat(5)
    const KEY = `${DASHES}BEGIN PRIVATE KEY${DASHES}\nnot-a-key\n${DASHES}END PRIVATE KEY${DASHES}`
    const NODE = [
      '{ printf "args"; for a in "$@"; do printf "\\t%s" "$a"; done; printf "\\n"',
      '  printf "NOTARY_KEY_PATH=%s\\n" "${NOTARY_KEY_PATH-unset}"',
      '  printf "NOTARY_KEY_P8=%s\\n" "${NOTARY_KEY_P8-unset}"',
      '  printf "NOTARY_KEY_ID=%s\\n" "${NOTARY_KEY_ID-unset}"',
      '  printf "NOTARY_ISSUER_ID=%s\\n" "${NOTARY_ISSUER_ID-unset}"',
      '  printf "mode=%s\\n" "$(ls -l "$NOTARY_KEY_PATH" | cut -c1-10)"',
      '  printf "key=%s\\n" "$(tr "\\n" "|" < "$NOTARY_KEY_PATH")"; } > "$STUB_LOG"',
      'exit "${STUB_EXIT:-0}"',
    ].join('\n')
    const notarise = (images: string[], exit = '0') => {
      const { dir, path, log } = workspace({ node: NODE })
      const temp = join(dir, 'runner-temp')
      mkdirSync(temp)
      for (const image of images) put(join(temp, 'signed', 'release', image), 'image')
      const result = run(script(notarize, NOTARISE), dir, {
        PATH: path,
        STUB_LOG: log,
        STUB_EXIT: exit,
        RUNNER_TEMP: temp,
        TARGET: 'darwin-arm64',
        NOTARY_KEY_P8: KEY,
        NOTARY_KEY_ID: 'KEYID12345',
        NOTARY_ISSUER_ID: '11111111-2222-3333-4444-555555555555',
      })
      return { result, temp, log, key: join(temp, 'notary-key.p8') }
    }

    it('notarising hands the key over as a file nobody else can read, and removes it', () => {
      const { result, temp, log, key: file } = notarise(['Legible Cities-1.0.0-arm64.dmg'])
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
        `args\tscripts/notarize-dmg.mjs\t${temp}/signed/release/Legible Cities-1.0.0-arm64.dmg\t--log\t${temp}/notary-log/notary-log-darwin-arm64.json`,
        `NOTARY_KEY_PATH=${file}`,
        // The key's text is not in the script's environment, only its path.
        'NOTARY_KEY_P8=unset',
        'NOTARY_KEY_ID=KEYID12345',
        'NOTARY_ISSUER_ID=11111111-2222-3333-4444-555555555555',
        'mode=-rw-------',
        `key=${KEY.replaceAll('\n', '|')}|`,
      ])
      expect(existsSync(file)).toBe(false)
    })

    it('notarising removes the key when the script fails too, and fails the step', () => {
      // Mutation: the trap taken out, so the key outlives the step.
      const { result, log, key: file } = notarise(['a.dmg'], '1')
      expect(result.status).toBe(1)
      expect(readFileSync(log, 'utf8')).toContain('mode=-rw-------')
      expect(existsSync(file)).toBe(false)
    })

    it('notarising refuses no image, or two, before the key is written', () => {
      for (const images of [[], ['a.dmg', 'b.dmg']]) {
        const { result, log, key: file } = notarise(images)
        expect(result.status).toBe(1)
        expect(result.stdout).toBe(
          `::error::expected one disk image in the download's release folder, found ${images.length}\n`,
        )
        expect(existsSync(log)).toBe(false)
        expect(existsSync(file)).toBe(false)
      }
    })

    it("the last check is the dmg mode over the one image, by the config's team", () => {
      const { dir, path, log } = workspace({ node: RECORD })
      const temp = join(dir, 'runner-temp')
      const image = join(temp, 'signed', 'release', 'Legible Cities-1.0.0.dmg')
      put(image, 'image')
      // A file of the same name in the workspace is not what is checked.
      put(join(dir, 'release', 'Another.dmg'), 'not this one')
      const env = { PATH: path, STUB_LOG: log, RUNNER_TEMP: temp }
      const result = run(script(notarize, VERIFY_IMAGE), dir, env)
      expect(result.status).toBe(0)
      expect(readFileSync(log, 'utf8')).toBe(
        `node\tscripts/verify-mac-signing.mjs\tdmg\t${image}\t--team-from\telectron-builder.release.yml\n`,
      )
      rmSync(join(temp, 'signed'), { recursive: true })
      expect(run(script(notarize, VERIFY_IMAGE), dir, env).status).toBe(1)
    })

    /** A download as the packaging job uploads it, then changed by `spoil`. */
    const downloaded = (spoil: (root: string) => void = () => undefined) => {
      const { dir, path } = workspace({})
      const temp = join(dir, 'runner-temp')
      const root = join(temp, 'signed')
      put(join(root, 'release', 'Legible Cities-1.0.0-arm64.dmg'), 'image')
      put(join(root, 'vendor', 'manifest-darwin-arm64.json'), '{}')
      spoil(root)
      return run(script(notarize, REFUSE_DOWNLOAD), dir, {
        PATH: path,
        RUNNER_TEMP: temp,
        TARGET: 'darwin-arm64',
      })
    }

    it('the download passes when it is one image and the manifest of its target', () => {
      const result = downloaded()
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      expect(result.stdout).toBe(
        'the download holds one disk image and vendor/manifest-darwin-arm64.json, and nothing else\n',
      )
    })

    it('the download is refused when it holds a file this job would run or trust', () => {
      // What a hostile packaging step would ship: the script, or the config
      // the team is read from, under the name the checkout gives it.
      for (const planted of [
        'scripts/notarize-dmg.mjs',
        'scripts/verify-mac-signing.mjs',
        'electron-builder.release.yml',
      ]) {
        const result = downloaded((root) => put(join(root, planted), 'planted'))
        expect(result.status, planted).toBe(1)
        expect(result.stdout, planted).toContain(planted)
        expect(result.stdout, planted).toContain(
          "Nothing of it was used, and the notary's key was not written",
        )
        expect(result.stdout.match(/^::error::/gm), planted).toHaveLength(1)
      }
    })

    it('the download is refused for any third file, folder or link, and for a count that is not one', () => {
      const spoilt: [string, (root: string) => void, string][] = [
        [
          'a third file beside the image',
          (root) => put(join(root, 'release', 'notes.txt'), 'x'),
          'release/notes.txt',
        ],
        ['a hidden file', (root) => put(join(root, '.DS_Store'), 'x'), '.DS_Store'],
        ['an empty folder', (root) => mkdirSync(join(root, 'extra')), 'extra (a folder)'],
        [
          'an image in a folder of its own',
          (root) => put(join(root, 'release', 'more', 'b.dmg'), 'x'),
          'release/more (a folder)',
        ],
        [
          'a second image',
          (root) => put(join(root, 'release', 'b.dmg'), 'x'),
          'it holds 2 disk image(s)',
        ],
        [
          'no image',
          (root) => rmSync(join(root, 'release'), { recursive: true }),
          'it holds 0 disk image(s)',
        ],
        [
          'no manifest',
          (root) => rmSync(join(root, 'vendor', 'manifest-darwin-arm64.json')),
          '0 manifest(s)',
        ],
        [
          "another target's manifest",
          (root) => put(join(root, 'vendor', 'manifest-darwin-x64.json'), '{}'),
          'vendor/manifest-darwin-x64.json',
        ],
        [
          'a link in place of the image',
          (root) => {
            rmSync(join(root, 'release', 'Legible Cities-1.0.0-arm64.dmg'))
            symlinkSync('/etc/hosts', join(root, 'release', 'a.dmg'))
          },
          'release/a.dmg (a link)',
        ],
        [
          'a link beside the image',
          (root) => symlinkSync(join(root, 'vendor'), join(root, 'more')),
          'more (a link)',
        ],
      ]
      for (const [what, spoil, names] of spoilt) {
        const result = downloaded(spoil)
        expect(result.status, what).toBe(1)
        expect(result.stdout, what).toContain(names)
        expect(result.stdout, what).toContain("the notary's key was not written")
      }
      // And nothing at all where the download should be.
      const { dir, path } = workspace({})
      const absent = run(script(notarize, REFUSE_DOWNLOAD), dir, {
        PATH: path,
        RUNNER_TEMP: join(dir, 'runner-temp'),
        TARGET: 'darwin-arm64',
      })
      expect(absent.status).toBe(1)
      expect(absent.stdout).toContain('there is no folder where the signed image is unpacked')
    })

    it('the download is refused for a name that is not a plain one, shown so that it is not read as a command', () => {
      // A name with a line break in it, the second line a workflow command.
      const result = downloaded((root) => {
        rmSync(join(root, 'release', 'Legible Cities-1.0.0-arm64.dmg'))
        put(join(root, 'release', 'a\n::add-mask::x.dmg'), 'image')
      })
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('it holds 0 disk image(s)')
      // One line, the refusal's own, begins with `::`.
      expect(result.stdout.split('\n').filter((line) => line.startsWith('::'))).toHaveLength(1)
      expect(result.stdout.trimEnd().split('\n')).toHaveLength(1)
    })
  })
})

// The source of Electron's FFmpeg library (issue 109, ADR-043): the vendor
// workflow's job, the pins it verifies against, and the refusal that needs
// no network.
describe("the source of Electron's FFmpeg library", () => {
  const vendor = readFileSync(join(repo, '.github', 'workflows', 'vendor.yml'), 'utf8')
  const SOURCE_SCRIPT = join(repo, 'scripts', 'electron-ffmpeg-source.sh')

  it('is a vendor job that runs the script and uploads the artefact the release takes', () => {
    const job = vendor.slice(vendor.indexOf('\n  electron-ffmpeg-source:\n'))
    expect(job).toContain('runs-on: ubuntu-22.04')
    // On a miss, or a cached archive that does not verify (issue 585).
    expect(job).toContain(
      '\n          bash scripts/electron-ffmpeg-source.sh electron-ffmpeg-source\n',
    )
    expect(job).toContain('name: electron-ffmpeg-source\n')
    expect(job).toContain('if-no-files-found: error')
    // vendor.yml has no push trigger of its own (issue 430); build.yml calls
    // it, so the path filter that starts the chain is build.yml's.
    const build = readFileSync(join(repo, '.github', 'workflows', 'build.yml'), 'utf8')
    expect(build).toContain("'scripts/electron-ffmpeg-source.sh'")
  })

  it('is pinned for the Electron package.json and package-lock.json install, by object id', () => {
    const pins = PINS.electron_ffmpeg
    expect(pins.electron.version).toBe(ELECTRON)
    expect(pins.electron.version).toBe(PKG.devDependencies.electron)
    expect(pins.electron.tag).toBe(`v${ELECTRON}`)
    const id = /^[0-9a-f]{40}$/
    for (const value of [
      pins.electron.commit,
      pins.chromium.commit,
      pins.ffmpeg.commit,
      pins.ffmpeg.tree,
      ...Object.values(pins.chromium_trees).map((entry) => entry.tree),
      ...Object.values(pins.electron_files),
    ]) {
      expect(value).toMatch(id)
    }
    expect(Object.keys(pins.chromium_trees).sort()).toEqual(
      ['build', 'media/ffmpeg', 'third_party/opus', 'tools/generate_stubs'].sort(),
    )
    expect(Object.keys(pins.chromium_deps)).toEqual(['third_party/nasm'])
    for (const dep of Object.values(pins.chromium_deps)) {
      expect(dep.commit).toMatch(id)
      expect(dep.tree).toMatch(id)
    }
    const files = Object.keys(pins.electron_files)
    for (const required of [
      'patches/ffmpeg/.patches',
      'patches/ffmpeg/link_with_loader_path.patch',
      'build/args/all.gn',
      'build/args/release.gn',
      'patches/chromium/.patches',
    ]) {
      expect(files).toContain(required)
    }
    // Electron's patches to Chromium's build/, eight at Electron 44.2.0, 44.3.0, 44.5.1, 44.7.0,
    // 44.7.1 and 44.9.1, and eight at 45.0.0, one of them another patch.
    expect(files.filter((file) => /^patches\/chromium\/.+\.patch$/.test(file))).toHaveLength(8)
  })

  it('reads the Electron package-lock.json installs, and null when it names none', async () => {
    const { installedElectron } = await load()
    expect(installedElectron(repo)).toBe(ELECTRON)
    const dir = scratch()
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ packages: { '': {} } }))
    expect(installedElectron(dir)).toBeNull()
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3 }))
    expect(installedElectron(dir)).toBeNull()
  })

  it.skipIf(process.platform === 'win32')(
    'takes a tree id no in-tree .gitattributes can change, as git mktree makes it from the bytes',
    () => {
      const dir = join(scratch(), 'tree')
      put(join(dir, '.gitattributes'), '* text eol=crlf\n')
      put(join(dir, 'crlf.txt'), 'one\r\ntwo\r\n')
      put(join(dir, 'lf.txt'), 'three\n')
      put(join(dir, 'sub', 'deeper.txt'), 'four\r\n')
      put(join(dir, 'run.sh'), '#!/bin/sh\n')
      chmodSync(join(dir, 'run.sh'), 0o755)

      const bare = join(scratch(), 'objects.git')
      const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
      const git = (args: string[], input?: string): string => {
        const result = spawnSync('git', ['--git-dir', bare, ...args], {
          encoding: 'utf8',
          timeout: 30_000,
          env,
          input,
        })
        expect(result.status, result.stderr).toBe(0)
        return result.stdout.trim()
      }
      spawnSync('git', ['init', '--quiet', '--bare', bare], { timeout: 30_000, env })
      const blob = (path: string): string =>
        git(['hash-object', '-w', '--no-filters', join(dir, path)])
      const sub = git(['mktree'], `100644 blob ${blob('sub/deeper.txt')}\tdeeper.txt\n`)
      const expected = git(
        ['mktree'],
        [
          `100644 blob ${blob('.gitattributes')}\t.gitattributes`,
          `100644 blob ${blob('crlf.txt')}\tcrlf.txt`,
          `100644 blob ${blob('lf.txt')}\tlf.txt`,
          `100755 blob ${blob('run.sh')}\trun.sh`,
          `040000 tree ${sub}\tsub`,
          '',
        ].join('\n'),
      )

      const result = spawnSync('bash', [SOURCE_SCRIPT, '--tree-id', dir], {
        encoding: 'utf8',
        timeout: 30_000,
      })
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      expect(result.stdout.trim()).toBe(expected)

      // A plain git add honours the attribute and stores other bytes, which
      // is what the script's own attributes rule out.
      const plain = join(scratch(), 'plain')
      cpSync(dir, plain, { recursive: true })
      const plainGit = (args: string[]): string =>
        spawnSync('git', ['-C', plain, ...args], {
          encoding: 'utf8',
          timeout: 30_000,
          env,
        }).stdout.trim()
      plainGit(['init', '--quiet'])
      plainGit(['add', '--all'])
      expect(plainGit(['write-tree'])).not.toBe(expected)
    },
  )

  it.skipIf(process.platform === 'win32')(
    'refuses a package-lock.json for another Electron, naming both, before fetching anything',
    () => {
      const dir = scratch()
      const lock = structuredClone(LOCK)
      lock.packages['node_modules/electron'] = { version: OTHER_ELECTRON }
      const lockFile = join(dir, 'package-lock.json')
      writeFileSync(lockFile, JSON.stringify(lock))
      const out = join(dir, 'out')
      const result = spawnSync('bash', [SOURCE_SCRIPT, out], {
        encoding: 'utf8',
        timeout: 30_000,
        env: { ...process.env, ELECTRON_FFMPEG_LOCK: lockFile },
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(
        `package-lock.json installs Electron ${OTHER_ELECTRON}, and vendor/pins.json's electron_ffmpeg is for Electron ${PINS.electron_ffmpeg.electron.version}`,
      )
      expect(result.stdout).toBe('')
      expect(existsSync(out)).toBe(false)
    },
  )
})
