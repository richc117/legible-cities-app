// What a Mac build is signed with (issue 686, ADR-062):
// scripts/verify-mac-signing.mjs with codesign, spctl, syspolicy_check, the
// stapler and hdiutil played by a stand-in, so nothing here needs a Mac, a
// certificate or a signed build. The outputs the stand-in gives are shaped
// as the real tools print them, with a made-up team. The rules each have a
// test that fails when the rule is taken out
// (tests/unit/verify-mac-signing.mutations.json): the placeholder Team ID is
// refused before anything runs, an ad-hoc build is not a Developer ID one
// nor the reverse, and an overridden Gatekeeper verdict is a failure. What
// the workflows do with the script is held beside them: build.yml's steps
// in tests/unit/release.test.ts, acceptance.yml's step 2 in
// tests/unit/acceptance-signing.test.ts.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '../..')
const SCRIPT = join(repo, 'scripts', 'verify-mac-signing.mjs')

interface Result {
  status: number | null
  signal?: string | null
  stdout: string
  stderr: string
  error: string | null
  timedOut: boolean
}
type Run = (command: string, args: string[], timeoutMs: number) => Result
interface Display {
  authorities: string[]
  team: string | null
  signature: string | null
  timestamp: string | null
  flags: string[] | null
}
interface Check {
  what: string
  command: string
  args: string[]
  timeoutMs: number
  judge(result: Result, timeoutMs: number): string[]
}
interface Io {
  run: Run
  say(line: string): void
  makeMount(): string
  removeMount(folder: string): void
  list(folder: string): string[]
}
interface Parsed {
  mode: string
  path: string
  team: string | null
  teamFrom: string | null
  notarized: boolean
}
interface Module {
  EXIT: { passed: number; failed: number; usage: number }
  PLACEHOLDER: string
  PYTHON: string[]
  LIBRARY_VALIDATION: string
  teamProblem(team: unknown): string | null
  teamFromConfig(text: string): string | null
  parseDisplay(text: string): Display
  judgeAdhoc(display: Display): string[]
  judgeDeveloperId(display: Display, team: string, options?: { runtime?: boolean }): string[]
  entitled(text: string, key: string): boolean
  entitlementKeys(text: string): string[]
  judgeAssessment(output: string, team: string): string[]
  statusCheck(): Check
  signatureChecks(app: string, options: { mode: string; team?: string | null }): Check[]
  notarizedChecks(app: string, team: string): Check[]
  imageChecks(dmg: string, team: string): Check[]
  runChild: Run
  verify(
    options: { mode: string; path: string; team?: string | null; notarized?: boolean },
    io: Io,
  ): number
  worstCaseMs(mode: string, options?: { notarized?: boolean }): number
  parseArgs(argv: string[]): Parsed | null
  main(
    argv: string[],
    io?: Partial<Io> & { out?: { write(text: string): void }; platform?: string },
  ): number
}
// A URL built at run time, so the type checker does not look for
// declarations of a plain JavaScript module.
const load = (): Promise<Module> => import(pathToFileURL(SCRIPT).href) as Promise<Module>

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'lc-verify-mac-signing-test-'))
  made.push(dir)
  return dir
}

// A made-up team, and a second one for the wrong-team cases.
const TEAM = 'ABCDE12345'
const OTHER = 'ZYXWV98765'
const APP = '/release/mac-arm64/Legible Cities.app'
const DMG = '/release/Legible Cities-1.0.0-arm64.dmg'
const MOUNT = '/tmp/mount-686'

// As `codesign -dvv` prints them, on standard error.
const developerId = (team = TEAM): string =>
  [
    `Executable=${APP}/Contents/MacOS/Legible Cities`,
    'Identifier=com.example.legiblecities',
    'Format=app bundle with Mach-O thin (arm64)',
    'CodeDirectory v=20500 size=759 flags=0x10000(runtime) hashes=13+7 location=embedded',
    'Signature size=8975',
    `Authority=Developer ID Application: Example Person (${team})`,
    'Authority=Developer ID Certification Authority',
    'Authority=Apple Root CA',
    'Timestamp=Jan 2, 2026 at 3:04:05 AM',
    'Info.plist entries=39',
    `TeamIdentifier=${team}`,
    'Runtime Version=15.1.0',
    'Sealed Resources version=2 rules=13 files=23',
    'Internal requirements count=1 size=172',
    '',
  ].join('\n')
const ADHOC = [
  `Executable=${APP}/Contents/MacOS/Legible Cities`,
  'Identifier=com.example.legiblecities',
  'Format=app bundle with Mach-O thin (arm64)',
  'CodeDirectory v=20500 size=433 flags=0x10002(adhoc,runtime) hashes=3+7 location=embedded',
  'Signature=adhoc',
  'Info.plist entries=39',
  'TeamIdentifier=not set',
  'Runtime Version=15.1.0',
  'Sealed Resources version=2 rules=13 files=23',
  'Internal requirements count=0 size=12',
  '',
].join('\n')
const IMAGE = [
  `Executable=${DMG}`,
  'Identifier=Legible Cities-1.0.0-arm64',
  'Format=disk image',
  'CodeDirectory v=20200 size=312 flags=0x0(none) hashes=1+7 location=embedded',
  'Signature size=8974',
  `Authority=Developer ID Application: Example Person (${TEAM})`,
  'Authority=Developer ID Certification Authority',
  'Authority=Apple Root CA',
  'Timestamp=Jan 2, 2026 at 3:04:06 AM',
  `TeamIdentifier=${TEAM}`,
  '',
].join('\n')
const plist = (keys: string[]): string =>
  `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>${keys.map((key) => `<key>${key}</key><true/>`).join('')}</dict></plist>`
