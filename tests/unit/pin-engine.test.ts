// scripts/pin-engine.sh (issue 437): the engine pin as one script that moves
// one stable link. Each case runs the real script as a child process, in an
// argument array, against a temporary engine-shaped repository (a git repo
// with two tags and an in-tree build backend, so uv installs it with no
// network) and a temporary stand-in for this checkout, so nothing outside the
// temporary folder is read or written.

import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '../..')
const SCRIPT = join(repo, 'scripts', 'pin-engine.sh')

const hasUv = spawnSync('uv', ['--version']).status === 0
const hasGit = spawnSync('git', ['--version']).status === 0
const skip = process.platform === 'win32' || !hasGit

const BACKEND = `import base64, hashlib, os, zipfile
def _wheel(d):
    root = os.path.abspath("src")
    di = "fixture_engine-1.0.0.dist-info"
    files = {
        "fixture_engine.pth": root + "\\n",
        di + "/METADATA": "Metadata-Version: 2.1\\nName: fixture-engine\\nVersion: 1.0.0\\n",
        di + "/WHEEL": "Wheel-Version: 1.0\\nGenerator: t\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n",
    }
    rec = []
    for k, v in files.items():
        h = base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).rstrip(b"=").decode()
        rec.append(f"{k},sha256={h},{len(v)}")
    rec.append(di + "/RECORD,,")
    files[di + "/RECORD"] = "\\n".join(rec) + "\\n"
    fn = "fixture_engine-1.0.0-py3-none-any.whl"
    with zipfile.ZipFile(os.path.join(d, fn), "w") as z:
        for k, v in files.items():
            z.writestr(k, v)
    return fn
def get_requires_for_build_editable(c=None): return []
def build_editable(d, c=None, m=None): return _wheel(d)
def get_requires_for_build_wheel(c=None): return []
def build_wheel(d, c=None, m=None): return _wheel(d)
`

const roots: string[] = []
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}

interface Fixture {
  root: string
  app: string
  engine: string
  script: string
}

/** A stand-in checkout holding the script and pins, beside an engine repository with tags v1.0.0 and v2.0.0. */
function fixture(): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lc pin engine-')))
  roots.push(root)
  const app = join(root, 'app')
  const engine = join(root, 'OpenSchematicMaps')
  mkdirSync(join(app, 'scripts'), { recursive: true })
  mkdirSync(join(app, 'vendor'))
  mkdirSync(join(engine, 'src', 'schematic'), { recursive: true })
  mkdirSync(join(engine, 'data'))
  const script = join(app, 'scripts', 'pin-engine.sh')
  copyFileSync(SCRIPT, script)
  writeFileSync(
    join(app, 'vendor', 'pins.json'),
    JSON.stringify({ engine: { tag: 'v1.0.0', version: '1.0.0' } }),
  )
  git(engine, 'init', '-q', '-b', 'main')
  git(engine, 'config', 'user.email', 'test@example.invalid')
  git(engine, 'config', 'user.name', 'test')
  git(engine, 'config', 'commit.gpgsign', 'false')
  git(engine, 'config', 'tag.gpgsign', 'false')
  writeFileSync(join(engine, '.gitignore'), 'data/\nout/\n.venv/\n__pycache__/\n')
  writeFileSync(
    join(engine, 'pyproject.toml'),
    '[project]\nname = "fixture-engine"\nversion = "1.0.0"\n' +
      '[build-system]\nrequires = []\nbuild-backend = "backend"\nbackend-path = ["."]\n',
  )
  writeFileSync(join(engine, 'backend.py'), BACKEND)
  writeFileSync(join(engine, 'src', 'schematic', '__init__.py'), '__version__ = "1.0.0"\n')
  git(engine, 'add', '-A')
  git(engine, 'commit', '-q', '-m', 'one')
  git(engine, 'tag', 'v1.0.0')
  writeFileSync(join(engine, 'src', 'schematic', '__init__.py'), '__version__ = "2.0.0"\n')
  git(engine, 'commit', '-q', '-a', '-m', 'two')
  git(engine, 'tag', 'v2.0.0')
  writeFileSync(join(engine, 'src', 'schematic', '__init__.py'), 'raise ImportError("broken")\n')
  git(engine, 'commit', '-q', '-a', '-m', 'three')
  git(engine, 'tag', 'v3.0.0')
  return { root, app, engine, script }
}

