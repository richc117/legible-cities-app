// The mutation job (specs/038-test-pyramid, Part 3, FR-008; ADR-059's
// Consequences fix the form).
//
//   node scripts/mutations.mjs --check
//   node scripts/mutations.mjs [--only <path or substring>]
//
// A test that names its mutation in a comment ("Mutation: `<=` for `<`")
// says what it guards, and nothing proves it still does. This script makes
// the comment an entry a machine can run: a JSON file beside the test,
// `tests/unit/<name>.mutations.json`, an array of
//
//   { "file", "find", "replace", "test", "title", "why" }
//
// `find` must occur exactly once in `file` (zero or two is a refusal, never
// a guess), `test` is the test file that must go red, `title` is what
// Vitest's `-t` is given and must match at least one test of it, `why` is
// one sentence for the person reading the report.
//
// `--check` reads every such file and validates every entry against the
// working tree: it runs nothing and changes nothing, and the unit suite
// calls it, so a file cannot rot unnoticed. Without it, each entry in turn
// is applied to a clean tree, its test is run, and the file is put back by
// writing the bytes read before it was changed (never by asking git, which
// would also discard an edit of a person's) and the write is read back and
// compared. Before the first entry of each test file, that file is run whole
// and unmutated: red on clean code, a mutation proves nothing. A verdict is
// one of
//
//   red       at least one test ran and one failed: the mutation bites
//   green     tests ran and none failed: the test has gone vacuous
//   no test   `title` matched no test (or the test file would not load)
//   error     the run produced no report we can read
//   refused   the entry cannot be applied (find not once, file not tracked
//             by git or a symbolic link, the test red on clean code, ...)
//   timed out Vitest did not finish in time
//
// and the exit status is 0 only where every entry is red. A restore that
// does not take stops the whole run with the file named, since nothing
// after it would be measured on clean code.
//
// Interrupting: the run is synchronous while Vitest runs, so a signal is
// seen when the entry in flight ends. Ctrl-C in a terminal reaches this
// process and not Vitest (it is started in a group of its own, so that a
// timeout can end its workers too), which means the entry in flight finishes
// or times out, its file is put back, and the run then stops with STOPPED
// and a non-zero exit. Nothing is left mutated by an interruption.
//
// Only the unit tests run: a `.browser.test.tsx` entry is refused. On
// Windows a timeout ends Vitest's own process and not its workers.
//
// Every decision is a function the unit test calls
// (tests/unit/mutations-runner.test.ts); the file and process work is
// behind `main`, which runs only when this is the entry point.

import { spawnSync } from 'node:child_process'
import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const FIELDS = ['file', 'find', 'replace', 'test', 'title', 'why']
// The suite's `testTimeout` is 30 s; a run of one file starts Vitest, loads
// the file and runs its tests. The variable is for the unit test, which
// needs a mutation that never ends to end quickly.
export const RUN_TIMEOUT_MS = 120_000
const timeoutMs = () => {
  const told = Number(process.env.LEGIBLE_MUTATIONS_TIMEOUT_MS)
  return Number.isInteger(told) && told > 0 ? told : RUN_TIMEOUT_MS
}
const GIT_TIMEOUT_MS = 60_000
const BROWSER_TEST = /\.browser\.test\.tsx?$/

// ---- pure decisions ------------------------------------------------------

/** Every way an entry is malformed, each as a sentence; empty where it is not. */
export function validateEntry(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return ['is not an object with the fields ' + FIELDS.join(', ')]
  }
  const problems = []
  for (const field of FIELDS) {
    if (!(field in entry)) problems.push(`has no "${field}"`)
    else if (typeof entry[field] !== 'string') {
      problems.push(`has a "${field}" that is not a string (it is ${describeType(entry[field])})`)
    }
  }
  for (const field of Object.keys(entry)) {
    if (!FIELDS.includes(field)) problems.push(`has a field "${field}" that the form does not have`)
  }
  // `replace` may be empty (a deletion); the rest must say something.
  for (const field of ['file', 'find', 'test', 'title', 'why']) {
    if (typeof entry[field] === 'string' && entry[field].trim() === '') {
      problems.push(`has an empty "${field}"`)
    }
  }
  for (const field of ['file', 'test']) {
    const path = entry[field]
    if (typeof path !== 'string' || path.trim() === '') continue
    if (path.includes('\\'))
      problems.push(`"${field}" uses a backslash: write the path with forward slashes`)
    else if (isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.split('/').includes('..')) {
      problems.push(`"${field}" is not a path inside the repository: write it relative to the top`)
    }
  }
  if (typeof entry.find === 'string' && entry.find === entry.replace) {
    problems.push('has a "replace" equal to its "find": it changes nothing')
  }
  return problems
}

