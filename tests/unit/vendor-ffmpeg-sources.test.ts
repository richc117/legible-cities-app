// The caches of FFmpeg's sources and of the built FFmpeg (issue 630). The
// vendor jobs keep FFmpeg's release tarball, x264's tar and zlib's release
// tarball between runs under a key made of their names and pinned sha256s;
// determinism.yml keys its built FFmpeg on the ffmpeg block of the pins
// alone. scripts/vendor-ffmpeg.sh computes both keys (--keys) and is what
// holds a restored archive to its pin (--fetch), so it is what is tested
// here: with a pins file of the real one's shape whose sources are file://
// URLs and a local x264 repository, so nothing reaches the network.

import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '../..')
const SCRIPT = join(repo, 'scripts', 'vendor-ffmpeg.sh')
const FINGERPRINT = 'A'.repeat(40)
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-vendor-ffmpeg-test-'))
  made.push(dir)
  return dir
}
/** A tool run with an argument array, never through a shell. */
function tool(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = GIT_ENV,
): SpawnSyncReturns<string> {
  return spawnSync(command, args, { encoding: 'utf8', timeout: 60_000, env, windowsHide: true })
}
function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}
// The script needs bash, curl, git and a Python 3.9 or later. Windows runs
// it under Git Bash, where a file:// URL of a Windows path is another
// matter; the vendor jobs are what run it there.
const lacking =
  process.platform === 'win32' ||
  tool('bash', [
    '-c',
    'command -v curl git python3 >/dev/null && ' +
      "python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))'",
  ]).status !== 0
const REAL_CURL = lacking ? '' : tool('bash', ['-c', 'command -v curl']).stdout.trim()

interface Fixture {
  dir: string
  pinsFile: string
  pins: { ffmpeg: Record<string, unknown> } & Record<string, unknown>
  /** The three archives' names, as the script writes them. */
  names: string[]
  /** The pinned sha256 of each name. */
  shas: Record<string, string>
  /** Where the release tarballs are served from, and the x264 repository. */
  host: string
}

/**
 * Two release tarballs on a file:// host, an x264 repository with one
 * commit, and pins that name them by their own sha256s.
 */
