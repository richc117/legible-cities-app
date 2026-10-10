// The capture's opening (issue 392, spec 035 FR-007 and FR-008), asserted
// without Electron by recording every call the capture makes of the page.
//
// Every capture waits for the page's settle, which answers a promise since
// engine v0.15.0 (resolved once the map's face has loaded), and a page whose
// settle answers nothing still works. Apart from that one deliberate change
// a job with neither flag makes exactly the calls it made before the
// capture could drive a title card or a draw-in: every script word for word
// and every protocol command with its parameters, held to a transcript
// taken from the capture before the opening and taken again for the awaited
// settle alone (`capture-transcript.json`). A job with a flag makes the
// engine recorder's calls in the engine recorder's order (`bin/_record.js`
// at v0.15.0): it puts the draw-in at 0 after the settle when any beat draws
// in; puts the card up or takes it down at every beat's start when any beat
// has one; and on every frame of a draw-in steps the clock first and then
// draws the network to `i / (n - 1)`.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CaptureError,
  runCapture,
  SETTLE_AWAITED,
  validateCaptureJob,
} from '../../src/main/capture'
import type { Beat, CaptureJob } from '../../src/shared/capture'
import { named, RecordingPage, type Recorded } from '../support/recordingPage'

const TRANSCRIPT = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/capture-transcript.json'), 'utf8'),
) as { jobs: { name: string; job: CaptureJob; calls: Recorded[] }[] }

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const frames = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-opening-capture-'))
  dirs.push(dir)
  return join(dir, 'frames')
}

const capture = async (job: CaptureJob, page = new RecordingPage()): Promise<RecordingPage> => {
  await runCapture(page, job, { frames: frames(), wait: () => Promise.resolve() })
  return page
}

const URL = 'app://local/projects/p1/stand-in.html?present=1'
const beat = (over: Partial<Beat> & { secs: number }): Beat => ({
  view: null,
  labels: null,
  at: null,
  speed: null,
  sweep: false,
  hours: null,
  lo: null,
  hi: null,
  tween: null,
  ...over,
})
/** A job at 4 frames a second: a beat of a second is four frames. */
const job = (beats: Beat[]): CaptureJob => ({
  url: URL,
  width: 540,
  height: 960,
  scale: 2,
  fps: 4,
  settle: 300,
  beats,
})

const CARD = beat({ secs: 0.5, view: 'map', at: 8 * 3600, speed: 0, tween: 0, card: true })
const DRAW = beat({ secs: 1, view: 'map', at: 8 * 3600, speed: 0, tween: 0, draw_in: true })
const FIRST = beat({ secs: 0.5, view: 'map', at: 8 * 3600, speed: 120, tween: 0 })
const NEXT = beat({ secs: 0.5, view: 'linear' })

/** The named calls from the settle on, which is where an opening's calls are. */
const fromSettle = (page: RecordingPage): string[] => {
  const names = page.calls.map(named)
  return names.slice(names.findIndex((n) => n.startsWith('settle')))
}

describe('a job with neither flag', () => {
  for (const { name, job: recorded, calls } of TRANSCRIPT.jobs) {
    it(`makes exactly the calls it made before, the settle awaited: ${name}`, async () => {
      // Mutations: any other change to the path - a script changed, a call
      // added before the beats - and the transcript differs; and the settle
      // not awaited, which puts the page's answer after the next call.
      const page = await capture(recorded)
      expect(page.calls).toEqual(calls)
    })
  }

  it('waits for the settle once, and asks nothing about a card or a draw-in', async () => {
    const page = await capture(job([FIRST, NEXT]))
    const names = page.calls.map(named)
    expect(names.filter((n) => /setCard|setDrawn|has the opening/.test(n))).toEqual([])
    expect(names.filter((n) => n.startsWith('settle'))).toEqual(['settle, awaited', 'settled'])
    // The page answered before anything else was asked of it.
    expect(names[names.indexOf('settle, awaited') + 1]).toBe('settled')
  })
})

