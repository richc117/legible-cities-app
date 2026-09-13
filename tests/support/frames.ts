// Two exported files, decoded and compared frame by frame the way the
// constitution measures determinism: in RGB, with a channel tolerance of 8.
// Never RGBA, which hides a difference in the channels a player shows behind
// an alpha a player ignores; never exact equality, which is stricter than
// two runs of one rasteriser can promise. Shared by the reel test and the
// determinism test, so the two measure the same thing.

import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

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

/**
 * Decode two files to raw RGB with `ffmpeg` (the one on the PATH unless a
 * path is given) and compare them as they stream.
 */
export async function compareDecoded(
  a: string,
  b: string,
  options: CompareOptions & { ffmpeg?: string } = {},
): Promise<Comparison> {
  const ffmpeg = options.ffmpeg ?? 'ffmpeg'
  const decode = (file: string) =>
    spawn(ffmpeg, decodeArgs(file), {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'inherit'],
      timeout: 10 * 60_000,
    })
  const pa = decode(a)
  const pb = decode(b)
  // A decoder that cannot start ends its stream, so the comparison sees a
  // short or empty file and says so, rather than the worker dying on an
  // unhandled event.
  pa.on('error', () => pa.stdout.destroy())
  pb.on('error', () => pb.stdout.destroy())
  try {
    return await compareStreams(pa.stdout, pb.stdout, options)
  } finally {
    pa.kill()
    pb.kill()
  }
}

/**
 * The named frames of a file as PNGs in `dir`, `<prefix>-<frame>.png`: the
 * evidence a failed comparison leaves for a person to look at. At most
 * `limit` frames, so a file that differs everywhere does not fill a disk.
 */
export async function extractFrames(
  file: string,
  frames: number[],
  dir: string,
  prefix: string,
  options: { ffmpeg?: string; limit?: number } = {},
): Promise<void> {
  const ffmpeg = options.ffmpeg ?? 'ffmpeg'
  mkdirSync(dir, { recursive: true })
  for (const frame of frames.slice(0, options.limit ?? 12)) {
    const out = join(dir, `${prefix}-${String(frame).padStart(4, '0')}.png`)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        ffmpeg,
        [
          '-v',
          'error',
          '-y',
          '-i',
          file,
          '-vf',
          `select=eq(n\\,${frame})`,
          '-fps_mode',
          'passthrough',
          '-frames:v',
          '1',
          out,
        ],
        { windowsHide: true, stdio: ['ignore', 'ignore', 'inherit'], timeout: 60_000 },
      )
      child.on('error', reject)
      child.on('exit', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`ffmpeg exited ${code} extracting frame ${frame}`)),
      )
    })
  }
}