const TEMPLATE = [
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.disable-library-validation',
]
const accepted = (path: string, team = TEAM): string =>
  `${path}: accepted\nsource=Notarized Developer ID\norigin=Developer ID Application: Example Person (${team})\n`

const ok = (stdout = '', stderr = ''): Result => ({
  status: 0,
  stdout,
  stderr,
  error: null,
  timedOut: false,
})
const exited = (status: number, stderr = ''): Result => ({
  status,
  stdout: '',
  stderr,
  error: null,
  timedOut: false,
})

interface Session {
  io: Io
  calls: { command: string; args: string[]; timeoutMs: number }[]
  lines(): string[]
  said: string[]
  removed: string[]
}
/**
 * A machine holding a build signed and notarised as `signed` says, unless
 * `instead` answers a call first.
 */
function session(
  signed: 'adhoc' | 'developer-id',
  instead: (command: string, args: string[]) => Result | undefined = () => undefined,
  apps: string[] = ['Legible Cities.app', '.background', 'Applications'],
): Session {
  const calls: Session['calls'] = []
  const said: string[] = []
  const removed: string[] = []
  const run: Run = (command, args, timeoutMs) => {
    calls.push({ command, args, timeoutMs })
    const other = instead(command, args)
    if (other !== undefined) return other
    const target = args[args.length - 1]
    if (command === 'codesign' && args[0] === '--verify') {
      if (args.includes('-R=notarized') && signed === 'adhoc') {
        return exited(3, `${target}: code failed to satisfy specified code requirement(s)`)
      }
      return ok('', `${target}: valid on disk\n${target}: satisfies its Designated Requirement\n`)
    }
    if (command === 'codesign' && args[0] === '-dvv') {
      if (target.endsWith('.dmg')) return ok('', IMAGE)
      return ok('', signed === 'adhoc' ? ADHOC : developerId())
    }
    if (command === 'codesign' && args[0] === '-d') {
      return ok(plist(TEMPLATE), `Executable=${target}\n`)
    }
    if (command === 'spctl' && args[0] === '--status') return ok('assessments enabled\n')
    if (command === 'spctl') {
      return signed === 'adhoc' ? exited(3, `${target}: rejected\n`) : ok('', accepted(target))
    }
    if (command === 'syspolicy_check') {
      return ok('App passed all pre-distribution checks and is ready for distribution.\n')
    }
    if (command === 'xcrun') return ok(`Processing: ${target}\nThe validate action worked!\n`)
    if (command === 'hdiutil') return ok()
    throw new Error(`the stand-in was asked for ${command} ${args.join(' ')}`)
  }
  return {
    io: {
      run,
      say: (line) => said.push(line),
      makeMount: () => MOUNT,
      removeMount: (folder) => removed.push(folder),
      list: () => apps,
    },
    calls,
    lines: () => calls.map((call) => `${call.command} ${call.args.join(' ')}`),
    said,
    removed,
  }
}

const python = (app: string): string => `${app}/Contents/Resources/python/bin/python3`
const signatureLines = (app: string): string[] => [
  `codesign --verify --deep --strict --verbose=2 ${app}`,
  `codesign -dvv ${app}`,
  `codesign -dvv ${python(app)}`,
  `codesign -d --entitlements - --xml ${app}`,
  `codesign -d --entitlements - --xml ${python(app)}`,
]
const notarizedLines = (app: string): string[] => [
  `codesign --verify --deep --strict -R=notarized --check-notarization -vv ${app}`,
  `spctl -a -t exec -vv ${app}`,
  `syspolicy_check distribution ${app}`,
]

describe('the team', () => {
  it('is ten capital letters and digits, and never the placeholder', async () => {
    const { teamProblem, PLACEHOLDER } = await load()
    expect(PLACEHOLDER).toBe('TEAMID_TBD')
    expect(teamProblem(TEAM)).toBeNull()
    expect(teamProblem('0123456789')).toBeNull()
    expect(teamProblem('TEAMID_TBD')).toBe(
      "the Team ID is still the placeholder TEAMID_TBD: write the Developer ID Team ID into electron-builder.release.yml's mac.identity before signing a build or checking a signed one",
    )
    for (const bad of ['abcde12345', 'ABCDE1234', 'ABCDE123456', '-', '', null, undefined, 12]) {
      expect(teamProblem(bad), String(bad)).toContain('is not a Team ID')
    }
  })

  it("is read from the release config's mac.identity, in whatever quotes", async () => {
    const { teamFromConfig } = await load()
    const committed = teamFromConfig(
      readFileSync(join(repo, 'electron-builder.release.yml'), 'utf8'),
    )
    expect(committed).toMatch(/^(TEAMID_TBD|[A-Z0-9]{10})$/)
    // The base config's is the ad-hoc mark, which is no team.
    expect(teamFromConfig(readFileSync(join(repo, 'electron-builder.yml'), 'utf8'))).toBe('-')
    expect(teamFromConfig(`mac:\n  identity: '${TEAM}'\n`)).toBe(TEAM)
    expect(teamFromConfig(`mac:\n  identity: "${TEAM}" # the team\n`)).toBe(TEAM)
    expect(teamFromConfig(`mac:\n  # why\n\n  notarize: false\n  identity: ${TEAM}\n`)).toBe(TEAM)
    // Only under mac:, and only where there is one.
    expect(teamFromConfig(`win:\n  identity: '${OTHER}'\nmac:\n  identity: '${TEAM}'\n`)).toBe(TEAM)
    expect(teamFromConfig(`mac:\n  notarize: false\nwin:\n  identity: '${OTHER}'\n`)).toBeNull()
    expect(teamFromConfig(`# mac:\n#   identity: '${OTHER}'\n`)).toBeNull()
    expect(teamFromConfig('')).toBeNull()
  })
})

