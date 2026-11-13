// acceptance.yml's step 2 on macOS, for a Release whose Mac installer is a
// Developer ID build (issue 686, ADR-062). The workflow is dispatched by
// hand against a published tag, so nothing before the gate itself would
// show a mistake in it: its shape is held here, and the step is run as a
// runner runs it, with hdiutil, ditto, codesign, xattr and node played by
// stand-ins that write down what they were asked. Each rule has a test that
// fails when the rule is taken out
// (tests/unit/acceptance-signing.mutations.json).

import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '../..')
// A made-up team, as the tag's release config would name its own.
const TEAM = 'ABCDE12345'

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'lc-acceptance-signing-test-'))
  made.push(dir)
  return dir
}

describe("acceptance.yml's step 2 on macOS", () => {
  const workflow = readFileSync(join(repo, '.github', 'workflows', 'acceptance.yml'), 'utf8')
  const step = workflow.slice(
    workflow.indexOf('- name: Step 2, install on macOS'),
    workflow.indexOf('- name: Step 2, install on Windows'),
  )

  it("takes the release config from the tag, beside the tag's other files", () => {
    const sparse = /sparse-checkout: \|\n((?: {12}\S[^\n]*\n)+)/.exec(workflow)
    expect(sparse).not.toBeNull()
    expect(
      (sparse as RegExpExecArray)[1]
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    ).toEqual([
      'vendor/pins.json',
      'package.json',
      'electron-builder.yml',
      'electron-builder.release.yml',
    ])
  })

  it('never asks the stapler about the copied app, and names no team of its own', () => {
    expect(step.length).toBeGreaterThan(0)
    // Only the script's dmg mode validates a staple, and only on the image.
    expect(
      step
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n'),
    ).not.toContain('stapler')
    // The team is the tag's own, read from its config.
    expect(step).not.toMatch(/--team [A-Z0-9]/)
    expect(step).not.toContain('|| true')
  })

  it('holds no secret and joins no environment', () => {
    // The header's own "No secrets." is a sentence, not a reference.
    expect(workflow).not.toMatch(/\bsecrets\.\w/)
    expect(workflow).not.toMatch(/^\s*environment:/m)
  })

  describe.skipIf(process.platform === 'win32')('run as a runner runs it', () => {
    const block = /\n {8}run: \|\n((?: {10}[^\n]*\n|\n)+)/.exec(step)
    const script = block === null ? '' : block[1].replace(/^ {10}/gm, '')
    /** What a stand-in was called with, one call a line, its arguments tab-separated. */
    const RECORD =
      'printf "%s" "$(basename "$0")" >> "$STUB_LOG"; for a in "$@"; do printf "\\t%s" "$a" >> "$STUB_LOG"; done; printf "\\n" >> "$STUB_LOG"'
    const STUBS: Record<string, string> = {
      // `attach ... -mountpoint <folder> <image>` puts the app in the folder.
      hdiutil: [
        RECORD,
        'if [ "$1" = attach ] && [ -z "${STUB_NO_APP:-}" ]; then',
        '  while [ "$#" -gt 0 ]; do if [ "$1" = -mountpoint ]; then mkdir -p "$2/Legible Cities.app"; fi; shift; done',
        'fi',
      ].join('\n'),
      ditto: `${RECORD}\nmkdir -p "$2"`,
      codesign: `${RECORD}\nexit "\${STUB_CODESIGN:-0}"`,
      // No quarantine attribute, as on a runner.
      xattr: 'exit 1',
      node: [
        RECORD,
        'if [ "$1" = scripts/verify-mac-signing.mjs ]; then',
        '  if [ "$2" = dmg ]; then exit "${STUB_DMG:-0}"; fi',
        '  exit "${STUB_APP:-0}"',
        'fi',
      ].join('\n'),
    }
    function run(options: { signedTag: boolean; env?: Record<string, string> }) {
      const dir = scratch()
      mkdirSync(join(dir, 'bin'))
      for (const [name, body] of Object.entries(STUBS)) {
        const file = join(dir, 'bin', name)
        writeFileSync(file, `#!/bin/bash\n${body}\n`)
        chmodSync(file, 0o755)
      }
      mkdirSync(join(dir, 'at-tag'))
      writeFileSync(join(dir, 'at-tag', 'electron-builder.yml'), 'mac:\n  identity: "-"\n')
      if (options.signedTag) {
        writeFileSync(
          join(dir, 'at-tag', 'electron-builder.release.yml'),
          `mac:\n  identity: '${TEAM}'\n`,
        )
      }
      for (const folder of ['temp', 'download']) mkdirSync(join(dir, folder))
      const file = join(dir, 'step.sh')
      writeFileSync(file, script)
      const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', file], {
        cwd: dir,
        env: {
          PATH: `${join(dir, 'bin')}:/usr/bin:/bin`,
          STUB_LOG: join(dir, 'stub.log'),
          RUNNER_TEMP: join(dir, 'temp'),
          DOWNLOAD: join(dir, 'download'),
          ASSET: 'Legible-Cities-1.0.0-mac-arm64.dmg',
          PRIOR: join(dir, 'prior.json'),
          GITHUB_ENV: join(dir, 'github.env'),
          ...options.env,
        },
        encoding: 'utf8',
        timeout: 30_000,
      })
      const calls = readFileSync(join(dir, 'stub.log'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.split('\t'))
      const handed = existsSync(join(dir, 'github.env'))
        ? readFileSync(join(dir, 'github.env'), 'utf8')
        : ''
      return {
        result,
        dir,
        calls,
        handed,
        records: calls.filter((call) => call[1] === 'tests/acceptance/record-cli.mjs'),
        checks: calls.filter((call) => call[1] === 'scripts/verify-mac-signing.mjs'),
      }
    }

    it('has a script to run', () => {
      expect(script).toContain('hdiutil attach -readonly')
    })

    it('holds a tag that carries the release config to the Developer ID checks, image first then the copy', () => {
      const { result, dir, checks, records, calls, handed } = run({ signedTag: true })
      expect(result.status).toBe(0)
      const image = join(dir, 'download', 'Legible-Cities-1.0.0-mac-arm64.dmg')
      const copy = join(dir, 'temp', 'apps', 'Legible Cities.app')
      expect(checks).toEqual([
        [
          'node',
          'scripts/verify-mac-signing.mjs',
          'dmg',
          image,
          '--team-from',
          'at-tag/electron-builder.release.yml',
        ],
        [
          'node',
          'scripts/verify-mac-signing.mjs',
          'developer-id',
          copy,
          '--team-from',
          'at-tag/electron-builder.release.yml',
          '--notarized',
        ],
      ])
      // The ad-hoc check is not what judges this build.
      expect(calls.filter((call) => call[0] === 'codesign')).toEqual([])
      // Checked, and still not a person's first open: never recorded as passed.
      expect(records).toHaveLength(1)
      expect(records[0].slice(2, 7)).toEqual([
        'prior',
        join(dir, 'prior.json'),
        'step',
        '2',
        'not automated',
      ])
      expect(records[0][7]).toContain(
        'the download has no quarantine attribute, so Gatekeeper never asked',
      )
      expect(records[0][7]).toContain('as Notarized Developer ID')
      expect(handed).toContain(`LEGIBLE_ACCEPTANCE_APP=${copy}\n`)
    })

    it('fails the step when the image or the copy is refused, after running both, and hands the spec no app', () => {
      // Mutation: the checks' exit status dropped, so a Release whose image
      // is not notarised is recorded as one that is.
      const refusals: Record<string, string>[] = [
        { STUB_DMG: '1' },
        { STUB_APP: '1' },
        { STUB_DMG: '2', STUB_APP: '1' },
      ]
      for (const env of refusals) {
        const { result, checks, records, handed } = run({ signedTag: true, env })
        expect(result.status, JSON.stringify(env)).toBe(1)
        expect(checks.map((call) => call[2])).toEqual(['dmg', 'developer-id'])
        expect(records.map((call) => call.slice(4, 7))).toEqual([['step', '2', 'fail']])
        expect(records[0][7]).toContain(
          'failed a check of its signature, its notarisation or its staple',
        )
        expect(result.stdout).toContain('::error::the disk image or the app copied from it failed')
        expect(handed).toBe('')
      }
    })

    it('records a tag from before the release config as ad hoc, in the words it always used', () => {
      const { result, checks, records, calls, dir } = run({ signedTag: false })
      expect(result.status).toBe(0)
      expect(checks).toEqual([])
      expect(calls.filter((call) => call[0] === 'codesign')).toEqual([
        [
          'codesign',
          '--verify',
          '--deep',
          '--strict',
          join(dir, 'temp', 'apps', 'Legible Cities.app'),
        ],
      ])
      expect(records).toHaveLength(1)
      expect(records[0].slice(4)).toEqual([
        'step',
        '2',
        'not automated',
        "Not a person's install: the dmg was mounted read-only and Legible Cities.app copied to a temporary folder, not dragged to Applications; the download has no quarantine attribute, so Gatekeeper never asked and the way past its warning was not exercised; its ad-hoc signature verifies. The app is opened by the spec in step 3.",
      ])
      const broken = run({ signedTag: false, env: { STUB_CODESIGN: '1' } })
      expect(broken.records[0][7]).toContain('its signature does not verify')
    })

    it('fails an image with no app in it, whatever the tag', () => {
      const { result, records, checks } = run({ signedTag: true, env: { STUB_NO_APP: '1' } })
      expect(result.status).toBe(1)
      expect(records.map((call) => call.slice(4, 7))).toEqual([['step', '2', 'fail']])
      expect(checks).toEqual([])
    })
  })
})
