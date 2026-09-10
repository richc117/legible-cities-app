// The capture: an offscreen window takes a project page's frames, one per
// 1/fps of the page's own clock, and writes them as PNGs into a directory
// the caller owns. The window, the debugger and the page sit behind
// `CapturePage`, injected, so every step's order is asserted in a unit test
// without Electron; `capture-window.ts` is the Electron half.
//
// The order below is ADR-024's, and every clause of it was paid for in spike
// A0-07 (docs/adr/spikes/offscreen-capture.md): navigate before emulating,
// or the process dies; `setCapture(true)` before any wait, or the page's own
// clock leaks into the frames; two animation frames before every capture,
// or one frame in sixty is the last painted one rather than the state just
// set; a CSS-pixel clip at scale 1, which is what Playwright issues
// underneath and why the two agree; a session of the window's own, because a
// persisted per-host zoom level scales every capture silently.

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { BrowserWindowConstructorOptions } from 'electron'
import { VIEWS, frameTotal, type Beat, type CaptureJob, type PresentState } from '../shared/capture'
import { isValidProjectId } from './paths'

/**
 * The capture window's session. No `persist:` prefix, so it is in memory and
 * gone with the process: nothing the interface's session holds - a per-host
 * zoom level above all - reaches it, and nothing it holds outlives a run.
 */
export const CAPTURE_PARTITION = 'capture'

/** Milliseconds the page gets to expose `__present`, and each frame gets to paint and capture. */
export const CAPTURE_TIMEOUTS = { page: 60_000, frame: 30_000 } as const

/** A message for a person; `cancelled` distinguishes the one that is not a failure. */
export class CaptureError extends Error {
  readonly cancelled: boolean
  constructor(message: string, cancelled = false) {
    super(message)
    this.name = 'CaptureError'
    this.cancelled = cancelled
  }
}

/** The window, seen from the orchestrator. `capture-window.ts` implements it over Electron. */
export interface CapturePage {
  /** Load the page as the window's top-level document. Must come first. */
  navigate(url: string): Promise<void>
  /** Attach the debugger. Only after a document exists. */
  attach(): void
  /** A DevTools Protocol command. */
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
  /** Run script in the page and return what it evaluates to. */
  evaluate(code: string): Promise<unknown>
  /** Called once if the page's renderer dies; the capture fails then. */
  onGone(listener: (reason: string) => void): void
  /** Destroy the window. Safe to call twice. */
  destroy(): void
}

export interface CaptureOptions {
  /** Where `000000.png` onwards go. Created; removed again on cancel or failure. */
  frames: string
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
  log?: (message: string) => void
  /** The waits, injected so a test can assert what precedes the settle. */
  wait?: (ms: number) => Promise<void>
  timeouts?: { page: number; frame: number }
}

export interface CaptureResult {
  /** Frames written, which equals `frameTotal` when nothing was cancelled. */
  frames: number
  /** A frame's size in device pixels. */
  width: number
  height: number
  /** The page's state after the settle, before the first beat. */
  first: PresentState
}

/**
 * The window a capture runs in. No preload, no node integration, no bridge:
 * the page is a feed's text as a top-level document and there must be
 * nothing for it to reach (ADR-024, ADR-028). Offscreen, because onscreen
 * rendering is 222 levels from the reference on every frame. Its own
 * partition, so the interface's zoom levels never apply.
 */
export function captureWindowOptions(job: CaptureJob): BrowserWindowConstructorOptions {
  return {
    show: false,
    width: job.width,
    height: job.height,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      partition: CAPTURE_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  }
}

const PAGE = /^\/projects\/([^/]+)\/[^/]+\.html$/
const MAX_EDGE = 8192
const MAX_SETTLE = 60_000

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function isSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * A sentence for a person, or null when the job is usable. Runs before a
 * window exists, so a bad job never costs one. Two rules here are the
 * capture's own rather than the recorder's: the page has to be a project
 * page on the app's origin, and the first beat has to pin the clock, because
 * a beat that does not name `at` is not reproducible on any host.
 */
