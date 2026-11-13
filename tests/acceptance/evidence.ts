// Visual evidence for the rows of docs/acceptance.md that ask whether
// something looks right. A machine cannot judge that, and nothing here
// claims to: the record keeps saying "Not automated" for those rows. What
// this keeps is the pictures a reviewer needs (`evidence/<step>-<name>.png`
// and `evidence/evidence.json`, which names each picture with the row's own
// sentence, the question, the text expected in it and the machine check with
// its value and threshold), and what it asserts is only that a difference
// which must exist does.
//
// Every comparison is A1, A2, B: two shots at the same settings give the
// noise, one at the changed setting must differ from A1 by more than that.
// The map is paused and the page's clock read twice before a compared shot,
// so a train moving is not mistaken for the setting.
//
// A threshold is set only after a measuring run on each system, at half the
// smallest difference seen (THRESHOLDS below). Until it is set a number is a
// note: a check fails on what needs no threshold - a blank frame, a missing
// image, a changed setting that changed nothing, or nothing more than the
// noise - and records the rest.
//
// The pixel work reuses tests/support/frames.ts: PNG reading and writing, and
// the difference at the tolerance of 8, in RGB. No dependency is added.

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { TOLERANCE, pixelDifference, readPngRows, writePng } from '../support/frames'

// ------------------------------------------------------------------ thresholds

type System = 'darwin' | 'win32'

/**
 * The smallest fraction of pixels a changed setting must change, per check and
 * per system. `null` is "not measured yet": the number is then a note, never a
 * failure. A measuring run sets each at half the smallest difference it saw.
 */
export const THRESHOLDS: Readonly<Record<string, Readonly<Record<System, number | null>>>> = {
  'map-moves': { darwin: null, win32: null },
  theme: { darwin: null, win32: null },
  'line-width': { darwin: null, win32: null },
  'interchange-marker': { darwin: null, win32: null },
  'typeface-pixels': { darwin: null, win32: null },
  'dot-size': { darwin: null, win32: null },
  'line-colour': { darwin: null, win32: null },
  'option-width': { darwin: null, win32: null },
  'option-casing': { darwin: null, win32: null },
  'option-dash': { darwin: null, win32: null },
  'scrub-moves': { darwin: null, win32: null },
  'order-changes': { darwin: null, win32: null },
  'look-beck': { darwin: null, win32: null },
}

export function thresholdFor(name: string, platform: string = process.platform): number | null {
  const row = THRESHOLDS[name]
  if (row === undefined) return null
  return platform === 'darwin' || platform === 'win32' ? row[platform] : null
}

// ------------------------------------------------------------------- the pixels

/** Packed 8-bit RGB, whole, in memory. */
export interface Rgb {
  width: number
  height: number
  data: Buffer
}

/** A PNG decoded to RGB, whatever its colour type (an alpha channel is dropped). */
export function decodePng(bytes: Buffer): Rgb {
  const { width, height, channels, rows } = readPngRows(bytes)
  if (width === 0 || height === 0) throw new Error('the PNG has no pixels')
  const data = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    const row = rows[y]
    for (let x = 0; x < width; x++) {
      const at = x * channels
      const grey = channels < 3
      const out = (y * width + x) * 3
      data[out] = row[at]
      data[out + 1] = grey ? row[at] : row[at + 1]
      data[out + 2] = grey ? row[at] : row[at + 2]
    }
  }
  return { width, height, data }
}

/** A frame as a PNG, for a contact sheet or a frame the bundled ffmpeg decoded. */
export function encodePng(image: Rgb): Buffer {
  const stride = image.width * 3
  return writePng({
    width: image.width,
    height: image.height,
    colourType: 2,
    row: (y) => image.data.subarray(y * stride, (y + 1) * stride),
  })
}

export interface Difference {
  /** Pixels with a channel more than the tolerance apart. */
  pixels: number
  /** Of all the pixels. */
  fraction: number
  sameSize: boolean
}

