// The acceptance run's visual evidence (tests/acceptance/evidence.ts), without
// an app: what it keeps, what it asserts and what it only notes. The pictures
// are made here, pixel by pixel; nothing launches Electron. Each test that
// guards one line names its mutation in tests/unit/acceptance-evidence.mutations.json.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  Evidence,
  THRESHOLDS,
  blankness,
  contactSheet,
  decodePng,
  difference,
  encodePng,
  failuresOf,
  judgeBlank,
  judgeChange,
  judgeColour,
  judgeExport,
  judgeMovement,
  judgeTypeface,
  pixelsOfColour,
  sampleTimes,
  stepResult,
  thresholdFor,
  type Pair,
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
afterEach(() => rmSync(dir, { recursive: true, force: true }))

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
    return {
      init,
      name: 'theme',
      target,
      a1: first.path,
      a2: second.path,
      steady: true,
      control,
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

  it('writes the row, the images, the question, the expected text and the check', async () => {
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
      check: { name: 'theme', threshold: null, outcome: 'note' },
    })
    expect((manifest.entries[0].check as { value: number }).value).toBeGreaterThan(0.3)
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
    const evidence = new Evidence(dir)
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
    expect(Object.keys(a.check as object).sort()).toEqual(Object.keys(b.check as object).sort())
    expect(manifest).not.toMatch(/control|recheck/i)
    // Only the key file says which is which.
    expect(JSON.parse(readFileSync(join(dir, 'evidence-key.json'), 'utf8'))).toEqual({
      controls: ['8-ground'],
    })
  })

  it('orders the manifest by step and id, so position does not give a control away', async () => {
    const evidence = new Evidence(dir)
    const pair = await pairOf(evidence, picture(BG, 10), picture(BG, 10), '8-aaa')
    pair.target = camera(picture(BG, 4000))
    await evidence.finish(pair, { wait: async () => undefined })
    const ids = (
      JSON.parse(readFileSync(join(dir, 'evidence.json'), 'utf8')) as { entries: { id: string }[] }
    ).entries.map((e) => e.id)
    expect(ids).toEqual(['8-aaa', '8-theme'])
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
