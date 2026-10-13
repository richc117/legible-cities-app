// The determinism gate's judgement of the delivered GIFs (issue 324,
// ADR-055), checked without the app: the colour tables read from the GIF
// container, and the rule over the pixels - the GIFs differ only where the
// captures differ. The end-to-end test (tests/e2e/determinism.spec.ts)
// relies on both.
//
// Hand-built GIFs for the container, whose image data is never decoded and
// so need not be valid LZW; small synthetic frames for the rule; and, where
// ffmpeg and ffprobe are on the PATH, real GIFs encoded the way the engine
// encodes one, with a fixed table and paletteuse's Bayer dither. Without
// them, or with an ffmpeg older than 5.1, those last tests skip, saying so;
// the ci workflow need not have them.

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  compareThroughGifs,
  frameAgreement,
  judgePixels,
  judgeTables,
  parseGif,
  type FrameAgreement,
  type Measured,
  type Rgb,
} from '../support/gif'

// ------------------------------------------------------- hand-built GIFs

/** The colour of entry `i` of a built table: every byte value appears in it, 0x3b and 0x2c included. */
const colour = (i: number): Rgb => [i, 255 - i, (i * 7) & 0xff]

interface Built {
  signature?: string
  width?: number
  height?: number
  /** Entries in the global table, a power of two from 2 to 256; null for none. */
  global?: number | null
  /** The global table's colours, entry by entry. */
  table?: (i: number) => Rgb
  /** One element an image; `local` the entries of its own table, if it has one. */
  images?: { local?: number }[]
}

const sizeField = (entries: number): number => Math.log2(entries) - 1

/**
 * A GIF as ffmpeg lays one out, byte by byte: the header, the screen and its
 * global table, the looping extension, and per image a graphic control
 * extension, the descriptor, any local table and its data, then the
 * trailer. The bytes that open blocks (0x21, 0x2c, 0x3b) are planted inside
 * a table, an extension and the image data, where a parser that looked for
 * them rather than reading lengths would stop.
 */
function gif(options: Built = {}): Buffer {
  const {
    signature = 'GIF89a',
    width = 4,
    height = 2,
    global = 256,
    table = colour,
    images = [{}, {}],
  } = options
  const u16 = (n: number): number[] => [n & 0xff, n >> 8]
  const bytes: number[] = [...Buffer.from(signature, 'latin1')]
  bytes.push(...u16(width), ...u16(height))
  bytes.push(global === null ? 0x70 : 0x80 | 0x70 | sizeField(global), 0, 0)
  if (global !== null) for (let i = 0; i < global; i++) bytes.push(...table(i))
  bytes.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'latin1'), 0x03, 0x01, 0, 0, 0)
  for (const image of images) {
    // Transparent index 0x3b: a trailer's byte inside an extension.
    bytes.push(0x21, 0xf9, 0x04, 0x04, 0x03, 0x00, 0x3b, 0x00)
    const packed = image.local === undefined ? 0 : 0x80 | sizeField(image.local)
    bytes.push(0x2c, 0, 0, 0, 0, ...u16(width), ...u16(height), packed)
    if (image.local !== undefined) for (let i = 0; i < image.local; i++) bytes.push(...colour(i))
    // The code size, two data sub-blocks holding every block's opening byte, the end.
    bytes.push(0x08, 0x05, 0x3b, 0x2c, 0x21, 0x00, 0x3b, 0x02, 0x2c, 0x3b, 0x00)
  }
  bytes.push(0x3b)
  return Buffer.from(bytes)
}

