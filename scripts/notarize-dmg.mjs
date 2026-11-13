// Notarise a signed disk image, staple the ticket to it, and check the
// staple (issue 686, ADR-062). The packaging jobs in
// .github/workflows/build.yml run it in signing mode, after the image is
// built and signed and before it is uploaded, so every later job sees the
// stapled bytes.
//
//   node scripts/notarize-dmg.mjs <dmg> [--log <file>]
//
// What it does, in order:
//
// 1. `xcrun notarytool submit <dmg> <credentials> --wait --timeout 60m
//    --output-format json`. In that format notarytool prints one JSON
//    object when it is done, with the submission's id and status. The id
//    goes to the log and, in a workflow, to the step's summary.
// 2. `xcrun notarytool log <id> <credentials>`, **always**, whatever the
//    status: the log is the only place the notary says what it found, and
//    an accepted submission can still carry issues. With `--log` it is
//    written to that file as it came, for the workflow to upload.
// 3. A verdict. The run goes on only if the status is the word `Accepted`,
//    the log could be read and says `Accepted` too, and the log has no
//    issue of severity `error`. notarytool exits 0 for a submission the
//    notary rejected, so the exit status alone is never the verdict.
//    Warnings are printed and do not fail the run.
// 4. `xcrun stapler staple -v <dmg>`, up to three times: the ticket can
//    take a moment to reach the servers the stapler reads.
// 5. `xcrun stapler validate <dmg>`.
//
// Only the disk image is notarised and stapled. It is the outermost thing a
// person downloads; the notary issues a ticket for the app inside it too,
// which macOS looks up when the app is first opened.
//
// The credentials come from the environment, never from the command line:
//
//   NOTARY_KEY_PATH, NOTARY_KEY_ID, NOTARY_ISSUER_ID
//       an App Store Connect API key (a team key): the path of its .p8
//       file, its key id and its issuer id. All three, or none.
//   NOTARY_KEYCHAIN_PROFILE
//       on a developer machine, the name of a profile saved with
//       `xcrun notarytool store-credentials`. Read only when none of the
//       three above is set.
//
// Nothing here prints a credential: commands are shown without them. The
// exit status is 0 only for an image notarised, stapled and validated; 1
// for anything the notary or the stapler refused or that could not be
// read; 2 for a call that could not start (usage, credentials).
//
// This file imports nothing but Node's own modules, on purpose: the step
// that runs it holds the notary's key, and no package from npm runs there
// (tests/unit/notarize-dmg.test.ts holds it to that). Every child process
// is given an argument array and a time limit, and its standard error is
// kept and printed. The decisions are functions the unit test calls, with
// `xcrun` played by a stand-in; `main` runs only when this is the entry
// point.

import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

export const EXIT = { done: 0, refused: 1, usage: 2 }

/** How long notarytool waits for the notary, as it is told. */
export const WAIT = '60m'
/**
 * The submit call's own limit: notarytool's 60 minutes of waiting and the
 * upload before it. Longer than `WAIT` on purpose, so that notarytool gives
 * up first and still prints the submission's id.
 */
export const SUBMIT_TIMEOUT_MS = 70 * 60_000
export const LOG_TIMEOUT_MS = 2 * 60_000
export const STAPLE_TIMEOUT_MS = 2 * 60_000
export const VALIDATE_TIMEOUT_MS = 60_000
/** Tries of the log and of the staple, each a moment after the last. */
export const TRIES = 3
export const PAUSE_MS = 15_000

export const KEY_VARIABLES = ['NOTARY_KEY_PATH', 'NOTARY_KEY_ID', 'NOTARY_ISSUER_ID']
export const PROFILE_VARIABLE = 'NOTARY_KEYCHAIN_PROFILE'

// The first line of a key in PEM form, put together here so that this file
// never holds the marker whole: bin/preflight refuses one wherever it is.
const KEY_MARKER = `${'-'.repeat(5)}BEGIN PRIVATE KEY${'-'.repeat(5)}`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---- pure decisions ------------------------------------------------------

const given = (env, name) => typeof env[name] === 'string' && env[name].trim() !== ''

/**
 * How to authenticate to the notary: `{ how, args, keyFile }`, or `{ problem }`
 * naming every variable that is empty. A key given in part is refused, never
 * passed over for the profile: two of three set is a mistake, not a choice.
 */
