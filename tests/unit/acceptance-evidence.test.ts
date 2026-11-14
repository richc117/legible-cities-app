// The acceptance run's visual evidence (tests/acceptance/evidence.ts), without
// an app: what it keeps, what it asserts and what it only notes. The pictures
// are made here, pixel by pixel; nothing launches Electron. Each test that
// guards one line names its mutation in tests/unit/acceptance-evidence.mutations.json.

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ENLARGED,
  NOT_ENLARGED,
  Evidence,
  THRESHOLDS,
  blankness,
  contactSheet,
  cropAround,
  drawnLarger,
  decodePng,
  difference,
  encodePng,
  enlarged,
  failuresOf,
  judgeBlank,
  judgeChange,
  judgeColour,
  judgeExport,
  judgeMovement,
  judgeTypeface,
  pixelsOfColour,
  redrawnCapture,
  sampleTimes,
  stepResult,
  thresholdFor,
  withDeadline,
  type Box,
  type Clip,
  type Enlarger,
  type Pair,
  type Protocol,
  type Redrawer,
  type Redrawn,
  type Rgb,
  type Shootable,
} from '../acceptance/evidence'

const W = 100
const H = 100

/** A flat picture, with its last `count` pixels set to `paint` (the corner stays the base). */
function picture(
  base: [number, number, number],
  count = 0,
  paint: [number, number, number] = [255, 255, 255],
  size: [number, number] = [W, H],
): Rgb {
  const [width, height] = size
  const data = Buffer.alloc(width * height * 3)
  for (let p = 0; p < width * height; p++) {
    const colour = p >= width * height - count ? paint : base
    data[p * 3] = colour[0]
    data[p * 3 + 1] = colour[1]
    data[p * 3 + 2] = colour[2]
  }
  return { width, height, data }
}

const BG: [number, number, number] = [20, 20, 20]

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lc-evidence-test-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(`${dir}-key`, { recursive: true, force: true })
})

/** A locator that writes the next picture of a queue each time it is shot. */
function camera(...queue: Rgb[]): Shootable & { taken: number } {
  const state = { taken: 0 }
  return Object.assign(state, {
    async screenshot({ path }: { path: string }): Promise<void> {
      const next = queue[Math.min(state.taken, queue.length - 1)]
      state.taken++
      writeFileSync(path, encodePng(next))
    },
  })
}

describe('the pixels', () => {
  it('reads a PNG back as the RGB it was written from, and drops an alpha channel', () => {
    const image = picture(BG, 30, [200, 10, 90])
    const back = decodePng(encodePng(image))
    expect(back.width).toBe(W)
    expect(back.data.equals(image.data)).toBe(true)
  })

  it('counts a difference at the tolerance of 8, never below it', () => {
    const a = picture(BG)
    const within = picture([28, 28, 28])
    const over = picture([29, 20, 20])
    expect(difference(a, within).pixels).toBe(0)
    expect(difference(a, over).pixels).toBe(W * H)
  })

  it('counts the pixels that differ, as a fraction of all of them', () => {
    const d = difference(picture(BG), picture(BG, 250))
    expect(d.pixels).toBe(250)
    expect(d.fraction).toBeCloseTo(0.025, 6)
    expect(d.sameSize).toBe(true)
  })

  it('says two sizes differ in every pixel, and does not throw', () => {
    const d = difference(picture(BG), picture(BG, 0, [0, 0, 0], [50, 100]))
    expect(d.sameSize).toBe(false)
    expect(d.fraction).toBe(1)
  })

  it('counts a colour to the tolerance, in each channel', () => {
    const image = picture(BG, 40, [10, 20, 30])
    expect(pixelsOfColour(image, '#0a141e')).toBe(40)
    expect(pixelsOfColour(image, '#12141e')).toBe(40) // 8 away in one channel
    expect(pixelsOfColour(image, '#13141e')).toBe(0) // 9 away
  })

  it('makes a contact sheet of the frames side by side, scaled to one height', () => {
    const sheet = contactSheet([picture([255, 0, 0]), picture([0, 0, 255])], 20, 4)
    expect(sheet.height).toBe(20)
    expect(sheet.width).toBe(20 + 4 + 20)
    expect([...sheet.data.subarray(0, 3)]).toEqual([255, 0, 0])
    expect([...sheet.data.subarray((sheet.width - 1) * 3, sheet.width * 3)]).toEqual([0, 0, 255])
    expect([...sheet.data.subarray(21 * 3, 22 * 3)]).toEqual([128, 128, 128])
  })
})