describe('reading a GIF container', () => {
  it('reads the header, the screen, the global table and every image, skipping by lengths', () => {
    const read = parseGif(gif({ width: 630, height: 1120, images: [{}, {}, {}] }))
    expect(read).toMatchObject({
      version: 'GIF89a',
      width: 630,
      height: 1120,
      images: 3,
      localTables: [],
    })
    expect(read.globalTable?.length).toBe(768)
    expect([...(read.globalTable?.subarray(0x3b * 3, 0x3b * 3 + 3) ?? [])]).toEqual(colour(0x3b))
  })

  it('finds an image with a local colour table, and reads on past the table', () => {
    const read = parseGif(gif({ images: [{}, { local: 256 }, {}, { local: 4 }] }))
    expect(read.images).toBe(4)
    expect(read.localTables).toEqual([1, 3])
  })

  it('reads a global table of another size as that size, and a file with none as none', () => {
    expect(parseGif(gif({ global: 128 })).globalTable?.length).toBe(384)
    expect(parseGif(gif({ global: 2 })).globalTable?.length).toBe(6)
    expect(parseGif(gif({ global: null })).globalTable).toBeNull()
  })

  it('refuses every truncation of a GIF, saying where it ended', () => {
    const whole = gif()
    expect(() => parseGif(whole)).not.toThrow()
    for (let n = 0; n < whole.length; n++)
      expect(() => parseGif(whole.subarray(0, n)), `the first ${n} bytes`).toThrow(/^truncated: /)
    expect(() => parseGif(whole.subarray(0, 100))).toThrow(
      'truncated: the global colour table needs 768 bytes at byte 13, and the file is 100 bytes',
    )
  })

  it('refuses what is not a GIF', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0])
    expect(() => parseGif(png)).toThrow('not a GIF: it begins 89 50 4e 47 0d 0a')
    expect(() => parseGif(gif({ signature: 'GIF88a' }))).toThrow(/^not a GIF: it begins /)
    // A byte where a block should begin that begins none: here, after the table.
    const stray = gif({ global: 2, images: [] })
    const at = 13 + 6
    stray[at] = 0x00
    expect(() => parseGif(stray)).toThrow(`not a GIF: byte ${at} is 00, which begins no block`)
  })
})

describe("the GIFs' colour tables", () => {
  const named = (name: string, bytes: Buffer) => ({ name, bytes })

  it('pass two GIFs with the same 256 entries and no local table', () => {
    const verdict = judgeTables(named('first.gif', gif()), named('second.gif', gif()))
    expect(verdict.problems).toEqual([])
    expect(verdict.identical).toBe(true)
    expect(verdict.firstDifference).toBeNull()
    expect(verdict.files).toEqual([
      { name: 'first.gif', entries: 256, images: 2, localTables: [], error: null },
      { name: 'second.gif', entries: 256, images: 2, localTables: [], error: null },
    ])
  })

  it('name the first entry the two tables differ at, and both colours', () => {
    const moved = (i: number): Rgb => (i === 17 || i === 200 ? [18, 238, 119] : colour(i))
    const verdict = judgeTables(
      named('first.gif', gif()),
      named('second.gif', gif({ table: moved })),
    )
    expect(verdict.identical).toBe(false)
    expect(verdict.firstDifference).toEqual({ index: 17, a: [17, 238, 119], b: [18, 238, 119] })
    expect(verdict.problems).toEqual([
      'the global colour tables differ, first at entry 17: rgb(17, 238, 119) in first.gif, ' +
        'rgb(18, 238, 119) in second.gif',
    ])
  })

  it('refuse a table of any size but 256, though the two agree', () => {
    const verdict = judgeTables(
      named('first.gif', gif({ global: 128 })),
      named('second.gif', gif({ global: 128 })),
    )
    expect(verdict.problems).toEqual([
      "first.gif's global colour table has 128 entries, not 256",
      "second.gif's global colour table has 128 entries, not 256",
    ])
    // And two tables of different sizes differ where the shorter one ends.
    const sizes = judgeTables(named('first.gif', gif()), named('second.gif', gif({ global: 128 })))
    expect(sizes.firstDifference).toEqual({ index: 128, a: colour(128), b: null })
  })

  it('refuse a local colour table on any image, naming the first', () => {
    const verdict = judgeTables(
      named('first.gif', gif()),
      named('second.gif', gif({ images: [{}, { local: 256 }, { local: 256 }] })),
    )
    expect(verdict.problems).toEqual([
      'second.gif has a local colour table on 2 of its 3 images, the first image 1',
    ])
    expect(verdict.files[1].localTables).toEqual([1, 2])
  })

  it('refuse a GIF with no global table', () => {
    const verdict = judgeTables(
      named('first.gif', gif({ global: null })),
      named('second.gif', gif()),
    )
    expect(verdict.problems).toEqual(['first.gif has no global colour table'])
    expect(verdict.identical).toBe(false)
  })

  it('say a file is not a GIF, or is cut short, rather than throwing', () => {
    const verdict = judgeTables(
      named('first.gif', Buffer.from('not a picture')),
      named('second.gif', gif().subarray(0, 40)),
    )
    expect(verdict.identical).toBe(false)
    expect(verdict.problems).toHaveLength(2)
    expect(verdict.problems[0]).toMatch(/^first\.gif could not be read as a GIF: not a GIF/)
    expect(verdict.problems[1]).toMatch(/^second\.gif could not be read as a GIF: truncated: /)
    expect(verdict.files[0]).toMatchObject({ entries: null, images: null, localTables: null })
  })
})

