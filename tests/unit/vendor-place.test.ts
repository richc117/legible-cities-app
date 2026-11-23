// The last step of the two vendoring scripts (issue 744): the proven folder
// is put in place by one rename of its staging folder, which Windows refuses
// while anything holds a file in the folder open. `build.yml` failed there
// once on `main`, in `vendor / ffmpeg (win-x64)`, every check of the proof
// having passed, and passed when it was run again. place(), which both
// scripts carry word for word, tries the rename again for a bounded time,
// never copies, and refuses a destination a failed try left something at.
//
// scripts/vendor-ffmpeg.sh is run whole, in its --from mode, over a
// stand-in ffmpeg and ffprobe that answer what the proof asks, so the
// rename is reached the way a vendor job reaches it. scripts/vendor-python.sh
// cannot be: its pins have no stand-in, and its last line comes after the
// runtime's download, the locked packages and the sidecar's start. So its
// own lines are run instead, cut from the script as it stands and joined in
// the script's order: the cleanup it sets, the staging it makes, place() and
// everything after it to the end. Nothing in the script is there for the
// test. A stand-in `mv` first on PATH fails as Windows' did; a stand-in
// `sleep` writes down each wait and waits for none.

import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '../..')
const FFMPEG = join(repo, 'scripts', 'vendor-ffmpeg.sh')
const PYTHON = join(repo, 'scripts', 'vendor-python.sh')
// macOS runs these with its own bash, which is 3.2; where there is one at
// that path it is what runs them here too.
const BASH = existsSync('/bin/bash') ? '/bin/bash' : 'bash'

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function scratch(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lc-vendor-place-test-')))
  made.push(dir)
  return dir
}
/** A tool run with an argument array, never through a shell. */
function tool(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): SpawnSyncReturns<string> {
  return spawnSync(command, args, { encoding: 'utf8', timeout: 60_000, env, windowsHide: true })
}
// vendor-ffmpeg.sh reads its pins with a Python 3.9 or later. Windows runs
// both scripts under Git Bash, where a stand-in on PATH is another matter;
// the vendor jobs are what run them there.
const lacking =
  process.platform === 'win32' ||
  tool(BASH, [
    '-c',
    "command -v python3 mv sleep >/dev/null && python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))'",
  ]).status !== 0
const REAL_MV = lacking ? '' : tool(BASH, ['-c', 'command -v mv']).stdout.trim()

function executable(file: string, text: string): void {
  writeFileSync(file, text)
  chmodSync(file, 0o755)
}

interface StandIns {
  env: NodeJS.ProcessEnv
  /** How many times the script called mv. */
  moves: () => number
  /** The seconds each sleep was asked for, in order. */
  waits: () => string[]
}

/**
 * An `mv` that fails as Windows' did for its first `failures` calls, and is
 * the real one after; with `leaves`, a failed call first puts a file of that
 * name inside a folder at its destination, as an mv that had started to copy
 * would. And a `sleep` that writes down what it was asked for and returns.
 */
function standIns(dir: string, failures: number, leaves = ''): StandIns {
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const count = join(dir, 'mv-count')
  const slept = join(dir, 'slept')
  executable(
    join(bin, 'mv'),
    '#!/usr/bin/env bash\n' +
      'n=$(cat "$MV_COUNT" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$MV_COUNT"\n' +
      'if [ "$n" -le "$MV_FAILURES" ]; then\n' +
      '  if [ -n "$MV_LEAVES" ]; then mkdir -p "$2"; echo "part of a copy" > "$2/$MV_LEAVES"; fi\n' +
      "  echo \"mv: cannot move '$1' to '$2': Permission denied\" >&2; exit 1\n" +
      'fi\n' +
      'exec "$REAL_MV" "$@"\n',
  )
  executable(join(bin, 'sleep'), '#!/usr/bin/env bash\necho "$1" >> "$SLEEP_LOG"\n')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
    MV_COUNT: count,
    MV_FAILURES: String(failures),
    MV_LEAVES: leaves,
    REAL_MV,
    SLEEP_LOG: slept,
    GITHUB_ACTIONS: '',
  }
  // The script's own default, unless a test names another.
  delete env.VENDOR_PLACE_BACKOFF
  return {
    env,
    moves: () => (existsSync(count) ? Number(readFileSync(count, 'utf8')) : 0),
    waits: () => (existsSync(slept) ? readFileSync(slept, 'utf8').trim().split('\n') : []),
  }
}

