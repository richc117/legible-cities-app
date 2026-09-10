// The capture's order, asserted without Electron. ADR-024's sequence is the
// contract: navigate before emulating, the clock stopped before any wait,
// two animation frames before every frame, a CSS-pixel clip at scale 1, and
// a window with nothing in it for the page to reach. Each of those was paid
// for in spike A0-07, and each is silent when it regresses, which is why the
// fake page below records what was asked of it and in what order.

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { frameTotal, type CaptureJob } from '../../src/shared/capture'
import {
  CAPTURE_PARTITION,
  CaptureError,
  captureWindowOptions,
  runCapture,
  validateCaptureJob,
  type CapturePage,
} from '../../src/main/capture'

// A 1x1 PNG, which is all a frame needs to be here.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const URL = 'app://local/projects/p1/stand-in.html?present=1'

function job(over: Partial<CaptureJob> = {}): CaptureJob {
  return {
    url: URL,
    width: 540,
    height: 960,
    scale: 2,
    fps: 30,
    settle: 300,
    beats: [{ secs: 2, view: 'map', at: 8 * 3600, speed: 120, tween: 0 }],
    ...over,
  }
}

/** What an evaluation was for, from the script the orchestrator sent. */
function label(code: string): string {
  if (code.includes('!!(window.__present')) return 'ready?'
  if (code.includes('setCapture(true)')) return 'setCapture'
  if (code.includes('document.fonts')) return 'fonts'
  if (code.includes('bounds()')) return 'bounds'
  if (code.includes('state()')) return 'state'
  if (code.includes('getElementById("stage")')) return 'stage'
  if (code.includes('settle()')) return 'settle'
  if (code.includes('P.setPlaying')) return 'beat'
  if (code.includes('advance(')) return 'advance'
  if (code.includes('seek(')) return 'seek'
  if (code.includes('requestAnimationFrame')) return 'paint'
  return 'other'
}

class FakePage implements CapturePage {
  calls: string[] = []
  sent: Array<{ method: string; params?: Record<string, unknown> }> = []
  now = 8 * 3600
  shown = 1
  bounds = { t0: 6 * 3600, t1: 22 * 3600 }
  clip = { x: 10, y: 20, width: 540, height: 960 }
  readyAfter = 0
  destroyed = false
  screenshots = 0
  gone: ((reason: string) => void) | null = null
  /** A hook a test sets to interfere at a given screenshot. */
  onScreenshot: ((n: number) => void) | null = null

  navigate(url: string): Promise<void> {
    this.calls.push(`navigate ${url}`)
    return Promise.resolve()
  }
  attach(): void {
    this.calls.push('attach')
  }
  send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    this.calls.push(`send ${method}`)
    this.sent.push({ method, params })
    if (method === 'Page.captureScreenshot') {
      this.screenshots++
      this.onScreenshot?.(this.screenshots)
      return Promise.resolve({ data: PNG })
    }
    return Promise.resolve({})
  }
  evaluate(code: string): Promise<unknown> {
    const what = label(code)
    this.calls.push(`evaluate ${what}`)
    switch (what) {
      case 'ready?':
        return Promise.resolve(this.readyAfter-- <= 0)
      case 'bounds':
        return Promise.resolve(this.bounds)
      case 'state':
        return Promise.resolve({
          now: this.now,
          clock: `${String(Math.floor(this.now / 3600)).padStart(2, '0')}:00`,
          shown: this.shown,
          viewName: 'map',
        })
      case 'stage':
        return Promise.resolve(this.clip)
      case 'advance': {
        const dt = Number(/advance\(([^)]+)\)/.exec(code)?.[1])
        this.now += dt * 120
        return Promise.resolve(true)
      }
      case 'seek': {
        this.now = Number(/seek\(([^)]+)\)/.exec(code)?.[1])
        return Promise.resolve(true)
      }
      default:
        return Promise.resolve(true)
    }
  }
  onGone(listener: (reason: string) => void): void {
    this.gone = listener
  }
  destroy(): void {
    this.destroyed = true
  }
}

