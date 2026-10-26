// Two exported files, decoded and compared frame by frame the way the
// constitution measures determinism: in RGB, with a channel tolerance of 8.
// Never RGBA, which hides a difference in the channels a player shows behind
// an alpha a player ignores; never exact equality, which is stricter than
// two runs of one rasteriser can promise. Shared by the reel test and the
// determinism test, so the two measure the same thing.

import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Readable } from 'node:stream'
import { crc32, deflateSync, inflateSync } from 'node:zlib'

/** The largest difference in one channel that still counts as the same pixel. */
export const TOLERANCE = 8

export interface Comparison {
  /** Bytes compared, which is the shorter stream's length. */
  bytes: number
  /** The largest difference in any one channel. */
  maxDiff: number
  /** How many channels differ by more than the tolerance. */
  over: number
  /** Whether the two streams decoded to the same number of bytes. */
  sameLength: boolean
  /** Whole frames compared; 0 when no frame size was given. */
  frames: number
  /** The frames, from 0, holding a channel over the tolerance; empty when no frame size was given. */
  differing: number[]
}

export interface CompareOptions {
  tolerance?: number
  /** One frame's size in bytes (width x height x 3), so a difference can be named by frame. */
  frameBytes?: number
}

/**
 * The decoder's arguments: every frame of `file`, as packed 8-bit RGB, to
 * standard output. Each frame the file holds once, in order: raw video is
 * written at a constant rate by default, which can duplicate or drop a frame
 * of a GIF whose delays are whole centiseconds, and then a frame index would
 * not name the file's own frame.
 */
export function decodeArgs(file: string): string[] {
  return [
    '-v',
    'error',
    '-i',
    file,
    '-fps_mode',
    'passthrough',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    'pipe:1',
  ]
}

/**
 * Compare two byte streams as they arrive, so a reel's gigabytes of pixels
 * never sit in memory. Whatever one stream holds past the other's end is
 * drained and counted as a difference in length.
 */
export async function compareStreams(
  a: AsyncIterable<Buffer>,
  b: AsyncIterable<Buffer>,
  options: CompareOptions = {},
): Promise<Comparison> {
  const tolerance = options.tolerance ?? TOLERANCE
  const frameBytes = options.frameBytes ?? 0
  const ia = a[Symbol.asyncIterator]()
  const ib = b[Symbol.asyncIterator]()
  let bufA: Buffer = Buffer.alloc(0)
  let bufB: Buffer = Buffer.alloc(0)
  let doneA = false
  let doneB = false
  let bytes = 0
  let maxDiff = 0
  let over = 0
  const differing: number[] = []
  for (;;) {
    if (bufA.length === 0 && !doneA) {
      const next = await ia.next()
      if (next.done) doneA = true
      else bufA = next.value
    }
    if (bufB.length === 0 && !doneB) {
      const next = await ib.next()
      if (next.done) doneB = true
      else bufB = next.value
    }
    const n = Math.min(bufA.length, bufB.length)
    if (n === 0) {
      if ((doneA && bufA.length === 0) || (doneB && bufB.length === 0)) break
      continue
    }
    for (let i = 0; i < n; i++) {
      const d = Math.abs(bufA[i] - bufB[i])
      if (d > maxDiff) maxDiff = d
      if (d > tolerance) {
        over++
        if (frameBytes > 0) {
          const frame = Math.floor((bytes + i) / frameBytes)
          if (differing[differing.length - 1] !== frame) differing.push(frame)
        }
      }
    }
    bytes += n
    bufA = bufA.subarray(n)
    bufB = bufB.subarray(n)
  }
  let leftover = bufA.length + bufB.length
  for (const [it, done] of [
    [ia, doneA],
    [ib, doneB],
  ] as const) {
    if (done) continue
    for (;;) {
      const next = await it.next()
      if (next.done) break
      leftover += next.value.length
    }
  }
  return {
    bytes,
    maxDiff,
    over,
    sameLength: leftover === 0,
    frames: frameBytes > 0 ? Math.floor(bytes / frameBytes) : 0,
    differing,
  }
}

export interface Decoder {
  stdout: Readable
  /** Settles when ffmpeg has exited and closed its output: resolved on a clean exit, rejected otherwise. */
  finished: Promise<void>
  kill(): void
}

