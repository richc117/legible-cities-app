// The capture, in a real Electron: the offscreen window, its own session,
// the debugger and the page, driven through tests/e2e/capture-harness.cjs
// rather than the app, because the app never exposes the capture to its
// renderer. What this settles is what the unit test cannot: that two runs
// of the same job are byte-identical, that a zoom level persisted in the
// interface's session never reaches the capture's, and that a cancel or a
// refusal leaves no window and no frames. The page is a stand-in that
// animates the way the engine's does; with an engine checkout beside the
// repository, the real Los Angeles page is captured too.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import type { CaptureJob } from '../../src/shared/capture'

const repoRoot = resolve(__dirname, '../..')
const harness = resolve(__dirname, 'capture-harness.cjs')
const fixture = resolve(__dirname, '../fixtures/capture-page.html')

interface Outcome {
  ok: boolean
  result?: { frames: number; width: number; height: number; first: { clock: string } }
  message?: string
  cancelled?: boolean
  progress?: Array<[number, number]>
  seen?: number
  windows: number
  live: number
}

/** A home with one project whose page is the given file. */
function home(page: string, name: string): { dir: string; url: string } {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-capture-'))
  mkdirSync(join(dir, 'out', 'p1'), { recursive: true })
  copyFileSync(page, join(dir, 'out', 'p1', name))
  return { dir, url: `app://local/projects/p1/${name}` }
}

async function withHarness(
  engineHome: string,
  run: (app: ElectronApplication) => Promise<void>,
): Promise<void> {
  const app = await electron.launch({
    args: [harness],
    cwd: repoRoot,
    env: { ...process.env, SCHEMATIC_HOME: engineHome } as Record<string, string>,
    timeout: 30_000,
  })
  try {
    await app.evaluate(async () => {
      const g = globalThis as { __harness?: unknown }
      for (let i = 0; i < 200 && !g.__harness; i++) await new Promise((r) => setTimeout(r, 50))
      if (!g.__harness) throw new Error('the harness never became ready')
    })
    await run(app)
  } finally {
    await app.close()
  }
}

type Harness = {
  capture(job: CaptureJob, frames: string): Promise<Outcome>
  cancelAfter(job: CaptureJob, frames: string, after: number): Promise<Outcome>
  abortMidway(job: CaptureJob, frames: string, after: number): Promise<Outcome>
  seedZoom(url: string, factor: number): Promise<{ level: number }>
}

function drive(app: ElectronApplication): Harness {
  const call = (method: keyof Harness, ...args: unknown[]) =>
    app.evaluate(
      // Playwright hands the Electron module first; the payload comes second.
      (_electron, [m, a]) =>
        (
          globalThis as unknown as { __harness: Record<string, (...x: unknown[]) => unknown> }
        ).__harness[m as string](...(a as unknown[])),
      [method, args] as [string, unknown[]],
    )
  return {
    capture: (job, frames) => call('capture', job, frames) as Promise<Outcome>,
    cancelAfter: (job, frames, after) =>
      call('cancelAfter', job, frames, after) as Promise<Outcome>,
    abortMidway: (job, frames, after) =>
      call('abortMidway', job, frames, after) as Promise<Outcome>,
    seedZoom: (url, factor) => call('seedZoom', url, factor) as Promise<{ level: number }>,
  }
}

/** Two seconds at thirty frames, the clock pinned, on the map: sixty frames. */
function job(url: string, over: Partial<CaptureJob> = {}): CaptureJob {
  return {
    url: `${url}?present=1&view=map&labels=1&clock=1&theme=dark&frame=1080:1920`,
    width: 540,
    height: 960,
    scale: 2,
    fps: 30,
    settle: 300,
    beats: [{ secs: 2, view: 'map', at: 8 * 3600, speed: 120, tween: 0 }],
    ...over,
  }
}

