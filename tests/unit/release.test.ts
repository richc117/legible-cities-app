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
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

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
  }): Record<string, string>
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

  it('agrees with the committed package.json: the first release is 0.1.0', async () => {
    const { decide } = await load()
    expect(PKG.version).toBe('0.1.0')
    expect(
      decide({ tag: 'v0.1.0-rc.1', packageVersion: PKG.version, onMain: true, tagNow: HERE }).ok,
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
  const base = (downloaded: string, out: string, tag = 'v0.1.0-rc.1'): AssembleInput => ({
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
    const values = notesValues({ tag: 'v0.1.0', pins: PINS, pkg: PKG, repository: 'owner/app' })
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
    expect(text).not.toContain('release candidate')
  })

  it('say a release candidate is one', async () => {
    const { notesValues, fillNotes } = await load()
    const values = notesValues({ tag: 'v0.1.0-rc.2', pins: PINS, pkg: PKG, repository: 'o/a' })
    const { text, problems } = fillNotes(template(), values)
    expect(problems).toEqual([])
    expect(text.startsWith('> **A release candidate.**')).toBe(true)
    expect(text).toContain('Legible-Cities-0.1.0-rc.2-mac-arm64.dmg')
  })

  it('from the command line, write the filled notes to the file named', () => {
    const out = join(scratch(), 'notes.md')
    const result = spawnSync(process.execPath, [SCRIPT, 'notes', 'v0.1.0-rc.1', out], {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, GITHUB_REPOSITORY: 'owner/app' },
    })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    const text = readFileSync(out, 'utf8')
    expect(text).toBe(result.stdout)
    expect(text).toContain('https://github.com/owner/app/blob/v0.1.0-rc.1/docs/install.md')
    expect(text).not.toMatch(/\{\{|\}\}/)

    const bad = join(scratch(), 'bad.md')
    const refused = spawnSync(process.execPath, [SCRIPT, 'notes', 'v0.1', bad], {
      encoding: 'utf8',
      timeout: 30_000,
    })
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('not a release tag')
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
  const release = jobs.slice(jobs.indexOf('\n  release:\n'))

  it('runs on a v tag and still on branches', () => {
    expect(workflow).toMatch(/\n {2}push:\n {4}branches: \['\*\*'\]\n {4}tags: \['v\*'\]\n/)
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

// The source of Electron's FFmpeg library (issue 109, ADR-043): the vendor
// workflow's job, the pins it verifies against, and the refusal that needs
// no network.
describe("the source of Electron's FFmpeg library", () => {
  const vendor = readFileSync(join(repo, '.github', 'workflows', 'vendor.yml'), 'utf8')
  const SOURCE_SCRIPT = join(repo, 'scripts', 'electron-ffmpeg-source.sh')

  it('is a vendor job that runs the script and uploads the artefact the release takes', () => {
    const job = vendor.slice(vendor.indexOf('\n  electron-ffmpeg-source:\n'))
    expect(job).toContain('runs-on: ubuntu-22.04')
    expect(job).toContain('run: bash scripts/electron-ffmpeg-source.sh electron-ffmpeg-source')
    expect(job).toContain('name: electron-ffmpeg-source\n')
    expect(job).toContain('if-no-files-found: error')
    expect(vendor).toContain("'scripts/electron-ffmpeg-source.sh'")
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
    // Electron's patches to Chromium's build/, eight at Electron 44.2.0 and 44.3.0.
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
