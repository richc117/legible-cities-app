// What a Mac build is signed with, checked the way macOS will check it
// (issue 686, ADR-062). Three modes:
//
//   node scripts/verify-mac-signing.mjs adhoc <app>
//   node scripts/verify-mac-signing.mjs developer-id <app> (--team <id> | --team-from <config>) [--notarized]
//   node scripts/verify-mac-signing.mjs dmg <dmg> (--team <id> | --team-from <config>)
//
// `adhoc` is every branch and pull-request build (electron-builder.yml):
// the seal is whole; the app and the bundled Python, the one executable the
// app starts as a process of its own, are each signed ad hoc with no team
// and no authority and with the hardened runtime on; and both keep
// `com.apple.security.cs.disable-library-validation`, the entitlement
// ADR-043 needs kept.
//
// `developer-id` is the signed app before it is notarised
// (electron-builder.release.yml): the seal is whole; for the app and the
// bundled Python alike the first authority is a "Developer ID Application"
// certificate of the team, TeamIdentifier is the team, there is a secure
// timestamp and the hardened runtime is on; and the same entitlement is
// kept. With `--notarized`, for an app copied out
// of a notarised disk image, it goes on to: Gatekeeper's assessments are
// enabled, the app meets the `notarized` requirement, `spctl` accepts it as
// "Notarized Developer ID" from the team with no override, and
// `syspolicy_check distribution` passes. It never asks the stapler about an
// app: only the disk image is stapled, and the app's ticket is looked up.
//
// `dmg` is the notarised disk image, the file a person downloads:
// assessments are enabled, the image's own signature is whole, by the
// team's Developer ID and timestamped, the ticket stapled to it validates,
// and `spctl` accepts the image as "Notarized Developer ID". Then the image
// is mounted read-only and the one app inside is put through every
// `developer-id --notarized` check where it sits.
//
// The team is the Developer ID Team ID: given, or read from the `identity`
// under `mac:` in the release config (`--team-from`), so the workflows name
// it in one place. The placeholder TEAMID_TBD is refused, and so is
// anything that is not ten capital letters and digits.
//
// Every check runs, each printed with its command and what the command
// said, and the exit status is 0 only where every one passed; 1 where any
// failed; 2 for a call that could not start. A check that could not run is
// a failure, never a pass. Every child process is given an argument array
// and a time limit, and both its outputs are kept and printed. The
// judgements are functions the unit test calls, with codesign, spctl and
// the rest played by a stand-in (tests/unit/verify-mac-signing.test.ts);
// `main` runs only when this is the entry point.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const EXIT = { passed: 0, failed: 1, usage: 2 }

/** What electron-builder.release.yml names until the Team ID is known. */
export const PLACEHOLDER = 'TEAMID_TBD'
const TEAM_ID = /^[A-Z0-9]{10}$/

/** The bundled interpreter, inside the app: the executable the app itself starts. */
export const PYTHON = ['Contents', 'Resources', 'python', 'bin', 'python3']
/** The entitlement ADR-043 needs kept, so Electron's FFmpeg library stays replaceable. */
export const LIBRARY_VALIDATION = 'com.apple.security.cs.disable-library-validation'

const VERIFY_TIMEOUT_MS = 10 * 60_000
const DISPLAY_TIMEOUT_MS = 60_000
const ASSESS_TIMEOUT_MS = 10 * 60_000
const STAPLER_TIMEOUT_MS = 2 * 60_000
const STATUS_TIMEOUT_MS = 30_000
const ATTACH_TIMEOUT_MS = 5 * 60_000
const DETACH_TIMEOUT_MS = 2 * 60_000
/** A passing check's output is shown whole up to this many lines, then by its end. */
const SHOWN_LINES = 40
const SHOWN_TAIL = 5

// ---- pure judgements -----------------------------------------------------

