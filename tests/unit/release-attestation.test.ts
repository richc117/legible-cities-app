// The release's provenance (issue 434, ADR-057). SHA256SUMS.txt beside the
// files it lists shows a download arrived whole, not who made it, so every
// installer and the checksum file are attested through
// actions/attest-build-provenance, and docs/install.md says how a person
// checks one with `gh attestation verify`.
//
// id-token: write is job-wide, so the attestation is a job of its own: the
// release job keeps contents: write and cannot mint a token; it uploads the
// assets it is about to draft as an artefact before it drafts; the attest
// job, with contents: read, id-token: write and attestations: write and
// nothing else, downloads that artefact, holds every file to its line in
// SHA256SUMS.txt, and attests. A release cannot be run without a tag, so the
// shape is held here, and the digest check is run against fixture folders.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '../..')
const workflow = readFileSync(join(repo, '.github', 'workflows', 'build.yml'), 'utf8')
const jobs = workflow.slice(workflow.indexOf('\njobs:\n'))
const release = jobs.slice(jobs.indexOf('\n  release:\n'), jobs.indexOf('\n  attest:\n'))
const attest = jobs.slice(jobs.indexOf('\n  attest:\n'))
const others = jobs.slice(0, jobs.indexOf('\n  release:\n'))
const pins = JSON.parse(readFileSync(join(repo, 'vendor', 'pins.json'), 'utf8'))

interface ReleaseModule {
  assetNames(label: string, pins: unknown): string[]
  INSTALLERS: { asset(label: string): string }[]
  SUMS: string
  DEFAULT_REPOSITORY: string
  formatSums(entries: { name: string; sha256: string }[]): string
}
const load = (): Promise<ReleaseModule> =>
  import(pathToFileURL(join(repo, 'scripts', 'release.mjs')).href) as Promise<ReleaseModule>