/** The lines of `text` from the first that starts with `from` to the first after it that starts with `to`, both kept. */
function lines(text: string, from: string, to: string): string {
  const all = text.split('\n')
  const first = all.findIndex((line) => line.startsWith(from))
  expect(first, `a line starting with ${from}`).toBeGreaterThanOrEqual(0)
  const last = all.findIndex((line, index) => index > first && line.startsWith(to))
  expect(last, `a line starting with ${to}, after the one starting with ${from}`).toBeGreaterThan(
    first,
  )
  return `${all.slice(first, last + 1).join('\n')}\n`
}
/** `text` from the first line that starts with `from` to its end. */
function tail(text: string, from: string): string {
  const all = text.split('\n')
  const first = all.findIndex((line) => line.startsWith(from))
  expect(first, `a line starting with ${from}`).toBeGreaterThanOrEqual(0)
  return all.slice(first).join('\n')
}
/** place() as a script carries it, its comment included. */
function place(script: string): string {
  return lines(readFileSync(script, 'utf8'), '# place <stage> <dest>:', '}')
}

// ---------------------------------------------------------------------------
// scripts/vendor-ffmpeg.sh, whole
// ---------------------------------------------------------------------------

const CONFIGURE = '--enable-gpl --enable-version3 --enable-libx264'
// One program under both names: the version and configure line the pins
// name, every listing the proof reads, a file for every output it is asked
// for (ten for a frame pattern), and for ffprobe what the proof expects of
// each file. It proves nothing about FFmpeg; it is what lets the script run
// to its last line.
const STAND_IN_FFMPEG = `#!/usr/bin/env bash
me=$(basename "$0")
args=" $* "
for last in "$@"; do :; done
case "$args" in
  *" -version "*) printf '%s version 1.2.3 a stand-in\\nconfiguration: ${CONFIGURE}\\n' "$me"; exit 0 ;;
  *" -L "*) echo "a stand-in"; exit 0 ;;
esac
if [ "$me" = ffprobe ]; then
  case "$last:$args" in
    *format=duration*) echo 1.000000 ;;
    test.mp4:*" a:0 "*) echo codec_name=aac ;;
    test.mp4:*) printf 'codec_name=h264\\nprofile=High\\nwidth=64\\nheight=64\\npix_fmt=yuv420p\\nnb_read_frames=10\\n' ;;
    test.gif:*) printf 'codec_name=gif\\nwidth=48\\nheight=48\\nnb_read_frames=10\\n' ;;
    still.png:*) printf 'codec_name=png\\nwidth=32\\nheight=32\\n' ;;
    still.jpg:*) printf 'codec_name=mjpeg\\nwidth=32\\nheight=32\\n' ;;
    poster.jpg:*) printf 'codec_name=mjpeg\\nwidth=64\\nheight=64\\n' ;;
    *) echo "the stand-in ffprobe was not told about $last" >&2; exit 1 ;;
  esac
  exit 0
fi
for listing in encoders decoders filters muxers demuxers devices protocols; do
  case "$args" in
    *" -$listing "*)
      printf ' .. %s\\n' libx264 aac gif png mjpeg h264 scale format fade palettegen paletteuse \\
        anullsrc mp4 image2 mov lavfi file pipe
      exit 0 ;;
  esac
done
case "$last" in
  *%06d*) for i in 1 2 3 4 5 6 7 8 9 10; do echo frame > "$(printf "$last" "$i")"; done ;;
  *) echo "$me wrote this" > "$last" ;;
esac
`