describe('blank', () => {
  it('is fewer than 1% of the pixels more than 8 from the corner pixel', () => {
    expect(blankness(picture(BG)).blank).toBe(true)
    expect(blankness(picture(BG, 99)).blank).toBe(true)
    // Exactly 1% is not under it.
    expect(blankness(picture(BG, 100)).blank).toBe(false)
    expect(blankness(picture(BG, 2500)).blank).toBe(false)
  })

  it('ignores pixels within 8 of the corner', () => {
    expect(blankness(picture(BG, 5000, [28, 28, 28])).blank).toBe(true)
  })

  it('fails a picture with nothing in it, only notes one nearly empty, and passes the rest', () => {
    expect(judgeBlank('export', picture(BG)).outcome).toBe('fail')
    expect(judgeBlank('export', picture(BG, 30)).outcome).toBe('note')
    expect(judgeBlank('export', picture(BG, 3000)).outcome).toBe('ok')
  })
})

describe('a changed setting, against the noise', () => {
  const same = { pixels: 0, fraction: 0, sameSize: true }
  const noise = { pixels: 20, fraction: 0.002, sameSize: true }
  const moved = { pixels: 3000, fraction: 0.3, sameSize: true }

  it('fails when nothing changed, from a pair that stood still', () => {
    expect(judgeChange('theme', same, same, null).outcome).toBe('fail')
  })

  it('only notes that nothing changed when the map was not steady', () => {
    expect(judgeChange('theme', same, same, null, false).outcome).toBe('note')
    expect(judgeChange('theme', same, moved, 0.9, false).outcome).toBe('note')
  })

  it('notes, and does not fail, a change no more than the noise', () => {
    expect(judgeChange('theme', noise, noise, null).outcome).toBe('note')
    expect(judgeChange('theme', noise, noise, null).said).toContain('no more than the noise')
  })

  it('only notes the number while no threshold is set', () => {
    const check = judgeChange('theme', noise, moved, null)
    expect(check.outcome).toBe('note')
    expect(check.value).toBe(0.3)
    expect(check.threshold).toBeNull()
    expect(check.said).toContain('no threshold is set yet')
  })

  it('fails under a threshold once one is set, and is ok over it', () => {
    expect(judgeChange('theme', noise, moved, 0.5).outcome).toBe('fail')
    expect(judgeChange('theme', noise, moved, 0.1).outcome).toBe('ok')
  })

  it('notes that two shots at the same settings were of different sizes', () => {
    expect(judgeChange('theme', { ...noise, sameSize: false }, moved, null).outcome).toBe('note')
  })

  it('fails when the trains did not move in a second, and notes when they did', () => {
    expect(judgeMovement('map-moves', same, null).outcome).toBe('fail')
    expect(judgeMovement('map-moves', moved, null).outcome).toBe('note')
    expect(judgeMovement('map-moves', moved, 0.9).outcome).toBe('fail')
  })

  it('wants a new colour to rise from none, and fails where it is not there', () => {
    expect(judgeColour('line-colour', '#112233', 0, 0, 1000, null).outcome).toBe('fail')
    expect(judgeColour('line-colour', '#112233', 40, 40, 1000, null).outcome).toBe('fail')
    expect(judgeColour('line-colour', '#112233', 0, 40, 1000, null).outcome).toBe('note')
    expect(judgeColour('line-colour', '#112233', 0, 40, 1000, 0.5).outcome).toBe('fail')
  })

  it('wants the face loaded, and only notes a label that did not measure differently', () => {
    expect(judgeTypeface('t', 'Inter', false, 50, 60).outcome).toBe('fail')
    expect(judgeTypeface('t', 'Inter', true, 50, 50).outcome).toBe('note')
    expect(judgeTypeface('t', 'Inter', true, null, 50).outcome).toBe('note')
    expect(judgeTypeface('t', 'Inter', true, 0, 50).outcome).toBe('note')
    expect(judgeTypeface('t', 'Inter', true, 50, 56).outcome).toBe('ok')
  })

  it('wants an export with nothing-drawn frames failed and a first frame unlike the last', () => {
    const a = picture(BG, 3000)
    const b = picture(BG, 3000, [255, 0, 0])
    const times = [0, 1, 2]
    expect(judgeExport('reel', { frames: [a, picture(BG), b], times }, null).outcome).toBe('fail')
    expect(judgeExport('reel', { frames: [a, a], times: [0, 1] }, null).outcome).toBe('fail')
    expect(judgeExport('reel', { frames: [a, b], times: [0, 1] }, null).outcome).toBe('note')
  })

  it('does not judge a frame inside the opening for being empty, and only notes a nearly empty one', () => {
    const a = picture(BG, 3000)
    const b = picture(BG, 3000, [255, 0, 0])
    const frames = [picture(BG), a, picture(BG, 30), b]
    const times = [0, 1, 9, 10]
    expect(judgeExport('gif', { frames, times }, null, 8).outcome).toBe('note')
    expect(judgeExport('gif', { frames, times }, null, 0).outcome).toBe('fail')
  })
})

describe('the thresholds', () => {
  it('are a fraction or not yet measured, for each of the two systems', () => {
    for (const row of Object.values(THRESHOLDS))
      for (const system of ['darwin', 'win32'] as const) {
        const value = row[system]
        expect(value === null || (value > 0 && value < 1)).toBe(true)
      }
  })

  it('are none for a check that has no row, and for a system that is not measured', () => {
    expect(thresholdFor('no-such-check')).toBeNull()
    expect(thresholdFor('theme', 'linux')).toBeNull()
  })

  it('sample an export at its start, between and just short of its end', () => {
    expect(sampleTimes(10)).toEqual([0, 2.5, 5, 7.5, 9.75])
    expect(sampleTimes(0.1)).toEqual([0, 0, 0, 0, 0])
  })
})