// ------------------------------------------------------------ the pixels

/** A frame of 3 x 2 pixels, packed RGB, every pixel its own colour. */
const frame = (): Buffer => Buffer.from(Array.from({ length: 18 }, (_, i) => 40 + i * 9))
/** `base` with pixel (x, y) of a 3-pixel row moved by `by` in channel `c`. */
const moved = (base: Buffer, x: number, y: number, by: number, c = 0): Buffer => {
  const out = Buffer.from(base)
  out[(y * 3 + x) * 3 + c] += by
  return out
}
const same = (n = 1) => ({
  sizes: {
    captures: [
      { width: 3, height: 2 },
      { width: 3, height: 2 },
    ],
    gifs: [
      { width: 3, height: 2 },
      { width: 3, height: 2 },
    ],
  } as Measured['sizes'],
  counts: { captures: [n, n], gifs: [n, n] } as Measured['counts'],
})
const judged = (...frames: FrameAgreement[]) => judgePixels({ ...same(frames.length), frames })

describe('the pixel rule: the GIFs differ only where the captures differ', () => {
  it('finds nothing in four equal frames', () => {
    const f = frame()
    const agreement = frameAgreement(f, f, f, f, 3)
    expect(agreement).toEqual({ frame: 0, captures: 0, gifs: 0, outside: 0, examples: [] })
    expect(judged(agreement).problems).toEqual([])
  })

  it('passes a change within the tolerance that the GIFs absorb', () => {
    const f = frame()
    const agreement = frameAgreement(f, moved(f, 1, 0, 5), f, f, 3)
    expect(agreement).toMatchObject({ captures: 1, gifs: 0, outside: 0 })
    expect(judged(agreement).problems).toEqual([])
  })

  // ADR-055: a pixel near the boundary between two entries flips by the gap
  // between them. The captures differ there, by 3; the GIFs, by 40. Within 8
  // in, not within 8 out, and that is not a failure.
  it('passes a change within the tolerance that the GIFs flip by the gap between two entries', () => {
    const f = frame()
    const agreement = frameAgreement(f, moved(f, 2, 1, 3, 2), f, moved(f, 2, 1, 40, 2), 3)
    expect(agreement).toMatchObject({ captures: 1, gifs: 1, outside: 0 })
    expect(judged(agreement).problems).toEqual([])
  })

  it('fails a pixel the captures agree on that the GIFs change, by one level, naming frame, pixel and values', () => {
    const f = frame()
    const agreement = frameAgreement(f, f, f, moved(f, 2, 1, 1, 1), 3, 4)
    expect(agreement).toEqual({
      frame: 4,
      captures: 0,
      gifs: 1,
      outside: 1,
      examples: [
        {
          frame: 4,
          x: 2,
          y: 1,
          capture: [175, 184, 193],
          gifs: [
            [175, 184, 193],
            [175, 185, 193],
          ],
        },
      ],
    })
    expect(judged(agreement).problems).toEqual([
      '1 pixel the captures agree on differs between the GIFs, in 1 of 1 frames: frame 4, 1',
      '  frame 4, pixel (2, 1): rgb(175, 184, 193) in both captures, rgb(175, 184, 193) and ' +
        'rgb(175, 185, 193) in the GIFs',
      'more pixels differ between the GIFs than between the captures in 1 of 1 frames ' +
        '(in all, 1 against 0): frame 4, 1 against 0',
    ])
  })

  it('fails more differing pixels out than in, saying the counts', () => {
    const f = frame()
    // The captures differ at one pixel; the GIFs there and at two more.
    const captureB = moved(f, 0, 0, 2)
    const gifB = moved(moved(moved(f, 0, 0, 30), 1, 0, 30), 0, 1, 30)
    const agreement = frameAgreement(f, captureB, f, gifB, 3, 0)
    expect(agreement).toMatchObject({ captures: 1, gifs: 3, outside: 2 })
    expect(judged(agreement).problems).toContain(
      'more pixels differ between the GIFs than between the captures in 1 of 1 frames ' +
        '(in all, 3 against 1): frame 0, 3 against 1',
    )
  })

  it('refuses four frames that are not the same size, naming each', () => {
    const f = frame()
    expect(() => frameAgreement(f, f, f.subarray(0, 15), f, 3, 7)).toThrow(
      'frame 7 is not the same whole frame in all four at 3 pixels a row: the captures 18 ' +
        'and 18 bytes, the GIFs 15 and 18 bytes',
    )
    expect(() => frameAgreement(f, f, f, f, 4)).toThrow(/not the same whole frame/)
  })

  it('says when the captures and the GIFs are not the same size, and compares nothing', () => {
    const verdict = judgePixels({
      sizes: {
        captures: [
          { width: 630, height: 1120 },
          { width: 630, height: 1120 },
        ],
        gifs: [{ width: 640, height: 640 }, null],
      },
      counts: { captures: [0, 0], gifs: [0, 0] },
      frames: [],
    })
    expect(verdict.problems).toEqual([
      'the captures and the decoded GIFs are not the same size: the captures 630x1120 and ' +
        '630x1120, the GIFs 640x640 and nothing; their pixels were not compared',
    ])
  })

  it('says when they do not hold the same number of frames, or none', () => {
    const f = frame()
    const two = [frameAgreement(f, f, f, f, 3, 0), frameAgreement(f, f, f, f, 3, 1)]
    const short = judgePixels({
      ...same(),
      counts: { captures: [3, 3], gifs: [3, 2] },
      frames: two,
    })
    expect(short.problems).toEqual([
      'the captures and the decoded GIFs do not hold the same number of frames: the captures ' +
        '3 and 3, the GIFs 3 and 2; the first 2 were compared',
    ])
    expect(judgePixels({ ...same(0), frames: [] }).problems).toEqual(['no frame was compared'])
  })

  it('adds the frames up, and names only the first few pixels and frames', () => {
    const f = frame()
    const frames = Array.from({ length: 7 }, (_, i) =>
      frameAgreement(f, moved(f, 0, 0, 1), f, moved(moved(f, 1, 0, 9), 2, 0, 9), 3, i),
    )
    const verdict = judgePixels({ ...same(7), frames })
    expect(verdict.total).toEqual({ captures: 7, gifs: 14, outside: 14 })
    expect(verdict.frames[6]).toEqual({ frame: 6, captures: 1, gifs: 2, outside: 2 })
    expect(verdict.examples).toHaveLength(5)
    expect(verdict.examples.map((e) => [e.frame, e.x])).toEqual([
      [0, 1],
      [0, 2],
      [1, 1],
      [1, 2],
      [2, 1],
    ])
    expect(verdict.problems[0]).toBe(
      '14 pixels the captures agree on differ between the GIFs, in 7 of 7 frames: frame 0, 2; ' +
        'frame 1, 2; frame 2, 2; frame 3, 2; frame 4, 2; ...',
    )
    // The summary, five pixels, and the count rule.
    expect(verdict.problems).toHaveLength(7)
    // What the report keeps per frame is the numbers, never the pixels.
    expect(Object.keys(verdict.frames[0])).toEqual(['frame', 'captures', 'gifs', 'outside'])
  })
})