/** How much two shots differ, in RGB at the tolerance of 8; two sizes differ in every pixel. */
export function difference(a: Rgb, b: Rgb): Difference {
  if (a.width !== b.width || a.height !== b.height) {
    const area = Math.max(a.width * a.height, b.width * b.height)
    return { pixels: area, fraction: 1, sameSize: false }
  }
  const { pixels } = pixelDifference(a.data, b.data, a.width, 0, TOLERANCE)
  return { pixels, fraction: pixels / (a.width * a.height), sameSize: true }
}

/** The share of pixels more than the tolerance from the corner's, and whether that is under 1%. */
export function blankness(image: Rgb): { fraction: number; blank: boolean } {
  const { data, width, height } = image
  const [r, g, b] = [data[0], data[1], data[2]]
  let away = 0
  for (let i = 0; i < data.length; i += 3) {
    if (
      Math.abs(data[i] - r) > TOLERANCE ||
      Math.abs(data[i + 1] - g) > TOLERANCE ||
      Math.abs(data[i + 2] - b) > TOLERANCE
    )
      away++
  }
  const fraction = away / (width * height)
  return { fraction, blank: fraction < 0.01 }
}

/** `#rrggbb` as three channels. */
export function channelsOf(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (m === null) throw new Error(`${hex} is not a #rrggbb colour`)
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}

/** How many pixels are the colour, to the tolerance of 8 in each channel. */
export function pixelsOfColour(image: Rgb, hex: string): number {
  const [r, g, b] = channelsOf(hex)
  let n = 0
  for (let i = 0; i < image.data.length; i += 3) {
    if (
      Math.abs(image.data[i] - r) <= TOLERANCE &&
      Math.abs(image.data[i + 1] - g) <= TOLERANCE &&
      Math.abs(image.data[i + 2] - b) <= TOLERANCE
    )
      n++
  }
  return n
}

/**
 * Frames side by side, each scaled (nearest neighbour, which is enough to
 * see a title card or a blank) to `height` rows, with a gap between them: the
 * contact sheet of an export, made here because the bundled ffmpeg has no
 * tile filter.
 */
export function contactSheet(frames: readonly Rgb[], height = 360, gap = 8): Rgb {
  if (frames.length === 0) throw new Error('a contact sheet needs a frame')
  const widths = frames.map((f) => Math.max(1, Math.round((f.width * height) / f.height)))
  const total = widths.reduce((sum, w) => sum + w, 0) + gap * (frames.length - 1)
  const data = Buffer.alloc(total * height * 3, 128)
  let left = 0
  frames.forEach((f, k) => {
    for (let y = 0; y < height; y++) {
      const sy = Math.min(f.height - 1, Math.floor((y * f.height) / height))
      for (let x = 0; x < widths[k]; x++) {
        const sx = Math.min(f.width - 1, Math.floor((x * f.width) / widths[k]))
        const from = (sy * f.width + sx) * 3
        const to = (y * total + left + x) * 3
        data[to] = f.data[from]
        data[to + 1] = f.data[from + 1]
        data[to + 2] = f.data[from + 2]
      }
    }
    left += widths[k] + gap
  })
  return { width: total, height, data }
}

// -------------------------------------------------------------------- the checks

/** `fail` fails the step; `note` is a measurement with no threshold behind it yet; `ok` met one. */
export type Outcome = 'ok' | 'note' | 'fail'

export interface Check {
  name: string
  /** What was measured; null when nothing could be. */
  value: number | null
  unit: string
  threshold: number | null
  outcome: Outcome
  said: string
}

const pct = (fraction: number): string => `${(fraction * 100).toFixed(3)}%`

/**
 * A changed setting against the noise. A1 against A2 is the noise (the same
 * settings, twice); A1 against B must differ, and by more than the noise.
 * Fails with no threshold at all when nothing differs or no more than the
 * noise does; with a threshold, also when the change is under it.
 */
