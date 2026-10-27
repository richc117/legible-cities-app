// @vitest-environment jsdom
// The jobs' live region, rendered, with what reaches its text (issue 330):
// the same sentence announced twice has to leave the region empty, full,
// empty, full, because a screen reader hears a change and nothing else.
//
// jobs-view.test.tsx pins the calls the announcer makes to `write`; that
// cannot see the fault this file is for. When `write` was a React state
// setter called from an IPC callback, the empty text was scheduled, not
// rendered; a window that ran both animation frames before React rendered
// had the refill join the clear's batch, equal to what the region already
// showed, and nothing reached the DOM.
//
// The real hook and the real element are drawn into jsdom through React's
// own client (`tests/support/render.tsx`, ADR-059), and what reaches the
// region is read by a MutationObserver on it, which is what a screen reader
// is told of: each change of its text, in order. A write that changes
// nothing - the empty text put into a region that is already empty - is no
// change to the document and is not seen, as it is not heard.
//
// Mutations, watched failing:
// - `writeToRegion` in src/renderer/src/Jobs.tsx putting its text in after a
//   microtask (`queueMicrotask(() => ...)`), which is "scheduled, not
//   rendered": three tests fail ("is full a frame later", "goes empty, full,
//   empty, full" and "says two ends ... together"), on "expected '' to be
//   'Los Angeles: Layout run, failed.'" and an empty list of writes. The
//   "starved window" test passes under it, because its `act` waits for
//   microtasks; it is the fault of a state setter, which the microtask only
//   resembles, and it does not guard the write.
// - `LiveRegion` drawing the `children` it is given instead of `{null}`: only
//   "draws no children" fails, on "expected Text{} to be null". The
//   type half of that refusal (`@ts-expect-error` in the same test) is held
//   by `npm run typecheck`, which covers the tests, and is what turns
//   `{announcement}` put back into a region's markup into a build error.

import { act, type JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LiveRegion, useAnnouncer } from '../../src/renderer/src/Jobs'
import { renderPanel, type RenderedPanel } from '../support/render'

let announce: (sentence: string) => void
/** The frames the announcer waits on, run by hand: a frame is a thing that happens or does not. */
let frames: (() => void)[]

/**
 * The window's own live region, as App draws it: the hook and the component
 * it uses, with the attributes it gives them. `extra` is whatever a test
 * tries to put in it that the component refuses.
 */
function Region({ extra = {} }: { extra?: object }): JSX.Element {
  const hook = useAnnouncer((then) => frames.push(then))
  announce = hook.announce
  return (
    <LiveRegion
      region={hook.region}
      className="visually-hidden"
      role="status"
      aria-live="polite"
      data-announces="jobs"
      {...extra}
    />
  )
}

let view: RenderedPanel
let region: HTMLParagraphElement
let observer: MutationObserver
let seen: string[]

/**
 * Every text the region has come to show since it was drawn, in order, as
 * its observer hears the changes: the records it has delivered, and the ones
 * still queued for it, taken now so a test need not wait for a microtask.
 */
function written(): string[] {
  hear(observer.takeRecords())
  return seen
}

/** Each change heard, as the text it leaves: a text node's new value, or the children put in. */
function hear(records: MutationRecord[]): void {
  for (const record of records)
    seen.push(
      record.type === 'characterData'
        ? (record.target.textContent ?? '')
        : [...record.addedNodes].map((node) => node.textContent ?? '').join(''),
    )
}

beforeEach(() => {
  frames = []
  view = renderPanel(<Region />)
  region = view.host.firstChild as HTMLParagraphElement
  seen = []
  observer = new MutationObserver(hear)
  observer.observe(region, { childList: true, characterData: true, subtree: true })
})

afterEach(() => {
  observer.disconnect()
  view.unmount()
})

const SENTENCE = 'Los Angeles: Layout run, failed.'

describe('the jobs live region, rendered', () => {
  it('is the element React drew, with the attributes a reader needs', () => {
    expect(region.tagName).toBe('P')
    expect(region.getAttribute('role')).toBe('status')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.getAttribute('data-announces')).toBe('jobs')
    expect(region.className).toBe('visually-hidden')
    // React gave it no text of its own to overwrite or to lose.
    expect(region.childNodes).toHaveLength(0)
    expect(written()).toEqual([])
  })

  it('is full a frame later, from one announcement, and not before', () => {
    announce(SENTENCE)
    expect(frames).toHaveLength(1)
    // A writer that filled the region at once would be caught here.
    expect(region.textContent).toBe('')
    frames.shift()?.()
    expect(region.textContent).toBe(SENTENCE)
  })

  it('goes empty, full, empty, full for the same sentence twice', () => {
    announce(SENTENCE)
    expect(region.textContent).toBe('')
    frames.shift()?.()
    expect(region.textContent).toBe(SENTENCE)
    announce(SENTENCE)
    expect(
      region.textContent,
      'emptied again for the second, though it is the sentence shown',
    ).toBe('')
    frames.shift()?.()
    expect(region.textContent).toBe(SENTENCE)
    // The first empty text met an empty region and changed nothing; the
    // second is the one that matters, and it is a change.
    expect(written()).toEqual([SENTENCE, '', SENTENCE])
  })

  it('does so when the second end comes in the frame the first was waiting on and no render ran between', async () => {
    // The starved window: every step happens in one turn, inside one act,
    // so a render scheduled by any of them has not run when the next does.
    await act(async () => {
      announce(SENTENCE)
      frames.shift()?.()
      announce(SENTENCE)
      frames.shift()?.()
    })
    expect(written()).toEqual([SENTENCE, '', SENTENCE])
    expect(region.textContent).toBe(SENTENCE)
  })

  it('says two ends that arrive before the frame together, in one pass through empty', () => {
    announce('A: Layout run, finished.')
    announce('B: Export as x, cancelled.')
    expect(frames).toHaveLength(1)
    frames.shift()?.()
    expect(written()).toEqual(['A: Layout run, finished. B: Export as x, cancelled.'])
  })

  it("draws no children, whatever it is given: a text of React's own would be lost to the writer", async () => {
    // The type refuses `children` (below); this is the same refusal at run
    // time, for a caller that got past it.
    await act(async () => view.rerender(<Region extra={{ children: 'text of its own' }} />))
    expect(region.firstChild).toBeNull()
    expect(region.textContent).toBe('')
    // @ts-expect-error a live region takes no children
    void (<LiveRegion region={{ current: null }}>text</LiveRegion>)
  })

  it('keeps what it was told across a render of the screen that holds it', async () => {
    announce(SENTENCE)
    frames.shift()?.()
    await act(async () => view.rerender(<Region />))
    expect(region.textContent, 'a render does not give the region children to overwrite it').toBe(
      SENTENCE,
    )
  })
})