/**
 * One file decoding to raw RGB on standard output. A decoder that exits
 * with a code other than 0, on a signal (the timeout's included), or that
 * cannot start at all, rejects `finished`: two files truncated the same way
 * decode to the same bytes, and only the exit says one of them was broken.
 */
/**
 * The program that decodes: a path or a name, or a program and the
 * arguments that go before the decoder's own (how a unit test stands a
 * failing process in for ffmpeg without writing a script for each platform).
 */
export type Command = string | readonly string[]

export function decoder(ffmpeg: Command, file: string, args = decodeArgs(file)): Decoder {
  const [program, ...leading] = typeof ffmpeg === 'string' ? [ffmpeg] : ffmpeg
  const child = spawn(program, [...leading, ...args], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'inherit'],
    timeout: 10 * 60_000,
  })
  const finished = new Promise<void>((resolve, reject) => {
    child.on('error', (error) => {
      // Ends the stream, so a comparison waiting on it stops too.
      child.stdout.destroy()
      reject(new Error(`ffmpeg could not decode ${basename(file)}: ${error.message}`))
    })
    child.on('close', (code, signal) => {
      if (code === 0) resolve()
      else
        reject(
          new Error(
            `ffmpeg decoding ${basename(file)} ended with ${signal === null ? `code ${code}` : signal}`,
          ),
        )
    })
  })
  // Awaited by the caller once the stream is read; never unhandled before.
  finished.catch(() => {})
  return { stdout: child.stdout, finished, kill: () => child.kill() }
}

/**
 * Decode two files to raw RGB with `ffmpeg` (the one on the PATH unless a
 * path is given) and compare them as they stream. Rejects when either
 * decoder did not exit cleanly.
 */
export async function compareDecoded(
  a: string,
  b: string,
  options: CompareOptions & { ffmpeg?: Command } = {},
): Promise<Comparison> {
  const ffmpeg = options.ffmpeg ?? 'ffmpeg'
  const da = decoder(ffmpeg, a)
  const db = decoder(ffmpeg, b)
  try {
    const result = await compareStreams(da.stdout, db.stdout, options)
    await Promise.all([da.finished, db.finished])
    return result
  } catch (error) {
    da.kill()
    db.kill()
    throw error
  }
}

/** A decoded file's first and last whole frames, and how many whole frames it has. */
export interface Ends {
  frames: number
  first: Buffer | null
  last: Buffer | null
}

/**
 * The first and last whole frames of a raw stream, holding no more than two
 * frames in memory. A partial frame at the end is not a frame.
 */
export async function firstAndLast(
  stream: AsyncIterable<Buffer>,
  frameBytes: number,
): Promise<Ends> {
  if (!Number.isInteger(frameBytes) || frameBytes <= 0)
    throw new Error('a frame has a whole, positive number of bytes')
  let first: Buffer | null = null
  let last: Buffer | null = null
  let frames = 0
  let current = Buffer.alloc(frameBytes)
  let filled = 0
  for await (const chunk of stream) {
    let offset = 0
    while (offset < chunk.length) {
      const n = Math.min(frameBytes - filled, chunk.length - offset)
      chunk.copy(current, filled, offset, offset + n)
      filled += n
      offset += n
      if (filled === frameBytes) {
        frames++
        if (first === null) first = Buffer.from(current)
        last = current
        current = Buffer.alloc(frameBytes)
        filled = 0
      }
    }
  }
  return { frames, first, last }
}

/** How many channels of two equal-sized frames differ by more than the tolerance. */
export function channelsOver(a: Buffer, b: Buffer, tolerance = TOLERANCE): number {
  if (a.length !== b.length) throw new Error('two frames of different sizes cannot be compared')
  let over = 0
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > tolerance) over++
  return over
}

/**
 * A file's first and last frames, decoded. What says an export moves: two
 * blank or motionless exports agree with each other perfectly, so agreement
 * alone is not evidence of anything.
 */