describe('the settle, waited for', () => {
  /** The script as a page runs it, against a seam whose settle answers `answer`. */
  const run = (answer: () => unknown): Promise<unknown> =>
    runInNewContext(SETTLE_AWAITED, {
      window: { __present: { settle: answer } },
      Promise,
    }) as Promise<unknown>

  it('resolves to true for a page whose settle answers a promise, once it resolves', async () => {
    let resolved = false
    const answer = run(
      () =>
        new Promise<void>((done) =>
          setTimeout(() => {
            resolved = true
            done()
          }, 5),
        ),
    )
    expect(await answer).toBe(true)
    expect(resolved).toBe(true)
  })

  it('resolves to true for a page whose settle answers nothing, as an older page does', async () => {
    expect(await run(() => undefined)).toBe(true)
  })

  it('ends in the frame’s timeout and its sentence when the page’s promise never resolves', async () => {
    // Mutation: the settle raced against nothing - the capture waits for ever.
    const page = new RecordingPage()
    const evaluate = page.evaluate.bind(page)
    page.evaluate = (code: string) =>
      code === SETTLE_AWAITED ? new Promise<unknown>(() => {}) : evaluate(code)
    const dir = frames()
    const run = runCapture(page, job([FIRST]), {
      frames: dir,
      wait: () => Promise.resolve(),
      timeouts: { page: 2_000, frame: 600 },
    })
    await expect(run).rejects.toThrow(CaptureError)
    await expect(run).rejects.toThrow('settling the page took longer than 1 s')
    expect(page.calls.map(named)).not.toContain('frame')
    expect(existsSync(dir), 'nothing is left behind').toBe(false)
    expect(page.destroyed).toBe(true)
  })
})

describe('a job with a title card', () => {
  it('waits for the settle, then puts the card up at its beat and takes it down at every later one', async () => {
    const page = await capture(job([CARD, FIRST, NEXT]))
    // Mutation: `setCard` never called - the card's beat is the map.
    expect(fromSettle(page)).toEqual([
      'settle, awaited',
      'settled',
      'setCard true',
      'beat',
      ...Array(2).fill(['advance', 'paint', 'frame']).flat(),
      'setCard false',
      'beat',
      ...Array(2).fill(['advance', 'paint', 'frame']).flat(),
      'setCard false',
      'beat',
      ...Array(2).fill(['advance', 'paint', 'frame']).flat(),
    ])
  })

  it('asks the page first whether it can, and refuses one drawn before it could, before any frame', async () => {
    const page = new RecordingPage()
    page.hasOpening = false
    const run = runCapture(page, job([CARD, FIRST]), {
      frames: frames(),
      wait: () => Promise.resolve(),
    })
    await expect(run).rejects.toThrow(CaptureError)
    await expect(run).rejects.toThrow(
      'this map was drawn before it could open on a title card or draw itself in; draw the map again, or choose no opening',
    )
    const names = page.calls.map(named)
    expect(names).not.toContain('frame')
    expect(names).toContain('has the opening?')
    expect(names.filter((n) => n.startsWith('settle') || n.startsWith('set'))).toEqual([
      'setCapture',
    ])
    expect(page.destroyed).toBe(true)
  })
})