describe('the manifest', () => {
  const init = {
    id: '8-theme',
    step: 8,
    row: 'Not automated: whether the page looks sepia.',
    question: 'Is the second picture in sepia?',
    expected: ['Sepia'],
  }

  /** A pair whose A shots were taken, as `begin` takes them, without an app. */
  async function pairOf(
    evidence: Evidence,
    a1: Rgb,
    a2: Rgb,
    control: string | null = null,
  ): Promise<Pair> {
    const target = camera(a1)
    const first = await evidence.settled('8-theme-a1', camera(a1), async () => undefined)
    const second = await evidence.settled('8-theme-a2', camera(a2), async () => undefined)
    // A control's own shots: each of its own, as `begin` takes them.
    const controlShots: string[] = []
    if (control !== null)
      for (const k of [1, 2, 3])
        controlShots.push(
          (
            await evidence.settled(
              `${control}-c${k}`,
              camera(picture(BG, 10 * k + 1)),
              async () => undefined,
            )
          ).path,
        )
    return {
      init,
      name: 'theme',
      target,
      a1: first.path,
      a2: second.path,
      steady: true,
      control,
      controlShots,
    }
  }

  it('keeps a shot as <id>.png, and throws for one that was not written', async () => {
    const evidence = new Evidence(dir)
    const path = await evidence.shot('4-map', camera(picture(BG, 10)))
    expect(path).toBe(join(dir, '.work', '4-map.png'))
    expect(evidence.open(path).width).toBe(W)
    const none: Shootable = { screenshot: async () => undefined }
    await expect(evidence.shot('4-missing', none)).rejects.toThrow(/was not written/)
  })

  it('settles on the first two shots that agree, and says when none did', async () => {
    const evidence = new Evidence(dir)
    const settling = await evidence.settled(
      '8-x',
      camera(picture(BG, 10), picture(BG, 500), picture(BG, 500)),
      async () => undefined,
    )
    expect(settling.settled).toBe(true)
    const never = camera(...Array.from({ length: 12 }, (_, k) => picture(BG, 100 * (k + 1))))
    expect((await evidence.settled('8-y', never, async () => undefined)).settled).toBe(false)
  })

  it('writes the row, the images, the question and the expected text, and no check', async () => {
    const evidence = new Evidence(dir)
    const pair = await pairOf(evidence, picture(BG, 10), picture(BG, 10))
    pair.target = camera(picture(BG, 4000, [200, 160, 100]))
    const check = await evidence.finish(pair, { wait: async () => undefined })
    expect(check.outcome).toBe('note')
    const manifest = JSON.parse(readFileSync(join(dir, 'evidence.json'), 'utf8')) as {
      entries: Array<Record<string, unknown>>
    }
    expect(manifest.entries).toHaveLength(1)
    expect(manifest.entries[0]).toMatchObject({
      id: '8-theme',
      step: 8,
      row: init.row,
      images: [
        expect.stringMatching(/^8-[0-9a-f]{10}\.png$/),
        expect.any(String),
        expect.any(String),
      ],
      question: init.question,
      expected: ['Sepia'],
    })
    expect(manifest.entries[0]).not.toHaveProperty('check')
    // The check is the record's: kept in memory, and said in the step's row.
    expect(evidence.entries[0].check).toMatchObject({
      name: 'theme',
      threshold: null,
      outcome: 'note',
    })
    expect(evidence.entries[0].check?.value).toBeGreaterThan(0.3)
  })

  it('fails a change that did not happen, with its images kept', async () => {
    const evidence = new Evidence(dir)
    const pair = await pairOf(evidence, picture(BG, 10), picture(BG, 10))
    pair.target = camera(picture(BG, 10))
    const check = await evidence.finish(pair, { wait: async () => undefined })
    expect(check.outcome).toBe('fail')
    expect(evidence.failures(8)).toHaveLength(1)
    expect(evidence.failures(9)).toEqual([])
  })

  it('asks the control as if the settings had changed: the same two shots, shaped as a real entry', async () => {
    const evidence = new Evidence(dir, () => false)
    const pair = await pairOf(evidence, picture(BG, 10), picture(BG, 10), '8-ground')
    pair.target = camera(picture(BG, 4000))
    await evidence.finish(pair, { wait: async () => undefined })
    const [real, control] = evidence.entries
    expect([real.id, real.control, control.id, control.control]).toEqual([
      '8-theme',
      false,
      '8-ground',
      true,
    ])
    expect(control.question).toBe(init.question)
    // Nothing the reviewer reads tells them apart: the same keys, the same
    // number of pictures, names of the same pattern, none of them shared.
    const manifest = readFileSync(join(dir, 'evidence.json'), 'utf8')
    const listed = (JSON.parse(manifest) as { entries: Array<Record<string, unknown>> }).entries
    expect(listed).toHaveLength(2)
    const [a, b] = listed
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort())
    expect((a.images as string[]).length).toBe((b.images as string[]).length)
    for (const name of [...(a.images as string[]), ...(b.images as string[])])
      expect(name).toMatch(/^8-[0-9a-f]{10}\.png$/)
    expect(manifest).not.toMatch(/control|recheck/i)
    // No machine check, value or outcome: those are the record's, read after the verdicts.
    expect(manifest).not.toMatch(/"check"|"value"|"outcome"|"threshold"|measured/i)
    expect(Object.keys(a)).not.toContain('check')
    // And the key is not among the evidence.
    expect(readdirSync(dir).filter((n) => n.includes('key'))).toEqual([])
    // Only the key file says which is which.
    const key = JSON.parse(readFileSync(join(`${dir}-key`, 'evidence-key.json'), 'utf8')) as {
      controls: string[]
    }
    expect(key.controls).toEqual(['8-ground'])
  })

  /** The kept pictures: the folder's PNGs, not the working folder's. */
  const keptFiles = (): string[] => readdirSync(dir).filter((n) => n.endsWith('.png'))

  it('copies no file twice: each file named is kept once, under a name of its own', async () => {
    const evidence = new Evidence(dir)
    const pair = await pairOf(evidence, picture(BG, 10), picture(BG, 20), '8-ground')
    pair.target = camera(picture(BG, 4000))
    await evidence.finish(pair, { wait: async () => undefined })
    // Three shots of the pair and three of its twin: six working files, six kept.
    expect(keptFiles()).toHaveLength(6)
    const named = evidence.entries.flatMap((e) => e.images)
    expect(new Set(named).size).toBe(6)
  })

  it('keeps a picture named by two entries once, under one name', () => {
    const evidence = new Evidence(dir)
    evidence.keepFrames(
      { ...init, id: '12-gif', step: 12 },
      { frames: [picture(BG, 3000), picture(BG, 3000, [255, 0, 0])], times: [0, 1] },
      'gif',
    )
    const names = ['sheet', 'first', 'last'].map((n) => evidence.pathOf(`12-gif-${n}.png`))
    evidence.keep({ ...init, id: '12-gif-caption', step: 12 }, names)
    expect(evidence.entries[1].images).toEqual(evidence.entries[0].images)
    expect(keptFiles()).toHaveLength(3)
  })

  it('names the kept pictures at random, so no name is derived from a working one', async () => {
    const run = async (where: string): Promise<{ kept: string[]; key: Record<string, string> }> => {
      mkdirSync(where)
      const evidence = new Evidence(where)
      const pair = await pairOf(evidence, picture(BG, 10), picture(BG, 20))
      pair.target = camera(picture(BG, 4000))
      await evidence.finish(pair, { wait: async () => undefined })
      const key = JSON.parse(readFileSync(join(`${where}-key`, 'evidence-key.json'), 'utf8')) as {
        pictures: Record<string, string>
      }
      return { kept: evidence.entries[0].images, key: key.pictures }
    }
    const first = await run(join(dir, 'one'))
    const second = await run(join(dir, 'two'))
    // The same working names, other kept names.
    expect(first.kept.some((n) => second.kept.includes(n))).toBe(false)
    for (const name of first.kept) {
      expect(name).toMatch(/^8-[0-9a-f]{10}\.png$/)
      // Not a hash of the working name, however it is hashed.
      for (const working of Object.values(first.key))
        for (const algorithm of ['sha1', 'sha256', 'md5'])
          expect(name).not.toContain(
            createHash(algorithm).update(working).digest('hex').slice(0, 10),
          )
    }
    // And the key gives each kept name back to its working name.
    expect(first.kept.map((n) => first.key[n])).toEqual([
      '8-theme-a1.png',
      '8-theme-a2.png',
      '8-theme-b.png',
    ])
  })

  it('draws which of the two ids the real entry takes, and the key says which is the control', async () => {
    for (const swap of [false, true]) {
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir)
      const evidence = new Evidence(dir, () => swap)
      const pair = await pairOf(evidence, picture(BG, 10), picture(BG, 10), '8-ground')
      pair.target = camera(picture(BG, 4000))
      await evidence.finish(pair, { wait: async () => undefined })
      const [real, twin] = evidence.entries
      expect([real.control, twin.control]).toEqual([false, true])
      expect([real.id, twin.id]).toEqual(swap ? ['8-ground', '8-theme'] : ['8-theme', '8-ground'])
      const key = JSON.parse(readFileSync(join(`${dir}-key`, 'evidence-key.json'), 'utf8')) as {
        controls: string[]
      }
      expect(key.controls).toEqual([twin.id])
    }
  })

  it('looks again before it judges a B that equals A1, so a slow redraw is not a failure', async () => {
    const evidence = new Evidence(dir)
    const pair = await pairOf(evidence, picture(BG, 10), picture(BG, 10))
    const same = picture(BG, 10)
    pair.target = camera(same, same, same, same, picture(BG, 4000), picture(BG, 4000))
    const check = await evidence.finish(pair, { wait: async () => undefined })
    expect(check.outcome).toBe('note')
    expect(evidence.failures(8)).toEqual([])
  })

  it('orders the manifest by step and id, so position does not give a control away', async () => {
    for (const swap of [false, true]) {
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir)
      const evidence = new Evidence(dir, () => swap)
      // Added in the reverse of the order they must come out in, across two
      // steps and several ids, so only sorting can put them right.
      for (const id of ['9-zeta', '9-alpha', '8-zeta', '8-mid'])
        evidence.keep({ ...init, id, step: Number(id[0]) }, [])
      const pair = await pairOf(evidence, picture(BG, 10), picture(BG, 10), '8-aaa')
      pair.target = camera(picture(BG, 4000))
      await evidence.finish(pair, { wait: async () => undefined })
      const ids = (
        JSON.parse(readFileSync(join(dir, 'evidence.json'), 'utf8')) as {
          entries: { id: string }[]
        }
      ).entries.map((e) => e.id)
      expect(ids).toEqual(['8-aaa', '8-mid', '8-theme', '8-zeta', '9-alpha', '9-zeta'])
    }
  })

  it('only notes that nothing changed for a setting the picture need not show', async () => {
    const evidence = new Evidence(dir)
    const pair = await pairOf(evidence, picture(BG, 10), picture(BG, 10))
    pair.noteOnly = true
    pair.target = camera(picture(BG, 10))
    const check = await evidence.finish(pair, { wait: async () => undefined })
    expect(check.outcome).toBe('note')
    expect(check.said).toContain('need not change')
    expect(evidence.failures(8)).toEqual([])
  })

  it('notes, never fails, what was measured of a map that was not steady', async () => {
    const evidence = new Evidence(dir)
    const pair = await pairOf(evidence, picture(BG, 10), picture(BG, 10))
    pair.steady = false
    pair.target = camera(picture(BG, 10))
    const check = await evidence.finish(pair, { wait: async () => undefined })
    expect(check.outcome).toBe('note')
    expect(check.said).toContain('the map was not steady')
    expect(evidence.failures(8)).toEqual([])
  })

  it('keeps an export as a sheet and its ends, and fails a blank frame', () => {
    const evidence = new Evidence(dir)
    const a = picture(BG, 3000)
    const b = picture(BG, 3000, [255, 0, 0])
    const good = evidence.keepFrames(
      { ...init, id: '11-reel', step: 11 },
      { frames: [a, b], times: [0, 1] },
      'reel',
    )
    expect(good.outcome).toBe('note')
    expect(evidence.entries[0].images).toHaveLength(3)
    for (const name of evidence.entries[0].images) expect(name).toMatch(/^11-[0-9a-f]{10}\.png$/)
    expect(
      evidence.keepFrames(
        { ...init, id: '12-gif', step: 12 },
        { frames: [a, picture(BG)], times: [0, 1] },
        'gif',
      ).outcome,
    ).toBe('fail')
  })

  it('says, for the record, what was kept and what was measured', async () => {
    const evidence = new Evidence(dir)
    expect(evidence.summary(8)).toBe('')
    const pair = await pairOf(evidence, picture(BG, 10), picture(BG, 10))
    pair.target = camera(picture(BG, 4000))
    await evidence.finish(pair, { wait: async () => undefined })
    const said = evidence.summary(8)
    expect(said).toMatch(
      /^Evidence kept: 8-[0-9a-f]{10}\.png, 8-[0-9a-f]{10}\.png, 8-[0-9a-f]{10}\.png\./,
    )
    expect(said).toContain('Measured: theme:')
    expect(evidence.summary(9)).toBe('')
  })

  it('names the step’s pictures, controls included, as one sorted list, and measures only the real', async () => {
    const evidence = new Evidence(dir)
    const pair = await pairOf(evidence, picture(BG, 10), picture(BG, 10), '8-ground')
    pair.target = camera(picture(BG, 4000))
    await evidence.finish(pair, { wait: async () => undefined })
    const said = evidence.summary(8)
    const names = (/^Evidence kept: (.*?)\. Measured:/.exec(said) as RegExpExecArray)[1].split(', ')
    expect(names).toHaveLength(6)
    expect(names).toEqual([...names].sort())
    expect(said.match(/theme:/g)).toHaveLength(1)
  })
})

