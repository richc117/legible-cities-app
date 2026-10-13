// The delivered GIFs, judged (issue 324, ADR-055). From engine v0.17.0 a
// GIF's colour table is composed from the plan - the theme and the map's
// line colours - and no longer counted from the frames, so two exports of
// one project must carry the same table, and the GIFs' pixels may differ
// only where the captures they were encoded from differ.
//
// Two instruments, both pure but for the one function that decodes:
//
// - the colour tables, read from the GIF container itself: the header, the
//   logical screen descriptor and its global table, then every block walked
//   by its lengths - extensions and image data skipped, never decoded - to
//   count the images and find any that carries a local table;
// - the pixels, four frames at a time (the two captures and the two decoded
//   GIFs, as packed RGB), held to one rule: the GIFs differ only on pixels
//   the captures differ on.
//
// The max-channel comparison at the tolerance of 8, which is the verdict on
// the captures, is never applied to the GIFs: "within 8 in, within 8 out"
// does not hold, because a pixel near the boundary between two entries of
// the table flips by the gap between them (ADR-055, measured up to 153 on a
// channel). What the table holds - BART's 68 distinct entries and 188 ground
// - is the engine's to test (its tests/test_gif_palette.py); the 256 here is
// the GIF format's largest table, which ffmpeg writes from paletteuse's
// 256-colour palette, and not a count of the map.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  decodeSequenceArgs,
  decoder,
  probeSize,
  wholeFrames,
  type Command,
  type Decoder,
} from './frames'

/** Entries in a full GIF colour table: the format's most, 2 to the 8th. */
export const TABLE_ENTRIES = 256

/** How many offending pixels and frames a verdict names; its counts count every one. */
export const EXAMPLES = 5

export type Rgb = [number, number, number]

/** What the container says, read without decoding a pixel. */
export interface GifStructure {
  /** `GIF87a` or `GIF89a`. */
  version: string
  /** The logical screen's size, in pixels. */
  width: number
  height: number
  /** The global colour table, three bytes a colour; null when the file has none. */
  globalTable: Buffer | null
  /** Image descriptors: one a frame. */
  images: number
  /** The images, counted from 0, that carry a local colour table. */
  localTables: number[]
}

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ')

/**
 * A GIF's structure, from its bytes. Throws, saying where, on a file that
 * is not a GIF (its signature, or a byte where a block should begin that
 * begins none) and on one that ends before its trailer.
 */
export function parseGif(bytes: Uint8Array): GifStructure {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 0
  const need = (n: number, what: string): void => {
    if (pos + n > data.length)
      throw new Error(
        `truncated: ${what} needs ${n} byte${n === 1 ? '' : 's'} at byte ${pos}, ` +
          `and the file is ${data.length} bytes`,
      )
  }
  const head = data.subarray(0, 6).toString('latin1')
  if (!'GIF89a'.startsWith(head) && !'GIF87a'.startsWith(head))
    throw new Error(`not a GIF: it begins ${hex(data.subarray(0, 6))}`)
  need(6, 'the header')
  pos = 6
  need(7, 'the logical screen descriptor')
  const width = data.readUInt16LE(6)
  const height = data.readUInt16LE(8)
  const screen = data[10]
  pos = 13
  /** The size of a colour table from the low three bits of a packed field. */
  const tableBytes = (packed: number): number => 3 * 2 ** ((packed & 0x07) + 1)
  let globalTable: Buffer | null = null
  if (screen & 0x80) {
    const size = tableBytes(screen)
    need(size, 'the global colour table')
    globalTable = Buffer.from(data.subarray(pos, pos + size))
    pos += size
  }
  /** Data sub-blocks: a length byte, that many bytes, until a length of 0. */
  const skipSubBlocks = (what: string): void => {
    for (;;) {
      need(1, `${what}'s next sub-block`)
      const length = data[pos]
      pos += 1
      if (length === 0) return
      need(length, `${what}'s sub-block`)
      pos += length
    }
  }
  let images = 0
  const localTables: number[] = []
  for (;;) {
    need(1, 'the next block (the file has no trailer)')
    const introducer = data[pos]
    if (introducer === 0x3b) break
    if (introducer === 0x21) {
      // The introducer and the label, then the extension's sub-blocks.
      const at = pos
      need(2, `the extension at byte ${at}`)
      pos += 2
      skipSubBlocks(`the extension at byte ${at}`)
    } else if (introducer === 0x2c) {
      // The separator and nine bytes: left, top, width, height, packed.
      need(10, `image ${images}'s descriptor`)
      const packed = data[pos + 9]
      pos += 10
      if (packed & 0x80) {
        localTables.push(images)
        const size = tableBytes(packed)
        need(size, `image ${images}'s local colour table`)
        pos += size
      }
      need(1, `image ${images}'s code size`)
      pos += 1
      skipSubBlocks(`image ${images}'s data`)
      images++
    } else {
      throw new Error(
        `not a GIF: byte ${pos} is ${hex(data.subarray(pos, pos + 1))}, which begins no block`,
      )
    }
  }
  return { version: head, width, height, globalTable, images, localTables }
}

