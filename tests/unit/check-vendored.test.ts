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
// The requirements manifest sits beside the pins it is held to (issue 434),
// so the repository's own goes beside the fixtures' pins, whose
// python.requirements.sha256 is the repository's and names it.
const REQUIREMENTS_TEXT = readFileSync(join(repo, 'vendor', 'python-requirements.txt'), 'utf8')
writeFileSync(join(PINS_DIR, 'python-requirements.txt'), REQUIREMENTS_TEXT)
afterAll(() => rmSync(PINS_DIR, { recursive: true, force: true }))

const PINS = JSON.parse(PINS_TEXT) as {
  python: {
    version: string
    targets: Record<
      string,
      { triple: string; full: { asset: string; sha256: string }; licences: LicenceLists }
    >
    licence_texts: { cpython_incorporated: { file: string; sha256: string } }
    pip: { version: string; sha256: string }
    requirements: { sha256: string }
  }
  engine: { version: string; tag: string; commit: string }
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
  markerEnvironment(target: string, pythonVersion: string): Record<string, string> | null
  evaluateMarker(marker: string, env: Record<string, string>): boolean
  checkVendor(options: { target: string; vendor: string; pinsFile: string }): {
    problems: string[]
    manifestPath: string | null
  }
  afterPack(
    context: Context,
    env: Record<string, string | undefined>,
    pinsFile?: string,
  ): Promise<void>
  checkPythonStripped(options: { python: string }): string[]
  STRIPPED: RegExp
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

/**
 * The packages the manifest pins for a target, read here and not by the
 * script under test, so a parser that read nothing could not make the
 * fixtures agree with it: every `name==version` line, the one marker the
 * lock carries judged by hand. A new marker fails here, naming it, until
 * this learns it.
 */
function locked(target: Target): { name: string; version: string }[] {
  const out: { name: string; version: string }[] = []
  for (const match of REQUIREMENTS_TEXT.matchAll(
    /^([A-Za-z0-9][A-Za-z0-9._-]*)==(\S+?)(?: ; (.+?))? \\$/gm,
  )) {
    const [, name, version, marker] = match
    if (marker !== undefined) {
      // tzdata, which pandas needs on Windows alone.
      expect(marker).toBe("sys_platform == 'emscripten' or sys_platform == 'win32'")
      if (target !== 'win-x64') continue
    }
    out.push({ name, version })
  }
  return out
}

/**
 * A pandas that no lock of the engine holds, so a runtime carrying it is at
 * another version than the manifest pins whatever the pin is. It was once a
 * real release, 3.0.6, until the engine's lock moved to that release and the
 * fixture agreed with the manifest, which is no refusal.
 */
const OTHER_PANDAS = '2.2.3'

/** A distribution's `.dist-info` folder name, as pip writes it: `-` in the name becomes `_`. */
const distInfo = (name: string, version: string): string =>
  `${name.replace(/[-.]/g, '_')}-${version}.dist-info`

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
    /** A zlib link of the runtime's own beside the system's, as a static zlib would read. */
    | 'zlib-own'
    /** No zlib link at all, as a zlib compiled into the interpreter would read. */
    | 'zlib-none'
    /** One extension owing zlib's text with no zlib link, beside one linking the system's. */
    | 'zlib-compiled-in'
    /** A variant that is not shipped, listed first, linking a zlib of its own. */
    | 'zlib-unshipped-own'
    /** The shipped variant, listed second, linking a zlib of its own. */
    | 'zlib-shipped-own'
  /** Spoil the runtime's packages one way against the manifest (issue 434). */
  packages?: 'missing' | 'other-version' | 'unlisted' | 'tzdata-everywhere' | 'tzdata-nowhere'
  pipVersion?: string
  /** Spoil the record vendor-python.sh writes into the runtime one way. */
  record?: 'missing' | 'unreadable' | 'other-commit' | 'other-requirements'
  /** The licence lists the tree is made from, where not the repository's for the target. */
  lists?: LicenceLists
  /** Leave in the runtime the Tcl/Tk files scripts/vendor-python.sh strips (issue 679). */
  tclTk?: boolean
}

/**
 * Tcl/Tk as python-build-standalone's release 20261026 lays it out, some of
 * the files the strip removes, and what the check names of them: a file
 * outside site-packages by itself, and a folder the strip names as the
 * folder.
 */
