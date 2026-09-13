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
import { afterEach, describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '../..')
const SCRIPT = join(repo, 'scripts', 'check-vendored.mjs')
const PINS_FILE = join(repo, 'vendor', 'pins.json')
const PINS_TEXT = readFileSync(PINS_FILE, 'utf8')
const PINS = JSON.parse(PINS_TEXT) as {
  python: { version: string }
  engine: { version: string }
  loom: { commit: string }
  ffmpeg: { targets: Record<string, { reports: string; configure: string }> }
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
  afterPack(context: Context, env: Record<string, string | undefined>): Promise<void>
}
// A URL built at run time, so the type checker does not look for declarations of a
// plain JavaScript module; the interface above is the part the tests use.
const load = (): Promise<Module> => import(pathToFileURL(SCRIPT).href) as Promise<Module>

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
  skip?: 'python' | 'loom' | 'ffmpeg'
  bytecodeFlags?: number
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
        `\0ffmpeg version ${options.ffmpegReports ?? pin.reports}\0${pin.configure}\0`,
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
      expect(manifest.components.python_packages).toEqual([
        { name: 'openschematicmaps', version: PINS.engine.version },
        { name: 'python_dateutil', version: '2.9.0.post0' },
      ])
      expect(Boolean(manifest.components.loom.windows_port), target).toBe(target === 'win-x64')
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
    options: TreeOptions & { manifest?: 'current' | 'stale' | 'none' } = {},
  ) {
    const appOutDir = scratch()
    const darwin = target !== 'win-x64'
    const resources = darwin
      ? join(appOutDir, `${productFilename}.app`, 'Contents', 'Resources')
      : join(appOutDir, 'resources')
    mkdirSync(resources, { recursive: true })
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
  })
})
