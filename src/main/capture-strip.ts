// The frame counter a capture reads out of its own shot (app issue 100,
// engine issue 85, engine v0.20.0). The page's script cannot say whether the
// picture a screenshot returns was painted after the step the capture asked
// for, because the script is always current; only the picture can. So under
// `strip=<px>` the page reserves a band that many CSS pixels tall below its
// stage and draws there `state().draws` modulo 65536, as sixteen bits from the
// most significant, two blocks a bit across the band's whole width: white then
// black for a 1, black then white for a 0, in pure #fff and #000. The capture
// takes the stage and the band in one shot, reads the count here, and keeps
// the stage alone (`cropPng`).
//
// Pure: no Electron and no dependency, only `node:zlib`. Not `nativeImage`,
// which Electron offers for the same work, because its `toBitmap()` converts
// into sRGB by default (Electron 44's `colorSpace` option) and its
// `createFromBitmap()` and `toPNG()` premultiply and unpremultiply alpha, so a
// round trip through it is not provably the frame Chromium encoded. Here the
// kept frame is exact by construction: a PNG row's filter reads only the rows
// above it, so the stage's rows are the shot's own filtered bytes, unchanged,
// under a header that says fewer rows - the same pixels the capture wrote
// before the band existed, with nothing decoded and encoded again in between.
//
// Off the main thread's back where it can be: the inflate and the deflate are
// zlib's own, asynchronous, on the thread pool; the inflate is bounded by the
// size the header says, so a shot can never decompress into more than a frame;
// and only the unfiltering of the rows down to the band, and the reading of 32
// pixels, are done here in script.

import { promisify } from 'node:util'
import { crc32, deflate, inflate } from 'node:zlib'

const inflated = promisify(inflate)
const deflated = promisify(deflate)

/**
 * The band's height in CSS pixels. Small, because it is only read once and
 * cropped, and every pixel of it is a row the shot carries and the crop
 * throws away; big enough that at the smallest scale (1) the row read, half
 * way down the band's eight rows, has four rows of the band above it and
 * three below, far from any blending where the band meets the stage. The
 * page takes 1 to 256.
 */
export const STRIP_PX = 8

/** Bits the band carries; the count is modulo 2 to this. */
export const STRIP_BITS = 16

/** What the band can say: `state().draws` modulo this. */
export const STRIP_MODULUS = 2 ** STRIP_BITS

/** A block at least this bright in every colour channel is white. */
const WHITE = 192

/** A block at most this bright in every colour channel is black; anything between is neither. */
const BLACK = 63

/** A shot the capture cannot read: a sentence, never a crash. */
export class PngError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PngError'
  }
}

interface Chunk {
  type: string
  data: Buffer
}

/** A PNG, read as far as the band and the crop need it. */
export interface Png {
  width: number
  height: number
  /** Bytes a pixel takes, alpha included: 8-bit samples only. */
  channels: number
  /** Of those, the colour channels: 1 for grey, 3 for RGB. */
  colours: number
  /** The image data, inflated and still filtered: per row, a filter byte and the row. */
  filtered: Buffer
  /** The header's own bytes, which the crop copies but for the height. */
  header: Buffer
  /** The chunks before the image data and after it, other than the header and the end, in order. */
  before: Chunk[]
  after: Chunk[]
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/** Bytes a pixel takes, and how many of them are colour, by colour type (8-bit). */
const LAYOUT: Record<number, { channels: number; colours: number }> = {
  0: { channels: 1, colours: 1 },
  2: { channels: 3, colours: 3 },
  4: { channels: 2, colours: 1 },
  6: { channels: 4, colours: 3 },
}

/** The largest image data a shot may inflate to: a frame of 8192 by 8192 at scale 3, in RGBA. */
const MAX_IMAGE_BYTES = 2 ** 31 - 1

/**
 * Read a PNG's header and image data. Takes what Chromium's screenshots are:
 * 8-bit grey, grey and alpha, RGB or RGBA, not interlaced; refuses anything
 * else, a palette included, with a `PngError`.
 */
export async function readPng(bytes: Buffer): Promise<Png> {
  if (bytes.length < SIGNATURE.length + 12 || !bytes.subarray(0, 8).equals(SIGNATURE))
    throw new PngError('the frame is not a PNG')
  let at = 8
  let header: Buffer | null = null
  const before: Chunk[] = []
  const after: Chunk[] = []
  const data: Buffer[] = []
  let ended = false
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at)
    const type = bytes.toString('latin1', at + 4, at + 8)
    if (at + 12 + length > bytes.length) throw new PngError('the frame is cut short')
    const body = bytes.subarray(at + 8, at + 8 + length)
    at += 12 + length
    if (header === null) {
      if (type !== 'IHDR' || length !== 13) throw new PngError('the frame has no header')
      header = Buffer.from(body)
      continue
    }
    if (type === 'IEND') {
      ended = true
      break
    }
    if (type === 'IDAT') {
      if (after.length > 0) throw new PngError('the image data of the frame is not in one run')
      data.push(body)
    } else if (type === 'IHDR') {
      throw new PngError('the frame has two headers')
    } else {
      ;(data.length === 0 ? before : after).push({ type, data: Buffer.from(body) })
    }
  }
  if (header === null || !ended || data.length === 0) throw new PngError('the frame is cut short')
  const width = header.readUInt32BE(0)
  const height = header.readUInt32BE(4)
  const [depth, colourType, compression, filter, interlace] = header.subarray(8, 13)
  const layout = LAYOUT[colourType]
  if (depth !== 8 || layout === undefined || compression !== 0 || filter !== 0 || interlace !== 0)
    throw new PngError('the frame is a kind of PNG the capture does not read')
  if (width === 0 || height === 0) throw new PngError('the frame is empty')
  const expected = height * (1 + width * layout.channels)
  if (expected > MAX_IMAGE_BYTES) throw new PngError('the frame is larger than any frame can be')
  let filtered: Buffer
  try {
    // Never more than the header says: a stream that would inflate past it
    // is refused before it is held.
    filtered = await inflated(Buffer.concat(data), { maxOutputLength: expected })
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE')
      throw new PngError('the image data of the frame is not the size its header says')
    throw new PngError('the image data of the frame does not decompress')
  }
  if (filtered.length !== expected)
    throw new PngError('the image data of the frame is not the size its header says')
  return { width, height, ...layout, filtered, header, before, after }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/**
 * The pixels of rows `from` to the last, unfiltered, packed: `channels` bytes
 * a pixel. A row's filter reads the row above it, so unfiltering starts at
 * the last row at or above `from` whose filter reads no row above it (None or
 * Sub), or at the top.
 */
