// Refuse a target whose vendored components are missing, stale or built for
// another processor family, naming the component and the target; then
// write the manifest that records every bundled component's exact version
// (specs/002-vendored-components-and-installers, A0-10, ADR-035).
//
//   node scripts/check-vendored.mjs <target> [--vendor <dir>] [--pins <file>] [--out <file>]
//   node scripts/check-vendored.mjs <target> --licences <python-dir> [--pins <file>]
//   npm run dist:check darwin-arm64
//
// With --licences it checks only one runtime's licence texts against its
// build metadata and the pins' lists (ADR-042): scripts/vendor-python.sh
// runs it before a runtime is vendored, as the same check runs here later.
//
// Targets: darwin-arm64, darwin-x64, win-x64. The tree it reads is the one
// .github/workflows/build.yml lays out from the same run's vendor artefacts:
//
//   vendor/python/<target>/python/   the runtime, with the engine installed
//   vendor/loom/<target>/            gtfs2graph, topo, loom, octi (.exe on Windows)
//   vendor/ffmpeg/<target>/          ffmpeg and ffprobe (.exe on Windows)
//
// and on success it writes vendor/manifest-<target>.json. On a refusal it
// removes any manifest already there, so a stale one cannot be packaged.
//
// The same module is electron-builder's afterPack hook: once the packager
// has copied the components into the app's resources, the hook checks them
// there, where the app will look for them, and checks that the manifest
// beside them was written from the pins file being built. electron-builder
// skips an extraResources source that does not exist with a warning; this
// is what turns that into a failure. It is strict when LEGIBLE_VENDOR_TARGET
// names the target (the build workflow sets it), and when any component is
// present at all; a local `npm run dist` with nothing vendored is let through,
// saying so, because an unpacked build of the interface is still useful.
//
// Architectures are read from the executables' own headers (Mach-O and PE),
// not from `lipo` or `file`, so the check runs the same on every build
// machine, needs no child process, and a darwin-x64 tree can be checked on
// an arm64 Mac. Nothing here runs a vendored binary: the vendor jobs
// already proved each one on its own runner, and a binary for another
// architecture cannot be run to ask it.

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const TARGETS = ['darwin-arm64', 'darwin-x64', 'win-x64']

/** What each target's executables must be. */
const EXPECTED = {
  'darwin-arm64': { format: 'Mach-O', arch: 'arm64' },
  'darwin-x64': { format: 'Mach-O', arch: 'x64' },
  'win-x64': { format: 'PE', arch: 'x64' },
}

export const LOOM_TOOLS = ['gtfs2graph', 'topo', 'loom', 'octi']

/** The manifest's name inside the packaged app's resources. */
export const MANIFEST_IN_RESOURCES = 'vendor-manifest.json'

const MACH_O_CPU = { 0x0100000c: 'arm64', 0x01000007: 'x64', 7: 'x86', 12: 'arm' }
const PE_MACHINE = { 0x8664: 'x64', 0xaa64: 'arm64', 0x014c: 'x86' }

/**
 * The executable format and the architectures a file's header names, or
 * null for a file that is neither a Mach-O nor a PE. A universal Mach-O
 * names each of its slices.
 *
 * @param {Uint8Array} header at least the file's first 4096 bytes, or all of a shorter file
 * @returns {{ format: 'Mach-O' | 'PE', archs: string[] } | null}
 */
