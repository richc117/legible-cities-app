// The kit button's description (issue 113, docs/accessibility.md F5): the
// wrapper keeps aria-describedby away from the kit, which would copy the id
// into its shadow root where it resolves to nothing, and mirrors the
// described text onto the inner button as aria-description instead. The
// syncing is a function over a root, a target and a watcher, so it is
// tested here without a browser; tests/e2e/settings.spec.ts holds the
// description in the built app.
//
// The state the wrapper mirrors (issue 124): the kit re-syncs its inner
// button whenever the host's `disabled` changes and removes aria-pressed on
// the way, so the wrapper writes `disabled` first and the mirrored state
// after, in one function. A stand-in kit below does what fig.js does
// synchronously inside `setAttribute`; tests/e2e/theme.spec.ts holds the
// pressed state through a rebuild in the built app.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Button, {
  describedText,
  mirrorDescription,
  syncKitButton,
  type DescriptionRoot,
  type DescriptionTarget,
  type KitHost,
  type KitState,
  type WatchRoot,
} from '../../src/renderer/src/kit/Button'

function fakeRoot(texts: Record<string, string | null>): DescriptionRoot & {
  texts: Record<string, string | null>
} {
  return {
    texts,
    getElementById(id) {
      return Object.hasOwn(this.texts, id) ? { textContent: this.texts[id] } : null
    },
  }
}

function fakeTarget(): DescriptionTarget & { attrs: Map<string, string>; writes: number } {
  return {
    attrs: new Map(),
    writes: 0,
    getAttribute(name) {
      return this.attrs.get(name) ?? null
    },
    setAttribute(name, value) {
      this.writes += 1
      this.attrs.set(name, value)
    },
    removeAttribute(name) {
      this.writes += 1
      this.attrs.delete(name)
    },
  }
}

function fakeWatch(): WatchRoot & { fire: () => void; watching: number; stopped: number } {
  const callbacks = new Set<() => void>()
  const watch = Object.assign(
    (_root: DescriptionRoot, callback: () => void) => {
      callbacks.add(callback)
      watch.watching += 1
      return () => {
        callbacks.delete(callback)
        watch.stopped += 1
      }
    },
    {
      watching: 0,
      stopped: 0,
      fire: () => callbacks.forEach((callback) => callback()),
    },
  )
  return watch
}

describe('describedText', () => {
  it('joins the named elements in order, whitespace collapsed, skipping missing and empty ones', () => {
    const root = fakeRoot({ a: '  The file\n  is missing. ', b: '', c: 'Try again.', d: null })
    expect(describedText(root, 'a b missing c d')).toBe('The file is missing. Try again.')
    expect(describedText(root, '  c   a ')).toBe('Try again. The file is missing.')
    expect(describedText(root, 'missing')).toBe('')
    expect(describedText(root, '')).toBe('')
  })
})

describe('mirrorDescription', () => {
  it('writes the described text at once, and nothing more while it holds', () => {
    const root = fakeRoot({ why: 'Not bundled in a development run.' })
    const target = fakeTarget()
    const watch = fakeWatch()
    mirrorDescription(target, root, 'why', watch)
    expect(target.attrs.get('aria-description')).toBe('Not bundled in a development run.')
    expect(target.attrs.has('aria-describedby')).toBe(false)
    expect(watch.watching).toBe(1)
    const writes = target.writes
    watch.fire()
    watch.fire()
    expect(target.writes).toBe(writes)
  })

  it('follows the text as it changes, empties and comes back', () => {
    const root = fakeRoot({ why: 'One run is going.' })
    const target = fakeTarget()
    const watch = fakeWatch()
    mirrorDescription(target, root, 'why', watch)
    root.texts.why = 'Two runs are going.'
    watch.fire()
    expect(target.attrs.get('aria-description')).toBe('Two runs are going.')
    root.texts.why = '  '
    watch.fire()
    expect(target.attrs.has('aria-description')).toBe(false)
    delete root.texts.why
    watch.fire()
    expect(target.attrs.has('aria-description')).toBe(false)
    // An element that arrives after the button, or replaces the old one.
    root.texts.why = 'Back.'
    watch.fire()
    expect(target.attrs.get('aria-description')).toBe('Back.')
  })

  it('leaves no description and stops watching when the prop is removed or the button unmounts', () => {
    const root = fakeRoot({ why: 'A reason.' })
    const target = fakeTarget()
    const watch = fakeWatch()
    const stop = mirrorDescription(target, root, 'why', watch)
    expect(target.attrs.get('aria-description')).toBe('A reason.')

    // The prop removed: the effect's cleanup, then the effect again without it.
    stop()
    expect(watch.stopped).toBe(1)
    expect(target.attrs.has('aria-description')).toBe(false)
    const again = mirrorDescription(target, root, undefined, watch)
    expect(watch.watching).toBe(1)
    root.texts.why = 'Changed while not described.'
    watch.fire()
    expect(target.attrs.has('aria-description')).toBe(false)
    again()
    expect(target.attrs.has('aria-description')).toBe(false)

    // Described again, then unmounted: the watcher is let go.
    const last = mirrorDescription(target, root, 'why', watch)
    expect(target.attrs.get('aria-description')).toBe('Changed while not described.')
    expect(watch.watching).toBe(2)
    last()
    expect(watch.stopped).toBe(2)
    root.texts.why = 'After unmount.'
    watch.fire()
    expect(target.attrs.has('aria-description')).toBe(false)
  })
})

