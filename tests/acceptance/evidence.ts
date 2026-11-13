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
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import type { Result } from './record'
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
 * settings, twice); A1 against B should differ by more. The only failure that
 * needs no threshold is that nothing at all changed, and only from a pair
 * that stood still: a map that was moving, or two shots of different sizes,
 * or a change no larger than the noise, is a note for a person to look at.
 * Once a threshold is set, a change under it fails (on a steady pair).
 */
export function judgeChange(
  name: string,
  noise: Difference,
  change: Difference,
  threshold: number | null,
  steady = true,
): Check {
  const base = { name, value: change.fraction, unit: 'fraction of pixels changed', threshold }
  const measured = `${pct(change.fraction)} of pixels changed against ${pct(noise.fraction)} between two shots at the same settings`
  const unsteady = steady ? '' : ' (the map was not steady)'
  if (!noise.sameSize)
    return {
      ...base,
      outcome: 'note',
      said: `two shots at the same settings were of different sizes, so the noise cannot be measured${unsteady}`,
    }
  if (change.pixels === 0)
    return {
      ...base,
      outcome: steady ? 'fail' : 'note',
      said: `no pixel changed: ${measured}${unsteady}`,
    }
  if (change.pixels <= noise.pixels)
    return { ...base, outcome: 'note', said: `no more than the noise: ${measured}${unsteady}` }
  if (threshold === null)
    return { ...base, outcome: 'note', said: `${measured}; no threshold is set yet${unsteady}` }
  if (change.fraction < threshold)
    return {
      ...base,
      outcome: steady ? 'fail' : 'note',
      said: `under the threshold of ${pct(threshold)}: ${measured}${unsteady}`,
    }
  return { ...base, outcome: 'ok', said: `${measured}${unsteady}` }
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

/**
 * A picture with nothing in it at all (every pixel within 8 of the corner's)
 * fails; one with under 1% drawn is only noted, since that 1% has not been
 * measured.
 */
export function judgeBlank(name: string, image: Rgb): Check {
  const { fraction, blank } = blankness(image)
  const said = `${pct(fraction)} of pixels are more than ${TOLERANCE} from the corner pixel`
  return {
    name,
    value: fraction,
    unit: 'fraction of pixels away from the corner pixel',
    threshold: null,
    outcome: fraction === 0 ? 'fail' : blank ? 'note' : 'ok',
    said: fraction === 0 ? `blank: ${said}` : blank ? `nearly blank: ${said}` : said,
  }
}

/** The frames of an export, with the second each was taken at. */
export interface Sampled {
  frames: Rgb[]
  times: number[]
}

/**
 * An export's frames: none empty and the first unlike the last. Only frames
 * from `openingSeconds` on are judged for being empty, since a title card
 * and a network drawing in may leave a frame nearly bare; one with no drawn
 * pixel fails, one under 1% is a note. The first frame equal to the last
 * fails.
 */
export function judgeExport(
  name: string,
  { frames, times }: Sampled,
  threshold: number | null,
  openingSeconds = 0,
): Check {
  const judged = frames
    .map((f, k) => ({ k, fraction: blankness(f).fraction, blank: blankness(f).blank }))
    .filter((f) => times[f.k] >= openingSeconds)
  const empty = judged.filter((f) => f.fraction === 0)
  if (empty.length > 0)
    return {
      name,
      value: null,
      unit: 'blank frames',
      threshold,
      outcome: 'fail',
      said: `frame ${empty.map((b) => b.k + 1).join(', ')} of ${frames.length} sampled has nothing drawn in it`,
    }
  const nearly = judged.filter((f) => f.blank)
  const ends = difference(frames[0], frames[frames.length - 1])
  const said = `${nearly.length === 0 ? 'none' : `frame ${nearly.map((b) => b.k + 1).join(', ')}`} of ${frames.length} sampled is nearly blank (frames before ${openingSeconds} s, the opening, are not judged); ${pct(ends.fraction)} of pixels differ between the first and the last`
  const base = { name, value: ends.fraction, unit: 'fraction of pixels changed', threshold }
  if (ends.pixels === 0)
    return { ...base, outcome: 'fail', said: `the first and the last frame are the same: ${said}` }
  if (nearly.length > 0 || threshold === null)
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
  if (widthBefore === null || widthAfter === null || widthBefore === 0 || widthAfter === 0)
    return { ...base, outcome: 'note', said: 'no label could be measured in the map' }
  if (widthBefore === widthAfter)
    return {
      ...base,
      outcome: 'note',
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
  /** The id of a control entry to write beside this one: ordinary-looking, and not a real entry's. */
  control: string | null
  /** The page's draw count when the pair's shots were taken, or null where the page does not say. */
  draws?: number | null
  /** A control's three shots at the same settings, of its own: never copies of the pair's. */
  controlShots?: string[]
  /** A change that need not show in the picture: nothing changing is a note, never a failure. */
  noteOnly?: boolean
}

export interface Settle {
  path: string
  settled: boolean
}

export class Evidence {
  readonly entries: Entry[] = []
  readonly #dir: string
  readonly #work: string
  /** Working file to kept name. */
  readonly #kept = new Map<string, string>()

  /** One random bit per pair: whether the real entry takes the control's id, and the control the real's. */
  readonly #swap: () => boolean

  constructor(dir: string, swap: () => boolean = () => (randomBytes(1)[0] & 1) === 1) {
    this.#dir = dir
    this.#swap = swap
    // The shots are taken under names that say what each is (`-a1`, `-b`);
    // what the manifest lists is a copy under a name that says nothing. The
    // working folder is hidden, which the artefact upload leaves out.
    this.#work = join(dir, '.work')
    mkdirSync(this.#work, { recursive: true })
  }

  /**
   * Where the key is written: a folder of its own beside the evidence's, and
   * uploaded as an artefact of its own, so the reviewer's evidence holds
   * neither the key nor any machine check.
   */
  get keyDir(): string {
    const dir = `${this.#dir}-key`
    mkdirSync(dir, { recursive: true })
    return dir
  }

  /** Where a working file lives; what is kept for the reviewer is copied out of it by `add`. */
  pathOf(file: string): string {
    return join(this.#work, file)
  }

  /**
   * A kept picture's name in the folder the reviewer reads: the step and
   * five random bytes, chosen anew for each picture in each run and carrying
   * nothing of the working name. The mapping back is written only to the key
   * file. A file already kept keeps its name: no picture is copied twice.
   */
  #opaque(step: number, working: string): string {
    const kept = this.#kept.get(working)
    if (kept !== undefined) return kept
    const fresh = (): string => `${step}-${randomBytes(5).toString('hex')}.png`
    let name = fresh()
    while ([...this.#kept.values()].includes(name)) name = fresh()
    copyFileSync(working, join(this.#dir, name))
    this.#kept.set(working, name)
    return name
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
    options: { name: string; control?: string; noteOnly?: boolean } = { name: init.id },
  ): Promise<Pair> {
    const steady = (await pauseAndRead(window)).steady
    const draws = await readDraws(window)
    const a1 = await this.settled(`${init.id}-a1`, target)
    const a2 = await this.settled(`${init.id}-a2`, target)
    // A control is a pair's twin: three fresh shots at the same settings,
    // taken as B is for a real entry, so that it carries ordinary noise.
    const controlShots: string[] = []
    if (options.control !== undefined)
      for (const k of [1, 2, 3])
        controlShots.push((await this.settled(`${options.control}-c${k}`, target)).path)
    return {
      init,
      name: options.name,
      target,
      a1: a1.path,
      a2: a2.path,
      steady: steady && a1.settled && a2.settled,
      control: options.control ?? null,
      controlShots,
      draws,
      noteOnly: options.noteOnly === true,
    }
  }

  /** The shot at the changed settings, judged against the pair. Never throws for a difference: it returns the check. */
  async finish(
    pair: Pair,
    options: { colour?: string; wait?: typeof sleep; window?: Page } = {},
  ): Promise<Check> {
    // B is taken once the page has drawn again, not when the record says so.
    if (options.window !== undefined) await untilRedrawn(options.window, pair.draws ?? null)
    let b = await this.settled(`${pair.init.id}-b`, pair.target, options.wait)
    // A redraw that is slow gives B the same as A: look again, to a short
    // deadline, before it is judged as a change that did not happen.
    for (let again = 0; again < (pair.noteOnly === true ? 0 : 5); again++) {
      if (difference(this.#read(pair.a1), this.#read(b.path)).pixels > 0) break
      await (options.wait ?? sleep)(1_000)
      b = await this.settled(`${pair.init.id}-b`, pair.target, options.wait)
    }
    const [a1, a2, bb] = [this.#read(pair.a1), this.#read(pair.a2), this.#read(b.path)]
    // B too is taken of a map standing still: its clock is read twice as A's was.
    const steady =
      pair.steady &&
      b.settled &&
      (options.window === undefined || (await clockStill(options.window)))
    let check: Check
    if (options.colour === undefined) {
      check = judgeChange(
        pair.name,
        difference(a1, a2),
        difference(a1, bb),
        thresholdFor(pair.name),
        steady,
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
    if (pair.noteOnly === true && check.outcome === 'fail')
      check = {
        ...check,
        outcome: 'note',
        said: `${check.said} (the picture need not change with this setting)`,
      }
    if (!steady && options.colour !== undefined)
      check = { ...check, said: `${check.said} (the map was not steady)` }
    // Which of the two ids the real entry takes is drawn per pair, and the
    // key says which is the control.
    const swapped = pair.control !== null && this.#swap()
    const realId = swapped ? (pair.control as string) : pair.init.id
    this.add({ ...pair.init, id: realId, images: [pair.a1, pair.a2, b.path], check })
    if (pair.control !== null) {
      // Shaped as a real entry is: three pictures, a check of the same fields.
      this.add(
        {
          ...pair.init,
          id: swapped ? pair.init.id : pair.control,
          images: pair.controlShots ?? [],
          check: {
            name: pair.name,
            value: null,
            unit: 'fraction of pixels changed',
            threshold: null,
            outcome: 'note',
            said: 'no threshold is set yet',
          },
        },
        true,
      )
    }
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
  keepFrames(
    init: EntryInit,
    { frames, times }: Sampled,
    name: string,
    options: { openingSeconds?: number } = {},
  ): Check {
    const sheet = this.pathOf(`${init.id}-sheet.png`)
    const first = this.pathOf(`${init.id}-first.png`)
    const last = this.pathOf(`${init.id}-last.png`)
    writeFileSync(sheet, encodePng(contactSheet(frames)))
    writeFileSync(first, encodePng(frames[0]))
    writeFileSync(last, encodePng(frames[frames.length - 1]))
    const check = judgeExport(
      name,
      { frames, times },
      thresholdFor(name),
      options.openingSeconds ?? 0,
    )
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
      images: entry.images.map((p) => this.#opaque(entry.step, p)),
      expected: [...(entry.expected ?? [])],
      control,
    })
    this.write()
  }

  write(): void {
    // In step and id order, so that position says nothing of what an entry is.
    const listed = [...this.entries]
      .sort((a, b) => a.step - b.step || a.id.localeCompare(b.id))
      .map((e) => ({ ...e, control: undefined, check: undefined }))
    writeFileSync(
      join(this.#dir, 'evidence.json'),
      `${JSON.stringify({ tolerance: TOLERANCE, entries: listed }, null, 2)}\n`,
    )
    // Which entries are control pairs, kept apart so the reviewer reads the
    // manifest without knowing: opened only after every verdict is written.
    writeFileSync(
      join(this.keyDir, 'evidence-key.json'),
      `${JSON.stringify(
        {
          controls: this.entries.filter((e) => e.control).map((e) => e.id),
          pictures: Object.fromEntries(
            [...this.#kept].map(([working, name]) => [name, working.split(/[\\/]/).pop()]),
          ),
        },
        null,
        2,
      )}\n`,
    )
  }

  /** The step's row: "Evidence kept: <names>. Measured: <numbers>." Empty when nothing was kept. */
  summary(step: number): string {
    const all = this.entries.filter((e) => e.step === step)
    if (all.length === 0) return ''
    // Every picture of the step, controls included, as one sorted list.
    const names = all.flatMap((e) => e.images).sort()
    const measured = all
      .filter((e) => !e.control && e.check !== null)
      .map((e) => `${e.check?.name}: ${e.check?.said}`)
    return `Evidence kept: ${[...new Set(names)].join(', ')}. Measured: ${measured.length === 0 ? 'nothing' : measured.join('; ')}.`
  }

  /** What failed for a step, to be recorded as the step's problems. */
  failures(step: number): string[] {
    return failuresOf(this.entries, step)
  }
}

/** The failed checks of a step's entries: a note and an ok are never a problem. */
export function failuresOf(entries: readonly Entry[], step: number): string[] {
  return entries
    .filter((e) => e.step === step && e.check?.outcome === 'fail')
    .map((e) => `${e.check?.name} (${e.id}): ${e.check?.said}`)
}

/**
 * A step's result in the record, from what the step found. Evidence takes
 * part only through `failed` (a failed check is a problem, `failuresOf`):
 * a kept picture or a note neither passes a step nor takes away its "part
 * not automated", whatever it measured.
 */
export function stepResult(found: {
  failed: boolean
  unchecked: number
  unautomated: number
}): Result {
  if (found.failed) return 'fail'
  if (found.unchecked > 0) return 'pass, part not checked'
  if (found.unautomated > 0) return 'pass, part not automated'
  return 'pass'
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

/** The page's draw count (`state().draws`, as the capture reads it), or null where it has none. */
export async function readDraws(window: Page): Promise<number | null> {
  const root = window.frameLocator('iframe.viewer-frame').locator('html')
  return root
    .evaluate(() => {
      const page = window as unknown as { __present?: { state?: () => { draws?: unknown } } }
      try {
        const draws = page.__present?.state?.().draws
        return typeof draws === 'number' ? draws : null
      } catch {
        return null
      }
    })
    .catch(() => null)
}

/**
 * Wait, to a deadline and never failing, for the page to draw again after
 * `since`: its draw count rises. A page that does not count draws is given a
 * moment instead.
 */
export async function untilRedrawn(
  window: Page,
  since: number | null,
  deadline = 10_000,
): Promise<boolean> {
  if (since === null) {
    await sleep(1_500)
    return false
  }
  const end = Date.now() + deadline
  while (Date.now() < end) {
    const now = await readDraws(window)
    if (now !== null && now > since) return true
    await sleep(250)
  }
  return false
}

/** Whether the page's clock reads the same twice, a moment apart: the map is standing still. */
export async function clockStill(window: Page): Promise<boolean> {
  const clock = window.frameLocator('iframe.viewer-frame').locator('#clock')
  const first = (await clock.textContent().catch(() => null)) ?? ''
  await sleep(600)
  return first !== '' && first === ((await clock.textContent().catch(() => null)) ?? '')
}

/** What the map's frame says about a station name: the face loaded, and one label's width. */
export interface LabelMeasure {
  label: string | null
  width: number | null
  faces: string[]
}

/**
 * The widest-named label the map draws and the faces its page has loaded.
 * This reads the viewer's frame from outside, as the spec's other checks
 * do (a locator's `evaluate` runs one read-only function in that frame; it
 * changes nothing there). The labels are `#linear-labels text`, the copies
 * the page draws; the `#labels` group is hidden and measures 0. A given
 * `label` is measured again by its text, so a width is compared across two
 * faces for the same name. The faces are read until `face` is among them
 * or `deadline` passes, since a face loads after the page draws.
 */
export async function measureLabel(
  window: Page,
  label?: string,
  options: { face?: RegExp; deadline?: number } = {},
): Promise<LabelMeasure> {
  const root = window.frameLocator('iframe.viewer-frame').locator('html')
  const read = (): Promise<LabelMeasure> =>
    root.evaluate((html, wanted) => {
      const doc = html.ownerDocument
      const faces = Array.from(doc.fonts)
        .filter((f) => f.status === 'loaded')
        .map((f) => f.family.replace(/["']/g, ''))
      const texts = Array.from(
        doc.querySelectorAll<SVGTextContentElement>('#linear-labels text'),
      ).filter((t) => t.getClientRects().length > 0 && (t.textContent ?? '').trim().length >= 4)
      const text = (t: SVGTextContentElement): string => (t.textContent ?? '').trim()
      const pick =
        wanted === null || wanted === undefined
          ? texts.sort((a, b) => text(b).length - text(a).length)[0]
          : texts.find((t) => text(t) === wanted)
      if (pick === undefined) return { label: null, width: null, faces }
      return {
        label: text(pick),
        width: Math.round(pick.getComputedTextLength() * 100) / 100,
        faces,
      }
    }, label ?? null)
  const end = Date.now() + (options.deadline ?? 30_000)
  for (;;) {
    const measure = await read()
    const ready = options.face === undefined || measure.faces.some((f) => options.face?.test(f))
    if (ready || Date.now() > end) return measure
    await sleep(500)
  }
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
