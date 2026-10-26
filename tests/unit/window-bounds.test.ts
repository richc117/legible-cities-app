// Where the app's window opens and when its place is written (issue 549).
// The rule is pure and takes the displays as rectangles, so a second
// monitor, one that has gone, and Windows' invisible border are all asserted
// here without a screen: nobody running this suite can unplug one.

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WindowBounds } from '../../src/shared/settings'
import {
  DEFAULT_WINDOW_SIZE,
  EDGE_ALLOWANCE,
  keepBounds,
  KEEP_DELAY_MS,
  MINIMUM_WINDOW_SIZE,
  placeWindow,
  type Rect,
} from '../../src/main/window-bounds'

/** A laptop's display, and a second one to its left, as macOS and Windows number them. */
const laptop: Rect = { x: 0, y: 0, width: 1512, height: 982 }
const leftMonitor: Rect = { x: -2560, y: -200, width: 2560, height: 1440 }

const left = (over: Partial<WindowBounds> = {}): WindowBounds => ({
  x: -2000,
  y: 0,
  width: 1400,
  height: 900,
  maximized: false,
  ...over,
})

describe('placeWindow', () => {
  it('opens at the default size in the platform’s place with nothing stored', () => {
    const place = placeWindow(null, [laptop])
    expect(place).toEqual({ ...DEFAULT_WINDOW_SIZE, maximize: false })
    expect(place.x, 'no position: the platform places it').toBeUndefined()
    expect(DEFAULT_WINDOW_SIZE).toEqual({ width: 1100, height: 720 })
  })

  it('uses a stored place on a display that is still attached', () => {
    expect(placeWindow(left(), [laptop, leftMonitor])).toEqual({
      x: -2000,
      y: 0,
      width: 1400,
      height: 900,
      maximize: false,
    })
    const onLaptop = { x: 120, y: 60, width: 900, height: 600, maximized: false }
    expect(placeWindow(onLaptop, [laptop])).toMatchObject({ x: 120, y: 60, width: 900 })
  })

  it('falls back to the default for a place on a display that has gone', () => {
    const place = placeWindow(left(), [laptop])
    expect(place).toEqual({ ...DEFAULT_WINDOW_SIZE, maximize: false })
    expect(place.x).toBeUndefined()
    expect(place.y).toBeUndefined()
  })

  it('falls back to the default for a place across two displays, which neither holds', () => {
    const across = left({ x: -700, width: 1400 })
    expect(placeWindow(across, [laptop, leftMonitor])).toEqual({
      ...DEFAULT_WINDOW_SIZE,
      maximize: false,
    })
  })

  it('raises a place under the minimum to it, keeping where it was', () => {
    const small = { x: 100, y: 100, width: 300, height: 200, maximized: false }
    expect(placeWindow(small, [laptop])).toEqual({
      x: 100,
      y: 100,
      width: MINIMUM_WINDOW_SIZE.width,
      height: MINIMUM_WINDOW_SIZE.height,
      maximize: false,
    })
    expect(MINIMUM_WINDOW_SIZE).toEqual({ width: 640, height: 480 })
  })

  it('judges a raised place at its raised size', () => {
    // Fits as stored, but not once raised to the minimum.
    const corner = { x: 1300, y: 800, width: 200, height: 150, maximized: false }
    expect(placeWindow(corner, [laptop])).toEqual({ ...DEFAULT_WINDOW_SIZE, maximize: false })
  })

  it('takes a window pushed flush to an edge on Windows, border and all, and no further', () => {
    const border = 7
    const flush = { x: -border, y: 0, width: 800, height: 600, maximized: false }
    expect(placeWindow(flush, [laptop])).toMatchObject({ x: -border })
    const off = { ...flush, x: -(EDGE_ALLOWANCE + 1) }
    expect(placeWindow(off, [laptop]).x).toBeUndefined()
  })

  it('keeps maximised, whether or not the place could be used', () => {
    expect(placeWindow(left({ maximized: true }), [laptop, leftMonitor]).maximize).toBe(true)
    const gone = placeWindow(left({ maximized: true }), [laptop])
    expect(gone).toEqual({ ...DEFAULT_WINDOW_SIZE, maximize: true })
  })

  it('opens at the default with no display at all, rather than anywhere', () => {
    expect(placeWindow(left(), [])).toEqual({ ...DEFAULT_WINDOW_SIZE, maximize: false })
  })
})

describe('keepBounds', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  /** A window whose place the test moves, and every write the keeper made. */
  function harness() {
    vi.useFakeTimers()
    const window = {
      bounds: { x: 10, y: 20, width: 900, height: 600, maximized: false } as WindowBounds | null,
    }
    const kept: WindowBounds[] = []
    const keeper = keepBounds({
      read: () => (window.bounds === null ? null : { ...window.bounds }),
      keep: async (bounds) => {
        kept.push(bounds)
      },
    })
    return { window, kept, keeper }
  }

  it('writes once a drag has come to rest, where it came to rest', () => {
    const { window, kept, keeper } = harness()
    for (let x = 10; x <= 200; x += 10) {
      window.bounds = { ...(window.bounds as WindowBounds), x }
      keeper.changed()
      vi.advanceTimersByTime(KEEP_DELAY_MS / 5)
    }
    expect(kept, 'nothing while it is still moving').toEqual([])
    vi.advanceTimersByTime(KEEP_DELAY_MS)
    expect(kept).toEqual([{ x: 200, y: 20, width: 900, height: 600, maximized: false }])
  })

  it('writes at once as the window closes, and not again for the wait it cancelled', async () => {
    const { window, kept, keeper } = harness()
    keeper.changed()
    window.bounds = { x: 50, y: 60, width: 1000, height: 700, maximized: true }
    await keeper.closing()
    expect(kept).toEqual([{ x: 50, y: 60, width: 1000, height: 700, maximized: true }])
    vi.advanceTimersByTime(KEEP_DELAY_MS * 4)
    keeper.changed()
    vi.advanceTimersByTime(KEEP_DELAY_MS * 4)
    await keeper.closing()
    expect(kept, 'one write for the close, none after it').toHaveLength(1)
  })

  it('keeps nothing for a minimised window, which keeps the place it had', async () => {
    const { window, kept, keeper } = harness()
    window.bounds = null
    keeper.changed()
    vi.advanceTimersByTime(KEEP_DELAY_MS)
    await keeper.closing()
    expect(kept).toEqual([])
  })
})