export async function decodedEnds(
  file: string,
  frameBytes: number,
  options: { ffmpeg?: Command } = {},
): Promise<Ends> {
  const d = decoder(options.ffmpeg ?? 'ffmpeg', file)
  try {
    const ends = await firstAndLast(d.stdout, frameBytes)
    await d.finished
    return ends
  } catch (error) {
    d.kill()
    throw error
  }
}

/**
 * The decoder's arguments for a folder of captured frames, `000000.png`
 * onwards, as the capture writes them: each frame once, as packed 8-bit RGB.
 */
export function decodeSequenceArgs(dir: string): string[] {
  return [
    '-v',
    'error',
    '-start_number',
    '0',
    '-i',
    join(dir, '%06d.png'),
    '-fps_mode',
    'passthrough',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    'pipe:1',
  ]
}

/** A raw stream as whole frames, one at a time; a partial frame at the end is dropped. */
export async function* wholeFrames(
  stream: AsyncIterable<Buffer>,
  frameBytes: number,
): AsyncGenerator<Buffer> {
  if (!Number.isInteger(frameBytes) || frameBytes <= 0)
    throw new Error('a frame has a whole, positive number of bytes')
  let current = Buffer.alloc(frameBytes)
  let filled = 0
  for await (const chunk of stream) {
    let offset = 0
    while (offset < chunk.length) {
      const n = Math.min(frameBytes - filled, chunk.length - offset)
      chunk.copy(current, filled, offset, offset + n)
      filled += n
      offset += n
      if (filled === frameBytes) {
        yield current
        current = Buffer.alloc(frameBytes)
        filled = 0
      }
    }
  }
}

/** Where two frames differ: pixels with a channel over the tolerance, their bounding box, the largest difference. */
export interface PixelDifference {
  frame: number
  pixels: number
  maxDiff: number
  /** Inclusive, in pixels from the top left; null when no pixel differs. */
  box: { x0: number; y0: number; x1: number; y1: number } | null
}

/** Compare two RGB frames of `width` pixels a row, pixel by pixel. */
export function pixelDifference(
  a: Buffer,
  b: Buffer,
  width: number,
  frame = 0,
  tolerance = TOLERANCE,
): PixelDifference {
  if (a.length !== b.length || a.length % (width * 3) !== 0)
    throw new Error('two frames of different sizes cannot be compared')
  let pixels = 0
  let maxDiff = 0
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -1
  let y1 = -1
  for (let p = 0; p < a.length / 3; p++) {
    const i = p * 3
    const d = Math.max(
      Math.abs(a[i] - b[i]),
      Math.abs(a[i + 1] - b[i + 1]),
      Math.abs(a[i + 2] - b[i + 2]),
    )
    if (d > maxDiff) maxDiff = d
    if (d > tolerance) {
      pixels++
      const x = p % width
      const y = Math.floor(p / width)
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  }
  return { frame, pixels, maxDiff, box: pixels === 0 ? null : { x0, y0, x1, y1 } }
}

/** What two runs' captured frames say, frame by frame. */
export interface CapturedComparison {
  framesA: number
  framesB: number
  /** Frames whose PNG files are byte for byte the same. */
  identicalFiles: number
  /** Every frame, compared, with where it differs. */
  frames: PixelDifference[]
}

/** A PNG's size in pixels, from ffprobe. */
export async function probeSize(
  ffprobe: string,
  file: string,
): Promise<{ width: number; height: number }> {
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      ffprobe,
      ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'], timeout: 60_000 },
    )
    let text = ''
    child.stdout.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')))
    child.on('error', reject)
    child.on('close', (code, signal) =>
      code === 0
        ? resolve(text)
        : reject(new Error(`ffprobe ended with ${signal ?? `code ${code}`}`)),
    )
  })
  const [width, height] = out.trim().split(',').map(Number)
  if (!Number.isInteger(width) || !Number.isInteger(height))
    throw new Error(`ffprobe gave no size for ${basename(file)}`)
  return { width, height }
}

/**
 * Two folders of captured frames compared in RGB, frame by frame, with the
 * pixels that differ and where: what the capture took, before any encoder
 * has had a chance to spread a difference across every frame.
 */