/** Null for a Team ID, else why it is not one. The placeholder has its own sentence. */
export function teamProblem(team) {
  if (team === PLACEHOLDER) {
    return `the Team ID is still the placeholder ${PLACEHOLDER}: write the Developer ID Team ID into electron-builder.release.yml's mac.identity before signing a build or checking a signed one`
  }
  if (typeof team !== 'string' || !TEAM_ID.test(team)) {
    return `${JSON.stringify(team ?? null)} is not a Team ID, which is ten capital letters and digits`
  }
  return null
}

/**
 * The `identity` under `mac:` in a packaging config's text, unquoted, or
 * null where there is none. Read by line, as the config is written: a
 * top-level `mac:` and a key indented under it.
 */
export function teamFromConfig(text) {
  let inMac = false
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (/^\s*(#.*)?$/.test(line)) continue
    if (!/^\s/.test(line)) {
      inMac = /^mac:\s*(#.*)?$/.test(line)
      continue
    }
    if (!inMac) continue
    const found = /^\s+identity:\s*(?:'([^']*)'|"([^"]*)"|([^\s#'"]+))\s*(#.*)?$/.exec(line)
    if (found) return found[1] ?? found[2] ?? found[3]
  }
  return null
}

/**
 * What `codesign -dvv` printed, as the fields the judgements read. The
 * flags are the names in the code directory's parentheses: `runtime`,
 * `adhoc`, `none`. `Signature=adhoc` is the ad-hoc mark; a signature made
 * with a certificate prints `Signature size=...` instead, which is not it.
 */
export function parseDisplay(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const value = (key) => {
    const line = lines.find((candidate) => candidate.startsWith(`${key}=`))
    return line === undefined ? null : line.slice(key.length + 1).trim()
  }
  const directory = /^CodeDirectory .*\bflags=0x[0-9a-fA-F]+\(([^)]*)\)/m.exec(String(text ?? ''))
  return {
    authorities: lines
      .filter((line) => line.startsWith('Authority='))
      .map((line) => line.slice('Authority='.length).trim()),
    team: value('TeamIdentifier'),
    signature: value('Signature'),
    timestamp: value('Timestamp'),
    flags:
      directory === null
        ? null
        : directory[1]
            .split(',')
            .map((flag) => flag.trim())
            .filter(Boolean),
  }
}

const RUNTIME_OFF =
  'the hardened runtime is not on: "runtime" is not among the code directory\'s flags'

/** What is wrong with an ad-hoc signature's display; empty where nothing is. */
export function judgeAdhoc(display) {
  const problems = []
  if (display.signature !== 'adhoc') {
    problems.push(
      `it is not signed ad hoc: Signature is ${display.signature === null ? 'not given' : JSON.stringify(display.signature)}, not "adhoc"`,
    )
  }
  if (display.authorities.length > 0) {
    problems.push(
      `an ad-hoc signature names no authority, and this names ${display.authorities[0]}`,
    )
  }
  if (display.team !== 'not set') {
    problems.push(`TeamIdentifier is ${JSON.stringify(display.team)}, not "not set"`)
  }
  if (!display.flags?.includes('runtime')) problems.push(RUNTIME_OFF)
  return problems
}

/**
 * What is wrong with a Developer ID signature's display, for the team. A
 * disk image has no runtime to harden, so `runtime: false` leaves that out.
 */
export function judgeDeveloperId(display, team, { runtime = true } = {}) {
  const problems = []
  if (display.signature === 'adhoc') problems.push('it is signed ad hoc, not with a Developer ID')
  const leaf = display.authorities[0] ?? null
  const named = /^Developer ID Application: .+ \(([A-Z0-9]{10})\)$/.exec(leaf ?? '')
  if (named === null) {
    problems.push(
      `its first authority is ${leaf === null ? 'missing' : JSON.stringify(leaf)}, not a "Developer ID Application" certificate`,
    )
  } else if (named[1] !== team) {
    problems.push(`its certificate is team ${named[1]}'s, not ${team}'s`)
  }
  if (display.team !== team) {
    problems.push(`TeamIdentifier is ${JSON.stringify(display.team)}, not ${team}`)
  }
  if (display.timestamp === null || display.timestamp === '' || display.timestamp === 'none') {
    problems.push('it has no secure timestamp (no Timestamp line), which the notary requires')
  }
  if (runtime && !display.flags?.includes('runtime')) problems.push(RUNTIME_OFF)
  return problems
}

