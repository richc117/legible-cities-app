// Where the app's own window opens, and when its place is kept (issue 549).
//
// The window opens where a person left it, as the platforms ask of an app
// (Apple's "the same state and location in which people left them",
// Microsoft's monitor, size, position and state), but only on a display
// still attached: a place on a monitor that has gone is a window nobody can
// reach, so it opens at its default size in the platform's place instead.
//
// No Electron import, so the rule is tested without a session, as
// window-lifecycle.ts is: index.ts hands in the displays, the window's
// bounds and the write. The capture window and the export preview never come
// here; neither is the app's window.

import type { WindowBounds } from '../shared/settings'

/** The window's size on a first run, or wherever its place cannot be used. */
export const DEFAULT_WINDOW_SIZE = { width: 1100, height: 720 } as const

/** Never smaller: the interface is drawn for this much and no less. */
export const MINIMUM_WINDOW_SIZE = { width: 640, height: 480 } as const

/**
 * How far a window may stand past its display's edge and still be on it. On
 * Windows a window's bounds include its invisible resize border, about seven
 * pixels, so a window pushed flush to an edge reads as just off the display;
 * without this it would lose its place for being exactly where it was put.
 */
export const EDGE_ALLOWANCE = 8

/** How long the window must be still before its place is written. */
export const KEEP_DELAY_MS = 500

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Where the window opens and in what state. */
export interface Placement {
  width: number
  height: number
  /** Absent together: the platform places the window (Electron centres it). */
  x?: number
  y?: number
  /** Maximise once the window is shown, as the person left it. */
  maximize: boolean
}

/** Whether `area` holds the whole of `rect`, give or take the edge allowance. */
export function holds(area: Rect, rect: Rect): boolean {
  return (
    rect.x >= area.x - EDGE_ALLOWANCE &&
    rect.y >= area.y - EDGE_ALLOWANCE &&
    rect.x + rect.width <= area.x + area.width + EDGE_ALLOWANCE &&
    rect.y + rect.height <= area.y + area.height + EDGE_ALLOWANCE
  )
}

/**
 * Where the window opens, from its stored place and the displays attached
 * now (each display's bounds, in the screen's coordinates).
 *
 * - No stored place: the default size, in the platform's place.
 * - A stored place smaller than the minimum is raised to it first, then
 *   judged at that size.
 * - It is used only when one display holds the whole of it. A window left
 *   across two displays, or on one that has gone, opens at the default size
 *   in the platform's place: a place half off every screen is no better.
 * - Maximised is kept either way. It is a state rather than a place, and a
 *   window maximised on a monitor that has gone opens maximised on the one
 *   that is there, as the platforms' own windows do.
 */
export function placeWindow(stored: WindowBounds | null, displays: readonly Rect[]): Placement {
  if (stored === null) return { ...DEFAULT_WINDOW_SIZE, maximize: false }
  const rect: Rect = {
    x: stored.x,
    y: stored.y,
    width: Math.max(stored.width, MINIMUM_WINDOW_SIZE.width),
    height: Math.max(stored.height, MINIMUM_WINDOW_SIZE.height),
  }
  if (!displays.some((display) => holds(display, rect))) {
    return { ...DEFAULT_WINDOW_SIZE, maximize: stored.maximized }
  }
  return { ...rect, maximize: stored.maximized }
}

/** What the keeper needs from the window and the settings. */
export interface KeeperDeps {
  /**
   * The window's place in its normal state and whether it is maximised, or
   * null when there is nothing worth keeping: a minimised window, or one
   * already destroyed, keeps the place it had.
   */
  read: () => WindowBounds | null
  /** The write, through the settings file's own queue; never rejects. */
  keep: (bounds: WindowBounds) => Promise<void>
  delayMs?: number
  setTimer?: (run: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

export interface BoundsKeeper {
  /** The window moved or was resized: write once it has been still for a moment. */
  changed(): void
  /**
   * The window is closing: write now, whatever is waiting, and answer when
   * it has landed or failed, so a quit can wait for it.
   */
  closing(): Promise<void>
}

/**
 * Write the window's place a moment after it stops moving, and once more as
 * it closes. A drag sends a move for every few pixels, so each one restarts
 * the wait rather than writing; the place is read when the wait ends, so
 * what is written is where the window came to rest.
 */
export function keepBounds(deps: KeeperDeps): BoundsKeeper {
  const delay = deps.delayMs ?? KEEP_DELAY_MS
  const setTimer = deps.setTimer ?? ((run, ms) => setTimeout(run, ms))
  const clearTimer =
    deps.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  let timer: unknown = null
  let closed = false
  const write = (): Promise<void> => {
    const bounds = deps.read()
    return bounds === null ? Promise.resolve() : deps.keep(bounds)
  }
  return {
    changed() {
      if (closed) return
      if (timer !== null) clearTimer(timer)
      timer = setTimer(() => {
        timer = null
        void write()
      }, delay)
    },
    closing() {
      if (timer !== null) clearTimer(timer)
      timer = null
      if (closed) return Promise.resolve()
      closed = true
      return write()
    },
  }
}