describe("codesign's display", () => {
  it('is read into the fields the judgements use', async () => {
    const { parseDisplay } = await load()
    expect(parseDisplay(developerId())).toEqual({
      authorities: [
        `Developer ID Application: Example Person (${TEAM})`,
        'Developer ID Certification Authority',
        'Apple Root CA',
      ],
      team: TEAM,
      // `Signature size=8975` is not the ad-hoc mark.
      signature: null,
      timestamp: 'Jan 2, 2026 at 3:04:05 AM',
      flags: ['runtime'],
    })
    expect(parseDisplay(ADHOC)).toEqual({
      authorities: [],
      team: 'not set',
      signature: 'adhoc',
      timestamp: null,
      flags: ['adhoc', 'runtime'],
    })
    expect(parseDisplay(IMAGE).flags).toEqual(['none'])
    expect(parseDisplay('code object is not signed at all').flags).toBeNull()
  })

  it("reads only what follows the code directory's own line, the last of them", async () => {
    // Mutation: every line read, so an executable named with a line break
    // in it writes its own TeamIdentifier, Authority and Timestamp into the
    // display, above the lines codesign prints for the signature itself.
    const { parseDisplay, judgeDeveloperId, judgeAdhoc } = await load()
    // An ad-hoc build whose executable's name carries a whole forged
    // signature, a code directory line among it.
    const forged = [
      `Executable=${APP}/Contents/MacOS/Legible Cities`,
      `TeamIdentifier=${TEAM}`,
      `Authority=Developer ID Application: Example Person (${TEAM})`,
      'Timestamp=Jan 2, 2026 at 3:04:05 AM',
      'CodeDirectory v=20500 size=759 flags=0x10000(runtime) hashes=13+7 location=embedded',
      'Signature size=8975',
      'Identifier=com.example.legiblecities',
      'Format=app bundle with Mach-O thin (arm64)',
      'CodeDirectory v=20500 size=433 flags=0x2(adhoc) hashes=3+7 location=embedded',
      'Signature=adhoc',
      'Info.plist entries=39',
      'TeamIdentifier=not set',
      '',
    ].join('\n')
    expect(parseDisplay(forged)).toEqual({
      authorities: [],
      team: 'not set',
      signature: 'adhoc',
      timestamp: null,
      flags: ['adhoc'],
    })
    expect(judgeDeveloperId(parseDisplay(forged), TEAM)).toEqual([
      'it is signed ad hoc, not with a Developer ID',
      'its first authority is missing, not a "Developer ID Application" certificate',
      `TeamIdentifier is "not set", not ${TEAM}`,
      'it has no secure timestamp (no Timestamp line), which the notary requires',
      'the hardened runtime is not on: "runtime" is not among the code directory\'s flags',
    ])
    // The other way about: a Developer ID build dressed as an ad-hoc one.
    const dressed = `Executable=${APP}/Contents/MacOS/x\nSignature=adhoc\nTeamIdentifier=not set\n${developerId()
      .split('\n')
      .slice(1)
      .join('\n')}`
    expect(parseDisplay(dressed).signature).toBeNull()
    expect(parseDisplay(dressed).team).toBe(TEAM)
    expect(judgeAdhoc(parseDisplay(dressed))).toHaveLength(3)
    // With no code directory line there is nothing to read, whatever is said.
    expect(parseDisplay(`TeamIdentifier=${TEAM}\nSignature=adhoc\n`)).toEqual({
      authorities: [],
      team: null,
      signature: null,
      timestamp: null,
      flags: null,
    })
  })

  it('passes an ad-hoc build and names what a Developer ID one is not', async () => {
    const { parseDisplay, judgeAdhoc } = await load()
    expect(judgeAdhoc(parseDisplay(ADHOC))).toEqual([])
    expect(judgeAdhoc(parseDisplay(developerId()))).toEqual([
      'it is not signed ad hoc: Signature is not given, not "adhoc"',
      `an ad-hoc signature names no authority, and this names Developer ID Application: Example Person (${TEAM})`,
      `TeamIdentifier is "${TEAM}", not "not set"`,
    ])
    expect(judgeAdhoc(parseDisplay(ADHOC.replace('(adhoc,runtime)', '(adhoc)')))).toEqual([
      'the hardened runtime is not on: "runtime" is not among the code directory\'s flags',
    ])
  })

  it("passes the team's Developer ID build and names what an ad-hoc one is not", async () => {
    const { parseDisplay, judgeDeveloperId } = await load()
    expect(judgeDeveloperId(parseDisplay(developerId()), TEAM)).toEqual([])
    expect(judgeDeveloperId(parseDisplay(ADHOC), TEAM)).toEqual([
      'it is signed ad hoc, not with a Developer ID',
      'its first authority is missing, not a "Developer ID Application" certificate',
      `TeamIdentifier is "not set", not ${TEAM}`,
      'it has no secure timestamp (no Timestamp line), which the notary requires',
    ])
  })

  it("refuses another team's certificate, a development one, no timestamp and no runtime", async () => {
    const { parseDisplay, judgeDeveloperId } = await load()
    expect(judgeDeveloperId(parseDisplay(developerId(OTHER)), TEAM)).toEqual([
      `its certificate is team ${OTHER}'s, not ${TEAM}'s`,
      `TeamIdentifier is "${OTHER}", not ${TEAM}`,
    ])
    const development = developerId().replace(
      'Authority=Developer ID Application:',
      'Authority=Apple Development:',
    )
    expect(judgeDeveloperId(parseDisplay(development), TEAM)).toEqual([
      `its first authority is "Apple Development: Example Person (${TEAM})", not a "Developer ID Application" certificate`,
    ])
    // Without a secure timestamp codesign prints the signing machine's own
    // clock as `Signed Time=`, which is not one.
    const untimed = developerId().replace('Timestamp=', 'Signed Time=')
    expect(judgeDeveloperId(parseDisplay(untimed), TEAM)).toEqual([
      'it has no secure timestamp (no Timestamp line), which the notary requires',
    ])
    const soft = developerId().replace('flags=0x10000(runtime)', 'flags=0x0(none)')
    expect(judgeDeveloperId(parseDisplay(soft), TEAM)).toEqual([
      'the hardened runtime is not on: "runtime" is not among the code directory\'s flags',
    ])
    // A disk image has no runtime to harden.
    expect(judgeDeveloperId(parseDisplay(IMAGE), TEAM, { runtime: false })).toEqual([])
    expect(judgeDeveloperId(parseDisplay(IMAGE), TEAM)).toHaveLength(1)
  })
})

