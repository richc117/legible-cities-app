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
    // And a check's refusal is never waved through on its own line.
    expect(step).not.toMatch(/verify-mac-signing\.mjs[^\n]*\|\| true/)
  })

  it('records each build in the words docs/releasing.md quotes', () => {
    // Mutation: the record reworded in the workflow alone, so the release
    // procedure tells the maintainer to look for a sentence no run writes.
    const releasing = readFileSync(join(repo, 'docs', 'releasing.md'), 'utf8').replace(/\s+/g, ' ')
    for (const quoted of [
      "the disk image is signed with the Developer ID, notarised and stapled, and Gatekeeper's assessment accepts the image, the app inside it and the copy as Notarized Developer ID",
      'its ad-hoc signature verifies',
      'The disk image has no signature of its own, so this tag was built ad hoc, with signing off (the MAC_SIGNING variable).',
    ]) {
      expect(step, quoted).toContain(quoted)
      expect(releasing, quoted).toContain(quoted)
    }
  })

  it('holds no secret, joins no environment, and reads one variable, for one sentence', () => {
    // The header's own "No secrets." is a sentence, not a reference.
    expect(workflow).not.toMatch(/\bsecrets\.\w/)
    expect(workflow).not.toMatch(/^\s*environment:/m)
    expect(workflow.match(/\bvars\.\w+/g)).toEqual(['vars.MAC_SIGNING'])
    expect(step).toContain('MAC_SIGNING: ${{ vars.MAC_SIGNING }}')
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
      // `-dv <image>` is whether the image carries a signature of its own;
      // `-dvv <app>` shows, on standard error as codesign does, what the
      // copied app is signed with; anything else is the check of its seal.
      codesign: [
        RECORD,
        'if [ "$1" = -dv ]; then exit "${STUB_IMAGE_UNSIGNED:-0}"; fi',
        'if [ "$1" = -dvv ]; then',
        '  case "${STUB_APP_SIGNATURE:-adhoc}" in',
        '    adhoc) printf "Executable=x\\nSignature=adhoc\\nTeamIdentifier=not set\\n" >&2 ;;',
        `    developer) printf "Executable=x\\nAuthority=Developer ID Application: Example Person (${TEAM})\\nTeamIdentifier=${TEAM}\\n" >&2 ;;`,
        '    almost) printf "Executable=x\\nNot Signature=adhoc really\\n" >&2 ;;',
        '    none) echo "code object is not signed at all" >&2; exit 1 ;;',
        '  esac',
        '  exit 0',
        'fi',
        'exit "${STUB_CODESIGN:-0}"',
      ].join('\n'),
      // No quarantine attribute, as on a runner.
      xattr: 'exit 1',
      node: [
        RECORD,
        'if [ "$1" = scripts/verify-mac-signing.mjs ]; then',
        '  if [ "$2" = dmg ]; then exit "${STUB_DMG:-0}"; fi',
        '  exit "${STUB_APP:-0}"',
        'fi',
      ].join('\n'),
      // A Gatekeeper that is on once a file exists, and the two spellings
      // of the option that turns it on, each of which can be made to fail.
      spctl: [
        RECORD,
        'case "$1" in',
        '  --status) if [ -f "$STUB_STATE" ]; then echo "assessments enabled"; else echo "assessments disabled"; exit 1; fi ;;',
        '  --global-enable) if [ "${STUB_GLOBAL:-works}" = works ]; then touch "$STUB_STATE"; else exit 1; fi ;;',
        '  --master-enable) if [ "${STUB_MASTER:-works}" = works ]; then touch "$STUB_STATE"; else exit 1; fi ;;',
        'esac',
      ].join('\n'),
      sudo: `${RECORD}\nexec "$@"`,
    }
    function run(options: {
      /** The tag carries electron-builder.release.yml. */
      config: boolean
      /** Gatekeeper's assessments are on when the step starts. */
      gatekeeper?: boolean
      env?: Record<string, string>
    }) {
      const dir = scratch()
      mkdirSync(join(dir, 'bin'))
      for (const [name, body] of Object.entries(STUBS)) {
        const file = join(dir, 'bin', name)
        writeFileSync(file, `#!/bin/bash\n${body}\n`)
        chmodSync(file, 0o755)
      }
      mkdirSync(join(dir, 'at-tag'))
      writeFileSync(join(dir, 'at-tag', 'electron-builder.yml'), 'mac:\n  identity: "-"\n')
      if (options.config) {
        writeFileSync(
          join(dir, 'at-tag', 'electron-builder.release.yml'),
          `mac:\n  identity: '${TEAM}'\n`,
        )
      }
      for (const folder of ['temp', 'download']) mkdirSync(join(dir, folder))
      const state = join(dir, 'assessments-on')
      if (options.gatekeeper ?? true) writeFileSync(state, '')
      const file = join(dir, 'step.sh')
      writeFileSync(file, script)
      const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', file], {
        cwd: dir,
        env: {
          PATH: `${join(dir, 'bin')}:/usr/bin:/bin`,
          STUB_LOG: join(dir, 'stub.log'),
          STUB_STATE: state,
          RUNNER_TEMP: join(dir, 'temp'),
          DOWNLOAD: join(dir, 'download'),
          ASSET: 'Legible-Cities-1.0.0-mac-arm64.dmg',
          PRIOR: join(dir, 'prior.json'),
          GITHUB_ENV: join(dir, 'github.env'),
          // As GitHub gives a variable that is not set.
          MAC_SIGNING: '',
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
        image: join(dir, 'download', 'Legible-Cities-1.0.0-mac-arm64.dmg'),
        copy: join(dir, 'temp', 'apps', 'Legible Cities.app'),
        records: calls.filter((call) => call[1] === 'tests/acceptance/record-cli.mjs'),
        checks: calls.filter((call) => call[1] === 'scripts/verify-mac-signing.mjs'),
        codesign: calls.filter((call) => call[0] === 'codesign'),
        sudo: calls.filter((call) => call[0] === 'sudo'),
      }
    }
    const AD_HOC =
      "Not a person's install: the dmg was mounted read-only and Legible Cities.app copied to a temporary folder, not dragged to Applications; the download has no quarantine attribute, so Gatekeeper never asked and the way past its warning was not exercised; its ad-hoc signature verifies."

    it('has a script to run', () => {
      expect(script).toContain('hdiutil attach -readonly')
    })

    it('holds a signed image to the Developer ID checks, image first then the copy', () => {
      const { result, image, copy, checks, records, codesign, sudo, handed, dir } = run({
        config: true,
      })
      expect(result.status).toBe(0)
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
      // The image was asked whether it is signed, and the ad-hoc check is
      // not what judges this build.
      expect(codesign).toEqual([['codesign', '-dv', image]])
      // Gatekeeper was on already: said, and left alone.
      expect(result.stdout).toContain(
        'Gatekeeper before: assessments enabled\nGatekeeper after: assessments enabled\n',
      )
      expect(sudo).toEqual([])
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
        const { result, checks, records, handed } = run({ config: true, env })
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

    it('turns Gatekeeper on before the checks where the runner has it off', () => {
      const first = run({ config: true, gatekeeper: false })
      expect(first.result.status).toBe(0)
      expect(first.result.stdout).toContain(
        'Gatekeeper before: assessments disabled\nGatekeeper after: assessments enabled\n',
      )
      expect(first.sudo).toEqual([['sudo', 'spctl', '--global-enable']])
      expect(first.checks.map((call) => call[2])).toEqual(['dmg', 'developer-id'])
      // On before the first check, not after it.
      const order = first.calls.map((call) => `${call[0]} ${call[1] ?? ''} ${call[2] ?? ''}`)
      expect(order.indexOf('sudo spctl --global-enable')).toBeLessThan(
        order.indexOf('node scripts/verify-mac-signing.mjs dmg'),
      )
      // The other spelling, where the first is not taken.
      const second = run({ config: true, gatekeeper: false, env: { STUB_GLOBAL: 'fails' } })
      expect(second.result.status).toBe(0)
      expect(second.sudo.map((call) => call[2])).toEqual(['--global-enable', '--master-enable'])
    })

    it('fails the step where Gatekeeper will not come on, before any check', () => {
      // Mutation: the status after not read, so the checks run on a runner
      // that accepts everything and their verdicts are the setting's.
      const { result, checks, records, handed, sudo } = run({
        config: true,
        gatekeeper: false,
        env: { STUB_GLOBAL: 'fails', STUB_MASTER: 'fails' },
      })
      expect(result.status).toBe(1)
      expect(sudo).toHaveLength(2)
      expect(checks).toEqual([])
      expect(result.stdout).toContain('Gatekeeper after: assessments disabled\n')
      expect(result.stdout).toContain(
        "::error::Gatekeeper's assessments are off on this runner and could not be turned on",
      )
      expect(records.map((call) => call.slice(4, 7))).toEqual([['step', '2', 'fail']])
      expect(records[0][7]).toContain('were not run')
      expect(handed).toBe('')
    })

    it('records a tag built with signing off as the ad-hoc build it is', () => {
      // Mutation: the release config alone taken to mean a signed build, so
      // a candidate cut before there was a certificate fails its own gate.
      const { result, checks, records, codesign, sudo, image, copy } = run({
        config: true,
        env: { STUB_IMAGE_UNSIGNED: '1' },
      })
      expect(result.status).toBe(0)
      expect(checks).toEqual([])
      expect(sudo).toEqual([])
      expect(codesign).toEqual([
        ['codesign', '-dv', image],
        ['codesign', '-dvv', copy],
        ['codesign', '--verify', '--deep', '--strict', copy],
      ])
      expect(records).toHaveLength(1)
      expect(records[0].slice(4)).toEqual([
        'step',
        '2',
        'not automated',
        `${AD_HOC} The disk image has no signature of its own, so this tag was built ad hoc, with signing off (the MAC_SIGNING variable). The app is opened by the spec in step 3.`,
      ])
      // Nothing more is said while signing is still off for the repository.
      expect(result.stdout).not.toContain('::warning::')
    })

    it('warns when signing is on now and the tag was built without it', () => {
      const { result, records } = run({
        config: true,
        env: { STUB_IMAGE_UNSIGNED: '1', MAC_SIGNING: 'on' },
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain(
        "::warning::signing is on for this repository now, and this tag's Mac image is not signed",
      )
      expect(records[0][6]).toBe('not automated')
      // And never for a tag that could not have been signed.
      const older = run({ config: false, env: { MAC_SIGNING: 'on' } })
      expect(older.result.stdout).not.toContain('::warning::')
    })

    it('records a tag from before the release config as ad hoc, in the words it always used', () => {
      const { result, checks, records, codesign, copy } = run({ config: false })
      expect(result.status).toBe(0)
      expect(checks).toEqual([])
      // The image is not even asked: there was no signing to do.
      expect(codesign).toEqual([
        ['codesign', '-dvv', copy],
        ['codesign', '--verify', '--deep', '--strict', copy],
      ])
      expect(records).toHaveLength(1)
      expect(records[0].slice(4)).toEqual([
        'step',
        '2',
        'not automated',
        `${AD_HOC} The app is opened by the spec in step 3.`,
      ])
      const broken = run({ config: false, env: { STUB_CODESIGN: '1' } })
      expect(broken.records[0][7]).toContain('its signature does not verify')
    })

    it('fails an unsigned image whose app is not signed ad hoc, whatever the tag', () => {
      // Mutation: the app in an unsigned image taken for ad hoc unread, so
      // one signed with a certificate, or not signed at all, is held to no
      // Developer ID check and recorded as an ad-hoc build.
      const cases: { config: boolean; signature: string }[] = [
        { config: true, signature: 'developer' },
        { config: true, signature: 'none' },
        // The words alone, inside another line, are not the mark.
        { config: true, signature: 'almost' },
        { config: false, signature: 'developer' },
      ]
      for (const { config, signature } of cases) {
        const { result, records, checks, handed, codesign, copy } = run({
          config,
          env: { STUB_IMAGE_UNSIGNED: '1', STUB_APP_SIGNATURE: signature },
        })
        const label = `${config} ${signature}`
        expect(result.status, label).toBe(1)
        expect(result.stdout, label).toContain(
          '::error::the disk image is unsigned and the app inside is not signed ad hoc',
        )
        expect(
          records.map((call) => call.slice(4, 7)),
          label,
        ).toEqual([['step', '2', 'fail']])
        expect(records[0][7], label).toContain('neither build this repository makes')
        expect(checks, label).toEqual([])
        // Refused before the seal is even checked, and no app for the spec.
        expect(codesign[codesign.length - 1], label).toEqual(['codesign', '-dvv', copy])
        expect(handed, label).toBe('')
      }
    })

    it('fails an image with no app in it, whatever the tag', () => {
      const { result, records, checks } = run({ config: true, env: { STUB_NO_APP: '1' } })
      expect(result.status).toBe(1)
      expect(records.map((call) => call.slice(4, 7))).toEqual([['step', '2', 'fail']])
      expect(checks).toEqual([])
    })
  })
})