/** A job's own permissions block, as `key: value` lines. */
function permissions(job: string): string[] {
  const block = /\n {4}permissions:\n((?: {6}[a-z-]+: [a-z]+\n)+)/.exec(job)
  expect(block, 'the job sets its own permissions').not.toBeNull()
  return (block as RegExpExecArray)[1]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/** A step's `run: |` block, by the step's name, dedented. */
function runOf(job: string, name: string): string {
  const at = job.indexOf(`- name: ${name}\n`)
  expect(at, `a step named ${name}`).toBeGreaterThan(0)
  const block = /\n {8}run: \|\n((?:(?: {10}[^\n]*)?\n)+)/.exec(job.slice(at))
  expect(block, `${name} runs a script`).not.toBeNull()
  return (block as RegExpExecArray)[1].replace(/^ {10}/gm, '')
}

/** The attest step's subject-path patterns, one a line. */
function subjects(): string[] {
  const step = attest.slice(attest.indexOf('uses: actions/attest-build-provenance@'))
  const block = /\n {8}with:\n {10}subject-path: \|\n((?: {12}\S[^\n]*\n)+)/.exec(step)
  expect(block, 'the attest step names its subjects in a subject-path block').not.toBeNull()
  return (block as RegExpExecArray)[1]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/** A path matched against a subject-path pattern, whose only wildcard here is `*` in a file name. */
const matches = (pattern: string, path: string): boolean =>
  new RegExp(
    `^${pattern
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]*')}$`,
  ).test(path)

describe('build.yml attests the release in a job of its own', () => {
  it('gives the release job contents: write and no token to mint', () => {
    expect(permissions(release)).toEqual(['contents: write'])
    expect(release).not.toMatch(/^ +(id-token|attestations):/m)
  })

  it('gives the attest job id-token and attestations write, contents: read, and nothing else', () => {
    expect(permissions(attest).sort()).toEqual(
      ['attestations: write', 'contents: read', 'id-token: write'].sort(),
    )
    expect(attest).not.toContain('contents: write')
    expect(attest).not.toContain('GH_TOKEN')
    // Once each in the whole workflow, so no other job and no default has them.
    expect(workflow.match(/^ +id-token: write$/gm)).toHaveLength(1)
    expect(workflow.match(/^ +attestations: write$/gm)).toHaveLength(1)
    expect(others).not.toMatch(/^ +(id-token|attestations):/m)
    expect(workflow.slice(0, workflow.indexOf('\njobs:\n'))).toMatch(
      /\npermissions:\n {2}contents: read\n$/,
    )
  })

  it('runs after the release job, and only when it succeeded', () => {
    expect(attest).toMatch(/\n {4}needs: release\n/)
    expect(attest).toMatch(
      /\n {4}if: \$\{\{ !cancelled\(\) && needs\.release\.result == 'success' \}\}\n/,
    )
  })

  it('runs no code of its own but a shell check: no checkout, no setup-node, no script', () => {
    expect(attest.match(/uses: \S+ # \S+/g)).toEqual([
      'uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2',
      // Resolved with `gh api repos/actions/attest-build-provenance/git/ref/tags/v4.2.2`
      // on 16 Oct 2026: a lightweight tag, so the ref names the commit.
      'uses: actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2',
    ])
    expect(attest).not.toMatch(/actions\/checkout|actions\/setup-node|run: node|scripts\//)
  })

  it('hands over the assets after SHA256SUMS.txt is written and before anything is drafted', () => {
    const assemble = release.indexOf(
      'run: node scripts/release.mjs assemble "$TAG" downloaded release-assets',
    )
    const upload = release.indexOf('uses: actions/upload-artifact@')
    expect(assemble).toBeGreaterThan(0)
    expect(upload).toBeGreaterThan(assemble)
    for (const later of [
      'GH_TOKEN:',
      'gh release create',
      'gh release upload "$TAG" release-assets/*',
    ]) {
      expect(release.indexOf(later), later).toBeGreaterThan(upload)
    }
    const step = release.slice(upload, release.indexOf('\n      - ', upload))
    expect(step).toMatch(
      /^uses: actions\/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7\.0\.2\n/,
    )
    expect(step).toContain('\n          name: release-assets\n')
    expect(step).toContain('\n          path: release-assets/\n')
    expect(step).toContain('\n          if-no-files-found: error\n')
    // A rerun replaces the artefact, as it replaces the draft's assets.
    expect(step).toContain('\n          overwrite: true\n')
  })

  it('downloads that artefact, checks every digest, then attests', () => {
    const download = attest.indexOf('uses: actions/download-artifact@')
    const check = attest.indexOf(
      '- name: Refuse a file whose sha256 is not its line in SHA256SUMS.txt',
    )
    const sign = attest.indexOf('uses: actions/attest-build-provenance@')
    expect(download).toBeGreaterThan(0)
    expect(check).toBeGreaterThan(download)
    expect(sign).toBeGreaterThan(check)
    expect(attest.slice(download, check)).toContain('\n          name: release-assets\n')
    expect(attest.slice(download, check)).toContain('\n          path: release-assets\n')
    expect(attest.slice(check, sign)).toContain('working-directory: release-assets\n')
  })

  it('attests every installer release.mjs names and SHA256SUMS.txt, and no source archive', async () => {
    const { assetNames, INSTALLERS, SUMS } = await load()
    const patterns = subjects()
    expect(patterns.every((pattern) => pattern.startsWith('release-assets/'))).toBe(true)
    const attested = (name: string): boolean =>
      patterns.some((pattern) => matches(pattern, `release-assets/${name}`))
    const label = '0.2.0'
    const installers = INSTALLERS.map((installer) => installer.asset(label))
    expect(installers).toHaveLength(3)
    for (const name of [...installers, SUMS]) expect(attested(name), name).toBe(true)
    const archives = assetNames(label, pins).filter(
      (name) => !installers.includes(name) && name !== SUMS,
    )
    expect(archives.length).toBeGreaterThan(0)
    for (const name of archives) expect(attested(name), name).toBe(false)
  })

  it('tells the maintainer to publish only once the attest job is green', () => {
    expect(release).toContain("once this run's attest job is green, publish it by hand")
  })
})

// The digest check, run as the attest job runs it: in the downloaded folder,
// against a SHA256SUMS.txt written by release.mjs's own formatter.
const tool = (command: string): boolean =>
  spawnSync(command, ['--version'], { stdio: 'ignore', timeout: 10_000 }).status === 0
const lacking =
  process.platform === 'win32'
    ? 'the attest job runs on Linux, and this needs bash and sha256sum'
    : tool('bash') && tool('sha256sum')
      ? ''
      : 'bash or sha256sum is not on PATH'

describe.skipIf(lacking !== '')(
  `the attest job's digest check${lacking ? ` (skipped: ${lacking})` : ''}`,
  () => {
    const made: string[] = []
    afterEach(() => {
      for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
    })
    const script = runOf(attest, 'Refuse a file whose sha256 is not its line in SHA256SUMS.txt')

    /** A downloaded folder: three installers, an archive and SHA256SUMS.txt over them, spoiled one way. */
    async function folder(spoil?: 'byte' | 'extra' | 'missing' | 'empty'): Promise<string> {
      const { formatSums } = await load()
      const dir = mkdtempSync(join(tmpdir(), 'lc-attest-'))
      made.push(dir)
      const files: Record<string, string> = {
        'Legible-Cities-0.2.0-mac-arm64.dmg': 'arm64\n',
        'Legible-Cities-0.2.0-mac-x64.dmg': 'x64\n',
        'Legible-Cities-0.2.0-windows-x64-setup.exe': 'win\n',
        'legible-cities-engine-0.18.0-source.tar': 'source\n',
      }
      for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
      const sums = Object.entries(files).map(([name, text]) => ({
        name,
        sha256: createHash('sha256').update(text).digest('hex'),
      }))
      writeFileSync(join(dir, 'SHA256SUMS.txt'), spoil === 'empty' ? '' : formatSums(sums))
      if (spoil === 'byte') writeFileSync(join(dir, 'Legible-Cities-0.2.0-mac-x64.dmg'), 'x65\n')
      if (spoil === 'extra') writeFileSync(join(dir, 'unlisted.dmg'), 'stray\n')
      if (spoil === 'missing') rmSync(join(dir, 'Legible-Cities-0.2.0-mac-arm64.dmg'))
      // An artefact that came down with nothing in it but an empty list: the
      // list and the folder agree, and some sha256sum builds pass an empty
      // list, so only the script's own refusal of an empty list stops it.
      if (spoil === 'empty') for (const name of Object.keys(files)) rmSync(join(dir, name))
      return dir
    }
    const check = (dir: string) =>
      spawnSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8', timeout: 30_000 })

    it('passes a folder whose every file is its line', async () => {
      const run = check(await folder())
      expect(run.stderr).toBe('')
      expect(run.status).toBe(0)
      expect(run.stdout).toContain('every file is the one SHA256SUMS.txt names: 4 files')
    })

    it('refuses a file whose bytes are not its line', async () => {
      const run = check(await folder('byte'))
      expect(run.status).not.toBe(0)
      expect(`${run.stdout}${run.stderr}`).toContain('Legible-Cities-0.2.0-mac-x64.dmg: FAILED')
    })

    it('refuses a file the list does not name, or a listed file that is not there', async () => {
      const extra = check(await folder('extra'))
      expect(extra.status).toBe(1)
      expect(extra.stdout).toContain(
        '::error::the downloaded assets and SHA256SUMS.txt name different files',
      )
      expect(extra.stdout).toContain('> unlisted.dmg')
      const missing = check(await folder('missing'))
      expect(missing.status).not.toBe(0)
      expect(`${missing.stdout}${missing.stderr}`).toContain('Legible-Cities-0.2.0-mac-arm64.dmg')
    })

    it('refuses an empty list over an empty folder rather than passing it', async () => {
      expect(check(await folder('empty')).status).not.toBe(0)
    })
  },
)

describe('docs/install.md says how to check an attestation', () => {
  const install = readFileSync(join(repo, 'docs', 'install.md'), 'utf8')

  it('names the repository its Releases page is on, and the build workflow, for gh attestation verify', async () => {
    const { DEFAULT_REPOSITORY } = await load()
    const releases = /\(https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/releases\)/.exec(install)
    expect(releases?.[1]).toBe(DEFAULT_REPOSITORY)
    expect(install).toMatch(
      new RegExp(
        `\\ngh attestation verify \\S+ --repo ${DEFAULT_REPOSITORY.replace('/', '\\/')}\\n`,
      ),
    )
    expect(install).toContain(`--signer-workflow ${DEFAULT_REPOSITORY}/.github/workflows/build.yml`)
  })
})