const TCL_TK: Record<Target, { files: string[]; named: string[] }> = {
  'darwin-arm64': {
    files: [
      'lib/libtcl9.0.dylib',
      'lib/libtcl9tk9.0.dylib',
      'lib/python3.12/lib-dynload/_tkinter.cpython-312-darwin.so',
      'lib/tcl9.0/init.tcl',
      'lib/thread3.0.6/libtcl9thread3.0.6.dylib',
      'lib/thread3.0.6/libthread3.0.6.dylib',
    ],
    named: [
      'lib/libtcl9.0.dylib',
      'lib/libtcl9tk9.0.dylib',
      'lib/python3.12/lib-dynload/_tkinter.cpython-312-darwin.so',
      'lib/tcl9.0/',
      'lib/thread3.0.6/',
    ],
  },
  'darwin-x64': {
    files: [
      'lib/itcl4.3.8/libitcl4.3.8.dylib',
      'lib/python3.12/lib-dynload/_tkinter.cpython-312-darwin.so',
      'lib/tk9.0/tk.tcl',
    ],
    named: [
      'lib/itcl4.3.8/',
      'lib/python3.12/lib-dynload/_tkinter.cpython-312-darwin.so',
      'lib/tk9.0/',
    ],
  },
  'win-x64': {
    files: [
      'DLLs/_tkinter.pyd',
      'DLLs/tcl86t.dll',
      'DLLs/tk86t.dll',
      'DLLs/zlib1.dll',
      'tcl/tix8.4.3/tix84.dll',
    ],
    named: ['DLLs/_tkinter.pyd', 'DLLs/tcl86t.dll', 'DLLs/tk86t.dll', 'DLLs/zlib1.dll', 'tcl/'],
  },
}

/**
 * The packages a runtime carries besides the engine: the manifest's for the
 * target and pip at its pin, or those spoiled one way.
 */
function packagesFor(target: Target, options: TreeOptions): { name: string; version: string }[] {
  const pip = { name: 'pip', version: options.pipVersion ?? PINS.python.pip.version }
  let packages = [...locked(target), pip]
  switch (options.packages) {
    case 'missing':
      packages = packages.filter((p) => p.name !== 'requests')
      break
    case 'other-version':
      packages = packages.map((p) => (p.name === 'pandas' ? { ...p, version: OTHER_PANDAS } : p))
      break
    case 'unlisted':
      packages.push({ name: 'setuptools', version: '80.9.0' })
      break
    case 'tzdata-everywhere':
      // The manifest's own tzdata, which it lists for Windows alone.
      if (target !== 'win-x64') {
        const tzdata = locked('win-x64').find((p) => p.name === 'tzdata')
        if (tzdata !== undefined) packages.push(tzdata)
      }
      break
    case 'tzdata-nowhere':
      packages = packages.filter((p) => p.name !== 'tzdata')
      break
  }
  return packages
}

/** The record scripts/vendor-python.sh writes at the runtime's root, or that record spoiled. */
function vendorRecord(python: string, spoil: TreeOptions['record']): void {
  if (spoil === 'missing') return
  const path = join(python, 'vendor-record.json')
  if (spoil === 'unreadable') return put(path, '{"engine": ')
  put(
    path,
    JSON.stringify({
      engine: {
        tag: PINS.engine.tag,
        version: PINS.engine.version,
        commit:
          spoil === 'other-commit'
            ? 'd9c465fda2f53b96f1d226a0fd1f9abf877d6ec6'
            : PINS.engine.commit,
      },
      requirements_sha256:
        spoil === 'other-requirements' ? '0'.repeat(64) : PINS.python.requirements.sha256,
    }),
  )
}

/**
 * The extensions that link zlib in a build's metadata, and the texts they
 * name: on macOS `zlib` and `binascii`, each linking the system's `z` and
 * naming zlib's text, as release 20261026's do; on Windows none, zlib being
 * compiled into the interpreter. The 'zlib-' spoils change binascii, and
 * 'zlib-own' applies on any target, naming no text off macOS; 'zlib-none'
 * leaves both out.
 */
function zlibUsers(
  target: Target,
  spoil: TreeOptions['licences'],
): { extensions: Record<string, unknown>; texts: string[] } {
  const darwin = target.startsWith('darwin-')
  if (spoil === 'zlib-none' || (!darwin && spoil !== 'zlib-own')) {
    return { extensions: {}, texts: [] }
  }
  const texts = darwin ? ['LICENSE.zlib.txt'] : []
  const variant = (link: Record<string, unknown> | null, name = 'default') => ({
    variant: name,
    links: link === null ? [] : [link],
    license_paths: texts.map((text) => `licenses/${text}`),
  })
  const system = { name: 'z', system: true }
  const own = { name: 'z', path_static: 'build/lib/libz.a' }
  let binascii = [variant(system)]
  switch (spoil) {
    case 'zlib-own':
      binascii = [variant(own)]
      break
    case 'zlib-compiled-in':
      binascii = [variant(null)]
      break
    case 'zlib-unshipped-own':
      binascii = [variant(own, 'other'), variant(system)]
      break
    case 'zlib-shipped-own':
      binascii = [variant(system, 'other'), variant(own)]
      break
  }
  return { extensions: { zlib: [variant(system)], binascii }, texts }
}

/**
 * The licence texts a runtime carries for `target`, agreeing with the pins'
 * lists: build metadata naming CPython's text, bzip2's and every
 * named_absent text; the folder holding what the metadata names but those,
 * every unlisted and not_linked text, and CPython's notices; and each
 * unlisted entry's file carrying its strings.
 */
