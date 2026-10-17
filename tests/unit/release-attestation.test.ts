// The release's provenance (issue 434). SHA256SUMS.txt beside the files it
// lists shows a download arrived whole, not who made it, so the release job
// attests every installer and the checksum file through
// actions/attest-build-provenance, and docs/install.md says how a person
// checks one with `gh attestation verify`. A release job cannot be run
// without a tag, so its shape is held here: only that job may mint an OIDC
// token or write attestations, the action is pinned by commit, its subjects
// are every installer release.mjs names and SHA256SUMS.txt and nothing else,
// and it runs once the assets exist and before any draft is written.

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '../..')
const workflow = readFileSync(join(repo, '.github', 'workflows', 'build.yml'), 'utf8')
const jobs = workflow.slice(workflow.indexOf('\njobs:\n'))
const release = jobs.slice(jobs.indexOf('\n  release:\n'))
const pins = JSON.parse(readFileSync(join(repo, 'vendor', 'pins.json'), 'utf8'))

interface ReleaseModule {
  assetNames(label: string, pins: unknown): string[]
  INSTALLERS: { asset(label: string): string }[]
  SUMS: string
  DEFAULT_REPOSITORY: string
}
const load = (): Promise<ReleaseModule> =>
  import(pathToFileURL(join(repo, 'scripts', 'release.mjs')).href) as Promise<ReleaseModule>

/** The attest step's subject-path patterns, one a line. */
function subjects(): string[] {
  const step = release.slice(release.indexOf('uses: actions/attest-build-provenance@'))
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

describe('build.yml attests the release', () => {
  it('gives id-token: write and attestations: write to the release job alone', () => {
    expect(release).toMatch(
      /\n {4}permissions:\n {6}contents: write\n {6}id-token: write\n {6}attestations: write\n/,
    )
    expect(workflow.match(/id-token: write/g)).toHaveLength(1)
    expect(workflow.match(/attestations: write/g)).toHaveLength(1)
    expect(workflow).not.toMatch(/id-token: (read|none)|attestations: (read|none)/)
    // The workflow's own default stays contents: read and nothing else.
    expect(workflow.slice(0, workflow.indexOf('\njobs:\n'))).toMatch(
      /\npermissions:\n {2}contents: read\n$/,
    )
  })

  it('uses actions/attest-build-provenance pinned to the commit of v4.2.2', () => {
    const uses = release.match(/uses: actions\/attest-build-provenance@\S+ # \S+/g)
    expect(uses).toEqual([
      // Resolved with `gh api repos/actions/attest-build-provenance/git/ref/tags/v4.2.2`
      // on 16 Oct 2026: a lightweight tag, so the ref names the commit.
      'uses: actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2',
    ])
  })

  it('attests after the assets are assembled and before any draft is written', () => {
    const assemble = release.indexOf('run: node scripts/release.mjs assemble')
    const attest = release.indexOf('uses: actions/attest-build-provenance@')
    const token = release.indexOf('GH_TOKEN:')
    const create = release.indexOf('gh release create')
    expect(assemble).toBeGreaterThan(0)
    expect(attest).toBeGreaterThan(assemble)
    expect(token).toBeGreaterThan(attest)
    expect(create).toBeGreaterThan(attest)
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
    const others = assetNames(label, pins).filter(
      (name) => !installers.includes(name) && name !== SUMS,
    )
    expect(others.length).toBeGreaterThan(0)
    for (const name of others) expect(attested(name), name).toBe(false)
  })
})

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
