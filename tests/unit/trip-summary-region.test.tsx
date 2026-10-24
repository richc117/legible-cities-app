// The trip's summary, rendered, with what reaches its text (issue 466, the
// sibling of issue 330): the same summary announced twice, which is what a
// new view of the same trip is, has to leave the region empty, full, empty,
// full, because a screen reader hears a change and nothing else.
//
// The summary was once a state setter's: `setSummary('')` and, two frames
// later, `setSummary(said)`. A window that ran both frames before React
// rendered had the refill join the clear's batch, equal to what the region
// already showed, and nothing reached the DOM. The component is now the real
// `TripSummary` from Trip.tsx, rendered through React's own client into a
// stand-in for the few things a `<p>` asks of a document (the stand-in is
// announcer-region.test.tsx's, which keeps every value a text was set to,
// as a MutationObserver would see them).
//
// Mutation, watched failing: `TripSummary` back to the state setter's shape
// (`const [summary, setSummary] = useState('')`, an effect calling
// `setSummary('')` and then `setSummary(said)` from the second frame, and a
// `<p className="prose trip-summary" role="status">{summary}</p>`), under a
// render that batches the clear and the refill; the repeat's tests fail on
// the region never being seen empty the second time.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TripSummary } from '../../src/renderer/src/Trip'
import type { Trip, TripAnswer } from '../../src/shared/trip'

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

/** The frames the announcer waits on, run by hand: a frame is a thing that happens or does not. */
let frames: (() => void)[]

const TRIP: Trip = {
  from: 'a',
  to: 'c',
  legs: [{ line: 'A', towards: 'c', board: 'a', alight: 'c', stops: 2 }],
  changes: 0,
  reason: null,
  hidden: [],
}
const SAID = '2 stops, no changes.'
/** A view of the page's answer: a new object each time, as a re-read answer is. */
const viewOf = (trip: Trip = TRIP): TripAnswer => ({ kind: 'trip', trip: { ...trip } })
const NONE: TripAnswer = { kind: 'none' }

let root: Root
let region: StandInElement
let mounted = false

const show = (view: TripAnswer) =>
  act(async () => root.render(<TripSummary view={view} nextFrame={(then) => frames.push(then)} />))

beforeEach(async () => {
  frames = []
  const into = container()
  root = createRoot(into as unknown as Element)
  mounted = true
  await show(NONE)
  region = into.firstChild as StandInElement
})

afterEach(() => {
  if (mounted) act(() => root.unmount())
  mounted = false
  vi.unstubAllGlobals()
})

describe("the trip's summary, rendered", () => {
  it('is a status region React drew with no text of its own, and says nothing for no trip', () => {
    expect(region.tagName).toBe('P')
    expect(region.attributes).toMatchObject({ role: 'status', class: 'prose trip-summary' })
    expect(region.textContent).toBe('')
    expect(frames).toHaveLength(0)
  })

  it('is empty at once and full a frame later, and not before', async () => {
    await show(viewOf())
    expect(frames).toHaveLength(1)
    expect(region.textContent).toBe('')
    frames.shift()?.()
    expect(region.textContent).toBe(SAID)
  })

  it('goes empty, full, empty, full when the same trip is shown again as a new view', async () => {
    await show(viewOf())
    frames.shift()?.()
    expect(region.textContent).toBe(SAID)
    // The page answered again with the same legs: a new object, the same words.
    await show(viewOf())
    expect(region.textContent, 'emptied again, though it is the sentence shown').toBe('')
    frames.shift()?.()
    expect(region.textContent).toBe(SAID)
    expect(region.written.filter((text) => text !== '')).toEqual([SAID, SAID])
    // Every sentence is preceded by a pass through empty.
    const passes = region.written.filter((text, i) => text === '' && region.written[i + 1] === SAID)
    expect(passes).toHaveLength(2)
  })

  it('is empty, full, empty, full in a starved window, where the frames run before any render', async () => {
    // Every step in one turn inside one act, so a render scheduled by any of
    // them has not run when the next does: the case a state setter lost.
    await act(async () => {
      root.render(<TripSummary view={viewOf()} nextFrame={(then) => frames.push(then)} />)
    })
    await act(async () => {
      frames.shift()?.()
      root.render(<TripSummary view={viewOf()} nextFrame={(then) => frames.push(then)} />)
    })
    await act(async () => {
      frames.shift()?.()
    })
    expect(region.textContent).toBe(SAID)
    const sentences = region.written.filter((text) => text !== '')
    expect(sentences).toEqual([SAID, SAID])
    expect(region.written.indexOf(SAID, region.written.indexOf(SAID) + 1)).toBeGreaterThan(
      region.written.indexOf('', region.written.indexOf(SAID)),
    )
  })

  it('empties at once when the trip goes, and a sentence still waiting is not said after it', async () => {
    await show(viewOf())
    expect(frames).toHaveLength(1)
    await show(NONE)
    expect(region.textContent).toBe('')
    frames.shift()?.()
    expect(region.textContent, 'the withdrawn sentence came after the trip had gone').toBe('')
    expect(region.written.filter((text) => text !== '')).toEqual([])
  })

  it('says only the latest trip when the view changes again before the frame', async () => {
    await show(viewOf())
    await show(viewOf({ ...TRIP, legs: [{ ...TRIP.legs[0], stops: 5 }], changes: 1 }))
    for (const frame of frames.splice(0)) frame()
    expect(region.textContent).toBe('5 stops, 1 change.')
    expect(region.written.filter((text) => text !== '')).toEqual(['5 stops, 1 change.'])
  })
})