/** Whether an entitlements plist, as `codesign --xml` prints it, sets the key true. */
export function entitled(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`<key>${escaped}</key>\\s*<true\\s*/>`).test(String(text ?? ''))
}

/** Every key an entitlements plist names, for the log. */
export function entitlementKeys(text) {
  return [...String(text ?? '').matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1])
}

/**
 * What is wrong with `spctl -a -vv`'s verdict: it must say accepted, give
 * the source "Notarized Developer ID" and an origin of the team, and carry
 * no `override=` line. An override means the verdict is a setting of the
 * machine's (assessments turned off, a rule added by hand) and says nothing
 * about the signature.
 */
export function judgeAssessment(output, team) {
  const lines = String(output ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
  const value = (key) => {
    const line = lines.find((candidate) => candidate.startsWith(`${key}=`))
    return line === undefined ? null : line.slice(key.length + 1)
  }
  const problems = []
  const override = lines.find((line) => line.startsWith('override='))
  if (override !== undefined) {
    problems.push(
      `the verdict is overridden on this machine (${override}), so it says nothing about the signature`,
    )
  }
  if (!lines.some((line) => /: accepted$/.test(line))) problems.push('Gatekeeper did not accept it')
  const source = value('source')
  if (source !== 'Notarized Developer ID') {
    problems.push(`its source is ${JSON.stringify(source)}, not "Notarized Developer ID"`)
  }
  const origin = value('origin')
  if (origin === null || !origin.endsWith(`(${team})`)) {
    problems.push(`its origin is ${JSON.stringify(origin)}, not a certificate of team ${team}`)
  }
  return problems
}

/** Why a child process did not succeed, or null where it exited 0. */
export function childProblem(result, timeoutMs) {
  if (result.timedOut) {
    return `it did not finish within ${Math.round(timeoutMs / 1000)} seconds and was stopped`
  }
  if (result.error) return `it could not run: ${result.error}`
  if (result.status !== 0)
    return `it exited ${result.status ?? `on ${result.signal ?? 'no status'}`}`
  return null
}

// ---- the checks, as data ---------------------------------------------------

const output = (result) => `${result.stdout}\n${result.stderr}`
/** A judgement that needs the command to have exited 0 before its output is read. */
const afterExit = (judge) => (result, timeoutMs) => {
  const problem = childProblem(result, timeoutMs)
  return problem === null ? judge(output(result)) : [problem]
}
const exitOnly = afterExit(() => [])
const saying = (phrase, otherwise) =>
  afterExit((text) => (text.includes(phrase) ? [] : [otherwise]))

/** Gatekeeper's assessments must be on for `spctl`'s verdicts to mean anything. */
export function statusCheck() {
  return {
    what: "Gatekeeper's assessments are enabled on this machine",
    command: 'spctl',
    args: ['--status'],
    timeoutMs: STATUS_TIMEOUT_MS,
    judge: saying(
      'assessments enabled',
      'spctl --status does not say "assessments enabled", so spctl\'s verdicts here prove nothing',
    ),
  }
}

/** The signature of an app: `mode` is `adhoc` or `developer-id`. */
export function signatureChecks(app, { mode, team = null }) {
  const keeps = (what, code) => ({
    what: `${what} keeps ${LIBRARY_VALIDATION} (ADR-043)`,
    command: 'codesign',
    args: ['-d', '--entitlements', '-', '--xml', code],
    timeoutMs: DISPLAY_TIMEOUT_MS,
    judge: afterExit((text) =>
      entitled(text, LIBRARY_VALIDATION)
        ? []
        : [
            `its entitlements do not set ${LIBRARY_VALIDATION} true; they name: ${entitlementKeys(text).join(', ') || 'none'}`,
          ],
    ),
  })
  // A path inside a Mac bundle, whatever machine this is read on.
  const python = posix.join(app, ...PYTHON)
  const signed = (what, code) => ({
    what:
      mode === 'adhoc'
        ? `${what} is signed ad hoc, with the hardened runtime`
        : `${what} is signed with team ${team}'s Developer ID, timestamped, with the hardened runtime`,
    command: 'codesign',
    args: ['-dvv', code],
    timeoutMs: DISPLAY_TIMEOUT_MS,
    judge: afterExit((text) =>
      mode === 'adhoc'
        ? judgeAdhoc(parseDisplay(text))
        : judgeDeveloperId(parseDisplay(text), team),
    ),
  })
  return [
    {
      what: 'every nested code is sealed, and nothing has changed since',
      command: 'codesign',
      args: ['--verify', '--deep', '--strict', '--verbose=2', app],
      timeoutMs: VERIFY_TIMEOUT_MS,
      judge: exitOnly,
    },
    signed('the app', app),
    // The one executable the app starts as a process of its own, standing
    // for the nested ones: the notary reads every one of them, this run
    // reads one, and does so in the ad-hoc build too.
    signed('the bundled Python', python),
    keeps('the app', app),
    keeps('the bundled Python', python),
  ]
}

/** What only a notarised app passes. Never the stapler: an app is not stapled. */
export function notarizedChecks(app, team) {
  return [
    {
      what: 'the app meets the notarized requirement',
      command: 'codesign',
      args: ['--verify', '--deep', '--strict', '-R=notarized', '--check-notarization', '-vv', app],
      timeoutMs: VERIFY_TIMEOUT_MS,
      judge: exitOnly,
    },
    {
      what: `Gatekeeper accepts the app as Notarized Developer ID, from team ${team}`,
      command: 'spctl',
      args: ['-a', '-t', 'exec', '-vv', app],
      timeoutMs: ASSESS_TIMEOUT_MS,
      judge: afterExit((text) => judgeAssessment(text, team)),
    },
    {
      what: 'the app passes the pre-distribution checks',
      command: 'syspolicy_check',
      args: ['distribution', app],
      timeoutMs: ASSESS_TIMEOUT_MS,
      judge: saying(
        'passed all pre-distribution checks',
        'syspolicy_check does not say the app passed all pre-distribution checks',
      ),
    },
  ]
}

/** The disk image itself: its signature, its staple, Gatekeeper's verdict on it. */
export function imageChecks(dmg, team) {
  return [
    {
      what: "the disk image's own signature is whole",
      command: 'codesign',
      args: ['--verify', '--strict', '--verbose=2', dmg],
      timeoutMs: VERIFY_TIMEOUT_MS,
      judge: exitOnly,
    },
    {
      what: `the disk image is signed with team ${team}'s Developer ID, timestamped`,
      command: 'codesign',
      args: ['-dvv', dmg],
      timeoutMs: DISPLAY_TIMEOUT_MS,
      judge: afterExit((text) => judgeDeveloperId(parseDisplay(text), team, { runtime: false })),
    },
    {
      what: 'the ticket stapled to the disk image validates',
      command: 'xcrun',
      args: ['stapler', 'validate', dmg],
      timeoutMs: STAPLER_TIMEOUT_MS,
      judge: saying(
        'The validate action worked',
        'the stapler does not say the validate action worked',
      ),
    },
    {
      what: `Gatekeeper accepts the disk image as Notarized Developer ID, from team ${team}`,
      command: 'spctl',
      args: ['-a', '-t', 'open', '--context', 'context:primary-signature', '-vv', dmg],
      timeoutMs: ASSESS_TIMEOUT_MS,
      judge: afterExit((text) => judgeAssessment(text, team)),
    },
  ]
}

// ---- the run -------------------------------------------------------------

/** One child process: an argument array, a time limit, no standard input, both outputs kept. */
export function runChild(command, args, timeoutMs) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ? result.error.message : null,
    timedOut: result.error?.code === 'ETIMEDOUT',
  }
}