export function judgeChange(
  name: string,
  noise: Difference,
  change: Difference,
  threshold: number | null,
): Check {
  const base = { name, value: change.fraction, unit: 'fraction of pixels changed', threshold }
  const measured = `${pct(change.fraction)} of pixels changed against ${pct(noise.fraction)} between two shots at the same settings`
  if (!noise.sameSize)
    return {
      ...base,
      outcome: 'fail',
      said: 'two shots at the same settings were of different sizes, so the noise cannot be measured',
    }
  if (change.pixels === 0)
    return { ...base, outcome: 'fail', said: `no pixel changed: ${measured}` }
  if (change.pixels <= noise.pixels)
    return { ...base, outcome: 'fail', said: `no more than the noise: ${measured}` }
  if (threshold === null)
    return { ...base, outcome: 'note', said: `${measured}; no threshold is set yet` }
  if (change.fraction < threshold)
    return {
      ...base,
      outcome: 'fail',
      said: `under the threshold of ${pct(threshold)}: ${measured}`,
    }
  return { ...base, outcome: 'ok', said: measured }
}

/** Two shots a second apart while the map plays: the trains must have moved. */
export function judgeMovement(name: string, change: Difference, threshold: number | null): Check {
  const base = { name, value: change.fraction, unit: 'fraction of pixels changed', threshold }
  if (change.pixels === 0)
    return { ...base, outcome: 'fail', said: 'no pixel changed in a second of playing' }
  const said = `${pct(change.fraction)} of pixels changed in a second of playing`
  if (threshold === null)
    return { ...base, outcome: 'note', said: `${said}; no threshold is set yet` }
  return change.fraction < threshold
    ? { ...base, outcome: 'fail', said: `under the threshold of ${pct(threshold)}: ${said}` }
    : { ...base, outcome: 'ok', said }
}

/** A line's new colour: its pixels rise from about none. */
export function judgeColour(
  name: string,
  hex: string,
  before: number,
  after: number,
  total: number,
  threshold: number | null,
): Check {
  const base = {
    name,
    value: total === 0 ? 0 : after / total,
    unit: `fraction of pixels of ${hex}`,
    threshold,
  }
  const said = `${before} pixels of ${hex} before and ${after} after`
  if (after === 0)
    return { ...base, outcome: 'fail', said: `${said}: the colour is not on the map` }
  if (after <= before) return { ...base, outcome: 'fail', said: `${said}: the pixels did not rise` }
  if (threshold === null)
    return { ...base, outcome: 'note', said: `${said}; no threshold is set yet` }
  return base.value < threshold
    ? { ...base, outcome: 'fail', said: `${said}: under the threshold of ${pct(threshold)}` }
    : { ...base, outcome: 'ok', said }
}

/** An export frame is blank when under 1% of its pixels are more than 8 from the corner's. */
export function judgeBlank(name: string, image: Rgb): Check {
  const { fraction, blank } = blankness(image)
  return {
    name,
    value: fraction,
    unit: 'fraction of pixels away from the corner pixel',
    threshold: 0.01,
    outcome: blank ? 'fail' : 'ok',
    said: blank
      ? `blank: ${pct(fraction)} of pixels are more than ${TOLERANCE} from the corner pixel`
      : `${pct(fraction)} of pixels are more than ${TOLERANCE} from the corner pixel`,
  }
}

/** An export's frames: none blank, and the first differs from the last. */
export function judgeExport(name: string, frames: readonly Rgb[], threshold: number | null): Check {
  const blanks = frames.map((f, k) => ({ k, ...blankness(f) })).filter((f) => f.blank)
  if (blanks.length > 0)
    return {
      name,
      value: null,
      unit: 'blank frames',
      threshold,
      outcome: 'fail',
      said: `frame ${blanks.map((b) => b.k + 1).join(', ')} of ${frames.length} sampled is blank`,
    }
  const ends = difference(frames[0], frames[frames.length - 1])
  const said = `none of ${frames.length} sampled frames is blank; ${pct(ends.fraction)} of pixels differ between the first and the last`
  const base = { name, value: ends.fraction, unit: 'fraction of pixels changed', threshold }
  if (ends.pixels === 0)
    return { ...base, outcome: 'fail', said: `the first and the last frame are the same: ${said}` }
  if (threshold === null)
    return { ...base, outcome: 'note', said: `${said}; no threshold is set yet` }
  return ends.fraction < threshold
    ? { ...base, outcome: 'fail', said: `under the threshold of ${pct(threshold)}: ${said}` }
    : { ...base, outcome: 'ok', said }
}

