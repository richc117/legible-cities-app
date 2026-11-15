// Notarising the disk image (issue 686, ADR-062): scripts/notarize-dmg.mjs
// with `xcrun` played by a stand-in, so nothing here talks to Apple or needs
// a Mac. The rules each have a test that fails when the rule is taken out
// (tests/unit/notarize-dmg.mutations.json): only the word Accepted is
// accepted, whatever notarytool's exit status; the notary's log is always
// asked for, and an error in it stops the run; nothing is submitted without
// credentials; and nothing is stapled unless all of that held.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '../..')
const SCRIPT = join(repo, 'scripts', 'notarize-dmg.mjs')

interface Result {
  status: number | null
  signal?: string | null
  stdout: string
  stderr: string
  error: string | null
  timedOut: boolean
}
type Run = (command: string, args: string[], timeoutMs: number) => Result
interface Auth {
  how?: string
  args?: string[]
  keyFile?: string | null
  problem?: string
}
interface Io {
  env: Record<string, string | undefined>
  run: Run
  say(line: string): void
  pause(ms: number): Promise<void>
  readText(path: string): string
  writeText(path: string, text: string): void
  summarise(text: string): void
}
interface Module {
  EXIT: { done: number; refused: number; usage: number }
  WAIT: string
  SUBMIT_TIMEOUT_MS: number
  LOG_TIMEOUT_MS: number
  STAPLE_TIMEOUT_MS: number
  VALIDATE_TIMEOUT_MS: number
  TRIES: number
  PAUSE_MS: number
  WORST_CASE_MS: number
  KEY_VARIABLES: string[]
  PROFILE_VARIABLE: string
  notaryAuth(env: Record<string, string | undefined>): Auth
  keyProblem(text: unknown): string | null
  submitArgs(dmg: string, auth: string[]): string[]
  logArgs(id: string, auth: string[]): string[]
  parseSubmission(stdout: unknown): {
    id?: string | null
    status?: string | null
    message?: string | null
    problem?: string
  }
  accepted(status: unknown): boolean
  judgeLog(text: string): { problems: string[]; warnings: string[]; summary?: string }
  childProblem(what: string, result: Result, timeoutMs: number): string | null
  runChild: Run
  notarize(options: { dmg: string; logFile?: string | null }, io: Io): Promise<number>
  parseArgs(argv: string[]): { dmg: string; logFile: string | null } | null
  main(
    argv: string[],
    io?: {
      out?: { write(text: string): void }
      env?: Record<string, string | undefined>
      run?: Run
      pause?: (ms: number) => Promise<void>
    },
  ): Promise<number>
}
// A URL built at run time, so the type checker does not look for
// declarations of a plain JavaScript module.
const load = (): Promise<Module> => import(pathToFileURL(SCRIPT).href) as Promise<Module>

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'lc-notarize-dmg-test-'))
  made.push(dir)
  return dir
}

const ID = '2efe2717-52ef-43a5-96dc-0797e4ca1041'
const DMG = '/release/Legible Cities-1.0.0-arm64.dmg'
// Stand-ins shaped like the real thing; none is a credential of anything.
const KEY_FILE = '/runner/temp/notary-key.p8'
const KEY_ID = 'KEYID12345'
const ISSUER = '11111111-2222-3333-4444-555555555555'
// Put together from pieces, so no file here holds a key's marker whole,
// which bin/preflight refuses wherever it finds one.
const DASHES = '-'.repeat(5)
const KEY_TEXT = `${DASHES}BEGIN PRIVATE KEY${DASHES}\nnot-a-key\n${DASHES}END PRIVATE KEY${DASHES}\n`
const KEY_ENV = { NOTARY_KEY_PATH: KEY_FILE, NOTARY_KEY_ID: KEY_ID, NOTARY_ISSUER_ID: ISSUER }
const KEY_ARGS = ['--key', KEY_FILE, '--key-id', KEY_ID, '--issuer', ISSUER]

const ok = (stdout = '', stderr = ''): Result => ({
  status: 0,
  stdout,
  stderr,
  error: null,
  timedOut: false,
})
const exited = (status: number, stderr = '', stdout = ''): Result => ({
  status,
  stdout,
  stderr,
  error: null,
  timedOut: false,
})
const submission = (status: string, id: string | null = ID): string =>
  JSON.stringify({ id, status, message: 'Processing complete' })