describe('Button', () => {
  it('does not hand aria-describedby to the kit, which would copy it where it resolves to nothing', () => {
    const html = renderToStaticMarkup(
      <Button aria-describedby="why" aria-label="Open the notices">
        Open
      </Button>,
    )
    expect(html).toContain('<fig-button')
    expect(html).toContain('aria-label="Open the notices"')
    expect(html).not.toContain('aria-describedby')
  })
})

/**
 * A stand-in for FigUI3's fig-button as far as `disabled` goes: a change of
 * the attribute re-syncs the inner button synchronously, inside the call
 * that made it, and an unchanged value does nothing (fig.js,
 * `attributeChangedCallback` and `#syncButtonAttributes`). The real kit
 * removes aria-pressed from the host and the inner button there; `harsh`
 * removes everything the wrapper mirrors, as a later kit could.
 */
function fakeKit(harsh = false): KitHost & {
  attrs: Map<string, string>
  inner: ReturnType<typeof fakeTarget>
  resyncs: number
} {
  const inner = fakeTarget()
  const resync = (): void => {
    kit.resyncs += 1
    kit.attrs.delete('aria-pressed')
    inner.attrs.delete('aria-pressed')
    // The kit copies these from the host, where the wrapper puts none of them.
    for (const name of ['aria-label', 'aria-labelledby', 'aria-describedby', 'title'])
      inner.attrs.delete(name)
    if (harsh) {
      for (const name of ['aria-expanded', 'aria-disabled', 'aria-controls'])
        inner.attrs.delete(name)
      kit.attrs.delete('data-unavailable')
    }
  }
  const kit = {
    attrs: new Map<string, string>(),
    inner,
    resyncs: 0,
    shadowRoot: { querySelector: () => inner },
    setAttribute(name: string, value: string) {
      const old = kit.attrs.get(name) ?? null
      kit.attrs.set(name, value)
      if (name === 'disabled' && old !== value) resync()
    },
    removeAttribute(name: string) {
      const had = kit.attrs.has(name)
      kit.attrs.delete(name)
      if (name === 'disabled' && had) resync()
    },
  }
  return kit
}

describe('syncKitButton', () => {
  const toggle: KitState = { disabled: false, pressed: true }

  it("keeps a toggle pressed through the kit's re-sync as it disables and enables again", () => {
    const kit = fakeKit()
    syncKitButton(kit, toggle)
    expect(kit.inner.attrs.get('aria-pressed')).toBe('true')

    syncKitButton(kit, { ...toggle, disabled: true })
    expect(kit.resyncs).toBe(1)
    expect(kit.attrs.has('disabled')).toBe(true)
    expect(kit.inner.attrs.get('aria-pressed')).toBe('true')

    syncKitButton(kit, toggle)
    expect(kit.resyncs).toBe(2)
    expect(kit.attrs.has('disabled')).toBe(false)
    expect(kit.inner.attrs.get('aria-pressed')).toBe('true')

    // And the other button of the pair, not pressed, says so rather than nothing.
    const other = fakeKit()
    syncKitButton(other, { disabled: true, pressed: false })
    syncKitButton(other, { disabled: false, pressed: false })
    expect(other.inner.attrs.get('aria-pressed')).toBe('false')
  })

  it('keeps every mirrored attribute through a disabled toggle, even from a kit that removes them all', () => {
    const state: KitState = {
      disabled: false,
      expanded: true,
      pressed: false,
      unavailable: true,
      controls: 'panel-1',
    }
    for (const kit of [fakeKit(), fakeKit(true)]) {
      syncKitButton(kit, state)
      syncKitButton(kit, { ...state, disabled: true })
      syncKitButton(kit, state)
      expect(kit.resyncs).toBe(2)
      expect(Object.fromEntries(kit.inner.attrs)).toEqual({
        'aria-expanded': 'true',
        'aria-pressed': 'false',
        'aria-disabled': 'true',
        'aria-controls': 'panel-1',
      })
      expect(kit.attrs.has('data-unavailable')).toBe(true)
    }
  })

  it('removes what is no longer set, and leaves a description it does not own alone', () => {
    const kit = fakeKit(true)
    kit.inner.setAttribute('aria-description', 'One run is going.')
    syncKitButton(kit, { disabled: true, expanded: true, unavailable: true, controls: 'panel-1' })
    syncKitButton(kit, { disabled: false })
    expect(Object.fromEntries(kit.inner.attrs)).toEqual({
      'aria-description': 'One run is going.',
    })
    expect(kit.attrs.has('data-unavailable')).toBe(false)
    expect(kit.attrs.has('disabled')).toBe(false)
  })

  it('writes an unchanged disabled state without making the kit re-sync', () => {
    const kit = fakeKit()
    syncKitButton(kit, { ...toggle, disabled: true })
    syncKitButton(kit, { ...toggle, disabled: true, pressed: false })
    syncKitButton(kit, { disabled: false, pressed: false })
    syncKitButton(kit, { disabled: false, pressed: true })
    expect(kit.resyncs).toBe(2)
    expect(kit.inner.attrs.get('aria-pressed')).toBe('true')
  })
})
