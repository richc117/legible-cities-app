// Waits for a page to be still, and for the app to have heard a pointer, so
// a spec measures or asserts after the thing it measures has stopped moving
// (issue 373).
//
// The macOS smoke job failed five specs in a day, each green on a rerun and
// on the other two platforms, and the waits here are for the shape that
// suggests: a position read, a press made or a count taken against a page
// that was still moving, on a runner slow to settle. Each wait is a deadline
// on a state the page shows - a sentence, a position that holds across
// animation frames, a pointer the page has heard arrive - never a count of
// turns or a sleep, and each says what it saw when the deadline passes.
//
// Everything here takes the one thing it needs from the page
// (`Pick<Page, 'evaluate'>`), so their own logic can be run in Node against
// a stand-in page.

import { expect, type ElectronApplication, type Page } from '@playwright/test'

/** What a wait needs of a page: to run a function in it. */
export type Evaluates = Pick<Page, 'evaluate'>

/** How long animation frames are given to come before the page is said not to be painting. */
export const FRAMES_MS = 10_000

/** `document.visibilityState`: `hidden` for a window macOS reports as occluded or a minimised one. */
export const visibilityOf = (page: Evaluates): Promise<string> =>
  page.evaluate(() => document.visibilityState)

/**
 * Resolves once `frames` animation frames have been drawn. A page that is
 * not painting draws none, so it fails at the deadline and names the page's
 * visibility rather than waiting out the test's own timeout in silence.
 */
export async function afterFrames(
  page: Evaluates,
  frames = 2,
  deadlineMs = FRAMES_MS,
): Promise<void> {
  const drawn = page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const next = (left: number): void => {
          requestAnimationFrame(() => (left <= 1 ? resolve() : next(left - 1)))
        }
        next(count)
      }),
    frames,
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), deadlineMs)
  })
  try {
    const first = await Promise.race([drawn.then(() => 'drawn' as const), late])
    if (first === 'late') {
      const state = await visibilityOf(page).then(
        (seen) => seen,
        () => 'unreadable',
      )
      throw new Error(
        `${frames} animation frame(s) were not drawn within ${deadlineMs} ms; the page's visibility is ${state}`,
      )
    }
  } finally {
    clearTimeout(timer)
    // A page that closes under a frame that never came is the test's end,
    // not this wait's.
    drawn.catch(() => undefined)
  }
}

const sameWithin = (a: number[], b: number[], tolerance: number): boolean =>
  a.length === b.length && a.every((n, i) => Math.abs(n - b[i]) <= tolerance)

/**
 * A reading that held across two animation frames: read, wait two frames,
 * read again, and answer once the two agree within `tolerance` (a position is
 * a fraction that wobbles by a ten-thousandth between reads). A reading that
 * is still moving at the deadline fails with the last two it saw.
 */
export async function steady(
  page: Evaluates,
  read: () => Promise<number[]>,
  what: string,
  { tolerance = 0.5, deadlineMs = 20_000 }: { tolerance?: number; deadlineMs?: number } = {},
): Promise<number[]> {
  const end = Date.now() + deadlineMs
  let last = await read()
  for (;;) {
    await afterFrames(page)
    const now = await read()
    if (sameWithin(last, now, tolerance)) return now
    if (Date.now() >= end) {
      throw new Error(
        `${what} did not stop moving within ${deadlineMs} ms: it read ${JSON.stringify(last)}, then ${JSON.stringify(now)}`,
      )
    }
    last = now
  }
}

/** A box as the four numbers `steady` compares. */
export const boxNumbers = (box: {
  x: number
  y: number
  width: number
  height: number
}): number[] => [box.x, box.y, box.width, box.height]

/**
 * What the project's header says once the notebook has taken in a finished
 * run: the record read back, every cell above the export drawn, and Run all
 * gone because there is nothing left to run (`notebookSentence` in
 * `runAll.ts`). A spec that starts measuring the moment the run's own
 * "Laid out." shows is measuring a column the header is still settling
 * under (it holds its sentence while the record is read back); the trace of
 * the floating panel's failure read row 0 24px from where it had been a
 * moment before.
 *
 * Then two animation frames, so the layout that sentence brought is drawn.
 */