describe('the entitlements', () => {
  it('must set library validation off, as true, by its whole name', async () => {
    const { entitled, entitlementKeys, LIBRARY_VALIDATION } = await load()
    expect(LIBRARY_VALIDATION).toBe('com.apple.security.cs.disable-library-validation')
    expect(entitled(plist(TEMPLATE), LIBRARY_VALIDATION)).toBe(true)
    expect(entitlementKeys(plist(TEMPLATE))).toEqual(TEMPLATE)
    expect(entitled(plist(TEMPLATE.slice(0, 2)), LIBRARY_VALIDATION)).toBe(false)
    expect(
      entitled(
        plist(TEMPLATE).replace(
          `${LIBRARY_VALIDATION}</key><true/>`,
          `${LIBRARY_VALIDATION}</key><false/>`,
        ),
        LIBRARY_VALIDATION,
      ),
    ).toBe(false)
    // The dots are dots: a longer or a look-alike name is not the key.
    expect(entitled(plist([`${LIBRARY_VALIDATION}.not`]), LIBRARY_VALIDATION)).toBe(false)
    expect(entitled(plist([LIBRARY_VALIDATION.replaceAll('.', 'x')]), LIBRARY_VALIDATION)).toBe(
      false,
    )
    expect(entitled('', LIBRARY_VALIDATION)).toBe(false)
  })
})

describe("Gatekeeper's verdict", () => {
  it('passes only accepted, Notarized Developer ID, from the team', async () => {
    const { judgeAssessment } = await load()
    expect(judgeAssessment(accepted(APP), TEAM)).toEqual([])
    expect(judgeAssessment(`${APP}: rejected\nsource=Unnotarized Developer ID\n`, TEAM)).toEqual([
      'Gatekeeper did not accept it',
      'its source is "Unnotarized Developer ID", not "Notarized Developer ID"',
      `its origin is null, not a certificate of team ${TEAM}`,
    ])
    expect(judgeAssessment(accepted(APP, OTHER), TEAM)).toEqual([
      `its origin is "Developer ID Application: Example Person (${OTHER})", not a certificate of team ${TEAM}`,
    ])
    expect(judgeAssessment('', TEAM)).toHaveLength(3)
  })

  it('fails on any override line, whatever else the verdict says', async () => {
    const { judgeAssessment } = await load()
    expect(judgeAssessment(`${accepted(APP)}override=security disabled\n`, TEAM)).toEqual([
      'the verdict is overridden on this machine (override=security disabled), so it says nothing about the signature',
    ])
  })
})

