// The frame counter's band, read out of a shot, and the crop that keeps the
// stage (app issue 100, engine v0.20.0). The shots are written here by a PNG
// writer that shares no code with the reader (`tests/support/frames.ts`), in
// the band the engine's page draws: sixteen bits from the most significant,
// two blocks a bit across the width, white then black for a 1.

import { describe, expect, it } from 'vitest'
import {
  PngError,
  STRIP_MODULUS,
  STRIP_PX,
  cropPng,
  readPng,
  readStrip,
  rowsFrom,
  stripOf,
} from '../../src/main/capture-strip'
import { bandRow, flatRow, readPngRows, writePng } from '../support/frames'

/** A noisy row, so every filter has something to do. */
function noise(width: number, channels: number, seed: number): Uint8Array {
  const out = new Uint8Array(width * channels)
  let x = seed * 2654435761
  for (let i = 0; i < out.length; i++) {
    x = (x * 1103515245 + 12345) >>> 0
    out[i] = (x >>> 16) & 0xff
  }
  if (channels === 4) for (let i = 3; i < out.length; i += 4) out[i] = 255
  return out
}

/** A shot: `stage` rows of noise over a band `band` rows tall saying `count`. */
function shot(
  options: {
    width?: number
    stage?: number
    band?: number
    count: number
    colourType?: 0 | 2 | 4 | 6
    edges?: boolean
    filter?: (y: number) => number
    extra?: Array<{ type: string; data: Buffer }>
    bandAt?: (y: number) => Uint8Array
  } = { count: 0 },
): { png: Buffer; stage: Uint8Array[]; keep: number } {
  const width = options.width ?? 540
  const keep = options.stage ?? 60
  const band = options.band ?? STRIP_PX
  const colourType = options.colourType ?? 6
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colourType]
  const stage = Array.from({ length: keep }, (_, y) => noise(width, channels, y + 1))
  const strip = bandRow(width, channels, options.count, { edges: options.edges })
  const png = writePng({
    width,
    height: keep + band,
    colourType,
    row: (y) => (y < keep ? stage[y] : (options.bandAt?.(y - keep) ?? strip)),
    filter: options.filter ?? ((y) => y % 5),
    extra: options.extra,
  })
  return { png, stage, keep }
}

describe('the band', () => {
  it.each([0, 1, 2, 12_345, 32_768, 65_534, 65_535])('reads %i exactly', (count) => {
    const { png, keep } = shot({ count })
    expect(stripOf(readPng(png), keep)).toBe(count)
  })

  it('reads a count modulo 65536, as the page draws it', () => {
    // The page draws `draws % 65536`; the band cannot say more.
    expect(STRIP_MODULUS).toBe(65_536)
    const { png, keep } = shot({ count: 65_536 + 7 })
    expect(stripOf(readPng(png), keep)).toBe(7)
    const wrap = shot({ count: 65_536 })
    expect(stripOf(readPng(wrap.png), wrap.keep)).toBe(0)
  })

  it('reads a band at 2x and 3x, its blocks blended at their edges, at a width that is no multiple of 32', () => {
    // Mutation: a block read at its edge rather than its middle reads grey.
    for (const scale of [2, 3]) {
      for (const width of [540 * scale, 333 * scale]) {
        const { png, keep } = shot({
          width,
          stage: 20 * scale,
          band: STRIP_PX * scale,
          count: 40_961,
          edges: true,
        })
        expect(stripOf(readPng(png), keep), `${width} wide at ${scale}x`).toBe(40_961)
      }
    }
  })

  it('reads grey, grey and alpha, and RGB shots as it reads RGBA', () => {
    for (const colourType of [0, 2, 4] as const) {
      const { png, keep } = shot({ count: 4660, colourType })
      expect(stripOf(readPng(png), keep), `colour type ${colourType}`).toBe(4660)
    }
  })

  it('says no number for a band with a block neither white nor black', () => {
    // Mutation: a threshold at half brightness alone - mid grey reads as a bit.
    const width = 540
    const row = bandRow(width, 4, 12_345)
    const block = Math.floor((3.5 * width) / 32)
    for (let c = 0; c < 3; c++) row[block * 4 + c] = 128
    const { png, keep } = shot({ count: 0, bandAt: () => row })
    expect(stripOf(readPng(png), keep)).toBeNull()
  })

  it('says no number for a pair of blocks of one kind, a band of one colour, or no band at all', () => {
    const width = 540
    const both = bandRow(width, 4, 0)
    // For a 0 a pair is black then white; whiten the first block, so pair 0
    // is white and white.
    for (let x = 0; x < Math.floor(width / 32); x++)
      for (let c = 0; c < 3; c++) both[x * 4 + c] = 255
    expect(stripOf(readPng(shot({ count: 0, bandAt: () => both }).png), 60)).toBeNull()
    for (const rgba of [
      [0, 0, 0, 255],
      [255, 255, 255, 255],
      [30, 120, 200, 255],
    ]) {
      const flat = flatRow(width, 4, rgba)
      expect(stripOf(readPng(shot({ count: 0, bandAt: () => flat }).png), 60)).toBeNull()
    }
    // The stage's noise where the band should be.
    expect(stripOf(readPng(shot({ count: 99, band: 0, stage: 68 }).png), 60)).toBeNull()
  })

  it('reads the band half way down, so a band whose first rows are torn still reads', () => {
    const width = 540
    const good = bandRow(width, 4, 513)
    const torn = flatRow(width, 4, [128, 128, 128, 255])
    const { png, keep } = shot({ count: 0, bandAt: (y) => (y < 2 ? torn : good) })
    expect(stripOf(readPng(png), keep)).toBe(513)
  })

  it('takes nothing it cannot read as a number: too narrow, or no row of band', () => {
    expect(readStrip(new Uint8Array(31 * 4), 31, 1, 4, 3)).toBeNull()
    const { png, keep } = shot({ count: 5 })
    const read = readPng(png)
    expect(stripOf(read, read.height)).toBeNull()
    expect(stripOf(read, 0)).toBeNull()
    expect(stripOf(read, keep)).toBe(5)
  })
})