function fixture(): Fixture {
  const dir = scratch()
  const host = join(dir, 'host')
  mkdirSync(host)
  const ffmpegName = 'ffmpeg-1.2.3.tar.xz'
  const zlibName = 'zlib-4.5.6.tar.gz'
  writeFileSync(join(host, ffmpegName), 'the release tarball of FFmpeg 1.2.3\n'.repeat(64))
  writeFileSync(join(host, zlibName), 'the release tarball of zlib 4.5.6\n'.repeat(64))
  // Signatures and a key for --sources, which a stand-in gpg accepts: what
  // is tested of it here is how they are fetched, not how they verify.
  writeFileSync(join(host, `${ffmpegName}.asc`), 'a signature of FFmpeg 1.2.3\n')
  writeFileSync(join(host, `${zlibName}.asc`), 'a signature of zlib 4.5.6\n')
  writeFileSync(join(host, 'key.asc'), 'a signing key\n')

  const x264 = join(host, 'x264')
  expect(tool('git', ['init', '-q', x264]).status).toBe(0)
  writeFileSync(join(x264, 'x264.c'), 'int main(void) { return 0; }\n')
  expect(tool('git', ['-C', x264, 'add', 'x264.c']).status).toBe(0)
  const commit = tool('git', [
    '-C',
    x264,
    '-c',
    'user.name=x264',
    '-c',
    'user.email=x264@example.invalid',
    'commit',
    '-q',
    '-m',
    'x264',
  ])
  expect(commit.status, commit.stderr).toBe(0)
  const id = tool('git', ['-C', x264, 'rev-parse', 'HEAD']).stdout.trim()
  const x264Name = `x264-${id}.tar`
  const expected = join(dir, x264Name)
  const archived = tool('git', [
    '-C',
    x264,
    '-c',
    'core.autocrlf=false',
    '-c',
    'core.eol=lf',
    'archive',
    '--format=tar',
    `--prefix=x264-${id}/`,
    '-o',
    expected,
    'HEAD',
  ])
  expect(archived.status, archived.stderr).toBe(0)

  const shas = {
    [ffmpegName]: sha256(join(host, ffmpegName)),
    [x264Name]: sha256(expected),
    [zlibName]: sha256(join(host, zlibName)),
  }
  const pins = {
    engine: { tag: 'v1.0.0', version: '1.0.0' },
    ffmpeg: {
      version: '1.2.3',
      note: 'a fixture',
      source: {
        url: pathToFileURL(join(host, ffmpegName)).href,
        sha256: shas[ffmpegName],
        signature: pathToFileURL(join(host, `${ffmpegName}.asc`)).href,
        signing_key: { url: pathToFileURL(join(host, 'key.asc')).href, fingerprint: FINGERPRINT },
        tag: 'n1.2.3',
        commit: 'b'.repeat(40),
      },
      x264: { repo: pathToFileURL(x264).href, commit: id, sha256: shas[x264Name] },
      zlib: {
        version: '4.5.6',
        url: pathToFileURL(join(host, zlibName)).href,
        sha256: shas[zlibName],
        signature: pathToFileURL(join(host, `${zlibName}.asc`)).href,
        signing_key: { url: pathToFileURL(join(host, 'key.asc')).href, fingerprint: FINGERPRINT },
      },
      targets: Object.fromEntries(
        ['darwin-arm64', 'darwin-x64', 'win-x64', 'linux-x64'].map((target) => [
          target,
          {
            runner: 'a runner',
            zlib: target === 'win-x64' ? 'static' : 'system',
            ...(target === 'win-x64' ? { zlib_configure: '--static' } : {}),
            x264_configure: '--enable-static',
            configure: '--disable-everything',
            reports: '1.2.3',
          },
        ]),
      ),
    },
  }
  const pinsFile = join(dir, 'pins.json')
  writeFileSync(pinsFile, `${JSON.stringify(pins, null, 2)}\n`)
  return { dir, pinsFile, pins, names: [ffmpegName, x264Name, zlibName], shas, host }
}

/** The script with the pins given, no waiting between tries, and `extra`. */
function script(args: string[], pinsFile: string, extra: NodeJS.ProcessEnv = {}) {
  return tool('bash', [SCRIPT, ...args], {
    ...GIT_ENV,
    GITHUB_ACTIONS: '',
    VENDOR_FFMPEG_PINS: pinsFile,
    VENDOR_FFMPEG_BACKOFF: '0',
    ...extra,
  })
}