const notaryLog = (over: Record<string, unknown> = {}): string =>
  JSON.stringify(
    {
      logFormatVersion: 1,
      jobId: ID,
      status: 'Accepted',
      statusSummary: 'Ready for distribution',
      statusCode: 0,
      archiveFilename: 'Legible Cities-1.0.0-arm64.dmg',
      ticketContents: [{ path: 'a.dmg' }, { path: 'a.dmg/Legible Cities.app' }],
      issues: null,
      ...over,
    },
    null,
    2,
  )

/** What `xcrun` answers, by its first two words; a list is answered in turn. */
type Answers = Partial<
  Record<'submit' | 'log' | 'staple' | 'validate', Result | Result[] | (() => Result)>
>
interface Session {
  io: Io
  calls: { command: string; args: string[]; timeoutMs: number }[]
  kinds(): string[]
  said: string[]
  pauses: number[]
  written: Map<string, string>
  summary: string[]
}
function session(
  answers: Answers = {},
  env: Record<string, string | undefined> = KEY_ENV,
): Session {
  const calls: Session['calls'] = []
  const said: string[] = []
  const pauses: number[] = []
  const written = new Map<string, string>()
  const summary: string[] = []
  const defaults: Required<Answers> = {
    submit: ok(submission('Accepted')),
    log: ok(notaryLog()),
    staple: ok('Processing: a.dmg\nThe staple and validate action worked!\n'),
    validate: ok('Processing: a.dmg\nThe validate action worked!\n'),
  }
  const turn = new Map<string, number>()
  const kindOf = (args: string[]): keyof Answers =>
    args[0] === 'notarytool' ? (args[1] as 'submit' | 'log') : (args[1] as 'staple' | 'validate')
  const run: Run = (command, args, timeoutMs) => {
    calls.push({ command, args, timeoutMs })
    const kind = kindOf(args)
    const answer = answers[kind] ?? defaults[kind]
    if (typeof answer === 'function') return answer()
    if (Array.isArray(answer)) {
      const at = turn.get(kind) ?? 0
      turn.set(kind, at + 1)
      return answer[Math.min(at, answer.length - 1)]
    }
    return answer
  }
  return {
    io: {
      env,
      run,
      say: (line) => said.push(line),
      pause: (ms) => {
        pauses.push(ms)
        return Promise.resolve()
      },
      readText: (path) => {
        if (path !== KEY_FILE) throw Object.assign(new Error('no such file'), { code: 'ENOENT' })
        return KEY_TEXT
      },
      writeText: (path, text) => void written.set(path, text),
      summarise: (text) => summary.push(text),
    },
    calls,
    kinds: () => calls.map((call) => kindOf(call.args) as string),
    said,
    pauses,
    written,
    summary,
  }
}

describe('the credentials', () => {
  it('are the API key when all three of its variables are set', async () => {
    const { notaryAuth } = await load()
    expect(notaryAuth(KEY_ENV)).toEqual({
      how: 'an App Store Connect API key',
      args: KEY_ARGS,
      keyFile: KEY_FILE,
    })
    // A value read from a file keeps its line end; the argument must not.
    expect(notaryAuth({ ...KEY_ENV, NOTARY_KEY_ID: `${KEY_ID}\n` }).args).toEqual(KEY_ARGS)
    // And the key wins over a profile that is also set.
    expect(notaryAuth({ ...KEY_ENV, NOTARY_KEYCHAIN_PROFILE: 'mine' }).args).toEqual(KEY_ARGS)
  })

  it('are a keychain profile only when none of the three is set', async () => {
    const { notaryAuth } = await load()
    expect(notaryAuth({ NOTARY_KEYCHAIN_PROFILE: 'mine' })).toEqual({
      how: 'a keychain profile',
      args: ['--keychain-profile', 'mine'],
      keyFile: null,
    })
  })

  it('are refused in part, naming each empty variable, even beside a profile', async () => {
    // Mutation: a key given in part passed over for the profile, so a run
    // with one secret missing notarises as whoever the machine's profile is.
    const { notaryAuth } = await load()
    const partial = notaryAuth({
      NOTARY_KEY_PATH: KEY_FILE,
      NOTARY_KEY_ID: '  ',
      NOTARY_ISSUER_ID: '',
      NOTARY_KEYCHAIN_PROFILE: 'mine',
    })
    expect(partial.args).toBeUndefined()
    expect(partial.problem).toBe(
      "NOTARY_KEY_ID and NOTARY_ISSUER_ID are empty, and NOTARY_KEY_PATH is set: the notary's key needs all three",
    )
    expect(notaryAuth({ ...KEY_ENV, NOTARY_KEY_PATH: undefined }).problem).toContain(
      'NOTARY_KEY_PATH is empty',
    )
  })

  it('are refused when nothing is set, naming every variable', async () => {
    const { notaryAuth, KEY_VARIABLES, PROFILE_VARIABLE } = await load()
    const none = notaryAuth({})
    expect(none.args).toBeUndefined()
    for (const name of [...KEY_VARIABLES, PROFILE_VARIABLE]) expect(none.problem).toContain(name)
  })

  it('need a key file that is a private key, not an empty secret written to disk', async () => {
    const { keyProblem } = await load()
    expect(keyProblem(KEY_TEXT)).toBeNull()
    expect(keyProblem('\n')).toContain('empty file')
    expect(keyProblem('KEYID12345\n')).toContain('no BEGIN PRIVATE KEY line')
  })
})

