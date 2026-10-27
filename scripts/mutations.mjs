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
// is applied to a clean tree, its test is run, the file is restored from
// git and the restore is checked against the bytes read before. A verdict
// is one of
//
//   red       at least one test ran and one failed: the mutation bites
//   green     tests ran and none failed: the test has gone vacuous
//   no test   `title` matched no test (or the test file would not load)
//   error     the run produced no report we can read
//   refused   the entry cannot be applied (find not once, file missing, ...)
//   timed out Vitest did not finish in time
//
// and the exit status is 0 only where every entry is red. A restore that
// does not take stops the whole run with the file named, since nothing
// after it would be measured on clean code.
//
// Every decision is a function the unit test calls
// (tests/unit/mutations-runner.test.ts); the file and process work is
// behind `main`, which runs only when this is the entry point.

import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const FIELDS = ['file', 'find', 'replace', 'test', 'title', 'why']
// The suite's `testTimeout` is 30 s; a filtered run of one file starts
// Vitest, loads the file and runs a few tests.
export const RUN_TIMEOUT_MS = 120_000
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

/** Whether an entry matches `--only`: a substring of its file, test, title or mutations file. */
export function selected(entry, source, only) {
  if (only === undefined || only === '') return true
  const texts = [entry?.file, entry?.test, entry?.title, source]
  return texts.some((s) => typeof s === 'string' && s.includes(only))
}

/** The sentence the dirty-tree refusal is, from `git status --porcelain` lines. */
export function dirtyRefusal(lines) {
  return (
    'the tree under src and tests is not clean, and a mutation applied on top of an edit ' +
    'would be restored over it: commit or stash these first\n' +
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

/**
 * Everything that can be said about an entry without running anything:
 * its shape, that both files are there, that `find` is once, that the title
 * is in the test. The problems, or none.
 */
export function checkEntry(repo, entry) {
  const shape = validateEntry(entry)
  if (shape.length > 0) return shape
  const problems = []
  if (BROWSER_TEST.test(entry.test)) {
    problems.push(
      `"test" is a browser test (${entry.test}): this job runs the unit project only, until it learns the browser`,
    )
  }
  const sourceText = readText(repo, entry.file)
  if (sourceText === null) problems.push(`"file" ${entry.file} does not exist`)
  else {
    const problem = findProblem(sourceText, entry)
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

/** Run one test file filtered by title with the JSON reporter; the verdict and the seconds it took. */
function runTest(repo, entry, outputFile) {
  const vitest = join(repo, 'node_modules', 'vitest', 'vitest.mjs')
  const base = ['run', entry.test, '-t', escapeForPattern(entry.title)]
  const tail = ['--reporter=json', `--outputFile=${outputFile}`]
  const started = Date.now()
  const attempt = (project) =>
    spawnSync(process.execPath, [vitest, ...base, ...project, ...tail], {
      cwd: repo,
      encoding: 'utf8',
      windowsHide: true,
      timeout: RUN_TIMEOUT_MS,
    })
  // The unit project is the one that runs without a browser. A configuration
  // that names no projects has only the one, so it is run without the filter.
  let result = attempt(['--project', 'unit'])
  if (/No projects matched/.test(`${result.stderr}${result.stdout}`)) result = attempt([])
  const seconds = (Date.now() - started) / 1000
  if (result.error && result.error.code === 'ETIMEDOUT') {
    return { verdict: 'timed out', seconds, detail: `no answer in ${RUN_TIMEOUT_MS / 1000} s` }
  }
  let report = null
  try {
    report = JSON.parse(readFileSync(outputFile, 'utf8'))
  } catch {
    // The verdict says it.
  }
  let verdict = verdictOf(report)
  let detail = ''
  if (verdict === 'no test' && report.numFailedTestSuites > 0) {
    detail = 'the test file did not load with the mutation in'
  }
  if (verdict === 'error') {
    detail = (result.error?.message ?? result.stderr ?? '').trim().split('\n').slice(-3).join(' | ')
  }
  return { verdict, seconds, detail }
}

/** Put `file` back from git and prove the bytes are the ones read before. Throws if not. */
function restore(repo, entry, original) {
  const result = git(repo, ['checkout', '--', entry.file])
  let now = null
  try {
    now = readFileSync(join(repo, entry.file))
  } catch {
    // Compared below.
  }
  if (result.status !== 0 || now === null || !now.equals(original)) {
    throw new Error(
      `${entry.file} could not be restored to what it was (${gitWhy(result)}): ` +
        'stop here and run git checkout -- ' +
        `${entry.file} by hand; nothing after it would be measured on clean code`,
    )
  }
}

/** Apply one entry, run its test, restore; the row for the report. */
export function runEntry(repo, entry, outputFile) {
  const problems = checkEntry(repo, entry)
  if (problems.length > 0) return { verdict: 'refused', seconds: 0, detail: problems.join('; ') }
  const path = join(repo, entry.file)
  const original = readFileSync(path)
  const mutated = applyMutation(original.toString('utf8'), entry)
  inFlight = { repo, entry, original }
  let outcome
  try {
    writeFileSync(path, mutated)
    outcome = runTest(repo, entry, outputFile)
  } finally {
    // Whatever happened above, the file goes back; a failure to do so is
    // the one thing that stops the run.
    restore(repo, entry, original)
    inFlight = null
  }
  return outcome
}

// What a signal must put back, since the child runs while this process blocks.
let inFlight = null
function restoreInFlight() {
  if (inFlight === null) return
  const { repo, entry, original } = inFlight
  inFlight = null
  try {
    restore(repo, entry, original)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
  }
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

function option(args, name) {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}

export function main(args, repo = process.cwd(), out = process.stdout) {
  const say = (text) => out.write(text + '\n')
  const { entries, unreadable } = loadEntries(repo)
  for (const line of unreadable) say(`refused  ${line}`)

  if (args.includes('--check')) {
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
  const only = option(args, '--only')
  const chosen = entries.filter((item) => selected(item.entry, item.source, only))
  if (chosen.length === 0) {
    say(`no entry matches --only ${JSON.stringify(only)}: nothing was run, and that is a failure`)
    return 1
  }
  let dirty
  try {
    dirty = dirtyTree(repo)
  } catch (error) {
    say(`refused: ${error.message}`)
    return 1
  }
  if (dirty.length > 0) {
    say(`refused: ${dirtyRefusal(dirty)}`)
    return 1
  }

  const workDir = mkdtempSync(join(tmpdir(), 'lc-mutations-'))
  process.on('SIGINT', () => {
    restoreInFlight()
    process.exit(130)
  })
  process.on('SIGTERM', () => {
    restoreInFlight()
    process.exit(143)
  })
  const rows = []
  try {
    for (const item of chosen) {
      const entry = item.entry
      const outputFile = join(workDir, `report-${rows.length}.json`)
      let outcome
      try {
        outcome = runEntry(repo, entry, outputFile)
      } catch (error) {
        say(table(rows))
        say(`STOPPED: ${error.message}`)
        return 1
      }
      const row = {
        label: label(item),
        test: String(entry?.test ?? ''),
        title: String(entry?.title ?? ''),
        ...outcome,
      }
      rows.push(row)
      if (outcome.detail)
        process.stderr.write(`${row.label}: ${outcome.verdict}: ${outcome.detail}\n`)
    }
  } finally {
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
  process.exitCode = main(process.argv.slice(2), here)
}