export function readArchitecture(header) {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
  if (header.byteLength < 8) return null
  const le = view.getUint32(0, true)
  // A thin Mach-O, 64- or 32-bit, in the byte order every Mac writes.
  if (le === 0xfeedfacf || le === 0xfeedface) {
    const cpu = view.getUint32(4, true)
    return { format: 'Mach-O', archs: [MACH_O_CPU[cpu] ?? `cpu 0x${cpu.toString(16)}`] }
  }
  // A universal Mach-O is big-endian. Java class files share the magic; a
  // real one has a handful of slices, a class file a version in the
  // thousands.
  const be = view.getUint32(0, false)
  if (be === 0xcafebabe || be === 0xcafebabf) {
    const count = view.getUint32(4, false)
    const width = be === 0xcafebabe ? 20 : 32
    if (count === 0 || count > 16 || 8 + count * width > header.byteLength) return null
    const archs = []
    for (let i = 0; i < count; i += 1) {
      const cpu = view.getUint32(8 + i * width, false)
      archs.push(MACH_O_CPU[cpu] ?? `cpu 0x${cpu.toString(16)}`)
    }
    return { format: 'Mach-O', archs }
  }
  // A PE: "MZ", the PE header's offset at 0x3c, "PE\0\0" there, the machine after it.
  if (header[0] === 0x4d && header[1] === 0x5a && header.byteLength >= 0x40) {
    const offset = view.getUint32(0x3c, true)
    if (offset + 6 > header.byteLength) return null
    if (view.getUint32(offset, false) !== 0x50450000) return null
    const machine = view.getUint16(offset + 4, true)
    return { format: 'PE', archs: [PE_MACHINE[machine] ?? `machine 0x${machine.toString(16)}`] }
  }
  return null
}

function readHeader(path) {
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(4096)
    const read = readSync(fd, buffer, 0, buffer.length, 0)
    return buffer.subarray(0, read)
  } finally {
    closeSync(fd)
  }
}

/** The hex sha256 of a file's bytes. */
export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Where each component sits: the vendored tree before packaging, or the
 * packaged app's resources after.
 *
 * @param {'vendor' | 'resources'} kind
 * @param {string} root the vendor folder, or the resources folder
 * @param {string} target
 */
export function layout(kind, root, target) {
  if (kind === 'vendor') {
    return {
      python: join(root, 'python', target, 'python'),
      loom: join(root, 'loom', target),
      ffmpeg: join(root, 'ffmpeg', target),
      manifest: join(root, `manifest-${target}.json`),
    }
  }
  return {
    python: join(root, 'python'),
    loom: join(root, 'loom'),
    ffmpeg: join(root, 'ffmpeg'),
    manifest: join(root, MANIFEST_IN_RESOURCES),
  }
}

const isFile = (path) => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

const isDirectory = (path) => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

const list = (path) => {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

/** The interpreter's minor-version folder under lib, `python3.12`, on macOS. */
function libFolder(python) {
  return list(join(python, 'lib')).find((name) => /^python3\.\d+$/.test(name)) ?? null
}

/** Where the runtime keeps its standard library, per target. */
export function runtimePaths(python, target) {
  if (target.startsWith('win-')) {
    return {
      interpreter: join(python, 'python.exe'),
      lib: join(python, 'Lib'),
      sitePackages: join(python, 'Lib', 'site-packages'),
      patchlevel: join(python, 'include', 'patchlevel.h'),
      licence: join(python, 'LICENSE.txt'),
    }
  }
  const minor = libFolder(python) ?? 'python3'
  return {
    interpreter: join(python, 'bin', 'python3'),
    lib: join(python, 'lib'),
    sitePackages: join(python, 'lib', minor, 'site-packages'),
    patchlevel: join(python, 'include', minor, 'patchlevel.h'),
    licence: join(python, 'lib', minor, 'LICENSE.txt'),
  }
}

/**
 * The runtime's bytecode, audited: every `.py` under `lib` needs a
 * `__pycache__/<name>.cpython-XY.pyc` beside it, and every one of those must
 * be hash-based and unchecked (flags 0b01 in its header). A timestamped pyc
 * is valid only while its source keeps the time it was compiled against,
 * and copying the runtime into the app gives every source a new time: the
 * first start then rewrites the pyc inside the bundle, which on macOS
 * breaks the bundle's signature. The build compiles with `-f`, so pycs the
 * compiler's own imports wrote are replaced rather than kept.
 */
function bytecodeOf(lib) {
  let sources = 0
  const missing = []
  const timestamped = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    const cache = join(dir, '__pycache__')
    const compiled = new Map()
    for (const name of list(cache)) {
      const match = /^(.+)\.cpython-\d+\.pyc$/.exec(name)
      if (match !== null) compiled.set(match[1], name)
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name !== '__pycache__') walk(join(dir, entry.name))
        continue
      }
      if (!entry.name.endsWith('.py')) continue
      sources += 1
      const pyc = compiled.get(entry.name.slice(0, -3))
      if (pyc === undefined) {
        missing.push(entry.name)
        continue
      }
      const header = readHeader(join(cache, pyc))
      const flags = header.byteLength >= 8 ? header.readUInt32LE(4) : -1
      if (flags !== 1) timestamped.push(pyc)
    }
  }
  walk(lib)
  return { sources, missing, timestamped }
}

