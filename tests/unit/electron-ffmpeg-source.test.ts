// The cache of the source of Electron's FFmpeg library (issue 585, ADR-043):
// the vendor job keeps the archive between runs and uses a cached copy only
// once the script's --verify, which needs no network, has held it to the
// pins and this checkout. A small archive of the pins' shape, with pins made
// from its own trees, stands in for the real one, whose fetch takes minutes
// and the network; the real archive was put through the same checks by hand.

import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '../..')
const SCRIPT = join(repo, 'scripts', 'electron-ffmpeg-source.sh')
const VENDOR = join(repo, '.github', 'workflows', 'vendor.yml')
interface Pins {
  electron: { version: string }
  ffmpeg: { tree: string; reports: string }
  chromium_trees: Record<string, { tree: string }>
  chromium_deps: Record<string, { tree: string }>
  electron_files: Record<string, string>
}
const PINS = (
  JSON.parse(readFileSync(join(repo, 'vendor', 'pins.json'), 'utf8')) as {
    electron_ffmpeg: Pins
  }
).electron_ffmpeg
const NAME = `electron-ffmpeg-${PINS.electron.version}-source`
const ARCHIVE = `${NAME}.tar.xz`
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-electron-ffmpeg-test-'))
  made.push(dir)
  return dir
}
function put(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
/** A tool run with an argument array, never through a shell. */
function tool(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = GIT_ENV,
): SpawnSyncReturns<string> {
  return spawnSync(command, args, { encoding: 'utf8', timeout: 60_000, env, windowsHide: true })
}
// The script's --verify needs bash, git, python3, cmp, xz and GNU tar, as
// tar or gtar, since it packs what it checked again as the fetch packs; the
// names are fixed, and the line fails when any one is missing. macOS has
// no GNU tar unless one was installed, so these run on Linux.
const lacking =
  process.platform === 'win32' ||
  tool('bash', [
    '-c',
    'command -v git python3 cmp xz >/dev/null && ' +
      '{ tar --version 2>/dev/null | grep -q "GNU tar" || gtar --version 2>/dev/null | grep -q "GNU tar"; }',
  ]).status !== 0

function script(args: string[], pinsFile: string, extra: Record<string, string> = {}) {
  return tool('bash', [SCRIPT, ...args], {
    ...process.env,
    ELECTRON_FFMPEG_PINS: pinsFile,
    ...extra,
  })
}

/**
 * An archive of the pins' shape: its tree, the pins its ids make, a plain
 * packer and the good archive, which is what the script packs the tree to.
 */
function fixture(): {
  base: string
  good: string
  pinsFile: string
  pack: (from: string) => string
  copy: () => string
} {
  const dir = scratch()
  const base = join(dir, 'base')
  const root = join(base, NAME)
  const ffmpeg = join(root, 'src', 'third_party', 'ffmpeg')
  put(join(ffmpeg, 'BUILD.gn'), 'shared_library("ffmpeg") {}\n')
  put(join(ffmpeg, 'COPYING.LGPLv2.1'), 'GNU LESSER GENERAL PUBLIC LICENSE\n')
  put(
    join(ffmpeg, 'chromium', 'config', 'Chrome', 'mac', 'arm64', 'libavutil', 'ffversion.h'),
    `#define FFMPEG_VERSION "${PINS.ffmpeg.reports}"\n`,
  )
  for (const path of [...Object.keys(PINS.chromium_trees), ...Object.keys(PINS.chromium_deps)]) {
    put(join(root, 'src', path, 'BUILD.gn'), `# ${path}\n`)
  }
  for (const path of Object.keys(PINS.electron_files))
    put(join(root, 'electron', path), `${path}\n`)

  const treeId = (folder: string): string => {
    const result = tool('bash', [SCRIPT, '--tree-id', folder])
    expect(result.status, result.stderr).toBe(0)
    return result.stdout.trim()
  }
  const blob = (file: string): string => {
    const result = tool('git', ['hash-object', '--no-filters', file])
    expect(result.status, result.stderr).toBe(0)
    return result.stdout.trim()
  }
  const pins = structuredClone(PINS)
  pins.ffmpeg.tree = treeId(ffmpeg)
  for (const path of Object.keys(pins.chromium_trees)) {
    pins.chromium_trees[path].tree = treeId(join(root, 'src', path))
  }
  for (const path of Object.keys(pins.chromium_deps)) {
    pins.chromium_deps[path].tree = treeId(join(root, 'src', path))
  }
  for (const path of Object.keys(pins.electron_files)) {
    pins.electron_files[path] = blob(join(root, 'electron', path))
  }
  const pinsFile = join(dir, 'pins.json')
  writeFileSync(pinsFile, `${JSON.stringify({ electron_ffmpeg: pins }, null, 2)}\n`)
  put(join(root, 'legible-cities', 'pins.json'), readFileSync(pinsFile, 'utf8'))
  copyFileSync(SCRIPT, join(root, 'legible-cities', 'electron-ffmpeg-source.sh'))
  copyFileSync(VENDOR, join(root, 'legible-cities', 'vendor.yml'))
  // A BUILD.txt that names its packer and nothing else; --verify, refusing
  // it, leaves the one the pins make in its work folder, which replaces it.
  put(
    join(root, 'BUILD.txt'),
    'Written by scripts/electron-ffmpeg-source.sh, run by the electron-ffmpeg-source job\n' +
      'of .github/workflows/vendor.yml, of https://github.com/example/app at commit ' +
      `${'a'.repeat(40)}.\n`,
  )

  let packs = 0
  const pack = (from: string): string => {
    const out = join(dir, `pack-${++packs}`)
    mkdirSync(out)
    const tar = join(out, `${NAME}.tar`)
    // COPYFILE_DISABLE keeps macOS's tar from adding ._ files of its own.
    const made = tool('tar', ['-c', '-f', tar, '-C', from, NAME], {
      ...GIT_ENV,
      COPYFILE_DISABLE: '1',
    })
    expect(made.status, made.stderr).toBe(0)
    const xz = tool('xz', ['-z', '-f', '-T1', tar])
    expect(xz.status, xz.stderr).toBe(0)
    return join(out, ARCHIVE)
  }
  const copy = (): string => {
    const to = join(dir, `copy-${++packs}`)
    cpSync(base, to, { recursive: true })
    return to
  }

  const work = join(dir, 'work')
  const first = script(['--verify', pack(base)], pinsFile, { ELECTRON_FFMPEG_WORK: work })
  expect(first.status).toBe(1)
  expect(first.stderr).toContain(
    `${ARCHIVE}'s BUILD.txt is not the one the pins make for https://github.com/example/app at commit ${'a'.repeat(40)}`,
  )
  copyFileSync(join(work, 'BUILD.txt'), join(root, 'BUILD.txt'))
  // Packed by a plain tar, the right files are still not the archive the
  // script packs; --verify, refusing it, leaves that one in its work folder.
  const again = join(dir, 'work-again')
  const second = script(['--verify', pack(base)], pinsFile, { ELECTRON_FFMPEG_WORK: again })
  expect(second.stderr).toContain(
    `::error::${ARCHIVE} is not what its checked files pack to, so it holds bytes the checks did not read`,
  )
  expect(second.status).toBe(1)
  return { base, good: join(again, 'repacked', ARCHIVE), pinsFile, pack, copy }
}

/** --verify over an archive, which must be refused with the message given. */
function refused(archive: string, pinsFile: string, message: string): void {
  const result = script(['--verify', archive], pinsFile)
  expect(result.stderr).toContain(`::error::${message}`)
  expect(result.status).toBe(1)
  expect(result.stdout).not.toContain('verified')
}

// Each case spawns the script a few times; on a loaded runner a case can
// pass the default deadline, so the cases have a longer one.
describe.skipIf(lacking)(
  '--verify, the offline check of a cached archive',
  { timeout: 90_000 },
  () => {
    it('passes an archive whose every id, copy and BUILD.txt is the pins and the checkout', () => {
      const { good: archive, pinsFile } = fixture()
      const result = script(['--verify', archive], pinsFile)
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      expect(result.stdout).toContain(`src/third_party/ffmpeg: tree `)
      expect(result.stdout).toContain(
        "legible-cities/: this checkout's script, workflow and pins, byte for byte",
      )
      expect(result.stdout).toContain(
        `BUILD.txt: the pins', packed by https://github.com/example/app at commit ${'a'.repeat(40)}`,
      )
      expect(result.stdout).toContain(`verified ${archive} against the pins, offline: `)
    })

    it('refuses a BUILD.txt that is not the one the pins make, or that names no packer', () => {
      // The first refusal is the fixture's own, with the placeholder.
      const { pinsFile, pack, copy } = fixture()
      const other = copy()
      const build = join(other, NAME, 'BUILD.txt')
      writeFileSync(build, readFileSync(build, 'utf8').replace('Licence: ', 'Licence:  '))
      refused(pack(other), pinsFile, `${ARCHIVE}'s BUILD.txt is not the one the pins make`)
      const bare = copy()
      writeFileSync(join(bare, NAME, 'BUILD.txt'), 'nothing\n')
      refused(pack(bare), pinsFile, `${ARCHIVE}'s BUILD.txt names no repository and commit`)
    })

    it("refuses a changed byte in FFmpeg's files by their tree id", () => {
      const { pinsFile, pack, copy } = fixture()
      const other = copy()
      const file = join(other, NAME, 'src', 'third_party', 'ffmpeg', 'BUILD.gn')
      writeFileSync(file, readFileSync(file, 'utf8').replace('{', '['))
      refused(pack(other), pinsFile, `${ARCHIVE}'s src/third_party/ffmpeg makes tree `)
    })

    it('refuses a changed Chromium directory and a DEPS entry by their tree ids', () => {
      const { pinsFile, pack, copy } = fixture()
      const [tree] = Object.keys(PINS.chromium_trees)
      const other = copy()
      put(join(other, NAME, 'src', tree, 'extra.gni'), 'extra\n')
      refused(pack(other), pinsFile, `${ARCHIVE}'s src/${tree} makes tree `)
      const [dep] = Object.keys(PINS.chromium_deps)
      const again = copy()
      writeFileSync(join(again, NAME, 'src', dep, 'BUILD.gn'), 'changed\n')
      refused(pack(again), pinsFile, `${ARCHIVE}'s src/${dep} makes tree `)
    })

    it('refuses an FFmpeg configuration that reports another version', () => {
      const { pinsFile, pack, copy } = fixture()
      const other = copy()
      const header = join(
        other,
        NAME,
        'src/third_party/ffmpeg/chromium/config/Chrome/mac/arm64/libavutil/ffversion.h',
      )
      writeFileSync(header, '#define FFMPEG_VERSION "n0.0"\n')
      // The tree id changes too, and it is checked first.
      refused(pack(other), pinsFile, `${ARCHIVE}'s src/third_party/ffmpeg makes tree `)
    })

    it('refuses an Electron file by its blob id, and a missing one by name', () => {
      const { pinsFile, pack, copy } = fixture()
      const [file, second] = Object.keys(PINS.electron_files)
      const other = copy()
      writeFileSync(join(other, NAME, 'electron', file), 'changed\n')
      refused(pack(other), pinsFile, `${ARCHIVE}'s electron/${file} is blob `)
      const missing = copy()
      rmSync(join(missing, NAME, 'electron', second))
      refused(pack(missing), pinsFile, `${ARCHIVE} does not hold ${NAME}/electron/${second}`)
    })

    it("refuses copies in legible-cities/ that are not this checkout's files", () => {
      const { pinsFile, pack, copy } = fixture()
      for (const [file, message] of [
        [
          'vendor.yml',
          `${ARCHIVE}'s legible-cities/vendor.yml is not this checkout's .github/workflows/vendor.yml`,
        ],
        [
          'electron-ffmpeg-source.sh',
          `${ARCHIVE}'s legible-cities/electron-ffmpeg-source.sh is not this checkout's scripts/electron-ffmpeg-source.sh`,
        ],
        ['pins.json', `${ARCHIVE}'s legible-cities/pins.json is not the pins this run reads`],
      ]) {
        const other = copy()
        const path = join(other, NAME, 'legible-cities', file)
        writeFileSync(path, `${readFileSync(path, 'utf8')}\n`)
        refused(pack(other), pinsFile, message)
      }
    })

    it('refuses git metadata, and any file the pins do not name', () => {
      const { pinsFile, pack, copy } = fixture()
      const git = copy()
      put(join(git, NAME, 'src', 'third_party', 'ffmpeg', '.git', 'HEAD'), 'ref: refs/heads/main\n')
      refused(pack(git), pinsFile, `${ARCHIVE} carries git metadata`)
      for (const extra of [
        'NOTES.txt',
        'electron/patches/extra.patch',
        'legible-cities/extra.sh',
      ]) {
        const other = copy()
        put(join(other, NAME, extra), 'extra\n')
        refused(
          pack(other),
          pinsFile,
          `${ARCHIVE} holds ${NAME}/${extra}, which is none of the parts the pins name`,
        )
      }
    })

    it('refuses a symbolic link, a hard link and a name twice, before anything is unpacked', () => {
      const { pinsFile, pack, copy } = fixture()
      const ffmpeg = join(NAME, 'src', 'third_party', 'ffmpeg')
      const soft = copy()
      rmSync(join(soft, ffmpeg, 'BUILD.gn'))
      symlinkSync('COPYING.LGPLv2.1', join(soft, ffmpeg, 'BUILD.gn'))
      refused(
        pack(soft),
        pinsFile,
        `${ARCHIVE} holds ${ffmpeg}/BUILD.gn, which is a symbolic link: only files and folders are packed`,
      )
      const hard = copy()
      rmSync(join(hard, ffmpeg, 'BUILD.gn'))
      linkSync(join(hard, ffmpeg, 'COPYING.LGPLv2.1'), join(hard, ffmpeg, 'BUILD.gn'))
      refused(pack(hard), pinsFile, 'which is a hard link: only files and folders are packed')

      // A file appended to the tar again, so the name is there twice and
      // unpacking would keep only the second.
      const twice = copy()
      const out = join(scratch(), 'twice')
      mkdirSync(out)
      const tar = join(out, `${NAME}.tar`)
      const env = { ...GIT_ENV, COPYFILE_DISABLE: '1' }
      expect(tool('tar', ['-c', '-f', tar, '-C', twice, NAME], env).status).toBe(0)
      writeFileSync(join(twice, NAME, 'BUILD.txt'), 'another\n')
      expect(tool('tar', ['-r', '-f', tar, '-C', twice, `${NAME}/BUILD.txt`], env).status).toBe(0)
      expect(tool('xz', ['-z', '-T1', tar]).status).toBe(0)
      refused(join(out, ARCHIVE), pinsFile, `${ARCHIVE} holds ${NAME}/BUILD.txt twice`)
    })

    it('refuses the good archive with bytes after its end, inside the xz or as a second stream', () => {
      const { good, pinsFile } = fixture()
      const inside = join(scratch(), 'inside')
      mkdirSync(inside)
      copyFileSync(good, join(inside, ARCHIVE))
      expect(tool('xz', ['-d', join(inside, ARCHIVE)]).status).toBe(0)
      appendFileSync(join(inside, `${NAME}.tar`), `unread\n${'\0'.repeat(1024)}`)
      expect(tool('xz', ['-z', '-T1', join(inside, `${NAME}.tar`)]).status).toBe(0)
      const message = `${ARCHIVE} is not what its checked files pack to, so it holds bytes the checks did not read`
      refused(join(inside, ARCHIVE), pinsFile, message)

      const stream = join(scratch(), 'stream')
      mkdirSync(stream)
      writeFileSync(join(stream, 'junk'), 'unread\n')
      expect(tool('xz', ['-z', '-T1', join(stream, 'junk')]).status).toBe(0)
      copyFileSync(good, join(stream, ARCHIVE))
      appendFileSync(join(stream, ARCHIVE), readFileSync(join(stream, 'junk.xz')))
      refused(join(stream, ARCHIVE), pinsFile, message)
    })

    it('refuses an archive by another name, and a lock for another Electron', () => {
      const { base, pinsFile, pack } = fixture()
      const archive = pack(base)
      const renamed = join(dirname(archive), 'electron-ffmpeg-99.0.0-source.tar.xz')
      copyFileSync(archive, renamed)
      refused(renamed, pinsFile, `${renamed} is not ${ARCHIVE}, the archive the pins name`)

      const lock = join(scratch(), 'package-lock.json')
      writeFileSync(
        lock,
        JSON.stringify({ packages: { 'node_modules/electron': { version: '99.0.0' } } }),
      )
      const result = script(['--verify', archive], pinsFile, { ELECTRON_FFMPEG_LOCK: lock })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('package-lock.json installs Electron 99.0.0')
    })
  },
)

// The job itself cannot run here; its shape is held: a cached archive is
// verified before it is uploaded, a miss is fetched and verified before it
// is saved, and the key is what the archive copies.
describe('the electron-ffmpeg-source job, for the cache', () => {
  const vendor = readFileSync(VENDOR, 'utf8')
  const start = vendor.indexOf('\n  electron-ffmpeg-source:\n')
  const rest = vendor.slice(start + 1)
  const next = rest.search(/\n {2}[a-z][a-z-]*:\n/)
  const job = next === -1 ? rest : rest.slice(0, next)
  const steps = job
    .split('\n      - ')
    .slice(1)
    .map((step) => `${step}\n`)
  const at = (needle: string): number => {
    const index = steps.findIndex((step) => step.includes(needle))
    expect(index, `a step with ${needle}`).toBeGreaterThanOrEqual(0)
    return index
  }

  it("uses determinism.yml's pin of actions/cache, as restore and save, and nothing else new", () => {
    const determinism = readFileSync(join(repo, '.github', 'workflows', 'determinism.yml'), 'utf8')
    const pin = /uses: actions\/cache@([0-9a-f]{40}) # (v[\d.]+)\n/.exec(determinism)
    expect(pin).not.toBeNull()
    const [, sha, version] = pin ?? []
    const uses = [...job.matchAll(/uses: (\S+) # (\S+)/g)].map((m) => `${m[1]} # ${m[2]}`)
    expect(uses).toEqual([
      'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
      `actions/cache/restore@${sha} # ${version}`,
      `actions/cache/save@${sha} # ${version}`,
      'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2',
    ])
    expect(job).not.toContain('restore-keys')
  })

  it('keys the cache on the Electron version and the three files the archive copies', () => {
    const source = readFileSync(SCRIPT, 'utf8')
    // What the script copies into legible-cities/, and nothing else.
    const copies = source
      .split('\n')
      .filter((line) => line.startsWith('cp ') && line.includes('"$root/legible-cities/'))
    expect(copies).toEqual([
      'cp "$here/scripts/electron-ffmpeg-source.sh" "$here/.github/workflows/vendor.yml" "$root/legible-cities/"',
      'cp "$pins" "$root/legible-cities/pins.json"',
    ])
    const restore = steps[at('uses: actions/cache/restore@')]
    expect(restore).toContain(
      "key: electron-ffmpeg-source-${{ steps.pins.outputs.electron }}-${{ hashFiles('vendor/pins.json', 'scripts/electron-ffmpeg-source.sh', '.github/workflows/vendor.yml') }}\n",
    )
    expect(restore).toContain('path: electron-ffmpeg-cache\n')
    const save = steps[at('uses: actions/cache/save@')]
    expect(save).toContain('key: ${{ steps.restore.outputs.cache-primary-key }}\n')
    expect(save).toContain('path: electron-ffmpeg-cache\n')
  })

  it('verifies a hit offline, fetches on a miss or a failed hit, and saves only a verified miss', () => {
    const restore = at('uses: actions/cache/restore@')
    const hit = at('name: Verify the cached archive against the pins, offline')
    const fetch = at('bash scripts/electron-ffmpeg-source.sh electron-ffmpeg-source')
    const fetched = at('name: Verify the fetched archive against the pins, offline')
    const save = at('uses: actions/cache/save@')
    const upload = at('uses: actions/upload-artifact@')
    expect([restore, hit, fetch, fetched, save, upload]).toEqual(
      [restore, hit, fetch, fetched, save, upload].slice().sort((a, b) => a - b),
    )
    expect(new Set([restore, hit, fetch, fetched, save, upload]).size).toBe(6)

    expect(steps[hit]).toContain("if: steps.restore.outputs.cache-hit == 'true'\n")
    expect(steps[hit]).toContain(
      'bash scripts/electron-ffmpeg-source.sh --verify "electron-ffmpeg-source/$ARCHIVE"',
    )
    expect(steps[hit]).toContain('echo "verified=true" >> "$GITHUB_OUTPUT"')
    // A failed hit leaves nothing to upload, so the fetch writes it again.
    expect(steps[hit]).toContain('rm -rf electron-ffmpeg-source')
    for (const step of [fetch, fetched]) {
      expect(steps[step]).toContain("if: steps.cached.outputs.verified != 'true'\n")
    }
    expect(steps[fetched]).toContain(
      'bash scripts/electron-ffmpeg-source.sh --verify "electron-ffmpeg-source/$ARCHIVE"\n',
    )
    // The save step has no always() or failure(), so it runs only when the
    // fetched archive verified, and only on a miss.
    expect(steps[save]).toContain("if: steps.restore.outputs.cache-hit != 'true'\n")
    expect(job).not.toMatch(/always\(\)|failure\(\)|continue-on-error/)

    expect(steps[upload]).toContain('name: electron-ffmpeg-source\n')
    expect(steps[upload]).toContain('path: electron-ffmpeg-source\n')
    expect(steps[upload]).toContain('if-no-files-found: error\n')
  })
})