interface FfmpegFixture {
  dir: string
  pins: string
  /** The folder --from names, holding the stand-in pair. */
  built: string
  outdir: string
  /** Where the pair is put: <outdir>/linux-x64, holding an older pair's file. */
  dest: string
}

/** Pins of the real one's shape, a stand-in pair to prove, and an older pair in place. */
function ffmpegFixture(): FfmpegFixture {
  const dir = scratch()
  const pins = join(dir, 'pins.json')
  const archive = { url: 'https://example.invalid/a.tar', sha256: '0'.repeat(64) }
  writeFileSync(
    pins,
    JSON.stringify({
      ffmpeg: {
        version: '1.2.3',
        source: archive,
        x264: { repo: 'https://example.invalid/x264.git', commit: 'c'.repeat(40), sha256: '0' },
        zlib: { version: '4.5.6', ...archive },
        targets: { 'linux-x64': { reports: '1.2.3', configure: CONFIGURE } },
      },
    }),
  )
  const built = join(dir, 'built')
  mkdirSync(built)
  executable(join(built, 'ffmpeg'), STAND_IN_FFMPEG)
  executable(join(built, 'ffprobe'), STAND_IN_FFMPEG)
  const outdir = join(dir, 'vendor')
  const dest = join(outdir, 'linux-x64')
  mkdirSync(dest, { recursive: true })
  writeFileSync(join(dest, 'older'), 'the pair vendored before\n')
  return { dir, pins, built, outdir, dest }
}

/** `vendor-ffmpeg.sh --from <built> linux-x64 <outdir>`: the proof, then the rename. */
function prove(f: FfmpegFixture, env: NodeJS.ProcessEnv): SpawnSyncReturns<string> {
  return tool(BASH, [FFMPEG, '--from', f.built, 'linux-x64', f.outdir], {
    ...env,
    VENDOR_FFMPEG_PINS: f.pins,
    VENDOR_FFMPEG_BACKOFF: '0',
  })
}