/** Where the runtime keeps the licence texts it owes, beside the interpreter's own tree. */
export function licencePaths(python) {
  return { folder: join(python, 'licenses'), metadata: join(python, 'PYTHON.json') }
}

/**
 * The licence texts python-build-standalone's metadata names: the runtime's
 * own and every extension module's, as file names in `licenses/`. A path
 * outside that folder is kept as it is, so it matches no file and is
 * reported rather than skipped.
 */
export function namedLicences(metadata) {
  const paths = []
  if (typeof metadata?.license_path === 'string') paths.push(metadata.license_path)
  const extensions = metadata?.build_info?.extensions
  if (extensions !== null && typeof extensions === 'object') {
    for (const variants of Object.values(extensions)) {
      if (!Array.isArray(variants)) continue
      for (const variant of variants) {
        if (Array.isArray(variant?.license_paths)) paths.push(...variant.license_paths)
      }
    }
  }
  return new Set(
    paths.map((path) => (/^licenses\/[^/]+$/.test(String(path)) ? path.slice(9) : String(path))),
  )
}

/**
 * Whether the runtime's licence texts, the build metadata they came with and
 * the lists in `python.targets.<target>.licences` agree (issue 108, ADR-042).
 * The metadata alone is not enough: on macOS it names a zlib-ng text the
 * archive does not carry, and on Windows it names nothing for the zlib,
 * Expat and libmpdec compiled into the DLLs. So three reviewed lists say
 * what the metadata does not, and every entry is held to still being true;
 * the strings an `unlisted` entry gives are looked for in the file it names,
 * so the reason for listing it is proved again on every check.
 *
 * @param {object} options
 * @param {string} options.python the runtime's root (`python/`)
 * @param {string} options.target
 * @param {any} options.pins the parsed vendor/pins.json
 * @returns {string[]} the problems, each a phrase to follow "python "
 */
