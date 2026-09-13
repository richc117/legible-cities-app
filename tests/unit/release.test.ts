// The release job's decisions (specs/025-release-on-a-tag, SC-002): which
// tags draft a Release and which are refused, what the assets are and when
// a missing installer stops the draft, the notes filled from the committed
// template, what is done about a Release already on GitHub, and the check
// of the draft after the upload. Fixture folders stand in for the
// downloaded artefacts and a temporary repository for main's history;
// nothing here talks to GitHub or launches anything.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  ffmpeg: { version: string; x264: { commit: string }; zlib: { version: string } }
  python: { version: string }
}
const PKG = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as {
  version: string
  devDependencies: Record<string, string>
}
const PINS_SHA = createHash('sha256').update(readFileSync(PINS_FILE)).digest('hex')

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
  runId?: string | null
  tar?: (archive: string, parent: string, name: string) => void
}
interface Module {
  parseTag(tag: string): { version: string; rc: number | null; label: string } | null
  decide(input: { tag: string; packageVersion: string; onMain: boolean | string }): Decision
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
    expect(decide({ tag: 'v0.1.0', packageVersion: '0.1.0', onMain: true })).toEqual({
      ok: true,
      name: 'Legible Cities 0.1.0',
      version: '0.1.0',
      prerelease: false,
    })
  })

  it('drafts a prerelease for v<version>-rc.<N>', async () => {
    const { decide } = await load()
    expect(decide({ tag: 'v0.1.0-rc.1', packageVersion: '0.1.0', onMain: true })).toEqual({
      ok: true,
      name: 'Legible Cities 0.1.0-rc.1',
      version: '0.1.0-rc.1',
      prerelease: true,
    })
  })

  it('refuses a tag for another version, naming both', async () => {
    const { decide } = await load()
    for (const tag of ['v0.1.1', 'v0.1.1-rc.1', 'v0.0.9']) {
      const decision = decide({ tag, packageVersion: '0.1.0', onMain: true })
      expect(decision.ok).toBe(false)
      if (decision.ok) continue
      expect(decision.reason).toContain(tag.slice(1).replace(/-rc\.\d+$/, ''))
      expect(decision.reason).toContain('package.json says 0.1.0')
    }
  })

  it('refuses a tag that is not a release tag, before asking git anything', async () => {
    const { decide } = await load()
    const decision = decide({ tag: 'v0.1.0-beta.1', packageVersion: '0.1.0', onMain: 'not asked' })
    expect(decision).toEqual({
      ok: false,
      reason: expect.stringContaining('neither v<X.Y.Z> nor v<X.Y.Z>-rc.<N>'),
    })
  })

  it('refuses a commit that is not on main, and one it could not place', async () => {
    const { decide } = await load()
    const off = decide({ tag: 'v0.1.0', packageVersion: '0.1.0', onMain: false })
    expect(off).toEqual({ ok: false, reason: expect.stringContaining('not on main') })
    const unknown = decide({ tag: 'v0.1.0', packageVersion: '0.1.0', onMain: 'no origin/main' })
    expect(unknown).toEqual({ ok: false, reason: expect.stringContaining('no origin/main') })
  })

  it('refuses when package.json is not at a plain X.Y.Z', async () => {
    const { decide } = await load()
    for (const packageVersion of ['0.1.0-rc.1', '0.1', '']) {
      const decision = decide({ tag: 'v0.1.0', packageVersion, onMain: true })
      expect(decision.ok).toBe(false)
    }
  })

  it('agrees with the committed package.json: the first release is 0.1.0', async () => {
    const { decide } = await load()
    expect(PKG.version).toBe('0.1.0')
    expect(decide({ tag: 'v0.1.0-rc.1', packageVersion: PKG.version, onMain: true }).ok).toBe(true)
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

describe('tagCommit and isOnMain, over a repository', () => {
  function repository(): { dir: string; main: string; side: string } {
    const dir = scratch()
    const hooks = join(dir, 'no-hooks')
    mkdirSync(hooks)
    const work = join(dir, 'work')
    mkdirSync(work)
    const git = (...args: string[]): string => {
      const run = spawnSync('git', args, { cwd: work, encoding: 'utf8', timeout: 30_000 })
      if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`)
      return run.stdout.trim()
    }
    git('init', '--quiet', '--initial-branch=main')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'commit.gpgsign', 'false')
    git('config', 'tag.gpgsign', 'false')
    git('config', 'core.hooksPath', hooks)
    writeFileSync(join(work, 'a.txt'), 'a\n')
    git('add', 'a.txt')
    git('commit', '--quiet', '-m', 'on main')
    const main = git('rev-parse', 'HEAD')
    // Annotated, as a maintainer's tag may be: its commit is peeled.
    git('tag', '-a', 'v0.1.0', '-m', 'the release')
    git('checkout', '--quiet', '-b', 'side')
    writeFileSync(join(work, 'b.txt'), 'b\n')
    git('add', 'b.txt')
    git('commit', '--quiet', '-m', 'off main')
    const side = git('rev-parse', 'HEAD')
    git('tag', 'v0.1.0-rc.1')
    return { dir: work, main, side }
  }

  it('peels a tag to its commit, and says when there is no such tag', async () => {
    const { tagCommit } = await load()
    const { dir, main, side } = repository()
    expect(tagCommit(dir, 'v0.1.0')).toEqual({ commit: main })
    expect(tagCommit(dir, 'v0.1.0-rc.1')).toEqual({ commit: side })
    expect(tagCommit(dir, 'v0.2.0')).toEqual({ error: expect.stringContaining('no tag v0.2.0') })
  })

  it('places a commit on main or off it, and says when main is not there', async () => {
    const { isOnMain } = await load()
    const { dir, main, side } = repository()
    expect(isOnMain(dir, main, 'refs/heads/main')).toBe(true)
    expect(isOnMain(dir, side, 'refs/heads/main')).toBe(false)
    expect(isOnMain(dir, main, 'refs/remotes/origin/main')).toEqual(
      expect.stringContaining('not in this checkout'),
    )
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
}

function manifestFor(target: Target): Record<string, unknown> {
  return {
    manifest: 1,
    target,
    pins_sha256: PINS_SHA,
    build: { commit: 'c0ffee', run: '42' },
    app: { name: 'Legible Cities', version: PKG.version, electron: '44.2.0' },
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
  return root
}

/** Stands in for tar: records the call and writes a file naming what it archived. */
function fakeTar(calls: string[][]) {
  return (archive: string, parent: string, name: string): void => {
    calls.push([archive, name])
    expect(existsSync(join(parent, name, 'BUILD.txt'))).toBe(true)
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
    runId: '42',
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
        SUMS,
      ].sort(),
    )
    expect([...result.files].sort()).toEqual([...assetNames(label, PINS)].sort())
    expect(readFileSync(join(out, `Legible-Cities-${label}-mac-x64.dmg`), 'utf8')).toBe(
      'installer for darwin-x64',
    )
    expect(calls.map(([, name]) => name).sort()).toEqual(
      [
        `ffmpeg-${PINS.ffmpeg.version}-source`,
        `legible-cities-engine-${PINS.engine.version}-source`,
        `loom-${loom}-source`,
      ].sort(),
    )
    const sumsText = readFileSync(join(out, SUMS), 'utf8')
    const sums = parseSums(sumsText)
    expect(sums.size).toBe(6)
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
      PINS.python.version,
      PKG.devDependencies.electron,
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

  it('drafts and never publishes', () => {
    expect(release).toContain('gh release create "$TAG" --draft')
    expect(release).toContain('--draft=true')
    expect(release).not.toMatch(/--latest|--draft=false|draft=false/)
  })
})