/** Where two colour tables first differ: the entry, from 0, and each table's colour there (null past its end). */
export interface TableDifference {
  index: number
  a: Rgb | null
  b: Rgb | null
}

const entry = (table: Buffer, index: number): Rgb | null =>
  index * 3 + 3 <= table.length
    ? [table[index * 3], table[index * 3 + 1], table[index * 3 + 2]]
    : null

/** The first entry two tables differ at; null when they are the same bytes. */
export function firstTableDifference(a: Buffer, b: Buffer): TableDifference | null {
  if (a.equals(b)) return null
  // Past the shorter table's end, or in a part of an entry, `entry` is null,
  // so two tables that are not the same bytes always differ at some index.
  const entries = Math.ceil(Math.max(a.length, b.length) / 3)
  let index = 0
  for (; index < entries; index++) {
    const ea = entry(a, index)
    const eb = entry(b, index)
    if (ea === null || eb === null || ea.some((v, i) => v !== eb[i])) return { index, a: ea, b: eb }
  }
  return { index, a: null, b: null }
}

const rgb = (c: Rgb | null): string => (c === null ? 'no entry' : `rgb(${c.join(', ')})`)

/** One file's side of the tables verdict, as the report keeps it. */
export interface TableFile {
  name: string
  /** Entries in its global colour table; null when it has none or could not be read. */
  entries: number | null
  /** Image descriptors; null when it could not be read. */
  images: number | null
  /** The images, from 0, carrying a local colour table; null when it could not be read. */
  localTables: number[] | null
  /** Why it could not be read as a GIF; null when it could. */
  error: string | null
}

export interface TablesVerdict {
  files: [TableFile, TableFile]
  /** Whether both files have a global colour table and the two are the same bytes. */
  identical: boolean
  /** Where the two global tables first differ; null when they agree or either is missing. */
  firstDifference: TableDifference | null
  /** Every way the tables fail the rule, as sentences; empty when they pass. */
  problems: string[]
}

/**
 * Two delivered GIFs' colour tables, held to the rule: each file has a
 * global colour table of 256 entries and no image with a table of its own,
 * and the two global tables are byte for byte the same. A file that cannot
 * be read as a GIF is a problem, never a throw, so the report is written.
 */
export function judgeTables(
  a: { name: string; bytes: Uint8Array },
  b: { name: string; bytes: Uint8Array },
): TablesVerdict {
  const problems: string[] = []
  const read = ({ name, bytes }: { name: string; bytes: Uint8Array }) => {
    try {
      return { name, structure: parseGif(bytes), error: null }
    } catch (error) {
      const said = error instanceof Error ? error.message : String(error)
      problems.push(`${name} could not be read as a GIF: ${said}`)
      return { name, structure: null, error: said }
    }
  }
  const files = [read(a), read(b)]
  for (const { name, structure } of files) {
    if (structure === null) continue
    if (structure.globalTable === null) problems.push(`${name} has no global colour table`)
    else if (structure.globalTable.length !== TABLE_ENTRIES * 3)
      problems.push(
        `${name}'s global colour table has ${structure.globalTable.length / 3} entries, ` +
          `not ${TABLE_ENTRIES}`,
      )
    if (structure.localTables.length > 0)
      problems.push(
        `${name} has a local colour table on ${structure.localTables.length} of its ` +
          `${structure.images} images, the first image ${structure.localTables[0]}`,
      )
  }
  const [ta, tb] = files.map((f) => f.structure?.globalTable ?? null)
  const firstDifference = ta !== null && tb !== null ? firstTableDifference(ta, tb) : null
  if (firstDifference !== null)
    problems.push(
      `the global colour tables differ, first at entry ${firstDifference.index}: ` +
        `${rgb(firstDifference.a)} in ${a.name}, ${rgb(firstDifference.b)} in ${b.name}`,
    )
  const summary = ({ name, structure, error }: (typeof files)[number]): TableFile => ({
    name,
    entries: structure?.globalTable ? structure.globalTable.length / 3 : null,
    images: structure?.images ?? null,
    localTables: structure?.localTables ?? null,
    error,
  })
  return {
    files: [summary(files[0]), summary(files[1])],
    identical: ta !== null && tb !== null && firstDifference === null,
    firstDifference,
    problems,
  }
}