/** A label's face: the font loaded, and the label measured differently from before. */
export function judgeTypeface(
  name: string,
  face: string,
  loaded: boolean,
  widthBefore: number | null,
  widthAfter: number | null,
): Check {
  const base = {
    name,
    value: widthAfter,
    unit: 'user units, the label’s measured width',
    threshold: null,
  }
  if (!loaded) return { ...base, outcome: 'fail', said: `${face} is not among the loaded faces` }
  if (widthBefore === null || widthAfter === null)
    return { ...base, outcome: 'fail', said: 'no label could be measured in the map' }
  if (widthBefore === widthAfter)
    return {
      ...base,
      outcome: 'fail',
      said: `the label measured ${widthAfter} before and after ${face} was chosen`,
    }
  return {
    ...base,
    outcome: 'ok',
    said: `${face} is loaded; the label measured ${widthBefore} and then ${widthAfter}`,
  }
}

// ------------------------------------------------------------------- the manifest

export interface EntryInit {
  /** `<step>-<name>`, which names the files. */
  id: string
  step: number
  /** The row's own not-automated sentence, as the record says it. */
  row: string
  /** The question the reviewer answers of the images. */
  question: string
  /** Text that should be readable in the images. */
  expected?: readonly string[]
}

export interface Entry extends EntryInit {
  images: string[]
  expected: string[]
  /** A control: the same settings, asked as if they had changed. The answer is not "looks right". */
  control: boolean
  check: Check | null
}

/** What a locator, or a page, needs to give for a shot. */
export interface Shootable {
  screenshot(options: { path: string }): Promise<unknown>
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** A pair of shots at the same settings, taken before the change. */
export interface Pair {
  init: EntryInit
  name: string
  target: Shootable
  a1: string
  a2: string
  /** Whether the map was paused and its clock read the same twice. */
  steady: boolean
  /** Also write a control entry. */
  control: boolean
}

export interface Settle {
  path: string
  settled: boolean
}

export class Evidence {
  readonly entries: Entry[] = []
  readonly #dir: string

  constructor(dir: string) {
    this.#dir = dir
    mkdirSync(dir, { recursive: true })
  }

  pathOf(file: string): string {
    return join(this.#dir, file)
  }

  /** The picture of `locator`, kept as `<id>.png`. A shot that is missing or is not a picture throws. */
  async shot(id: string, locator: Shootable): Promise<string> {
    const path = this.pathOf(`${id}.png`)
    await locator.screenshot({ path })
    this.#read(path)
    return path
  }

  #read(path: string): Rgb {
    if (!existsSync(path)) throw new Error(`${path.split(/[\\/]/).pop()} was not written`)
    return decodePng(readFileSync(path))
  }

  /** The decoded picture of a kept file. */
  open(path: string): Rgb {
    return this.#read(path)
  }

