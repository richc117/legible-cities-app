// Decide whether a pull request has to run the end-to-end suite
// (specs/038-test-pyramid, FR-003, research R2 and R3).
//
//   node scripts/ci-decide.mjs --event <name> [--base <sha> --head <sha>] [--repo <dir>]
//
// `e2e (<os>)` is a required check, and a required check that never starts
// blocks the merge for ever, so the job always starts and this script is its
// first step: it prints the paths it judged and the rule that matched, and
// writes `run=true` or `run=false` to the file GITHUB_OUTPUT names. Every
// later step of the job is gated on that output.
//
// The rule is a denylist, so that it fails closed. A pull request skips the
// suite only when EVERY changed path matches an entry below. Anything else
// runs it: a path on no entry, a new kind of file, an empty diff, a push, an
// event this script does not know, and a diff it could not compute (that
// last one with a warning, since a skip nobody can audit is the failure to
// avoid). The paths come from `git diff --name-only -z --no-renames`: with
// renames on, git lists only the new name of a moved file, and moving
// `src/a.ts` to `docs/a.md` would read as documentation only.
//
// Every decision is a function the unit test calls
// (tests/unit/ci-decide.test.ts); nothing here talks to GitHub.

import { spawnSync } from 'node:child_process'
import { appendFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// The paths that cannot change what the end-to-end suite sees: prose, the
// project's records, the assistant's rules, the issue templates. Each entry
// has a name, which the log prints, and a test over a path as git prints it
// (forward slashes, relative to the repository's top).
export const DENYLIST = [
  { name: '*.md anywhere', matches: (p) => p.endsWith('.md') },
  { name: 'docs/**', matches: (p) => p.startsWith('docs/') },
  { name: 'specs/**', matches: (p) => p.startsWith('specs/') },
  { name: '.github/ISSUE_TEMPLATE/**', matches: (p) => p.startsWith('.github/ISSUE_TEMPLATE/') },
  { name: 'LICENSE', matches: (p) => p === 'LICENSE' },
  { name: '.claude/**', matches: (p) => p.startsWith('.claude/') },
]

export const SKIP_NOTICE = 'documentation only; the end-to-end suite did not run'

// event: the workflow's event name. changed: the changed paths, or null when
// they could not be listed. denylist: a parameter so the test can take one
// entry away and watch the verdict change.
export function decide({ event, changed, denylist = DENYLIST }) {
  const judged = (changed ?? []).map((path) => ({
    path,
    rule: denylist.find((entry) => entry.matches(path))?.name ?? null,
  }))
  const verdict = (run, rule) => ({ event, changed: changed ?? [], judged, run, rule })

  if (event !== 'pull_request') {
    return verdict(true, `${event || 'an unknown event'}: the suite always runs`)
  }
  if (changed === null)
    return verdict(true, 'the changed paths could not be listed: the suite runs')
  if (changed.length === 0) return verdict(true, 'no changed paths: the suite runs')
  const outside = judged.find((entry) => entry.rule === null)
  if (outside !== undefined) {
    return verdict(true, `${outside.path} is on no documentation entry: the suite runs`)
  }
  return verdict(false, 'every changed path is on the documentation list: the suite is skipped')
}

// The paths between a pull request's base and its head, or null when git
// cannot list them (a shallow checkout, a commit it does not have).
export function changedPaths({ base, head, repo }) {
  if (!base || !head) return null
  const result = spawnSync(
    'git',
    ['diff', '--name-only', '-z', '--no-renames', `${base}...${head}`],
    { cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 60_000 },
  )
  if (result.error || result.status !== 0) return null
  return result.stdout.split('\0').filter((path) => path !== '')
}

export function report(decision) {
  const lines = [
    `event: ${decision.event || '(none)'}`,
    `changed paths: ${decision.changed.length}`,
    ...decision.judged.map(
      (entry) => `  ${entry.path}  ->  ${entry.rule ?? 'not on the documentation list'}`,
    ),
    `rule: ${decision.rule}`,
    `docsOnly: ${!decision.run}`,
    `ran: ${decision.run}`,
  ]
  if (!decision.run) lines.push(`::notice title=e2e::${SKIP_NOTICE}`)
  return lines.join('\n') + '\n'
}

function option(args, name) {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}

export function main(args, env = process.env) {
  const event = option(args, '--event') ?? ''
  const repo = option(args, '--repo') ?? process.cwd()
  const base = option(args, '--base')
  const head = option(args, '--head')
  const changed = event === 'pull_request' ? changedPaths({ base, head, repo }) : []
  if (event === 'pull_request' && changed === null) {
    process.stdout.write(
      `::warning::git could not list the paths between ${base} and ${head}; the suite will run\n`,
    )
  }
  const decision = decide({ event, changed })
  process.stdout.write(report(decision))
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `run=${decision.run}\n`)
  return 0
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
if (invokedDirectly()) process.exitCode = main(process.argv.slice(2))