describe('adhoc', () => {
  it('runs the five signature checks, and nothing that asks Gatekeeper', async () => {
    const { verify, EXIT } = await load()
    const s = session('adhoc')
    expect(verify({ mode: 'adhoc', path: APP }, s.io)).toBe(EXIT.passed)
    expect(s.lines()).toEqual(signatureLines(APP))
    for (const call of s.calls) expect(call.timeoutMs).toBeGreaterThan(0)
    expect(s.said[s.said.length - 1]).toBe(`verify: ${APP} passed every check as an ad-hoc build`)
  })

  it('fails a Developer ID build, and goes on to the checks after the one that failed', async () => {
    const { verify, EXIT } = await load()
    const s = session('developer-id')
    expect(verify({ mode: 'adhoc', path: APP }, s.io)).toBe(EXIT.failed)
    expect(s.lines()).toEqual(signatureLines(APP))
    expect(s.said).toContain(
      '  FAILED: it is not signed ad hoc: Signature is not given, not "adhoc"',
    )
    // The app's display and the bundled Python's.
    expect(s.said[s.said.length - 1]).toBe(`verify: 2 checks failed for ${APP}`)
  })

  it('fails a broken seal, a missing entitlement, and a check that could not run', async () => {
    const { verify, EXIT, LIBRARY_VALIDATION } = await load()
    const broken = session('adhoc', (command, args) =>
      command === 'codesign' && args[0] === '--verify'
        ? exited(1, `${APP}: a sealed resource is missing or invalid`)
        : undefined,
    )
    expect(verify({ mode: 'adhoc', path: APP }, broken.io)).toBe(EXIT.failed)
    expect(broken.said).toContain('  FAILED: it exited 1')
    expect(broken.said).toContain(`    ${APP}: a sealed resource is missing or invalid`)

    // The bundled Python alone without the entitlement.
    const bare = session('adhoc', (_command, args) =>
      args[0] === '-d' && args[args.length - 1] === python(APP)
        ? ok(plist(TEMPLATE.slice(0, 2)))
        : undefined,
    )
    expect(verify({ mode: 'adhoc', path: APP }, bare.io)).toBe(EXIT.failed)
    expect(bare.said).toContain(
      `  FAILED: its entitlements do not set ${LIBRARY_VALIDATION} true; they name: ${TEMPLATE.slice(0, 2).join(', ')}`,
    )
    expect(bare.said[bare.said.length - 1]).toBe(`verify: 1 check failed for ${APP}`)

    const absent = session('adhoc', () => ({
      status: null,
      stdout: '',
      stderr: '',
      error: 'spawnSync codesign ENOENT',
      timedOut: false,
    }))
    expect(verify({ mode: 'adhoc', path: APP }, absent.io)).toBe(EXIT.failed)
    expect(absent.said.filter((line) => line.includes('FAILED: it could not run'))).toHaveLength(5)
  })
})

describe('developer-id', () => {
  it('before notarising, runs the signature checks and never asks Gatekeeper or the stapler', async () => {
    const { verify, EXIT } = await load()
    const s = session('developer-id')
    expect(verify({ mode: 'developer-id', path: APP, team: TEAM }, s.io)).toBe(EXIT.passed)
    expect(s.lines()).toEqual(signatureLines(APP))
  })

  it('with --notarized, goes on to the notarized requirement, spctl and syspolicy_check, and no stapler', async () => {
    const { verify, EXIT } = await load()
    const s = session('developer-id')
    expect(verify({ mode: 'developer-id', path: APP, team: TEAM, notarized: true }, s.io)).toBe(
      EXIT.passed,
    )
    expect(s.lines()).toEqual([...signatureLines(APP), 'spctl --status', ...notarizedLines(APP)])
    // Only the disk image is stapled: an app copied out of it has no ticket
    // of its own to validate.
    expect(s.lines().filter((line) => line.includes('stapler'))).toEqual([])
  })

  it('fails an ad-hoc build on every count', async () => {
    const { verify, EXIT } = await load()
    const s = session('adhoc')
    expect(verify({ mode: 'developer-id', path: APP, team: TEAM, notarized: true }, s.io)).toBe(
      EXIT.failed,
    )
    expect(s.said).toContain('  FAILED: it is signed ad hoc, not with a Developer ID')
    // The app's display and the bundled Python's, the notarized requirement
    // and Gatekeeper; the stand-in's syspolicy_check always passes.
    expect(s.said[s.said.length - 1]).toBe(`verify: 4 checks failed for ${APP}`)
  })

  it('fails when Gatekeeper is turned off, overridden, or names another team', async () => {
    const { verify, EXIT } = await load()
    const off = session('developer-id', (command, args) =>
      command === 'spctl' && args[0] === '--status' ? ok('assessments disabled\n') : undefined,
    )
    expect(verify({ mode: 'developer-id', path: APP, team: TEAM, notarized: true }, off.io)).toBe(
      EXIT.failed,
    )
    expect(off.said).toContain(
      '  FAILED: spctl --status does not say "assessments enabled", so spctl\'s verdicts here prove nothing',
    )

    const overridden = session('developer-id', (command, args) =>
      command === 'spctl' && args[0] === '-a'
        ? ok('', `${accepted(APP)}override=security disabled\n`)
        : undefined,
    )
    expect(
      verify({ mode: 'developer-id', path: APP, team: TEAM, notarized: true }, overridden.io),
    ).toBe(EXIT.failed)
    expect(overridden.said.join('\n')).toContain('the verdict is overridden on this machine')

    const policy = session('developer-id', (command) =>
      command === 'syspolicy_check'
        ? ok('App has failed one or more pre-distribution checks.\n')
        : undefined,
    )
    expect(
      verify({ mode: 'developer-id', path: APP, team: TEAM, notarized: true }, policy.io),
    ).toBe(EXIT.failed)
    expect(policy.said).toContain(
      '  FAILED: syspolicy_check does not say the app passed all pre-distribution checks',
    )
  })

  it('refuses the placeholder team, and anything that is not a team, before anything runs', async () => {
    const { verify, EXIT } = await load()
    for (const mode of ['developer-id', 'dmg']) {
      for (const team of ['TEAMID_TBD', '-', null]) {
        const s = session('developer-id')
        expect(verify({ mode, path: mode === 'dmg' ? DMG : APP, team }, s.io)).toBe(EXIT.usage)
        expect(s.calls).toEqual([])
        expect(s.said).toHaveLength(1)
      }
    }
    const s = session('developer-id')
    verify({ mode: 'developer-id', path: APP, team: 'TEAMID_TBD' }, s.io)
    expect(s.said[0]).toContain('the Team ID is still the placeholder TEAMID_TBD')
  })
})

