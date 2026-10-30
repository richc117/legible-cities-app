// The release's provenance (issue 434, ADR-057). SHA256SUMS.txt beside the
// files it lists shows a download arrived whole, not who made it, so every
// installer and the checksum file are attested through
// actions/attest-build-provenance, and docs/install.md says how a person
// checks one with `gh attestation verify`. A verify job after the attest job
// (issue 557) runs that same check over everything attested, and
// acceptance.yml's step 1 runs it over the published Release's own download.
//
// id-token: write is job-wide, so the attestation is a job of its own: the
// release job keeps contents: write and cannot mint a token; it uploads the
// assets it is about to draft as an artefact before it drafts; the attest
// job, with contents: read, id-token: write and attestations: write and
// nothing else, downloads that artefact, holds every file to its line in
// SHA256SUMS.txt, and attests. A release cannot be run without a tag, so the
// shape is held here, and the digest check is run against fixture folders.

import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '../..')
const workflow = readFileSync(join(repo, '.github', 'workflows', 'build.yml'), 'utf8')
const jobs = workflow.slice(workflow.indexOf('\njobs:\n'))
const release = jobs.slice(jobs.indexOf('\n  release:\n'), jobs.indexOf('\n  attest:\n'))
// The verify job's leading comment belongs to it, not to the attest job above.
const verifyAt = ((): number => {
  let at = jobs.indexOf('\n  verify:\n')
  for (;;) {
    const lineStart = jobs.lastIndexOf('\n', at - 1)
    if (lineStart < 0 || !/^ {2}#/.test(jobs.slice(lineStart + 1, at))) return at
    at = lineStart
  }
})()
const attest = jobs.slice(jobs.indexOf('\n  attest:\n'), verifyAt)
const verify = jobs.slice(verifyAt)
const acceptance = readFileSync(join(repo, '.github', 'workflows', 'acceptance.yml'), 'utf8')
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

  it('tells the maintainer to publish only once the attest and verify jobs are green', () => {
    expect(release).toContain(
      "once this run's attest and verify jobs are green, publish it by hand",
    )
  })
})