export function rowsFrom(png: Png, from: number): Uint8Array {
  const { width, height, channels, filtered } = png
  if (!Number.isInteger(from) || from < 0 || from >= height)
    throw new PngError('the frame has no such row')
  const stride = width * channels
  const line = stride + 1
  let start = from
  while (start > 0 && filtered[start * line] > 1) start--
  const out = new Uint8Array((height - from) * stride)
  let prev = new Uint8Array(stride)
  let cur = new Uint8Array(stride)
  for (let y = start; y < height; y++) {
    const base = y * line + 1
    // One loop a filter, chosen once a row: most of a shot's rows are Up.
    // A row's first pixel has nothing to its left, which reads as 0.
    switch (filtered[base - 1]) {
      case 0:
        cur.set(filtered.subarray(base, base + stride))
        break
      case 1:
        for (let x = 0; x < channels; x++) cur[x] = filtered[base + x]
        for (let x = channels; x < stride; x++) cur[x] = filtered[base + x] + cur[x - channels]
        break
      case 2:
        for (let x = 0; x < stride; x++) cur[x] = filtered[base + x] + prev[x]
        break
      case 3:
        for (let x = 0; x < channels; x++) cur[x] = filtered[base + x] + (prev[x] >> 1)
        for (let x = channels; x < stride; x++)
          cur[x] = filtered[base + x] + ((cur[x - channels] + prev[x]) >> 1)
        break
      case 4:
        for (let x = 0; x < channels; x++) cur[x] = filtered[base + x] + prev[x]
        for (let x = channels; x < stride; x++)
          cur[x] = filtered[base + x] + paeth(cur[x - channels], prev[x], prev[x - channels])
        break
      default:
        throw new PngError('the frame has a row with no filter the format has')
    }
    if (y >= from) out.set(cur, (y - from) * stride)
    const swap = prev
    prev = cur
    cur = swap
  }
  return out
}

/**
 * The count a band says, or null where it says none: each of the 32 blocks
 * read at its middle, half way down the band, and every pair one white block
 * and one black. A block that is neither white nor black, or a pair of two of
 * a kind, is no number at all, never a guess.
 *
 * `rows` is the band alone, `height` rows of `width` pixels of `channels`
 * bytes, the first `colours` of them colour.
 */
export function readStrip(
  rows: Uint8Array,
  width: number,
  height: number,
  channels: number,
  colours: number,
): number | null {
  if (width < 2 * STRIP_BITS || height < 1) return null
  const y = Math.floor(height / 2)
  const block = (i: number): 0 | 1 | null => {
    const x = Math.floor(((i + 0.5) * width) / (2 * STRIP_BITS))
    const at = (y * width + x) * channels
    let lo = 255
    let hi = 0
    for (let c = 0; c < colours; c++) {
      lo = Math.min(lo, rows[at + c])
      hi = Math.max(hi, rows[at + c])
    }
    if (lo >= WHITE) return 1
    if (hi <= BLACK) return 0
    return null
  }
  let value = 0
  for (let bit = 0; bit < STRIP_BITS; bit++) {
    const first = block(2 * bit)
    const second = block(2 * bit + 1)
    if (first === null || second === null || first === second) return null
    value = (value << 1) | first
  }
  return value
}

/** What the band of a shot says, below its first `keep` rows; null where it says nothing. */
export function stripOf(png: Png, keep: number): number | null {
  if (!Number.isInteger(keep) || keep < 1 || keep >= png.height) return null
  return readStrip(rowsFrom(png, keep), png.width, png.height - keep, png.channels, png.colours)
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(data, crc32(head.subarray(4))) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}

/** How hard the crop compresses: zlib's level, 1 (fastest) to 9; zlib's default where left out. */
export interface CropOptions {
  level?: number
}

/**
 * The shot's first `keep` rows as a PNG of their own: the same header but for
 * the height, the same chunks around the image data, and the image data the
 * shot's own filtered bytes for those rows, unchanged. A row's filter reads
 * only the rows above it, so not one pixel of them is decoded and encoded
 * again: the frame kept is the frame a shot without the band would have been.
 */
export async function cropPng(png: Png, keep: number, options: CropOptions = {}): Promise<Buffer> {
  if (!Number.isInteger(keep) || keep < 1 || keep > png.height)
    throw new PngError('the frame has fewer rows than the stage')
  const header = Buffer.from(png.header)
  header.writeUInt32BE(keep, 4)
  const line = 1 + png.width * png.channels
  const data = await deflated(
    png.filtered.subarray(0, keep * line),
    options.level === undefined ? {} : { level: options.level },
  )
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    ...png.before.map((c) => chunk(c.type, c.data)),
    chunk('IDAT', data),
    ...png.after.map((c) => chunk(c.type, c.data)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
