import { useEffect, useRef, type RefObject } from 'react'

// Focus that has nowhere to be (A6-07). A control a person pressed can go
// with the press: a run's "Lay out" gives way to its Cancel, a finished
// run's Cancel to "Lay out again", a row that was removed takes its button
// with it. Chromium then puts focus on the body, and a keyboard or screen
// reader user is thrown back to the top of the document with nothing said.
// These helpers hand focus to the control that took the pressed one's
// place - and only then: focus a person moved anywhere else is theirs.

/** What the checks read of an element: whether it is still there to hold focus. */
export type Focusable = Pick<Element, 'isConnected' | 'closest'> &
  Partial<Pick<Element, 'matches' | 'hasAttribute' | 'checkVisibility'>>

/**
 * Whether an element can no longer hold focus: it has left the document,
 * sits in a dialog that has closed, is disabled (a kit button carries the
 * attribute on its host), or is not rendered.
 */
export function gone(element: Focusable): boolean {
  if (!element.isConnected) return true
  if (element.closest('dialog:not([open])') !== null) return true
  if (element.matches?.(':disabled') === true || element.hasAttribute?.('disabled') === true)
    return true
  return element.checkVisibility !== undefined && !element.checkVisibility()
}

/**
 * Whether focus has fallen to nowhere: on the body, or on an element that
 * can no longer hold it. Chromium does not always say so at once: it may
 * still report a removed element, or one in a dialog that has just closed,
 * until its next rendering update moves focus to the body - with no event
 * and no render of ours to notice it by. Both count as lost here.
 */
export function focusLost(active: Focusable | null, body: unknown): boolean {
  return active === null || active === body || gone(active)
}

/**
 * Run `then` once the browser has updated the rendering after the current
 * task: after the next animation frame, in the task that follows it. By
 * then React has committed what was set before, a dialog that closed has
 * handed focus back, and focus that had nowhere to be is on the body.
 */
export function afterRendering(then: () => void): void {
  requestAnimationFrame(() => {
    setTimeout(then, 0)
  })
}

/**
 * Whether a region should hand focus to one of its controls after its
 * content changed: only when the element that last took focus was the
 * region's and can no longer hold it, and focus has nowhere else to be.
 * Focus a person put anywhere else - another control, or nowhere, by
 * pressing on prose - is theirs, and `held` is null then.
 */
export function shouldHandBack(
  held: Focusable | null,
  active: Focusable | null,
  body: unknown,
): boolean {
  return held !== null && gone(held) && focusLost(active, body)
}

/**
 * Keep focus in a region whose controls are replaced as its state changes.
 * `root` is the region, `target` the control focus belongs on in the state
 * just rendered, `change` whatever replaces the controls.
 *
 * The element that took focus last is followed through `focusin` on the
 * document, and kept only while it is the region's; a press anywhere
 * forgets it until the focus that press gives is known - a `focusin`, or
 * at the click the element that already had it - so a person who pressed
 * on prose and scrolled away to read is not pulled back when a run ends. A removed element fires nothing on its way out, which is why
 * the element is remembered rather than its leaving waited for. Focus is
 * handed over without scrolling: the control that took the place of the
 * one that went is where that one was.
 */
export function useFocusHandback(
  root: RefObject<HTMLElement | null>,
  target: () => HTMLElement | null,
  change: unknown,
): void {
  const held = useRef<Element | null>(null)
  const targetRef = useRef(target)
  useEffect(() => {
    targetRef.current = target
  })

  useEffect(() => {
    const hold = (element: EventTarget | null): void => {
      held.current =
        element instanceof Element && root.current?.contains(element) === true ? element : null
    }
    const onFocusIn = (event: Event): void => hold(event.target)
    const onPointerDown = (): void => {
      held.current = null
    }
    // A press on a control that already had focus gives no focusin.
    const onClick = (): void => hold(document.activeElement)
    hold(document.activeElement)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [root])

  useEffect(() => {
    if (!shouldHandBack(held.current, document.activeElement, document.body)) return
    held.current = null
    targetRef.current()?.focus({ preventScroll: true })
  }, [change])
}