describe('the commands', () => {
  it('submit the image and wait, with a limit, for one JSON object', async () => {
    const { submitArgs, logArgs, WAIT, SUBMIT_TIMEOUT_MS } = await load()
    expect(submitArgs(DMG, KEY_ARGS)).toEqual([
      'notarytool',
      'submit',
      DMG,
      ...KEY_ARGS,
      '--wait',
      '--timeout',
      '60m',
      '--output-format',
      'json',
    ])
    expect(logArgs(ID, KEY_ARGS)).toEqual(['notarytool', 'log', ID, ...KEY_ARGS])
    // The child's own limit is past notarytool's, so notarytool gives up
    // first and still prints the id.
    expect(WAIT).toBe('60m')
    expect(SUBMIT_TIMEOUT_MS).toBeGreaterThan(60 * 60_000)
  })

  it('read the submission from the last JSON object printed, and take only a UUID as its id', async () => {
    const { parseSubmission } = await load()
    expect(parseSubmission(submission('Accepted'))).toEqual({
      id: ID,
      status: 'Accepted',
      message: 'Processing complete',
    })
    expect(parseSubmission(`a warning first\n${submission('Invalid')}\n`).status).toBe('Invalid')
    expect(parseSubmission(JSON.stringify({ id: ID, status: 'Accepted' }, null, 2)).id).toBe(ID)
    // An id becomes an argument of the next call: nothing but a UUID is one.
    expect(
      parseSubmission(JSON.stringify({ id: '--output-path', status: 'Accepted' })).id,
    ).toBeNull()
    expect(parseSubmission('Error: HTTP status code: 401').problem).toContain('no JSON object')
    expect(parseSubmission('').problem).toContain('no JSON object')
    expect(parseSubmission('[1]').problem).toContain('no JSON object')
  })
})

describe("the notary's log", () => {
  it('passes with no issues, and with warnings, which it lists', async () => {
    const { judgeLog } = await load()
    expect(judgeLog(notaryLog())).toEqual({
      problems: [],
      warnings: [],
      summary: 'Ready for distribution; 2 signed items in the ticket; 0 issues',
    })
    const warned = judgeLog(
      notaryLog({
        issues: [
          {
            severity: 'warning',
            path: 'a.dmg/Legible Cities.app/Contents/Resources/x',
            message: 'The binary uses an SDK older than the 10.9 SDK.',
            architecture: 'arm64',
          },
        ],
      }),
    )
    expect(warned.problems).toEqual([])
    expect(warned.warnings).toEqual([
      'warning: a.dmg/Legible Cities.app/Contents/Resources/x [arm64]: The binary uses an SDK older than the 10.9 SDK.',
    ])
  })

  it('fails on an issue of severity error, naming the file and the message', async () => {
    const { judgeLog } = await load()
    const judged = judgeLog(
      notaryLog({
        issues: [
          { severity: 'warning', path: 'a', message: 'w' },
          {
            severity: 'error',
            path: 'a.dmg/Legible Cities.app/Contents/Resources/loom/topo',
            message: 'The signature does not include a secure timestamp.',
          },
        ],
      }),
    )
    expect(judged.problems).toEqual([
      'error: a.dmg/Legible Cities.app/Contents/Resources/loom/topo: The signature does not include a secure timestamp.',
    ])
    expect(judged.warnings).toHaveLength(1)
    // However the word is cased.
    expect(judgeLog(notaryLog({ issues: [{ severity: 'Error', message: 'm' }] })).problems).toEqual(
      ['error: (no path): m'],
    )
  })

  it('fails when it cannot be read, does not say Accepted, or holds an issue with no severity', async () => {
    const { judgeLog } = await load()
    expect(judgeLog('<html>Service Unavailable</html>').problems).toEqual([
      "the notary's log is not JSON, so it cannot be read",
    ])
    expect(judgeLog('[]').problems).toHaveLength(1)
    expect(judgeLog(notaryLog({ status: 'Invalid' })).problems).toEqual([
      'the notary\'s log gives the status "Invalid", not "Accepted"',
    ])
    expect(judgeLog(notaryLog({ issues: 'none' })).problems).toEqual([
      'the notary\'s log has an "issues" that is not a list, so its issues cannot be read',
    ])
    expect(judgeLog(notaryLog({ issues: [{ path: 'p', message: 'm' }] })).problems).toEqual([
      'an issue with no severity: p: m',
    ])
  })
})