/** A PNG's size, from its IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file)
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function identical(a: string, b: string): { frames: number; differing: string[] } {
  const names = readdirSync(a).sort()
  expect(readdirSync(b).sort()).toEqual(names)
  const differing = names.filter((n) => !readFileSync(join(a, n)).equals(readFileSync(join(b, n))))
  return { frames: names.length, differing }
}

test('two captures of the same job are byte-identical, and leave no window', async () => {
  const { dir, url } = home(fixture, 'stand-in.html')
  await withHarness(dir, async (app) => {
    const h = drive(app)
    const first = await h.capture(job(url), join(dir, 'a'))
    const second = await h.capture(job(url), join(dir, 'b'))
    expect(first.ok, first.message).toBe(true)
    expect(second.ok, second.message).toBe(true)
    expect(first.result).toMatchObject({ frames: 60, width: 1080, height: 1920 })
    expect(first.result?.first.clock).toBe('08:00')
    expect(first.progress?.[59]).toEqual([60, 60])
    const { frames, differing } = identical(join(dir, 'a'), join(dir, 'b'))
    expect(frames).toBe(60)
    expect(differing, 'frames that differ between the two runs').toEqual([])
    expect(pngSize(join(dir, 'a', '000000.png'))).toEqual({ width: 1080, height: 1920 })
    // The train moved: the frames are of a running clock, not one picture sixty times.
    expect(
      readFileSync(join(dir, 'a', '000000.png')).equals(readFileSync(join(dir, 'a', '000059.png'))),
    ).toBe(false)
    expect(first.windows, 'the capture window is destroyed with the capture').toBe(0)
    expect(first.live).toBe(0)
  })
})

test('a zoom level persisted in the interface’s session never reaches the capture', async () => {
  const { dir, url } = home(fixture, 'stand-in.html')
  await withHarness(dir, async (app) => {
    const h = drive(app)
    const seeded = await h.seedZoom(url, 2)
    expect(seeded.level).toBeCloseTo(Math.log(2) / Math.log(1.2), 3)
    const out = await h.capture(job(url), join(dir, 'zoomed'))
    expect(out.ok, out.message).toBe(true)
    // At 200% the stage would measure 270 by 480 CSS pixels and the frame
    // 540 by 960; spike A0-07 lost two sessions to exactly that.
    expect(out.result).toMatchObject({ width: 1080, height: 1920 })
    expect(pngSize(join(dir, 'zoomed', '000000.png'))).toEqual({ width: 1080, height: 1920 })
  })
})

test('a cancel between frames leaves no window, no debugger and no frames', async () => {
  const { dir, url } = home(fixture, 'stand-in.html')
  await withHarness(dir, async (app) => {
    const out = await drive(app).cancelAfter(job(url), join(dir, 'cut'), 10)
    expect(out.ok).toBe(false)
    expect(out.cancelled).toBe(true)
    expect(out.seen).toBeLessThanOrEqual(11)
    expect(existsSync(join(dir, 'cut'))).toBe(false)
    expect(out.windows).toBe(0)
    expect(out.live).toBe(0)
  })
})

test('a clock outside the service day is refused with the engine’s sentence, before a frame is taken', async () => {
  const { dir, url } = home(fixture, 'stand-in.html')
  await withHarness(dir, async (app) => {
    // The preflight reads the clock the page loads with, as the recorder's
    // does; a beat's `at` comes after it. The URL sets the clock to 02:00.
    const empty = job(url)
    empty.url += '&at=02:00'
    const out = await drive(app).capture(empty, join(dir, 'empty'))
    expect(out.ok).toBe(false)
    expect(out.message).toBe('no trains at 02:00; this feed runs 00:00-24:00')
    expect(existsSync(join(dir, 'empty'))).toBe(false)
    expect(out.windows).toBe(0)
  })
})

test('the emulated scale factor is the one used, at 1 and at 3', async () => {
  const { dir, url } = home(fixture, 'stand-in.html')
  await withHarness(dir, async (app) => {
    const h = drive(app)
    const one = await h.capture(
      job(url, { scale: 1, beats: [{ secs: 0.1, at: 8 * 3600 }] }),
      join(dir, 's1'),
    )
    const three = await h.capture(
      job(url, { scale: 3, beats: [{ secs: 0.1, at: 8 * 3600 }] }),
      join(dir, 's3'),
    )
    expect(one.ok, one.message).toBe(true)
    expect(three.ok, three.message).toBe(true)
    expect(pngSize(join(dir, 's1', '000000.png'))).toEqual({ width: 540, height: 960 })
    expect(pngSize(join(dir, 's3', '000000.png'))).toEqual({ width: 1620, height: 2880 })
  })
})

test('a refused job costs no window, and a missing page fails fast', async () => {
  const { dir, url } = home(fixture, 'stand-in.html')
  await withHarness(dir, async (app) => {
    const h = drive(app)
    const refused = await h.capture(job(url, { scale: 4 }), join(dir, 'refused'))
    expect(refused.ok).toBe(false)
    expect(refused.message).toMatch(/1, 2 or 3/)
    expect(refused.windows, 'no window is created for a job that is refused').toBe(0)
    expect(existsSync(join(dir, 'refused'))).toBe(false)
    const started = Date.now()
    const missing = await h.capture(
      job('app://local/projects/p1/nowhere.html'),
      join(dir, 'missing'),
    )
    expect(missing.ok).toBe(false)
    expect(missing.message).toMatch(/not found/)
    expect(
      Date.now() - started,
      'a wrong page is refused at once, not after the page timeout',
    ).toBeLessThan(15_000)
    expect(missing.windows).toBe(0)
  })
})

test('a page that opens windows or navigates itself gets nowhere, and is still captured', async () => {
  const { dir } = home(fixture, 'stand-in.html')
  // After the page's own script, and deferred: a navigation started while
  // the parser is still running stops the parser, so a page that did that
  // would never expose its seam and the capture would give up on it. What a
  // hostile name in a feed could do is this.
  const hostile = readFileSync(fixture, 'utf8').replace(
    '</body>',
    [
      '<script>',
      'setTimeout(function () {',
      "  try { window.open('https://example.test/') } catch (e) {}",
      "  try { fetch('https://example.test/') } catch (e) {}",
      "  try { location.assign('https://example.test/') } catch (e) {}",
      '}, 0)',
      '</script>',
      '</body>',
    ].join('\n'),
  )
  writeFileSync(join(dir, 'out', 'p1', 'hostile.html'), hostile)
  await withHarness(dir, async (app) => {
    const out = await drive(app).capture(
      job('app://local/projects/p1/hostile.html', { beats: [{ secs: 0.5, at: 8 * 3600 }] }),
      join(dir, 'hostile'),
    )
    expect(out.ok, out.message).toBe(true)
    expect(out.result?.frames).toBe(15)
    expect(out.windows, 'nothing the page opened is left').toBe(0)
  })
})

test('a window destroyed from outside, as a quit does, ends its capture and leaves nothing', async () => {
  const { dir, url } = home(fixture, 'stand-in.html')
  await withHarness(dir, async (app) => {
    const out = await drive(app).abortMidway(job(url), join(dir, 'quit'), 10)
    expect(out.ok).toBe(false)
    expect(out.message).toMatch(/the window was destroyed/)
    expect(existsSync(join(dir, 'quit'))).toBe(false)
    expect(out.windows).toBe(0)
    expect(out.live).toBe(0)
  })
})

/** The engine checkout, from the environment or .env.local, when it holds a generated page. */
function realPage(): string | null {
  let checkout = process.env.LEGIBLE_ENGINE_CHECKOUT ?? ''
  const envFile = join(repoRoot, '.env.local')
  if (!checkout && existsSync(envFile)) {
    const line = readFileSync(envFile, 'utf8')
      .split('\n')
      .find((l) => l.startsWith('LEGIBLE_ENGINE_CHECKOUT='))
    checkout = line
      ? line
          .slice('LEGIBLE_ENGINE_CHECKOUT='.length)
          .trim()
          .replace(/^["']|["']$/g, '')
      : ''
  }
  if (!checkout) return null
  const page = resolve(repoRoot, checkout, 'out', 'la-metro-rail.html')
  return existsSync(page) ? page : null
}

const REAL = realPage()

test.skip(
  REAL === null,
  'no engine checkout with a generated Los Angeles page beside this repository',
)
test('sixty frames of the Los Angeles page, captured twice, are byte-identical', async () => {
  const { dir, url } = home(REAL as string, 'la-metro-rail.html')
  await withHarness(dir, async (app) => {
    const h = drive(app)
    const first = await h.capture(job(url), join(dir, 'a'))
    const second = await h.capture(job(url), join(dir, 'b'))
    expect(first.ok, first.message).toBe(true)
    expect(second.ok, second.message).toBe(true)
    const { frames, differing } = identical(join(dir, 'a'), join(dir, 'b'))
    expect(frames).toBe(60)
    expect(differing).toEqual([])
    expect(pngSize(join(dir, 'a', '000000.png'))).toEqual({ width: 1080, height: 1920 })
  })
})