export function validateCaptureJob(job: unknown): string | null {
  if (typeof job !== 'object' || job === null) return 'a capture job is an object'
  const j = job as Record<string, unknown>
  if (typeof j.url !== 'string') return 'the job names no page'
  let url: URL
  try {
    url = new URL(j.url)
  } catch {
    return 'the page address is not a URL'
  }
  const page = PAGE.exec(url.pathname)
  if (
    url.protocol !== 'app:' ||
    url.host !== 'local' ||
    page === null ||
    !isValidProjectId(page[1])
  )
    return "the page must be a project's, under app://local/projects/"
  if (!isInt(j.width, 1, MAX_EDGE) || !isInt(j.height, 1, MAX_EDGE))
    return `width and height are whole pixels between 1 and ${MAX_EDGE}`
  if (!isInt(j.scale, 1, 3)) return 'the scale factor is 1, 2 or 3'
  if (!isInt(j.fps, 1, 120)) return 'fps is a whole number between 1 and 120'
  if (!isInt(j.settle, 0, MAX_SETTLE)) return `settle is milliseconds between 0 and ${MAX_SETTLE}`
  if (!Array.isArray(j.beats) || j.beats.length === 0) return 'a job has at least one beat'
  for (const [i, raw] of j.beats.entries()) {
    const where = `beat ${i + 1}`
    if (typeof raw !== 'object' || raw === null) return `${where} is not an object`
    const b = raw as Record<string, unknown>
    if (typeof b.secs !== 'number' || !Number.isFinite(b.secs) || b.secs <= 0)
      return `${where} lasts no time`
    if (b.view != null && !(VIEWS as readonly string[]).includes(b.view as string))
      return `${where} names a view the page does not have`
    if (b.at != null && !isSeconds(b.at))
      return `${where} sets the clock to something that is not seconds`
    if (b.speed != null && (typeof b.speed !== 'number' || !Number.isFinite(b.speed)))
      return `${where} has a speed that is not a number`
    if (b.sweep !== undefined && typeof b.sweep !== 'boolean')
      return `${where} has a sweep that is not true or false`
    for (const field of ['hours', 'lo', 'hi', 'tween'] as const) {
      if (b[field] != null && !isSeconds(b[field]))
        return `${where} has a ${field} that is not seconds`
    }
    if (b.sweep === true) {
      const span = isSeconds(b.lo) && isSeconds(b.hi) && b.hi >= b.lo
      if (!(isSeconds(b.hours) && b.hours > 0) && !span) return `${where} sweeps over no span`
    }
  }
  const first = j.beats[0] as Record<string, unknown>
  if (first.at == null && !(first.sweep === true && isSeconds(first.lo) && isSeconds(first.hi)))
    return 'the first beat must set the clock: a beat that does not name a time is not reproducible'
  return null
}

/** Printable ASCII only, cut to a length: the page's text never reaches a sentence whole. */
export function printable(text: string, max: number): string {
  return text
    .replace(/[^ -~]/g, '')
    .slice(0, max)
    .trim()
}

function hms(seconds: number): string {
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0')
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')
  return `${h}:${m}`
}

/** `__present.state()`, checked before it is trusted. */
function asState(value: unknown): PresentState {
  const s = value as Record<string, unknown> | null
  if (
    typeof s !== 'object' ||
    s === null ||
    typeof s.now !== 'number' ||
    typeof s.clock !== 'string' ||
    typeof s.shown !== 'number'
  )
    throw new CaptureError('the page did not report its state the way a project page does')
  // The page is feed-derived text; what it says is cut and cleaned before it
  // can reach a sentence, as the viewer does with the page's errors.
  return {
    now: s.now,
    clock: printable(s.clock, 32),
    shown: s.shown,
    viewName: printable(String(s.viewName ?? ''), 32),
  }
}

interface Clip {
  x: number
  y: number
  width: number
  height: number
}

function asClip(value: unknown): Clip {
  const c = value as Record<string, unknown> | null
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  if (
    typeof c !== 'object' ||
    c === null ||
    !finite(c.x) ||
    !finite(c.y) ||
    !finite(c.width) ||
    !finite(c.height) ||
    c.width <= 0 ||
    c.height <= 0
  )
    throw new CaptureError('the page has no stage to capture')
  return { x: c.x, y: c.y, width: c.width, height: c.height }
}