describe('a run', () => {
  it('submits, asks for the log, staples and validates, in that order, and exits 0', async () => {
    const { notarize, EXIT, SUBMIT_TIMEOUT_MS, LOG_TIMEOUT_MS } = await load()
    const s = session()
    expect(await notarize({ dmg: DMG, logFile: '/out/notary-log.json' }, s.io)).toBe(EXIT.done)
    expect(s.calls.map((call) => [call.command, ...call.args])).toEqual([
      [
        'xcrun',
        'notarytool',
        'submit',
        DMG,
        ...KEY_ARGS,
        '--wait',
        '--timeout',
        '60m',
        '--output-format',
        'json',
      ],
      ['xcrun', 'notarytool', 'log', ID, ...KEY_ARGS],
      ['xcrun', 'stapler', 'staple', '-v', DMG],
      ['xcrun', 'stapler', 'validate', DMG],
    ])
    // Every child has a limit.
    expect(s.calls.map((call) => call.timeoutMs)).toEqual([
      SUBMIT_TIMEOUT_MS,
      LOG_TIMEOUT_MS,
      expect.any(Number),
      expect.any(Number),
    ])
    for (const call of s.calls) expect(call.timeoutMs).toBeGreaterThan(0)
    // The log is kept as it came, and the id reaches the log and the summary.
    expect(s.written.get('/out/notary-log.json')).toBe(notaryLog())
    expect(s.said.join('\n')).toContain(`submission ${ID}: Accepted`)
    expect(s.summary.join('')).toBe(
      `Notary submission \`${ID}\` for \`Legible Cities-1.0.0-arm64.dmg\`: **Accepted**\n`,
    )
    expect(s.pauses).toEqual([])
  })

  it('never prints a credential', async () => {
    // Mutation: the command shown as it is run, key id and issuer included.
    const { notarize } = await load()
    const s = session({ submit: exited(1, 'Error: could not authenticate'), log: exited(1, 'no') })
    await notarize({ dmg: DMG }, s.io)
    const everything = [...s.said, ...s.summary].join('\n')
    expect(everything).toContain(`xcrun notarytool submit ${DMG} --wait`)
    expect(everything).toContain('(credentials not shown)')
    for (const secret of [KEY_ID, ISSUER, KEY_FILE, 'not-a-key']) {
      expect(everything).not.toContain(secret)
    }
  })

  it('refuses a status that is not Accepted even when notarytool exits 0, and still asks for the log', async () => {
    const { notarize, EXIT } = await load()
    for (const status of ['Invalid', 'Rejected', 'In Progress', 'accepted']) {
      const s = session({
        submit: ok(submission(status)),
        log: ok(notaryLog({ status: 'Accepted' })),
      })
      expect(await notarize({ dmg: DMG, logFile: '/out/log.json' }, s.io), status).toBe(
        EXIT.refused,
      )
      // The log is asked for and kept; nothing is stapled.
      expect(s.kinds(), status).toEqual(['submit', 'log'])
      expect(s.written.has('/out/log.json')).toBe(true)
      expect(s.said.join('\n')).toContain(
        `the notary's status for the submission is ${JSON.stringify(status)}, not "Accepted"`,
      )
      expect(s.summary.join('')).toContain(`**${status}**`)
    }
  })

  it('refuses an accepted submission whose log holds an error, and staples nothing', async () => {
    const { notarize, EXIT } = await load()
    const s = session({
      log: ok(
        notaryLog({
          issues: [{ severity: 'error', path: 'a.dmg/x', message: 'The binary is not signed.' }],
        }),
      ),
    })
    expect(await notarize({ dmg: DMG }, s.io)).toBe(EXIT.refused)
    expect(s.kinds()).toEqual(['submit', 'log'])
    expect(s.said.join('\n')).toContain('error: a.dmg/x: The binary is not signed.')
  })

  it('refuses an accepted submission whose log cannot be fetched, after three tries', async () => {
    // Mutation: a log that could not be read taken as a log with no issues.
    const { notarize, EXIT, TRIES, PAUSE_MS } = await load()
    const s = session({ log: exited(1, 'Error: the log is not ready') })
    expect(await notarize({ dmg: DMG }, s.io)).toBe(EXIT.refused)
    expect(TRIES).toBe(3)
    expect(s.kinds()).toEqual(['submit', 'log', 'log', 'log'])
    expect(s.pauses).toEqual([PAUSE_MS, PAUSE_MS])
    expect(s.said.join('\n')).toContain("the notary's log could not be fetched")
    // The child's standard error is in the log, each time.
    expect(s.said.filter((line) => line.includes('Error: the log is not ready'))).toHaveLength(3)
  })

  it('takes a log that arrives on a later try', async () => {
    const { notarize, EXIT } = await load()
    const s = session({ log: [exited(1, 'not yet'), ok(notaryLog())] })
    expect(await notarize({ dmg: DMG }, s.io)).toBe(EXIT.done)
    expect(s.kinds()).toEqual(['submit', 'log', 'log', 'staple', 'validate'])
  })

  it('passes warnings on, printed', async () => {
    const { notarize, EXIT } = await load()
    const s = session({
      log: ok(notaryLog({ issues: [{ severity: 'warning', path: 'p', message: 'old SDK' }] })),
    })
    expect(await notarize({ dmg: DMG }, s.io)).toBe(EXIT.done)
    expect(s.said).toContain('notarize: warning: p: old SDK')
  })

  it('refuses when notarytool fails, times out or prints nothing it can read', async () => {
    const { notarize, EXIT } = await load()
    const failed = session({ submit: exited(1, 'Error: HTTP status code: 401') })
    expect(await notarize({ dmg: DMG }, failed.io)).toBe(EXIT.refused)
    // No id, so no log to ask for; and nothing stapled.
    expect(failed.kinds()).toEqual(['submit'])
    expect(failed.said.join('\n')).toContain('notarytool submit exited 1')
    expect(failed.said.join('\n')).toContain('Error: HTTP status code: 401')

    const stopped = session({
      submit: {
        status: null,
        stdout: '',
        stderr: '',
        error: 'spawnSync xcrun ETIMEDOUT',
        timedOut: true,
      },
    })
    expect(await notarize({ dmg: DMG }, stopped.io)).toBe(EXIT.refused)
    expect(stopped.kinds()).toEqual(['submit'])
    expect(stopped.said.join('\n')).toContain(
      'notarytool submit did not finish within 70 minutes and was stopped',
    )

    // Accepted, by a notarytool that then exits non-zero: not accepted.
    const odd = session({ submit: exited(1, 'odd', submission('Accepted')) })
    expect(await notarize({ dmg: DMG }, odd.io)).toBe(EXIT.refused)
    expect(odd.kinds()).toEqual(['submit', 'log'])

    const noId = session({ submit: ok(submission('Accepted', null)) })
    expect(await notarize({ dmg: DMG }, noId.io)).toBe(EXIT.refused)
    expect(noId.kinds()).toEqual(['submit'])
  })

  it('staples up to three times, a moment apart, and stops at the first that works', async () => {
    const { notarize, EXIT, PAUSE_MS } = await load()
    const s = session({
      staple: [
        exited(65, 'CloudKit query failed'),
        exited(65, 'CloudKit query failed'),
        ok('worked'),
      ],
    })
    expect(await notarize({ dmg: DMG }, s.io)).toBe(EXIT.done)
    expect(s.kinds()).toEqual(['submit', 'log', 'staple', 'staple', 'staple', 'validate'])
    expect(s.pauses).toEqual([PAUSE_MS, PAUSE_MS])
  })

  it('adds up to a worst case that is a run at its slowest', async () => {
    // Mutation: the pauses left out of the sum, so a step given "longer
    // than the script's worst case" can still be stopped by the runner
    // before the script has said what happened.
    const { notarize, EXIT, WORST_CASE_MS } = await load()
    // The log and the staple each arrive on the last try.
    const s = session({
      log: [exited(1, 'not yet'), exited(1, 'not yet'), ok(notaryLog())],
      staple: [exited(65, 'not yet'), exited(65, 'not yet'), ok('worked')],
    })
    expect(await notarize({ dmg: DMG }, s.io)).toBe(EXIT.done)
    const limits = s.calls.reduce((total, call) => total + call.timeoutMs, 0)
    const pauses = s.pauses.reduce((total, ms) => total + ms, 0)
    expect(WORST_CASE_MS).toBe(limits + pauses)
    // The figure build.yml's comment gives for the step that runs it.
    expect(WORST_CASE_MS / 60_000).toBe(84)
  })

  it('refuses when the ticket cannot be stapled in three tries, or the staple does not validate', async () => {
    // Mutation: the stapler's exit status not read, so an image with no
    // ticket is uploaded as stapled.
    const { notarize, EXIT } = await load()
    const never = session({ staple: exited(65, 'CloudKit query failed') })
    expect(await notarize({ dmg: DMG }, never.io)).toBe(EXIT.refused)
    expect(never.kinds()).toEqual(['submit', 'log', 'staple', 'staple', 'staple'])
    expect(never.said.join('\n')).toContain('could not be stapled')

    const invalid = session({ validate: exited(65, 'does not have a ticket stapled to it') })
    expect(await notarize({ dmg: DMG }, invalid.io)).toBe(EXIT.refused)
    expect(invalid.kinds()).toEqual(['submit', 'log', 'staple', 'validate'])
    expect(invalid.said.join('\n')).toContain('does not validate: stapler validate exited 65')
  })

  it('submits nothing without credentials, naming what is empty', async () => {
    const { notarize, EXIT } = await load()
    for (const env of [
      {},
      { ...KEY_ENV, NOTARY_ISSUER_ID: '' },
      { NOTARY_KEY_PATH: KEY_FILE, NOTARY_KEYCHAIN_PROFILE: 'mine' },
    ]) {
      const s = session({}, env)
      expect(await notarize({ dmg: DMG }, s.io)).toBe(EXIT.usage)
      expect(s.calls).toEqual([])
      expect(s.said.join('\n')).toMatch(/NOTARY_[A-Z_]+ (is|are|are all) empty/)
    }
  })

  it('submits nothing with a key file that is missing, empty or not a key', async () => {
    const { notarize, EXIT } = await load()
    const missing = session({}, { ...KEY_ENV, NOTARY_KEY_PATH: '/nowhere/key.p8' })
    expect(await notarize({ dmg: DMG }, missing.io)).toBe(EXIT.usage)
    expect(missing.calls).toEqual([])
    expect(missing.said.join('\n')).toContain('cannot be read: ENOENT')

    const empty = session()
    empty.io.readText = () => '\n'
    expect(await notarize({ dmg: DMG }, empty.io)).toBe(EXIT.usage)
    expect(empty.calls).toEqual([])
    expect(empty.said.join('\n')).toContain('the secret holding the .p8 key is empty')
  })
})

