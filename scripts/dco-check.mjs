// The sign-off rule for a pull request's commits (issue 516, ADR-058).
//
//   node scripts/dco-check.mjs --owner <login> --commits <file>
//
// A contribution to this repository carries a Developer Certificate of
// Origin 1.1 sign-off: a `Signed-off-by: Name <address>` line in the message
// of every commit the pull request adds (`git commit -s`). The file is what
// `gh api --paginate --slurp repos/{owner}/{repo}/pulls/{n}/commits` writes:
// the pull request's commits as GitHub's REST API returns them, in a list of
// pages. A single page (one plain list) is read as well.
//
// A commit passes when it is one of these, and fails otherwise:
//   - a merge commit (more than one parent);
//   - authored by a bot (`author.type` is "Bot", or the login ends in
//     "[bot]"): a bot certifies nothing and has no name to sign;
//   - authored by the repository owner, whose login is passed in: the
//     maintainer certifies nothing to himself (the DCO app's option that
//     members need not sign off is the precedent);
//   - carrying a `Signed-off-by:` line whose name is the commit author's
//     name (trimmed, case-insensitive) or whose address is the author's
//     address. The name is matched because the author's address may be a
//     personal one, which `bin/preflight` refuses in a message: the sign-off
//     can then carry the GitHub no-reply address and still be the author's.
// A commit with no linked GitHub account (`author` is null) is judged on its
// sign-off alone.
//
// This is an attestation, not a lock. The author fields are whatever git was
// told, and GitHub links a commit to an account by its address, so the
// exemptions can be claimed by a commit that says so. The maintainer reads
// every pull request; the check is there so that nobody certifies by
// accident, or fails to by accident (ADR-058).
//
// The rule is a function the unit test calls (tests/unit/dco-check.test.ts);
// nothing here talks to GitHub.

import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// GitHub's pull request commits endpoint lists at most 250 commits, and says
// nothing when it stops there. A list that long cannot be judged whole.
export const LISTING_LIMIT = 250

const SIGN_OFF = /^Signed-off-by:[ \t]*(.*?)[ \t]*<([^<>]*)>[ \t]*$/i

// Every sign-off in a message, as { name, email }. A line anywhere in the
// message counts, the way the DCO app reads one.
export function signOffs(message) {
  const found = []
  for (const line of String(message ?? '').split(/\r?\n/)) {
    const m = SIGN_OFF.exec(line)
    if (m) found.push({ name: m[1], email: m[2] })
  }
  return found
}

const same = (a, b) => {
  const x = String(a ?? '')
    .trim()
    .toLowerCase()
  const y = String(b ?? '')
    .trim()
    .toLowerCase()
  return x !== '' && x === y
}

// Why a commit is let through, or null when it is not. `owner` is the
// repository owner's login; an empty one exempts nobody.
export function exemption(commit, owner) {
  if ((commit.parents ?? []).length > 1) return 'a merge commit'
  const login = commit.author?.login ?? ''
  if (commit.author?.type === 'Bot' || login.toLowerCase().endsWith('[bot]')) return 'a bot'
  if (same(login, owner)) return "the repository owner's"
  const author = commit.commit?.author ?? {}
  for (const line of signOffs(commit.commit?.message)) {
    if (same(line.name, author.name)) return 'signed off by name'
    if (same(line.email, author.email)) return 'signed off by address'
  }
  return null
}

// The commits that fail, each as { sha, subject, reason }.
export function judge({ commits, owner }) {
  const offenders = []
  for (const commit of commits) {
    if (exemption(commit, owner) !== null) continue
    const message = String(commit.commit?.message ?? '')
    const lines = signOffs(message)
    offenders.push({
      sha: String(commit.sha ?? '').slice(0, 7),
      subject: message.split(/\r?\n/, 1)[0] ?? '',
      reason:
        lines.length === 0
          ? 'has no Signed-off-by line'
          : "has a Signed-off-by line, but not the author's: neither its name nor its address is the commit author's",
    })
  }
  return offenders
}

export const HOW_TO_FIX = [
  'Every commit a pull request adds carries a Developer Certificate of Origin',
  'sign-off (https://developercertificate.org/): a line',
  '',
  '  Signed-off-by: Your Name <id+username@users.noreply.github.com>',
  '',
  'To add it:',
  '  git commit --amend -s --no-edit          the last commit',
  '  git rebase --signoff origin/main         every commit on the branch',
  'then push the branch again with:',
  '  git push --force-with-lease',
  '',
  'Use your GitHub no-reply address (Settings, Emails), set with',
  '`git config user.email` before you sign: a sign-off is public for good, and',
  'bin/preflight refuses a personal address in a message. The name on the line',
  "must be the commit author's name, or the address its author's.",
  "A merge commit, a bot's commit and the maintainer's own are exempt.",
  'CONTRIBUTING.md, "Commits", has the rest.',
].join('\n')

export function report({ commits, offenders }) {
  if (offenders.length === 0) {
    return `dco: ${commits.length} commit${commits.length === 1 ? '' : 's'}, each signed off or exempt\n`
  }
  const lines = [
    `dco: ${offenders.length} of ${commits.length} commits lack a sign-off of their author's:`,
    // JSON.stringify keeps a subject that looks like a workflow command
    // (`::set-output`) from issuing one.
    ...offenders.map((o) => `  ${o.sha}  ${JSON.stringify(o.subject)}  ${o.reason}`),
    '',
    HOW_TO_FIX,
  ]
  return lines.join('\n') + '\n'
}

// The commits out of the file's text. `gh api --paginate --slurp` writes a
// list of pages, each a list of commits; one plain list is a single page.
// Anything else throws: a verdict is never given about what was not read.
export function parseCommits(text) {
  const parsed = JSON.parse(text)
  if (!Array.isArray(parsed)) throw new Error('the commits are not a JSON list')
  const commits = parsed.every(Array.isArray) ? parsed.flat() : parsed
  for (const commit of commits) {
    if (commit === null || typeof commit !== 'object' || Array.isArray(commit)) {
      throw new Error('an entry in the commits is not a commit object')
    }
  }
  return commits
}

function option(args, name) {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}

export function main(args, out = process.stdout, err = process.stderr) {
  const file = option(args, '--commits')
  const owner = option(args, '--owner')
  if (file === undefined || owner === undefined) {
    err.write('usage: dco-check --owner <login> --commits <file>\n')
    return 2
  }
  let commits
  try {
    commits = parseCommits(readFileSync(file, 'utf8'))
  } catch (e) {
    err.write(`dco: the pull request's commits could not be read: ${e.message}\n`)
    return 2
  }
  if (commits.length === 0) {
    err.write('dco: the pull request lists no commits, so nothing was judged\n')
    return 2
  }
  if (commits.length >= LISTING_LIMIT) {
    err.write(
      `dco: the pull request has ${commits.length} commits and GitHub lists at most ${LISTING_LIMIT}, so not all can be judged\n`,
    )
    return 2
  }
  const offenders = judge({ commits, owner })
  const text = report({ commits, offenders })
  ;(offenders.length === 0 ? out : err).write(text)
  return offenders.length === 0 ? 0 : 1
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