function licenceTexts(
  target: Target,
  python: string,
  spoil: TreeOptions['licences'],
  given?: LicenceLists,
): void {
  if (spoil === 'folder-missing') return
  const pin = PINS.python.targets[target]
  const lists = given ?? pin.licences
  const named = ['LICENSE.bzip2.txt', ...Object.keys(lists.named_absent)]
  const bz2 = { variant: 'default', license_paths: named.map((name) => `licenses/${name}`) }
  const zlib = zlibUsers(target, spoil)
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
              ...zlib.extensions,
            },
          },
        }),
  )
  const folder = join(python, 'licenses')
  const carried = [
    'LICENSE.cpython.txt',
    'LICENSE.bzip2.txt',
    ...zlib.texts,
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
    licenceTexts(target, python, options.licences, options.lists)
    vendorRecord(python, options.record)
    if (options.tclTk === true) {
      for (const file of TCL_TK[target].files) put(join(python, ...file.split('/')), header(target))
    }
    const site = join(lib, 'site-packages')
    mkdirSync(
      join(site, distInfo('openschematicmaps', options.engineVersion ?? PINS.engine.version)),
      {
        recursive: true,
      },
    )
    for (const { name, version } of packagesFor(target, options)) {
      mkdirSync(join(site, distInfo(name, version)), { recursive: true })
    }
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
      // Every package the runtime carries, as its .dist-info names it, and
      // where the list came from (issue 434).
      expect(manifest.components.python_packages).toEqual(
        [
          { name: 'openschematicmaps', version: PINS.engine.version },
          ...packagesFor(target, {}).map(({ name, version }) => ({
            name: name.replace(/[-.]/g, '_'),
            version,
          })),
        ].sort((a, b) => a.name.localeCompare(b.name)),
      )
      // Not an empty list agreeing with an empty reading: the engine's three
      // dependencies, pip, and tzdata on Windows alone.
      const names = manifest.components.python_packages.map((p: { name: string }) => p.name)
      for (const name of ['pandas', 'python_lsp_jsonrpc', 'requests', 'numpy', 'pip']) {
        expect(names, target).toContain(name)
      }
      expect(names.includes('tzdata'), target).toBe(target === 'win-x64')
      expect(manifest.components.engine.commit).toBe(PINS.engine.commit)
      expect(manifest.components.python.requirements_sha256).toBe(PINS.python.requirements.sha256)
      expect(manifest.components.python.pip).toBe(PINS.python.pip.version)
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

  // Issue 434: the runtime is locked. Its packages are the manifest's, the
  // engine's uv.lock exported, and pip is python.pip's, each at exactly
  // that version and none besides; its record names engine.commit and the
  // manifest the pins name; and the manifest is the one they name.
  describe('the locked runtime', () => {
    const refused = (target: Target, options: TreeOptions, pins = PINS_FILE): string => {
      const result = check(target, vendorTree(target, options), pins)
      expect(result.status, `${target} ${JSON.stringify(options)}`).toBe(1)
      return result.stderr
    }
    const version = (target: Target, name: string): string => {
      const found = locked(target).find((p) => p.name === name)
      expect(found, `${name} in the manifest for ${target}`).toBeDefined()
      return (found as { version: string }).version
    }
    /** A pins file of the fixtures' own beside a manifest of the test's, or none. */
    const beside = (manifest: string | null, edit?: (pins: typeof PINS) => void): string => {
      const dir = scratch()
      const pins = JSON.parse(PINS_TEXT)
      edit?.(pins)
      writeFileSync(join(dir, 'pins.json'), JSON.stringify(pins))
      if (manifest !== null) writeFileSync(join(dir, 'python-requirements.txt'), manifest)
      return join(dir, 'pins.json')
    }

    it('refuses a runtime that lacks a package the manifest pins', () => {
      expect(refused('darwin-arm64', { packages: 'missing' })).toContain(
        `darwin-arm64: python lacks requests ${version('darwin-arm64', 'requests')}, which python-requirements.txt pins`,
      )
    })

    it('refuses a package at another version than the manifest pins', () => {
      expect(refused('win-x64', { packages: 'other-version' })).toContain(
        `win-x64: python carries pandas ${OTHER_PANDAS}; python-requirements.txt pins ${version('win-x64', 'pandas')}`,
      )
    })

    it('refuses a package the manifest does not list', () => {
      expect(refused('darwin-x64', { packages: 'unlisted' })).toContain(
        'darwin-x64: python carries setuptools 80.9.0, which python-requirements.txt does not list for darwin-x64',
      )
    })

    it("judges the manifest's markers for each target: tzdata on Windows and nowhere else", () => {
      const tzdata = version('win-x64', 'tzdata')
      expect(refused('darwin-arm64', { packages: 'tzdata-everywhere' })).toContain(
        `darwin-arm64: python carries tzdata ${tzdata}, which python-requirements.txt does not list for darwin-arm64`,
      )
      expect(refused('win-x64', { packages: 'tzdata-nowhere' })).toContain(
        `win-x64: python lacks tzdata ${tzdata}, which python-requirements.txt pins`,
      )
    })

    it('refuses a pip other than the one python.pip pins', () => {
      expect(refused('darwin-arm64', { pipVersion: '25.0.1' })).toContain(
        `darwin-arm64: python carries pip 25.0.1; vendor/pins.json pins ${PINS.python.pip.version}`,
      )
    })

    it('refuses a runtime built from another engine commit', () => {
      expect(refused('darwin-arm64', { record: 'other-commit' })).toContain(
        `darwin-arm64: engine was built from commit d9c465fda2f53b96f1d226a0fd1f9abf877d6ec6; vendor/pins.json pins ${PINS.engine.commit}, so it is stale`,
      )
    })

    it('refuses a runtime installed from another manifest', () => {
      expect(refused('win-x64', { record: 'other-requirements' })).toContain(
        `win-x64: python was installed from a requirements manifest whose sha256 is ${'0'.repeat(64)}; vendor/pins.json names ${PINS.python.requirements.sha256}, so it is stale`,
      )
    })

    it('refuses a runtime without a readable record of how it was built', () => {
      for (const record of ['missing', 'unreadable'] as const) {
        expect(refused('darwin-x64', { record })).toContain(
          'darwin-x64: python carries no readable vendor record',
        )
      }
    })

    it('refuses a manifest that is not the one the pins name, or none, whatever the runtime carries', () => {
      // A comment changes nothing pip installs and still makes it another
      // file than the one the pins name, so the hash is the only refusal.
      const edited = refused('darwin-arm64', {}, beside(`${REQUIREMENTS_TEXT}# edited by hand\n`))
      const sha = createHash('sha256')
        .update(`${REQUIREMENTS_TEXT}# edited by hand\n`)
        .digest('hex')
      expect(edited).toContain(
        `darwin-arm64: python has a requirements manifest, python-requirements.txt, whose sha256 is ${sha}; vendor/pins.json names ${PINS.python.requirements.sha256}: regenerate it with scripts/lock-python.sh`,
      )
      expect(edited.trim().split('\n')).toHaveLength(2)
      expect(refused('darwin-arm64', {}, beside(null))).toContain(
        'darwin-arm64: python has no requirements manifest to be held to',
      )
    })

    it('refuses a manifest line without a hash, not at one version, or with a marker it cannot judge', () => {
      const hash = `--hash=sha256:${'b'.repeat(64)}`
      const manifest = [
        `requests==2.34.2`,
        `pandas>=2.2 \\\n    ${hash}`,
        `tzdata==2026.3 ; platform_release == '24.0.0' \\\n    ${hash}`,
        `six==1.17.0 \\\n    --hash=md5:${'c'.repeat(32)}`,
        '',
      ].join('\n')
      const sha = createHash('sha256').update(manifest).digest('hex')
      const stderr = refused(
        'darwin-arm64',
        {},
        beside(manifest, (pins) => {
          pins.python.requirements.sha256 = sha
        }),
      )
      for (const problem of [
        'pins requests 2.34.2 without a hash',
        'holds "pandas>=2.2", which is not one package at one version',
        "whose marker for tzdata cannot be judged for darwin-arm64 (does not know the marker platform_release): platform_release == '24.0.0'",
        `gives six --hash=md5:${'c'.repeat(32)}, which is not a sha256 hash`,
      ]) {
        expect(stderr).toContain(
          `darwin-arm64: python has a requirements manifest ${problem.startsWith('whose') ? '' : 'that '}${problem}`,
        )
      }
    })

    it('checks one runtime alone, as the vendor job does once it has installed it', () => {
      const run = (vendor: string) =>
        spawnSync(
          process.execPath,
          [
            SCRIPT,
            'win-x64',
            '--packages',
            join(vendor, 'python', 'win-x64', 'python'),
            '--pins',
            PINS_FILE,
          ],
          { encoding: 'utf8', timeout: 30_000, windowsHide: true },
        )
      const agreed = run(vendorTree('win-x64'))
      expect(agreed.stderr).toBe('')
      expect(agreed.status).toBe(0)
      expect(agreed.stdout).toContain('win-x64: the runtime carries the packages')
      const other = run(vendorTree('win-x64', { packages: 'other-version' }))
      expect(other.status).toBe(1)
      expect(other.stderr).toContain(
        `  python carries pandas ${OTHER_PANDAS}; python-requirements.txt pins ${version('win-x64', 'pandas')}`,
      )
    })
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
    // A named_absent entry of the test's own, in the pins and in the tree's
    // metadata alike: the repository's lists may hold none (release 20261026
    // carries the one text the macOS metadata used to name without it).
    const absent = 'LICENSE.absent.txt'
    const moved = JSON.parse(PINS_TEXT)
    const mac: LicenceLists = moved.python.targets['darwin-arm64'].licences
    mac.named_absent[absent] = 'a text the metadata names and the archive was found not to carry'
    const dir = scratch()
    const pins = join(dir, 'pins.json')
    writeFileSync(pins, JSON.stringify(moved))
    writeFileSync(join(dir, 'python-requirements.txt'), REQUIREMENTS_TEXT)
    // Named and not carried, the entry is true and the tree passes.
    const held = check('darwin-arm64', vendorTree('darwin-arm64', { lists: mac }), pins)
    expect(held.stderr).toBe('')
    expect(held.status).toBe(0)
    const carried = check(
      'darwin-arm64',
      vendorTree('darwin-arm64', { lists: mac, licences: 'absent-carried' }),
      pins,
    )
    expect(carried.status).toBe(1)
    expect(carried.stderr).toContain(
      `darwin-arm64: python carries ${absent}, which named_absent says the archive lacks; take it off that list`,
    )
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

  // Issue 679: Tcl/Tk is stripped on every target, Windows' zlib1.dll with
  // it, so a runtime still carrying any of it is refused by the check the
  // vendor job makes once it has stripped the runtime and by the build's.
  it('refuses a runtime that still carries Tcl/Tk, as the vendor job and the build check it', () => {
    for (const target of ['darwin-arm64', 'darwin-x64', 'win-x64'] as const) {
      const carried = `python carries Tcl/Tk, which scripts/vendor-python.sh strips and nothing the sidecar runs loads: ${TCL_TK[target].named.join(', ')}\n`
      const built = check(target, vendorTree(target, { tclTk: true }))
      expect(built.status, target).toBe(1)
      expect(built.stderr).toContain(`  ${target}: ${carried}`)
      const vendor = vendorTree(target, { tclTk: true })
      const alone = spawnSync(
        process.execPath,
        [
          SCRIPT,
          target,
          '--packages',
          join(vendor, 'python', target, 'python'),
          '--pins',
          PINS_FILE,
        ],
        { encoding: 'utf8', timeout: 30_000, windowsHide: true },
      )
      expect(alone.status, target).toBe(1)
      expect(alone.stderr).toContain(`  ${carried}`)
    }
    // Windows' zlib1.dll alone, which only Tcl's library imported.
    const vendor = vendorTree('win-x64')
    put(join(vendor, 'python', 'win-x64', 'python', 'DLLs', 'zlib1.dll'), header('win-x64'))
    expect(check('win-x64', vendor).stderr).toContain(
      'win-x64: python carries Tcl/Tk, which scripts/vendor-python.sh strips and nothing the sidecar runs loads: DLLs/zlib1.dll\n',
    )
  })

  // The strip leaves site-packages alone, so a package's file that only
  // shares a name with Tcl/Tk stays and passes; a Tcl/Tk binary there is
  // still refused, loudly, as the safe direction.
  it("looks for Tcl/Tk's binaries in site-packages too, and passes what only shares a name", () => {
    const vendor = vendorTree('darwin-arm64')
    const python = join(vendor, 'python', 'darwin-arm64', 'python')
    const site = join(python, 'lib', 'python3.12', 'site-packages')
    put(join(site, 'PIL', '_tkinter_finder.py'), '# Pillow finds tkinter here\n')
    put(join(site, 'PIL', '.dylibs', 'libtiff.6.dylib'), header('darwin-arm64'))
    // A typeshed stub, as jedi and mypy carry one.
    put(join(site, 'typeshed', 'stdlib', '_tkinter.pyi'), 'def create() -> None: ...\n')
    put(join(python, 'lib', 'python3.12', 'threading.py'), '# the standard library\n')
    const passed = check('darwin-arm64', vendor)
    expect(passed.stderr).toBe('')
    expect(passed.status).toBe(0)
    put(join(site, 'tcltk', 'libthread3.0.6.dylib'), header('darwin-arm64'))
    put(join(site, 'tcltk', '_tkinter.cpython-312-darwin.so'), header('darwin-arm64'))
    const refused = check('darwin-arm64', vendor)
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain(
      'darwin-arm64: python carries Tcl/Tk, which scripts/vendor-python.sh strips and nothing the sidecar runs loads: lib/python3.12/site-packages/tcltk/_tkinter.cpython-312-darwin.so, lib/python3.12/site-packages/tcltk/libthread3.0.6.dylib\n',
    )
    // A package's own zlib1.dll is nothing of Tcl's; Tcl's library is.
    const windows = vendorTree('win-x64')
    const winSite = join(windows, 'python', 'win-x64', 'python', 'Lib', 'site-packages')
    put(join(winSite, 'PIL', '_tkinter_finder.py'), '# Pillow finds tkinter here\n')
    put(join(winSite, 'somepkg.libs', 'zlib1.dll'), header('win-x64'))
    const winPassed = check('win-x64', windows)
    expect(winPassed.stderr).toBe('')
    expect(winPassed.status).toBe(0)
    put(join(winSite, 'tcltk', 'tcl86t.dll'), header('win-x64'))
    expect(check('win-x64', windows).stderr).toContain(
      'win-x64: python carries Tcl/Tk, which scripts/vendor-python.sh strips and nothing the sidecar runs loads: Lib/site-packages/tcltk/tcl86t.dll\n',
    )
  })

  // A folder the check cannot read could hold anything. Skipped on Windows,
  // where chmod cannot take away the right to list a folder, and as root,
  // who lists it anyway.
  it.skipIf(!posixHost || process.getuid?.() === 0)(
    'never calls clean a runtime it could not read whole',
    async () => {
      const vendor = vendorTree('darwin-arm64')
      const python = join(vendor, 'python', 'darwin-arm64', 'python')
      const shut = join(python, 'lib', 'python3.12', 'shut')
      put(join(shut, 'inside.txt'), 'unseen\n')
      chmodSync(shut, 0o000)
      try {
        const result = check('darwin-arm64', vendor)
        expect(result.status).toBe(1)
        expect(result.stderr).toContain(
          'darwin-arm64: python could not be read whole to look for Tcl/Tk: lib/python3.12/shut (EACCES)\n',
        )
      } finally {
        chmodSync(shut, 0o755)
      }
      const { checkPythonStripped } = await load()
      const nowhere = join(scratch(), 'python')
      expect(checkPythonStripped({ python: nowhere })).toEqual([
        `python could not be read whole to look for Tcl/Tk: ${nowhere} (ENOENT)`,
      ])
    },
  )

  // Removing zlib-ng's named_absent entry (release 20261026) removed the
  // one check that would have noticed a macOS build stop linking the
  // system's libz, which the macOS pins and the vulnerability watch rest on.
  it("refuses a macOS build that links a zlib of its own, or none of the system's", () => {
    expect(refusal('darwin-arm64', 'zlib-own')).toContain(
      "darwin-arm64: python has build metadata in which binascii links z without system: true, a zlib of the runtime's own",
    )
    expect(refusal('darwin-x64', 'zlib-none')).toContain(
      "darwin-x64: python has build metadata in which nothing links the system's zlib (`z` with system: true)",
    )
    // Windows carries a zlib of its own, recorded under `unlisted`.
    const windows = check('win-x64', vendorTree('win-x64', { licences: 'zlib-own' }))
    expect(windows.stderr).toBe('')
    expect(windows.status).toBe(0)
  })

  // An extension that owes zlib's text and links no zlib has it compiled
  // in, though another extension links the system's; and only the variant
  // built into the runtime counts, wherever the metadata lists it.
  it('refuses a macOS extension with zlib compiled in, reading only the shipped variant', () => {
    expect(refusal('darwin-arm64', 'zlib-compiled-in')).toContain(
      'darwin-arm64: python has build metadata in which binascii owes LICENSE.zlib.txt but links no zlib, so its zlib is compiled in rather than the system',
    )
    const unshipped = check(
      'darwin-x64',
      vendorTree('darwin-x64', { licences: 'zlib-unshipped-own' }),
    )
    expect(unshipped.stderr).toBe('')
    expect(unshipped.status).toBe(0)
    expect(refusal('darwin-arm64', 'zlib-shipped-own')).toContain(
      "darwin-arm64: python has build metadata in which binascii links z without system: true, a zlib of the runtime's own",
    )
  })

  it('says how to call it when the target is not one', () => {
    const result = check('linux-x64', scratch())
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('usage:')
  })
})

// Issue 679: the strip in scripts/vendor-python.sh and the guard here are
// two spellings of one list, and nothing else reads the script. Were the
// prune dropped, the strip would delete a package's file that shares a name
// silently; were a name dropped from either side, they would disagree.
describe("scripts/vendor-python.sh's Tcl/Tk strip", () => {
  it('prunes site-packages and removes exactly the names the check holds it to', async () => {
    const script = readFileSync(join(repo, 'scripts', 'vendor-python.sh'), 'utf8')
    const lines = script
      .split('\n')
      .filter((line) => line.startsWith('find "$stage"') && line.includes("-name 'libtcl*'"))
    expect(lines, "the strip's one find line, naming libtcl*").toHaveLength(1)
    const [line] = lines
    expect(line.startsWith(`find "$stage" -path '*/site-packages' -prune -o \\(`), line).toBe(true)
    const globs = [...line.matchAll(/-name '([^']+)'/g)].map((match) => match[1])
    const converted = globs.map((glob) => glob.replace(/\./g, '\\.').replace(/\*/g, '.*'))
    const { STRIPPED } = await load()
    expect(STRIPPED.flags, 'find -name is case-sensitive').toBe('')
    const alternatives = /^\^\(\?:(.*)\)\$$/.exec(STRIPPED.source)?.[1]?.split('|')
    expect(alternatives, `STRIPPED is one group of alternatives: ${STRIPPED.source}`).toBeDefined()
    expect(new Set(converted)).toEqual(new Set(alternatives))
    expect(converted).toHaveLength(new Set(converted).size)
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

// The manifest's environment markers (PEP 508), judged per target as pip
// judges them on that target's runtime (issue 434).
describe('evaluateMarker', () => {
  it('judges the markers uv writes, for each target', async () => {
    const { evaluateMarker, markerEnvironment } = await load()
    const env = (target: string) => markerEnvironment(target, '3.12.14') as Record<string, string>
    const tzdata = "sys_platform == 'emscripten' or sys_platform == 'win32'"
    expect(evaluateMarker(tzdata, env('win-x64'))).toBe(true)
    expect(evaluateMarker(tzdata, env('darwin-arm64'))).toBe(false)
    expect(evaluateMarker(tzdata, env('darwin-x64'))).toBe(false)
    const machine = "platform_machine == 'arm64' and (os_name != 'nt' or python_version < '3.10')"
    expect(evaluateMarker(machine, env('darwin-arm64'))).toBe(true)
    expect(evaluateMarker(machine, env('darwin-x64'))).toBe(false)
    // Versions as numbers, where text would say the opposite: 3.12.14 is
    // after 3.9 and after 3.12.9.
    expect(evaluateMarker("python_full_version >= '3.9'", env('win-x64'))).toBe(true)
    expect(evaluateMarker("python_full_version < '3.12.9'", env('win-x64'))).toBe(false)
    expect(evaluateMarker("python_version == '3.12'", env('win-x64'))).toBe(true)
    // `in` is a substring, as PEP 508 has it ('win' is in 'darwin' too).
    expect(evaluateMarker('"win32" in sys_platform', env('win-x64'))).toBe(true)
    expect(evaluateMarker("'win32' not in sys_platform", env('darwin-x64'))).toBe(true)
  })

  it('refuses a marker it cannot judge rather than guessing, wherever it sits', async () => {
    const { evaluateMarker, markerEnvironment } = await load()
    const env = markerEnvironment('darwin-arm64', '3.12.14') as Record<string, string>
    expect(() => evaluateMarker("extra == 'notebooks'", env)).toThrow(
      'does not know the marker extra',
    )
    expect(() => evaluateMarker("sys_platform ~= 'darwin'", env)).toThrow('cannot judge ~= there')
    expect(() => evaluateMarker("(sys_platform == 'darwin'", env)).toThrow(
      'a bracket is not closed',
    )
    // After a comparison that already decided: still read, still refused.
    expect(() =>
      evaluateMarker("sys_platform == 'win32' and platform_release == '24.0.0'", env),
    ).toThrow('does not know the marker platform_release')
    expect(() =>
      evaluateMarker("sys_platform == 'darwin' or platform_release == '24.0.0'", env),
    ).toThrow('does not know the marker platform_release')
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

  // The packager copies the runtime with its record, and the hook holds both
  // to the pins and the manifest beside them again (issue 434).
  it("refuses a packaged runtime whose packages or record are not the pins'", async () => {
    const { afterPack } = await load()
    await expect(
      afterPack(packaged('darwin-arm64', { bytecodeFlags: 1, packages: 'unlisted' }), {
        LEGIBLE_VENDOR_TARGET: 'darwin-arm64',
      }),
    ).rejects.toThrow(
      'darwin-arm64: python carries setuptools 80.9.0, which python-requirements.txt does not list',
    )
    await expect(
      afterPack(packaged('win-x64', { bytecodeFlags: 1, record: 'other-commit' }), {
        LEGIBLE_VENDOR_TARGET: 'win-x64',
      }),
    ).rejects.toThrow(
      'win-x64: engine was built from commit d9c465fda2f53b96f1d226a0fd1f9abf877d6ec6',
    )
  })

  it('refuses a packaged runtime that still carries Tcl/Tk (issue 679)', async () => {
    const { afterPack } = await load()
    await expect(
      afterPack(packaged('win-x64', { bytecodeFlags: 1, tclTk: true }), {
        LEGIBLE_VENDOR_TARGET: 'win-x64',
      }),
    ).rejects.toThrow(
      `win-x64: python carries Tcl/Tk, which scripts/vendor-python.sh strips and nothing the sidecar runs loads: ${TCL_TK['win-x64'].named.join(', ')}`,
    )
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

  /** One top-level section, from its own `name:` line to the next one. */
  const section = (name: string): string => {
    const start = config.indexOf(`\n${name}:`) + 1
    expect(start).toBeGreaterThan(0)
    const body = config.indexOf('\n', start) + 1
    const next = config.slice(body).search(/^[A-Za-z]/m)
    return config.slice(start, next === -1 ? config.length : body + next)
  }

  // electron-builder falls back to its own default icon when a named one is
  // missing: any generic icon under build/, then the framework's, with only
  // a warning in a log nobody reads (app-builder-lib's iconConverter). So
  // the installers would carry Electron's atom and every other check here
  // would still pass (issue 140). Per section, because the app bundle, the
  // disk image, the exe and the installer's pages each name their own: a
  // file-wide assertion passes on a sibling while one of them goes bare.
  it('names a brand icon in each section that draws one, and each is on disk', () => {
    const named = new Map<string, string[]>()
    for (const name of ['mac', 'dmg', 'win', 'nsis']) {
      const icons = [
        ...section(name).matchAll(/^[ \t]+(?:icon|installer\w*Icon|uninstallerIcon): (\S+)$/gm),
      ].map((m) => m[1])
      expect(icons.length).toBeGreaterThan(0)
      named.set(name, icons)
    }
    expect(named.get('mac')).toEqual(['assets/brand/macos/icon.icns'])
    expect(named.get('dmg')).toEqual(['assets/brand/macos/icon.icns'])
    expect(named.get('win')).toEqual(['assets/brand/windows/icon.ico'])
    expect(named.get('nsis')).toEqual([
      'assets/brand/windows/icon.ico',
      'assets/brand/windows/icon.ico',
      'assets/brand/windows/icon.ico',
    ])
    const backgrounds = [...config.matchAll(/^[ \t]+background: (\S+)$/gm)].map((m) => m[1])
    expect(backgrounds).toEqual(['assets/brand/macos/background.tiff'])
    for (const file of [...[...named.values()].flat(), ...backgrounds])
      expect(existsSync(join(repo, file))).toBe(true)
  })

  // dmg-builder takes the window from the background's own pixel size and
  // ignores a `window:` block whenever a background is set (dmgUtil.js), so
  // the art is the size: the two icon positions have to fall inside it, and
  // a background swapped for larger art moves the window with it.
  it('places the disk image icons inside the background it draws them on', () => {
    // The TIFF is what the packager reads, and it is built from the PNGs by
    // hand (`tiffutil`), so the size is taken from the TIFF itself: art
    // edited without rebuilding it would otherwise pass here and ship.
    const tiff = readFileSync(join(repo, 'assets/brand/macos/background.tiff'))
    const little = tiff.subarray(0, 2).toString('latin1') === 'II'
    expect(little || tiff.subarray(0, 2).toString('latin1') === 'MM').toBe(true)
    const u16 = (at: number): number => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at))
    const u32 = (at: number): number => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at))
    const ifd = u32(4)
    const dimension: Record<number, number> = {}
    for (let i = 0; i < u16(ifd); i++) {
      const entry = ifd + 2 + i * 12
      const tag = u16(entry)
      // ImageWidth and ImageLength, as a SHORT (3) or a LONG (4).
      if (tag === 256 || tag === 257)
        dimension[tag] = u16(entry + 2) === 3 ? u16(entry + 8) : u32(entry + 8)
    }
    const [width, height] = [dimension[256], dimension[257]]
    expect([width, height]).toEqual([660, 400])
    // The @1x PNG it was built from, so the pair cannot drift apart unseen.
    const png = readFileSync(join(repo, 'assets/brand/macos/dmg-background.png'))
    expect(png.subarray(12, 16).toString('latin1')).toBe('IHDR')
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([width, height])
    const dmg = section('dmg')
    expect(dmg).not.toMatch(/^[ \t]+window:$/m)
    const at = [...dmg.matchAll(/^[ \t]+- x: (\d+)\n[ \t]+y: (\d+)$/gm)].map(
      (m) => [Number(m[1]), Number(m[2])] as const,
    )
    expect(at).toHaveLength(2)
    for (const [x, y] of at) {
      expect(x).toBeGreaterThan(0)
      expect(x).toBeLessThan(width)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(height)
    }
  })

  // The three branded NSIS bitmaps draw only on the assisted installer, and
  // oneClick: false would move what acceptance.yml derives (see the config).
  it('leaves the one-click installer alone', () => {
    expect(config).not.toMatch(/^[ \t]*oneClick:/m)
    expect(config).not.toMatch(/^[ \t]*(installerSidebar|uninstallerSidebar|installerHeader):/m)
  })

  // acceptance.yml reads the tag's own electron-builder.yml and refuses an
  // nsis section holding anything it does not know, because a person's
  // install folder is derived rather than read. It is dispatched by hand
  // against a published tag, so an option it has not been taught fails the
  // release gate and nothing before it. The workflow's own pattern is lifted
  // out and run over this config's nsis lines, rather than its key list
  // being read off: the gate refuses a key it knows written in a shape it
  // does not - quoted, a flow scalar, a value on the next line - and a test
  // that only compared keys would pass every one of those (issue 140).
  it('sets no nsis line the acceptance gate would refuse', () => {
    const workflow = readFileSync(join(repo, '.github/workflows/acceptance.yml'), 'utf8')
    // PowerShell's single-quoted string, in which '' is one quote. The file
    // holds two of these; the one naming `include` is the line check, the
    // other tests the `nsis:` header itself.
    const guards = [...workflow.matchAll(/\$line -notmatch '(?<pattern>(?:[^']|'')+)'\)/g)]
      .map((m) => (m.groups?.pattern as string).replaceAll("''", "'"))
      .filter((pattern) => pattern.includes('include'))
    expect(guards).toHaveLength(1)
    const allows = new RegExp(guards[0])
    const lines = section('nsis')
      .split('\n')
      .slice(1)
      .filter((line) => line.trim() !== '' && !/^[ \t]*#/.test(line))
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.filter((line) => !allows.test(line))).toEqual([])
    // And the pattern is the gate's, not one that lets anything through.
    expect(allows.test('  oneClick: false')).toBe(false)
    expect(allows.test('  include: [build/installer.nsh]')).toBe(false)
  })
})