/** What --keys printed, by name. */
function keys(pinsFile: string): Record<string, string> {
  const result = script(['--keys'], pinsFile)
  expect(result.status, result.stderr).toBe(0)
  return Object.fromEntries(
    result.stdout
      .trim()
      .split('\n')
      .map((line) => line.split('=', 2) as [string, string]),
  )
}
function rewrite(f: Fixture, change: (pins: Fixture['pins']) => void): string {
  const pins = structuredClone(f.pins)
  change(pins)
  const file = join(f.dir, `pins-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(file, JSON.stringify(pins))
  return file
}
/** How many downloads a run's output says it made. */
function fetches(output: string): number {
  return output.split('\n').filter((line) => line.startsWith('fetching ')).length
}
/** How many downloads of a URL ending in `tail` a run's output says it made. */
function fetchesOf(output: string, tail: string): number {
  return output.split('\n').filter((line) => line.startsWith('fetching ') && line.endsWith(tail))
    .length
}
/** The folder holds exactly the three archives, each its pinned bytes. */
function expectPinned(f: Fixture, folder: string): void {
  expect(readdirSync(folder).sort()).toEqual([...f.names].sort())
  for (const name of f.names) expect(sha256(join(folder, name)), name).toBe(f.shas[name])
}

describe.skipIf(lacking)('vendor-ffmpeg.sh --keys', () => {
  it('prints the sources key and the pins hash, each as a name=value line', () => {
    const f = fixture()
    const result = script(['--keys'], f.pinsFile)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toMatch(/^sources=ffmpeg-sources-[0-9a-f]{64}\npins=[0-9a-f]{64}\n$/)
  })

  it('leaves both keys alone when a pin outside the ffmpeg block moves, the engine’s say', () => {
    const f = fixture()
    const moved = rewrite(f, (pins) => {
      pins.engine = { tag: 'v2.0.0', version: '2.0.0' }
    })
    expect(keys(moved)).toEqual(keys(f.pinsFile))
  })

  it('moves the pins hash, and not the sources key, when anything else in the ffmpeg block does', () => {
    const f = fixture()
    const before = keys(f.pinsFile)
    const after = keys(
      rewrite(f, (pins) => {
        pins.ffmpeg.targets = { 'linux-x64': { configure: '--disable-everything' } }
      }),
    )
    expect(after.pins).not.toBe(before.pins)
    expect(after.sources).toBe(before.sources)
  })

  it('moves the sources key when an archive’s pinned sha256 does', () => {
    const f = fixture()
    const before = keys(f.pinsFile)
    const after = keys(
      rewrite(f, (pins) => {
        ;(pins.ffmpeg.zlib as { sha256: string }).sha256 = '0'.repeat(64)
      }),
    )
    expect(after.sources).not.toBe(before.sources)
    expect(after.pins).not.toBe(before.pins)
  })

  it('reads the committed pins', () => {
    const result = tool('bash', [SCRIPT, '--keys'], { ...GIT_ENV, VENDOR_FFMPEG_PINS: '' })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toMatch(/^sources=ffmpeg-sources-[0-9a-f]{64}\npins=[0-9a-f]{64}\n$/)
  })
})

describe.skipIf(lacking)('vendor-ffmpeg.sh --fetch', () => {
  it('fetches all three into an empty folder, a cold cache, each its pinned bytes', () => {
    const f = fixture()
    const cache = join(f.dir, 'cache')
    const result = script(['--fetch', cache], f.pinsFile)
    expect(result.status, result.stderr).toBe(0)
    expect(fetches(result.stdout)).toBe(3)
    expectPinned(f, cache)
  })

  it('fetches nothing for a warm cache, with the host gone', () => {
    const f = fixture()
    const cache = join(f.dir, 'cache')
    expect(script(['--fetch', cache], f.pinsFile).status).toBe(0)
    rmSync(f.host, { recursive: true, force: true })
    const result = script(['--fetch', cache], f.pinsFile)
    expect(result.status, result.stderr).toBe(0)
    expect(fetches(result.stdout)).toBe(0)
    expect(result.stdout.match(/^kept: /gm)).toHaveLength(3)
    expectPinned(f, cache)
  })

  it('refuses a cached archive that is not its pinned bytes, and fetches it afresh', () => {
    const f = fixture()
    const cache = join(f.dir, 'cache')
    expect(script(['--fetch', cache], f.pinsFile).status).toBe(0)
    const [ffmpegName, x264Name] = f.names
    const tarball = join(cache, ffmpegName)
    const bytes = readFileSync(tarball)
    bytes[10] ^= 0xff
    writeFileSync(tarball, bytes)
    writeFileSync(join(cache, x264Name), 'not a tar\n')
    const result = script(['--fetch', cache], f.pinsFile, { GITHUB_ACTIONS: 'true' })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toContain(`::warning::${ffmpegName} in `)
    expect(result.stderr).toContain(`${x264Name} in `)
    expect(result.stderr).toContain('is not the pinned bytes: it is refused')
    expect(fetches(result.stdout)).toBe(2)
    expectPinned(f, cache)
  })

  it('refuses a cached archive that is a link, even to the right bytes', () => {
    const f = fixture()
    const cache = join(f.dir, 'cache')
    mkdirSync(cache)
    const [ffmpegName] = f.names
    symlinkSync(join(f.host, ffmpegName), join(cache, ffmpegName))
    const result = script(['--fetch', cache], f.pinsFile)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toContain(`${ffmpegName} in `)
    expect(fetches(result.stdout)).toBe(3)
    expectPinned(f, cache)
    expect(lstatSync(join(cache, ffmpegName)).isSymbolicLink()).toBe(false)
  })

  it('tries a download again after a failed try, and keeps what the later try fetched', () => {
    const f = fixture()
    const cache = join(f.dir, 'cache')
    const result = script(['--fetch', cache], f.pinsFile, failingCurl(f, 2))
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toContain(`try 1 of 4 to fetch ${f.names[0]} failed`)
    expect(result.stderr).toContain(`try 2 of 4 to fetch ${f.names[0]} failed`)
    expectPinned(f, cache)
  })

  it('gives up after four tries, and leaves no part of a download behind', () => {
    const f = fixture()
    const cache = join(f.dir, 'cache')
    const [ffmpegName] = f.names
    const result = script(['--fetch', cache], f.pinsFile, failingCurl(f, 99))
    expect(result.status).not.toBe(0)
    expect(fetches(result.stdout)).toBe(4)
    expect(result.stderr).toContain(`could not fetch ${ffmpegName} in 4 tries`)
    expect(readdirSync(cache)).toEqual([])
  })
})

describe.skipIf(lacking)('vendor-ffmpeg.sh, a download that is not its pin', () => {
  // A host that serves other bytes than the pins name: the check after the
  // download is the only thing between them and the build.
  it('refuses a download that is not its pinned bytes, without trying again or keeping it', () => {
    const f = fixture()
    const cache = join(f.dir, 'cache')
    const [ffmpegName] = f.names
    const pins = rewrite(f, (p) => {
      ;(p.ffmpeg.source as { sha256: string }).sha256 = '0'.repeat(64)
    })
    const result = script(['--fetch', cache], pins)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`checksum mismatch for ${ffmpegName}`)
    expect(fetchesOf(result.stdout, `/${ffmpegName}`)).toBe(1)
    expect(existsSync(join(cache, ffmpegName))).toBe(false)
  })

  it('refuses an x264 tar that is not its pinned bytes, and keeps none', () => {
    const f = fixture()
    const cache = join(f.dir, 'cache')
    const [, x264Name] = f.names
    const pins = rewrite(f, (p) => {
      ;(p.ffmpeg.x264 as { sha256: string }).sha256 = '0'.repeat(64)
    })
    const result = script(['--fetch', cache], pins)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`checksum mismatch for ${x264Name}`)
    expect(
      result.stdout.split('\n').filter((line) => line.startsWith('fetching x264 ')),
    ).toHaveLength(1)
    expect(existsSync(join(cache, x264Name))).toBe(false)
    expect(existsSync(join(cache, `${x264Name}.part`))).toBe(false)
  })

  it('refuses a download that is not its pinned bytes in --sources too, and copies nothing', () => {
    const f = fixture()
    const cache = join(f.dir, 'cache')
    expect(script(['--fetch', cache], f.pinsFile).status).toBe(0)
    const [ffmpegName] = f.names
    const pins = rewrite(f, (p) => {
      ;(p.ffmpeg.source as { sha256: string }).sha256 = '0'.repeat(64)
    })
    const out = join(f.dir, 'ffmpeg-source')
    const result = script(['--sources', out], pins, { VENDOR_FFMPEG_SOURCES: cache })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`checksum mismatch for ${ffmpegName}`)
    expect(fetchesOf(result.stdout, `/${ffmpegName}`)).toBe(1)
    expect(existsSync(join(out, ffmpegName))).toBe(false)
    expect(existsSync(join(cache, ffmpegName))).toBe(false)
  })
})

describe.skipIf(lacking)('vendor-ffmpeg.sh, what it never removes', () => {
  // VENDOR_FFMPEG_PINS can name any file, and a folder can sit where an
  // archive is looked for; neither may cost the folder holding it.
  it('refuses a pinned URL that names no file, and leaves the folder as it is', () => {
    const f = fixture()
    const cache = join(f.dir, 'cache')
    mkdirSync(cache)
    writeFileSync(join(cache, 'other'), 'a file of the developer’s\n')
    const pins = rewrite(f, (p) => {
      ;(p.ffmpeg.source as { url: string }).url = `${pathToFileURL(f.host).href}/`
    })
    const result = script(['--fetch', cache], pins)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('names no file to fetch')
    expect(readdirSync(cache)).toEqual(['other'])
  })

  it('refuses a folder where an archive should be, and removes nothing', () => {
    const f = fixture()
    const cache = join(f.dir, 'cache')
    const [ffmpegName] = f.names
    mkdirSync(join(cache, ffmpegName), { recursive: true })
    writeFileSync(join(cache, ffmpegName, 'inside'), 'a file of the developer’s\n')
    const result = script(['--fetch', cache], f.pinsFile)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`${ffmpegName} in ${cache} is a folder, not an archive`)
    expect(fetches(result.stdout)).toBe(0)
    expect(readdirSync(join(cache, ffmpegName))).toEqual(['inside'])
  })

  it('refuses an x264 commit that is not a commit id, before any path is made of it', () => {
    const f = fixture()
    const cache = join(f.dir, 'cache')
    mkdirSync(cache)
    writeFileSync(join(cache, 'other'), 'a file of the developer’s\n')
    const pins = rewrite(f, (p) => {
      ;(p.ffmpeg.x264 as { commit: string }).commit = '../..'
    })
    const result = script(['--fetch', cache], pins)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('ffmpeg.x264.commit must be a commit id')
    expect(fetches(result.stdout)).toBe(0)
    expect(readdirSync(cache)).toEqual(['other'])
  })
})

describe.skipIf(lacking)('vendor-ffmpeg.sh, the check of a copy from the source cache', () => {
  // cp copies into a folder that sits at the copy's name, and succeeds; the
  // check of the copy is what stops the run.
  it('refuses a copy of FFmpeg’s tarball that did not land as the pinned file', () => {
    const f = fixture()
    const cache = join(f.dir, 'cache')
    expect(script(['--fetch', cache], f.pinsFile).status).toBe(0)
    const other = join(f.dir, 'other')
    mkdirSync(join(other, f.names[0]), { recursive: true })
    const result = script(['--fetch', other], f.pinsFile, { VENDOR_FFMPEG_SOURCES: cache })
    expect(result.status).not.toBe(0)
    expect(fetches(result.stdout)).toBe(0)
  })

  it('refuses a copy of x264’s tar in --sources that did not land as the pinned file', () => {
    const f = fixture()
    const cache = join(f.dir, 'cache')
    expect(script(['--fetch', cache], f.pinsFile).status).toBe(0)
    const out = join(f.dir, 'ffmpeg-source')
    mkdirSync(join(out, f.names[1]), { recursive: true })
    const result = script(['--sources', out], f.pinsFile, {
      ...standInGpg(f),
      VENDOR_FFMPEG_SOURCES: cache,
    })
    expect(result.status).not.toBe(0)
    expect(existsSync(join(out, 'BUILD.txt'))).toBe(false)
  })

  it('replaces a link at a copy’s name, and writes nothing through it', () => {
    const f = fixture()
    const cache = join(f.dir, 'cache')
    expect(script(['--fetch', cache], f.pinsFile).status).toBe(0)
    const other = join(f.dir, 'other')
    mkdirSync(other)
    const victim = join(f.dir, 'victim')
    writeFileSync(victim, 'left as it was')
    symlinkSync(victim, join(other, f.names[0]))
    symlinkSync(victim, join(other, f.names[1]))
    const result = script(['--fetch', other], f.pinsFile, { VENDOR_FFMPEG_SOURCES: cache })
    expect(result.status).toBe(0)
    expect(readFileSync(victim, 'utf8')).toBe('left as it was')
    expect(lstatSync(join(other, f.names[0])).isSymbolicLink()).toBe(false)
    expect(lstatSync(join(other, f.names[1])).isSymbolicLink()).toBe(false)
  })
})

describe.skipIf(lacking)('vendor-ffmpeg.sh --sources', () => {
  it('takes the archives from the source cache and tries a signature again after a failed try', () => {
    const f = fixture()
    const cache = join(f.dir, 'cache')
    expect(script(['--fetch', cache], f.pinsFile).status).toBe(0)
    const out = join(f.dir, 'ffmpeg-source')
    const env = failingCurl(f, 2)
    const result = script(['--sources', out], f.pinsFile, {
      ...standInGpg(f),
      ...env,
      VENDOR_FFMPEG_SOURCES: cache,
    })
    expect(result.status, result.stderr).toBe(0)
    const [ffmpegName, , zlibName] = f.names
    expect(result.stderr).toContain(`try 1 of 4 to fetch ${ffmpegName}.asc failed`)
    expect(result.stderr).toContain(`try 2 of 4 to fetch ${ffmpegName}.asc failed`)
    expect(result.stdout).toContain(`signature ok: ${ffmpegName} by ${FINGERPRINT}`)
    expect(result.stdout).toContain(`signature ok: ${zlibName} by ${FINGERPRINT}`)
    // No archive fetched: only the two signatures and the key, twice.
    const fetched = result.stdout.split('\n').filter((line) => line.startsWith('fetching '))
    expect(fetched.filter((line) => /\.asc$/.test(line))).toHaveLength(fetched.length)
    for (const name of f.names) expect(sha256(join(out, name)), name).toBe(f.shas[name])
    expect(readFileSync(join(out, 'BUILD.txt'), 'utf8')).toContain(f.shas[ffmpegName])
  })
})

/**
 * A gpg that imports anything and calls every signature good by the pinned
 * fingerprint, as a real one does for a good signature.
 */
function standInGpg(f: Fixture): NodeJS.ProcessEnv {
  const bin = join(f.dir, 'bin')
  mkdirSync(bin, { recursive: true })
  const stub = join(bin, 'gpg')
  writeFileSync(
    stub,
    '#!/usr/bin/env bash\n' +
      'for arg in "$@"; do\n' +
      '  [ "$arg" != --verify ] || echo "[GNUPG:] VALIDSIG 0 0 0 0 0 0 0 0 0 $GPG_FINGERPRINT"\n' +
      'done\n' +
      'exit 0\n',
  )
  chmodSync(stub, 0o755)
  return { PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, GPG_FINGERPRINT: FINGERPRINT }
}

/**
 * The environment for a curl that fails as ffmpeg.org's did on 29 Oct 2026
 * for its first `failures` calls, a stalled transfer having written part of
 * its file, and is the real one after.
 */
function failingCurl(f: Fixture, failures: number): NodeJS.ProcessEnv {
  const bin = join(f.dir, 'bin')
  mkdirSync(bin, { recursive: true })
  const stub = join(bin, 'curl')
  writeFileSync(
    stub,
    '#!/usr/bin/env bash\n' +
      'n=$(cat "$CURL_COUNT" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$CURL_COUNT"\n' +
      'if [ "$n" -le "$CURL_FAILURES" ]; then\n' +
      '  out=; prev=\n' +
      '  for arg in "$@"; do [ "$prev" != -o ] || out=$arg; prev=$arg; done\n' +
      '  [ -z "$out" ] || printf partial > "$out"\n' +
      '  echo "curl: (28) Operation too slow" >&2; exit 28\n' +
      'fi\n' +
      'exec "$REAL_CURL" "$@"\n',
  )
  chmodSync(stub, 0o755)
  return {
    PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
    CURL_COUNT: join(f.dir, 'count'),
    CURL_FAILURES: String(failures),
    REAL_CURL,
  }
}
