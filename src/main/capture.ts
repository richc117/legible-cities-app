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
//
// Every capture waits for the page's settle, which since engine v0.15.0
// answers a promise that resolves once the map's face has loaded: a frame
// taken before then draws the names in the fallback face (spec 035).
//
// A job whose beats open on a title card or draw the network in (engine
// v0.15.0, issue 44; app issue 392, spec 035) makes the engine recorder's
// calls for them, in the recorder's order (`bin/_record.js`): after the
// settle it draws the network to 0; it puts the card up or takes it down at
// each beat's start; and on each frame of the draw-in it steps the clock
// first and then draws the network to `i / (n - 1)`. A job with neither flag
// makes exactly the calls it made before the opening, script for script,
// but for the settle being waited for (`tests/unit/capture-opening.test.ts`).
//
// Every frame is proven fresh, not waited for and hoped (app issue 100,
// engine v0.20.0's issue 85). The address asks the page for its frame counter
// (`strip=`, `STRIP_PX` tall), the window and the emulated viewport are that
// much taller, and the page lays its frame out in the viewport less the band,
// so the stage is the size it always was and the band sits under it. After
// each step and the paint wait the capture reads `state().draws`, takes the
// stage and the band in one shot, reads the band's count out of the shot
// (`capture-strip.ts`) and keeps the frame only where the two agree; otherwise
// it waits for the paint again and takes it again, `FRESH_TRIES` shots in all,
// and then fails in a sentence of its own. The band is cropped away before the
// frame is written, exactly: the kept frame is the frame a shot without the
// band would have been, so every size downstream and the determinism gate are
// untouched. Every change to the page is made before the step whose count is
// read - a beat's `setLabels` and views before its first step, the card at the
// beat's start, the draw-in's `setDrawn` after the step but drawing itself -
// because a call that does not draw can change the picture without moving the
// count.
//
// A page an older engine drew has no counter, and an export can still reach
// one: a project whose page was drawn before the pin moved and has not been
// redrawn (a record that cannot say what drew it, a day chosen and not drawn,
// a redraw that failed; `olderPage.ts` in the renderer) exports the page on
// disk, and stale never blocks an export (ADR-045). Such a page ignores
// `strip=` and lays out in the taller viewport, so the capture loads it again
// at the job's own size and address and captures it as it did before the
// proof, saying so in the log.

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { BrowserWindowConstructorOptions } from 'electron'
import { VIEWS, frameTotal, type Beat, type CaptureJob, type PresentState } from '../shared/capture'
import {
  PngError,
  MAX_FRAME_EDGE,
  MAX_FRAME_SCALE,
  STRIP_MODULUS,
  STRIP_PX,
  cropPng,
  readPng,
  stripOf,
  type Png,
} from './capture-strip'
import { isValidProjectId } from './paths'

/**
 * The capture window's session. No `persist:` prefix, so it is in memory and
 * gone with the process: nothing the interface's session holds - a per-host
 * zoom level above all - reaches it, and nothing it holds outlives a run.
 */
export const CAPTURE_PARTITION = 'capture'

/** Milliseconds the page gets to expose `__present`, and each frame gets to paint and capture. */
export const CAPTURE_TIMEOUTS = { page: 60_000, frame: 30_000 } as const

/**
 * Shots a frame gets before the capture gives up on it: the first, and three
 * taken again after waiting for the paint each time. A page late once is
 * retaken and kept; a page that never paints the step it was asked for fails.
 */
export const FRESH_TRIES = 4

/**
 * The sentence a capture fails with when no shot of a frame showed its own
 * paint. Frames are numbered as their files are, from 0, as the sentence for
 * a frame that could not be written numbers them.
 */
export function staleFrame(frame: number, tries = FRESH_TRIES): string {
  return `frame ${frame} was never painted after its step: ${tries} shots in a row showed an earlier picture; export again, with less running on this machine`
}

/**
 * The sentence for a page that counts its draws and drew no band: its engine
 * has the band, so the cause is the address or the page, not its age, and
 * drawing the map again would not mend it.
 */
export const NO_BAND_FOR_ADDRESS =
  'the page counts its draws but drew no frame counter for this address, so its frames cannot be proven fresh; export again, and if it fails again, press Copy diagnostics in Settings and send what it copies'

/** The sentence a capture fails with when no shot of a frame showed a count at all. */
export function unreadFrame(frame: number, tries = FRESH_TRIES): string {
  return `the frame counter could not be read in any of ${tries} shots of frame ${frame}; export again, and if it fails again, press Copy diagnostics in Settings and send what it copies`
}

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
  /**
   * The job is a still, whose one frame may be the deliverable itself (a PNG
   * still kept as it was captured), so a proven frame is compressed at
   * zlib's default; a video's frames are intermediates ffmpeg decodes, and are
   * compressed at the fastest level.
   */
  still?: boolean
}

