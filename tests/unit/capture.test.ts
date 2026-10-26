// The capture's order, asserted without Electron. ADR-024's sequence is the
// contract: navigate before emulating, the clock stopped before any wait,
// two animation frames before every frame, a CSS-pixel clip at scale 1, and
// a window with nothing in it for the page to reach. Each of those was paid
// for in spike A0-07, and each is silent when it regresses, which is why the
// fake page below records what was asked of it and in what order.
//
// The paint wait used to be held only by its place in that order, which a
// test of the order cannot show does anything (app issue 100). The fake now
// paints as a page does (`PaintedFrames`): a shot shows what the last paint
// wait painted, and the band under the stage carries the count of draws it
// was painted at. So a capture without the wait, or without the comparison,
// keeps a frame from the wrong paint, and the tests under "the proof" fail.

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { frameTotal, type CaptureJob } from '../../src/shared/capture'
import {
  CAPTURE_PARTITION,
  CaptureError,
  FRESH_TRIES,
  captureWindowOptions,
  runCapture,
  staleFrame,
  validateCaptureJob,
  withStrip,
  type CapturePage,
} from '../../src/main/capture'
import { STRIP_PX } from '../../src/main/capture-strip'
import { PaintedFrames, readPngRows, stageColour, writePng } from '../support/frames'

