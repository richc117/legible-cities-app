// The build's refusal of a target whose vendored components are missing,
// stale or built for another processor family, and the manifest it writes
// when they are not (specs/002, FR-004, SC-005). Fixture trees stand in for
// the vendor artefacts: executables whose headers name an architecture, a
// runtime with a version and an engine in it, an ffmpeg carrying its pinned
// version string. Nothing here runs a binary.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '../..')
const SCRIPT = join(repo, 'scripts', 'check-vendored.mjs')

interface LicenceLists {
  unlisted: Record<string, { library: string; file: string; contains: string[] }>
  named_absent: Record<string, string>
  not_linked: string[]
}

/**
 * The repository's pins, but for the hash of CPython's incorporated-software
 * notices, which is the hash of the short text the fixtures write in their
 * place: the real text is fetched by the vendor job and is not committed.
 * Written to a file of its own, which the command line and the hook read.
 */
const NOTICES_TEXT = 'Licenses and Acknowledgements for Incorporated Software\n'
const PINS_DIR = mkdtempSync(join(tmpdir(), 'lc-check-vendored-pins-'))
const PINS_FILE = join(PINS_DIR, 'pins.json')
const PINS_TEXT = (() => {
  const pins = JSON.parse(readFileSync(join(repo, 'vendor', 'pins.json'), 'utf8'))
  pins.python.licence_texts.cpython_incorporated.sha256 = createHash('sha256')
    .update(NOTICES_TEXT)
    .digest('hex')
  return JSON.stringify(pins, null, 2)
})()
writeFileSync(PINS_FILE, PINS_TEXT)
afterAll(() => rmSync(PINS_DIR, { recursive: true, force: true }))

const PINS = JSON.parse(PINS_TEXT) as {
  python: {
    version: string
    targets: Record<
      string,
      { triple: string; full: { asset: string; sha256: string }; licences: LicenceLists }
    >
    licence_texts: { cpython_incorporated: { file: string; sha256: string } }
  }
  engine: { version: string }
  loom: { commit: string }
  ffmpeg: {
    source: { sha256: string }
    x264: { commit: string }
    zlib: { sha256: string }
    targets: Record<string, { reports: string; configure: string; x264_configure: string }>
  }
}

type Target = 'darwin-arm64' | 'darwin-x64' | 'win-x64'
type Arch = 'arm64' | 'x64'

interface Context {
  appOutDir: string
  electronPlatformName: string
  arch: number
  packager: { appInfo: { productFilename: string } }
}
interface Module {
  readArchitecture(header: Uint8Array): { format: string; archs: string[] } | null
  targetOf(platform: string, arch: number | string): string | null
  checkVendor(options: { target: string; vendor: string; pinsFile: string }): {
    problems: string[]
    manifestPath: string | null
  }
  afterPack(
    context: Context,
    env: Record<string, string | undefined>,
    pinsFile?: string,
  ): Promise<void>
}
// A URL built at run time, so the type checker does not look for declarations of a
// plain JavaScript module; the interface above is the part the tests use.
// The hook is handed the fixtures' pins, as electron-builder hands it none.
const load = async (): Promise<Module> => {
  const module = (await import(pathToFileURL(SCRIPT).href)) as Module
  return { ...module, afterPack: (context, env) => module.afterPack(context, env, PINS_FILE) }
}

const posixHost = process.platform !== 'win32'

// -- executables whose headers say what they are --

function machO(arch: Arch): Buffer {
  const b = Buffer.alloc(4096)
  b.writeUInt32LE(0xfeedfacf, 0)
  b.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4)
  return b
}

function universal(...archs: Arch[]): Buffer {
  const b = Buffer.alloc(4096)
  b.writeUInt32BE(0xcafebabe, 0)
  b.writeUInt32BE(archs.length, 4)
  archs.forEach((arch, i) =>
    b.writeUInt32BE(arch === 'arm64' ? 0x0100000c : 0x01000007, 8 + i * 20),
  )
  return b
}

function pe(arch: Arch): Buffer {
  const b = Buffer.alloc(4096)
  b.write('MZ', 0, 'latin1')
  b.writeUInt32LE(0x80, 0x3c)
  b.writeUInt32BE(0x50450000, 0x80)
  b.writeUInt16LE(arch === 'x64' ? 0x8664 : 0xaa64, 0x84)
  return b
}