describe('dmg', () => {
  const inside = `${MOUNT}/Legible Cities.app`

  it('checks the image, mounts it read-only, checks the app inside, and detaches', async () => {
    const { verify, EXIT } = await load()
    const s = session('developer-id')
    expect(verify({ mode: 'dmg', path: DMG, team: TEAM }, s.io)).toBe(EXIT.passed)
    expect(s.lines()).toEqual([
      'spctl --status',
      `codesign --verify --strict --verbose=2 ${DMG}`,
      `codesign -dvv ${DMG}`,
      `xcrun stapler validate ${DMG}`,
      `spctl -a -t open --context context:primary-signature -vv ${DMG}`,
      `hdiutil attach -readonly -nobrowse -noautoopen -mountpoint ${MOUNT} ${DMG}`,
      ...signatureLines(inside),
      ...notarizedLines(inside),
      `hdiutil detach ${MOUNT}`,
    ])
    // The stapler is asked about the image and never about the app.
    expect(s.lines().filter((line) => line.includes('stapler'))).toEqual([
      `xcrun stapler validate ${DMG}`,
    ])
    expect(s.removed).toEqual([MOUNT])
    expect(s.said[s.said.length - 1]).toBe(
      `verify: ${DMG} passed every check as a notarised disk image of team ${TEAM}`,
    )
  })

  it('fails an image with no staple, no timestamp or no signature of its own', async () => {
    const { verify, EXIT } = await load()
    const unstapled = session('developer-id', (command) =>
      command === 'xcrun' ? exited(65, `${DMG} does not have a ticket stapled to it.`) : undefined,
    )
    expect(verify({ mode: 'dmg', path: DMG, team: TEAM }, unstapled.io)).toBe(EXIT.failed)
    expect(unstapled.said).toContain('  FAILED: it exited 65')
    // The rest still ran, and the image was detached.
    expect(unstapled.lines()).toContain(`spctl -a -t exec -vv ${inside}`)
    expect(unstapled.lines()[unstapled.calls.length - 1]).toBe(`hdiutil detach ${MOUNT}`)

    const untimed = session('developer-id', (_command, args) =>
      args[0] === '-dvv' && args[1] === DMG
        ? ok('', IMAGE.replace('Timestamp=', 'Signed Time='))
        : undefined,
    )
    expect(verify({ mode: 'dmg', path: DMG, team: TEAM }, untimed.io)).toBe(EXIT.failed)
    expect(untimed.said).toContain(
      '  FAILED: it has no secure timestamp (no Timestamp line), which the notary requires',
    )

    const unsigned = session('developer-id', (command, args) =>
      command === 'codesign' && args[args.length - 1] === DMG
        ? exited(1, `${DMG}: code object is not signed at all`)
        : undefined,
    )
    expect(verify({ mode: 'dmg', path: DMG, team: TEAM }, unsigned.io)).toBe(EXIT.failed)
    expect(unsigned.said[unsigned.said.length - 1]).toBe(`verify: 2 checks failed for ${DMG}`)
  })

  it('fails when the image will not mount, and checks nothing inside', async () => {
    const { verify, EXIT } = await load()
    const s = session('developer-id', (command, args) =>
      command === 'hdiutil' && args[0] === 'attach'
        ? exited(1, 'hdiutil: attach failed - image not recognized')
        : undefined,
    )
    expect(verify({ mode: 'dmg', path: DMG, team: TEAM }, s.io)).toBe(EXIT.failed)
    expect(s.lines().filter((line) => line.includes(MOUNT))).toEqual([
      `hdiutil attach -readonly -nobrowse -noautoopen -mountpoint ${MOUNT} ${DMG}`,
    ])
    expect(s.said).toContain('  FAILED: it exited 1; the app inside was not checked')
    expect(s.removed).toEqual([MOUNT])
  })

  it('fails an image that holds no app, or two, and still detaches', async () => {
    const { verify, EXIT } = await load()
    for (const apps of [[], ['A.app', 'B.app']]) {
      const s = session('developer-id', undefined, apps)
      expect(verify({ mode: 'dmg', path: DMG, team: TEAM }, s.io)).toBe(EXIT.failed)
      expect(s.said.join('\n')).toContain('not one; nothing inside was checked')
      expect(s.lines()[s.calls.length - 1]).toBe(`hdiutil detach ${MOUNT}`)
      expect(s.removed).toEqual([MOUNT])
    }
  })

  it('detaches when a check inside throws, and forces a detach that is refused', async () => {
    const { verify, EXIT } = await load()
    const thrown = session('developer-id')
    thrown.io.list = () => {
      throw new Error('the folder cannot be listed')
    }
    expect(() => verify({ mode: 'dmg', path: DMG, team: TEAM }, thrown.io)).toThrow(
      'the folder cannot be listed',
    )
    expect(thrown.lines()[thrown.calls.length - 1]).toBe(`hdiutil detach ${MOUNT}`)

    const busy = session('developer-id', (command, args) =>
      command === 'hdiutil' && args[0] === 'detach' && args[1] !== '-force'
        ? exited(16, 'hdiutil: couldn\'t unmount "disk4" - Resource busy')
        : undefined,
    )
    expect(verify({ mode: 'dmg', path: DMG, team: TEAM }, busy.io)).toBe(EXIT.passed)
    expect(busy.lines().slice(-2)).toEqual([
      `hdiutil detach ${MOUNT}`,
      `hdiutil detach -force ${MOUNT}`,
    ])
    expect(busy.removed).toEqual([MOUNT])

    // Still mounted after both: the folder is left alone, and it is said.
    const stuck = session('developer-id', (command, args) =>
      command === 'hdiutil' && args[0] === 'detach' ? exited(16, 'Resource busy') : undefined,
    )
    verify({ mode: 'dmg', path: DMG, team: TEAM }, stuck.io)
    expect(stuck.removed).toEqual([])
    expect(stuck.said.join('\n')).toContain(`the disk image is still mounted on ${MOUNT}`)
  })
})