describe.skipIf(lacking)('vendor-ffmpeg.sh, the rename that puts the proven pair in place', () => {
  it('tries the rename again after a refused try, and puts the proven pair in place', () => {
    const f = ffmpegFixture()
    const s = standIns(f.dir, 2)
    const result = prove(f, { ...s.env, GITHUB_ACTIONS: 'true' })
    expect(result.status, result.stderr).toBe(0)
    // The staged files, whole, and the older pair gone; no staging folder.
    expect(readdirSync(f.dest).sort()).toEqual(['ffmpeg', 'ffprobe'])
    expect(readFileSync(join(f.dest, 'ffmpeg'), 'utf8')).toBe(STAND_IN_FFMPEG)
    expect(readFileSync(join(f.dest, 'ffprobe'), 'utf8')).toBe(STAND_IN_FFMPEG)
    expect(readdirSync(f.outdir)).toEqual(['linux-x64'])
    expect(s.moves()).toBe(3)
    const to = `to rename the staging folder to ${f.dest}`
    expect(result.stderr).toContain(`try 1 of 5 ${to} failed; trying again in 1 s`)
    expect(result.stderr).toContain(`try 2 of 5 ${to} failed; trying again in 2 s`)
    expect(result.stderr).toContain(
      `::warning::the staging folder was renamed to ${f.dest} on try 3 of 5`,
    )
    expect(result.stdout).toContain('vendored ffmpeg 1.2.3 for linux-x64')
  })

  it('gives up on the pair after five refused tries, and leaves nothing behind', () => {
    const f = ffmpegFixture()
    const s = standIns(f.dir, 99)
    const result = prove(f, s.env)
    expect(result.status).toBe(1)
    expect(s.moves()).toBe(5)
    expect(s.waits()).toEqual(['1', '2', '4', '8'])
    // mv's own words, five times, and then the script's one line.
    expect(result.stderr.match(/^mv: cannot move .*: Permission denied$/gm)).toHaveLength(5)
    expect(result.stderr).toContain(`could not rename the staging folder to ${f.dest} in 5 tries`)
    // Nothing at the destination, and the staging folder removed with it.
    expect(readdirSync(f.outdir)).toEqual([])
    expect(result.stdout).not.toContain('vendored ffmpeg')
  })

  it('refuses a pair a refused try left part of at the destination, and never tries over it', () => {
    const f = ffmpegFixture()
    // One failure only: a second try would be the real mv, which puts the
    // staging folder inside what the first left and exits 0.
    const s = standIns(f.dir, 1, 'ffmpeg')
    const result = prove(f, s.env)
    expect(result.status).toBe(1)
    expect(s.moves()).toBe(1)
    expect(s.waits()).toEqual([])
    expect(result.stderr).toContain(
      `try 1 of 5 to rename the staging folder to ${f.dest} failed and left something there: it is refused`,
    )
    // What the try left is as it left it, and the staging folder is removed.
    expect(readdirSync(f.outdir)).toEqual(['linux-x64'])
    expect(readdirSync(f.dest)).toEqual(['ffmpeg'])
    expect(readFileSync(join(f.dest, 'ffmpeg'), 'utf8')).toBe('part of a copy\n')
    expect(result.stdout).not.toContain('vendored ffmpeg')
  })

  it('refuses a wait that is not a whole number of seconds, before the proof and not after it', () => {
    const f = ffmpegFixture()
    const s = standIns(f.dir, 0)
    const result = prove(f, { ...s.env, VENDOR_PLACE_BACKOFF: 'soon' })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("VENDOR_PLACE_BACKOFF is a whole number of seconds, not 'soon'")
    expect(s.moves()).toBe(0)
    expect(readdirSync(f.dest)).toEqual(['older'])
  })
})

// ---------------------------------------------------------------------------
// scripts/vendor-python.sh, its own lines around the rename
// ---------------------------------------------------------------------------

interface PythonFixture {
  dir: string
  /** The script's lines, joined. */
  harness: string
  outdir: string
  /** <outdir>/darwin-arm64, holding an older runtime's file. */
  dest: string
}

/**
 * The script's cleanup, its staging, a runtime of one file in the staging
 * folder in place of everything the script does to fill and check one, and
 * the script from place() to its end.
 */
function pythonFixture(): PythonFixture {
  const dir = scratch()
  const script = readFileSync(PYTHON, 'utf8')
  expect(script).toContain('\nset -euo pipefail\n')
  const harness = join(dir, 'the-end-of-vendor-python.sh')
  writeFileSync(
    harness,
    '#!/usr/bin/env bash\n' +
      'set -euo pipefail\n' +
      'target=$1\n' +
      'outdir=$2\n' +
      lines(script, 'work=$(mktemp -d)', 'trap ') +
      lines(script, 'dest="$outdir/$target"', 'stage=$(mktemp -d ') +
      'mkdir -p "$stage/python/bin"\n' +
      'echo "the proven runtime" > "$stage/python/bin/python3"\n' +
      tail(script, '# place <stage> <dest>:'),
  )
  const outdir = join(dir, 'vendor')
  const dest = join(outdir, 'darwin-arm64')
  mkdirSync(dest, { recursive: true })
  writeFileSync(join(dest, 'older'), 'the runtime vendored before\n')
  return { dir, harness, outdir, dest }
}

function finish(f: PythonFixture, env: NodeJS.ProcessEnv): SpawnSyncReturns<string> {
  return tool(BASH, [f.harness, 'darwin-arm64', f.outdir], env)
}