describe('a job with a draw-in', () => {
  it('stops where it is when cancelled in the middle of the draw-in, and leaves nothing', async () => {
    // Mutation: the checks each step makes for an ending, before it starts
    // and after it answers, removed - the page is asked for the paint after
    // the abort. Removing the frame loop's own check alone is not caught,
    // and cannot be from here: an abort lands inside a step, and that
    // step's check after its answer is what stops the capture.
    const controller = new AbortController()
    const page = new RecordingPage()
    const evaluate = page.evaluate.bind(page)
    let drawn = 0
    let abortedAt = -1
    page.evaluate = (code: string) => {
      const answer = evaluate(code)
      // The page's second `setDrawn`: the draw-in's first frame, the first
      // being the 0 after the settle.
      if (/^window\.__present\.setDrawn\(/.test(code) && ++drawn === 2) {
        controller.abort()
        abortedAt = page.calls.length
      }
      return answer
    }
    const dir = frames()
    const run = runCapture(page, job([DRAW, FIRST]), {
      frames: dir,
      wait: () => Promise.resolve(),
      signal: controller.signal,
    })
    await expect(run).rejects.toBeInstanceOf(CaptureError)
    await expect(run).rejects.toMatchObject({ cancelled: true })
    expect(abortedAt, 'the abort came during the draw-in').toBeGreaterThan(0)
    expect(
      page.calls
        .slice(0, abortedAt)
        .map(named)
        .filter((n) => n.startsWith('setDrawn')),
    ).toEqual(['setDrawn 0', 'setDrawn 0'])
    expect(
      page.calls.slice(abortedAt).filter((c) => c.kind === 'evaluate' || c.kind === 'send'),
      'nothing is asked of the page after the abort',
    ).toEqual([])
    expect(existsSync(dir), 'the frames folder is gone').toBe(false)
    expect(page.destroyed, 'the window is destroyed').toBe(true)
  })

  it('draws the network to 0 after the settle, and on every frame of the draw-in steps the clock first', async () => {
    const page = await capture(job([DRAW, FIRST]))
    // Mutations: `setDrawn` before the step; `i / n` for `i / (n - 1)`,
    // which never reaches 1; the settle not awaited, so the draw-in is put
    // at 0 before the page has settled.
    expect(fromSettle(page)).toEqual([
      'settle, awaited',
      'settled',
      'setDrawn 0',
      'beat',
      'advance',
      'setDrawn 0',
      'paint',
      'frame',
      'advance',
      `setDrawn ${1 / 3}`,
      'paint',
      'frame',
      'advance',
      `setDrawn ${2 / 3}`,
      'paint',
      'frame',
      'advance',
      'setDrawn 1',
      'paint',
      'frame',
      'beat',
      ...Array(2).fill(['advance', 'paint', 'frame']).flat(),
    ])
    expect(fromSettle(page)).not.toContain('setCard true')
  })

  it('draws a one-frame draw-in whole, as the recorder does', async () => {
    const page = await capture({ ...job([beat({ ...DRAW, secs: 1 }), FIRST]), fps: 1 })
    const names = fromSettle(page)
    expect(names.slice(0, 8)).toEqual([
      'settle, awaited',
      'settled',
      'setDrawn 0',
      'beat',
      'advance',
      'setDrawn 1',
      'paint',
      'frame',
    ])
  })
})

describe('a job with a title card and then a draw-in', () => {
  it('puts the draw-in at 0 once, the card up over bare ground, then down for the draw-in', async () => {
    const page = await capture(job([CARD, DRAW, FIRST]))
    expect(fromSettle(page)).toEqual([
      'settle, awaited',
      'settled',
      'setDrawn 0',
      'setCard true',
      'beat',
      ...Array(2).fill(['advance', 'paint', 'frame']).flat(),
      'setCard false',
      'beat',
      'advance',
      'setDrawn 0',
      'paint',
      'frame',
      'advance',
      `setDrawn ${1 / 3}`,
      'paint',
      'frame',
      'advance',
      `setDrawn ${2 / 3}`,
      'paint',
      'frame',
      'advance',
      'setDrawn 1',
      'paint',
      'frame',
      'setCard false',
      'beat',
      ...Array(2).fill(['advance', 'paint', 'frame']).flat(),
    ])
  })

  it('interpolates only numbers into the page’s scripts', async () => {
    const page = await capture(job([CARD, DRAW, FIRST]))
    const opening = page.calls
      .filter((c): c is Extract<Recorded, { kind: 'evaluate' }> => c.kind === 'evaluate')
      .map((c) => c.code)
      .filter((code) => /setCard|setDrawn/.test(code) && !code.includes('typeof'))
    for (const code of opening)
      expect(code).toMatch(
        /^window\.__present\.(setCard\((true|false)\)|setDrawn\([0-9.e-]+\)); true$/,
      )
  })
})

describe('the job’s flags', () => {
  it('are true or false where they are given, and a draw-in does not sweep', () => {
    expect(validateCaptureJob(job([CARD, DRAW, FIRST]))).toBeNull()
    expect(validateCaptureJob(job([{ ...CARD, card: 'yes' as never }]))).toBe(
      'beat 1 has a card that is not true or false',
    )
    expect(validateCaptureJob(job([{ ...DRAW, draw_in: 1 as never }]))).toBe(
      'beat 1 has a draw_in that is not true or false',
    )
    expect(
      validateCaptureJob(job([FIRST, beat({ secs: 1, sweep: true, hours: 1, draw_in: true })])),
    ).toBe('beat 2 draws the network in and sweeps the clock, which holds while it draws in')
  })

  it('refuse a draw-in of no frame, and a second draw-in, which would leave the network undrawn', () => {
    // Mutations: either guard removed - the job is captured, and the network
    // is left at 0 after its draw-in's frames, or never drawn at all.
    // At 4 frames a second a beat of 0.1 seconds rounds to no frame.
    expect(validateCaptureJob(job([FIRST, { ...DRAW, secs: 0.1, at: null }]))).toBe(
      'beat 2 draws the network in over no frame at 4 frames a second',
    )
    // An eighth of a second rounds to one frame, which is drawn whole.
    expect(validateCaptureJob(job([FIRST, { ...DRAW, secs: 0.125, at: null }]))).toBeNull()
    expect(validateCaptureJob(job([DRAW, FIRST, { ...DRAW, at: null }]))).toBe(
      'beat 3 draws the network in a second time; beat 1 already does',
    )
    // A card is not a draw-in: as many as a job likes.
    expect(validateCaptureJob(job([CARD, DRAW, CARD, FIRST]))).toBeNull()
  })
})