const header = (target: Target): Buffer =>
  target === 'win-x64' ? pe('x64') : machO(target === 'darwin-arm64' ? 'arm64' : 'x64')

function put(path: string, bytes: Buffer | string, executable = false): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
  if (executable) chmodSync(path, 0o755)
}

interface TreeOptions {
  engineVersion?: string
  pythonVersion?: string
  ffmpegHeader?: Buffer
  ffmpegReports?: string
  ffmpegConfigure?: string
  skip?: 'python' | 'loom' | 'ffmpeg'
  bytecodeFlags?: number
  /** Spoil the runtime's licence texts one way. */
  licences?:
    | 'text-missing'
    | 'text-stray'
    | 'evidence-gone'
    | 'version-moved'
    | 'notices-changed'
    | 'folder-missing'
    | 'metadata-unreadable'
    | 'absent-carried'
    | 'listed-not-carried'
    | 'unshipped-variant'
}

/**
 * The licence texts a runtime carries for `target`, agreeing with the pins'
 * lists: build metadata naming CPython's text, bzip2's and every
 * named_absent text; the folder holding what the metadata names but those,
 * every unlisted and not_linked text, and CPython's notices; and each
 * unlisted entry's file carrying its strings.
 */
function licenceTexts(target: Target, python: string, spoil: TreeOptions['licences']): void {
  if (spoil === 'folder-missing') return
  const pin = PINS.python.targets[target]
  const lists = pin.licences
  const named = ['LICENSE.bzip2.txt', ...Object.keys(lists.named_absent)]
  const bz2 = { variant: 'default', license_paths: named.map((name) => `licenses/${name}`) }
  put(
    join(python, 'PYTHON.json'),
    spoil === 'metadata-unreadable'
      ? '{"python_version": '
      : JSON.stringify({
          python_version: PINS.python.version,
          target_triple: pin.triple,
          license_path: 'licenses/LICENSE.cpython.txt',
          build_info: {
            extensions: {
              // A variant that is not the one built names a text nobody carries.
              _bz2:
                spoil === 'unshipped-variant'
                  ? [bz2, { variant: 'other', license_paths: ['licenses/LICENSE.unshipped.txt'] }]
                  : [bz2],
            },
          },
        }),
  )
  const folder = join(python, 'licenses')
  const carried = [
    'LICENSE.cpython.txt',
    'LICENSE.bzip2.txt',
    ...Object.keys(lists.unlisted),
    ...lists.not_linked,
  ]
  // The first unlisted and not_linked entries, which 'listed-not-carried' leaves out.
  const dropped = [Object.keys(lists.unlisted)[0], lists.not_linked[0]]
  for (const name of carried) {
    if (spoil === 'text-missing' && name === 'LICENSE.bzip2.txt') continue
    if (spoil === 'listed-not-carried' && dropped.includes(name)) continue
    put(join(folder, name), `the text of ${name}\n`)
  }
  if (spoil === 'text-stray') put(join(folder, 'LICENSE.stray.txt'), 'a text nobody names\n')
  if (spoil === 'absent-carried') {
    for (const name of Object.keys(lists.named_absent))
      put(join(folder, name), 'carried after all\n')
  }
  put(
    join(folder, PINS.python.licence_texts.cpython_incorporated.file),
    spoil === 'notices-changed' ? `${NOTICES_TEXT}and more\n` : NOTICES_TEXT,
  )
  for (const entry of Object.values(lists.unlisted)) {
    // 'version-moved': the same strings with a later version that begins
    // with the pinned one, as a zlib 1.3.2.1 would read.
    const strings =
      spoil === 'evidence-gone'
        ? []
        : spoil === 'version-moved'
          ? entry.contains.map((text) => (endsInVersion(text) ? `${text.slice(0, -1)}.1\0` : text))
          : entry.contains
    put(join(python, ...entry.file.split('/')), Buffer.from(`MZ\0${strings.join('')}\0`))
  }
}