describe('the command line', () => {
  it('takes a mode, one path, and a team where the mode has one', async () => {
    const { parseArgs } = await load()
    expect(parseArgs(['adhoc', 'a.app'])).toEqual({
      mode: 'adhoc',
      path: 'a.app',
      team: null,
      teamFrom: null,
      notarized: false,
    })
    expect(parseArgs(['developer-id', 'a.app', '--team', TEAM, '--notarized'])).toMatchObject({
      team: TEAM,
      notarized: true,
    })
    expect(parseArgs(['dmg', '--team-from', 'c.yml', 'a.dmg'])).toMatchObject({
      path: 'a.dmg',
      teamFrom: 'c.yml',
    })
    for (const bad of [
      [],
      ['sign', 'a.app'],
      ['adhoc'],
      ['adhoc', 'a.app', 'b.app'],
      ['adhoc', 'a.app', '--team', TEAM],
      ['adhoc', 'a.app', '--notarized'],
      ['developer-id', 'a.app'],
      ['developer-id', 'a.app', '--team'],
      ['developer-id', 'a.app', '--team', TEAM, '--team-from', 'c.yml'],
      ['developer-id', 'a.app', '--team', TEAM, '--deep'],
      ['dmg', 'a.dmg'],
      ['dmg', 'a.dmg', '--team', TEAM, '--notarized'],
    ]) {
      expect(parseArgs(bad), bad.join(' ')).toBeNull()
    }
  })

  it('reads the team from a config, and refuses one that still holds the placeholder', async () => {
    const { main, EXIT } = await load()
    const dir = scratch()
    const config = (identity: string): string => {
      const file = join(dir, `${identity}.yml`)
      writeFileSync(
        file,
        `extends: ./electron-builder.yml\nmac:\n  identity: '${identity}'\n  notarize: false\n`,
      )
      return file
    }
    const run = (argv: string[]): { code: number; out: string; s: Session } => {
      const s = session('developer-id')
      const out: string[] = []
      const code = main(argv, {
        ...s.io,
        out: { write: (text) => void out.push(text) },
        platform: 'darwin',
      })
      return { code, out: out.join(''), s }
    }
    const good = run(['developer-id', APP, '--team-from', config(TEAM)])
    expect(good.code).toBe(EXIT.passed)
    // The path is made absolute for this machine before anything is run.
    expect(good.s.lines()).toEqual(signatureLines(resolve(APP)))

    const placeholder = run(['dmg', DMG, '--team-from', config('TEAMID_TBD')])
    expect(placeholder.code).toBe(EXIT.usage)
    expect(placeholder.s.calls).toEqual([])
    expect(placeholder.out).toContain('the Team ID is still the placeholder TEAMID_TBD')

    const none = join(dir, 'none.yml')
    writeFileSync(none, 'mac:\n  notarize: false\n')
    const missing = run(['dmg', DMG, '--team-from', none])
    expect(missing.code).toBe(EXIT.usage)
    expect(missing.out).toContain('names no identity under mac:')
    expect(run(['dmg', DMG, '--team-from', join(dir, 'absent.yml')]).out).toContain(
      'could not be read: ENOENT',
    )
    expect(run(['verify', APP]).out).toContain('usage: verify-mac-signing.mjs adhoc <app>')
  })

  it('says it needs a Mac anywhere else, and runs nothing', async () => {
    const { main, EXIT } = await load()
    const s = session('adhoc')
    const out: string[] = []
    const code = main(['adhoc', APP], {
      ...s.io,
      out: { write: (text) => void out.push(text) },
      platform: 'win32',
    })
    expect(code).toBe(EXIT.usage)
    expect(s.calls).toEqual([])
    expect(out.join('')).toBe('verify: a Mac signature can only be checked on a Mac\n')
  })
})