// ------------------------------------------------ real GIFs, from ffmpeg

const runs = (program: string, args: string[]): boolean =>
  spawnSync(program, args, { windowsHide: true, timeout: 30_000, stdio: 'ignore' }).status === 0
// An ffmpeg that takes -fps_mode (5.1 onwards), which the decoder's
// arguments use, and has the palette filters the engine's encode uses; an
// older or smaller one on a runner's PATH is a skip, not a failure.
const FFMPEG =
  runs('ffmpeg', [
    ...['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=2x2:d=0.1', '-vf', 'palettegen'],
    ...['-fps_mode', 'passthrough', '-f', 'null', '-'],
  ]) && runs('ffprobe', ['-version'])
const WHY = FFMPEG ? '' : ' (skipped: no ffmpeg 5.1 or later and ffprobe on the PATH)'

const W = 16
const H = 8

function ffmpeg(args: string[], input?: Buffer): void {
  const done = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], {
    input,
    windowsHide: true,
    timeout: 60_000,
  })
  if (done.status !== 0)
    throw new Error(`ffmpeg ${args.join(' ')} ended with ${done.status}: ${done.stderr}`)
}

/** A gradient, different in each frame, so the GIF's frames are not one image. */
function capture(index: number): Buffer {
  const out = Buffer.alloc(W * H * 3)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3
      out[i] = (x * 16 + index * 7) & 0xff
      out[i + 1] = (y * 32) & 0xff
      out[i + 2] = ((x + y) * 8 + index * 40) & 0xff
    }
  return out
}