export function notaryAuth(env) {
  const set = KEY_VARIABLES.filter((name) => given(env, name))
  if (set.length === KEY_VARIABLES.length) {
    const [key, id, issuer] = KEY_VARIABLES.map((name) => env[name].trim())
    return {
      how: 'an App Store Connect API key',
      args: ['--key', key, '--key-id', id, '--issuer', issuer],
      keyFile: key,
    }
  }
  if (set.length > 0) {
    const empty = KEY_VARIABLES.filter((name) => !given(env, name))
    return {
      problem: `${empty.join(' and ')} ${empty.length === 1 ? 'is' : 'are'} empty, and ${set.join(' and ')} ${set.length === 1 ? 'is' : 'are'} set: the notary's key needs all three`,
    }
  }
  if (given(env, PROFILE_VARIABLE)) {
    return {
      how: 'a keychain profile',
      args: ['--keychain-profile', env[PROFILE_VARIABLE].trim()],
      keyFile: null,
    }
  }
  return {
    problem: `no credentials for the notary: ${KEY_VARIABLES.join(', ')} are all empty, and so is ${PROFILE_VARIABLE}`,
  }
}

/**
 * Null when the text is a private key in PEM form, else why not. An empty
 * secret written to a file is a file all the same, and notarytool's answer
 * to it is an authentication error that names nothing.
 */
export function keyProblem(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return 'NOTARY_KEY_PATH names an empty file: the secret holding the .p8 key is empty'
  }
  if (!text.includes(KEY_MARKER)) {
    return "NOTARY_KEY_PATH's file has no BEGIN PRIVATE KEY line: it is not the .p8 key as App Store Connect gave it"
  }
  return null
}

/** `xcrun`'s arguments for the submission. */
export function submitArgs(dmg, auth) {
  return [
    'notarytool',
    'submit',
    dmg,
    ...auth,
    '--wait',
    '--timeout',
    WAIT,
    '--output-format',
    'json',
  ]
}

/** `xcrun`'s arguments for a submission's log, which it prints. */
export function logArgs(id, auth) {
  return ['notarytool', 'log', id, ...auth]
}

/**
 * A command as it is shown. The caller builds the arguments again without
 * the credentials, so none can be printed by a slip in what is filtered.
 */