function describeType(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value
}

/** How many times `needle` occurs in `text`, counting overlaps (so "once" is strict). */
export function occurrences(text, needle) {
  if (needle === '') return 0
  let count = 0
  let at = text.indexOf(needle)
  while (at !== -1) {
    count += 1
    at = text.indexOf(needle, at + 1)
  }
  return count
}

/** The sentence a `find` that is not exactly once is refused with, or null. */
export function findProblem(text, entry) {
  const n = occurrences(text, entry.find)
  if (n === 1) return null
  const where = `${entry.file}`
  return n === 0
    ? `"find" does not occur in ${where}: the source has moved, so copy the text again from the file`
    : `"find" occurs ${n} times in ${where}: lengthen it until it occurs once`
}

/** `text` with the one `find` replaced. Not String.replace: `$&` in `replace` is text. */
export function applyMutation(text, entry) {
  const at = text.indexOf(entry.find)
  return text.slice(0, at) + entry.replace + text.slice(at + entry.find.length)
}

/** Whether the test file's text carries the title (it('...title...') or the describe above it). */
export function titleIn(testText, title) {
  return testText.includes(title)
}

/** Vitest's `-t` takes a pattern; the title is text. */
export function escapeForPattern(title) {
  return title.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/**
 * The verdict from Vitest's JSON report. `numTotalTests` counts the tests
 * the filter left out as well, so what ran is passed plus failed.
 */
export function verdictOf(report) {
  if (report === null || typeof report !== 'object') return 'error'
  const { numPassedTests: passed, numFailedTests: failed } = report
  if (!Number.isInteger(passed) || !Number.isInteger(failed)) return 'error'
  if (passed + failed === 0) return 'no test'
  return failed > 0 ? 'red' : 'green'
}

/**
 * Whether a test file's unmutated run can be trusted as a baseline: nothing
 * failed and something passed. `{ clean, why }`.
 */
export function baselineOf(report) {
  if (report === null || typeof report !== 'object') {
    return { clean: false, why: 'the unmutated run of the test produced no report' }
  }
  const { numPassedTests: passed, numFailedTests: failed } = report
  if (!Number.isInteger(passed) || !Number.isInteger(failed)) {
    return { clean: false, why: 'the unmutated run of the test produced no counts' }
  }
  if (failed > 0) {
    return {
      clean: false,
      why: `the test is red on clean code (${failed} failed), so a mutation proves nothing: fix the test first`,
    }
  }
  if (passed === 0) {
    return { clean: false, why: 'no test ran on clean code, so a mutation proves nothing' }
  }
  return { clean: true, why: '' }
}

/** The command line: `{ mode: 'check' | 'run', only }`, or `{ error }`. Nothing else is accepted. */
export function parseArgs(args) {
  const use = 'use --check, or --only <text>, or no argument to run every mutation'
  if (args.length === 0) return { mode: 'run', only: undefined }
  if (args.length === 1 && args[0] === '--check') return { mode: 'check', only: undefined }
  if (args[0] === '--only') {
    if (args.length === 1 || args[1].trim() === '') {
      return { error: `--only needs the text to look for, and none was given: ${use}` }
    }
    if (args.length === 2) return { mode: 'run', only: args[1] }
  }
  return { error: `unknown arguments ${JSON.stringify(args.join(' '))}: ${use}` }
}

/** Whether an entry matches `--only`: a substring of its file, test, title or mutations file. */
export function selected(entry, source, only) {
  if (only === undefined || only === '') return true
  const texts = [entry?.file, entry?.test, entry?.title, source]
  return texts.some((s) => typeof s === 'string' && s.includes(only))
}

/** The sentence the dirty-tree refusal is, from `git status --porcelain` lines. */
export function dirtyRefusal(lines) {
  return (
    'the tree under src and tests, or a file an entry names, is not clean, and a mutation ' +
    'applied on top of an edit would hide it: commit or stash these first\n' +
    lines.map((line) => `  ${line}`).join('\n')
  )
}

/** Lines of `git status --porcelain -- <paths>` in `repo`, or throws if git cannot say. */
export function dirtyTree(repo, paths = ['src', 'tests']) {
  const result = git(repo, ['status', '--porcelain', '--', ...paths])
  if (result.error || result.status !== 0) {
    throw new Error(
      `git could not say whether the tree is clean (${gitWhy(result)}): refusing to mutate what cannot be restored`,
    )
  }
  return result.stdout.split('\n').filter((line) => line !== '')
}

// ---- files and processes -------------------------------------------------

// What git exports to a hook or a rebase (GIT_DIR and the like) would point
// these commands at another repository than `repo`.
function gitEnv() {
  const kept = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith('GIT_')) kept[name] = value
  }
  return kept
}

