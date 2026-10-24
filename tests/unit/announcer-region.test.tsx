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
// The suite renders nothing to a DOM, and needs none for this: the real
// hook and the real element go through React's own client into a stand-in
// for the few things a `<p>` asks of a document, and the stand-in keeps
// every value its text was set to, which is what a MutationObserver would
// see. No dependency is added (compare line-options-hook.test.tsx).
//
// Mutation, watched failing: `writeToRegion` in src/renderer/src/Jobs.tsx
// putting its text in after a microtask (`queueMicrotask(() => ...)`), which
// is "scheduled, not rendered" - the region is still full when `announce`
// returns, and the first assertion of each test fails.

import { act, type JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAnnouncer } from '../../src/renderer/src/Jobs'

// React's client reads this to know it is driven by `act`.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * An element as far as React's client and a ref reach one. Its text is a
 * property whose every assignment is kept, in order: a write of the same
 * text is still a write, as it is to a real element, whose children are
 * replaced.
 */
class StandInElement {
  readonly nodeType = 1
  readonly attributes: Record<string, string> = {}
  readonly written: string[] = []
  #text = ''
  readonly #children: StandInElement[] = []
  constructor(
    readonly tagName: string,
    readonly ownerDocument: unknown,
  ) {}
  get nodeName(): string {
    return this.tagName
  }
  get firstChild(): StandInElement | null {
    return this.#children[0] ?? null
  }
  get textContent(): string {
    return this.#text
  }
  set textContent(text: string) {
    this.#text = text
    this.written.push(text)
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value
  }
  appendChild(child: StandInElement): StandInElement {
    this.#children.push(child)
    return child
  }
  removeChild(child: StandInElement): StandInElement {
    this.#children.splice(this.#children.indexOf(child), 1)
    return child
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}

/** The container `createRoot` asks for, in a document that makes the elements. */
function container(): StandInElement {
  const document: Record<string, unknown> = {
    nodeType: 9,
    activeElement: null,
    body: null,
    createElement: (tag: string) => new StandInElement(tag.toUpperCase(), document),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
  const window = { document, HTMLIFrameElement: class {} }
  document.defaultView = window
  vi.stubGlobal('window', window)
  return new StandInElement('DIV', document)
}

let announce: (sentence: string) => void
/** The frames the announcer waits on, run by hand: a frame is a thing that happens or does not. */
let frames: (() => void)[]

/** The window's own live region, as App draws it, over the hook it uses. */
function Region(): JSX.Element {
  const hook = useAnnouncer((then) => frames.push(then))
  announce = hook.announce
  return (
    <p
      ref={hook.region}
      className="visually-hidden"
      role="status"
      aria-live="polite"
      data-announces="jobs"
    />
  )
}

let root: Root
let region: StandInElement
let mounted = false

beforeEach(async () => {
  frames = []
  const into = container()
  root = createRoot(into as unknown as Element)
  mounted = true
  await act(async () => root.render(<Region />))
  region = into.firstChild as StandInElement
})

afterEach(() => {
  if (mounted) act(() => root.unmount())
  mounted = false
  vi.unstubAllGlobals()
})

const SENTENCE = 'Los Angeles: Layout run, failed.'

describe('the jobs live region, rendered', () => {
  it('is the element React drew, with the attributes a reader needs', () => {
    expect(region.tagName).toBe('P')
    expect(region.attributes).toMatchObject({
      role: 'status',
      'aria-live': 'polite',
      'data-announces': 'jobs',
    })
    // React gave it no text of its own to overwrite or to lose.
    expect(region.written).toEqual([])
  })

  it('is empty when the announcement returns, before any frame, then full a frame later', () => {
    announce(SENTENCE)
    expect(region.textContent, 'cleared at once, with no render between').toBe('')
    expect(frames).toHaveLength(1)
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
    expect(region.written).toEqual(['', SENTENCE, '', SENTENCE])
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
    expect(region.written).toEqual(['', SENTENCE, '', SENTENCE])
    expect(region.textContent).toBe(SENTENCE)
  })

  it('says two ends that arrive before the frame together, in one pass through empty', () => {
    announce('A: Layout run, finished.')
    announce('B: Export as x, cancelled.')
    expect(frames).toHaveLength(1)
    frames.shift()?.()
    expect(region.written).toEqual(['', 'A: Layout run, finished. B: Export as x, cancelled.'])
  })

  it('keeps what it was told across a render of the screen that holds it', async () => {
    announce(SENTENCE)
    frames.shift()?.()
    await act(async () => root.render(<Region />))
    expect(region.textContent, 'a render does not give the region children to overwrite it').toBe(
      SENTENCE,
    )
  })
})