function setPins(f: Fixture, tag: string, version: string): void {
  writeFileSync(join(f.app, 'vendor', 'pins.json'), JSON.stringify({ engine: { tag, version } }))
}

/** A PATH holding only git, node and dirname: no uv. */
function pathWithoutUv(f: Fixture): string {
  const bin = join(f.root, 'bin')
  mkdirSync(bin)
  for (const tool of ['git', 'node', 'dirname']) {
    const found = spawnSync('which', [tool], { encoding: 'utf8' }).stdout.trim()
    symlinkSync(found, join(bin, tool))
  }
  return bin
}

function run(f: Fixture, args: string[], env: NodeJS.ProcessEnv = {}, cwd = f.app) {
  const r = spawnSync('/bin/bash', [f.script, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, LEGIBLE_ENGINE_REPO: '', ...env },
  })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

const isLink = (p: string): boolean => {
  try {
    return lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}

describe.skipIf(skip)('scripts/pin-engine.sh refusals', () => {
  it('refuses a tag the engine repository does not have, and writes nothing', () => {
    const f = fixture()
    const r = run(f, ['v9.9.9'])
    expect(r.status).toBe(1)
    expect(r.out).toContain("no tag 'v9.9.9'")
    expect(existsSync(join(f.root, 'lc-engine-v9.9.9'))).toBe(false)
    expect(isLink(join(f.root, 'lc-engine-current'))).toBe(false)
  })

  it('refuses a tag that is not the pinned one without --force, and writes nothing', () => {
    const f = fixture()
    const r = run(f, ['v2.0.0'])
    expect(r.status).toBe(1)
    expect(r.out).toContain('not the engine tag in vendor/pins.json (v1.0.0)')
    expect(existsSync(join(f.root, 'lc-engine-v2.0.0'))).toBe(false)
    expect(existsSync(join(f.root, 'lc-engine-current'))).toBe(false)
  })

  it('refuses when lc-engine-current is a real folder, and leaves it alone', () => {
    const f = fixture()
    const dir = join(f.root, 'lc-engine-current')
    mkdirSync(dir)
    writeFileSync(join(dir, 'mine.txt'), 'x')
    const r = run(f, ['v1.0.0'])
    expect(r.status).toBe(1)
    expect(r.out).toContain('is not a link')
    expect(isLink(dir)).toBe(false)
    expect(existsSync(join(dir, 'mine.txt'))).toBe(true)
    expect(existsSync(join(f.root, 'lc-engine-v1.0.0'))).toBe(false)
  })

  it('refuses when uv is not installed, and writes nothing', () => {
    const f = fixture()
    const r = run(f, ['v1.0.0'], { PATH: pathWithoutUv(f) })
    expect(r.status).toBe(1)
    expect(r.out).toContain('uv is not installed')
    expect(existsSync(join(f.root, 'lc-engine-v1.0.0'))).toBe(false)
  })

  it('refuses a real folder in the way without needing uv', () => {
    const f = fixture()
    mkdirSync(join(f.root, 'lc-engine-current'))
    const r = run(f, ['v1.0.0'], { PATH: pathWithoutUv(f) })
    expect(r.status).toBe(1)
    expect(r.out).toContain('is not a link')
  })

  it('refuses --engine naming a folder inside the repository, not its top', () => {
    const f = fixture()
    const r = run(f, ['--engine', join(f.engine, 'src'), 'v1.0.0'])
    expect(r.status).toBe(1)
    expect(r.out).toContain('is not its top')
    expect(existsSync(join(f.engine, 'lc-engine-v1.0.0'))).toBe(false)
  })

  it('refuses an existing folder that is not a worktree at the tag, writing nothing into it', () => {
    const f = fixture()
    const wt = join(f.root, 'lc-engine-v1.0.0')
    mkdirSync(wt)
    expect(run(f, ['v1.0.0']).out).toContain('is not a git worktree')
    expect(existsSync(join(wt, '.venv'))).toBe(false)
    expect(existsSync(join(f.root, 'lc-engine-current'))).toBe(false)
  })
})

describe.skipIf(skip || !hasUv)('scripts/pin-engine.sh pinning', () => {
  it('makes the worktree, installs it and moves the one link', () => {
    const f = fixture()
    const r = run(f, ['v1.0.0'])
    expect(r.out).toContain('beside this checkout')
    expect(r.status).toBe(0)
    const wt = join(f.root, 'lc-engine-v1.0.0')
    const link = join(f.root, 'lc-engine-current')
    expect(readlinkSync(link)).toBe('lc-engine-v1.0.0')
    expect(realpathSync(link)).toBe(realpathSync(wt))
    // data is a link to the repository's, out a real folder.
    expect(isLink(join(wt, 'data'))).toBe(true)
    expect(realpathSync(join(wt, 'data'))).toBe(realpathSync(join(f.engine, 'data')))
    expect(lstatSync(join(wt, 'out')).isDirectory()).toBe(true)
    expect(isLink(join(wt, 'out'))).toBe(false)
    // The worktree's own interpreter reports the pinned version.
    const py = spawnSync(
      join(link, '.venv', 'bin', 'python'),
      ['-c', 'import schematic; print(schematic.__version__)'],
      { encoding: 'utf8' },
    )
    expect(py.stdout.trim()).toBe('1.0.0')
  })

  it('pins a tag other than the pinned one with --force, and moves the link to it', () => {
    const f = fixture()
    expect(run(f, ['v1.0.0']).status).toBe(0)
    const r = run(f, ['--force', 'v2.0.0'])
    expect(r.status).toBe(0)
    expect(r.out).toContain('schematic reports 2.0.0; vendor/pins.json names 1.0.0')
    expect(readlinkSync(join(f.root, 'lc-engine-current'))).toBe('lc-engine-v2.0.0')
    // The first worktree is untouched.
    expect(existsSync(join(f.root, 'lc-engine-v1.0.0', '.venv'))).toBe(true)
  })

  it('takes the engine from --engine and from LEGIBLE_ENGINE_REPO and says so', () => {
    const f = fixture()
    const moved = join(f.root, 'elsewhere')
    mkdirSync(moved)
    const target = join(moved, 'engine-repo')
    spawnSync('mv', [f.engine, target])
    const viaFlag = run(f, ['--engine', target, 'v1.0.0'])
    expect(viaFlag.status).toBe(0)
    expect(viaFlag.out).toContain('(--engine)')
    expect(existsSync(join(moved, 'lc-engine-v1.0.0'))).toBe(true)
    expect(dirname(realpathSync(join(f.root, 'lc-engine-current')))).toBe(realpathSync(moved))
    const viaEnv = run(f, ['v1.0.0'], { LEGIBLE_ENGINE_REPO: target })
    expect(viaEnv.out).toContain('(LEGIBLE_ENGINE_REPO)')
  })

  it('reuses a worktree at the tag but refuses one at another commit', () => {
    const f = fixture()
    expect(run(f, ['v1.0.0']).status).toBe(0)
    expect(run(f, ['v1.0.0']).out).toContain('reused')
    const wt = join(f.root, 'lc-engine-v1.0.0')
    git(wt, 'checkout', '-q', '--detach', 'v2.0.0')
    const r = run(f, ['v1.0.0'])
    expect(r.status).toBe(1)
    expect(r.out).toContain('not at v1.0.0')
  })

  it('leaves a link called out in a reused worktree alone', () => {
    const f = fixture()
    expect(run(f, ['v1.0.0']).status).toBe(0)
    const out = join(f.root, 'lc-engine-v1.0.0', 'out')
    rmSync(out, { recursive: true })
    symlinkSync(f.engine, out)
    const r = run(f, ['v1.0.0'])
    expect(r.status).toBe(0)
    expect(r.out).toContain('is a link and the worktree is not new')
    expect(isLink(out)).toBe(true)
  })

  it('does not move the link when the version differs from the pins', () => {
    const f = fixture()
    expect(run(f, ['v1.0.0']).status).toBe(0)
    setPins(f, 'v2.0.0', '1.0.0')
    const r = run(f, ['v2.0.0'])
    expect(r.status).toBe(1)
    expect(r.out).toContain('schematic reports 2.0.0 but vendor/pins.json names 1.0.0')
    expect(readlinkSync(join(f.root, 'lc-engine-current'))).toBe('lc-engine-v1.0.0')
  })

  it('does not move the link when schematic cannot be imported', () => {
    const f = fixture()
    expect(run(f, ['v1.0.0']).status).toBe(0)
    setPins(f, 'v3.0.0', '3.0.0')
    const r = run(f, ['v3.0.0'])
    expect(r.status).toBe(1)
    expect(r.out).toContain('cannot import schematic')
    expect(readlinkSync(join(f.root, 'lc-engine-current'))).toBe('lc-engine-v1.0.0')
  })

  it('is not fooled by a schematic folder in the folder it is run from', () => {
    const f = fixture()
    // The worktree at v2.0.0 reports 2.0.0; the pins ask for 1.0.0; a stray
    // schematic in the working folder says 1.0.0.
    mkdirSync(join(f.engine, 'schematic'))
    writeFileSync(join(f.engine, 'schematic', '__init__.py'), '__version__ = "1.0.0"\n')
    setPins(f, 'v2.0.0', '1.0.0')
    const r = run(f, ['v2.0.0'], {}, f.engine)
    expect(r.status).toBe(1)
    expect(r.out).toContain('schematic reports 2.0.0')
    expect(existsSync(join(f.root, 'lc-engine-current'))).toBe(false)
  })

  it('works from another folder, with a space in every path', () => {
    const f = fixture()
    expect(f.root).toContain(' ')
    const r = run(f, ['v1.0.0'], {}, tmpdir())
    expect(r.status).toBe(0)
    expect(readlinkSync(join(f.root, 'lc-engine-current'))).toBe('lc-engine-v1.0.0')
  })

  it('does not move the link when schematic is imported from outside the worktree', () => {
    const f = fixture()
    expect(run(f, ['v1.0.0']).status).toBe(0)
    // A stale .pth, read before the editable one, puts another tree first;
    // its schematic reports the pinned version, so only where it lives is wrong.
    const stale = join(f.root, 'stale')
    mkdirSync(join(stale, 'schematic'), { recursive: true })
    writeFileSync(join(stale, 'schematic', '__init__.py'), '__version__ = "1.0.0"\n')
    const lib = join(f.root, 'lc-engine-v1.0.0', '.venv', 'lib')
    const py = readdirSync(lib).find((d) => d.startsWith('python')) as string
    writeFileSync(join(lib, py, 'site-packages', 'aaa_stale.pth'), `${stale}\n`)
    // The link goes to v2.0.0 first, so a wrongly moved link shows.
    expect(run(f, ['--force', 'v2.0.0']).status).toBe(0)
    const r = run(f, ['v1.0.0'])
    expect(r.status).toBe(1)
    expect(r.out).toContain('not from')
    expect(readlinkSync(join(f.root, 'lc-engine-current'))).toBe('lc-engine-v2.0.0')
  })

  it('refuses an existing folder that is a worktree of another repository, writing nothing', () => {
    const f = fixture()
    const other = join(f.root, 'other')
    mkdirSync(other)
    git(other, 'init', '-q', '-b', 'main')
    git(other, 'config', 'user.email', 'test@example.invalid')
    git(other, 'config', 'user.name', 'test')
    git(other, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(other, 'a.txt'), 'a')
    git(other, 'add', '-A')
    git(other, 'commit', '-q', '-m', 'a')
    const wt = join(f.root, 'lc-engine-v1.0.0')
    git(other, 'worktree', 'add', '-q', '--detach', wt, 'HEAD')
    const r = run(f, ['v1.0.0'])
    expect(r.status).toBe(1)
    expect(r.out).toContain('is not a worktree of')
    expect(existsSync(join(wt, '.venv'))).toBe(false)
    expect(existsSync(join(f.root, 'lc-engine-current'))).toBe(false)
  })

  it('reuses its worktree when --engine is itself a linked worktree', () => {
    const f = fixture()
    const linked = join(f.root, 'linked engine')
    git(f.engine, 'worktree', 'add', '-q', '--detach', linked, 'main')
    expect(lstatSync(join(linked, '.git')).isFile()).toBe(true)
    expect(run(f, ['--engine', linked, 'v1.0.0']).status).toBe(0)
    const again = run(f, ['--engine', linked, 'v1.0.0'])
    expect(again.out).toContain('reused')
    expect(again.status).toBe(0)
  })
})