describe('an enlarged picture of the map', () => {
  // The notebook's frame as a runner draws it, about 740 by 315 CSS pixels,
  // where a station's name is about 2.5 pixels tall.
  const frame = { width: 740, height: 315 }
  const centre = (clip: Clip): [number, number] => [
    clip.x + clip.width / 2,
    clip.y + clip.height / 2,
  ]

  it('sets a name about 18 pixels tall, within the scales allowed', () => {
    expect(cropAround(frame, [], 2.5).scale).toBe(7)
    expect(cropAround(frame, [], 100).scale).toBe(ENLARGED.minScale)
    expect(cropAround(frame, [], 0.5).scale).toBe(ENLARGED.maxScale)
    expect(cropAround(frame, [], null).scale).toBe(ENLARGED.fallbackScale)
    expect(cropAround(frame, [], 0).scale).toBe(ENLARGED.fallbackScale)
  })

  it('is the frame’s shape at one over the scale, so drawn larger it fills the frame, centred on the marks', () => {
    const marks: Box[] = [
      { x: 290, y: 90, width: 20, height: 4 },
      { x: 250, y: 100, width: 30, height: 6 },
    ]
    const clip = cropAround(frame, marks, 2.5)
    expect(clip.scale).toBe(7)
    expect(clip.width * clip.scale).toBeCloseTo(frame.width)
    expect(clip.height * clip.scale).toBeCloseTo(frame.height)
    expect(centre(clip)[0]).toBeCloseTo(280)
    expect(centre(clip)[1]).toBeCloseTo(98)
  })

  it('centres on the middle of the frame when no mark was found', () => {
    const clip = cropAround(frame, [], null)
    expect(centre(clip)[0]).toBeCloseTo(370)
    expect(centre(clip)[1]).toBeCloseTo(157.5)
  })

  it('stays inside the frame, moved in from an edge it would run past', () => {
    const corner = cropAround(frame, [{ x: 0, y: 0, width: 4, height: 3 }], 2.5)
    expect([corner.x, corner.y]).toEqual([0, 0])
    const far = cropAround(frame, [{ x: 730, y: 310, width: 10, height: 5 }], 2.5)
    expect(far.x + far.width).toBeCloseTo(frame.width)
    expect(far.y + far.height).toBeCloseTo(frame.height)
  })

  it('grows to hold every mark with room round it, at a smaller scale, never below 1', () => {
    const wide = cropAround(
      frame,
      [
        { x: 100, y: 100, width: 10, height: 4 },
        { x: 500, y: 120, width: 10, height: 4 },
      ],
      2.5,
    )
    expect(wide.x).toBeLessThanOrEqual(100 - ENLARGED.pad + 1e-9)
    expect(wide.x + wide.width).toBeGreaterThanOrEqual(510 + ENLARGED.pad - 1e-9)
    expect(wide.scale).toBeLessThan(7)
    const all = cropAround(frame, [{ x: -50, y: -50, width: 900, height: 500 }], 2.5)
    expect([all.x, all.y, all.width, all.height, all.scale]).toEqual([
      0,
      0,
      frame.width,
      frame.height,
      1,
    ])
  })

  /** A window whose frame is at `at`, and the parts asked of it. */
  function windowOf(found: string[], at: Box | null = { x: 20, y: 400, width: 740, height: 315 }) {
    const asked: Clip[] = []
    let reads = 0
    const enlarger: Enlarger = {
      frame: async () => at,
      marks: async () => {
        reads++
        return {
          boxes: found.map((_, k) => ({ x: 200 + 40 * k, y: 100, width: 30, height: 4 })),
          em: found.length > 0 ? 2.5 : null,
          found,
        }
      },
      capture: async (crop) => {
        asked.push(crop)
        return encodePng(picture(BG, 10, [255, 255, 255], [8, 4]))
      },
      said: () => 'device scale 7.00: read 7',
    }
    return { enlarger, asked, reads: () => reads }
  }

  it('keeps one part for every picture, and says what it is centred on and what was read', async () => {
    const evidence = new Evidence(dir)
    const window = windowOf(['Union Station', '7th Street / Metro Center'])
    const part = enlarged(window.enlarger)
    expect(part.around()).toBe('')
    const path = await evidence.shot('8-x-a', part)
    expect(evidence.open(path).width).toBe(8)
    await evidence.shot('8-x-b', part)
    expect(window.reads()).toBe(1)
    const [a, b] = window.asked
    expect(b).toEqual(a)
    expect(part.around()).toBe('Union Station and 7th Street / Metro Center')
    expect(part.said()).toBe('device scale 7.00: read 7')
  })

  it('says when no named station was found, and throws with no frame', async () => {
    const evidence = new Evidence(dir)
    const none = enlarged(windowOf([]).enlarger)
    await evidence.shot('8-y', none)
    expect(none.around()).toMatch(/^the middle of the map/)
    const gone = enlarged(windowOf(['Union Station'], null).enlarger)
    await expect(evidence.shot('8-w', gone)).rejects.toThrow(/has no box/)
  })
})

