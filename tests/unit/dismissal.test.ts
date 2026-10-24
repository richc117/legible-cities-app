import { afterEach, describe, expect, it, vi } from 'vitest'
import { keepDismissed, keyOf, watchDismissals } from '../../src/renderer/src/dismissal'

// The rule behind an Escape-dismissed tooltip (issue 327): a mark is kept
// only while its owner is under the pointer or holds the focus, whatever
// events were missed on the way. The rule is pure; the watcher is tested
// against a stand-in document, because the unit suite has no DOM.

describe('keepDismissed', () => {
  const marks = ['a:up', 'a:down']

  it('keeps a mark whose arrow the pointer is still over', () => {
    expect(keepDismissed(marks, 'a:up', null)).toEqual(['a:up'])
  })

  it('keeps a mark whose arrow still holds the focus', () => {
    expect(keepDismissed(marks, null, 'a:down')).toEqual(['a:down'])
  })

  it('keeps a mark held by the pointer on one arrow and another by the focus', () => {
    expect(keepDismissed(marks, 'a:up', 'a:down')).toEqual(marks)
  })

  it('ends every mark when the pointer and the focus have both left', () => {
    expect(keepDismissed(marks, null, null)).toEqual([])
  })

  it('ends the mark on an arrow the pointer is no longer over, when the focus is elsewhere', () => {
    expect(keepDismissed(marks, 'b:up', 'b:down')).toEqual([])
  })

  it('hands back the same array when nothing goes, so a state set from it does not draw', () => {
    expect(keepDismissed(marks, 'a:up', 'a:down')).toBe(marks)
    const none: readonly string[] = []
    expect(keepDismissed(none, null, null)).toBe(none)
  })
})

describe('keyOf', () => {
  const owner = (key: string): { closest: (selector: string) => unknown } => ({
    closest: (selector) =>
      selector === '[data-arrow]'
        ? { getAttribute: (name: string) => (name === 'data-arrow' ? key : null) }
        : null,
  })

  it('reads the key of the owner a node is inside', () => {
    expect(keyOf(owner('a:up') as never, 'data-arrow')).toBe('a:up')
  })

  it('is null for a node outside every owner, for no node, and for what has no closest', () => {
    expect(keyOf(owner('a:up') as never, 'data-metric')).toBeNull()
    expect(keyOf(null, 'data-arrow')).toBeNull()
    expect(keyOf(undefined, 'data-arrow')).toBeNull()
    expect(keyOf({} as never, 'data-arrow')).toBeNull()
  })
})

describe('watchDismissals', () => {
  type Handler = (event: unknown) => void
  const listeners = new Map<string, Set<Handler>>()
  const fake = {
    activeElement: null as unknown,
    addEventListener: (type: string, handler: Handler, capture: boolean): void => {
      expect(capture, `${type} is listened for in the capture phase`).toBe(true)
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(handler)
    },
    // A listener added in the capture phase is removed only by a removal in
    // the capture phase, as the platform has it; a cleanup that forgot the
    // flag would leave every listener on the page.
    removeEventListener: (type: string, handler: Handler, capture: boolean): void => {
      if (capture === true) listeners.get(type)?.delete(handler)
    },
  }
  const fire = (type: string, event: object): void =>
    listeners.get(type)?.forEach((handler) => handler(event))
  const inside = (key: string | null): unknown =>
    key === null ? { closest: () => null } : { closest: () => ({ getAttribute: () => key }) }

  const start = (): {
    hovered: { current: string | null }
    seen: Array<[string | null, string | null]>
    stop: () => void
  } => {
    vi.stubGlobal('document', fake)
    const hovered = { current: null as string | null }
    const seen: Array<[string | null, string | null]> = []
    const stop = watchDismissals('data-arrow', hovered, (over, focused) =>
      seen.push([over, focused]),
    )
    return { hovered, seen, stop }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    listeners.clear()
    fake.activeElement = null
  })

  it('reads the arrow under a moving pointer, and the arrow that holds the focus', () => {
    const { hovered, seen } = start()
    fake.activeElement = inside('a:down')
    fire('pointermove', { target: inside('a:up') })
    expect(seen).toEqual([['a:up', 'a:down']])
    expect(hovered.current).toBe('a:up')
    fire('pointermove', { target: inside(null) })
    expect(seen.at(-1)).toEqual([null, 'a:down'])
    expect(hovered.current).toBeNull()
  })

  it('takes a pointer that leaves the document as having left the arrow', () => {
    const { hovered, seen } = start()
    hovered.current = 'a:up'
    fire('pointerout', { relatedTarget: null })
    expect(seen).toEqual([[null, null]])
    expect(hovered.current).toBeNull()
  })

  it('leaves a pointer that moves from one element to another to the moves', () => {
    const { seen } = start()
    fire('pointerout', { relatedTarget: inside('a:up') })
    expect(seen).toEqual([])
  })

  it('reads the focus arriving, with the pointer where it was', () => {
    const { hovered, seen } = start()
    hovered.current = 'a:up'
    fire('focusin', { target: inside('a:down') })
    expect(seen).toEqual([['a:up', 'a:down']])
  })

  it('reads the focus leaving by where it goes, since the element is still active while it leaves', () => {
    const { hovered, seen } = start()
    hovered.current = 'a:up'
    fake.activeElement = inside('a:down')
    fire('focusout', { relatedTarget: null })
    expect(seen).toEqual([['a:up', null]])
    fire('focusout', { relatedTarget: inside('a:up') })
    expect(seen.at(-1)).toEqual(['a:up', 'a:up'])
  })

  it('stops listening when stopped', () => {
    const { seen, stop } = start()
    stop()
    fire('pointermove', { target: inside('a:up') })
    fire('pointerout', { relatedTarget: null })
    fire('focusin', { target: inside('a:up') })
    fire('focusout', { relatedTarget: null })
    expect(seen).toEqual([])
    expect([...listeners.values()].every((set) => set.size === 0)).toBe(true)
  })
})
