// The licence texts' extraction in scripts/vendor-python-licences.sh, the
// same lines scripts/vendor-python.sh runs (issue 319).
//
// The step used to pipe `zstd -dc` into `tar -xf - <members>`. bsdtar stops
// at the end-of-archive marker and leaves unread the padding after it; when
// zstd had not yet written that padding, its write failed with a broken pipe
// and `set -o pipefail` failed the step, on two runs out of many and with
// nothing wrong in the archive. A pipeline that depends on how a writer's
// last writes fall cannot be tested by repeating it, so the archive here is
// built to make them fall the same way every time: blocked at a megabyte, so
// that a megabyte of padding follows the marker, and carrying a member after
// the licences, so that stopping at the last member asked for is no way out.
// Against a pipe that archive fails the step every time on bsdtar; against
// the file the script reads it cannot.
//
// The script is bash and takes POSIX paths (GNU tar reads `C:\dir` as a file
// on a host called C), so this skips on Windows, where the vendor job runs it
// under Git Bash. It also skips where bash, tar or zstd is not on PATH, and
// never installs one. A skipped block prints only its title, so the title
// carries the reason.

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '../..')
const SCRIPT = join(repo, 'scripts', 'vendor-python-licences.sh')
const DEADLINE_MS = 60_000

function works(command: string): boolean {
  const run = spawnSync(command, ['--version'], {
    stdio: 'ignore',
    timeout: 10_000,
    windowsHide: true,
  })
  return run.status === 0
}

const lacking = process.platform === 'win32' ? [] : ['bash', 'tar', 'zstd'].filter((t) => !works(t))
const missing =
  process.platform === 'win32'
    ? 'the script takes POSIX paths and the vendor job runs it under Git Bash'
    : lacking.length > 0
      ? `${lacking.join(', ')} not on PATH`
      : ''
const WHY = missing ? ` (skipped: ${missing})` : ''

// Bytes a text-mode copy or a stray newline would change: every value, in
// an order no accident reproduces.
function bytes(length: number, seed: number): Buffer {
  return Buffer.from(Array.from({ length }, (_, i) => (i * seed + (i >> 3)) % 256))
}

const PYTHON_JSON = bytes(3000, 7)
const LICENCES: Record<string, Buffer> = {
  'LICENSE.a.txt': bytes(5000, 11),
  'LICENSE.b.txt': bytes(40, 13),
  'LICENSE.c.txt': Buffer.alloc(0),
}
// What the archive holds after the licences, and what must not come out.
const NOTICE = Buffer.from('not a licence text\n')
const PADDING_BYTES = 32 * 1024 * 1024
const BLOCKS_OF_512_IN_A_MEBIBYTE = 2048

let dir: string
let n = 0

function sh(command: string, args: string[], env?: NodeJS.ProcessEnv) {
  const run = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: DEADLINE_MS,
    windowsHide: true,
    env: env ?? process.env,
  })
  const said = `${command} ${args.join(' ')}\nstatus ${run.status}, signal ${run.signal}, error ${run.error}\nstderr: ${run.stderr}\nstdout: ${run.stdout}`
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, said }
}

/**
 * A `.tar.zst` in a folder of its own: the paths in `order`, a folder with
 * everything under it, in that order, then the end-of-archive marker and a
 * megabyte of padding. `members` maps a path to its bytes.
 */
function archive(members: Record<string, Buffer>, order: string[]): string {
  const work = join(dir, `a${++n}`)
  const src = join(work, 'src')
  for (const [path, content] of Object.entries(members)) {
    mkdirSync(dirname(join(src, path)), { recursive: true })
    writeFileSync(join(src, path), content)
  }
  const tar = join(work, 'full.tar')
  const made = sh('tar', [
    '-b',
    String(BLOCKS_OF_512_IN_A_MEBIBYTE),
    '-cf',
    tar,
    '-C',
    src,
    ...order,
  ])
  expect(made.status, made.said).toBe(0)
  const packed = sh('zstd', ['-q', '-f', tar, '-o', `${tar}.zst`])
  expect(packed.status, packed.said).toBe(0)
  rmSync(src, { recursive: true, force: true })
  rmSync(tar)
  return `${tar}.zst`
}

// The licences first and a build tree after them, as in the real archive;
// the order is the command line's, not the file system's.
const ORDER = [
  'python/PYTHON.json',
  'python/licenses',
  'python/build/NOTICE.txt',
  'python/build/padding.bin',
]