export async function compareCaptured(
  dirA: string,
  dirB: string,
  options: { ffmpeg?: Command; ffprobe?: string; tolerance?: number } = {},
): Promise<CapturedComparison> {
  const ffmpeg = options.ffmpeg ?? 'ffmpeg'
  const ffprobe = options.ffprobe ?? 'ffprobe'
  const png = (dir: string) =>
    readdirSync(dir)
      .filter((n) => /^\d{6}\.png$/.test(n))
      .sort()
  const namesA = png(dirA)
  const namesB = png(dirB)
  let identicalFiles = 0
  for (const name of namesA)
    if (
      namesB.includes(name) &&
      readFileSync(join(dirA, name)).equals(readFileSync(join(dirB, name)))
    )
      identicalFiles++
  const result: CapturedComparison = {
    framesA: namesA.length,
    framesB: namesB.length,
    identicalFiles,
    frames: [],
  }
  if (namesA.length === 0 || namesB.length === 0) return result
  const size = await probeSize(ffprobe, join(dirA, namesA[0]))
  const frameBytes = size.width * size.height * 3
  const da = decoder(ffmpeg, dirA, decodeSequenceArgs(dirA))
  const db = decoder(ffmpeg, dirB, decodeSequenceArgs(dirB))
  try {
    const ia = wholeFrames(da.stdout, frameBytes)[Symbol.asyncIterator]()
    const ib = wholeFrames(db.stdout, frameBytes)[Symbol.asyncIterator]()
    for (let frame = 0; ; frame++) {
      const [a, b] = await Promise.all([ia.next(), ib.next()])
      if (a.done || b.done) {
        // Drain whichever is longer, so its decoder can exit.
        for (let it = a.done ? ib : ia, next = a.done ? b : a; !next.done; next = await it.next());
        break
      }
      result.frames.push(pixelDifference(a.value, b.value, size.width, frame, options.tolerance))
    }
    await Promise.all([da.finished, db.finished])
    return result
  } catch (error) {
    da.kill()
    db.kill()
    throw error
  }
}

/** One image decoded to packed 8-bit RGB, whole, in memory. */
export async function decodeImage(
  file: string,
  options: { ffmpeg?: Command } = {},
): Promise<Buffer> {
  const d = decoder(options.ffmpeg ?? 'ffmpeg', file)
  try {
    const parts: Buffer[] = []
    for await (const chunk of d.stdout) parts.push(chunk as Buffer)
    await d.finished
    return Buffer.concat(parts)
  } catch (error) {
    d.kill()
    throw error
  }
}

/** How a differing captured frame compares with its neighbours in the other run. */
export interface Neighbours {
  frame: number
  /** Pixels over the tolerance between A's frame and B's frame before, the same, and after; null past an end. */
  aAgainstB: { before: number | null; same: number; after: number | null }
  bAgainstA: { before: number | null; same: number; after: number | null }
}

/**
 * For each named frame, whether one run's frame is really the other run's
 * frame before or after it: a capture that took the last painted frame
 * rather than the state just set shows up as a frame that matches its
 * neighbour exactly. At most `limit` frames.
 */
export async function neighbours(
  dirA: string,
  dirB: string,
  frames: number[],
  width: number,
  options: { ffmpeg?: Command; limit?: number; count?: number } = {},
): Promise<Neighbours[]> {
  const count = options.count ?? Infinity
  const cache = new Map<string, Buffer>()
  const read = async (dir: string, frame: number): Promise<Buffer | null> => {
    if (frame < 0 || frame >= count) return null
    const file = join(dir, `${String(frame).padStart(6, '0')}.png`)
    const hit = cache.get(file)
    if (hit !== undefined) return hit
    const image = await decodeImage(file, options).catch(() => null)
    if (image !== null) cache.set(file, image)
    return image
  }
  const against = async (x: Buffer, dir: string, frame: number): Promise<number | null> => {
    const y = await read(dir, frame)
    return y === null || y.length !== x.length ? null : pixelDifference(x, y, width).pixels
  }
  const out: Neighbours[] = []
  for (const frame of frames.slice(0, options.limit ?? 12)) {
    const a = await read(dirA, frame)
    const b = await read(dirB, frame)
    if (a === null || b === null) continue
    out.push({
      frame,
      aAgainstB: {
        before: await against(a, dirB, frame - 1),
        same: pixelDifference(a, b, width).pixels,
        after: await against(a, dirB, frame + 1),
      },
      bAgainstA: {
        before: await against(b, dirA, frame - 1),
        same: pixelDifference(b, a, width).pixels,
        after: await against(b, dirA, frame + 1),
      },
    })
    cache.clear()
  }
  return out
}