describe('the command line', () => {
  it('takes one image and an optional log file, and nothing else', async () => {
    const { parseArgs } = await load()
    expect(parseArgs(['a.dmg'])).toEqual({ dmg: 'a.dmg', logFile: null })
    expect(parseArgs(['--log', 'l.json', 'a.dmg'])).toEqual({ dmg: 'a.dmg', logFile: 'l.json' })
    for (const bad of [
      [],
      ['a.dmg', 'b.dmg'],
      ['--log'],
      ['a.dmg', '--key', 'k'],
      ['--log', 'l', '--log', 'm', 'a.dmg'],
    ]) {
      expect(parseArgs(bad), bad.join(' ')).toBeNull()
    }
  })

  it('runs whole: the log file in a folder it makes, the id in the step summary', async () => {
    const { main, EXIT } = await load()
    const dir = scratch()
    const dmg = join(dir, 'a.dmg')
    const key = join(dir, 'key.p8')
    const summary = join(dir, 'summary.md')
    const log = join(dir, 'made', 'here', 'notary-log.json')
    writeFileSync(dmg, 'not really an image')
    writeFileSync(key, KEY_TEXT)
    const s = session()
    const out: string[] = []
    const code = await main([dmg, '--log', log], {
      out: { write: (text) => void out.push(text) },
      env: { ...KEY_ENV, NOTARY_KEY_PATH: key, GITHUB_STEP_SUMMARY: summary },
      run: s.io.run,
      pause: s.io.pause,
    })
    expect(code).toBe(EXIT.done)
    expect(readFileSync(log, 'utf8')).toBe(notaryLog())
    expect(readFileSync(summary, 'utf8')).toBe(
      `Notary submission \`${ID}\` for \`a.dmg\`: **Accepted**\n`,
    )
    expect(s.calls[0].args[2]).toBe(dmg)
    expect(out.join('')).toContain('is notarised, stapled and validated')
  })

  it('exits 2 without an image that is a file, before anything runs', async () => {
    const { main, EXIT } = await load()
    const s = session()
    // Credentials that are all there, with a key file that is one: nothing
    // but the image itself stands between each call and a submission.
    const key = join(scratch(), 'key.p8')
    writeFileSync(key, KEY_TEXT)
    const call = async (argv: string[]): Promise<{ code: number; out: string }> => {
      const out: string[] = []
      const code = await main(argv, {
        out: { write: (text: string) => void out.push(text) },
        env: { ...KEY_ENV, NOTARY_KEY_PATH: key },
        run: s.io.run,
        pause: s.io.pause,
      })
      return { code, out: out.join('') }
    }
    expect(await call([])).toEqual({
      code: EXIT.usage,
      out: 'usage: notarize-dmg.mjs <dmg> [--log <file>]\n',
    })
    const missing = join(scratch(), 'none.dmg')
    expect(await call([missing])).toEqual({
      code: EXIT.usage,
      out: `notarize: ${missing} is not a file\n`,
    })
    // A folder exists and is still not an image to submit.
    const folder = scratch()
    expect(await call([folder])).toEqual({
      code: EXIT.usage,
      out: `notarize: ${folder} is not a file\n`,
    })
    expect(s.calls).toEqual([])
  })
})