/** A component tree for one target, laid out as `root` + the python, loom and ffmpeg folders given. */
function tree(
  target: Target,
  folders: { python: string; loom: string; ffmpeg: string },
  options: TreeOptions = {},
): void {
  const windows = target === 'win-x64'
  const exe = windows ? '.exe' : ''
  if (options.skip !== 'python') {
    const python = folders.python
    const lib = windows ? join(python, 'Lib') : join(python, 'lib', 'python3.12')
    put(join(python, ...(windows ? ['python.exe'] : ['bin', 'python3'])), header(target), true)
    put(
      join(python, 'include', ...(windows ? [] : ['python3.12']), 'patchlevel.h'),
      `#define PY_VERSION              "${options.pythonVersion ?? PINS.python.version}"\n`,
    )
    put(join(windows ? python : lib, 'LICENSE.txt'), 'PSF\n')
    licenceTexts(target, python, options.licences)
    const site = join(lib, 'site-packages')
    mkdirSync(
      join(site, `openschematicmaps-${options.engineVersion ?? PINS.engine.version}.dist-info`),
      {
        recursive: true,
      },
    )
    mkdirSync(join(site, 'python_dateutil-2.9.0.post0.dist-info'), { recursive: true })
    // Two modules, one from the standard library and the engine's entry
    // point, compiled or not as the case needs.
    for (const module of [join(lib, 'string'), join(site, 'schematic', 'serve')]) {
      put(`${module}.py`, '# a module\n')
      if (options.bytecodeFlags !== undefined) {
        const pyc = Buffer.alloc(16)
        pyc.writeUInt32LE(options.bytecodeFlags, 4)
        put(
          join(dirname(module), '__pycache__', `${module.split(/[\\/]/).pop()}.cpython-312.pyc`),
          pyc,
        )
      }
    }
  }
  if (options.skip !== 'loom') {
    for (const tool of ['gtfs2graph', 'topo', 'loom', 'octi']) {
      put(join(folders.loom, tool + exe), header(target), true)
    }
  }
  if (options.skip !== 'ffmpeg') {
    const pin = PINS.ffmpeg.targets[target]
    for (const name of ['ffmpeg', 'ffprobe']) {
      const strings = Buffer.from(
        `\0ffmpeg version ${options.ffmpegReports ?? pin.reports}\0${options.ffmpegConfigure ?? pin.configure}\0`,
        'utf8',
      )
      put(
        join(folders.ffmpeg, name + exe),
        Buffer.concat([options.ffmpegHeader ?? header(target), strings]),
        true,
      )
    }
  }
}

const made: string[] = []
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-check-vendored-'))
  made.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function vendorTree(target: Target, options: TreeOptions = {}): string {
  const vendor = scratch()
  tree(
    target,
    {
      python: join(vendor, 'python', target, 'python'),
      loom: join(vendor, 'loom', target),
      ffmpeg: join(vendor, 'ffmpeg', target),
    },
    options,
  )
  return vendor
}

function check(target: string, vendor: string, pins = PINS_FILE) {
  const run = spawnSync(process.execPath, [SCRIPT, target, '--vendor', vendor, '--pins', pins], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  })
  return { status: run.status, stdout: run.stdout, stderr: run.stderr }
}

/** A version string as the pins write one: digits last, then the NUL that ends the C string. */
const endsInVersion = (text: string): boolean =>
  text.length > 1 && text.endsWith('\0') && /\d$/.test(text.slice(0, -1))

/** The check's refusal of a tree whose licence texts are spoiled one way. */
function refusal(target: Target, licences: TreeOptions['licences']): string {
  const result = check(target, vendorTree(target, { licences }))
  expect(result.status, `${target} ${licences}`).toBe(1)
  return result.stderr
}