/** Two animation frames, so the capture reads the state just set and not the last painted one. */
const TWO_FRAMES =
  'new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(function () { resolve(true) }) }) })'

/** Wait, with the clock stopped, for the page's first geometry pass and its fonts. */
const FONTS_READY = 'document.fonts ? document.fonts.ready.then(function () { return true }) : true'

const STAGE_RECT =
  '(function () { var el = document.getElementById("stage"); if (!el) return null; var r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()'

/** Everything a beat names is applied at its start; what it leaves out carries over. */
function applyBeat(beat: Beat): string {
  return `(function (b) {
    var P = window.__present;
    if (b.at != null) P.seek(b.at);
    if (b.labels != null) P.setLabels(b.labels);
    if (b.speed != null) P.setSpeed(b.speed);
    if (b.view) {
      var geo = b.view === "geographic";
      P.setGeo(geo, b.tween);
      P.setView(geo ? "map" : (b.view === "time" ? "string" : b.view), b.tween);
    }
    P.setPlaying(!b.sweep && b.speed !== 0);
    return true;
  })(${JSON.stringify(beat)})`
}

/**
 * Take a job's frames. Resolves with what was written; rejects with a
 * `CaptureError` whose message is for a person. On cancel or failure the
 * frames directory is removed and the window destroyed; on success the
 * directory is the caller's. The job is validated first, so the Electron
 * half can refuse a bad one before a window exists.
 */