const URL = 'app://local/projects/p1/stand-in.html?present=1'
const STRIPPED = `${URL}&strip=${STRIP_PX}`

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
  if (code.includes('getAttribute("data-strip")')) return 'strip?'
  if (code.includes('getElementById("present-strip")')) return 'band'
  if (code.includes('state().draws')) return 'draws'
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
  readonly paint: PaintedFrames
  scale = 1
  /** Where the page says its band is; the stage's foot, as the engine's page draws it, unless a test moves it. */
  band: (() => unknown) | null = null
  /** What the page answers for its draws; the count, unless a test says otherwise. */
  draws: (() => unknown) | null = null
  /** What a shot is, unless a test replaces it. */
  shot: ((clip: { width: number; height: number }) => string) | null = null

  constructor(options: { strip?: boolean; lateAt?: (step: number) => number } = {}) {
    this.paint = new PaintedFrames({ strip: options.strip ?? true, lateAt: options.lateAt })
  }

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
    if (method === 'Emulation.setDeviceMetricsOverride')
      this.scale = Number(params?.deviceScaleFactor ?? 1)
    if (method === 'Page.captureScreenshot') {
      this.screenshots++
      this.onScreenshot?.(this.screenshots)
      const clip = params?.clip as { width: number; height: number }
      return Promise.resolve({
        data: this.shot?.(clip) ?? this.paint.shot(clip, this.scale, STRIP_PX),
      })
    }
    return Promise.resolve({})
  }
  evaluate(code: string): Promise<unknown> {
    const what = label(code)
    this.calls.push(`evaluate ${what}`)
    switch (what) {
      case 'ready?':
        return Promise.resolve(this.readyAfter-- <= 0)
      case 'strip?':
        return Promise.resolve(
          this.paint.options.strip
            ? { strip: String(STRIP_PX), band: true }
            : { strip: null, band: false },
        )
      case 'band':
        return Promise.resolve(
          this.band?.() ??
            (this.paint.options.strip
              ? {
                  x: this.clip.x,
                  y: this.clip.y + this.clip.height,
                  width: this.clip.width,
                  height: STRIP_PX,
                }
              : null),
        )
      case 'draws':
        return Promise.resolve(this.draws?.() ?? this.paint.draws)
      case 'paint':
        this.paint.paint()
        return Promise.resolve(true)
      case 'settle':
        // A settle with a face to fit again draws twice, as the engine's does.
        this.paint.drew(2)
        return Promise.resolve(true)
      case 'beat':
        if (/"at":[0-9]/.test(code)) this.paint.drew()
        return Promise.resolve(true)
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
        this.paint.drew(1, true)
        return Promise.resolve(true)
      }
      case 'seek': {
        this.now = Number(/seek\(([^)]+)\)/.exec(code)?.[1])
        this.paint.drew(1, true)
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
    expect(prefs.spellcheck, 'the checker would fetch dictionaries').toBe(false)
    expect(prefs.partition, 'the interface session persists a per-host zoom level').toBe(
      CAPTURE_PARTITION,
    )
    expect(CAPTURE_PARTITION.startsWith('persist:'), 'nothing in it may outlive the run').toBe(
      false,
    )
  })

  it('is offscreen, never shown, never throttled, and the job’s size in CSS pixels, the band taller', () => {
    const options = captureWindowOptions(job())
    expect(options.show).toBe(false)
    expect(options.webPreferences?.offscreen).toBe(true)
    expect(options.webPreferences?.backgroundThrottling).toBe(false)
    expect(options.width).toBe(540)
    expect(options.height).toBe(960 + STRIP_PX)
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
    expect(page.calls[0], 'the page is loaded first, with the band asked for').toBe(
      `navigate ${STRIPPED}`,
    )
    expect(at('attach'), 'the debugger attaches only once a document exists').toBeGreaterThan(
      at(`navigate ${STRIPPED}`),
    )
    expect(
      page.calls.filter((c) => c.startsWith('navigate')),
      'one load',
    ).toHaveLength(1)
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
      expect(page.calls[i - 1], 'the count of draws is read just before every shot').toBe(
        'evaluate draws',
      )
      expect(page.calls[i - 2], 'after the paint wait').toBe('evaluate paint')
      expect(page.calls[i - 3], 'and a step precedes the wait').toBe('evaluate advance')
    }
    // The beat's `at` is a seek, before the first frame and after the settle.
    expect(page.calls.indexOf('evaluate beat')).toBeGreaterThan(
      page.calls.indexOf('evaluate settle'),
    )
    expect(result.width).toBe(1080)
    expect(result.height).toBe(1920)
    expect(result.first.clock).toBe('08:00')
  })

  it('takes each frame as a CSS-pixel clip of the stage and the band at scale 1, never the window', async () => {
    const page = new FakePage()
    await runCapture(page, job(), { frames: frames(), ...noWait })
    const shot = page.sent.find((s) => s.method === 'Page.captureScreenshot')
    expect(shot?.params).toEqual({
      format: 'png',
      clip: { x: 10, y: 20, width: 540, height: 960 + STRIP_PX, scale: 1 },
      captureBeyondViewport: false,
    })
    const metrics = page.sent.filter((s) => s.method === 'Emulation.setDeviceMetricsOverride')
    expect(metrics.map((m) => m.params)).toEqual([
      { width: 540, height: 960 + STRIP_PX, deviceScaleFactor: 2, mobile: false },
    ])
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

/** A written frame's size and the colour of its first pixel, and whether every pixel is that colour. */
function keptFrame(file: string): { width: number; height: number; rgba: number[]; flat: boolean } {
  const { width, height, channels, rows } = readPngRows(readFileSync(file))
  const rgba = Array.from(rows[0].subarray(0, channels))
  const flat = rows.every((row) => row.every((v, i) => v === rgba[i % channels]))
  return { width, height, rgba, flat }
}

const frameFile = (dir: string, n: number) => join(dir, `${String(n).padStart(6, '0')}.png`)

describe('the proof', () => {
  /** Half a second at thirty: fifteen frames, which is all the proof needs. */
  const short = () =>
    job({ beats: [{ secs: 0.5, view: 'map', at: 8 * 3600, speed: 120, tween: 0 }] })

  it('keeps every frame from a shot whose band shows the count the page reached, the band cropped away', async () => {
    // Mutations: the paint wait removed - the fake paints only on it, so
    // every band shows an earlier count and the capture fails; the crop
    // removed - the frames are the band taller.
    const page = new FakePage()
    const dir = frames()
    const counts: number[] = []
    page.onScreenshot = () => counts.push(page.paint.draws)
    const result = await runCapture(page, short(), { frames: dir, ...noWait })
    expect(result.frames).toBe(15)
    expect(page.screenshots, 'a page that paints in time is taken once a frame').toBe(15)
    for (const n of [0, 1, 7, 14]) {
      const kept = keptFrame(frameFile(dir, n))
      expect(kept, `frame ${n}`).toEqual({
        width: 1080,
        height: 1920,
        rgba: stageColour(counts[n]),
        flat: true,
      })
    }
  })

  it('takes a frame again when the page painted it late, and keeps the fresh shot', async () => {
    // Mutation: the comparison removed, or its answer ignored - the first
    // shot of frame 6, painted one step behind, is kept as it is.
    const log: string[] = []
    const page = new FakePage({ lateAt: (step) => (step === 6 ? 1 : 0) })
    const dir = frames()
    const counts: number[] = []
    page.onScreenshot = () => counts.push(page.paint.draws)
    const result = await runCapture(page, short(), {
      frames: dir,
      ...noWait,
      log: (m) => log.push(m),
    })
    expect(result.frames).toBe(15)
    expect(page.screenshots, 'one shot taken again').toBe(16)
    expect(page.paint.shots[6], 'the first shot of frame 6 showed the frame before').toBe(
      page.paint.shots[5],
    )
    expect(keptFrame(frameFile(dir, 6)).rgba, 'the frame kept is the fresh one').toEqual(
      stageColour(counts[7]),
    )
    expect(keptFrame(frameFile(dir, 6)).rgba).not.toEqual(keptFrame(frameFile(dir, 5)).rgba)
    expect(log.filter((m) => m.includes('taking it again'))).toHaveLength(1)
    expect(log.at(-1)).toBe('capture: 15 frames written, each proven fresh (1 taken again)')
  })

  it('takes every frame of a page always one paint late a second time, and keeps them all', async () => {
    const page = new FakePage({ lateAt: () => 1 })
    const result = await runCapture(page, short(), { frames: frames(), ...noWait })
    expect(result.frames).toBe(15)
    expect(page.screenshots).toBe(30)
  })

  it(`fails in a sentence when ${FRESH_TRIES} shots of one frame never show its paint, and leaves nothing`, async () => {
    // Mutation: the retakes unbounded - the capture waits for ever; the
    // sentence its own - the export says something else.
    const page = new FakePage({ lateAt: (step) => (step === 3 ? FRESH_TRIES : 0) })
    const dir = frames()
    const run = runCapture(page, short(), { frames: dir, ...noWait })
    await expect(run).rejects.toThrow(CaptureError)
    await expect(run).rejects.toThrow(staleFrame(4))
    expect(staleFrame(4)).toBe(
      'frame 4 was never painted after its step: 4 shots in a row showed an earlier picture',
    )
    expect(page.screenshots, 'three frames, and four shots of the fourth').toBe(3 + FRESH_TRIES)
    expect(existsSync(dir)).toBe(false)
    expect(page.destroyed).toBe(true)
  })

  it('fails on the first frame of a page that never paints what it was asked', async () => {
    const page = new FakePage({ lateAt: () => Infinity })
    await expect(runCapture(page, short(), { frames: frames(), ...noWait })).rejects.toThrow(
      staleFrame(1),
    )
    expect(page.screenshots).toBe(FRESH_TRIES)
  })

  it('reads a band that says no number as a stale shot, never a crash', async () => {
    // The band painted over in grey, as a shot of the wrong region would be.
    const page = new FakePage()
    page.shot = (clip) => {
      const width = Math.round(clip.width * page.scale)
      const height = Math.round(clip.height * page.scale)
      const row = new Uint8Array(width * 4).fill(128)
      return writePng({ width, height, colourType: 6, row: () => row }).toString('base64')
    }
    await expect(runCapture(page, short(), { frames: frames(), ...noWait })).rejects.toThrow(
      staleFrame(1),
    )
    expect(page.screenshots).toBe(FRESH_TRIES)
  })

  it('compares the count modulo 65536, across the wrap', async () => {
    const page = new FakePage()
    page.paint.draws = 65_536 - 8
    const result = await runCapture(page, short(), { frames: frames(), ...noWait })
    expect(result.frames).toBe(15)
    expect(page.screenshots).toBe(15)
    expect(page.paint.draws).toBeGreaterThan(65_536)
  })

  it('reads the count after the step, whatever the step drew', async () => {
    // A step that draws three times (a page's setRoutes with lines hidden
    // draws more than once): one more than before would be wrong.
    // Mutation: the count predicted as the last one plus one.
    const page = new FakePage()
    const evaluate = page.evaluate.bind(page)
    page.evaluate = (code: string) => {
      if (code.startsWith('window.__present.advance(')) page.paint.drew(2)
      return evaluate(code)
    }
    const result = await runCapture(page, short(), { frames: frames(), ...noWait })
    expect(result.frames).toBe(15)
    expect(page.screenshots).toBe(15)
  })

  it('refuses a count that is not a whole number, a band not under the stage, and a shot of the wrong size', async () => {
    const bad = new FakePage()
    bad.draws = () => 'many'
    await expect(runCapture(bad, short(), { frames: frames(), ...noWait })).rejects.toThrow(
      'the page did not say how many times it has drawn',
    )
    const moved = new FakePage()
    moved.band = () => ({ x: 10, y: 0, width: 540, height: STRIP_PX })
    await expect(runCapture(moved, short(), { frames: frames(), ...noWait })).rejects.toThrow(
      'the page did not draw its frame counter under the stage',
    )
    expect(moved.screenshots).toBe(0)
    const small = new FakePage()
    small.shot = () =>
      writePng({ width: 4, height: 4, colourType: 6, row: () => new Uint8Array(16) }).toString(
        'base64',
      )
    await expect(runCapture(small, short(), { frames: frames(), ...noWait })).rejects.toThrow(
      'the frame came back 4x4, not the 1080x1936 asked for',
    )
  })

  it('refuses a page that drew a frame counter other than the one asked for', async () => {
    const page = new FakePage()
    const evaluate = page.evaluate.bind(page)
    page.evaluate = (code: string) =>
      code.includes('getAttribute("data-strip")')
        ? Promise.resolve({ strip: '24', band: true })
        : evaluate(code)
    await expect(runCapture(page, short(), { frames: frames(), ...noWait })).rejects.toThrow(
      'the page drew a frame counter other than the one the capture asked for',
    )
  })

  it('asks for the band on the address the engine wrote, and nothing else of it', () => {
    expect(withStrip(URL)).toBe(STRIPPED)
    expect(withStrip('app://local/projects/p1/a.html')).toBe(
      `app://local/projects/p1/a.html?strip=${STRIP_PX}`,
    )
    expect(withStrip('app://local/projects/p1/a.html?frame=1080:1920&caption=a+b#x')).toBe(
      `app://local/projects/p1/a.html?frame=1080:1920&caption=a+b&strip=${STRIP_PX}#x`,
    )
  })
})

describe('a page an older engine drew', () => {
  it('is loaded again at the job’s own size and address, and captured as before, unproven', async () => {
    // Mutations: the page captured where it loaded, in a viewport the band
    // taller; loaded again with the band still asked for or before the
    // viewport is the job's own; the proof's reads made of a page with none.
    const log: string[] = []
    const page = new FakePage({ strip: false })
    const shots: string[] = []
    const send = page.send.bind(page)
    page.send = async (method, params) => {
      const answer = await send(method, params)
      if (method === 'Page.captureScreenshot') shots.push((answer as { data: string }).data)
      return answer
    }
    const dir = frames()
    const result = await runCapture(page, job(), {
      frames: dir,
      ...noWait,
      log: (m) => log.push(m),
    })
    expect(result).toMatchObject({ frames: 60, width: 1080, height: 1920 })
    expect(page.calls.slice(0, 9)).toEqual([
      `navigate ${STRIPPED}`,
      'attach',
      'send Emulation.setDeviceMetricsOverride',
      'send Emulation.setEmulatedMedia',
      'evaluate ready?',
      'evaluate strip?',
      'send Emulation.setDeviceMetricsOverride',
      `navigate ${URL}`,
      'evaluate ready?',
    ])
    expect(page.calls[9]).toBe('evaluate setCapture')
    expect(
      page.sent
        .filter((s) => s.method === 'Emulation.setDeviceMetricsOverride')
        .map((s) => s.params?.height),
    ).toEqual([960 + STRIP_PX, 960])
    expect(page.calls.filter((c) => c === 'evaluate draws' || c === 'evaluate band')).toEqual([])
    const shot = page.sent.find((s) => s.method === 'Page.captureScreenshot')
    expect(shot?.params?.clip).toEqual({ x: 10, y: 20, width: 540, height: 960, scale: 1 })
    expect(page.screenshots).toBe(60)
    // The frame written is the shot, byte for byte, as every frame was before the proof.
    expect(readFileSync(frameFile(dir, 7)).equals(Buffer.from(shots[7], 'base64'))).toBe(true)
    expect(log[0]).toMatch(/no frame counter/)
    expect(log.at(-1)).toBe('capture: 60 frames written, not proven fresh')
  })
})
