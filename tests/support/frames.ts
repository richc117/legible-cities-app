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

interface Decoder {
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

function decoder(ffmpeg: Command, file: string, args = decodeArgs(file)): Decoder {
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