describe('the log', () => {
  it('shows a passing check whole when short and by its end when long, and a failing one whole', async () => {
    const { verify } = await load()
    const many = Array.from(
      { length: 120 },
      (_, i) => `--validated:${APP}/Contents/Frameworks/${i}`,
    )
    const long = (status: number) => (command: string, args: string[]) =>
      command === 'codesign' && args[0] === '--verify'
        ? { ...exited(status, `${many.join('\n')}\n${APP}: the last line\n`) }
        : undefined
    const passing = session('adhoc', long(0))
    verify({ mode: 'adhoc', path: APP }, passing.io)
    expect(passing.said).toContain('    (121 lines; the last 5 are shown)')
    expect(passing.said.filter((line) => line.includes('--validated:'))).toHaveLength(4)
    expect(passing.said).toContain(`    ${APP}: the last line`)
    // The display, seventeen lines or so, is the record and is shown whole.
    expect(passing.said).toContain('    Signature=adhoc')
    expect(passing.said).toContain('    TeamIdentifier=not set')

    const failing = session('adhoc', long(1))
    verify({ mode: 'adhoc', path: APP }, failing.io)
    expect(failing.said.filter((line) => line.includes('--validated:'))).toHaveLength(120)
  })
})

describe('the child processes', () => {
  it('are given a limit that stops them, no standard input, and have both outputs kept', async () => {
    const { runChild } = await load()
    const slow = runChild(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], 300)
    expect(slow.timedOut).toBe(true)
    const loud = runChild(
      process.execPath,
      ['-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)'],
      30_000,
    )
    expect([loud.status, loud.stdout, loud.stderr, loud.timedOut]).toEqual([3, 'out', 'err', false])
    // A child that reads its input sees the end at once: nothing can prompt.
    // Held where the script runs; a Windows child's view of an ignored
    // input is not what is being tested.
    if (process.platform !== 'win32') {
      const asks = runChild(
        process.execPath,
        [
          '-e',
          'process.stdin.resume(); process.stdin.on("end", () => process.stdout.write("eof"))',
        ],
        30_000,
      )
      expect([asks.status, asks.stdout]).toEqual([0, 'eof'])
    }
  })

  it('all start through the one function that sets a limit, each check with its own', async () => {
    const source = readFileSync(SCRIPT, 'utf8')
    expect(source.match(/\bspawnSync\(/g)).toHaveLength(1)
    expect(source).not.toMatch(/\b(execSync|execFile|execFileSync|spawn)\(/)
    expect(source).not.toContain('shell: true')
    const { statusCheck, signatureChecks, notarizedChecks, imageChecks } = await load()
    const every = [
      statusCheck(),
      ...signatureChecks(APP, { mode: 'adhoc' }),
      ...signatureChecks(APP, { mode: 'developer-id', team: TEAM }),
      ...notarizedChecks(APP, TEAM),
      ...imageChecks(DMG, TEAM),
    ]
    expect(every).toHaveLength(18)
    for (const check of every) {
      expect(check.timeoutMs, check.what).toBeGreaterThanOrEqual(30_000)
      expect(Array.isArray(check.args), check.what).toBe(true)
      // A timed-out check is a failure, by whatever judgement it carries.
      expect(
        check.judge(
          { status: null, stdout: '', stderr: '', error: 'ETIMEDOUT', timedOut: true },
          check.timeoutMs,
        ),
        check.what,
      ).toEqual([expect.stringContaining('did not finish within')])
    }
  })

  it('adds up to a worst case that is the sum of what each mode runs', async () => {
    // Mutation: a check left out of the sum, so a step given "longer than
    // the script's worst case" is stopped by the runner before the script
    // can say which check hung.
    const { verify, worstCaseMs } = await load()
    const spent = (s: Session): number => s.calls.reduce((total, call) => total + call.timeoutMs, 0)
    const adhoc = session('adhoc')
    verify({ mode: 'adhoc', path: APP }, adhoc.io)
    expect(worstCaseMs('adhoc')).toBe(spent(adhoc))
    const signed = session('developer-id')
    verify({ mode: 'developer-id', path: APP, team: TEAM }, signed.io)
    expect(worstCaseMs('developer-id')).toBe(spent(signed))
    const lookedUp = session('developer-id')
    verify({ mode: 'developer-id', path: APP, team: TEAM, notarized: true }, lookedUp.io)
    expect(worstCaseMs('developer-id', { notarized: true })).toBe(spent(lookedUp))
    // An image at its worst is detached twice: once refused, once by force.
    const image = session('developer-id', (command, args) =>
      command === 'hdiutil' && args[0] === 'detach' && args[1] !== '-force'
        ? exited(16, 'Resource busy')
        : undefined,
    )
    verify({ mode: 'dmg', path: DMG, team: TEAM }, image.io)
    expect(worstCaseMs('dmg')).toBe(spent(image))
    // The figure build.yml's comment gives for the step that runs it.
    expect(worstCaseMs('dmg') / 60_000).toBe(76.5)
  })

  it("imports nothing but Node's own modules: it runs on the runner that holds the notary's key", () => {
    const source = readFileSync(SCRIPT, 'utf8')
    const specifiers = [...source.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
    expect(specifiers.length).toBeGreaterThan(3)
    for (const specifier of specifiers) expect(specifier).toMatch(/^node:/)
    expect(source).not.toMatch(/\brequire\s*\(/)
    expect(source).not.toMatch(/\bimport\s*\(/)
  })
})
