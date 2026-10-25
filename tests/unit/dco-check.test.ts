// The sign-off rule (issue 516, ADR-058): which commits of a pull request
// pass without a `Signed-off-by:` line of their author's and which fail.
// Each clause of the rule has a row that passes through it and a row that
// would pass through it but for one thing. The last blocks run the script
// itself over a file, because the verdict is only as good as the shape of the
// list it is handed. Nothing here talks to GitHub.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '../..')
const SCRIPT = join(repo, 'scripts', 'dco-check.mjs')

interface Commit {
  sha: string
  commit: { message: string; author: { name: string; email: string } }
  author: { login: string; type: string } | null
  parents: { sha: string }[]
}
interface Offender {
  sha: string
  subject: string
  reason: string
}
interface Module {
  LISTING_LIMIT: number
  signOffs(message: string): { name: string; email: string }[]
  exemption(commit: Commit, owner: string): string | null
  judge(input: { commits: Commit[]; owner: string }): Offender[]
  report(input: { commits: Commit[]; offenders: Offender[] }): string
  parseCommits(text: string): Commit[]
}
// A URL built at run time, so the type checker does not look for
// declarations of a plain JavaScript module.
const load = (): Promise<Module> => import(pathToFileURL(SCRIPT).href) as Promise<Module>

const OWNER = 'the-owner'
const NAME = 'Ada Lovelace'
// Addresses built here are not personal ones: the never list is read over
// this file too.
const NOREPLY = '1234+ada@users.noreply.github.com'
const OTHER_NOREPLY = '9876+someone-else@users.noreply.github.com'

interface Spec {
  message?: string
  name?: string
  email?: string
  login?: string | null
  type?: string
  parents?: number
}
let counter = 0
function commit(spec: Spec = {}): Commit {
  counter += 1
  const login = spec.login === undefined ? 'ada' : spec.login
  return {
    sha: `${String(counter).padStart(2, '0')}abcdef0123456789abcdef0123456789abcdef`,
    commit: {
      message: spec.message ?? 'Add a thing\n\nWhy it was done.\n',
      author: { name: spec.name ?? NAME, email: spec.email ?? NOREPLY },
    },
    author: login === null ? null : { login, type: spec.type ?? 'User' },
    parents: Array.from({ length: spec.parents ?? 1 }, (_, i) => ({ sha: `p${i}` })),
  }
}
const signed = (name: string, email: string, extra = ''): string =>
  `Add a thing\n\nWhy it was done.\n\n${extra}Signed-off-by: ${name} <${email}>\n`

describe('the sign-off rule', () => {
  // [name, the commit, does it pass]
  const table: [string, Commit, boolean][] = [
    // A sign-off by name.
    [
      'a sign-off with the author name and address',
      commit({ message: signed(NAME, NOREPLY) }),
      true,
    ],
    [
      'a sign-off by name, with another address',
      commit({ message: signed(NAME, OTHER_NOREPLY), email: 'ada@example.org' }),
      true,
    ],
    [
      'a sign-off by name, in another case and with spaces around it',
      commit({ message: signed('  ada LOVELACE ', OTHER_NOREPLY), email: 'ada@example.org' }),
      true,
    ],
    [
      'a sign-off for someone else, by another name and address',
      commit({ message: signed('Grace Hopper', OTHER_NOREPLY), email: 'ada@example.org' }),
      false,
    ],
    // A sign-off by address.
    [
      'a sign-off by address, with another name',
      commit({ message: signed('A. Lovelace', NOREPLY), email: NOREPLY }),
      true,
    ],
    [
      'a sign-off by address, in another case',
      commit({ message: signed('A. Lovelace', NOREPLY.toUpperCase()), email: NOREPLY }),
      true,
    ],
    [
      'a sign-off by another name and a different address',
      commit({ message: signed('A. Lovelace', OTHER_NOREPLY), email: NOREPLY }),
      false,
    ],
    // What a sign-off line is.
    ['no sign-off at all', commit(), false],
    [
      'a Signed-off-by with no address',
      commit({ message: `Add a thing\n\nSigned-off-by: ${NAME}\n` }),
      false,
    ],
    [
      'a sign-off among other trailers',
      commit({
        message: signed(
          NAME,
          NOREPLY,
          'Co-Authored-By: Grace Hopper <h@users.noreply.github.com>\n',
        ),
      }),
      true,
    ],
    [
      'a sign-off by someone else beside the author own',
      commit({
        message: `Add a thing\n\nSigned-off-by: Grace Hopper <${OTHER_NOREPLY}>\nSigned-off-by: ${NAME} <${NOREPLY}>\n`,
      }),
      true,
    ],
    [
      'a Co-Authored-By with the author name is not a sign-off',
      commit({ message: `Add a thing\n\nCo-Authored-By: ${NAME} <${NOREPLY}>\n` }),
      false,
    ],
    [
      'a sign-off with Windows line endings',
      commit({ message: `Add a thing\r\n\r\nSigned-off-by: ${NAME} <${NOREPLY}>\r\n` }),
      true,
    ],
    // No linked account.
    [
      'no linked account, signed off',
      commit({ login: null, message: signed(NAME, NOREPLY) }),
      true,
    ],
    ['no linked account, not signed off', commit({ login: null }), false],
    // A merge commit.
    ['a merge commit', commit({ parents: 2 }), true],
    ['a commit with one parent', commit({ parents: 1 }), false],
    ['a commit with no parent', commit({ parents: 0 }), false],
    // A bot.
    ['a bot by type', commit({ login: 'dependabot', type: 'Bot' }), true],
    ['a bot by login', commit({ login: 'dependabot[bot]', type: 'User' }), true],
    ['a user whose login only contains bot', commit({ login: 'bot-lover', type: 'User' }), false],
    ['a user whose login starts with a bracket pair', commit({ login: '[bot]x' }), false],
    // The owner.
    ['the owner', commit({ login: OWNER }), true],
    ['the owner, in another case', commit({ login: 'The-Owner' }), true],
    ['someone else than the owner', commit({ login: 'the-owner-two' }), false],
  ]

  it.each(table)('%s', async (_name, one, passes) => {
    const { judge } = await load()
    const offenders = judge({ commits: [one], owner: OWNER })
    expect(offenders.length === 0).toBe(passes)
    if (!passes) expect(offenders[0]!.sha).toBe(one.sha.slice(0, 7))
  })

  it('exempts nobody as the owner when the owner is empty', async () => {
    const { judge } = await load()
    expect(judge({ commits: [commit({ login: '' })], owner: '' })).toHaveLength(1)
    expect(judge({ commits: [commit({ login: null })], owner: '' })).toHaveLength(1)
  })

  it('does not let an empty name or address match an empty one', async () => {
    const { judge } = await load()
    const empty = commit({ name: '', email: '', message: 'Add a thing\n\nSigned-off-by:  <>\n' })
    expect(judge({ commits: [empty], owner: OWNER })).toHaveLength(1)
  })

  it('names the commits that fail, by short id and subject, and only those', async () => {
    const { judge } = await load()
    const good = commit({ message: signed(NAME, NOREPLY) })
    const bad = commit({ message: 'Fix the thing\n\nBody.\n' })
    const wrong = commit({
      message: 'Fix another\n\n' + `Signed-off-by: Grace Hopper <${OTHER_NOREPLY}>\n`,
      email: 'ada@example.org',
    })
    const offenders = judge({ commits: [good, bad, wrong], owner: OWNER })
    expect(offenders.map((o) => [o.sha, o.subject])).toEqual([
      [bad.sha.slice(0, 7), 'Fix the thing'],
      [wrong.sha.slice(0, 7), 'Fix another'],
    ])
    expect(offenders[0]!.reason).toContain('no Signed-off-by')
    expect(offenders[1]!.reason).toContain("not the author's")
  })

  it('says how to fix a branch, and what the line should carry', async () => {
    const { judge, report } = await load()
    const commits = [
      commit({ message: 'Fix the thing\n' }),
      commit({ message: signed(NAME, NOREPLY) }),
    ]
    const text = report({ commits, offenders: judge({ commits, owner: OWNER }) })
    expect(text).toContain('1 of 2 commits')
    expect(text).toContain('"Fix the thing"')
    expect(text).toContain('git commit --amend -s')
    expect(text).toContain('git rebase --signoff origin/main')
    expect(text).toContain('git push --force-with-lease')
    expect(text).toContain('users.noreply.github.com')
    expect(text).toContain('https://developercertificate.org/')
  })

  it('prints a subject that looks like a workflow command as data', async () => {
    const { judge, report } = await load()
    const commits = [commit({ message: '::error::pretend\n' })]
    const text = report({ commits, offenders: judge({ commits, owner: OWNER }) })
    expect(text).toContain('"::error::pretend"')
    expect(text.split('\n').some((line) => line.startsWith('::'))).toBe(false)
  })
})