export async function notebookSettled(page: Page): Promise<void> {
  await expect(
    page.locator('.project-run-state'),
    'the header says every cell is drawn',
  ).toHaveText(/^(The map is drawn from every cell|Every cell is ready)\.$/, { timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Run all' })).toHaveCount(0)
  await afterFrames(page)
}

/**
 * The window shown, raised and focused if the page reports it hidden, and
 * what its visibility is after. Chromium stops a page's animation frames in
 * a window macOS reports as occluded and throttles its tasks (`bringToFront`
 * in `tests/acceptance/acceptance.spec.ts` has the same note), so a window
 * left behind others cannot hear what waits on a frame: the announcement of
 * a job's end is cleared and filled again two animation frames later. A
 * window that is already visible is left alone - nothing is raised, no
 * focus is taken from a person at a desk - and a raise is said in the job's
 * log, so how often a runner needs one is seen.
 */
export async function showIfHidden(
  app: ElectronApplication,
  page: Page,
  what: string,
): Promise<{ raised: boolean; state: string }> {
  const before = await visibilityOf(page)
  if (before === 'visible') return { raised: false, state: before }
  await app.evaluate(({ BrowserWindow, app: electronApp }) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window === undefined) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.moveTop()
    window.focus()
    if (process.platform === 'darwin') electronApp.focus({ steal: true })
  })
  let state: string
  try {
    await expect.poll(() => visibilityOf(page), { timeout: 3_000 }).toBe('visible')
    state = 'visible'
  } catch {
    state = await visibilityOf(page).then(
      (seen) => seen,
      () => 'unreadable',
    )
  }
  console.log(`${what}: the window was ${before}; raised it, and it is now ${state}`)
  return { raised: true, state }
}

/** What `watchPointer` has recorded in the page. */
export interface PointerSeen {
  /** Where the last mouse move the page's listeners heard was, in CSS pixels from the window's corner. */
  at: { x: number; y: number } | null
  /** When each pointer release arrived, in milliseconds on the page's own clock (`performance.now()`). */
  released: number[]
}

/**
 * Starts the page recording the pointer, and answers nothing. The functions
 * `page.evaluate` is given are sent as text, so this one reaches for
 * nothing outside itself; a test hands it a stand-in window instead.
 *
 * A move is recorded on the way out of the window, after the document's
 * own listeners (react-colorful's, which listens for mouse events there) have
 * run, so a position seen is a position the app has handled. A release is
 * recorded on the way in, before the app's handler, so the time is the
 * handler's to within the handler's own length.
 */
export function recordPointer(win: Window = window): void {
  const seen: PointerSeen = { at: null, released: [] }
  ;(win as unknown as { __pointerSeen: PointerSeen }).__pointerSeen = seen
  win.addEventListener('mousemove', (event) => {
    seen.at = { x: event.clientX, y: event.clientY }
  })
  win.addEventListener('pointerup', () => seen.released.push(performance.now()), true)
}

/** Start recording the pointer in the page. */
export const watchPointer = (page: Evaluates): Promise<void> =>
  page.evaluate(recordPointer as () => void)

/** What the page has recorded of the pointer since `watchPointer`. */
export const pointerSeenBy = (page: Evaluates): Promise<PointerSeen> =>
  page.evaluate(() => (window as unknown as { __pointerSeen: PointerSeen }).__pointerSeen)

/**
 * Resolves once the page has heard the pointer arrive at `to` (within a
 * pixel and a half), whatever it did on the way: a runner that coalesces
 * fifty moves into a few still hears the last. The pacing of a slow drag is
 * the page's, not a count of the moves sent.
 */
export async function pointerHasReached(
  page: Evaluates,
  to: { x: number; y: number },
  what: string,
  timeout = 30_000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const { at } = await pointerSeenBy(page)
        return at === null ? Infinity : Math.hypot(at.x - to.x, at.y - to.y)
      },
      { timeout, message: `${what}: the page heard the pointer arrive at ${to.x}, ${to.y}` },
    )
    .toBeLessThanOrEqual(1.5)
}

/** The gaps between consecutive times. */
export const gapsBetween = (times: number[]): number[] =>
  times.slice(1).map((time, i) => time - times[i])

/**
 * What a debounce of `delay` ms allows for changes arriving `gaps` apart,
 * read from the page's own clock: with every gap under the delay by `margin`
 * (the handler's own length, and the time a starved renderer takes to run
 * it), the timer cannot have fired between two of them and the changes are
 * exactly one build; with a longer gap, a build may have fallen in it, and
 * at most one did for each such gap.
 */
export function buildsFor(
  gaps: number[],
  delay: number,
  margin = 100,
): { exactlyOne: boolean; most: number } {
  const long = gaps.filter((gap) => gap >= delay - margin).length
  return { exactlyOne: long === 0, most: 1 + long }
}
