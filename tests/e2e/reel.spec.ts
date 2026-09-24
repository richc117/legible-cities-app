// The first reel, for real: the Los Angeles page from the engine checkout,
// the real engine's export.plan and export.encode, the app's own capture,
// and ffmpeg. Exported twice, the two files are decoded and compared frame
// by frame in RGB with a channel tolerance of 8, which is the constitution's
// measure of determinism and the issue's acceptance criterion. Opt-in: it
// takes minutes, needs the checkout's virtual environment and ffmpeg, and
// never runs in continuous integration.
//
//   LEGIBLE_REEL_TEST=1 npx playwright test tests/e2e/reel.spec.ts

import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import {
  DEFAULT_COLOR,
  DEFAULT_MODE,
  DEFAULT_STYLE,
  DEFAULT_THEME,
  RECORD_VERSION,
  type ProjectRecord,
} from '../../src/shared/project'
import { compareDecoded, TOLERANCE } from '../support/frames'
import { openCell } from '../support/project'

const repoRoot = resolve(__dirname, '../..')
const REEL = 'la-metro-rail-instagram-reel.mp4'

/** The engine checkout, from the environment or .env.local. */
function checkout(): string | null {
  let dir = process.env.LEGIBLE_ENGINE_CHECKOUT ?? ''
  const envFile = join(repoRoot, '.env.local')
  if (!dir && existsSync(envFile)) {
    const line = readFileSync(envFile, 'utf8')
      .split('\n')
      .find((l) => l.startsWith('LEGIBLE_ENGINE_CHECKOUT='))
    dir = line
      ? line
          .slice('LEGIBLE_ENGINE_CHECKOUT='.length)
          .trim()
          .replace(/^["']|["']$/g, '')
      : ''
  }
  return dir ? resolve(repoRoot, dir) : null
}

const CHECKOUT = checkout()
const PAGE = CHECKOUT === null ? null : join(CHECKOUT, 'out', 'la-metro-rail.html')
const PYTHON =
  CHECKOUT === null
    ? null
    : process.platform === 'win32'
      ? join(CHECKOUT, '.venv', 'Scripts', 'python.exe')
      : join(CHECKOUT, '.venv', 'bin', 'python')
const OPTED_IN = process.env.LEGIBLE_REEL_TEST === '1'
const FFMPEG =
  OPTED_IN &&
  spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 })
    .status === 0

test.skip(!OPTED_IN, 'opt in with LEGIBLE_REEL_TEST=1; it takes minutes')
test.skip(
  PAGE === null || !existsSync(PAGE) || PYTHON === null || !existsSync(PYTHON),
  'no engine checkout with a generated Los Angeles page and a virtual environment',
)
test.skip(!FFMPEG, 'no ffmpeg on the PATH')

/** A home with one laid-out project whose page is the checkout's Los Angeles page. */
function home(): { engineHome: string; exportFolder: string; id: string } {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-reel-'))
  const engineHome = join(dir, 'engine')
  const id = 'reelproj0001'
  mkdirSync(join(engineHome, 'projects', id), { recursive: true })
  mkdirSync(join(engineHome, 'out', id), { recursive: true })
  const now = new Date().toISOString()
  const record: ProjectRecord = {
    version: RECORD_VERSION,
    id,
    name: 'Los Angeles',
    feed: 'la-metro-rail',
    mode: DEFAULT_MODE,
    agency: null,
    date: '2026-09-08',
    service: null,
    style: { ...DEFAULT_STYLE },
    colors: {},
    defaultColor: DEFAULT_COLOR,
    lineOrder: [],
    theme: DEFAULT_THEME,
    export: { preset: 'instagram-reel', options: {} },
    // The page is the checkout's; the identifier only has to be one.
    layout: 'f'.repeat(64),
    made: null,
    drawn: null,
    built: null,
    created: now,
    modified: now,
  }
  writeFileSync(join(engineHome, 'projects', id, 'project.json'), JSON.stringify(record, null, 2))
  copyFileSync(PAGE as string, join(engineHome, 'out', id, 'la-metro-rail.html'))
  return { engineHome, exportFolder: join(dir, 'exports'), id }
}

test('the Los Angeles reel, exported twice, decodes to the same frames within the tolerance', async () => {
  test.setTimeout(45 * 60_000)
  const h = home()
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      SCHEMATIC_HOME: h.engineHome,
      LEGIBLE_EXPORT_FOLDER: h.exportFolder,
      LEGIBLE_ENGINE_PYTHON: PYTHON as string,
    } as Record<string, string>,
    timeout: 30_000,
  })
  const started = Date.now()
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('status', { name: 'Engine' })).toContainText(/ready/i, {
      timeout: 60_000,
    })
    await page.getByRole('button', { name: 'Open Los Angeles' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Los Angeles')

    // The export is cell 06 of the notebook (A5-01, ADR-045), and a project
    // from before it starts there on the reel with the engine's defaults.
    await openCell(page, 'export')
    const file = join(h.exportFolder, 'Los Angeles', REEL)
    const exportOnce = async (): Promise<number> => {
      const t0 = Date.now()
      await page.getByRole('button', { name: 'Export', exact: true }).click()
      await expect(page.getByText(/^Exported /)).toBeVisible({ timeout: 20 * 60_000 })
      return Date.now() - t0
    }

    const first = await exportOnce()
    expect(existsSync(file)).toBe(true)
    const keep = join(h.exportFolder, 'first.mp4')
    copyFileSync(file, keep)
    const sidecar = JSON.parse(readFileSync(file + '.json', 'utf8')) as Record<string, unknown>
    // The fields bin/export writes, with the project's own service day.
    for (const key of [
      'file',
      'bytes',
      'feed',
      'city',
      'network',
      'preset',
      'platform',
      'size',
      'view',
      'storyboard',
      'theme',
      'alt',
      'service_date',
      'caveats',
    ]) {
      expect(sidecar, key).toHaveProperty(key)
    }
    expect(sidecar.service_date).toBe('2026-09-08')
    expect(sidecar.preset).toBe('instagram-reel')

    // Nothing on the screen is a path.
    expect(await page.getByRole('region', { name: 'Export' }).innerText()).not.toMatch(/[/\\]/)

    const second = await exportOnce()
    const identical = readFileSync(keep).equals(readFileSync(file))
    const result = await compareDecoded(keep, file)
    console.log(
      `first export ${Math.round(first / 1000)} s, second ${Math.round(second / 1000)} s; ` +
        `${statSync(file).size} bytes; files byte-identical: ${identical}; ` +
        `${result.bytes} decoded bytes, max channel difference ${result.maxDiff}, ` +
        `${result.over} over ${TOLERANCE}`,
    )
    expect(result.sameLength, 'the same number of frames').toBe(true)
    expect(result.bytes).toBeGreaterThan(0)
    expect(result.over, `channels differing by more than ${TOLERANCE}`).toBe(0)
  } finally {
    console.log(`reel test: ${Math.round((Date.now() - started) / 1000)} s in all`)
    await app.close()
  }
})