/** A pixel the GIFs differ on and the captures do not. */
export interface OutsidePixel {
  frame: number
  /** In pixels from the top left. */
  x: number
  y: number
  /** The pixel in the captures, which hold it the same. */
  capture: Rgb
  /** The pixel in the first and the second decoded GIF. */
  gifs: [Rgb, Rgb]
}

/** One frame's numbers. */
export interface FrameCounts {
  frame: number
  /** Pixels the two captures differ on. */
  captures: number
  /** Pixels the two decoded GIFs differ on. */
  gifs: number
  /** Pixels the GIFs differ on and the captures do not: what the rule forbids. */
  outside: number
}

export interface FrameAgreement extends FrameCounts {
  /** The first of the pixels counted in `outside`, at most as many as asked for. */
  examples: OutsidePixel[]
}

const pixelAt = (frame: Uint8Array, i: number): Rgb => [frame[i], frame[i + 1], frame[i + 2]]

/**
 * One frame of the two captures and the two decoded GIFs, all packed 8-bit
 * RGB of `width` pixels a row, compared pixel by pixel.
 *
 * **Two frames agree on a pixel when its red, green and blue are each the
 * same in both, exactly; they differ on it when any one of the three is not,
 * by any amount.** The same definition for the captures and for the GIFs,
 * and exact, never within the tolerance of 8: a pixel's colour in the GIF
 * is a function of its captured colour and its position alone - at draft
 * the capture is the preset's size, so the encode's scale is one to one,
 * and paletteuse's Bayer dither is ordered, never diffused - so a pixel the
 * captures hold the same must come out the same from one table, while a
 * pixel they hold within 8 but not the same may land either side of the
 * boundary between two entries and come out differing by the whole gap
 * (ADR-055). Agreement within the tolerance would forbid exactly that flip:
 * it is "within 8 in, within 8 out" again, which does not hold. ADR-055's
 * own words for the gate: "require their differing pixels to lie where the
 * captures differ, never within 8 per pixel". On 13 Oct 2026, with ffmpeg
 * 9.0.1, BART's composed dark table and 30 synthetic map frames at
 * 630x1120, a near twin (2% of pixels moved by 1 to 8 a channel) differed
 * from its source on 420,270 pixels, all within 8, and its GIF from the
 * source's GIF on 86,667, every one among those 420,270 and none outside.
 *
 * Throws when the four are not the same size, naming each; the caller
 * decodes them so they cannot be.
 */
export function frameAgreement(
  captureA: Uint8Array,
  captureB: Uint8Array,
  gifA: Uint8Array,
  gifB: Uint8Array,
  width: number,
  frame = 0,
  keep = EXAMPLES,
): FrameAgreement {
  const lengths = [captureA.length, captureB.length, gifA.length, gifB.length]
  if (
    !Number.isInteger(width) ||
    width <= 0 ||
    lengths.some((n) => n !== lengths[0]) ||
    lengths[0] % (width * 3) !== 0
  )
    throw new Error(
      `frame ${frame} is not the same whole frame in all four at ${width} pixels a row: ` +
        `the captures ${lengths[0]} and ${lengths[1]} bytes, the GIFs ${lengths[2]} and ` +
        `${lengths[3]} bytes`,
    )
  let captures = 0
  let gifs = 0
  let outside = 0
  const examples: OutsidePixel[] = []
  for (let i = 0; i < captureA.length; i += 3) {
    const inDiffers =
      captureA[i] !== captureB[i] ||
      captureA[i + 1] !== captureB[i + 1] ||
      captureA[i + 2] !== captureB[i + 2]
    const outDiffers =
      gifA[i] !== gifB[i] || gifA[i + 1] !== gifB[i + 1] || gifA[i + 2] !== gifB[i + 2]
    if (inDiffers) captures++
    if (outDiffers) gifs++
    if (outDiffers && !inDiffers) {
      outside++
      if (examples.length < keep) {
        const p = i / 3
        examples.push({
          frame,
          x: p % width,
          y: Math.floor(p / width),
          capture: pixelAt(captureA, i),
          gifs: [pixelAt(gifA, i), pixelAt(gifB, i)],
        })
      }
    }
  }
  return { frame, captures, gifs, outside, examples }
}