describe.skipIf(!FFMPEG)(`the delivered GIFs, encoded by ffmpeg the engine's way${WHY}`, () => {
  let dir = ''
  const at = (name: string): string => join(dir, name)

  /** A capture folder as the app keeps one: 000000.png onwards. */
  const captures = (name: string, frames: Buffer[]): void => {
    mkdirSync(at(name))
    ffmpeg(
      [
        ...['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', 'pipe:0'],
        ...['-start_number', '0', join(at(name), '%06d.png')],
      ],
      Buffer.concat(frames),
    )
  }
  /** The engine's second pass (export._encode): a scale to the preset's size, then the table. */
  const encode = (folder: string, palette: string, name: string, size = `${W}:${H}`): void =>
    ffmpeg([
      '-framerate',
      '30',
      '-i',
      join(at(folder), '%06d.png'),
      '-i',
      at(palette),
      '-lavfi',
      `scale=${size}:flags=lanczos[s];[s][1:v]paletteuse=dither=bayer:bayer_scale=3`,
      at(name),
    ])

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lc-gif-unit-'))
    // A fixed table as the engine composes one: 16 by 16 RGB, here a ground,
    // a text colour, a ramp between them and three line colours, the rest
    // the ground.
    const table: Rgb[] = [
      [20, 18, 16],
      [240, 232, 220],
      [160, 150, 140],
    ]
    for (let i = 1; i <= 16; i++) table.push([20 + i * 13, 18 + i * 12, 16 + i * 12])
    table.push([255, 0, 0], [0, 153, 204], [51, 153, 51])
    while (table.length < 256) table.push([20, 18, 16])
    writeFileSync(at('palette.rgb'), Buffer.from(table.flat()))
    ffmpeg([
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-s',
      '16x16',
      '-i',
      at('palette.rgb'),
      '-frames:v',
      '1',
      at('palette.png'),
    ])
    const [f0, f1] = [capture(0), capture(1)]
    captures('a', [f0, f1])
    // Within the tolerance in frame 0, past it in frame 1: the captures differ at two pixels.
    const b0 = Buffer.from(f0)
    b0[(3 * W + 5) * 3] += 4
    const b1 = Buffer.from(f1)
    b1[(6 * W + 9) * 3 + 1] += 60
    captures('b', [b0, b1])
    // Frame 1 with a block painted in a line colour, where a and b agree.
    const c1 = Buffer.from(f1)
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) c1.set([0, 153, 204], (y * W + x) * 3)
    captures('c', [f0, c1])
    encode('a', 'palette.png', 'a.gif')
    encode('b', 'palette.png', 'b.gif')
    encode('c', 'palette.png', 'c.gif')
    encode('a', 'palette.png', 'half.gif', `${W / 2}:${H / 2}`)
    captures('long', [f0, f1, capture(2), capture(3)])
    encode('long', 'palette.png', 'long.gif')
  })
  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true })
  })

  it('reads one as GIF89a, its size, one global table of 256 entries, two images and no local table', () => {
    const read = parseGif(readFileSync(at('a.gif')))
    expect(read).toMatchObject({ version: 'GIF89a', width: W, height: H, images: 2 })
    expect(read.globalTable?.length).toBe(256 * 3)
    expect(read.localTables).toEqual([])
  })

  it('gives two captures that differ one table, and GIF differences only where they differ', async () => {
    const tables = judgeTables(
      { name: 'a.gif', bytes: readFileSync(at('a.gif')) },
      { name: 'b.gif', bytes: readFileSync(at('b.gif')) },
    )
    expect(tables.problems).toEqual([])
    expect(tables.identical).toBe(true)
    const pixels = await compareThroughGifs(at('a'), at('b'), at('a.gif'), at('b.gif'))
    expect(pixels.problems).toEqual([])
    expect(pixels.counts).toEqual({ captures: [2, 2], gifs: [2, 2] })
    expect(pixels.sizes.gifs).toEqual([
      { width: W, height: H },
      { width: W, height: H },
    ])
    expect(pixels.total.captures).toBe(2)
    expect(pixels.total.outside).toBe(0)
    expect(pixels.total.gifs).toBeLessThanOrEqual(2)
  })

  it('finds a GIF recoloured where the captures agree, naming the frame and the pixel', async () => {
    const pixels = await compareThroughGifs(at('a'), at('a'), at('a.gif'), at('c.gif'))
    expect(pixels.total.captures).toBe(0)
    expect(pixels.frames[0].gifs).toBe(0)
    expect(pixels.frames[1].outside).toBeGreaterThan(0)
    expect(pixels.examples[0]).toMatchObject({ frame: 1, x: 0, y: 0 })
    expect(pixels.problems[0]).toMatch(
      /^\d+ pixels the captures agree on differ between the GIFs, in 1 of 2 frames: frame 1, \d+$/,
    )
    expect(pixels.problems[1]).toMatch(/^ {2}frame 1, pixel \(0, 0\): rgb\(/)
  })

  // What the gate refused before engine v0.17.0: a table counted from each
  // capture's own pixels moves with them.
  it('finds the tables differ when each table is counted from its own frames', () => {
    for (const name of ['a', 'b']) {
      ffmpeg([
        '-framerate',
        '30',
        '-i',
        join(at(name), '%06d.png'),
        '-vf',
        'palettegen=stats_mode=diff',
        at(`${name}-counted.png`),
      ])
      encode(name, `${name}-counted.png`, `${name}-counted.gif`)
    }
    const tables = judgeTables(
      { name: 'a.gif', bytes: readFileSync(at('a-counted.gif')) },
      { name: 'b.gif', bytes: readFileSync(at('b-counted.gif')) },
    )
    expect(tables.identical).toBe(false)
    expect(tables.problems).toEqual([
      expect.stringMatching(/^the global colour tables differ, first at entry \d+: rgb\(/),
    ])
  })

  it('says when a GIF holds more frames than the captures, counting every one', async () => {
    const pixels = await compareThroughGifs(at('a'), at('b'), at('a.gif'), at('long.gif'))
    expect(pixels.counts).toEqual({ captures: [2, 2], gifs: [2, 4] })
    expect(pixels.problems).toContain(
      'the captures and the decoded GIFs do not hold the same number of frames: the captures ' +
        '2 and 2, the GIFs 2 and 4; the first 2 were compared',
    )
  })

  it('says the sizes differ for a GIF scaled from its captures, and compares nothing', async () => {
    const pixels = await compareThroughGifs(at('a'), at('b'), at('half.gif'), at('b.gif'))
    expect(pixels.problems).toEqual([
      `the captures and the decoded GIFs are not the same size: the captures ${W}x${H} and ` +
        `${W}x${H}, the GIFs ${W / 2}x${H / 2} and ${W}x${H}; their pixels were not compared`,
    ])
    // Nothing decoded: frames of one size split at another's would be noise.
    expect(pixels.counts).toEqual({ captures: [0, 0], gifs: [0, 0] })
    expect(pixels.frames).toEqual([])
  })
})