describe('check-vendored.mjs, as the build runs it', () => {
  it('passes a complete tree and writes the manifest from the pins, with no build path in it', () => {
    for (const target of ['darwin-arm64', 'darwin-x64', 'win-x64'] as const) {
      const vendor = vendorTree(target)
      const result = check(target, vendor)
      expect(result.stderr, target).toBe('')
      expect(result.status, target).toBe(0)
      const manifestPath = join(vendor, `manifest-${target}.json`)
      const text = readFileSync(manifestPath, 'utf8')
      const manifest = JSON.parse(text)
      expect(manifest.target).toBe(target)
      expect(manifest.pins_sha256).toBe(createHash('sha256').update(PINS_TEXT).digest('hex'))
      expect(manifest.components.engine.version).toBe(PINS.engine.version)
      expect(manifest.components.loom.commit).toBe(PINS.loom.commit)
      expect(manifest.components.ffmpeg.reports).toBe(PINS.ffmpeg.targets[target].reports)
      // What a release needs to name the Corresponding Source: the source
      // archives by hash, and zlib's only where it is linked.
      expect(manifest.components.ffmpeg.source.sha256).toBe(PINS.ffmpeg.source.sha256)
      expect(manifest.components.ffmpeg.x264.commit).toBe(PINS.ffmpeg.x264.commit)
      expect(manifest.components.ffmpeg.x264.configure).toBe(
        PINS.ffmpeg.targets[target].x264_configure,
      )
      expect(manifest.components.ffmpeg.zlib.linked, target).toBe(
        target === 'win-x64' ? 'static' : 'system',
      )
      expect(manifest.components.ffmpeg.zlib.sha256 ?? null, target).toBe(
        target === 'win-x64' ? PINS.ffmpeg.zlib.sha256 : null,
      )
      expect(manifest.components.python_packages).toEqual([
        { name: 'openschematicmaps', version: PINS.engine.version },
        { name: 'python_dateutil', version: '2.9.0.post0' },
      ])
      expect(Boolean(manifest.components.loom.windows_port), target).toBe(target === 'win-x64')
      // Where the runtime's licence texts came from (ADR-042).
      expect(manifest.components.python.licence_texts.full_sha256).toBe(
        PINS.python.targets[target].full.sha256,
      )
      expect(manifest.components.python.licence_texts.cpython_incorporated.sha256).toBe(
        PINS.python.licence_texts.cpython_incorporated.sha256,
      )
      expect(text).not.toContain(vendor)
    }
  })

  it('refuses a missing component, naming it and the target, and removes a manifest already there', () => {
    for (const skip of ['python', 'loom', 'ffmpeg'] as const) {
      const vendor = vendorTree('darwin-x64', { skip })
      writeFileSync(join(vendor, 'manifest-darwin-x64.json'), '{"stale": true}')
      const result = check('darwin-x64', vendor)
      expect(result.status, skip).toBe(1)
      expect(result.stderr).toContain(`darwin-x64: ${skip} is missing`)
      expect(existsSync(join(vendor, 'manifest-darwin-x64.json')), skip).toBe(false)
    }
  })

  it('refuses a binary built for another processor family, or for two', () => {
    const wrong = check('darwin-arm64', vendorTree('darwin-arm64', { ffmpegHeader: machO('x64') }))
    expect(wrong.status).toBe(1)
    expect(wrong.stderr).toContain(
      'darwin-arm64: ffmpeg has ffmpeg built for Mach-O x64, not Mach-O arm64',
    )
    const both = check(
      'darwin-x64',
      vendorTree('darwin-x64', { ffmpegHeader: universal('arm64', 'x64') }),
    )
    expect(both.status).toBe(1)
    expect(both.stderr).toContain('darwin-x64: ffmpeg has ffprobe built for Mach-O arm64 + x64')
    const windows = check('win-x64', vendorTree('win-x64', { ffmpegHeader: pe('arm64') }))
    expect(windows.stderr).toContain(
      'win-x64: ffmpeg has ffmpeg.exe built for PE arm64, not PE x64',
    )
    // A Mac tree handed to the Windows build is every component wrong.
    const vendor = scratch()
    tree('darwin-x64', {
      python: join(vendor, 'python', 'win-x64', 'python'),
      loom: join(vendor, 'loom', 'win-x64'),
      ffmpeg: join(vendor, 'ffmpeg', 'win-x64'),
    })
    const mac = check('win-x64', vendor)
    expect(mac.status).toBe(1)
    expect(mac.stderr).toContain('win-x64: python is missing python.exe')
    expect(mac.stderr).toContain('win-x64: loom is missing gtfs2graph.exe')
  })

  it('refuses a stale runtime, engine or ffmpeg', () => {
    const engine = check('darwin-arm64', vendorTree('darwin-arm64', { engineVersion: '0.0.1' }))
    expect(engine.status).toBe(1)
    expect(engine.stderr).toContain(
      `darwin-arm64: engine is 0.0.1; vendor/pins.json pins ${PINS.engine.version}, so it is stale`,
    )
    const python = check('win-x64', vendorTree('win-x64', { pythonVersion: '3.11.0' }))
    expect(python.stderr).toContain('win-x64: python is 3.11.0;')
    const ffmpeg = check('darwin-arm64', vendorTree('darwin-arm64', { ffmpegReports: '8.0' }))
    expect(ffmpeg.stderr).toContain('darwin-arm64: ffmpeg has ffmpeg without the pinned version')
    // The same version from another build, as the third-party 9.0.1 builds
    // were: only the configure line tells it from this repository's own.
    const other = check(
      'win-x64',
      vendorTree('win-x64', {
        ffmpegConfigure: '--prefix=/ffbuild/prefix --enable-gpl --enable-version3 --enable-libx264',
      }),
    )
    expect(other.status).toBe(1)
    expect(other.stderr).toContain(
      'win-x64: ffmpeg has ffmpeg.exe without the pinned configure line, so it is stale',
    )
    expect(other.stderr).toContain(
      'win-x64: ffmpeg has ffprobe.exe without the pinned configure line, so it is stale',
    )
    // The pins moved and the tree did not.
    const pins = join(scratch(), 'pins.json')
    const moved = JSON.parse(PINS_TEXT)
    moved.engine.version = '99.0.0'
    writeFileSync(pins, JSON.stringify(moved))
    const stale = check('darwin-arm64', vendorTree('darwin-arm64'), pins)
    expect(stale.stderr).toContain('vendor/pins.json pins 99.0.0, so it is stale')
  })

  it.skipIf(!posixHost)('refuses a macOS binary without its executable bit', () => {
    const vendor = vendorTree('darwin-arm64')
    chmodSync(join(vendor, 'loom', 'darwin-arm64', 'octi'), 0o644)
    const result = check('darwin-arm64', vendor)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('darwin-arm64: loom has octi without its executable bit')
  })

  it('refuses a DLL beside the Windows LOOM tools', () => {
    const vendor = vendorTree('win-x64')
    writeFileSync(join(vendor, 'loom', 'win-x64', 'KERNEL32.DLL'), '')
    expect(check('win-x64', vendor).stderr).toContain(
      'win-x64: loom carries DLLs it must not: KERNEL32.DLL',
    )
  })

  // Issue 108, ADR-042: the texts of the libraries the runtime links, which
  // its LICENSE.txt does not carry, agree with its build metadata and the
  // pins' three lists, or nothing is packaged.
  it("refuses a runtime whose licence texts, build metadata and the pins' lists disagree", () => {
    expect(refusal('darwin-arm64', 'folder-missing')).toContain(
      'darwin-arm64: python carries no licence texts',
    )
    expect(refusal('darwin-x64', 'text-missing')).toContain(
      'darwin-x64: python has build metadata naming LICENSE.bzip2.txt, which is not among the licence texts',
    )
    expect(refusal('win-x64', 'text-stray')).toContain(
      "win-x64: python carries LICENSE.stray.txt, which neither the build metadata nor the pins' lists account for",
    )
    expect(refusal('darwin-arm64', 'notices-changed')).toContain(
      'darwin-arm64: python has a CPython-Doc-license.rst that is not the pinned one',
    )
    // The Windows DLLs no longer carry what the unlisted entries say they do.
    const gone = refusal('win-x64', 'evidence-gone')
    for (const [name, entry] of Object.entries(PINS.python.targets['win-x64'].licences.unlisted)) {
      expect(gone).toContain(
        `win-x64: python lists ${name} for ${entry.file}, which no longer contains ${JSON.stringify(entry.contains[0])}`,
      )
    }
  })

  it('refuses a version string that has moved on, however it begins', () => {
    const moved = refusal('win-x64', 'version-moved')
    for (const [name, entry] of Object.entries(PINS.python.targets['win-x64'].licences.unlisted)) {
      const versions = entry.contains.filter(endsInVersion)
      expect(versions.length, name).toBeGreaterThan(0)
      for (const text of versions) {
        expect(moved).toContain(
          `lists ${name} for ${entry.file}, which no longer contains ${JSON.stringify(text)}`,
        )
      }
    }
  })

  it('refuses a named_absent text that is carried, a listed text that is not, and unreadable metadata', () => {
    const mac = PINS.python.targets['darwin-arm64'].licences
    const carried = refusal('darwin-arm64', 'absent-carried')
    for (const name of Object.keys(mac.named_absent)) {
      expect(carried).toContain(
        `darwin-arm64: python carries ${name}, which named_absent says the archive lacks; take it off that list`,
      )
    }
    const win = PINS.python.targets['win-x64'].licences
    const missing = refusal('win-x64', 'listed-not-carried')
    const unlisted = Object.keys(win.unlisted)[0]
    expect(missing).toContain(
      `win-x64: python owes ${unlisted} (${win.unlisted[unlisted].library}), which is not carried`,
    )
    expect(missing).toContain(
      `win-x64: python lists ${win.not_linked[0]} as not_linked, but it is not carried`,
    )
    expect(refusal('darwin-x64', 'metadata-unreadable')).toContain(
      'darwin-x64: python carries no readable build metadata',
    )
  })

  it('counts only the variant built into the runtime', () => {
    for (const target of ['darwin-arm64', 'win-x64'] as const) {
      const result = check(target, vendorTree(target, { licences: 'unshipped-variant' }))
      expect(result.stderr, target).toBe('')
      expect(result.status, target).toBe(0)
    }
  })

  it('refuses a list entry that is no longer true', () => {
    const pins = join(scratch(), 'pins.json')
    const moved = JSON.parse(PINS_TEXT)
    const mac = moved.python.targets['darwin-arm64'].licences
    mac.named_absent['LICENSE.gone.txt'] = 'a text nothing names any more'
    mac.not_linked.push('LICENSE.bzip2.txt')
    mac.unlisted['LICENSE.cpython.txt'] = { library: 'CPython', file: 'bin/python3', contains: [] }
    // On two lists at once.
    const win = moved.python.targets['win-x64'].licences
    win.unlisted[win.not_linked[0]] = { library: 'twice', file: 'python312.dll', contains: [] }
    writeFileSync(pins, JSON.stringify(moved))
    const both = check('win-x64', vendorTree('win-x64'), pins)
    expect(both.status).toBe(1)
    expect(both.stderr).toContain(
      `win-x64: python lists ${win.not_linked[0]} as both unlisted and not_linked`,
    )
    // The tree was made from the repository's lists, then checked against these.
    const result = check('darwin-arm64', vendorTree('darwin-arm64'), pins)
    expect(result.status).toBe(1)
    for (const problem of [
      'lists LICENSE.gone.txt as named_absent, but the build metadata no longer names it',
      'lists LICENSE.bzip2.txt as not_linked, but the build metadata names it now',
      'lists LICENSE.cpython.txt as unlisted, but the build metadata names it now',
    ]) {
      expect(result.stderr).toContain(`darwin-arm64: python ${problem}`)
    }
  })

  it("checks one runtime's licence texts alone, as the vendor job does before vendoring it", () => {
    const vendor = vendorTree('win-x64')
    const python = join(vendor, 'python', 'win-x64', 'python')
    const run = (target: string) =>
      spawnSync(process.execPath, [SCRIPT, target, '--licences', python, '--pins', PINS_FILE], {
        encoding: 'utf8',
        timeout: 30_000,
        windowsHide: true,
      })
    const agreed = run('win-x64')
    expect(agreed.stderr).toBe('')
    expect(agreed.status).toBe(0)
    expect(agreed.stdout).toContain("win-x64: the runtime's licence texts agree")
    // The same folder is not a Mac runtime's: its metadata names another build.
    const other = run('darwin-arm64')
    expect(other.status).toBe(1)
    expect(other.stderr).toContain(
      `python has build metadata for ${PINS.python.version} x86_64-pc-windows-msvc, not ${PINS.python.version} aarch64-apple-darwin`,
    )
  })

  it('says how to call it when the target is not one', () => {
    const result = check('linux-x64', scratch())
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('usage:')
  })
})