  /**
   * A shot taken once the picture has stopped changing: two in a row that
   * agree, a half second apart, within a few tries. The last is kept either way.
   */
  async settled(id: string, locator: Shootable, wait = sleep): Promise<Settle> {
    let path = await this.shot(id, locator)
    for (let tries = 0; tries < 8; tries++) {
      await wait(500)
      const before = this.#read(path)
      path = await this.shot(id, locator)
      if (difference(before, this.#read(path)).pixels === 0) return { path, settled: true }
    }
    return { path, settled: false }
  }

  /** Pause the map and read its clock twice, then take the two shots at these settings. */
  async begin(
    window: Page,
    target: Shootable,
    init: EntryInit,
    options: { name: string; control?: boolean } = { name: init.id },
  ): Promise<Pair> {
    const steady = (await pauseAndRead(window)).steady
    const a1 = await this.settled(`${init.id}-a1`, target)
    const a2 = await this.settled(`${init.id}-a2`, target)
    return {
      init,
      name: options.name,
      target,
      a1: a1.path,
      a2: a2.path,
      steady: steady && a1.settled && a2.settled,
      control: options.control === true,
    }
  }

  /** The shot at the changed settings, judged against the pair. Never throws for a difference: it returns the check. */
  async finish(pair: Pair, options: { colour?: string; wait?: typeof sleep } = {}): Promise<Check> {
    const b = await this.settled(`${pair.init.id}-b`, pair.target, options.wait)
    const [a1, a2, bb] = [this.#read(pair.a1), this.#read(pair.a2), this.#read(b.path)]
    let check: Check
    if (options.colour === undefined) {
      check = judgeChange(
        pair.name,
        difference(a1, a2),
        difference(a1, bb),
        thresholdFor(pair.name),
      )
    } else {
      check = judgeColour(
        pair.name,
        options.colour,
        pixelsOfColour(a1, options.colour),
        pixelsOfColour(bb, options.colour),
        bb.width * bb.height,
        thresholdFor(pair.name),
      )
    }
    if (!pair.steady) check = { ...check, said: `${check.said} (the map was not steady)` }
    this.add({ ...pair.init, images: [pair.a1, pair.a2, b.path], check })
    if (pair.control) this.add({ ...pair.init, images: [pair.a1, pair.a2], check: null }, true)
    return check
  }

  /** Two shots a second apart while the map plays: the trains must have moved. */
  async moving(init: EntryInit, target: Shootable, name = 'map-moves'): Promise<Check> {
    const a = await this.shot(`${init.id}-a`, target)
    await sleep(1_000)
    const b = await this.shot(`${init.id}-b`, target)
    const check = judgeMovement(name, difference(this.#read(a), this.#read(b)), thresholdFor(name))
    this.add({ ...init, images: [a, b], check })
    return check
  }

  /** A kept still: copied in, and not blank. */
  keepStill(init: EntryInit, source: string, name: string): Check {
    const path = this.pathOf(`${init.id}.png`)
    copyFileSync(source, path)
    const check = judgeBlank(name, this.#read(path))
    this.add({ ...init, images: [path], check })
    return check
  }

  /** An export's frames, kept as a contact sheet and its ends: none blank, the first unlike the last. */
  keepFrames(init: EntryInit, frames: readonly Rgb[], name: string): Check {
    const sheet = this.pathOf(`${init.id}-sheet.png`)
    const first = this.pathOf(`${init.id}-first.png`)
    const last = this.pathOf(`${init.id}-last.png`)
    writeFileSync(sheet, encodePng(contactSheet(frames)))
    writeFileSync(first, encodePng(frames[0]))
    writeFileSync(last, encodePng(frames[frames.length - 1]))
    const check = judgeExport(name, frames, thresholdFor(name))
    this.add({ ...init, images: [sheet, first, last], check })
    return check
  }

  /** An entry for a picture only a person can judge, or for a check on a measurement that is not a picture. */
  keep(init: EntryInit, images: readonly string[], check: Check | null = null): void {
    this.add({ ...init, images: [...images], check })
  }

  add(
    entry: Omit<Entry, 'control' | 'expected'> & { expected?: readonly string[] },
    control = false,
  ): void {
    this.entries.push({
      ...entry,
      id: control ? `${entry.id}-control` : entry.id,
      images: entry.images.map((p) => p.split(/[\\/]/).pop() ?? p),
      expected: [...(entry.expected ?? [])],
      control,
    })
    this.write()
  }

  write(): void {
    writeFileSync(
      this.pathOf('evidence.json'),
      `${JSON.stringify({ tolerance: TOLERANCE, entries: this.entries }, null, 2)}\n`,
    )
  }

  /** The step's row: "Evidence kept: <names>. Measured: <numbers>." Empty when nothing was kept. */
  summary(step: number): string {
    const mine = this.entries.filter((e) => e.step === step)
    if (mine.length === 0) return ''
    const names = mine.flatMap((e) => e.images)
    const measured = mine
      .filter((e) => e.check !== null)
      .map((e) => `${e.check?.name}: ${e.check?.said}`)
    return `Evidence kept: ${[...new Set(names)].join(', ')}. Measured: ${measured.length === 0 ? 'nothing' : measured.join('; ')}.`
  }

  /** What failed for a step, to be recorded as the step's problems. */
  failures(step: number): string[] {
    return this.entries
      .filter((e) => e.step === step && e.check?.outcome === 'fail')
      .map((e) => `${e.check?.name} (${e.id}): ${e.check?.said}`)
  }
}

// ----------------------------------------------------------------- in the app

/**
 * Pause the transport if cell 03 is there and playing, and read the page's
 * own clock twice a moment apart: a shot is compared only while it stands
 * still. `steady` is false when the clock moved or the transport could not be
 * paused; the noise pair then says how much that cost.
 */
export async function pauseAndRead(
  window: Page,
): Promise<{ clock: string; steady: boolean; paused: boolean }> {
  const transport = window.getByRole('region', { name: 'Transport' })
  let paused = false
  if ((await transport.count()) > 0) {
    const pause = transport.getByRole('button', { name: 'Pause', exact: true })
    if ((await pause.count()) > 0) await pause.click()
    paused = (await transport.getByRole('button', { name: 'Play day', exact: true }).count()) > 0
  }
  const clock = window.frameLocator('iframe.viewer-frame').locator('#clock')
  const first = (await clock.textContent().catch(() => null)) ?? ''
  await sleep(600)
  const second = (await clock.textContent().catch(() => null)) ?? ''
  return { clock: second, steady: first !== '' && first === second, paused }
}

/** What the map's frame says about a station name: the face loaded, and one label's width. */
export interface LabelMeasure {
  label: string | null
  width: number | null
  faces: string[]
}

/**
 * The widest-named label in the map and the faces the page has loaded, read
 * inside the frame (the page is driven from outside; nothing is injected). A
 * given `label` is measured again by its text, so a width is compared across
 * two faces for the same name.
 */
export async function measureLabel(window: Page, label?: string): Promise<LabelMeasure> {
  const root = window.frameLocator('iframe.viewer-frame').locator('html')
  return root.evaluate((html, wanted) => {
    const doc = html.ownerDocument
    const faces = Array.from(doc.fonts)
      .filter((f) => f.status === 'loaded')
      .map((f) => f.family.replace(/["']/g, ''))
    const texts = Array.from(doc.querySelectorAll<SVGTextContentElement>('#stage svg text'))
    const named = texts.filter((t) => (t.textContent ?? '').trim().length >= 4)
    const pick =
      wanted === null || wanted === undefined
        ? named.sort(
            (a, b) => (b.textContent ?? '').trim().length - (a.textContent ?? '').trim().length,
          )[0]
        : named.find((t) => (t.textContent ?? '').trim() === wanted)
    if (pick === undefined) return { label: null, width: null, faces }
    return {
      label: (pick.textContent ?? '').trim(),
      width: Math.round(pick.getComputedTextLength() * 100) / 100,
      faces,
    }
  }, label ?? null)
}

// ---------------------------------------------------------------- the exports

/** An export's frame at `seconds`, decoded by the bundled ffmpeg to packed RGB; no PNG encoder is needed. */
export function frameAt(
  ffmpeg: string,
  file: string,
  seconds: number,
  size: [number, number],
): Rgb {
  const [width, height] = size
  const result = spawnSync(
    ffmpeg,
    [
      '-v',
      'error',
      '-ss',
      seconds.toFixed(3),
      '-i',
      file,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ],
    { timeout: 120_000, windowsHide: true, maxBuffer: 128 * 1024 * 1024 },
  )
  if (result.error !== undefined)
    throw new Error(`the bundled ffmpeg did not run: ${result.error.message}`)
  if (result.status !== 0)
    throw new Error(`the bundled ffmpeg exited ${result.status}: ${String(result.stderr).trim()}`)
  const data = result.stdout as Buffer
  if (data.length !== width * height * 3)
    throw new Error(`no frame at ${seconds} s: ${data.length} bytes, not ${width * height * 3}`)
  return { width, height, data }
}

/** Where to sample an export of `duration` seconds: the start, three between, and just short of the end. */
export function sampleTimes(duration: number): number[] {
  const last = Math.max(0, duration - 0.25)
  return [0, 0.25, 0.5, 0.75].map((f) => Math.min(f * duration, last)).concat(last)
}