// ------------------------------------------------- PNGs for the capture's tests
//
// What the capture's unit tests hand it as a shot (app issue 100): PNGs
// written here from raw rows, by the format's own definition of each filter,
// so the capture's reader (`src/main/capture-strip.ts`) is checked against a
// writer it shares no code with; and the frame counter's band as engine
// v0.20.0 draws it.

/** Bytes a pixel takes by 8-bit colour type: grey, RGB, grey and alpha, RGBA. */
const PNG_CHANNELS: Record<0 | 2 | 4 | 6, number> = { 0: 1, 2: 3, 4: 2, 6: 4 }

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}

function paethOf(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

export interface PngSource {
  width: number
  height: number
  colourType: 0 | 2 | 4 | 6
  /** Row `y`'s raw pixels, `width` times the colour type's bytes. The same array for two rows marks them alike. */
  row: (y: number) => Uint8Array
  /** The filter row `y` is written with, 0 to 4; Up for every row when left out. */
  filter?: (y: number) => number
  /** Chunks written between the header and the image data, as Chromium may write a colour chunk. */
  extra?: Array<{ type: string; data: Buffer }>
}

/** A PNG from raw rows, each filtered as the format defines it. */
export function writePng(source: PngSource): Buffer {
  const { width, height, colourType, row } = source
  const bpp = PNG_CHANNELS[colourType]
  const stride = width * bpp
  const filtered = Buffer.alloc(height * (stride + 1))
  let prev: Uint8Array = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const cur = row(y)
    if (cur.length !== stride) throw new Error(`row ${y} is ${cur.length} bytes, not ${stride}`)
    const kind = source.filter?.(y) ?? 2
    const base = y * (stride + 1)
    filtered[base] = kind
    // A row like the one above it, filtered Up, is all zeros: left so.
    if (!(kind === 2 && cur === prev)) {
      for (let x = 0; x < stride; x++) {
        const left = x >= bpp ? cur[x - bpp] : 0
        const up = prev[x]
        const corner = x >= bpp ? prev[x - bpp] : 0
        const predicted =
          kind === 0
            ? 0
            : kind === 1
              ? left
              : kind === 2
                ? up
                : kind === 3
                  ? (left + up) >> 1
                  : paethOf(left, up, corner)
        filtered[base + 1 + x] = (cur[x] - predicted) & 0xff
      }
    }
    prev = cur
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = colourType
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    ...(source.extra ?? []).map((c) => pngChunk(c.type, c.data)),
    // The fastest level: these are written for tests, many a run.
    pngChunk('IDAT', deflateSync(filtered, { level: 1 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** A PNG's rows, decoded by inflating and unfiltering it here, independently of the capture. */
export function readPngRows(bytes: Buffer): {
  width: number
  height: number
  channels: number
  rows: Uint8Array[]
} {
  let at = 8
  let width = 0
  let height = 0
  let channels = 0
  const data: Buffer[] = []
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at)
    const type = bytes.toString('latin1', at + 4, at + 8)
    const body = bytes.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      channels = PNG_CHANNELS[body[9] as 0 | 2 | 4 | 6]
    }
    if (type === 'IDAT') data.push(body)
    at += 12 + length
  }
  const filtered = inflateSync(Buffer.concat(data))
  const stride = width * channels
  const rows: Uint8Array[] = []
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const base = y * (stride + 1)
    const kind = filtered[base]
    const cur = new Uint8Array(stride)
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? cur[x - channels] : 0
      const up = prev[x]
      const corner = x >= channels ? prev[x - channels] : 0
      const predicted =
        kind === 0
          ? 0
          : kind === 1
            ? left
            : kind === 2
              ? up
              : kind === 3
                ? (left + up) >> 1
                : paethOf(left, up, corner)
      cur[x] = (filtered[base + 1 + x] + predicted) & 0xff
    }
    rows.push(cur)
    prev = cur
  }
  return { width, height, channels, rows }
}