describe('a call given a deadline', () => {
  it('gives what the call answered, and leaves no timer behind', async () => {
    vi.useFakeTimers()
    try {
      await expect(withDeadline(Promise.resolve(7), 30_000, 'late')).resolves.toBe(7)
      await expect(
        withDeadline(Promise.reject(new Error('refused')), 30_000, 'late'),
      ).rejects.toThrow('refused')
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects with its sentence once a call that never answers runs out of time', async () => {
    const never = new Promise<number>(() => undefined)
    await expect(
      withDeadline(never, 20, 'the enlarged capture did not answer in 30 s'),
    ).rejects.toThrow('the enlarged capture did not answer in 30 s')
  })
})

describe('an enlarged picture drawn again at a higher scale', () => {
  // A part of a 740 by 315 frame at a scale of 7, and where the frame is.
  const crop: Clip = { x: 280, y: 105, width: 740 / 7, height: 45, scale: 7 }
  const box: Box = { x: 20, y: 400, width: 740, height: 315 }

  /**
   * A window that answers as told: the frame's devicePixelRatio during the
   * override, whether the frame has a session of its own, what the drawing
   * measures under a transform and once put back, and how each call goes.
   */
  function windowOf(
    options: {
      frameRatio?: number
      own?: boolean
      svg?: number | null
      back?: number | null
      boxes?: (read: number) => Box
      draws?: (read: number) => number
      capture?: () => Promise<unknown>
    } = {},
  ) {
    const calls: string[] = []
    const clips: unknown[] = []
    const origins: { x: number; y: number }[] = []
    let ratio = 1
    let boxReads = 0
    let drawReads = 0
    const protocolOf = (who: string): Protocol => ({
      send: async (method, params) => {
        calls.push(`${who} ${method}`)
        if (method === 'Emulation.setDeviceMetricsOverride' && who === 'window')
          ratio = Number(params?.deviceScaleFactor)
        if (method === 'Emulation.clearDeviceMetricsOverride' && who === 'window') ratio = 1
        if (method === 'Target.getTargets') return { targetInfos: [{ type: 'iframe' }] }
        if (method === 'Page.captureScreenshot') {
          clips.push(params?.clip)
          return options.capture === undefined ? { data: 'AAEC' } : options.capture()
        }
        return {}
      },
    })
    const redrawer: Redrawer = {
      window: protocolOf('window'),
      frameSession: async () => (options.own === true ? protocolOf('frame') : null),
      iframeTargets: async () => 1,
      frame: async () => (options.boxes === undefined ? box : options.boxes(boxReads++)),
      repaint: async () => undefined,
      ratios: async () => ({
        window: ratio,
        frame: ratio === 1 ? 1 : (options.frameRatio ?? ratio),
      }),
      draws: async () => (options.draws === undefined ? 40 : options.draws(drawReads++)),
      scaleSvg: async (_scale, origin) => {
        calls.push('frame scaleSvg')
        origins.push(origin)
        return options.svg === undefined ? 7 : options.svg
      },
      restoreSvg: async () => {
        calls.push('frame restoreSvg')
        return options.back === undefined ? 1 : options.back
      },
    }
    return { redrawer, calls, clips, origins }
  }
  const fresh = (): Redrawn => ({ route: null, said: [] })

  it('takes the device scale where the frame draws at it: override, capture at 1, clear', async () => {
    const w = windowOf()
    const state = fresh()
    const png = await redrawnCapture(w.redrawer, crop, state)
    expect([...png]).toEqual([0, 1, 2])
    expect(w.calls).toEqual([
      'window Emulation.setDeviceMetricsOverride',
      'window Page.captureScreenshot',
      'window Emulation.clearDeviceMetricsOverride',
    ])
    expect(w.clips[0]).toEqual({ x: 300, y: 505, width: 740 / 7, height: 45, scale: 1 })
    expect(state.route).toBe('device scale')
    expect(state.said[0]).toMatch(/the map frame's 7; the frame shares the window’s target/)
  })

  it('never keeps a frame painted at 1: it scales the page’s drawing instead, and puts it back', async () => {
    const w = windowOf({ frameRatio: 1, own: true })
    const state = fresh()
    await redrawnCapture(w.redrawer, crop, state)
    expect(w.calls).toEqual([
      'window Emulation.setDeviceMetricsOverride',
      'frame Emulation.setDeviceMetricsOverride',
      'window Emulation.clearDeviceMetricsOverride',
      'frame Emulation.clearDeviceMetricsOverride',
      'frame scaleSvg',
      'window Page.captureScreenshot',
      'frame restoreSvg',
    ])
    expect(w.clips[0]).toEqual({ ...box, scale: 1 })
    // The point that maps the part onto the whole frame.
    expect(w.origins[0].x).toBeCloseTo((7 * 280) / 6)
    expect(w.origins[0].y).toBeCloseTo((7 * 105) / 6)
    expect(state.route).toBe('SVG transform')
    expect(state.said[0]).toMatch(/the map frame's 1; the frame is a target of its own/)
    // And the next picture goes the same way, without the override.
    w.calls.length = 0
    await redrawnCapture(w.redrawer, crop, state)
    expect(w.calls[0]).toBe('frame scaleSvg')
  })

  it('refuses the picture where neither route drew the map larger', async () => {
    const w = windowOf({ frameRatio: 1, svg: 1 })
    const promise = redrawnCapture(w.redrawer, crop, fresh())
    await expect(promise).rejects.toThrow(NOT_ENLARGED)
    // And says what both routes read, the device scale's included.
    await expect(
      redrawnCapture(windowOf({ frameRatio: 1, svg: 1 }).redrawer, crop, fresh()),
    ).rejects.toThrow(
      /device scale 7\.00: the interface's devicePixelRatio read 7 and the map frame's 1;.*the browser lists 1 iframe targets; SVG transform 7\.00: the page's drawing measured 1 times its size/,
    )
    expect(w.calls).not.toContain('window Page.captureScreenshot')
    expect(w.calls.at(-1)).toBe('frame restoreSvg')
    expect(drawnLarger(7, 7.03)).toBe(true)
    expect(drawnLarger(7, 1)).toBe(false)
    expect(drawnLarger(7, null)).toBe(false)
  })

  it('refuses a device-scale picture once that route stops drawing larger, never switching mid-pair', async () => {
    const w = windowOf({ frameRatio: 1 })
    const state: Redrawn = { route: 'device scale', said: [] }
    await expect(redrawnCapture(w.redrawer, crop, state)).rejects.toThrow(NOT_ENLARGED)
    expect(w.calls).not.toContain('frame scaleSvg')
  })

  it('refuses a frame that moved, a drawing not put back, or a page that drew meanwhile', async () => {
    const moved = windowOf({ boxes: (read) => ({ ...box, y: box.y + (read === 1 ? 3 : 0) }) })
    await expect(redrawnCapture(moved.redrawer, crop, fresh())).rejects.toThrow(
      /frame moved at the higher scale/,
    )
    expect(moved.calls.at(-1)).toBe('window Emulation.clearDeviceMetricsOverride')

    const stuck = windowOf({ frameRatio: 1, back: 7 })
    await expect(redrawnCapture(stuck.redrawer, crop, fresh())).rejects.toThrow(/not put back/)

    const drew = windowOf({ frameRatio: 1, draws: (read) => 40 + read })
    await expect(redrawnCapture(drew.redrawer, crop, fresh())).rejects.toThrow(/page drew/)
  })

  it('says so when a picture failed and the drawing was not put back either', async () => {
    const failing = (): Promise<unknown> => Promise.reject(new Error('target closed'))
    const stuck = windowOf({ frameRatio: 1, back: 7, capture: failing })
    await expect(redrawnCapture(stuck.redrawer, crop, fresh())).rejects.toThrow(
      "target closed, and the page's drawing was not put back (it measured 7)",
    )
    const undone = windowOf({ frameRatio: 1, capture: failing })
    const error = await redrawnCapture(undone.redrawer, crop, fresh()).catch((e: Error) => e)
    expect((error as Error).message).toBe('target closed')
    expect(undone.calls.at(-1)).toBe('frame restoreSvg')
  })

  it('clears the override when the capture fails, and gives up on a call that never answers', async () => {
    const failing = windowOf({
      capture: async () => {
        throw new Error('target closed')
      },
    })
    await expect(redrawnCapture(failing.redrawer, crop, fresh())).rejects.toThrow('target closed')
    expect(failing.calls.at(-1)).toBe('window Emulation.clearDeviceMetricsOverride')

    const silent = windowOf({ capture: () => new Promise(() => undefined) })
    await expect(redrawnCapture(silent.redrawer, crop, fresh(), 20)).rejects.toThrow(
      'the enlarged capture did not answer in 0.02 s',
    )
    expect(silent.calls.at(-1)).toBe('window Emulation.clearDeviceMetricsOverride')
  })
})

describe('what evidence does to a step', () => {
  const entry = (outcome: 'ok' | 'note' | 'fail', step = 8) => ({
    id: `${step}-x`,
    step,
    row: 'Not automated: whether it looks right.',
    question: 'q',
    images: [],
    expected: [],
    control: false,
    check: { name: 'c', value: 0.5, unit: 'u', threshold: null, outcome, said: 'said' },
  })

  it('records only a failed check as a problem, of its own step', () => {
    const entries = [entry('ok'), entry('note'), entry('fail'), entry('fail', 9)]
    expect(failuresOf(entries, 8)).toHaveLength(1)
    expect(failuresOf([entry('ok'), entry('note')], 8)).toEqual([])
  })

  it('leaves a step that is part not automated so, whatever the checks found', () => {
    const none = failuresOf([entry('ok'), entry('note')], 8)
    expect(stepResult({ failed: none.length > 0, unchecked: 0, unautomated: 2 })).toBe(
      'pass, part not automated',
    )
    expect(stepResult({ failed: false, unchecked: 1, unautomated: 2 })).toBe(
      'pass, part not checked',
    )
    expect(stepResult({ failed: false, unchecked: 0, unautomated: 0 })).toBe('pass')
    expect(stepResult({ failed: true, unchecked: 0, unautomated: 2 })).toBe('fail')
  })
})