export interface CaptureResult {
  /** Frames written, which equals `frameTotal` when nothing was cancelled. */
  frames: number
  /** A frame's size in device pixels. */
  width: number
  height: number
  /** The page's state after the settle, before the first beat. */
  first: PresentState
  /**
   * Whether every frame was proven fresh by the page's frame counter: false
   * for a page an older engine drew, which has none, and was captured as
   * before the proof.
   */
  proven: boolean
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
    // The frame and, below it, the band the page draws its frame counter in.
    height: job.height + STRIP_PX,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      partition: CAPTURE_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Off for the reason the main window's is: no dictionary fetch.
      spellcheck: false,
    },
  }
}

const PAGE = /^\/projects\/([^/]+)\/[^/]+\.html$/
const MAX_EDGE = MAX_FRAME_EDGE
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
  if (!isInt(j.scale, 1, MAX_FRAME_SCALE)) return 'the scale factor is 1, 2 or 3'
  if (!isInt(j.fps, 1, 120)) return 'fps is a whole number between 1 and 120'
  if (!isInt(j.settle, 0, MAX_SETTLE)) return `settle is milliseconds between 0 and ${MAX_SETTLE}`
  if (!Array.isArray(j.beats) || j.beats.length === 0) return 'a job has at least one beat'
  let drawnAt: number | null = null
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
    // The opening's two flags (spec 035): true or false where given, and a
    // draw-in holds the clock, so it never sweeps; the engine refuses one
    // too, and this is the guard on what reaches the page.
    for (const flag of ['card', 'draw_in'] as const) {
      if (b[flag] !== undefined && typeof b[flag] !== 'boolean')
        return `${where} has a ${flag} that is not true or false`
    }
    if (b.draw_in === true && b.sweep === true)
      return `${where} draws the network in and sweeps the clock, which holds while it draws in`
    // A draw-in leaves the network undrawn until its own frames draw it,
    // so a draw-in of no frame, or a second one, would leave the network
    // undrawn: the engine never plans either, and this is the guard against
    // one that would.
    if (b.draw_in === true) {
      if (Math.round((b.secs as number) * (j.fps as number)) < 1)
        return `${where} draws the network in over no frame at ${j.fps as number} frames a second`
      if (drawnAt !== null)
        return `${where} draws the network in a second time; beat ${drawnAt} already does`
      drawnAt = i + 1
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

/** A rect the page measured, checked before it is trusted; null for anything else. */
function asRect(value: unknown): Clip | null {
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
    return null
  return { x: c.x, y: c.y, width: c.width, height: c.height }
}

function asClip(value: unknown): Clip {
  const clip = asRect(value)
  if (clip === null) throw new CaptureError('the page has no stage to capture')
  return clip
}

/**
 * What a shot's band says: the shot read, and the count below its first
 * `keep` rows, or null where the band says none. A shot that is not the size
 * asked for, or not a PNG the capture reads, fails the capture in a sentence:
 * that is no late paint, and taking it again would not mend it.
 */
async function freshness(
  bytes: Buffer,
  width: number,
  height: number,
  keep: number,
): Promise<{ png: Png; count: number | null }> {
  let png: Png
  try {
    png = await readPng(bytes)
  } catch (error) {
    if (error instanceof PngError)
      throw new CaptureError(`the frame could not be read: ${error.message}`)
    throw error
  }
  if (png.width !== width || png.height !== height)
    throw new CaptureError(
      `the frame came back ${png.width}x${png.height}, not the ${width}x${height} asked for`,
    )
  return { png, count: stripOf(png, keep) }
}

/** Two animation frames, so the capture reads the state just set and not the last painted one. */
const TWO_FRAMES =
  'new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(function () { resolve(true) }) }) })'

/** Wait, with the clock stopped, for the page's first geometry pass and its fonts. */
const FONTS_READY = 'document.fonts ? document.fonts.ready.then(function () { return true }) : true'

const rectOf = (id: string): string =>
  `(function () { var el = document.getElementById(${JSON.stringify(id)}); if (!el) return null; var r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`

const STAGE_RECT = rectOf('stage')

/** The band the page draws its frame counter in (engine v0.20.0). */
const STRIP_RECT = rectOf('present-strip')

/**
 * Whether the page took the address's `strip`: the attribute the page's boot
 * script sets when it does, and the band's element; and whether it counts
 * its draws at all, which is what tells a page an older engine drew (none of
 * the three) from a page that counts and drew no band for this address.
 */
const STRIP_TAKEN =
  '(function () { var counts = false; try { counts = typeof window.__present.state().draws === "number" } catch (e) {} return { strip: document.documentElement.getAttribute("data-strip"), band: !!document.getElementById("present-strip"), counts: counts } })()'

/** How many times the page has drawn, which its band shows modulo 65536. */
const DRAWS = 'window.__present.state().draws'

/**
 * The job's address with the band asked for: `strip=` added to its query, the
 * rest of the address exactly as the engine wrote it. One the engine already
 * gave a `strip` keeps it, and the page's own answer then says it is not ours.
 */
export function withStrip(url: string): string {
  const hash = url.indexOf('#')
  const head = hash < 0 ? url : url.slice(0, hash)
  const tail = hash < 0 ? '' : url.slice(hash)
  return `${head}${head.includes('?') ? '&' : '?'}strip=${STRIP_PX}${tail}`
}

/** What the page says it has drawn, checked before it is trusted. */
function asDraws(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
    throw new CaptureError('the page did not say how many times it has drawn')
  return value
}

/**
 * The page's settle, waited for, by every capture (spec 035): since engine
 * v0.15.0 it answers a promise that resolves once the map's face has loaded,
 * and an older page answers nothing, which this waits for as well. It snaps
 * every tween before the page answers, as it always did; a promise that never
 * resolves ends in the frame's own timeout, like any other step.
 */
export const SETTLE_AWAITED =
  'Promise.resolve(window.__present.settle()).then(function () { return true })'

/** Whether the page has the calls an opening needs: a page drawn by an earlier pin has neither. */
function hasOpening(card: boolean, drawIn: boolean): string {
  const asked = [
    ...(card ? ['typeof window.__present.setCard === "function"'] : []),
    ...(drawIn ? ['typeof window.__present.setDrawn === "function"'] : []),
  ]
  return `!!(window.__present && ${asked.join(' && ')})`
}

/** The card up or down; only a boolean is ever written into the script. */
const setCard = (on: boolean): string => `window.__present.setCard(${on === true}); true`

/** The network drawn to a fraction; only a number is ever written into the script. */
const setDrawn = (fraction: number): string =>
  `window.__present.setDrawn(${Number(fraction)}); true`

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
    const emulate = (height: number) =>
      step(
        'emulating the frame',
        () =>
          page.send('Emulation.setDeviceMetricsOverride', {
            width: job.width,
            height,
            deviceScaleFactor: job.scale,
            mobile: false,
          }),
        timeouts.frame,
      )
    const seam = async () => {
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
    }

    // A document first: emulating a web contents that has never navigated
    // is a null dereference that takes the whole process down. The address
    // asks for the frame counter's band, and the viewport is the band taller.
    await step('loading the page', () => page.navigate(withStrip(job.url)), timeouts.page)
    page.attach()
    await emulate(job.height + STRIP_PX)
    // The machine's own preference must not snap every transition.
    await step(
      'emulating the media',
      () =>
        page.send('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
        }),
      timeouts.frame,
    )
    await seam()

    // Whether the page drew the band. One that did not is a page an older
    // engine drew (see the top of this file), laid out in a viewport the
    // band taller than its frame, so it is loaded again at the job's own size
    // and address, as every capture loaded it before the band, and captured
    // without the proof. Navigated already, so emulating first is safe.
    const taken = (await evaluate('asking for the frame counter', STRIP_TAKEN)) as {
      strip?: unknown
      band?: unknown
      counts?: unknown
    } | null
    const proven = taken?.strip === String(STRIP_PX) && taken.band === true
    if (!proven) {
      if (taken?.strip != null || taken?.band === true)
        throw new CaptureError(
          'the page drew a frame counter other than the one the capture asked for',
        )
      // A page that counts its draws is no older engine's: it was drawn by
      // one that has the band, and drew none for this address (one without
      // `present=1`, or a band the page no longer names as the capture
      // does). Captured unproven, it would pass for an older page silently.
      if (taken?.counts === true) throw new CaptureError(NO_BAND_FOR_ADDRESS)
      log(
        'capture: the page has no frame counter (an older engine drew it); its frames are not proven fresh',
      )
      await emulate(job.height)
      await step('loading the page', () => page.navigate(job.url), timeouts.page)
      await seam()
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
    // The shot: the stage, and with the proof the band right under it, as
    // wide as the stage, which is where the page draws it.
    let shotClip = clip
    if (proven) {
      const band = asRect(await evaluate('measuring the frame counter', STRIP_RECT))
      const near = (a: number, b: number) => Math.abs(a - b) <= 0.5
      if (
        band === null ||
        !near(band.x, clip.x) ||
        !near(band.width, clip.width) ||
        !near(band.y, clip.y + clip.height) ||
        !near(band.height, STRIP_PX)
      )
        throw new CaptureError('the page did not draw its frame counter under the stage')
      shotClip = { ...clip, height: clip.height + STRIP_PX }
    }
    const width = Math.round(clip.width * job.scale)
    const height = Math.round(clip.height * job.scale)
    const shotHeight = Math.round(shotClip.height * job.scale)
    // The opening the job plays, if any (spec 035): a job with neither flag
    // asks nothing of it.
    const carded = job.beats.some((b) => b.card === true)
    const drawsIn = job.beats.some((b) => b.draw_in === true)
    if (carded || drawsIn) {
      // A page drawn before the engine could open on a card or draw itself
      // in has neither call: refused here, before any frame, in a sentence,
      // rather than as a script error halfway through.
      const able = await evaluate('asking for the opening', hasOpening(carded, drawsIn))
      if (able !== true)
        throw new CaptureError(
          'this map was drawn before it could open on a title card or draw itself in; draw the map again, or choose no opening',
        )
    }
    // Snap every tween before the first beat, so nothing from the page's own
    // start-up leaks into frame 0, and wait for the map's face, which the
    // page's settle answers a promise for since engine v0.15.0.
    await evaluate('settling the page', SETTLE_AWAITED)
    // The network is undrawn on every beat before its draw-in.
    if (drawsIn) await evaluate('undrawing the network', setDrawn(0))

    log(
      `capture: ${total} frames of ${clip.width}x${clip.height} at ${job.scale}x, ${job.fps} fps` +
        (proven ? ", each proven by the page's frame counter" : ''),
    )
    let retaken = 0
    for (const beat of job.beats) {
      if (ended !== null) throw ended
      const frames = Math.round(beat.secs * job.fps)
      // The card goes up at its beat's start and down at the next beat's
      // that has none; asked only of a job that has one.
      if (carded) await evaluate('putting the card up', setCard(beat.card === true))
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
        // The draw-in's fraction is the sweep's step, taken after the clock's,
        // so the beat's last frame is the network whole.
        if (beat.draw_in === true)
          await evaluate('drawing the network in', setDrawn(frames > 1 ? i / (frames - 1) : 1))
        // The paint wait, then the shot; with the proof, the shot is kept
        // only where its band shows the count the page had reached, and is
        // otherwise taken again after another wait.
        let kept: Buffer | null = null
        let counted = false
        for (let tries = 1; kept === null; tries++) {
          await evaluate('waiting for the paint', TWO_FRAMES)
          const draws = proven ? asDraws(await evaluate('reading the frame count', DRAWS)) : null
          const shot = (await step(
            'taking the frame',
            () =>
              page.send('Page.captureScreenshot', {
                format: 'png',
                clip: { ...shotClip, scale: 1 },
                captureBeyondViewport: false,
              }),
            timeouts.frame,
          )) as { data?: unknown }
          if (typeof shot?.data !== 'string') throw new CaptureError('the frame came back empty')
          const bytes = Buffer.from(shot.data, 'base64')
          if (draws === null) {
            kept = bytes
            break
          }
          // The zlib work as steps of their own, so a cancel or a page gone
          // answers at once rather than once the frame is read and written.
          const shown = await step(
            'reading the frame',
            () => freshness(bytes, width, shotHeight, height),
            timeouts.frame,
          )
          if (shown.count === draws % STRIP_MODULUS) {
            const png = shown.png
            kept = await step(
              'keeping the frame',
              () => cropPng(png, height, options.still === true ? {} : { level: 1 }),
              timeouts.frame,
            )
            break
          }
          counted ||= shown.count !== null
          log(
            `capture: frame ${written}'s band showed ${shown.count ?? 'no count'} where the page had drawn ${draws % STRIP_MODULUS}` +
              (tries < FRESH_TRIES ? '; taking it again' : ''),
          )
          if (tries >= FRESH_TRIES)
            throw new CaptureError(counted ? staleFrame(written) : unreadFrame(written))
          retaken++
        }
        try {
          await writeFile(join(options.frames, `${String(written).padStart(6, '0')}.png`), kept)
        } catch {
          throw new CaptureError(`frame ${written} could not be written`)
        }
        written++
        options.onProgress?.(written, total)
      }
    }
    log(
      `capture: ${written} frames written` +
        (proven ? `, each proven fresh (${retaken} taken again)` : ', not proven fresh'),
    )
    return { frames: written, width, height, first, proven }
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
