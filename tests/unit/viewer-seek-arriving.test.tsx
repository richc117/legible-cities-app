// @vitest-environment jsdom
// A seek made while a run's page arrives (issue 660). The run's end offers
// cell 03's transport again before the frame has been sent to the page the
// run wrote, let alone loaded it and given it back its state; the gate's
// step 7 scrubbed in that beat on the macOS runner, the seek was lost, and
// the clock stayed at the hour the restore put back.
//
// The map's frame is drawn as it is on the screen, with the bridge a stand-in
// that records what the page was sent. The frame's load is the element's own
// `load` event, which is what React's `onLoad` listens for.
//
// Mutations, watched failing: `viewer-seek-arriving.mutations.json`.

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Viewer from '../../src/renderer/src/Viewer'
import { transportFor } from '../../src/renderer/src/transportState'
import { answered, BASE, cleanup, renderCell, renderPanel } from '../support/render'
import { StandInRun } from '../support/stand-in-run'

afterEach(cleanup)

/** The page the frame is on: it was at 07:20 and paused. */
const LEFT = { now: 26_400, viewName: 'schematic', playing: false }

interface Page {
  sent: [string, unknown[]][]
  /** The bridge's call: the page being left is asked what it shows, and waits for `answer`. */
  call: (role: string, method: string, ...args: unknown[]) => Promise<unknown>
  answer: () => void
}

/**
 * The bridge to the page. The first `state` asked waits for `answer`, and
 * the page being left answers `left`, or refuses where it is null.
 */
function page(left: unknown = LEFT): Page {
  const sent: [string, unknown[]][] = []
  let release: () => void = () => undefined
  let asked = 0
  return {
    sent,
    call: async (_role, method, ...args) => {
      sent.push([method, args])
      if (method !== 'state') return undefined
      asked += 1
      if (asked > 1) return LEFT
      await new Promise<void>((resolve) => {
        release = resolve
      })
      if (left === null) throw new Error('between documents')
      return left
    },
    answer: () => release(),
  }
}

/** The map's frame drawn for `id`, on the bridge `stand`. */
function drawn(id: string, stand: Page): (redraw: number) => void {
  const project = { ...BASE, id, readOnly: false }
  const view = renderPanel(<Viewer project={project} redraw={0} />, {
    api: {
      viewer: {
        attach: async () => true,
        release: async () => undefined,
        call: stand.call,
        seams: async () => [],
      },
    },
  })
  return (redraw) => view.rerender(<Viewer project={project} redraw={redraw} />)
}

/** The frame's document loaded. */
const loaded = (): void =>
  act(() => {
    document.querySelector('iframe.viewer-frame')?.dispatchEvent(new Event('load'))
  })

const seeks = (sent: [string, unknown[]][]): unknown[][] =>
  sent.filter(([method]) => method === 'seek').map(([, args]) => args)