describe('reading the list', () => {
  it('flattens the pages gh writes with --slurp, and takes one plain list', async () => {
    const { parseCommits } = await load()
    const a = commit()
    const b = commit()
    expect(parseCommits(JSON.stringify([[a], [b]]))).toEqual([a, b])
    expect(parseCommits(JSON.stringify([a, b]))).toEqual([a, b])
  })

  it('refuses what is not a list of commits', async () => {
    const { parseCommits } = await load()
    for (const text of ['', '{', '{"message":"Not Found"}', '"x"', '[1]', '[null]', '[[1]]']) {
      expect(() => parseCommits(text), text).toThrow()
    }
  })
})

describe('the script', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dco-check-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  let n = 0
  function run(content: string | null, owner: string | null = OWNER) {
    const file = join(dir, `commits-${(n += 1)}.json`)
    if (content !== null) writeFileSync(file, content)
    const args = [SCRIPT, '--commits', file]
    if (owner !== null) args.push('--owner', owner)
    const r = spawnSync(process.execPath, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
    })
    return { code: r.status, out: r.stdout, err: r.stderr }
  }

  it('exits 0 and says so when every commit passes', () => {
    const r = run(
      JSON.stringify([[commit({ message: signed(NAME, NOREPLY) }), commit({ login: OWNER })]]),
    )
    expect(r.code).toBe(0)
    expect(r.out).toContain('2 commits, each signed off or exempt')
  })

  it('exits 1 and names the commit when one fails', () => {
    const bad = commit({ message: 'Fix the thing\n' })
    const r = run(JSON.stringify([[bad]]))
    expect(r.code).toBe(1)
    expect(r.err).toContain(bad.sha.slice(0, 7))
    expect(r.err).toContain('git rebase --signoff')
  })

  it('exits 2, judging nothing, for input it cannot read', () => {
    expect(run('not json').code).toBe(2)
    expect(run(null).code).toBe(2)
    expect(run('[]').code).toBe(2)
    expect(run('[[]]').code).toBe(2)
    expect(run('[]', null).code).toBe(2)
  })

  it('exits 2 for a list as long as the most GitHub will list', async () => {
    const { LISTING_LIMIT } = await load()
    const many = Array.from({ length: LISTING_LIMIT }, () => commit({ login: OWNER }))
    const r = run(JSON.stringify([many]))
    expect(r.code).toBe(2)
    expect(r.err).toContain('not all can be judged')
    const fewer = Array.from({ length: LISTING_LIMIT - 1 }, () => commit({ login: OWNER }))
    expect(run(JSON.stringify([fewer])).code).toBe(0)
  })
})