export interface Size {
  width: number
  height: number
}

/** What was measured before the rule is applied. */
export interface Measured {
  /** Each capture's first frame, and each GIF; null where there is nothing to read. */
  sizes: { captures: [Size | null, Size | null]; gifs: [Size | null, Size | null] }
  /** Whole frames each decoded to; 0 for all four when the sizes kept them from being decoded. */
  counts: { captures: [number, number]; gifs: [number, number] }
  /** Every frame all four hold, compared. */
  frames: FrameAgreement[]
}

/** The pixel verdict, as the report keeps it. */
export interface PixelsVerdict {
  sizes: Measured['sizes']
  counts: Measured['counts']
  /** Every frame compared, by its numbers alone. */
  frames: FrameCounts[]
  /** The frames' numbers added up. */
  total: { captures: number; gifs: number; outside: number }
  /** The first pixels counted in `outside`, across frames. */
  examples: OutsidePixel[]
  /** Every way the GIFs fail the rule, as sentences; empty when they pass. */
  problems: string[]
}

const sized = (s: Size | null): string => (s === null ? 'nothing' : `${s.width}x${s.height}`)

/**
 * The rule over every frame compared: the four are the same size and hold
 * the same number of frames, at least one; the GIFs differ on no pixel the
 * captures agree on (`frameAgreement` defines agreeing, exactly); and in no
 * frame do more pixels differ between the GIFs than between the captures.
 * The last follows from the one before it whenever the frames are the same,
 * and is checked and said on its own because it is the number ADR-055
 * records ("fewer pixels differ out than in").
 */
export function judgePixels(measured: Measured, keep = EXAMPLES): PixelsVerdict {
  const { sizes, counts, frames } = measured
  const problems: string[] = []
  const all = [...sizes.captures, ...sizes.gifs]
  const sameSize =
    all[0] !== null &&
    all.every((s) => s !== null && s.width === all[0]?.width && s.height === all[0]?.height)
  if (!sameSize)
    problems.push(
      `the captures and the decoded GIFs are not the same size: the captures ` +
        `${sized(sizes.captures[0])} and ${sized(sizes.captures[1])}, the GIFs ` +
        `${sized(sizes.gifs[0])} and ${sized(sizes.gifs[1])}; their pixels were not compared`,
    )
  else {
    const n = [...counts.captures, ...counts.gifs]
    if (n.some((c) => c !== n[0]))
      problems.push(
        `the captures and the decoded GIFs do not hold the same number of frames: the ` +
          `captures ${counts.captures[0]} and ${counts.captures[1]}, the GIFs ` +
          `${counts.gifs[0]} and ${counts.gifs[1]}; the first ${frames.length} were compared`,
      )
    if (frames.length === 0) problems.push('no frame was compared')
  }
  const total = { captures: 0, gifs: 0, outside: 0 }
  const examples: OutsidePixel[] = []
  for (const f of frames) {
    total.captures += f.captures
    total.gifs += f.gifs
    total.outside += f.outside
    for (const e of f.examples) if (examples.length < keep) examples.push(e)
  }
  const outsideFrames = frames.filter((f) => f.outside > 0)
  if (outsideFrames.length > 0) {
    problems.push(
      `${total.outside} ${total.outside === 1 ? 'pixel' : 'pixels'} the captures agree on ` +
        `${total.outside === 1 ? 'differs' : 'differ'} between the GIFs, in ` +
        `${outsideFrames.length} of ${frames.length} frames: ` +
        outsideFrames
          .slice(0, keep)
          .map((f) => `frame ${f.frame}, ${f.outside}`)
          .join('; ') +
        (outsideFrames.length > keep ? '; ...' : ''),
    )
    for (const e of examples)
      problems.push(
        `  frame ${e.frame}, pixel (${e.x}, ${e.y}): ${rgb(e.capture)} in both captures, ` +
          `${rgb(e.gifs[0])} and ${rgb(e.gifs[1])} in the GIFs`,
      )
  }
  const moreOut = frames.filter((f) => f.gifs > f.captures)
  if (moreOut.length > 0)
    problems.push(
      `more pixels differ between the GIFs than between the captures in ${moreOut.length} of ` +
        `${frames.length} frames (in all, ${total.gifs} against ${total.captures}): ` +
        moreOut
          .slice(0, keep)
          .map((f) => `frame ${f.frame}, ${f.gifs} against ${f.captures}`)
          .join('; ') +
        (moreOut.length > keep ? '; ...' : ''),
    )
  return {
    sizes,
    counts,
    frames: frames.map(({ frame, captures, gifs, outside }) => ({
      frame,
      captures,
      gifs,
      outside,
    })),
    total,
    examples,
    problems,
  }
}