function git(repo, args) {
  return spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    windowsHide: true,
    timeout: GIT_TIMEOUT_MS,
    env: gitEnv(),
  })
}

function gitWhy(result) {
  if (result.error) return result.error.message
  return (result.stderr || `exit status ${result.status}`).trim()
}

/** Every `*.mutations.json` under tests/unit, as repository-relative paths, sorted. */
export function mutationFiles(repo) {
  const found = []
  const walk = (dir) => {
    for (const item of readdirSync(join(repo, dir), { withFileTypes: true })) {
      const path = `${dir}/${item.name}`
      if (item.isDirectory()) walk(path)
      else if (item.name.endsWith('.mutations.json')) found.push(path)
    }
  }
  walk('tests/unit')
  return found.sort()
}

/** The entries of every mutations file: `{ source, index, entry }`, and the files that would not parse. */
export function loadEntries(repo) {
  const entries = []
  const unreadable = []
  for (const source of mutationFiles(repo)) {
    let list
    try {
      list = JSON.parse(readFileSync(join(repo, source), 'utf8'))
    } catch (error) {
      unreadable.push(`${source}: not JSON (${error.message})`)
      continue
    }
    if (!Array.isArray(list)) {
      unreadable.push(`${source}: is not an array of entries`)
      continue
    }
    list.forEach((entry, index) => entries.push({ source, index, entry }))
  }
  return { entries, unreadable }
}

/** Whether git tracks `file` (`ls-files` names neither an untracked nor an ignored one). */
function tracked(repo, file) {
  const result = git(repo, ['ls-files', '--error-unmatch', '--', file])
  return !result.error && result.status === 0
}

/**
 * What is wrong with `file` as something to write to and put back: it is
 * missing, a symbolic link, resolves outside the repository, or git does not
 * track it (an untracked or ignored file has no other copy). Sentences.
 */
export function fileProblems(repo, file) {
  const path = join(repo, file)
  let stat
  try {
    stat = lstatSync(path)
  } catch {
    return [`"file" ${file} does not exist`]
  }
  if (stat.isSymbolicLink()) {
    return [
      `"file" ${file} is a symbolic link: name the file it points to, which is the one that is changed`,
    ]
  }
  if (!stat.isFile()) return [`"file" ${file} is not a file`]
  try {
    const inside = realpathSync(path).startsWith(realpathSync(repo) + sep)
    if (!inside) return [`"file" ${file} resolves to a path outside the repository`]
  } catch {
    return [`"file" ${file} could not be resolved`]
  }
  if (!tracked(repo, file)) {
    return [
      `"file" ${file} is not tracked by git (it is untracked or ignored), so nothing else holds its original: ` +
        'commit it, or name a tracked file',
    ]
  }
  return []
}

/**
 * Everything that can be said about an entry without running anything:
 * its shape, that both files are there and the file is safe to change, that
 * `find` is once, that the title is in the test. The problems, or none.
 */
export function checkEntry(repo, entry) {
  const shape = validateEntry(entry)
  if (shape.length > 0) return shape
  const problems = []
  if (BROWSER_TEST.test(entry.test)) {
    problems.push(
      `"test" is a browser test (${entry.test}): this job runs the unit tests only, until it learns the browser`,
    )
  }
  const unsafe = fileProblems(repo, entry.file)
  problems.push(...unsafe)
  if (unsafe.length === 0) {
    const problem = findProblem(readFileSync(join(repo, entry.file), 'utf8'), entry)
    if (problem !== null) problems.push(problem)
  }
  const testText = readText(repo, entry.test)
  if (testText === null) problems.push(`"test" ${entry.test} does not exist`)
  else if (!titleIn(testText, entry.title)) {
    problems.push(
      `"title" does not appear in ${entry.test}: the test was renamed or the title mistyped, so copy it from the file`,
    )
  }
  return problems
}

function readText(repo, path) {
  try {
    return readFileSync(join(repo, path), 'utf8')
  } catch {
    return null
  }
}

const tail = (text, lines = 3) =>
  String(text ?? '')
    .trim()
    .split('\n')
    .slice(-lines)
    .join(' | ')

/**
 * One Vitest run over `args` with the JSON reporter. On POSIX it is started
 * in a group of its own, so that a timeout ends its workers as well as it
 * (a mutation that loops for ever loops in a worker).
 */