describe('build.yml verifies what it attested, in a job that cannot sign', () => {
  it('is a job of its own, after the attest job and only where that succeeded', () => {
    // Re-sliced: attest ends where verify begins, so neither holds the other.
    expect(attest).not.toContain('gh attestation verify')
    expect(verify).toMatch(/^\n {2}# What the attest job signed[^]*\n {2}verify:\n/)
    expect(verify).toMatch(/\n {4}name: verify \(attestations\)\n/)
    expect(verify).toMatch(/\n {4}needs: attest\n/)
    expect(verify).toMatch(
      /\n {4}if: \$\{\{ !cancelled\(\) && needs\.attest\.result == 'success' \}\}\n/,
    )
    expect(verify).toMatch(/\n {4}timeout-minutes: 10\n/)
  })

  it('reads contents and attestations and cannot mint a token', () => {
    expect(permissions(verify).sort()).toEqual(['attestations: read', 'contents: read'])
    expect(verify).not.toMatch(/^ *id-token:/m)
    // Still once in the whole workflow: the attest job's.
    expect(workflow.match(/^ +id-token: write$/gm)).toHaveLength(1)
    expect(workflow.match(/^ +id-token:/gm)).toHaveLength(1)
  })

  it('downloads the artefact the attest job signed, and runs no checkout or script of the repository', () => {
    expect(verify.match(/uses: \S+ # \S+/g)).toEqual([
      'uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2',
    ])
    expect(verify).toContain('\n          name: release-assets\n')
    expect(verify).toContain('\n          path: release-assets\n')
    expect(verify).not.toMatch(/actions\/checkout|actions\/setup-node|run: node|scripts\//)
    expect(verify).toContain('GH_TOKEN: ${{ github.token }}')
  })

  const script = runOf(verify, 'Verify the attestation of every installer and of SHA256SUMS.txt')

  it('verifies every subject the attest job signs, and nothing it does not', () => {
    const loop = /\nfor subject in ([^;\n]+); do\n/.exec(`\n${script}`)
    expect(loop, 'the script loops over the subjects').not.toBeNull()
    expect((loop as RegExpExecArray)[1].split(' ').sort()).toEqual(subjects().sort())
    expect(script).toContain('gh attestation verify "$subject"')
    expect(script.match(/gh attestation verify/g)).toHaveLength(1)
  })

  it('asks for this repository, this workflow file, this ref and commit, and no self-hosted runner', () => {
    expect(script).toContain('--repo "$GITHUB_REPOSITORY"')
    expect(script).toContain('--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/build.yml"')
    expect(script).toContain('--source-ref "$GITHUB_REF"')
    expect(script).toContain('--source-digest "$GITHUB_SHA"')
    expect(script).toContain('--deny-self-hosted-runners')
    expect(script).toMatch(/^set -euo pipefail$/m)
  })
})

describe('acceptance.yml verifies the attestation of the Release it downloads', () => {
  const step = acceptance.slice(
    acceptance.indexOf('- name: Step 1, download the installer and check it'),
    acceptance.indexOf('- name: Step 2, install on macOS'),
  )

  it('may read attestations, and nothing more than it did', () => {
    expect(acceptance).toMatch(
      /\npermissions:\n {2}contents: read\n(?: {2}#[^\n]*\n)* {2}attestations: read\n\njobs:/,
    )
    expect(acceptance).not.toMatch(/^ +(id-token|contents: write|attestations: write)/m)
  })

  it('verifies the installer and SHA256SUMS.txt against the tag, after the checksum matched', () => {
    expect(step.length).toBeGreaterThan(0)
    // The call itself, not a sentence that names it: the failure note says
    // "gh attestation verify refused", so the bare words are in the step
    // whether or not it runs.
    const call = step.indexOf('if ! gh attestation verify "$subject" \\\n')
    expect(call).toBeGreaterThan(step.indexOf("field 'Matches SHA256SUMS.txt?' yes"))
    expect(step).toContain('for subject in "$DOWNLOAD/$ASSET" "$DOWNLOAD/SHA256SUMS.txt"; do')
    expect(step).toContain('--repo "$GITHUB_REPOSITORY"')
    expect(step).toContain('--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/build.yml"')
    expect(step).toContain('--source-ref "refs/tags/$TAG"')
    expect(step).toContain('digest=$(git rev-parse --verify --quiet "refs/tags/$TAG^{commit}")')
    expect(step).toContain('--source-digest "$digest"')
    expect(step).toContain('--deny-self-hosted-runners')
    expect(step).toContain('GH_TOKEN: ${{ github.token }}')
  })

  it('fails the step when the verify is refused, and records a tag from before attestations as not automated', () => {
    expect(step).toMatch(
      /--deny-self-hosted-runners; then\n[^\n]*field 'Attestation verified\?' no\n[^\n]*step 1 fail [^\n]*\n[^\n]*\n\s*exit 1\n/,
    )
    expect(step).toContain("field 'Attestation verified?' yes")
    expect(step).toContain("field 'Attestation verified?' 'not attested (before 1.0)'")
    expect(step).toContain("step 1 'pass, part not automated'")
    // The commit it asks git about is the one that brought the attest job.
    expect(step).toContain('ATTESTED_SINCE: 8d37d20ea4a97190104bbbadaf88b70eb83d570f')
    expect(step).toContain('git merge-base --is-ancestor "$ATTESTED_SINCE" "refs/tags/$TAG"')
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

/**
 * A step's script run as a runner runs a `shell: bash` step: written to a file
 * and given to `bash --noprofile --norc -eo pipefail`, so that `-e` is on
 * before the script's first line, as it is there and not under `bash -c`.
 */
function asRunner(
  script: string,
  options: { cwd: string; env: NodeJS.ProcessEnv },
): SpawnSyncReturns<string> {
  const folder = mkdtempSync(join(tmpdir(), 'lc-step-'))
  try {
    const file = join(folder, 'step.sh')
    writeFileSync(file, script)
    return spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', file], {
      cwd: options.cwd,
      env: options.env,
      encoding: 'utf8',
      timeout: 30_000,
    })
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

// The verify job's script, run as the job runs it: in the workspace, over a
// downloaded folder, with a stand-in `gh` that records what it was asked and
// refuses a file that is not there, as the real one does.
describe.skipIf(process.platform === 'win32' || !tool('bash'))(
  "the verify job's script, run over a downloaded folder",
  () => {
    const made: string[] = []
    afterEach(() => {
      for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
    })
    const script = runOf(verify, 'Verify the attestation of every installer and of SHA256SUMS.txt')

    function workspace(files: string[], refuse = ''): string {
      const dir = mkdtempSync(join(tmpdir(), 'lc-verify-'))
      made.push(dir)
      mkdirSync(join(dir, 'release-assets'))
      mkdirSync(join(dir, 'bin'))
      for (const name of files) writeFileSync(join(dir, 'release-assets', name), 'x\n')
      const gh = join(dir, 'bin', 'gh')
      writeFileSync(
        gh,
        [
          '#!/bin/bash',
          'echo "$*" >> "$PWD/gh-calls.txt"',
          '[ "$1 $2" = "attestation verify" ] || exit 64',
          '[ -f "$3" ] || { echo "open $3: no such file" >&2; exit 1; }',
          `[ -z "${refuse}" ] || [ "$3" != "release-assets/${refuse}" ] || exit 1`,
          'exit 0',
          '',
        ].join('\n'),
      )
      chmodSync(gh, 0o755)
      return dir
    }
    const run = (dir: string) =>
      asRunner(script, {
        cwd: dir,
        env: {
          ...process.env,
          PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
          GITHUB_REPOSITORY: 'owner/repo',
          GITHUB_REF: 'refs/tags/v9.9.9',
          GITHUB_SHA: 'a'.repeat(40),
        },
      })
    const calls = (dir: string): string[] =>
      readFileSync(join(dir, 'gh-calls.txt'), 'utf8').trim().split('\n')
    const all = ['A.dmg', 'B.dmg', 'C-setup.exe', 'SHA256SUMS.txt']

    it('verifies each installer and SHA256SUMS.txt, each against this repository, workflow, ref and commit', () => {
      const dir = workspace(all)
      const result = run(dir)
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      const asked = calls(dir)
      expect(asked.map((call) => call.split(' ')[2])).toEqual([
        'release-assets/A.dmg',
        'release-assets/B.dmg',
        'release-assets/C-setup.exe',
        'release-assets/SHA256SUMS.txt',
      ])
      for (const call of asked) {
        expect(call).toContain('--repo owner/repo ')
        expect(call).toContain('--signer-workflow owner/repo/.github/workflows/build.yml ')
        expect(call).toContain('--source-ref refs/tags/v9.9.9 ')
        expect(call).toContain(`--source-digest ${'a'.repeat(40)} `)
        expect(call).toMatch(/--deny-self-hosted-runners$/)
      }
    })

    it('fails when one subject is refused, rather than going on', () => {
      expect(run(workspace(all, 'B.dmg')).status).not.toBe(0)
    })

    it('fails when a kind of installer, or the checksum file, is not there at all', () => {
      expect(run(workspace(['A.dmg', 'SHA256SUMS.txt'])).status).not.toBe(0)
      expect(run(workspace(['A.dmg', 'C-setup.exe'])).status).not.toBe(0)
    })
  },
)

// Acceptance step 1, run as a runner runs it over a throwaway repository: one
// tag before the commit that brought attestations, one after, and a stand-in
// `gh` that downloads fixtures and records every other call. Whether a tag is
// old enough to have no attestation is the one place the step can fail open
// (a tag wrongly judged old is recorded as not attested and never verified),
// so it is run and not read.
describe.skipIf(process.platform === 'win32' || !tool('bash') || !tool('git'))(
  "acceptance.yml's step 1, run over tags before and after the attest job",
  () => {
    const made: string[] = []
    afterEach(() => {
      for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
    })
    const step = runOf(acceptance, 'Step 1, download the installer and check it')
    const asset = 'Legible-Cities-1.0.0-mac-arm64.dmg'

    interface Setup {
      dir: string
      attestedSince: string
      afterCommit: string
    }

    /**
     * The environment git sees in these tests: none of the machine's or the
     * calling repository's (a hook, a GIT_DIR from a commit in progress).
     */
    function isolated(): NodeJS.ProcessEnv {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
      }
      for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[name]
      return env
    }

    function git(dir: string, ...args: string[]): string {
      const run = spawnSync(
        'git',
        [
          '-c',
          'user.name=lane',
          '-c',
          'user.email=lane@example.invalid',
          '-c',
          'commit.gpgsign=false',
          '-c',
          'tag.gpgsign=false',
          '-c',
          'core.hooksPath=/dev/null',
          ...args,
        ],
        { cwd: dir, encoding: 'utf8', timeout: 30_000, env: isolated() },
      )
      expect(run.status, `git ${args.join(' ')}: ${run.stderr}`).toBe(0)
      return run.stdout.trim()
    }

    async function setup(): Promise<Setup> {
      const { formatSums } = await load()
      const dir = mkdtempSync(join(tmpdir(), 'lc-accept-'))
      made.push(dir)
      git(dir, 'init', '-q')
      git(dir, 'commit', '-q', '--allow-empty', '-m', 'before attestations')
      git(dir, 'tag', '-a', 'v0.1.0', '-m', 'old')
      git(dir, 'commit', '-q', '--allow-empty', '-m', 'the attest job')
      const attestedSince = git(dir, 'rev-parse', 'HEAD')
      git(dir, 'commit', '-q', '--allow-empty', '-m', 'after')
      git(dir, 'tag', '-a', 'v1.0.0-rc.1', '-m', 'new')
      const afterCommit = git(dir, 'rev-parse', 'v1.0.0-rc.1^{commit}')
      // The record CLI is the real one: its output is what the step records.
      mkdirSync(join(dir, 'tests', 'acceptance'), { recursive: true })
      for (const name of ['record-cli.mjs', 'pure.mjs']) {
        copyFileSync(
          join(repo, 'tests', 'acceptance', name),
          join(dir, 'tests', 'acceptance', name),
        )
      }
      mkdirSync(join(dir, 'fixtures'))
      mkdirSync(join(dir, 'bin'))
      mkdirSync(join(dir, 'download'))
      writeFileSync(join(dir, 'fixtures', asset), 'dmg\n')
      writeFileSync(
        join(dir, 'fixtures', 'SHA256SUMS.txt'),
        formatSums([{ name: asset, sha256: createHash('sha256').update('dmg\n').digest('hex') }]),
      )
      writeFileSync(
        join(dir, 'bin', 'gh'),
        [
          '#!/bin/bash',
          'echo "$*" >> "$STUB_LOG"',
          'case "$1 $2" in',
          '  "release download")',
          '    while [ $# -gt 0 ]; do [ "$1" = --dir ] && dir=$2; shift; done',
          '    cp "$STUB_FIXTURES"/* "$dir"/ ;;',
          '  "attestation verify")',
          '    [ -z "${STUB_REFUSE:-}" ] || [ "$(basename "$3")" != "$STUB_REFUSE" ] || exit 1 ;;',
          '  *) exit 64 ;;',
          'esac',
          '',
        ].join('\n'),
      )
      chmodSync(join(dir, 'bin', 'gh'), 0o755)
      return { dir, attestedSince, afterCommit }
    }

    function run(setupped: Setup, tag: string, refuse = '') {
      const { dir, attestedSince } = setupped
      const result = asRunner(step, {
        cwd: dir,
        env: {
          ...isolated(),
          PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
          TAG: tag,
          ASSET: asset,
          DOWNLOAD: join(dir, 'download'),
          PRIOR: join(dir, 'prior.json'),
          GITHUB_REPOSITORY: 'owner/repo',
          ATTESTED_SINCE: attestedSince,
          STUB_LOG: join(dir, 'gh-calls.txt'),
          STUB_FIXTURES: join(dir, 'fixtures'),
          STUB_REFUSE: refuse,
        },
      })
      const file = join(dir, 'prior.json')
      const prior = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
      const log = existsSync(join(dir, 'gh-calls.txt'))
        ? readFileSync(join(dir, 'gh-calls.txt'), 'utf8').trim().split('\n')
        : []
      return {
        result,
        field: prior.fields?.['Attestation verified?'] as string | undefined,
        step1: prior.steps?.['1'] as { result: string; notes: string } | undefined,
        verifies: log.filter((line) => line.startsWith('attestation verify')),
      }
    }

    it("verifies a tag the attest job's commit is in, by name and by commit, and records it", async () => {
      const setupped = await setup()
      const done = run(setupped, 'v1.0.0-rc.1')
      expect(done.result.status, done.result.stderr).toBe(0)
      expect(done.field).toBe('yes')
      expect(done.step1?.result).toBe('pass')
      expect(done.verifies).toHaveLength(2)
      expect(done.verifies[0]).toContain(`verify ${join(setupped.dir, 'download', asset)} `)
      expect(done.verifies[1]).toContain(
        `verify ${join(setupped.dir, 'download', 'SHA256SUMS.txt')} `,
      )
      for (const call of done.verifies) {
        expect(call).toContain('--repo owner/repo ')
        expect(call).toContain('--signer-workflow owner/repo/.github/workflows/build.yml ')
        expect(call).toContain('--source-ref refs/tags/v1.0.0-rc.1 ')
        expect(call).toContain(`--source-digest ${setupped.afterCommit} `)
        expect(call).toMatch(/--deny-self-hosted-runners$/)
      }
    })

    it('records a tag from before the attest job as not attested, and asks gh for nothing', async () => {
      const done = run(await setup(), 'v0.1.0')
      expect(done.result.status, done.result.stderr).toBe(0)
      expect(done.field).toBe('not attested (before 1.0)')
      expect(done.step1?.result).toBe('pass, part not automated')
      expect(done.verifies).toEqual([])
    })

    it('fails a tag git cannot find, and records no verification', async () => {
      const done = run(await setup(), 'v9.9.9')
      expect(done.result.status).not.toBe(0)
      expect(done.field).toBe('no')
      expect(done.step1?.result).toBe('fail')
      expect(done.step1?.notes).toContain('Git could not tell whether v9.9.9 contains')
      expect(done.verifies).toEqual([])
    })

    it('fails the step, and records no, when gh refuses the installer', async () => {
      const done = run(await setup(), 'v1.0.0-rc.1', asset)
      expect(done.result.status).not.toBe(0)
      expect(done.field).toBe('no')
      expect(done.step1?.result).toBe('fail')
      expect(done.verifies).toHaveLength(1)
    })

    it('fails the step, and records no, when gh refuses SHA256SUMS.txt alone', async () => {
      const done = run(await setup(), 'v1.0.0-rc.1', 'SHA256SUMS.txt')
      expect(done.result.status).not.toBe(0)
      expect(done.field).toBe('no')
      expect(done.step1?.result).toBe('fail')
      expect(done.step1?.notes).toContain('refused SHA256SUMS.txt')
      expect(done.verifies).toHaveLength(2)
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