/**
 * Two folders of captured frames (`000000.png` onwards, as the capture
 * writes them) and the two GIFs encoded from them, decoded together to RGB
 * and compared frame by frame, four frames in memory at a time, then judged.
 * Rejects when a decoder or ffprobe does not exit cleanly.
 */
export async function compareThroughGifs(
  capturesA: string,
  capturesB: string,
  gifA: string,
  gifB: string,
  options: { ffmpeg?: Command; ffprobe?: string; keep?: number } = {},
): Promise<PixelsVerdict> {
  const ffmpeg = options.ffmpeg ?? 'ffmpeg'
  const ffprobe = options.ffprobe ?? 'ffprobe'
  const keep = options.keep ?? EXAMPLES
  const sizeOf = async (file: string): Promise<Size | null> =>
    existsSync(file) ? probeSize(ffprobe, file) : null
  const sizes: Measured['sizes'] = {
    captures: [
      await sizeOf(join(capturesA, '000000.png')),
      await sizeOf(join(capturesB, '000000.png')),
    ],
    gifs: [await sizeOf(gifA), await sizeOf(gifB)],
  }
  const size = sizes.captures[0]
  const all = [...sizes.captures, ...sizes.gifs]
  if (
    size === null ||
    !all.every((s) => s !== null && s.width === size.width && s.height === size.height)
  )
    return judgePixels({ sizes, counts: { captures: [0, 0], gifs: [0, 0] }, frames: [] }, keep)

  const frameBytes = size.width * size.height * 3
  const decoders: Decoder[] = [
    decoder(ffmpeg, capturesA, decodeSequenceArgs(capturesA)),
    decoder(ffmpeg, capturesB, decodeSequenceArgs(capturesB)),
    decoder(ffmpeg, gifA),
    decoder(ffmpeg, gifB),
  ]
  try {
    const streams = decoders.map((d) => wholeFrames(d.stdout, frameBytes)[Symbol.asyncIterator]())
    const counts = [0, 0, 0, 0]
    const frames: FrameAgreement[] = []
    for (let frame = 0; ; frame++) {
      const next = await Promise.all(streams.map((s) => s.next()))
      next.forEach((n, i) => {
        if (!n.done) counts[i]++
      })
      if (next.some((n) => n.done)) {
        // Count what the others still hold, so a stream with frames the
        // others lack says how many, and its decoder can exit.
        await Promise.all(
          streams.map(async (s, i) => {
            if (next[i].done) return
            for (let n = await s.next(); !n.done; n = await s.next()) counts[i]++
          }),
        )
        break
      }
      const [ca, cb, ga, gb] = next.map((n) => n.value as Buffer)
      frames.push(frameAgreement(ca, cb, ga, gb, size.width, frame, keep))
    }
    await Promise.all(decoders.map((d) => d.finished))
    return judgePixels(
      {
        sizes,
        counts: { captures: [counts[0], counts[1]], gifs: [counts[2], counts[3]] },
        frames,
      },
      keep,
    )
  } catch (error) {
    for (const d of decoders) d.kill()
    throw error
  }
}