describe.skipIf(lacking)(
  'vendor-python.sh, the rename that puts the proven runtime in place',
  () => {
    it('puts the runtime in place at the first try, and says nothing of tries', () => {
      const f = pythonFixture()
      const s = standIns(f.dir, 0)
      const result = finish(f, s.env)
      expect(result.status, result.stderr).toBe(0)
      expect(readdirSync(f.dest)).toEqual(['python'])
      expect(readdirSync(f.outdir)).toEqual(['darwin-arm64'])
      expect(s.moves()).toBe(1)
      expect(s.waits()).toEqual([])
      expect(result.stderr).toBe('')
    })

    it('tries the rename again after a refused try, and puts the proven runtime in place', () => {
      const f = pythonFixture()
      const s = standIns(f.dir, 2)
      const result = finish(f, s.env)
      expect(result.status, result.stderr).toBe(0)
      expect(readdirSync(f.dest)).toEqual(['python'])
      expect(readFileSync(join(f.dest, 'python', 'bin', 'python3'), 'utf8')).toBe(
        'the proven runtime\n',
      )
      expect(readdirSync(f.outdir)).toEqual(['darwin-arm64'])
      expect(s.moves()).toBe(3)
      const to = `to rename the staging folder to ${f.dest}`
      expect(result.stderr).toContain(`try 1 of 5 ${to} failed; trying again in 1 s`)
      expect(result.stderr).toContain(`try 2 of 5 ${to} failed; trying again in 2 s`)
      expect(result.stderr).toContain(`the staging folder was renamed to ${f.dest} on try 3 of 5`)
      expect(result.stderr).not.toContain('::warning::')
      expect(result.stdout).toContain('vendored darwin-arm64: ')
    })

    it('gives up on the runtime after five refused tries, and leaves nothing behind', () => {
      const f = pythonFixture()
      const s = standIns(f.dir, 99)
      const result = finish(f, s.env)
      expect(result.status).toBe(1)
      expect(s.moves()).toBe(5)
      // 1, 2, 4 and 8 seconds: fifteen in all, and none of them waited here.
      expect(s.waits()).toEqual(['1', '2', '4', '8'])
      expect(result.stderr.match(/^mv: cannot move .*: Permission denied$/gm)).toHaveLength(5)
      expect(result.stderr).toContain(`could not rename the staging folder to ${f.dest} in 5 tries`)
      // Nothing at the destination, and the staging folder removed with it.
      expect(readdirSync(f.outdir)).toEqual([])
      expect(result.stdout).not.toContain('vendored darwin-arm64')
    })

    it('waits as long as VENDOR_PLACE_BACKOFF says, which may be no time at all', () => {
      const f = pythonFixture()
      const s = standIns(f.dir, 2)
      const result = finish(f, { ...s.env, VENDOR_PLACE_BACKOFF: '0' })
      expect(result.status, result.stderr).toBe(0)
      expect(s.waits()).toEqual(['0', '0'])
      expect(result.stderr).toContain('failed; trying again in 0 s')
      // Any whole number the check at the top lets through, read in base ten:
      // to the shell's arithmetic a leading zero means octal, and 08 is an error.
      const other = pythonFixture()
      const t = standIns(other.dir, 3)
      const later = finish(other, { ...t.env, VENDOR_PLACE_BACKOFF: '08' })
      expect(later.status, later.stderr).toBe(0)
      expect(t.waits()).toEqual(['08', '16', '32'])
    })

    it('refuses a runtime a refused try left part of at the destination, and never tries over it', () => {
      const f = pythonFixture()
      // One failure only: a second try would be the real mv, which puts the
      // staging folder inside what the first left and exits 0.
      const s = standIns(f.dir, 1, 'python')
      const result = finish(f, s.env)
      expect(result.status).toBe(1)
      expect(s.moves()).toBe(1)
      expect(result.stderr).toContain(
        `try 1 of 5 to rename the staging folder to ${f.dest} failed and left something there: it is refused`,
      )
      expect(readdirSync(f.outdir)).toEqual(['darwin-arm64'])
      expect(readdirSync(f.dest)).toEqual(['python'])
      expect(readFileSync(join(f.dest, 'python'), 'utf8')).toBe('part of a copy\n')
      expect(result.stdout).not.toContain('vendored darwin-arm64')
    })

    it('refuses a destination that is there again before the first try, and moves nothing into it', () => {
      const f = pythonFixture()
      const s = standIns(f.dir, 0)
      // An rm that says it removed the older runtime and did not, once: mv,
      // given a folder at the destination, puts the staging folder inside it
      // and exits 0.
      const real = tool(BASH, ['-c', 'command -v rm']).stdout.trim()
      executable(
        join(f.dir, 'bin', 'rm'),
        '#!/usr/bin/env bash\n' +
          'if [ ! -e "$RM_DONE" ]; then echo once > "$RM_DONE"; exit 0; fi\n' +
          'exec "$REAL_RM" "$@"\n',
      )
      const result = finish(f, { ...s.env, RM_DONE: join(f.dir, 'rm-done'), REAL_RM: real })
      expect(result.status).toBe(1)
      expect(s.moves()).toBe(0)
      expect(result.stderr).toBe(
        `something is at ${f.dest} again before the staging folder was renamed to it: it is refused, and left as it is\n`,
      )
      expect(readdirSync(f.outdir)).toEqual(['darwin-arm64'])
      expect(readdirSync(f.dest)).toEqual(['older'])
    })

    it('refuses a wait that is not a whole number of seconds, before anything is fetched', () => {
      // The script itself, which stops here long before it reaches a network:
      // without the check it goes on, reads the pins, and refuses the folder as not a git checkout.
      const engine = scratch()
      const env = { ...process.env, VENDOR_PLACE_BACKOFF: 'soon' }
      const result = tool(BASH, [PYTHON, 'darwin-arm64', engine, join(engine, 'vendor')], env)
      expect(result.status).toBe(2)
      expect(result.stderr).toBe("VENDOR_PLACE_BACKOFF is a whole number of seconds, not 'soon'\n")
      expect(readdirSync(engine)).toEqual([])
    })
  },
)