describe('the rows', () => {
  it('unfilters every filter the format has, as an independent reader does', () => {
    // Mutations: any filter's arithmetic changed (Average's floor, Paeth's
    // tie order); the search for a row to start from going past one that
    // reads the row above it.
    for (const filter of [
      () => 0,
      () => 1,
      () => 2,
      () => 3,
      () => 4,
      (y: number) => y % 5,
      (y: number) => [4, 3, 2, 1, 0][y % 5],
      (y: number) => (y < 10 ? 1 : 4),
    ]) {
      const { png } = shot({ width: 97, stage: 23, count: 777, filter })
      const read = readPng(png)
      const theirs = readPngRows(png).rows
      for (const from of [0, 1, 22, 23, 30]) {
        const ours = rowsFrom(read, from)
        const expected = Buffer.concat(theirs.slice(from).map((r) => Buffer.from(r)))
        expect(Buffer.from(ours).equals(expected), `from row ${from}`).toBe(true)
      }
    }
  })
})

describe('the crop', () => {
  it('is the frame a shot without the band would have been, byte for byte, for every filter', () => {
    // Mutations: the header's height left as it was; a row of the band
    // kept; the filtered bytes decoded and filtered again some other way.
    for (const filter of [
      () => 0,
      () => 3,
      () => 4,
      (y: number) => y % 5,
      (y: number) => [4, 3, 2, 1, 0][y % 5],
    ]) {
      const { png, stage, keep } = shot({ width: 101, stage: 37, count: 31_337, filter })
      const kept = cropPng(readPng(png), keep)
      const without = writePng({
        width: 101,
        height: keep,
        colourType: 6,
        row: (y) => stage[y],
        filter,
      })
      const theirs = readPngRows(kept)
      expect(theirs.width).toBe(101)
      expect(theirs.height).toBe(keep)
      for (let y = 0; y < keep; y++)
        expect(Buffer.from(theirs.rows[y]).equals(Buffer.from(stage[y])), `row ${y}`).toBe(true)
      // Same pixels as the shot without the band, read by the other reader.
      const plain = readPngRows(without)
      expect(plain.rows.every((r, y) => Buffer.from(r).equals(Buffer.from(theirs.rows[y])))).toBe(
        true,
      )
    }
  })

  it('keeps the chunks around the image data, a colour chunk included, and reads back as a PNG of its own', () => {
    const srgb = { type: 'sRGB', data: Buffer.from([0]) }
    const phys = { type: 'pHYs', data: Buffer.from([0, 0, 11, 19, 0, 0, 11, 19, 1]) }
    const { png, keep } = shot({ count: 3, extra: [srgb, phys] })
    const kept = readPng(cropPng(readPng(png), keep))
    expect(kept.height).toBe(keep)
    expect(kept.before.map((c) => [c.type, [...c.data]])).toEqual([
      ['sRGB', [0]],
      ['pHYs', [...phys.data]],
    ])
    // Nothing of the band is left to read.
    expect(stripOf(kept, keep - 8)).toBeNull()
  })

  it('refuses a height it cannot keep', () => {
    const read = readPng(shot({ count: 1 }).png)
    expect(() => cropPng(read, 0)).toThrow(PngError)
    expect(() => cropPng(read, read.height + 1)).toThrow(PngError)
  })
})

describe('a shot it cannot read', () => {
  const good = shot({ width: 64, stage: 4, count: 1 }).png

  it.each<[string, () => Buffer, RegExp]>([
    [
      'bytes that are not a PNG',
      () => Buffer.from('not a picture at all, not even close'),
      /not a PNG/,
    ],
    ['a PNG cut short', () => good.subarray(0, good.length - 20), /cut short/],
    [
      'a palette',
      () => {
        const b = Buffer.from(good)
        b[8 + 8 + 9] = 3
        return b
      },
      /kind of PNG/,
    ],
    [
      'sixteen bits a sample',
      () => {
        const b = Buffer.from(good)
        b[8 + 8 + 8] = 16
        return b
      },
      /kind of PNG/,
    ],
    [
      'an interlaced PNG',
      () => {
        const b = Buffer.from(good)
        b[8 + 8 + 12] = 1
        return b
      },
      /kind of PNG/,
    ],
    [
      'a header that says more rows than there are',
      () => {
        const b = Buffer.from(good)
        b.writeUInt32BE(5000, 8 + 8 + 4)
        return b
      },
      /not the size its header says/,
    ],
  ])('refuses %s in a sentence', (_what, bytes, sentence) => {
    expect(() => readPng(bytes())).toThrow(PngError)
    expect(() => readPng(bytes())).toThrow(sentence)
  })
})