export function checkPythonLicences({ python, target, pins }) {
  const problems = []
  const pin = pins.python.targets[target]
  const lists = pin?.licences
  const incorporated = pins.python.licence_texts?.cpython_incorporated
  if (lists === undefined || incorporated === undefined) {
    return [`has no licence lists for ${target} in vendor/pins.json`]
  }
  const { folder, metadata: metadataPath } = licencePaths(python)
  if (!isDirectory(folder)) return [`carries no licence texts (looked for ${folder})`]
  let metadata
  try {
    metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
  } catch {
    return [`carries no readable build metadata (looked for ${metadataPath})`]
  }
  if (metadata.python_version !== pins.python.version || metadata.target_triple !== pin.triple) {
    problems.push(
      `has build metadata for ${metadata.python_version} ${metadata.target_triple}, not ${pins.python.version} ${pin.triple}`,
    )
  }

  const carried = new Set(list(folder).filter((name) => isFile(join(folder, name))))
  const named = namedLicences(metadata)
  const unlisted = lists.unlisted ?? {}
  const absent = lists.named_absent ?? {}
  const notLinked = new Set(lists.not_linked ?? [])
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

  // The one text this repository adds, CPython's own notices, is checked by
  // its hash and is not python-build-standalone's to account for.
  const ours = join(folder, incorporated.file)
  if (!isFile(ours)) {
    problems.push(`is missing ${incorporated.file}, CPython's incorporated-software notices`)
  } else if (sha256File(ours) !== incorporated.sha256) {
    problems.push(`has a ${incorporated.file} that is not the pinned one`)
  }
  carried.delete(incorporated.file)

  for (const name of named) {
    if (has(absent, name)) {
      if (carried.has(name)) {
        problems.push(
          `carries ${name}, which named_absent says the archive lacks; take it off that list`,
        )
      }
    } else if (!carried.has(name)) {
      problems.push(`has build metadata naming ${name}, which is not among the licence texts`)
    }
  }
  for (const name of Object.keys(absent)) {
    if (!named.has(name)) {
      problems.push(`lists ${name} as named_absent, but the build metadata no longer names it`)
    }
  }
  for (const [name, entry] of Object.entries(unlisted)) {
    if (named.has(name)) {
      problems.push(`lists ${name} as unlisted, but the build metadata names it now`)
    }
    if (notLinked.has(name)) problems.push(`lists ${name} as both unlisted and not_linked`)
    if (!carried.has(name)) problems.push(`owes ${name} (${entry.library}), which is not carried`)
    const file = join(python, ...String(entry.file).split('/'))
    if (!isFile(file)) {
      problems.push(`lists ${name} for ${entry.file}, which is not in the runtime`)
      continue
    }
    const bytes = readFileSync(file)
    for (const text of entry.contains ?? []) {
      if (!bytes.includes(Buffer.from(text, 'utf8'))) {
        problems.push(
          `lists ${name} for ${entry.file}, which no longer contains "${text}"; read it again`,
        )
      }
    }
  }
  for (const name of notLinked) {
    if (named.has(name)) {
      problems.push(`lists ${name} as not_linked, but the build metadata names it now`)
    }
    if (!carried.has(name)) problems.push(`lists ${name} as not_linked, but it is not carried`)
  }
  for (const name of carried) {
    if (!named.has(name) && !has(unlisted, name) && !notLinked.has(name)) {
      problems.push(
        `carries ${name}, which neither the build metadata nor the pins' lists account for`,
      )
    }
  }
  return problems
}