function runVitest(repo, args, outputFile) {
  const vitest = join(repo, 'node_modules', 'vitest', 'vitest.mjs')
  const limit = timeoutMs()
  const started = Date.now()
  const result = spawnSync(
    process.execPath,
    [vitest, 'run', ...args, '--reporter=json', `--outputFile=${outputFile}`],
    {
      cwd: repo,
      encoding: 'utf8',
      windowsHide: true,
      timeout: limit,
      killSignal: 'SIGKILL',
      detached: process.platform !== 'win32',
    },
  )
  const seconds = (Date.now() - started) / 1000
  const timedOut = result.error?.code === 'ETIMEDOUT'
  if (timedOut && process.platform !== 'win32' && result.pid) {
    try {
      process.kill(-result.pid, 'SIGKILL')
    } catch {
      // The group is already gone.
    }
  }
  let report = null
  try {
    report = JSON.parse(readFileSync(outputFile, 'utf8'))
  } catch {
    // The caller's verdict says it.
  }
  return {
    report,
    seconds,
    timedOut,
    limit,
    signal: result.signal,
    status: result.status,
    why: tail(result.error?.message ?? result.stderr),
  }
}

/** The test file whole and unmutated, once per file; `{ clean, why }`. */
function baseline(repo, test, workDir, known) {
  if (known.has(test)) return known.get(test)
  const run = runVitest(repo, [test], join(workDir, `baseline-${known.size}.json`))
  const found = run.timedOut
    ? { clean: false, why: `the unmutated run of ${test} did not finish in ${run.limit / 1000} s` }
    : baselineOf(run.report)
  known.set(test, found)
  return found
}

/** Run one test file filtered by title; the verdict, the seconds, and why where it is not plain. */
function runTest(repo, entry, outputFile) {
  const run = runVitest(repo, [entry.test, '-t', escapeForPattern(entry.title)], outputFile)
  if (run.timedOut) {
    return {
      verdict: 'timed out',
      seconds: run.seconds,
      detail: `no answer in ${run.limit / 1000} s`,
    }
  }
  const verdict = verdictOf(run.report)
  let detail = ''
  if (verdict === 'no test' && run.report.numFailedTestSuites > 0) {
    const reason = String(run.report.testResults?.find((r) => r.message)?.message ?? '')
    detail = `the test file did not load with the mutation in: ${tail(reason, 2)} ${tail(run.why)}`
  }
  if (verdict === 'error') detail = run.why
  return {
    verdict,
    seconds: run.seconds,
    detail: detail.trim(),
    interrupted:
      run.signal === 'SIGINT' || run.signal === 'SIGTERM' || run.status === 130 ? true : undefined,
  }
}

/**
 * Write `original` back to `file` and read it again: the bytes are the ones
 * read before the change, or this throws. Not `git checkout`: that would
 * discard an edit of a person's as well, and a file git does not track would
 * have nothing to restore from.
 */
export function restoreFile(repo, file, original) {
  const path = join(repo, file)
  let why = ''
  try {
    writeFileSync(path, original)
  } catch (error) {
    why = error.message
  }
  let now = null
  try {
    now = readFileSync(path)
  } catch (error) {
    why ||= error.message
  }
  if (now === null || !now.equals(original)) {
    throw new Error(
      `${file} could not be put back as it was${why ? ` (${why})` : ''}: ` +
        'look at it with git diff and put it right by hand; nothing after it would be measured on clean code',
    )
  }
}

/** Apply one entry, run its test, put the file back; the row for the report. */
export function runEntry(repo, entry, workDir, baselines, outputFile) {
  const problems = checkEntry(repo, entry)
  if (problems.length > 0) return { verdict: 'refused', seconds: 0, detail: problems.join('; ') }
  const clean = baseline(repo, entry.test, workDir, baselines)
  if (!clean.clean) return { verdict: 'refused', seconds: 0, detail: clean.why }
  const path = join(repo, entry.file)
  const original = readFileSync(path)
  const mutated = applyMutation(original.toString('utf8'), entry)
  let outcome
  try {
    writeFileSync(path, mutated)
    outcome = runTest(repo, entry, outputFile)
  } finally {
    // Whatever happened above, the file goes back; a failure to do so is
    // the one thing that stops the run.
    restoreFile(repo, entry.file, original)
  }
  return outcome
}

// ---- reports -------------------------------------------------------------

const label = ({ source, index }) => `${source.replace(/^tests\/unit\//, '')}#${index + 1}`

export function table(rows) {
  const head = ['entry', 'test', 'title', 'verdict', 'seconds']
  const cells = rows.map((r) => [r.label, r.test, r.title, r.verdict, r.seconds.toFixed(1)])
  const widths = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)))
  const line = (c) =>
    c
      .map((cell, i) => cell.padEnd(widths[i]))
      .join('  ')
      .trimEnd()
  return [line(head), line(widths.map((w) => '-'.repeat(w))), ...cells.map(line)].join('\n')
}

