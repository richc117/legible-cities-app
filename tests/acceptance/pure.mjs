// The acceptance run's pure pieces, shared by the spec
// (tests/acceptance/acceptance.spec.ts, through record.ts) and the
// workflow's CLI (tests/acceptance/record-cli.mjs), so the two cannot drift,
// and unit-tested without an app (tests/unit/acceptance-record.test.ts).
// Plain JavaScript, so `node` runs the CLI on a runner without a build;
// pure.d.mts gives the TypeScript side its types.

import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import process from 'node:process'

/** Every result a step of the record can have. */
export const RESULTS = [
  'pass',
  'fail',
  'not automated',
  'pass, part not automated',
  'pass, part not checked',
  'not run',
]

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A path in every spelling it can take here: as given, through its links, with either separator. */
function spellings(path, realpath) {
  const out = new Set([path])
  try {
    out.add(realpath(path))
  } catch {
    // Not there: the plain spelling is all there is.
  }
  for (const each of [...out]) {
    out.add(each.replace(/\\/g, '/'))
    out.add(each.replace(/\//g, '\\'))
  }
  // Longest first, so a folder inside another is replaced before its parent.
  return [...out].filter((p) => p.length > 1).sort((a, b) => b.length - a.length)
}

/**
 * A function that writes the temporary folder as `<temp>` and the home
 * folder as `~`, in every spelling; without regard to case on Windows. The
 * temporary folder goes first, because on Windows it is inside the home.
 */
export function makeRedact({
  home = homedir(),
  temp = tmpdir(),
  platform = process.platform,
  realpath = realpathSync.native,
} = {}) {
  const flags = platform === 'win32' ? 'gi' : 'g'
  const patterns = [
    ...spellings(temp, realpath).map((p) => [new RegExp(escapeRegExp(p), flags), '<temp>']),
    ...spellings(home, realpath).map((p) => [new RegExp(escapeRegExp(p), flags), '~']),
  ]
  return (text) => patterns.reduce((out, [pattern, word]) => out.replace(pattern, word), text)
}

/** This machine's redaction. */
export const redact = makeRedact()

/** A cell of a Markdown table: redacted, one line, no bare pipe. */
export function cell(text, redactText = redact) {
  return redactText(String(text))
    .replace(/\r?\n+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()
}

/** Step `n`'s row in a rendered record with a new result and notes, its title kept. */
export function fillStep(markdown, n, result, notes, redactText = redact) {
  if (!RESULTS.includes(result)) throw new Error(`${result} is not a result`)
  const row = new RegExp(`^\\| ${n} \\| (.*?) \\| .*\\|$`, 'm')
  if (!row.test(markdown)) throw new Error(`the record has no row for step ${n}`)
  return markdown.replace(
    row,
    (_, title) => `| ${n} | ${title} | ${result} | ${cell(notes, redactText)} |`,
  )
}

/** SHA256SUMS.txt read back: name to lower-case hex, in the form `shasum -c` reads. */
export function parseSums(text) {
  const sums = new Map()
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line)
    if (match !== null) sums.set(match[2], match[1])
  }
  return sums
}

/**
 * Whether a log file that was not there before the run is the run's to
 * remove: its first stamped line is at or after `since`, or it has none. A
 * `main.log` near its cap rotates into a `main.old.log` that did not exist,
 * and its lines then begin before the run (scripts/launch-packaged.mjs).
 */
export function writtenSince(path, since) {
  let contents
  try {
    contents = readFileSync(path, 'utf8')
  } catch {
    return false
  }
  for (const line of contents.split(/\r?\n/)) {
    const stamp = Date.parse(line.slice(0, line.indexOf(' ')))
    if (Number.isFinite(stamp)) return stamp >= since
  }
  return true
}

/**
 * Whether `tag` contains `commit`: true or false, or null when there is no
 * tag or git cannot tell - a shallow clone, a tag or a commit this clone
 * does not have, no git at all. `run` is spawnSync, replaced in a test.
 */
export function tagContains({ tag, commit, cwd, run = spawnSync }) {
  if (tag === '' || tag === undefined) return null
  const options = { cwd, encoding: 'utf8', timeout: 30_000, windowsHide: true }
  const shallow = run('git', ['rev-parse', '--is-shallow-repository'], options)
  if (shallow.status !== 0 || String(shallow.stdout).trim() !== 'false') return null
  const result = run('git', ['merge-base', '--is-ancestor', commit, `refs/tags/${tag}`], options)
  if (result.status === 0) return true
  if (result.status === 1) return false
  return null
}