describe('the page a run wrote, given back', () => {
  it('is sought to where a person moved the clock while the page was being left (issue 660)', async () => {
    const id = 'seekarriving1'
    const stand = page()
    const redraw = drawn(id, stand)
    // A seek from earlier in the session: older than any page read since.
    transportFor(id).seek(30_000)
    // The run ends: the frame is to go to the page it wrote, and the page
    // being left is asked what it shows first.
    redraw(1)
    await answered()
    // The transport is offered again, and the person scrubs to 17:00.
    transportFor(id).seek(61_200)
    stand.answer()
    await answered()
    loaded()
    await answered()
    await answered()
    expect(seeks(stand.sent), 'the new page goes where the person put it').toEqual([[61_200]])
  })

  it('is given back the clock the page being left said when nobody moved it since', async () => {
    // Mutation: the seek counted only as the frame mounts, not again as the
    // page being left is asked - a seek the old page took and has since
    // played on from is given back over the clock it reports.
    const id = 'seekarriving2'
    transportFor(id).seek(30_000)
    const stand = page()
    const redraw = drawn(id, stand)
    transportFor(id).seek(31_000)
    redraw(1)
    await answered()
    stand.answer()
    await answered()
    loaded()
    await answered()
    await answered()
    expect(seeks(stand.sent)).toEqual([[LEFT.now]])
  })

  it('keeps the count with the clock it was read with when a read fails', async () => {
    // Mutation: the count kept at every ask, answered or not - a page
    // scrubbed directly and then too busy to answer is given back neither
    // its own clock, which went unread, nor the seek that moved it.
    const id = 'seekarriving5'
    const stand = page(null)
    const redraw = drawn(id, stand)
    // A scrub of the page on screen, which took it.
    transportFor(id).seek(30_000)
    redraw(1)
    await answered()
    stand.answer()
    await answered()
    loaded()
    await answered()
    await answered()
    expect(seeks(stand.sent)).toEqual([[30_000]])
  })

  it('gives a project opened again no seek from its last visit', async () => {
    // Mutation: the count started from nothing as the frame mounts - the
    // first page of a project opened again is sent where it was scrubbed
    // to minutes ago.
    const id = 'seekarriving3'
    transportFor(id).seek(30_000)
    // The page being left is this first one, which says nothing of its clock.
    const stand = page({})
    drawn(id, stand)
    loaded()
    await answered()
    stand.answer()
    await answered()
    await answered()
    expect(
      stand.sent.map(([method]) => method),
      'the page was probed and given back',
    ).toContain('setTheme')
    expect(seeks(stand.sent)).toEqual([])
  })

  it('is sought there even where the page being left said nothing', async () => {
    // Mutation: the seek laid over the state only as each call is sent -
    // where the page being left refused to answer there is no seek in the
    // restore to lay it over.
    const id = 'seekarriving4'
    const stand = page(null)
    const redraw = drawn(id, stand)
    redraw(1)
    await answered()
    transportFor(id).seek(61_200)
    stand.answer()
    await answered()
    loaded()
    await answered()
    await answered()
    expect(seeks(stand.sent)).toEqual([[61_200]])
  })
})

/** Longer than the transport's own wait before it sends a seek (`SEEK_DELAY`, 80 ms). */
const SEEK_WAIT = 200

/** The run as cell 03 reads it, as `transport-refusal.test.tsx` has it. */
class FrameRun extends StandInRun {
  job(): null {
    return null
  }
  beforeStart(): () => void {
    return () => undefined
  }
}

/** The scrub moved to `seconds`, as a person's drag reports it. */
function scrubTo(seconds: number): void {
  const scrub = document.querySelector<HTMLInputElement>('section.transport input[type="range"]')
  if (scrub === null) throw new Error('the transport drew no scrub')
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    set?.call(scrub, String(seconds))
    scrub.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('cell 03’s scrub', () => {
  it('remembers each seek as it is sent, and none it refuses (issue 660)', async () => {
    // Mutations: the scrub sends its seek without remembering it - the page
    // a run wrote is given back the clock the page being left said - and it
    // remembers it as it is asked for, so a seek still waiting out the
    // debounce passes for one the page being left had taken.
    vi.useFakeTimers()
    try {
      const api = {
        viewer: {
          call: async (_frame: string, method: string): Promise<unknown> =>
            method === 'bounds'
              ? { t0: 0, t1: 86_400 }
              : method === 'state'
                ? { now: 3_600, clock: '01:00' }
                : undefined,
        },
      }
      const view = renderCell('frame', {}, { run: new FrameRun(), api })
      await answered()
      const memory = transportFor(BASE.id)
      const before = memory.sought?.count ?? 0
      scrubTo(61_200)
      expect(memory.sought?.count ?? 0, 'not yet sent: still in the debounce').toBe(before)
      act(() => {
        vi.advanceTimersByTime(SEEK_WAIT)
      })
      expect(memory.sought).toEqual({ at: 61_200, count: before + 1 })
      view.rerender({ layingOut: true })
      scrubTo(40_000)
      act(() => {
        vi.advanceTimersByTime(SEEK_WAIT)
      })
      expect(memory.sought, 'refused while a run holds the page').toEqual({
        at: 61_200,
        count: before + 1,
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