function everything(): string {
  const members: Record<string, Buffer> = { 'python/PYTHON.json': PYTHON_JSON }
  for (const [name, content] of Object.entries(LICENCES)) {
    members[`python/licenses/${name}`] = content
  }
  members['python/build/NOTICE.txt'] = NOTICE
  members['python/build/padding.bin'] = Buffer.alloc(PADDING_BYTES)
  return archive(members, ORDER)
}

// The order tree() lists in, by code point; a list compared with its result
// is sorted the same way, so that a fixture's name decides nothing.
const byName = (a: string, b: string): number => (a < b ? -1 : 1)

/** Every file under a folder, relative and sorted, with its bytes. */
function tree(root: string, prefix = ''): Record<string, Buffer> {
  const found: Record<string, Buffer> = {}
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) Object.assign(found, tree(root, path))
    else found[path] = readFileSync(join(root, path))
  }
  return Object.fromEntries(Object.entries(found).sort(([a], [b]) => byName(a, b)))
}

describe.skipIf(missing !== '')(`the licence texts' extraction${WHY}`, () => {
  let full: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lc-319-licences-'))
    full = everything()
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('takes the two members byte for byte, and nothing else, from an archive that ends in padding', () => {
    const out = join(dir, `out${++n}`)
    const run = sh('bash', [SCRIPT, full, out])
    expect(run.status, run.said).toBe(0)

    const expected: Record<string, Buffer> = { 'python/PYTHON.json': PYTHON_JSON }
    for (const [name, content] of Object.entries(LICENCES)) {
      expected[`python/licenses/${name}`] = content
    }
    const got = tree(out)
    expect(Object.keys(got), run.said).toEqual(Object.keys(expected).sort(byName))
    for (const [path, content] of Object.entries(expected)) {
      expect(got[path].equals(content), `${path} differs`).toBe(true)
    }
  })

  it('leaves nothing beside the archive: the decompressed copy is removed', () => {
    const run = sh('bash', [SCRIPT, full, join(dir, `out${++n}`)])
    expect(run.status, run.said).toBe(0)
    expect(readdirSync(dirname(full)), run.said).toEqual([basename(full)])
  })

  it('says how much it decompressed, so that a log can size the disk it needed', () => {
    const run = sh('bash', [SCRIPT, full, join(dir, `out${++n}`)])
    expect(run.status, run.said).toBe(0)
    expect(run.stdout).toMatch(/^decompressed full\.tar\.zst to (\d+) bytes$/m)
    const size = Number(/to (\d+) bytes/.exec(run.stdout)?.[1])
    expect(size).toBeGreaterThan(PADDING_BYTES)
  })

  it('refuses an archive without the licences, naming the archive', () => {
    const bare = archive({ 'python/PYTHON.json': PYTHON_JSON, 'python/build/NOTICE.txt': NOTICE }, [
      'python/PYTHON.json',
      'python/build/NOTICE.txt',
    ])
    const run = sh('bash', [SCRIPT, bare, join(dir, `out${++n}`)])
    expect(run.status, run.said).toBe(1)
    expect(run.stderr).toContain(bare)
  })

  it('refuses a file that is not a zstd archive, naming it, and leaves nothing behind', () => {
    // A folder of its own, so that anything left beside the input is this
    // run's and not another test's.
    const home = join(dir, `bad${++n}`)
    mkdirSync(home)
    const notArchive = join(home, 'not-an-archive.tar.zst')
    writeFileSync(notArchive, 'this is text\n')
    const out = join(dir, `out${n}`)
    const run = sh('bash', [SCRIPT, notArchive, out])
    expect(run.status, run.said).toBe(1)
    expect(run.stderr).toContain(notArchive)
    expect(existsSync(out) ? tree(out) : {}, run.said).toEqual({})
    expect(readdirSync(home), `the scratch folder was left beside the input\n${run.said}`).toEqual([
      basename(notArchive),
    ])
  })

  it('is a usage error with no archive, and with an archive that is not there', () => {
    const noArgs = sh('bash', [SCRIPT])
    expect(noArgs.status, noArgs.said).toBe(2)
    const run = sh('bash', [SCRIPT, join(dir, 'nowhere.tar.zst'), join(dir, 'out-nowhere')])
    expect(run.status, run.said).toBe(2)
  })
})