/** Run each check, say what it found, and count the ones that failed. */
function runChecks(checks, { run, say }) {
  let failed = 0
  for (const check of checks) {
    say(`verify: ${check.what}`)
    say(`  $ ${check.command} ${check.args.join(' ')}`)
    const result = run(check.command, check.args, check.timeoutMs)
    const problems = check.judge(result, check.timeoutMs)
    const lines = output(result)
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
    const whole = problems.length > 0 || lines.length <= SHOWN_LINES
    if (!whole) say(`    (${lines.length} lines; the last ${SHOWN_TAIL} are shown)`)
    for (const line of whole ? lines : lines.slice(-SHOWN_TAIL)) say(`    ${line}`)
    if (problems.length === 0) say('  ok')
    else {
      failed += 1
      for (const problem of problems) say(`  FAILED: ${problem}`)
    }
  }
  return failed
}

/**
 * A whole mode, with the child processes and the folders handed in so a
 * test can run it without codesign. Returns the exit status.
 *
 *   io.run          (command, args, timeoutMs) => { status, stdout, stderr, error, timedOut }
 *   io.say          (line) => void
 *   io.makeMount    () => an empty folder to mount the disk image on
 *   io.removeMount  (folder) => void, once it is detached
 *   io.list         (folder) => the names in it
 */