export function summary(rows) {
  const counts = {}
  for (const r of rows) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1
  const parts = Object.entries(counts).map(([v, n]) => `${n} ${v}`)
  const bad = rows.filter((r) => r.verdict !== 'red').length
  return `${rows.length} mutations: ${parts.join(', ') || 'none'}${bad === 0 ? '' : ` - ${bad} did not go red`}`
}

// Lets a signal that arrived while Vitest ran be delivered: the handlers
// run on the event loop, and a synchronous loop never returns to it.
const tick = () => new Promise((done) => setTimeout(done, 20))

export async function main(args, repo = process.cwd(), out = process.stdout) {
  const say = (text) => out.write(text + '\n')
  const parsed = parseArgs(args)
  if (parsed.error) {
    say(`refused: ${parsed.error}`)
    return 2
  }
  const { entries, unreadable } = loadEntries(repo)
  for (const line of unreadable) say(`refused  ${line}`)

  if (parsed.mode === 'check') {
    let bad = unreadable.length
    for (const item of entries) {
      const problems = checkEntry(repo, item.entry)
      const title = typeof item.entry?.title === 'string' ? item.entry.title : '(no title)'
      if (problems.length === 0) say(`ok       ${label(item)}  ${title}`)
      else {
        bad += 1
        say(`refused  ${label(item)}  ${title}`)
        for (const problem of problems) say(`           - ${problem}`)
      }
    }
    say(`${entries.length} entries checked, ${bad === 0 ? 'all well formed' : `${bad} refused`}`)
    return bad === 0 ? 0 : 1
  }

  if (unreadable.length > 0) return 1
  const { only } = parsed
  const chosen = entries.filter((item) => selected(item.entry, item.source, only))
  if (chosen.length === 0) {
    say(`no entry matches --only ${JSON.stringify(only)}: nothing was run, and that is a failure`)
    return 1
  }
  // The tree under src and tests, and every file an entry that can run names:
  // an edit in any of them would be written over by the mutation's undoing.
  const named = [
    ...new Set(
      chosen
        .filter((item) => checkEntry(repo, item.entry).length === 0)
        .map((item) => item.entry.file),
    ),
  ]
  let dirty
  try {
    dirty = dirtyTree(repo, ['src', 'tests', ...named])
  } catch (error) {
    say(`refused: ${error.message}`)
    return 1
  }
  if (dirty.length > 0) {
    say(`refused: ${dirtyRefusal(dirty)}`)
    return 1
  }

  const workDir = mkdtempSync(join(tmpdir(), 'lc-mutations-'))
  let stopping = null
  const onInt = () => (stopping ??= { name: 'SIGINT', code: 130 })
  const onTerm = () => (stopping ??= { name: 'SIGTERM', code: 143 })
  process.on('SIGINT', onInt)
  process.on('SIGTERM', onTerm)
  const rows = []
  const baselines = new Map()
  try {
    for (const item of chosen) {
      await tick()
      if (stopping !== null) {
        say(table(rows))
        say(
          `STOPPED: ${stopping.name} received; ${rows.length} of ${chosen.length} mutations ran, ` +
            'and every file is as it was',
        )
        return stopping.code
      }
      const entry = item.entry
      const outputFile = join(workDir, `report-${rows.length}.json`)
      let outcome
      try {
        outcome = runEntry(repo, entry, workDir, baselines, outputFile)
      } catch (error) {
        say(table(rows))
        say(`STOPPED: ${error.message}`)
        return 1
      }
      if (outcome.interrupted) stopping ??= { name: 'an interrupt of Vitest', code: 130 }
      const row = {
        label: label(item),
        test: String(entry?.test ?? ''),
        title: String(entry?.title ?? ''),
        verdict: outcome.verdict,
        seconds: outcome.seconds,
        detail: outcome.detail,
      }
      rows.push(row)
      if (outcome.detail)
        process.stderr.write(`${row.label}: ${outcome.verdict}: ${outcome.detail}\n`)
    }
  } finally {
    process.off('SIGINT', onInt)
    process.off('SIGTERM', onTerm)
    rmSync(workDir, { recursive: true, force: true })
  }
  say(table(rows))
  say(summary(rows))
  return rows.every((r) => r.verdict === 'red') ? 0 : 1
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
  const here = resolve(fileURLToPath(import.meta.url), '..', '..')
  process.exitCode = await main(process.argv.slice(2), here)
}
