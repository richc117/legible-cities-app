// The launch check's own pieces that need no Electron: how the bundle is
// compared before and after a session, and which bundled executables it
// runs and what it expects each to print. The launch itself runs only on
// the runners (.github/workflows/build.yml).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '../..')
const SCRIPT = join(repo, 'scripts', 'launch-packaged.mjs')
const PINS = JSON.parse(readFileSync(join(repo, 'vendor', 'pins.json'), 'utf8')) as {
  ffmpeg: { targets: Record<string, { reports: string }> }
}

interface Tool {
  name: string
  path: string
  args: string[]
  first: RegExp
}
interface Module {
  snapshot(root: string): Map<string, string>
  differences(before: Map<string, string>, after: Map<string, string>): string[]
  bundledTools(resources: string, exe: string, pins: unknown, target: string): Tool[]
  unpacked(target: string, release: string): { bundle: string; resources: string } | null
  writtenSince(path: string, since: number): boolean
}
// A URL built at run time, so the type checker does not look for
// declarations of a plain JavaScript module.
const load = (): Promise<Module> => import(pathToFileURL(SCRIPT).href) as Promise<Module>

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function bundle(): string {
  const root = mkdtempSync(join(tmpdir(), 'lc-launch-packaged-test-'))
  made.push(root)
  mkdirSync(join(root, 'resources', 'python', 'bin'), { recursive: true })
  writeFileSync(join(root, 'resources', 'app.asar'), 'asar')
  writeFileSync(join(root, 'resources', 'python', 'bin', 'python3'), 'py')
  return root
}

describe('snapshot and differences', () => {
  it('sees nothing when nothing changed', async () => {
    const { snapshot, differences } = await load()
    const root = bundle()
    const before = snapshot(root)
    expect([...before.keys()].sort()).toEqual([
      'resources/',
      'resources/app.asar',
      'resources/python/',
      'resources/python/bin/',
      'resources/python/bin/python3',
    ])
    expect(differences(before, snapshot(root))).toEqual([])
  })
  it('sees a bare folder made inside the bundle', async () => {
    const { snapshot, differences } = await load()
    const root = bundle()
    const before = snapshot(root)
    mkdirSync(join(root, 'resources', 'python', '__pycache__'))
    expect(differences(before, snapshot(root))).toEqual(['added resources/python/__pycache__/'])
  })
  it('sees a file added, removed, rewritten to another size, or touched', async () => {
    const { snapshot, differences } = await load()
    const root = bundle()
    const before = snapshot(root)
    writeFileSync(join(root, 'debug.log'), 'x')
    rmSync(join(root, 'resources', 'app.asar'))
    writeFileSync(join(root, 'resources', 'python', 'bin', 'python3'), 'python')
    const lines = differences(before, snapshot(root))
    expect(lines).toContain('added debug.log')
    expect(lines).toContain('removed resources/app.asar')
    expect(
      lines.find((l) => l.startsWith('changed resources/python/bin/python3: 2 bytes')),
    ).toBeDefined()

    const touched = bundle()
    const was = snapshot(touched)
    const later = new Date(Date.now() + 60_000)
    utimesSync(join(touched, 'resources', 'app.asar'), later, later)
    expect(differences(was, snapshot(touched))).toHaveLength(1)
  })
})

describe('bundledTools', () => {
  it('runs the four LOOM tools and ffmpeg and ffprobe from the resources, with .exe on Windows', async () => {
    const { bundledTools } = await load()
    const tools = bundledTools(join('/r'), '.exe', PINS, 'win-x64')
    expect(tools.map((t) => t.name)).toEqual([
      'gtfs2graph',
      'topo',
      'loom',
      'octi',
      'ffmpeg',
      'ffprobe',
    ])
    expect(tools[0].path).toBe(join('/r', 'loom', 'gtfs2graph.exe'))
    expect(tools[5].path).toBe(join('/r', 'ffmpeg', 'ffprobe.exe'))
    expect(tools[0].args).toEqual(['--help'])
    expect(tools[4].args).toEqual(['-version'])
  })
  it('expects the line each prints first, ffmpeg and ffprobe at the pinned version', async () => {
    const { bundledTools } = await load()
    const reports = PINS.ffmpeg.targets['darwin-arm64'].reports
    const [gtfs2graph, , , , ffmpeg, ffprobe] = bundledTools('/r', '', PINS, 'darwin-arm64')
    expect(gtfs2graph.first.test('gtfs2graph (part of LOOM) -128-NOTFOUND')).toBe(true)
    expect(gtfs2graph.first.test('topo (part of LOOM) -128-NOTFOUND')).toBe(false)
    expect(ffmpeg.first.test(`ffmpeg version ${reports} Copyright (c) 2000-2026`)).toBe(true)
    expect(ffmpeg.first.test('ffmpeg version 8.0 Copyright (c) 2000-2025')).toBe(false)
    expect(ffprobe.first.test(`ffprobe version ${reports} Copyright (c) 2000-2026`)).toBe(true)
  })
})

describe('unpacked', () => {
  it("names electron-builder's unpacked folder for each target", async () => {
    const { unpacked } = await load()
    expect(unpacked('darwin-arm64', '/rel')?.resources).toBe(
      join('/rel', 'mac-arm64', 'Legible Cities.app', 'Contents', 'Resources'),
    )
    expect(unpacked('darwin-x64', '/rel')?.bundle).toBe(join('/rel', 'mac', 'Legible Cities.app'))
    expect(unpacked('win-x64', '/rel')?.resources).toBe(join('/rel', 'win-unpacked', 'resources'))
    expect(unpacked('linux-x64', '/rel')).toBeNull()
  })
})

describe('writtenSince, which decides what the macOS log cleanup removes', () => {
  const launch = Date.parse('2026-09-12T20:00:00.000Z')
  function log(text: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'lc-launch-packaged-logs-'))
    made.push(dir)
    const path = join(dir, 'main.old.log')
    writeFileSync(path, text)
    return path
  }

  it("keeps a file rotated from a person's log, whose lines begin before the launch", async () => {
    const { writtenSince } = await load()
    const rotated = log(
      '2026-09-01T08:00:00.000Z [config] SCHEMATIC_HOME=/somewhere (default)\n' +
        '2026-09-12T20:00:05.000Z [engine] state: Engine ready (x).\n',
    )
    expect(writtenSince(rotated, launch)).toBe(false)
  })
  it('removes a file whose first stamped line is at or after the launch', async () => {
    const { writtenSince } = await load()
    expect(writtenSince(log('2026-09-12T20:00:00.000Z [config] a line\n'), launch)).toBe(true)
    expect(
      writtenSince(log('\nnot a stamp\n2026-09-12T20:01:00.000Z [engine] later\n'), launch),
    ).toBe(true)
  })
  it('removes a file with no stamped line, which holds no history, and not a file that is gone', async () => {
    const { writtenSince } = await load()
    expect(writtenSince(log(''), launch)).toBe(true)
    expect(writtenSince(join(tmpdir(), 'lc-no-such-log', 'main.log'), launch)).toBe(false)
  })
})