// ---------------------------------------------------------------------------
// One place(), in two scripts
// ---------------------------------------------------------------------------

// Each script carries its own, because each source archive a release
// attaches carries the script that built its binary and what that script
// sources, and a third file would be in neither. So the two are held to one
// text here, and what the ffmpeg tests above prove of one is true of both.
describe('place(), in both vendoring scripts', () => {
  it('is the same in scripts/vendor-ffmpeg.sh and scripts/vendor-python.sh, word for word', () => {
    const ffmpeg = place(FFMPEG)
    expect(ffmpeg).toContain('\nplace() {\n')
    expect(place(PYTHON)).toBe(ffmpeg)
  })

  it('only ever renames: no script copies the staging folder, or moves its files one by one', () => {
    for (const script of [FFMPEG, PYTHON]) {
      const text = readFileSync(script, 'utf8')
      const body = place(script)
        .split('\n')
        .filter((line) => !line.startsWith('#'))
      expect(body.filter((line) => /\b(cp|rsync|tar|ditto|robocopy|xcopy)\b/.test(line))).toEqual(
        [],
      )
      expect(body.filter((line) => /\bmv\b/.test(line))).toEqual(['    if mv "$from" "$to"; then'])
      // And the staging folder is handed to nothing else on its way there.
      const after = tail(text, '# Only now is the old ').split('\n')
      expect(after.slice(1, 4)).toEqual(['rm -rf "$dest"', 'place "$stage" "$dest"', 'stage='])
    }
  })
})

describe.skipIf(!existsSync('/bin/bash'))('the vendoring scripts, under /bin/bash', () => {
  it('parse under the system bash, whatever its version', () => {
    for (const script of [FFMPEG, PYTHON]) {
      const r = tool('/bin/bash', ['-n', script])
      expect(r.stderr, script).toBe('')
      expect(r.status, script).toBe(0)
    }
  })
})