/**
 * One row of the frame counter's band as engine v0.20.0 draws it: `count`
 * modulo 65536 as sixteen bits from the most significant, two blocks a bit
 * across the whole width, white then black for a 1, black then white for a
 * 0. The blocks are the page's flex items, so at a width that is not a
 * multiple of 32 their edges fall inside a pixel, which is drawn grey here as
 * a browser blends it; `edges` greys every pixel that touches an edge, which
 * is what scaling does to them.
 */
export function bandRow(
  width: number,
  channels: number,
  count: number,
  options: { edges?: boolean; alpha?: number } = {},
): Uint8Array {
  const out = new Uint8Array(width * channels)
  const n = count % 65536
  const colours = channels >= 3 ? 3 : 1
  for (let x = 0; x < width; x++) {
    const block = Math.min(31, Math.floor(((x + 0.5) * 32) / width))
    const bit = (n >> (15 - (block >> 1))) & 1
    const white = (block & 1) === 0 ? bit === 1 : bit === 0
    const start = (block * width) / 32
    const end = ((block + 1) * width) / 32
    const onEdge = options.edges === true && (x < start + 1 || x + 1 > end)
    const value = onEdge ? 128 : white ? 255 : 0
    for (let c = 0; c < colours; c++) out[x * channels + c] = value
    if (channels === 2 || channels === 4) out[x * channels + channels - 1] = options.alpha ?? 255
  }
  return out
}

/** A row of one colour, `channels` bytes a pixel (RGBA when four). */
export function flatRow(width: number, channels: number, rgba: number[]): Uint8Array {
  const out = new Uint8Array(width * channels)
  for (let x = 0; x < width; x++) for (let c = 0; c < channels; c++) out[x * channels + c] = rgba[c]
  return out
}

/** The stage's colour in a shot of a page that has drawn `count` times: a different colour for every count. */
export function stageColour(count: number): number[] {
  return [(count * 37) % 256, (count * 101 + 13) % 256, (count * 7 + 200) % 256, 255]
}

/**
 * A capture's fake page, as far as paint goes: it counts its draws, and a
 * shot shows what was last painted, which is what the count was at the last
 * paint wait - unless the page is told to paint a step late, when a step's
 * draws reach the picture only that many paint waits later (`lateAt`, by the
 * step's index from 0; Infinity for never). A shot is the stage in a colour
 * of the painted count (`stageColour`) and, where the page took `strip`, the
 * band below it carrying that count. Removing the capture's paint wait leaves
 * the picture behind its count; removing its comparison keeps a stale shot.
 */
export class PaintedFrames {
  draws = 0
  painted = 0
  steps = 0
  /** Shots taken, and the count each showed. */
  shots: number[] = []
  owed = 0
  constructor(
    readonly options: {
      strip: boolean
      lateAt?: (step: number) => number
      /** The band's height in CSS pixels the page took; the capture's own when left out. */
      stripPx?: number
    },
  ) {}

  /** The page drew, `times` times; a step is the clock's (an advance or a seek). */
  drew(times = 1, step = false): void {
    this.draws += times
    if (step) {
      this.owed = this.options.lateAt?.(this.steps) ?? 0
      this.steps++
    }
  }

  /** Two animation frames passed: the page paints, unless it owes the step a wait. */
  paint(): void {
    if (this.owed > 0) {
      this.owed--
      return
    }
    this.painted = this.draws
  }

  /** A shot of the clip, at the scale, as base64 PNG. */
  shot(clip: { width: number; height: number }, scale: number, stripPx: number): string {
    const width = Math.round(clip.width * scale)
    const height = Math.round(clip.height * scale)
    const band = this.options.strip ? Math.round(stripPx * scale) : 0
    const keep = height - band
    const stage = flatRow(width, 4, stageColour(this.painted))
    const strip = bandRow(width, 4, this.painted, { edges: scale > 1 })
    this.shots.push(this.painted)
    return writePng({
      width,
      height,
      colourType: 6,
      row: (y) => (y < keep ? stage : strip),
      filter: (y) => (y === 0 || y === keep ? 0 : 2),
    }).toString('base64')
  }
}
