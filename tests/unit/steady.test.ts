// The end-to-end waits in tests/support/steady.ts, with a stand-in page in
// hand (issue 373). Their logic - when a reading has held, when frames have
// not come, how many builds a debounce allows for releases so far apart - is
// what the macOS smoke job's flaky specs lean on, and it needs no window.

import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REDRAW_DELAY as APP_REDRAW_DELAY } from '../../src/renderer/src/colours'
import {
  afterFrames,
  appRedrawDelay,
  buildsFor,
  gapsBetween,
  heardApart,
  recordKeys,
  recordPointer,
  redrawDelayIn,
  steady,
  steadyText,
  type Evaluates,
  type KeysSeen,
  type PointerSeen,
} from '../support/steady'

const REDRAW_DELAY = 400

/** A page whose frames come at once, and whose visibility is `visible`. */
const page = (state = 'visible'): Evaluates =>
  ({
    evaluate: async (fn: unknown) => (String(fn).includes('visibilityState') ? state : undefined),
  }) as unknown as Evaluates

/** A page that never draws a frame, and says `state` when asked. */
const stalled = (state: string): Evaluates =>
  ({
    evaluate: (fn: unknown) =>
      String(fn).includes('visibilityState')
        ? Promise.resolve(state)
        : new Promise(() => undefined),
  }) as unknown as Evaluates

describe('gapsBetween', () => {
  it.each([
    [[], []],
    [[5], []],
    [
      [10, 70, 150, 160],
      [60, 80, 10],
    ],
  ])('%j is %j', (times, gaps) => {
    expect(gapsBetween(times)).toEqual(gaps)
  })
})

describe('buildsFor', () => {
  // The timer starts in the dispatch that stamps a release and cannot run
  // during one, so a gap under the delay cannot have a build in it, however
  // close to the delay it is; a gap of the delay or more may.
  it.each([
    ['no gaps, one release', [], true, 1],
    ['gaps well inside the delay', [60, 80, 90], true, 1],
    ['a gap 20 ms inside the delay is still inside it', [60, 380, 90], true, 1],
    ['a gap just inside it, past the clocks rounding', [60, 397, 90], true, 1],
    ['a gap within the clocks rounding of it', [60, 398, 90], false, 2],
    ['a gap of exactly the delay', [60, 400, 90], false, 2],
    ['one long gap', [450, 380, 90], false, 2],
    ['every gap long', [450, 420, 410], false, 4],
  ])('%s: %j', (_what, gaps, exactlyOne, most) => {
    expect(buildsFor(gaps, REDRAW_DELAY)).toEqual({ exactlyOne, most })
  })
})

describe('steady', () => {
  it('answers the reading that held, not the first', async () => {
    const reads = [[100], [124], [124]]
    let taken = 0
    const answer = await steady(page(), async () => reads[Math.min(taken++, 2)], 'row 0')
    expect(answer).toEqual([124])
    expect(taken, 'read, moved, read, held').toBe(3)
  })

  it('takes a wobble of a fraction for a position that held', async () => {
    const reads = [[100.0001], [100.0003]]
    let taken = 0
    expect(await steady(page(), async () => reads[taken++], 'row 0')).toEqual([100.0003])
  })

  it('fails at its deadline with the last two readings it saw', async () => {
    let n = 0
    await expect(
      steady(page(), async () => [n++ * 24], 'the rows of cell 05', { deadlineMs: 0 }),
    ).rejects.toThrow('the rows of cell 05 did not stop moving within 0 ms: it read [0], then [24]')
  })

  it('does the same for a text', async () => {
    const reads = ['#0072bc', '#4f8aa0', '#4f8aa0']
    let taken = 0
    const answer = await steadyText(page(), async () => reads[Math.min(taken++, 2)], 'the field')
    expect(answer).toBe('#4f8aa0')
    await expect(steadyText(page(), async () => String(taken++), 'the field', 0)).rejects.toThrow(
      /the field did not stop moving within 0 ms/,
    )
  })
})

describe('afterFrames', () => {
  it('resolves when the frames are drawn', async () => {
    await expect(afterFrames(page(), 2, 1_000)).resolves.toBeUndefined()
  })

  it('fails at its deadline and names the page the frames did not come to', async () => {
    await expect(afterFrames(stalled('hidden'), 2, 30)).rejects.toThrow(
      "2 animation frame(s) were not drawn within 30 ms; the page's visibility is hidden",
    )
  })
})

describe('recordPointer', () => {
  it('keeps the last move the page heard and the time of each release', async () => {
    const win = new EventTarget()
    recordPointer(win as unknown as Window)
    const move = (x: number, y: number): Event =>
      Object.assign(new Event('mousemove'), { clientX: x, clientY: y })
    win.dispatchEvent(move(10, 20))
    win.dispatchEvent(move(130, 80))
    win.dispatchEvent(new Event('pointerup'))
    await new Promise((resolve) => setTimeout(resolve, 30))
    win.dispatchEvent(new Event('pointerup'))
    const seen = (win as unknown as { __pointerSeen: PointerSeen }).__pointerSeen
    expect(seen.at).toEqual({ x: 130, y: 80 })
    expect(seen.released).toHaveLength(2)
    expect(gapsBetween(seen.released)[0]).toBeGreaterThanOrEqual(25)
  })
})

describe('recordKeys', () => {
  const key = (name: string): Event => Object.assign(new Event('keydown'), { key: name })

  it('keeps when each keydown arrived and which key it was, repeats included', async () => {
    const win = new EventTarget()
    recordKeys(win as unknown as Window)
    win.dispatchEvent(key('ArrowRight'))
    win.dispatchEvent(key('ArrowRight'))
    await new Promise((resolve) => setTimeout(resolve, 30))
    win.dispatchEvent(key('ArrowLeft'))
    win.dispatchEvent(new Event('keyup'))
    const seen = (win as unknown as { __keysSeen: KeysSeen }).__keysSeen
    expect(seen.downs.map((down) => down.key)).toEqual(['ArrowRight', 'ArrowRight', 'ArrowLeft'])
    expect(gapsBetween(seen.downs.map((down) => down.at))[1]).toBeGreaterThanOrEqual(25)
  })
})

describe('heardApart', () => {
  it.each([
    [[], 'the presses heard once'],
    [[12.4], 'the presses heard 12 ms apart'],
    [[12.4, 30, 520.6], 'the presses heard 12, 30, 521 ms apart'],
  ])('%j is %j', (gaps, said) => {
    expect(heardApart('the presses', gaps)).toBe(said)
  })
})

describe("the window a spec waits on is the app's own", () => {
  it.each([
    ['export const REDRAW_DELAY = 400', 400],
    ['// a comment\nexport const REDRAW_DELAY = 750\nexport const OTHER = 1\n', 750],
    ['export const REDRAW_DELAY=1_200', 1200],
  ])('%j is read as %j', (source, ms) => {
    expect(redrawDelayIn(source)).toBe(ms)
  })

  it.each([
    ['not declared at all', 'export const OTHER = 400'],
    ['an expression', 'export const REDRAW_DELAY = 4 * 100'],
    ['only mentioned in a comment', ' * `export const REDRAW_DELAY = 400` was here'],
  ])('refuses %s rather than answer a window of its own', (_what, source) => {
    expect(() => redrawDelayIn(source)).toThrow(/REDRAW_DELAY is no longer declared/)
  })

  it('reads what colours.ts exports, so the spec cannot keep a copy that drifts', () => {
    expect(appRedrawDelay(resolve(__dirname, '../..'))).toBe(APP_REDRAW_DELAY)
  })
})