export function shown(args) {
  return `xcrun ${args.join(' ')} (credentials not shown)`
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * What notarytool printed for the submission: `{ id, status, message }`, the
 * id null unless it is a UUID (it becomes an argument of the next call).
 * `{ problem }` where no JSON object was printed. The object is the last
 * line that parses as one, so a line of warning before it changes nothing.
 */
export function parseSubmission(stdout) {
  const lines = String(stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{'))
  let parsed = null
  for (const line of [String(stdout ?? '').trim(), ...lines.reverse()]) {
    try {
      const value = JSON.parse(line)
      if (isObject(value)) {
        parsed = value
        break
      }
    } catch {
      // Not this one.
    }
  }
  if (parsed === null) {
    return {
      problem: 'notarytool printed no JSON object, so the submission has no id and no status',
    }
  }
  return {
    id: typeof parsed.id === 'string' && UUID.test(parsed.id) ? parsed.id : null,
    status: typeof parsed.status === 'string' ? parsed.status : null,
    message: typeof parsed.message === 'string' ? parsed.message : null,
  }
}

/** Only the word `Accepted` is an accepted submission. */
export function accepted(status) {
  return status === 'Accepted'
}

const issueLine = (issue) => {
  const where = typeof issue.path === 'string' && issue.path !== '' ? issue.path : '(no path)'
  const what =
    typeof issue.message === 'string' && issue.message !== '' ? issue.message : '(no message)'
  const arch = typeof issue.architecture === 'string' ? ` [${issue.architecture}]` : ''
  return `${where}${arch}: ${what}`
}

/**
 * The notary's log, judged: `{ problems, warnings, summary }`. A problem is
 * anything that stops the run: a log that is not JSON, one that does not say
 * `Accepted`, issues that cannot be read, an issue of severity `error`, and
 * an issue with no severity, which cannot be called a warning. Every other
 * issue is a warning, shown with its severity.
 */
export function judgeLog(text) {
  let log
  try {
    log = JSON.parse(text)
  } catch {
    return { problems: ["the notary's log is not JSON, so it cannot be read"], warnings: [] }
  }
  if (!isObject(log)) {
    return {
      problems: ["the notary's log is not a JSON object, so it cannot be read"],
      warnings: [],
    }
  }
  const problems = []
  const warnings = []
  if (!accepted(log.status)) {
    problems.push(
      `the notary's log gives the status ${JSON.stringify(log.status ?? null)}, not "Accepted"`,
    )
  }
  const issues = log.issues ?? []
  if (!Array.isArray(issues)) {
    problems.push(
      'the notary\'s log has an "issues" that is not a list, so its issues cannot be read',
    )
  } else {
    for (const issue of issues) {
      if (!isObject(issue) || typeof issue.severity !== 'string' || issue.severity.trim() === '') {
        problems.push(
          `an issue with no severity: ${isObject(issue) ? issueLine(issue) : JSON.stringify(issue)}`,
        )
        continue
      }
      const severity = issue.severity.trim().toLowerCase()
      if (severity === 'error') problems.push(`error: ${issueLine(issue)}`)
      else warnings.push(`${severity}: ${issueLine(issue)}`)
    }
  }
  const tickets = Array.isArray(log.ticketContents) ? log.ticketContents.length : 0
  const summary = `${log.statusSummary ?? 'no summary'}; ${tickets} signed item${tickets === 1 ? '' : 's'} in the ticket; ${Array.isArray(issues) ? issues.length : 'unreadable'} issue${Array.isArray(issues) && issues.length === 1 ? '' : 's'}`
  return { problems, warnings, summary }
}

/** Why a child process did not succeed, or null where it exited 0. */
export function childProblem(what, result, timeoutMs) {
  if (result.timedOut) {
    return `${what} did not finish within ${Math.round(timeoutMs / 60_000)} minutes and was stopped`
  }
  if (result.error) return `${what} could not run: ${result.error}`
  if (result.status !== 0) {
    return `${what} exited ${result.status ?? `on ${result.signal ?? 'no status'}`}`
  }
  return null
}

// ---- the run -------------------------------------------------------------

/**
 * One child process: an argument array, a time limit, no standard input (so
 * notarytool can never stop to ask for a password), both outputs kept.
 */
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

const indented = (text) =>
  String(text ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => `    ${line}`)

/**
 * The whole of it, with the child processes, the files and the pause handed
 * in so a test can run it without `xcrun`. Resolves to the exit status.
 *
 *   io.env          the environment the credentials are read from
 *   io.run          (command, args, timeoutMs) => { status, stdout, stderr, error, timedOut }
 *   io.say          (line) => void, the log
 *   io.pause        (ms) => Promise, between tries
 *   io.readText     (path) => string, for the key file
 *   io.writeText    (path, text) => void, for the notary's log
 *   io.summarise    (text) => void, the step's summary
 */
export async function notarize({ dmg, logFile = null }, io) {
  const { env, run, say, pause, readText, writeText, summarise } = io
  const auth = notaryAuth(env)
  if (auth.problem) {
    say(`notarize: ${auth.problem}`)
    return EXIT.usage
  }
  if (auth.keyFile !== null) {
    let text
    try {
      text = readText(auth.keyFile)
    } catch (error) {
      say(
        `notarize: NOTARY_KEY_PATH names a file that cannot be read: ${error.code ?? 'unreadable'}`,
      )
      return EXIT.usage
    }
    const problem = keyProblem(text)
    if (problem !== null) {
      say(`notarize: ${problem}`)
      return EXIT.usage
    }
  }

  const failures = []
  say(`notarize: ${shown(submitArgs(dmg, []))}`)
  say(`notarize: authenticating with ${auth.how}; waiting up to ${WAIT} for the notary`)
  const submitted = run('xcrun', submitArgs(dmg, auth.args), SUBMIT_TIMEOUT_MS)
  for (const line of indented(submitted.stderr)) say(line)
  const submitProblem = childProblem('notarytool submit', submitted, SUBMIT_TIMEOUT_MS)
  if (submitProblem !== null) failures.push(submitProblem)
  const submission = parseSubmission(submitted.stdout)
  if (submission.problem) {
    failures.push(submission.problem)
    for (const line of indented(submitted.stdout)) say(line)
  } else {
    say(
      `notarize: submission ${submission.id ?? '(no id)'}: ${submission.status ?? '(no status)'}${submission.message ? ` (${submission.message})` : ''}`,
    )
    summarise(
      `Notary submission \`${submission.id ?? 'no id'}\` for \`${basename(dmg)}\`: **${submission.status ?? 'no status'}**\n`,
    )
    if (!accepted(submission.status)) {
      failures.push(
        `the notary's status for the submission is ${JSON.stringify(submission.status)}, not "Accepted"`,
      )
    }
    if (submission.id === null) {
      failures.push('notarytool gave no submission id, so the log cannot be asked for')
    }
  }

  // The log, whatever the status, whenever there is an id to ask with.
  if (submission.id) {
    let fetched = null
    let lastProblem = null
    for (let attempt = 1; attempt <= TRIES && fetched === null; attempt++) {
      if (attempt > 1) await pause(PAUSE_MS)
      say(
        `notarize: ${shown(logArgs(submission.id, []))}${attempt > 1 ? ` (try ${attempt} of ${TRIES})` : ''}`,
      )
      const result = run('xcrun', logArgs(submission.id, auth.args), LOG_TIMEOUT_MS)
      for (const line of indented(result.stderr)) say(line)
      lastProblem = childProblem('notarytool log', result, LOG_TIMEOUT_MS)
      if (lastProblem === null && result.stdout.trim() !== '') fetched = result.stdout
      else lastProblem ??= 'notarytool log printed nothing'
    }
    if (fetched === null) {
      failures.push(
        `the notary's log could not be fetched (${lastProblem}), so what it found is unknown`,
      )
    } else {
      if (logFile !== null) {
        writeText(logFile, fetched)
        say(`notarize: the notary's log is in ${logFile}`)
      } else {
        for (const line of indented(fetched)) say(line)
      }
      const judged = judgeLog(fetched)
      if (judged.summary) say(`notarize: the notary's log: ${judged.summary}`)
      for (const warning of judged.warnings) say(`notarize: ${warning}`)
      for (const problem of judged.problems) failures.push(problem)
    }
  }

  if (failures.length > 0) {
    say(`notarize: ${dmg} is not notarised, and nothing was stapled:`)
    for (const failure of failures) say(`  ${failure}`)
    return EXIT.refused
  }

  const staple = ['stapler', 'staple', '-v', dmg]
  let stapled = false
  let stapleProblem = null
  for (let attempt = 1; attempt <= TRIES && !stapled; attempt++) {
    if (attempt > 1) await pause(PAUSE_MS)
    say(`notarize: xcrun ${staple.join(' ')}${attempt > 1 ? ` (try ${attempt} of ${TRIES})` : ''}`)
    const result = run('xcrun', staple, STAPLE_TIMEOUT_MS)
    for (const line of [...indented(result.stdout), ...indented(result.stderr)]) say(line)
    stapleProblem = childProblem('stapler staple', result, STAPLE_TIMEOUT_MS)
    stapled = stapleProblem === null
  }
  if (!stapled) {
    say(`notarize: the ticket could not be stapled to ${dmg} in ${TRIES} tries: ${stapleProblem}`)
    return EXIT.refused
  }

  const validate = ['stapler', 'validate', dmg]
  say(`notarize: xcrun ${validate.join(' ')}`)
  const validated = run('xcrun', validate, VALIDATE_TIMEOUT_MS)
  for (const line of [...indented(validated.stdout), ...indented(validated.stderr)]) say(line)
  const validateProblem = childProblem('stapler validate', validated, VALIDATE_TIMEOUT_MS)
  if (validateProblem !== null) {
    say(`notarize: the staple on ${dmg} does not validate: ${validateProblem}`)
    return EXIT.refused
  }
  say(`notarize: ${dmg} is notarised, stapled and validated (submission ${submission.id})`)
  return EXIT.done
}

const USAGE = 'usage: notarize-dmg.mjs <dmg> [--log <file>]\n'

/** `{ dmg, logFile }`, or null where the arguments are not that. */
export function parseArgs(argv) {
  let dmg = null
  let logFile = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--log') {
      const value = argv[++i]
      if (value === undefined || value === '' || logFile !== null) return null
      logFile = value
    } else if (arg.startsWith('-') || dmg !== null) return null
    else dmg = arg
  }
  return dmg === null || dmg === '' ? null : { dmg, logFile }
}

export async function main(argv, io = {}) {
  const out = io.out ?? process.stdout
  const env = io.env ?? process.env
  const options = parseArgs(argv)
  if (options === null) {
    out.write(USAGE)
    return EXIT.usage
  }
  // An absolute path, so a file named like an option is never read as one.
  const dmg = resolve(options.dmg)
  try {
    if (!statSync(dmg).isFile()) throw new Error('not a file')
  } catch {
    out.write(`notarize: ${options.dmg} is not a file\n`)
    return EXIT.usage
  }
  const summary = env.GITHUB_STEP_SUMMARY
  return notarize(
    { dmg, logFile: options.logFile === null ? null : resolve(options.logFile) },
    {
      env,
      run: io.run ?? runChild,
      say: (line) => out.write(`${line}\n`),
      pause: io.pause ?? ((ms) => sleep(ms)),
      readText: (path) => readFileSync(path, 'utf8'),
      writeText: (path, text) => {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, text)
      },
      summarise: (text) => {
        if (typeof summary === 'string' && summary !== '') appendFileSync(summary, text)
      },
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
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      process.stderr.write(`notarize: ${error?.stack ?? error}\n`)
      process.exitCode = EXIT.refused
    },
  )
}
