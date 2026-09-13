// The determinism fixture against the engine the app pins (A5-04): the
// committed stored layout is the one the engine addresses for BART with the
// inputs a project sends, so the engine finds it rather than laying the
// feed out, and a project's page is drawn from it. A fixture folder named
// with any other hash would still draw a map, and the determinism test
// would be comparing exports of a layout no project could have.
//
// Runs when an interpreter with the engine is named - LEGIBLE_ENGINE_PYTHON,
// or LEGIBLE_ENGINE_CHECKOUT's virtual environment - and skips, saying so,
// otherwise; the ci workflow names neither. It runs no LOOM: the engine is
// pointed at a native LOOM folder that does not exist, so a layout it did
// not find fails at once instead of building one.

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { resolveConfig } from '../../src/main/config'
import { resolveInterpreter } from '../../src/main/interpreter'
import { parseRecord } from '../../src/shared/project'
import {
  ANCHOR,
  FEED,
  fixtureLayoutId,
  layoutSnapshot,
  pagePath,
  prepareProject,
  seedHome,
  startEngine,
} from '../support/determinism'

const repo = resolve(__dirname, '../..')

function interpreter(): string | null {
  let fileText: string | undefined
  try {
    fileText = readFileSync(join(repo, '.env.local'), 'utf8')
  } catch {
    fileText = undefined
  }
  const config = resolveConfig({
    fileText,
    env: process.env,
    userData: tmpdir(),
    desktop: tmpdir(),
    loomPin: '',
    baseDir: repo,
  })
  return resolveInterpreter({
    config,
    packaged: false,
    resourcesPath: '',
    platform: process.platform,
    exists: existsSync,
  }).interpreter
}

const PYTHON = interpreter()
const WHY = PYTHON === null ? ' (skipped: no interpreter with the engine is named)' : ''
const made: string[] = []

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lc-determinism-real-'))
  made.push(dir)
  const engineHome = join(dir, 'engine')
  seedHome(engineHome)
  return engineHome
}

describe.skipIf(PYTHON === null)(`the determinism fixture on the pinned engine${WHY}`, () => {
  it("is the layout the engine addresses for BART with a project's inputs", async () => {
    const engineHome = home()
    const id = fixtureLayoutId()
    const meta = JSON.parse(
      readFileSync(join(engineHome, 'data', 'graphs', FEED, id, '.meta.json'), 'utf8'),
    ) as { made: string }
    const engine = await startEngine(PYTHON as string, engineHome, {
      loomBin: join(engineHome, 'no-loom-here'),
    })
    try {
      // What a layout run sends: the record's mode, and every operator.
      const built = (await engine.request('graph.build', { key: FEED, mode: 'all', agency: '' })
        .result) as { layout: string; meta: { made: string } }
      expect(built.layout, "the fixture's folder is named with the engine's hash").toBe(id)
      expect(built.meta.made, 'found, not made').toBe(meta.made)
    } finally {
      await engine.stop()
    }
    expect(readdirSync(join(engineHome, 'data', 'graphs', FEED))).toEqual([id])
  }, 180_000)

  it('draws a project page from it, with the day from the fixed anchor, and leaves it as it was', async () => {
    const engineHome = home()
    const record = await prepareProject(PYTHON as string, engineHome)
    const parsed = parseRecord(
      JSON.parse(readFileSync(join(engineHome, 'projects', record.id, 'project.json'), 'utf8')),
    )
    expect('record' in parsed && parsed.record.layout).toBe(fixtureLayoutId())
    expect('record' in parsed && parsed.record.export).toEqual({
      preset: 'instagram-reel-gif',
      options: { quality: 'draft' },
    })
    expect(record.service?.anchor).toBe(ANCHOR)
    expect(record.date! >= record.service!.start && record.date! <= record.service!.end).toBe(true)
    expect(existsSync(pagePath(engineHome))).toBe(true)
    const page = readFileSync(pagePath(engineHome), 'utf8')
    expect(page, "the page carries the capture seam's clock stop").toContain(
      'cancelAnimationFrame(rafId)',
    )
    const snapshot = layoutSnapshot(engineHome)
    expect(snapshot.layout).toBe(fixtureLayoutId())
    expect(snapshot.made).toBe(record.made)
    // Drawing a map never lays out: the one stored set, made when it was.
    expect(snapshot.stored).toEqual({ [fixtureLayoutId()]: record.made })
  }, 300_000)
})
