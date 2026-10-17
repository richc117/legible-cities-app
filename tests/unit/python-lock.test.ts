// The bundled runtime's lock (issue 434). vendor/python-requirements.txt is
// the engine's uv.lock exported at the pinned tag; vendor/pins.json names it
// by its hash, the engine by its commit and pip by its version and wheel
// hash; and scripts/lock-python.sh refuses to write it from any checkout but
// a clean one at that tag and commit. The vendor job proves the install and
// scripts/check-vendored.mjs the runtime (tests/unit/check-vendored.test.ts);
// this holds the committed files to each other on every machine that runs
// the unit tests, where there is no engine and no uv.
//
// The script's refusals are run against fixture repositories, with git and
// bash; that block skips on Windows, where the script is never run, and
// where either is not on PATH, saying which in its title.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '../..')
const pins = JSON.parse(readFileSync(join(repo, 'vendor', 'pins.json'), 'utf8'))
const MANIFEST_PATH = join(repo, 'vendor', 'python-requirements.txt')
const MANIFEST = readFileSync(MANIFEST_PATH)
const TEXT = MANIFEST.toString('utf8')
const SCRIPT = join(repo, 'scripts', 'lock-python.sh')

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')

/** The manifest's requirements, each continued line joined, comments gone: read here, not by the script under test. */
const requirements = (): string[] =>
  TEXT.replace(/\\\n\s*/g, ' ')
    .split('\n')
    .map((line) =>
      line
        .replace(/(^|\s)#.*$/, '')
        .replace(/[ \t]+/g, ' ')
        .trim(),
    )
    .filter((line) => line !== '')

describe('vendor/python-requirements.txt', () => {
  it('is the file python.requirements.sha256 names', () => {
    expect(pins.python.requirements.sha256, 'a 64-character SHA-256').toMatch(/^[0-9a-f]{64}$/)
    expect(
      sha256(MANIFEST),
      'the manifest and python.requirements.sha256 disagree: regenerate it with scripts/lock-python.sh and move the pin with it',
    ).toBe(pins.python.requirements.sha256)
  })

  it("names the pinned engine's repository, tag and commit, and how it is written", () => {
    expect(TEXT).toContain(`#   engine  ${pins.engine.repo}\n`)
    expect(TEXT).toContain(`#   tag     ${pins.engine.tag}\n`)
    expect(TEXT).toContain(`#   commit  ${pins.engine.commit}\n`)
    expect(TEXT).toContain('#   scripts/lock-python.sh <engine-checkout>\n')
    expect(TEXT).toContain('#    uv export --frozen --no-dev --hashes --no-emit-project\n')
  })

  it("pins every package to one version with its sha256 hashes, the engine's three dependencies among them", () => {
    const lines = requirements()
    expect(lines.length).toBeGreaterThan(5)
    for (const line of lines) {
      expect(line).toMatch(
        /^[A-Za-z0-9][A-Za-z0-9._-]*==[A-Za-z0-9.!+_-]+( ; [^-]+?)?( --hash=sha256:[0-9a-f]{64})+$/,
      )
    }
    const names = lines.map((line) => line.slice(0, line.indexOf('==')).toLowerCase())
    for (const name of ['pandas', 'python-lsp-jsonrpc', 'requests']) expect(names).toContain(name)
    // The engine is built from its commit and installed alone; pip has a
    // pin of its own. Neither is the lock's to name.
    expect(names).not.toContain('openschematicmaps')
    expect(names).not.toContain('pip')
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('vendor/pins.json, for the lock', () => {
  // Measured with `git rev-parse v0.18.0^{commit}` in the engine's own
  // repository and with `gh api repos/richc117/legible-cities/git/ref/tags/v0.18.0`
  // on 16 Oct 2026. The manifest test above holds its header to whatever
  // the pins say, so only a value measured elsewhere catches a commit
  // copied wrong into both. A pin that moves edits this too.
  it("names the commit engine v0.18.0's tag names", () => {
    expect(pins.engine.tag).toBe('v0.18.0')
    expect(pins.engine.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(pins.engine.commit).toBe('996c1a01ba049dcd4aa27d6816185c8dcb31c085')
  })

  it('pins pip to one version, by the hash of its wheel', () => {
    expect(pins.python.pip.version).toMatch(/^\d+(\.\d+)+$/)
    expect(pins.python.pip.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(typeof pins.python.pip.note).toBe('string')
    expect(typeof pins.python.requirements.note).toBe('string')
  })
})

function works(command: string, args: string[]): boolean {
  const run = spawnSync(command, args, { stdio: 'ignore', timeout: 10_000, windowsHide: true })
  return run.status === 0
}
const lacking =
  process.platform === 'win32'
    ? []
    : [
        ['bash', '--version'],
        ['git', '--version'],
      ]
        .filter(([command, flag]) => !works(command, [flag]))
        .map(([command]) => command)
const missing =
  process.platform === 'win32'
    ? 'the script is bash, run by a person moving the pin, never on Windows'
    : lacking.length > 0
      ? `${lacking.join(', ')} not on PATH`
      : ''
const WHY = missing ? ` (skipped: ${missing})` : ''

describe.skipIf(missing !== '')(
  `scripts/lock-python.sh refuses before it writes anything${WHY}`,
  () => {
    const made: string[] = []
    afterEach(() => {
      for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
    })

    /** A fixture engine checkout: a pyproject.toml and a uv.lock, committed, tagged as the pin's tag where asked. */
    function engine(options: { tag?: boolean; after?: boolean } = {}) {
      const root = mkdtempSync(join(tmpdir(), 'lc-lock-python-'))
      made.push(root)
      const hooks = join(root, 'no-hooks')
      mkdirSync(hooks)
      const dir = join(root, 'engine')
      mkdirSync(dir)
      const git = (...args: string[]): string => {
        const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 30_000 })
        if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
        return result.stdout.trim()
      }
      git('init', '--quiet', '--initial-branch=main')
      git('config', 'user.name', 'Test')
      git('config', 'user.email', 'test@example.invalid')
      git('config', 'commit.gpgsign', 'false')
      git('config', 'tag.gpgsign', 'false')
      git('config', 'core.hooksPath', hooks)
      writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "openschematicmaps"\n')
      writeFileSync(join(dir, 'uv.lock'), 'version = 1\n')
      git('add', 'pyproject.toml', 'uv.lock')
      git('commit', '--quiet', '-m', 'the engine')
      if (options.tag !== false) git('tag', pins.engine.tag)
      if (options.after === true) {
        writeFileSync(join(dir, 'later.txt'), 'later\n')
        git('add', 'later.txt')
        git('commit', '--quiet', '-m', 'after the tag')
      }
      return { dir, git }
    }

    /** The script against `dir`; the manifest and the vendor folder must be as they were. */
    function lock(dir: string) {
      const vendor = readdirSync(join(repo, 'vendor')).sort()
      const run = spawnSync('bash', [SCRIPT, dir], {
        encoding: 'utf8',
        timeout: 60_000,
        windowsHide: true,
      })
      expect(sha256(readFileSync(MANIFEST_PATH)), 'the manifest was rewritten').toBe(
        sha256(MANIFEST),
      )
      expect(readdirSync(join(repo, 'vendor')).sort(), 'a file was left in vendor/').toEqual(vendor)
      return run
    }

    it('refuses a folder that is not a git checkout', () => {
      const dir = mkdtempSync(join(tmpdir(), 'lc-lock-python-'))
      made.push(dir)
      const run = lock(dir)
      expect(run.status).toBe(1)
      expect(run.stderr).toContain('is not a git checkout')
    })

    it('refuses a checkout with changes, an untracked file among them', () => {
      const { dir } = engine()
      writeFileSync(join(dir, 'uv.lock'), 'version = 2\n')
      const changed = lock(dir)
      expect(changed.status).toBe(1)
      expect(changed.stderr).toContain(' M uv.lock')
      expect(changed.stderr).toContain(
        `has changes; the lock is read from a clean checkout of ${pins.engine.tag}`,
      )
      const untracked = engine()
      writeFileSync(join(untracked.dir, 'stray.py'), '# not committed\n')
      const stray = lock(untracked.dir)
      expect(stray.status).toBe(1)
      expect(stray.stderr).toContain('?? stray.py')
    })

    it('refuses a checkout without the pinned tag', () => {
      const run = lock(engine({ tag: false }).dir)
      expect(run.status).toBe(1)
      expect(run.stderr).toContain(`has no tag ${pins.engine.tag}`)
    })

    it('refuses a checkout that is not at the tag', () => {
      const { dir, git } = engine({ after: true })
      const run = lock(dir)
      expect(run.status).toBe(1)
      expect(run.stderr).toContain(
        `is at ${git('rev-parse', 'HEAD')}, not at ${pins.engine.tag} (${git('rev-parse', `${pins.engine.tag}^{commit}`)})`,
      )
    })

    it('refuses a tag that names another commit than engine.commit', () => {
      const { dir, git } = engine()
      const run = lock(dir)
      expect(run.status).toBe(1)
      expect(run.stderr).toContain(
        `has ${pins.engine.tag} at ${git('rev-parse', 'HEAD')}, and vendor/pins.json pins engine.commit ${pins.engine.commit}`,
      )
    })
  },
)