describe('the child processes', () => {
  it('are given a limit that stops them, no standard input, and have both outputs kept', async () => {
    const { runChild, childProblem } = await load()
    const slow = runChild(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], 300)
    expect(slow.timedOut).toBe(true)
    expect(childProblem('it', slow, 120_000)).toBe(
      'it did not finish within 2 minutes and was stopped',
    )

    const loud = runChild(
      process.execPath,
      ['-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)'],
      30_000,
    )
    expect([loud.status, loud.stdout, loud.stderr, loud.timedOut]).toEqual([3, 'out', 'err', false])
    expect(childProblem('it', loud, 30_000)).toBe('it exited 3')

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

    const absent = runChild('lc-no-such-command-686', [], 30_000)
    expect(absent.error).toContain('ENOENT')
    expect(childProblem('it', absent, 30_000)).toContain('it could not run')
  })
})

// The step that runs the script holds the notary's key, and the design is
// that no package from npm runs there (ADR-062).
describe('scripts/notarize-dmg.mjs itself', () => {
  const source = readFileSync(SCRIPT, 'utf8')

  it("imports nothing but Node's own modules", () => {
    const specifiers = [...source.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
    expect(specifiers.length).toBeGreaterThan(3)
    for (const specifier of specifiers) expect(specifier).toMatch(/^node:/)
    // And no other way in: no require, no dynamic import.
    expect(source).not.toMatch(/\brequire\s*\(/)
    expect(source).not.toMatch(/\bimport\s*\(/)
  })

  it('starts every child through the one function that sets a limit', () => {
    expect(source.match(/\bspawnSync\(/g)).toHaveLength(1)
    expect(source).not.toMatch(/\b(exec|execSync|execFile|execFileSync|spawn)\(/)
    expect(source).not.toContain('shell: true')
  })
})