/** Each installed distribution's name and version, from its `.dist-info` folder. */
function installedPackages(sitePackages) {
  return list(sitePackages)
    .map((name) => /^(.+?)-([^-]+)\.dist-info$/.exec(name))
    .filter((match) => match !== null)
    .map((match) => ({ name: match[1], version: match[2] }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Check one target's components under `paths` against `pins`.
 *
 * @param {object} options
 * @param {string} options.target
 * @param {ReturnType<typeof layout>} options.paths
 * @param {any} options.pins the parsed vendor/pins.json
 * @param {boolean} [options.bytecode] also require the runtime's compiled
 *   bytecode, hash-based and unchecked (after the build compiled it)
 * @param {boolean} [options.executableBits] require the executable bit on
 *   the macOS binaries; true on a POSIX build machine by default
 * @returns {{ problems: string[], packages: { name: string, version: string }[] }}
 */
export function checkTree({ target, paths, pins, bytecode = false, executableBits }) {
  const problems = []
  const refuse = (component, message) => problems.push(`${target}: ${component} ${message}`)
  const expected = EXPECTED[target]
  if (expected === undefined) {
    return { problems: [`${target}: not a target; known: ${TARGETS.join(', ')}`], packages: [] }
  }
  const windows = target.startsWith('win-')
  const exe = windows ? '.exe' : ''
  const checkBits = executableBits ?? (!windows && process.platform !== 'win32')
  // Relative to where it was run when that is shorter and inside it; the
  // path as given otherwise.
  const shown = (path) => {
    const rel = relative(process.cwd(), path)
    return rel !== '' && !rel.startsWith('..') ? rel : path
  }

  /** Present, executable where it has to be, and exactly the target's architecture. */
  const binary = (component, path) => {
    if (!isFile(path)) {
      refuse(component, `is missing ${basename(path)} (looked for ${shown(path)})`)
      return false
    }
    if (checkBits && (statSync(path).mode & 0o111) === 0) {
      refuse(
        component,
        `has ${basename(path)} without its executable bit (the artefact zip drops it; chmod +x)`,
      )
    }
    const found = readArchitecture(readHeader(path))
    if (found === null) {
      refuse(component, `has ${basename(path)}, which is not a ${expected.format} executable`)
    } else if (
      found.format !== expected.format ||
      found.archs.length !== 1 ||
      found.archs[0] !== expected.arch
    ) {
      refuse(
        component,
        `has ${basename(path)} built for ${found.format} ${found.archs.join(' + ')}, not ${expected.format} ${expected.arch}`,
      )
    }
    return true
  }

  // The runtime, with the engine in it.
  let packages = []
  if (!isDirectory(paths.python)) {
    refuse('python', `is missing (looked for ${shown(paths.python)})`)
  } else {
    const runtime = runtimePaths(paths.python, target)
    binary('python', runtime.interpreter)
    const patchlevel = isFile(runtime.patchlevel) ? readFileSync(runtime.patchlevel, 'utf8') : ''
    const version = /#define\s+PY_VERSION\s+"([^"]+)"/.exec(patchlevel)?.[1] ?? null
    if (version === null) {
      refuse('python', `has no version to read (looked for ${shown(runtime.patchlevel)})`)
    } else if (version !== pins.python.version) {
      refuse(
        'python',
        `is ${version}; vendor/pins.json pins ${pins.python.version}, so it is stale`,
      )
    }
    if (!isFile(runtime.licence)) {
      refuse('python', `carries no licence file (looked for ${shown(runtime.licence)})`)
    }
    // The texts of the libraries the runtime links, which its own
    // LICENSE.txt does not carry, agreeing with its build metadata and the
    // pins' lists (ADR-042).
    for (const problem of checkPythonLicences({ python: paths.python, target, pins })) {
      refuse('python', problem)
    }
    packages = installedPackages(runtime.sitePackages)
    const engine = packages.find((p) => p.name === 'openschematicmaps')
    if (engine === undefined) {
      refuse('engine', `is not installed in the runtime (looked in ${shown(runtime.sitePackages)})`)
    } else if (engine.version !== pins.engine.version) {
      refuse(
        'engine',
        `is ${engine.version}; vendor/pins.json pins ${pins.engine.version}, so it is stale`,
      )
    }
    if (bytecode) {
      const { sources, missing, timestamped } = bytecodeOf(runtime.lib)
      if (sources === 0) {
        refuse('python', `has no Python sources to have compiled (looked in ${shown(runtime.lib)})`)
      } else if (missing.length > 0) {
        refuse(
          'python',
          `has ${missing.length} of ${sources} modules without compiled bytecode, ${missing[0]} among them`,
        )
      }
      if (timestamped.length > 0) {
        refuse(
          'python',
          `has ${timestamped.length} bytecode files that are not unchecked-hash, ${timestamped[0]} among them; a copy that changes the sources' times makes Python rewrite them inside the bundle`,
        )
      }
    }
  }

  // The four LOOM tools. Windows' are static: a DLL beside them would be
  // one a user's machine has to supply or, worse, one of Microsoft's own
  // (ADR-021).
  if (!isDirectory(paths.loom)) {
    refuse('loom', `is missing (looked for ${shown(paths.loom)})`)
  } else {
    for (const tool of LOOM_TOOLS) binary('loom', join(paths.loom, tool + exe))
    const dlls = list(paths.loom).filter((name) => /\.dll$/i.test(name))
    if (dlls.length > 0) refuse('loom', `carries DLLs it must not: ${dlls.join(', ')}`)
  }

  // ffmpeg and ffprobe, each carrying the pinned version and configure line
  // in its own strings, which is what -version prints; a binary from
  // another pin does not.
  const ffmpegPin = pins.ffmpeg.targets[target]
  if (!isDirectory(paths.ffmpeg)) {
    refuse('ffmpeg', `is missing (looked for ${shown(paths.ffmpeg)})`)
  } else if (ffmpegPin === undefined) {
    refuse('ffmpeg', 'has no pin in vendor/pins.json')
  } else {
    for (const name of ['ffmpeg', 'ffprobe']) {
      const path = join(paths.ffmpeg, name + exe)
      if (!binary('ffmpeg', path)) continue
      const bytes = readFileSync(path)
      if (!bytes.includes(Buffer.from(ffmpegPin.reports, 'utf8'))) {
        refuse(
          'ffmpeg',
          `has ${name + exe} without the pinned version ${ffmpegPin.reports}, so it is stale`,
        )
      } else if (!bytes.includes(Buffer.from(ffmpegPin.configure, 'utf8'))) {
        refuse('ffmpeg', `has ${name + exe} without the pinned configure line, so it is stale`)
      }
    }
  }

  return { problems, packages }
}

/**
 * The manifest: the pins file's hash, the target, and every bundled
 * component's exact version, from the pins and from what the runtime
 * actually carries. No path from the machine that built it.
 */
export function buildManifest({ target, pins, pinsSha256, packages, app }) {
  const python = pins.python
  const engine = pins.engine
  const loom = pins.loom
  const ffmpeg = pins.ffmpeg
  const ffmpegTarget = ffmpeg.targets[target]
  return {
    $comment:
      'Written by scripts/check-vendored.mjs from vendor/pins.json once every component for this target was present, current and the right architecture. A release gathers the source of each GPL component from here (A6-01).',
    manifest: 1,
    target,
    pins_sha256: pinsSha256,
    build: {
      commit: process.env.GITHUB_SHA ?? null,
      run: process.env.GITHUB_RUN_ID ?? null,
    },
    app: { name: app.productName, version: app.version, electron: app.electron },
    components: {
      python: {
        source: python.source,
        release: python.release,
        version: python.version,
        asset: python.targets[target].asset,
        sha256: python.targets[target].sha256,
        // Where the licence texts under python/licenses came from (ADR-042).
        licence_texts: {
          full_asset: python.targets[target].full.asset,
          full_sha256: python.targets[target].full.sha256,
          cpython_incorporated: {
            url: python.licence_texts.cpython_incorporated.url,
            sha256: python.licence_texts.cpython_incorporated.sha256,
          },
        },
        licence: python.licence,
        bytecode: 'compiled at build, --invalidation-mode unchecked-hash',
      },
      engine: {
        repo: engine.repo,
        tag: engine.tag,
        version: engine.version,
        protocol: engine.protocol,
        schema_sha256: engine.schema_sha256,
        licence: engine.licence,
      },
      python_packages: packages,
      loom: {
        repo: loom.repo,
        commit: loom.commit,
        binaries: loom.binaries,
        licence: loom.licence,
        ...(target.startsWith('win-')
          ? {
              windows_port: {
                repo: pins.loom_windows_port.repo,
                commit: pins.loom_windows_port.commit,
                licence: pins.loom_windows_port.licence,
              },
            }
          : {}),
      },
      // Built by this repository's vendor job from these sources (ADR-040);
      // its ffmpeg-source artefact carries them with every configure line.
      ffmpeg: {
        version: ffmpeg.version,
        reports: ffmpegTarget.reports,
        built_by: 'scripts/vendor-ffmpeg.sh in .github/workflows/vendor.yml',
        source: {
          url: ffmpeg.source.url,
          sha256: ffmpeg.source.sha256,
          tag: ffmpeg.source.tag,
          commit: ffmpeg.source.commit,
        },
        configure: ffmpegTarget.configure,
        x264: {
          repo: ffmpeg.x264.repo,
          commit: ffmpeg.x264.commit,
          sha256: ffmpeg.x264.sha256,
          configure: ffmpegTarget.x264_configure,
          licence: ffmpeg.x264.licence,
        },
        zlib:
          ffmpegTarget.zlib === 'static'
            ? {
                linked: 'static',
                version: ffmpeg.zlib.version,
                url: ffmpeg.zlib.url,
                sha256: ffmpeg.zlib.sha256,
                configure: ffmpegTarget.zlib_configure,
                licence: ffmpeg.zlib.licence,
              }
            : { linked: 'system' },
        licence: ffmpeg.licence,
      },
    },
  }
}

function appInfo(root) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  return {
    productName: pkg.productName,
    version: pkg.version,
    electron: pkg.devDependencies?.electron ?? null,
  }
}

/**
 * Check a vendored tree and write its manifest, or refuse and remove any
 * manifest already there. Returns the problems, empty on success.
 */
export function checkVendor({ target, vendor, pinsFile, out }) {
  const pins = JSON.parse(readFileSync(pinsFile, 'utf8'))
  const paths = layout('vendor', vendor, target)
  const manifestPath = out ?? paths.manifest
  const { problems, packages } = checkTree({ target, paths, pins })
  if (problems.length > 0) {
    rmSync(manifestPath, { force: true })
    return { problems, manifestPath: null }
  }
  const manifest = buildManifest({
    target,
    pins,
    pinsSha256: sha256File(pinsFile),
    packages,
    app: appInfo(repoRoot),
  })
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  return { problems: [], manifestPath }
}

/**
 * Check a packaged app's resources: the components where the app looks for
 * them, compiled bytecode, and a manifest written from these pins for this
 * target.
 */
export function checkResources({ target, resources, pinsFile, bytecode = true }) {
  const pins = JSON.parse(readFileSync(pinsFile, 'utf8'))
  const paths = layout('resources', resources, target)
  const { problems } = checkTree({ target, paths, pins, bytecode })
  for (const path of Object.values(electronLicencePaths(resources, target))) {
    if (!isFile(path)) {
      problems.push(
        `${target}: electron is missing ${basename(path)}, Electron's or Chromium's licences (looked for ${path})`,
      )
    }
  }
  if (!isFile(paths.manifest)) {
    problems.push(
      `${target}: manifest is missing (looked for ${MANIFEST_IN_RESOURCES} in the resources)`,
    )
  } else {
    let manifest = null
    try {
      manifest = JSON.parse(readFileSync(paths.manifest, 'utf8'))
    } catch {
      problems.push(`${target}: manifest is not JSON`)
    }
    if (manifest !== null) {
      const want = sha256File(pinsFile)
      if (manifest.target !== target) {
        problems.push(`${target}: manifest was written for ${manifest.target}`)
      }
      if (manifest.pins_sha256 !== want) {
        problems.push(
          `${target}: manifest is stale: it was written from pins ${manifest.pins_sha256}, and vendor/pins.json is ${want}; run the check again`,
        )
      }
    }
  }
  return problems
}

/**
 * Where a packaged app keeps Electron's and Chromium's licences. On Windows
 * electron-builder leaves them beside the executable, one folder above the
 * resources; from a Mac app it deletes them, and electron-builder.yml puts
 * them back in the resources under the same names (issue 108).
 */
export function electronLicencePaths(resources, target) {
  const folder = target.startsWith('win-') ? dirname(resources) : resources
  return {
    electron: join(folder, 'LICENSE.electron.txt'),
    chromium: join(folder, 'LICENSES.chromium.html'),
  }
}

/** The target an electron-builder platform and arch build, or null. */
export function targetOf(platformName, arch) {
  // builder-util's Arch: ia32 0, x64 1, armv7l 2, arm64 3, universal 4.
  const archName = typeof arch === 'number' ? { 1: 'x64', 3: 'arm64' }[arch] : arch
  const os = { darwin: 'darwin', mas: 'darwin', win32: 'win' }[platformName]
  if (os === undefined || archName === undefined) return null
  const target = `${os}-${archName}`
  return TARGETS.includes(target) ? target : null
}

/**
 * electron-builder's afterPack hook. `context` is its AfterPackContext:
 * `appOutDir`, `electronPlatformName`, `arch`, and the `packager`.
 * electron-builder passes only the context; the pins file is a parameter
 * so the tests can check a tree against pins of their own.
 */
export async function afterPack(
  context,
  env = process.env,
  pinsFile = join(repoRoot, 'vendor', 'pins.json'),
) {
  const target = targetOf(context.electronPlatformName, context.arch)
  const required = env.LEGIBLE_VENDOR_TARGET || null
  if (required !== null && required !== target) {
    throw new Error(
      `LEGIBLE_VENDOR_TARGET is ${required}, but this build packages ${target ?? `${context.electronPlatformName} ${context.arch}`}`,
    )
  }
  const resources =
    context.electronPlatformName === 'darwin' || context.electronPlatformName === 'mas'
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources',
        )
      : join(context.appOutDir, 'resources')
  const paths = target === null ? null : layout('resources', resources, target)
  const anything =
    paths !== null &&
    [paths.python, paths.loom, paths.ffmpeg, paths.manifest].some((p) => existsSync(p))
  if (required === null && !anything) {
    process.stdout.write(
      `  • no vendored components in this build (${target ?? context.electronPlatformName}); it is not an installer. LEGIBLE_VENDOR_TARGET makes them required.\n`,
    )
    return
  }
  if (target === null) {
    throw new Error(
      `no vendored components exist for ${context.electronPlatformName} ${context.arch}`,
    )
  }
  const problems = checkResources({
    target,
    resources,
    pinsFile,
  })
  if (problems.length > 0) {
    throw new Error(`the packaged app is not complete:\n  ${problems.join('\n  ')}`)
  }
  process.stdout.write(
    `  • vendored components for ${target} are in place, current and ${EXPECTED[target].arch}\n`,
  )
}

export default afterPack

function parseArgs(argv) {
  const options = {
    target: null,
    vendor: join(repoRoot, 'vendor'),
    pinsFile: null,
    out: null,
    licences: null,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = () => {
      const next = argv[i + 1]
      if (next === undefined) throw new Error(`${arg} needs a value`)
      i += 1
      return resolve(next)
    }
    if (arg === '--vendor') options.vendor = value()
    else if (arg === '--pins') options.pinsFile = value()
    else if (arg === '--out') options.out = value()
    else if (arg === '--licences') options.licences = value()
    else if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`)
    else if (options.target === null) options.target = arg
    else throw new Error(`one target at a time; got ${options.target} and ${arg}`)
  }
  options.pinsFile ??= join(repoRoot, 'vendor', 'pins.json')
  return options
}

function main(argv) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 2
  }
  if (options.target === null || !TARGETS.includes(options.target)) {
    process.stderr.write(
      `usage: check-vendored.mjs <${TARGETS.join('|')}> [--vendor <dir>] [--pins <file>] [--out <file>]\n` +
        `       check-vendored.mjs <${TARGETS.join('|')}> --licences <python-dir> [--pins <file>]\n`,
    )
    return 2
  }
  if (options.licences !== null) {
    const pins = JSON.parse(readFileSync(options.pinsFile, 'utf8'))
    const problems = checkPythonLicences({ python: options.licences, target: options.target, pins })
    if (problems.length > 0) {
      process.stderr.write(`the ${options.target} runtime's licence texts do not agree:\n`)
      for (const problem of problems) process.stderr.write(`  python ${problem}\n`)
      return 1
    }
    process.stdout.write(
      `${options.target}: the runtime's licence texts agree with its build metadata and the pins\n`,
    )
    return 0
  }
  const { problems, manifestPath } = checkVendor(options)
  if (problems.length > 0) {
    process.stderr.write(`refused ${options.target}; nothing will be packaged for it:\n`)
    for (const problem of problems) process.stderr.write(`  ${problem}\n`)
    return 1
  }
  process.stdout.write(
    `${options.target}: python, engine, loom and ffmpeg present, current and ${EXPECTED[options.target].arch}\n`,
  )
  process.stdout.write(`wrote ${relative(process.cwd(), manifestPath) || manifestPath}\n`)
  return 0
}

// Run as a script, not when electron-builder or a test imports the module.
function invokedDirectly() {
  if (process.argv[1] === undefined) return false
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}
if (invokedDirectly()) process.exitCode = main(process.argv.slice(2))