describe('readArchitecture and targetOf', () => {
  it('reads Mach-O, universal and PE headers, and nothing else', async () => {
    const { readArchitecture } = await load()
    expect(readArchitecture(machO('arm64'))).toEqual({ format: 'Mach-O', archs: ['arm64'] })
    expect(readArchitecture(universal('x64', 'arm64'))).toEqual({
      format: 'Mach-O',
      archs: ['x64', 'arm64'],
    })
    expect(readArchitecture(pe('x64'))).toEqual({ format: 'PE', archs: ['x64'] })
    expect(readArchitecture(Buffer.from('#!/bin/sh\necho hello\n'))).toBeNull()
    expect(readArchitecture(Buffer.alloc(0))).toBeNull()
  })
  it("names the target of electron-builder's platform and arch", async () => {
    const { targetOf } = await load()
    expect(targetOf('darwin', 3)).toBe('darwin-arm64')
    expect(targetOf('darwin', 1)).toBe('darwin-x64')
    expect(targetOf('win32', 1)).toBe('win-x64')
    expect(targetOf('win32', 3)).toBeNull()
    expect(targetOf('linux', 1)).toBeNull()
  })
})

describe('the afterPack hook, where the packaged app will look', () => {
  const productFilename = 'Legible Cities'
  function packaged(
    target: Target,
    options: TreeOptions & {
      manifest?: 'current' | 'stale' | 'none'
      /** Leave out Electron's and Chromium's licences, as electron-builder does on a Mac. */
      electronLicences?: false
    } = {},
  ) {
    const appOutDir = scratch()
    const darwin = target !== 'win-x64'
    const resources = darwin
      ? join(appOutDir, `${productFilename}.app`, 'Contents', 'Resources')
      : join(appOutDir, 'resources')
    mkdirSync(resources, { recursive: true })
    if (options.electronLicences !== false) {
      // Beside the executable on Windows, in the resources on a Mac.
      const folder = darwin ? resources : appOutDir
      writeFileSync(join(folder, 'LICENSE.electron.txt'), 'Copyright (c) Electron contributors\n')
      writeFileSync(join(folder, 'LICENSES.chromium.html'), '<title>Credits</title>\n')
    }
    tree(
      target,
      {
        python: join(resources, 'python'),
        loom: join(resources, 'loom'),
        ffmpeg: join(resources, 'ffmpeg'),
      },
      options,
    )
    if (options.manifest !== 'none') {
      const sha = createHash('sha256').update(PINS_TEXT).digest('hex')
      writeFileSync(
        join(resources, 'vendor-manifest.json'),
        JSON.stringify({
          target,
          pins_sha256: options.manifest === 'stale' ? '0'.repeat(64) : sha,
        }),
      )
    }
    const context: Context = {
      appOutDir,
      electronPlatformName: darwin ? 'darwin' : 'win32',
      arch: target === 'darwin-arm64' ? 3 : 1,
      packager: { appInfo: { productFilename } },
    }
    return context
  }

  it('passes a complete packaged app with unchecked-hash bytecode and a current manifest', async () => {
    const { afterPack } = await load()
    for (const target of ['darwin-arm64', 'win-x64'] as const) {
      await expect(
        afterPack(packaged(target, { bytecodeFlags: 1 }), { LEGIBLE_VENDOR_TARGET: target }),
      ).resolves.toBeUndefined()
    }
  })

  it('lets an unpacked build with nothing vendored through only when no target is required', async () => {
    const { afterPack } = await load()
    const empty = (): Context => ({
      appOutDir: scratch(),
      electronPlatformName: 'darwin',
      arch: 3,
      packager: { appInfo: { productFilename } },
    })
    await expect(afterPack(empty(), {})).resolves.toBeUndefined()
    await expect(afterPack(empty(), { LEGIBLE_VENDOR_TARGET: 'darwin-arm64' })).rejects.toThrow(
      'darwin-arm64: python is missing',
    )
    await expect(afterPack(empty(), { LEGIBLE_VENDOR_TARGET: 'darwin-x64' })).rejects.toThrow(
      'LEGIBLE_VENDOR_TARGET is darwin-x64, but this build packages darwin-arm64',
    )
  })

  it("refuses an app without Electron's and Chromium's licences, on either system", async () => {
    const { afterPack } = await load()
    for (const target of ['darwin-x64', 'win-x64'] as const) {
      await expect(
        afterPack(packaged(target, { bytecodeFlags: 1, electronLicences: false }), {
          LEGIBLE_VENDOR_TARGET: target,
        }),
      ).rejects.toThrow(`${target}: electron is missing LICENSES.chromium.html`)
    }
  })

  it('refuses a partial app even when no target is required', async () => {
    const { afterPack } = await load()
    await expect(
      afterPack(packaged('darwin-arm64', { skip: 'ffmpeg', bytecodeFlags: 1 }), {}),
    ).rejects.toThrow('darwin-arm64: ffmpeg is missing')
  })

  it('refuses a stale or absent manifest, and bytecode that is missing or checks timestamps', async () => {
    const { afterPack } = await load()
    const env = { LEGIBLE_VENDOR_TARGET: 'win-x64' }
    await expect(
      afterPack(packaged('win-x64', { bytecodeFlags: 1, manifest: 'stale' }), env),
    ).rejects.toThrow('win-x64: manifest is stale')
    await expect(
      afterPack(packaged('win-x64', { bytecodeFlags: 1, manifest: 'none' }), env),
    ).rejects.toThrow('win-x64: manifest is missing')
    await expect(afterPack(packaged('win-x64'), env)).rejects.toThrow(
      'win-x64: python has 2 of 2 modules without compiled bytecode',
    )
    // Timestamped bytecode is rewritten at the first start once a copy has
    // given its sources new times: inside the bundle, breaking its signature.
    await expect(
      afterPack(packaged('darwin-arm64', { bytecodeFlags: 0 }), {
        LEGIBLE_VENDOR_TARGET: 'darwin-arm64',
      }),
    ).rejects.toThrow('darwin-arm64: python has 2 bytecode files that are not unchecked-hash')
  })
})