export function verify({ mode, path, team = null, notarized = false }, io) {
  const { run, say } = io
  if (mode !== 'adhoc') {
    const problem = teamProblem(team)
    if (problem !== null) {
      say(`verify: ${problem}`)
      return EXIT.usage
    }
  }
  let failed = 0
  if (mode === 'adhoc') {
    failed += runChecks(signatureChecks(path, { mode }), io)
  } else if (mode === 'developer-id') {
    failed += runChecks(signatureChecks(path, { mode, team }), io)
    if (notarized) failed += runChecks([statusCheck(), ...notarizedChecks(path, team)], io)
  } else {
    failed += runChecks([statusCheck(), ...imageChecks(path, team)], io)
    const mount = io.makeMount()
    const attach = ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, path]
    say('verify: the disk image mounts read-only')
    say(`  $ hdiutil ${attach.join(' ')}`)
    const attached = run('hdiutil', attach, ATTACH_TIMEOUT_MS)
    const attachProblem = childProblem(attached, ATTACH_TIMEOUT_MS)
    if (attachProblem !== null) {
      for (const line of output(attached).split(/\r?\n/)) if (line.trim() !== '') say(`    ${line}`)
      say(`  FAILED: ${attachProblem}; the app inside was not checked`)
      failed += 1
      io.removeMount(mount)
    } else {
      say('  ok')
      try {
        const apps = io.list(mount).filter((name) => name.endsWith('.app'))
        if (apps.length !== 1) {
          say(
            `verify: FAILED: the disk image holds ${apps.length === 0 ? 'no app' : `${apps.length} apps (${apps.join(', ')})`}, not one; nothing inside was checked`,
          )
          failed += 1
        } else {
          const app = posix.join(mount, apps[0])
          failed += runChecks(
            [
              ...signatureChecks(app, { mode: 'developer-id', team }),
              ...notarizedChecks(app, team),
            ],
            io,
          )
        }
      } finally {
        let detached = run('hdiutil', ['detach', mount], DETACH_TIMEOUT_MS)
        if (childProblem(detached, DETACH_TIMEOUT_MS) !== null) {
          detached = run('hdiutil', ['detach', '-force', mount], DETACH_TIMEOUT_MS)
        }
        const detachProblem = childProblem(detached, DETACH_TIMEOUT_MS)
        if (detachProblem === null) io.removeMount(mount)
        else
          say(
            `verify: the disk image is still mounted on ${mount}: hdiutil detach, ${detachProblem}`,
          )
      }
    }
  }
  if (failed > 0) {
    say(`verify: ${failed} check${failed === 1 ? '' : 's'} failed for ${path}`)
    return EXIT.failed
  }
  say(
    `verify: ${path} passed every check as ${mode === 'adhoc' ? 'an ad-hoc build' : mode === 'dmg' ? `a notarised disk image of team ${team}` : `team ${team}'s Developer ID build${notarized ? ', notarised' : ''}`}`,
  )
  return EXIT.passed
}