const homes: string[] = []
function frames(): string {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-capture-'))
  homes.push(dir)
  return join(dir, 'frames')
}
afterEach(() => {
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const noWait = { wait: () => Promise.resolve() }

describe('the window', () => {
  it('has no preload, no node integration and a session of its own', () => {
    const options = captureWindowOptions(job())
    const prefs = options.webPreferences ?? {}
    expect('preload' in prefs, 'a preload would be a bridge for the page to reach').toBe(false)
    expect(prefs.nodeIntegration).toBe(false)
    expect(prefs.contextIsolation).toBe(true)
    expect(prefs.sandbox).toBe(true)
    expect(prefs.partition, 'the interface session persists a per-host zoom level').toBe(
      CAPTURE_PARTITION,
    )
    expect(CAPTURE_PARTITION.startsWith('persist:'), 'nothing in it may outlive the run').toBe(
      false,
    )
  })

  it('is offscreen, never shown, never throttled, and the job’s size in CSS pixels', () => {
    const options = captureWindowOptions(job())
    expect(options.show).toBe(false)
    expect(options.webPreferences?.offscreen).toBe(true)
    expect(options.webPreferences?.backgroundThrottling).toBe(false)
    expect(options.width).toBe(540)
    expect(options.height).toBe(960)
    expect(options.useContentSize).toBe(true)
  })
})

describe('the job', () => {
  it('accepts the shape the engine’s recorder receives', () => {
    expect(validateCaptureJob(job())).toBeNull()
    expect(frameTotal(job().beats, 30)).toBe(60)
    expect(frameTotal([{ secs: 4 }, { secs: 5 }, { secs: 9 }], 30)).toBe(540)
  })

  it.each<[string, Partial<CaptureJob>, RegExp]>([
    ['a page off the origin', { url: 'https://example.test/x.html' }, /project/],
    ['the interface itself', { url: 'app://local/ui/' }, /project/],
    ['a bad project id', { url: 'app://local/projects/../x.html' }, /project/],
    ['a scale of 4', { scale: 4 }, /1, 2 or 3/],
    ['a fractional width', { width: 540.5 }, /whole pixels/],
    ['no beats', { beats: [] }, /at least one beat/],
    ['a beat of no length', { beats: [{ secs: 0, at: 0 }] }, /no time/],
    ['a view the page lacks', { beats: [{ secs: 1, at: 0, view: 'plan' as never }] }, /view/],
    ['a sweep over nothing', { beats: [{ secs: 1, at: 0, sweep: true }] }, /no span/],
    [
      'a sweep that is not a boolean',
      { beats: [{ secs: 1, at: 0, sweep: 1 as never }] },
      /true or false/,
    ],
    [
      'a span that is text',
      { beats: [{ secs: 1, at: 0, sweep: true, lo: '1); x(' as never, hi: 3600 }] },
      /lo that is not seconds/,
    ],
    [
      'hours that are text',
      { beats: [{ secs: 1, at: 0, sweep: true, lo: 0, hi: 3600, hours: 'x' as never }] },
      /hours that is not seconds/,
    ],
    [
      'a first beat with no time',
      { beats: [{ secs: 2, view: 'map' }] },
      /first beat must set the clock/,
    ],
  ])('refuses %s with a sentence', (_what, over, sentence) => {
    expect(validateCaptureJob(job(over))).toMatch(sentence)
  })

  it('accepts a first beat that sweeps a named span', () => {
    expect(
      validateCaptureJob(job({ beats: [{ secs: 2, sweep: true, lo: 0, hi: 3600 }] })),
    ).toBeNull()
  })
})

describe('the sequence', () => {
  it('navigates before it attaches or emulates, and stops the clock before it waits', async () => {
    const page = new FakePage()
    const dir = frames()
    // The waits are recorded among the page's calls, so their order against
    // the page's is what is asserted.
    await runCapture(page, job(), {
      frames: dir,
      wait: (ms) => {
        page.calls.push(`wait ${ms}`)
        return Promise.resolve()
      },
    })
    const at = (entry: string) => page.calls.indexOf(entry)
    expect(at(`navigate ${URL}`)).toBeGreaterThanOrEqual(0)
    expect(at('attach'), 'the debugger attaches only once a document exists').toBeGreaterThan(
      at(`navigate ${URL}`),
    )
    expect(at('send Emulation.setDeviceMetricsOverride')).toBeGreaterThan(at('attach'))
    expect(at('send Emulation.setEmulatedMedia')).toBeGreaterThan(at('attach'))
    expect(
      at('evaluate setCapture'),
      'the clock stops before the fonts and the settle',
    ).toBeLessThan(at('evaluate fonts'))
    expect(
      at('wait 300'),
      'the settle wait is the job’s, and comes after the clock stopped',
    ).toBeGreaterThan(at('evaluate setCapture'))
    const media = page.sent.find((s) => s.method === 'Emulation.setEmulatedMedia')
    expect(media?.params).toEqual({
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    })
    expect(page.calls.indexOf('evaluate setCapture')).toBeLessThan(
      page.calls.findIndex((c) => c === 'evaluate settle'),
    )
    expect(page.destroyed, 'the window goes when the capture does').toBe(true)
  })

  it('steps, waits two frames, then captures, sixty times for two seconds at thirty', async () => {
    const page = new FakePage()
    const dir = frames()
    const progress: Array<[number, number]> = []
    const result = await runCapture(page, job(), {
      frames: dir,
      ...noWait,
      onProgress: (n, total) => progress.push([n, total]),
    })
    expect(result.frames).toBe(60)
    expect(readdirSync(dir).sort()).toEqual(
      Array.from({ length: 60 }, (_, i) => `${String(i).padStart(6, '0')}.png`),
    )
    expect(progress[0]).toEqual([1, 60])
    expect(progress[59]).toEqual([60, 60])
    const shots = page.calls
      .map((c, i) => (c === 'send Page.captureScreenshot' ? i : -1))
      .filter((i) => i >= 0)
    expect(shots).toHaveLength(60)
    for (const i of shots) {
      expect(page.calls[i - 1], 'a paint wait precedes every frame').toBe('evaluate paint')
      expect(page.calls[i - 2], 'and a step precedes the wait').toBe('evaluate advance')
    }
    // The beat's `at` is a seek, before the first frame and after the settle.
    expect(page.calls.indexOf('evaluate beat')).toBeGreaterThan(
      page.calls.indexOf('evaluate settle'),
    )
    expect(result.width).toBe(1080)
    expect(result.height).toBe(1920)
    expect(result.first.clock).toBe('08:00')
  })

  it('takes each frame as a CSS-pixel clip of the stage at scale 1, never the window', async () => {
    const page = new FakePage()
    await runCapture(page, job(), { frames: frames(), ...noWait })
    const shot = page.sent.find((s) => s.method === 'Page.captureScreenshot')
    expect(shot?.params).toEqual({
      format: 'png',
      clip: { x: 10, y: 20, width: 540, height: 960, scale: 1 },
      captureBeyondViewport: false,
    })
    const metrics = page.sent.find((s) => s.method === 'Emulation.setDeviceMetricsOverride')
    expect(metrics?.params).toEqual({
      width: 540,
      height: 960,
      deviceScaleFactor: 2,
      mobile: false,
    })
  })

  it('sweeps a span by seeking, and a sweep in hours from wherever the clock is', async () => {
    const page = new FakePage()
    await runCapture(
      page,
      job({
        beats: [
          { secs: 1, at: 7 * 3600, speed: 60 },
          { secs: 1, sweep: true, lo: 9 * 3600, hi: 10 * 3600 },
          { secs: 1, sweep: true, hours: 1 },
        ],
      }),
      { frames: frames(), ...noWait },
    )
    const seeks = page.calls.filter((c) => c === 'evaluate seek').length
    expect(seeks, 'thirty seeks per sweep beat').toBe(60)
    expect(page.calls.filter((c) => c === 'evaluate advance')).toHaveLength(30)
  })

  it('waits for the page to expose its seam before touching it', async () => {
    const page = new FakePage()
    page.readyAfter = 3
    await runCapture(page, job(), { frames: frames(), ...noWait })
    expect(page.calls.filter((c) => c === 'evaluate ready?')).toHaveLength(4)
    expect(page.calls.indexOf('evaluate setCapture')).toBeGreaterThan(
      page.calls.lastIndexOf('evaluate ready?'),
    )
  })
})

describe('cancel and failure', () => {
  it('refuses a job whose clock shows no trains, with the engine’s sentence', async () => {
    const page = new FakePage()
    page.shown = 0
    const dir = frames()
    await expect(runCapture(page, job(), { frames: dir, ...noWait })).rejects.toThrow(
      'no trains at 08:00; this feed runs 06:00-22:00',
    )
    expect(existsSync(dir), 'nothing is left behind').toBe(false)
    expect(page.destroyed).toBe(true)
    expect(page.screenshots).toBe(0)
  })

  it('cancels between frames, destroys the window and removes the frames', async () => {
    const page = new FakePage()
    const controller = new AbortController()
    const dir = frames()
    page.onScreenshot = (n) => {
      if (n === 10) controller.abort()
    }
    const run = runCapture(page, job(), { frames: dir, ...noWait, signal: controller.signal })
    await expect(run).rejects.toMatchObject({ cancelled: true })
    expect(page.screenshots, 'no frame is taken after the cancel').toBeLessThanOrEqual(11)
    expect(existsSync(dir)).toBe(false)
    expect(page.destroyed).toBe(true)
  })

  it('fails when the page’s renderer dies, and cleans up the same way', async () => {
    const page = new FakePage()
    const dir = frames()
    page.onScreenshot = (n) => {
      if (n === 5) page.gone?.('crashed')
    }
    const run = runCapture(page, job(), { frames: dir, ...noWait })
    await expect(run).rejects.toThrow('the page stopped: crashed')
    await expect(run).rejects.toMatchObject({ cancelled: false })
    expect(existsSync(dir)).toBe(false)
    expect(page.destroyed).toBe(true)
  })

  it('gives up on a page that never answers, naming the step', async () => {
    const page = new FakePage()
    page.evaluate = () => new Promise(() => {})
    const dir = frames()
    await expect(
      runCapture(page, job(), { frames: dir, ...noWait, timeouts: { page: 200, frame: 50 } }),
    ).rejects.toThrow(/waiting for the page took longer/)
    expect(existsSync(dir)).toBe(false)
    expect(page.destroyed).toBe(true)
  })

  it('refuses a bad job before any window exists', async () => {
    const page = new FakePage()
    await expect(
      runCapture(page, job({ scale: 4 }), { frames: frames(), ...noWait }),
    ).rejects.toBeInstanceOf(CaptureError)
    expect(page.calls, 'nothing was asked of the page').toEqual([])
  })

  it('refuses a relative frames directory', async () => {
    const page = new FakePage()
    await expect(runCapture(page, job(), { frames: 'frames', ...noWait })).rejects.toThrow(
      /absolute/,
    )
  })
})