describe('electron-builder.yml', () => {
  const config = readFileSync(join(repo, 'electron-builder.yml'), 'utf8')
  it('runs the check after packing and maps every component where the app looks', () => {
    expect(config).toMatch(/^afterPack: \.\/scripts\/check-vendored\.mjs$/m)
    for (const os of ['darwin', 'win']) {
      expect(config).toContain(`- from: vendor/python/${os}-\${arch}/python\n      to: python`)
      expect(config).toContain(`- from: vendor/loom/${os}-\${arch}\n      to: loom`)
      expect(config).toContain(`- from: vendor/ffmpeg/${os}-\${arch}\n      to: ffmpeg`)
      expect(config).toContain(
        `- from: vendor/manifest-${os}-\${arch}.json\n      to: vendor-manifest.json`,
      )
    }
    // electron-builder deletes these from a Mac app; the Mac entries put them back.
    const mac = config.slice(config.indexOf('\nmac:'), config.indexOf('\nwin:'))
    expect(mac).toContain(
      '- from: node_modules/electron/dist/LICENSE\n      to: LICENSE.electron.txt',
    )
    expect(mac).toContain(
      '- from: node_modules/electron/dist/LICENSES.chromium.html\n      to: LICENSES.chromium.html',
    )
  })

  // electron-builder falls back to its own default icon when a named one is
  // missing, with a warning in a log nobody reads, so the installers would
  // carry Electron's atom and every check here would still pass (issue 140).
  it('names brand icons that are on disk', () => {
    const named = [
      ...config.matchAll(
        /^\s*(?:icon|installerIcon|uninstallerIcon|installerHeaderIcon|installerSidebar|uninstallerSidebar|installerHeader|background): (assets\/brand\/\S+)$/gm,
      ),
    ].map((m) => m[1])
    expect(named).toContain('assets/brand/macos/icon.icns')
    expect(named).toContain('assets/brand/windows/icon.ico')
    for (const file of new Set(named)) expect(existsSync(join(repo, file))).toBe(true)
  })

  // The dmg background is cropped, not scaled, so the window has to be the
  // background's own size; and the three NSIS bitmaps draw only on the
  // assisted installer, which this app does not build (see the config).
  it('sizes the disk-image window to its background and leaves the one-click installer alone', () => {
    expect(config).toContain('background: assets/brand/macos/background.tiff')
    expect(config).toMatch(/window:\n {4}width: 660\n {4}height: 400/)
    expect(config).not.toMatch(/^\s*oneClick:/m)
    expect(config).not.toMatch(/^\s*(installerSidebar|uninstallerSidebar|installerHeader):/m)
  })
})