export async function runCapture(
  page: CapturePage,
  job: CaptureJob,
  options: CaptureOptions,
): Promise<CaptureResult> {
  const problem = validateCaptureJob(job)
  if (problem !== null) throw new CaptureError(problem)
  if (!isAbsolute(options.frames))
    throw new CaptureError('the frames directory must be an absolute path')

  const log = options.log ?? (() => {})
  const wait = options.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const timeouts = options.timeouts ?? CAPTURE_TIMEOUTS
  const total = frameTotal(job.beats, job.fps)
  const signal = options.signal

  // Three things end a capture early: the caller's cancel, the page's
  // renderer dying (or the window being destroyed from outside), and a step
  // that never finishes. The first two are remembered as well as raced, so
  // a step is never started once the capture has ended and a promise that
  // is already settled cannot win the race against them.
  let ended: CaptureError | null = null
  let end: ((error: CaptureError) => void) | null = null
  const cancel = () => end?.(new CaptureError('the capture was cancelled', true))
  const abandoned = new Promise<never>((_resolve, reject) => {
    end = (error) => {
      ended ??= error
      reject(error)
    }
    page.onGone((reason) => end?.(new CaptureError(`the page stopped: ${printable(reason, 80)}`)))
    if (signal) {
      if (signal.aborted) cancel()
      else signal.addEventListener('abort', cancel, { once: true })
    }
  })
  abandoned.catch(() => {})

  const step = async <T>(what: string, work: () => Promise<T>, ms: number): Promise<T> => {
    if (ended !== null) throw ended
    let timer: ReturnType<typeof setTimeout> | null = null
    const late = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new CaptureError(`${what} took longer than ${Math.round(ms / 1000)} s`)),
        ms,
      )
    })
    try {
      const result = await Promise.race([work(), abandoned, late])
      if (ended !== null) throw ended
      return result
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }
  const evaluate = (what: string, code: string, ms = timeouts.frame): Promise<unknown> =>
    step(what, () => page.evaluate(code), ms)

  let written = 0
  try {
    try {
      await mkdir(options.frames, { recursive: true })
    } catch {
      throw new CaptureError('the frames directory could not be created')
    }
    // A document first: emulating a web contents that has never navigated
    // is a null dereference that takes the whole process down.
    await step('loading the page', () => page.navigate(job.url), timeouts.page)
    page.attach()
    await step(
      'emulating the frame',
      () =>
        page.send('Emulation.setDeviceMetricsOverride', {
          width: job.width,
          height: job.height,
          deviceScaleFactor: job.scale,
          mobile: false,
        }),
      timeouts.frame,
    )
    // The machine's own preference must not snap every transition.
    await step(
      'emulating the media',
      () =>
        page.send('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
        }),
      timeouts.frame,
    )

    const started = Date.now()
    for (;;) {
      const ready = await evaluate(
        'waiting for the page',
        '!!(window.__present && window.__present.state)',
      )
      if (ready === true) break
      if (Date.now() - started > timeouts.page)
        throw new CaptureError('the page never exposed its presentation seam')
      await step('waiting for the page', () => wait(50), timeouts.frame)
    }

    // Stop the page's own clock before anything waits, stills included: the
    // recorder waits with it running and its stills are not reproducible.
    await evaluate('stopping the clock', 'window.__present.setCapture(true); true')
    await evaluate('waiting for the fonts', FONTS_READY, timeouts.page)
    await step('settling', () => wait(job.settle), timeouts.page + job.settle)

    const boundsRaw = (await evaluate('reading the bounds', 'window.__present.bounds()')) as Record<
      string,
      unknown
    > | null
    const t0 = typeof boundsRaw?.t0 === 'number' ? boundsRaw.t0 : 0
    const t1 = typeof boundsRaw?.t1 === 'number' ? boundsRaw.t1 : 86_400
    const first = asState(await evaluate('reading the state', 'window.__present.state()'))
    // A clock outside the service day renders a correct, empty map, and would
    // otherwise capture several hundred frames of nothing.
    if (!first.shown)
      throw new CaptureError(`no trains at ${first.clock}; this feed runs ${hms(t0)}-${hms(t1)}`)

    const clip = asClip(await evaluate('measuring the stage', STAGE_RECT))
    // Snap every tween before the first beat, so nothing from the page's own
    // start-up leaks into frame 0.
    await evaluate('settling the page', 'window.__present.settle(); true')

    log(`capture: ${total} frames of ${clip.width}x${clip.height} at ${job.scale}x, ${job.fps} fps`)
    for (const beat of job.beats) {
      if (ended !== null) throw ended
      const frames = Math.round(beat.secs * job.fps)
      await evaluate('applying a beat', applyBeat(beat))
      let lo = Number(beat.lo ?? t0)
      let hi = Number(beat.hi ?? t1)
      if (beat.sweep && beat.hours) {
        // A sweep given hours starts wherever the clock already is, so the
        // storyboard never jumps backwards between beats.
        lo = asState(await evaluate('reading the clock', 'window.__present.state()')).now
        hi = Math.min(lo + Number(beat.hours) * 3600, t1)
      }
      for (let i = 0; i < frames; i++) {
        if (signal?.aborted) cancel()
        if (ended !== null) throw ended
        // Only numbers are ever interpolated into the page's script.
        const at = beat.sweep ? Number(lo + (hi - lo) * (frames > 1 ? i / (frames - 1) : 1)) : null
        const advance =
          at !== null
            ? `window.__present.seek(${at}); true`
            : `window.__present.advance(${Number(1 / job.fps)}); true`
        await evaluate('stepping the clock', advance)
        await evaluate('waiting for the paint', TWO_FRAMES)
        const shot = (await step(
          'taking the frame',
          () =>
            page.send('Page.captureScreenshot', {
              format: 'png',
              clip: { ...clip, scale: 1 },
              captureBeyondViewport: false,
            }),
          timeouts.frame,
        )) as { data?: unknown }
        if (typeof shot?.data !== 'string') throw new CaptureError('the frame came back empty')
        try {
          await writeFile(
            join(options.frames, `${String(written).padStart(6, '0')}.png`),
            Buffer.from(shot.data, 'base64'),
          )
        } catch {
          throw new CaptureError(`frame ${written} could not be written`)
        }
        written++
        options.onProgress?.(written, total)
      }
    }
    log(`capture: ${written} frames written`)
    return {
      frames: written,
      width: Math.round(clip.width * job.scale),
      height: Math.round(clip.height * job.scale),
      first,
    }
  } catch (error) {
    try {
      await rm(options.frames, { recursive: true, force: true })
    } catch {
      log('capture: the frames directory could not be removed')
    }
    throw error
  } finally {
    // Settle the race for good, so a late renderer death rejects nothing,
    // and let go of the caller's signal.
    ended ??= new CaptureError('finished')
    if (signal) signal.removeEventListener('abort', cancel)
    page.destroy()
  }
}