const USAGE = [
  'usage: verify-mac-signing.mjs adhoc <app>',
  '       verify-mac-signing.mjs developer-id <app> (--team <id> | --team-from <config>) [--notarized]',
  '       verify-mac-signing.mjs dmg <dmg> (--team <id> | --team-from <config>)',
  '',
].join('\n')

/** `{ mode, path, team, teamFrom, notarized }`, or null where the arguments are not a call. */
export function parseArgs(argv) {
  const [mode, ...rest] = argv
  if (!['adhoc', 'developer-id', 'dmg'].includes(mode)) return null
  const parsed = { mode, path: null, team: null, teamFrom: null, notarized: false }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--team' || arg === '--team-from') {
      const value = rest[++i]
      const key = arg === '--team' ? 'team' : 'teamFrom'
      if (value === undefined || value === '' || parsed[key] !== null) return null
      parsed[key] = value
    } else if (arg === '--notarized') {
      if (parsed.notarized) return null
      parsed.notarized = true
    } else if (arg.startsWith('-') || parsed.path !== null) return null
    else parsed.path = arg
  }
  if (parsed.path === null || parsed.path === '') return null
  const teams = (parsed.team !== null ? 1 : 0) + (parsed.teamFrom !== null ? 1 : 0)
  // An ad-hoc build has no team, and only the app mode has a before and after.
  if (mode === 'adhoc' ? teams !== 0 || parsed.notarized : teams !== 1) return null
  if (mode === 'dmg' && parsed.notarized) return null
  return parsed
}

export function main(argv, io = {}) {
  const out = io.out ?? process.stdout
  const say = (line) => out.write(`${line}\n`)
  const options = parseArgs(argv)
  if (options === null) {
    out.write(USAGE)
    return EXIT.usage
  }
  if ((io.platform ?? process.platform) !== 'darwin') {
    say('verify: a Mac signature can only be checked on a Mac')
    return EXIT.usage
  }
  let team = options.team
  if (options.teamFrom !== null) {
    let text
    try {
      text = readFileSync(options.teamFrom, 'utf8')
    } catch (error) {
      say(`verify: ${options.teamFrom} could not be read: ${error.code ?? error.message}`)
      return EXIT.usage
    }
    team = teamFromConfig(text)
    if (team === null) {
      say(
        `verify: ${options.teamFrom} names no identity under mac:, so there is no team to check against`,
      )
      return EXIT.usage
    }
  }
  return verify(
    {
      mode: options.mode,
      // An absolute path, so a name that starts with a dash is never an option.
      path: resolve(options.path),
      team,
      notarized: options.notarized,
    },
    {
      run: io.run ?? runChild,
      say,
      makeMount: io.makeMount ?? (() => mkdtempSync(join(tmpdir(), 'lc-verify-mac-signing-'))),
      removeMount:
        io.removeMount ??
        ((folder) => {
          try {
            // Never recursive: if the image is somehow still mounted, this fails and removes nothing.
            rmdirSync(folder)
          } catch {
            // Left for the system's own cleaning of its temporary folder.
          }
        }),
      list: io.list ?? ((folder) => readdirSync(folder)),
    },
  )
}

// Run as a script, not when a test imports the module.
function invokedDirectly() {
  if (process.argv[1] === undefined) return false
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}
if (invokedDirectly()) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`verify: ${error?.stack ?? error}\n`)
    process.exitCode = EXIT.failed
  }
}
