import { useEffect, useRef, type RefObject } from 'react'

// Focus that has nowhere to be (A6-07). A control a person pressed can go
// with the press: a run's "Lay out" gives way to its Cancel, a finished
// run's Cancel to "Lay out again", a row that was removed takes its button
// with it. Chromium then puts focus on the body, and a keyboard or screen
// reader user is thrown back to the top of the document with nothing said.
// These helpers hand focus to the control that took the pressed one's
// place - and only then: focus a person moved anywhere else is theirs.

/** Whether focus has fallen to nowhere: the element that held it went, or was disabled. */
export function focusLost(active: Element | null, body: Element | null): boolean {
  return active === null || active === body
}

/**
 * Whether a region should hand focus to one of its controls after its
 * content changed: only when focus was last inside the region - a press
 * there, or a control there that has just been removed - and has since
 * fallen to the body.
 */
export function shouldHandBack(
  wasInside: boolean,
  active: Element | null,
  body: Element | null,
): boolean {
  return wasInside && focusLost(active, body)
}

/**
 * Keep focus in a region whose controls are replaced as its state changes.
 * `root` is the region, `target` the control focus belongs on in the state
 * just rendered, `change` whatever replaces the controls. Whether focus was
 * inside is followed through `focusin` and `pointerdown` on the document,
 * because a removed element fires nothing on its way out: a press or a
 * focus anywhere else ends it, so a person who has moved on is never
 * pulled back.
 */
export function useFocusHandback(
  root: RefObject<HTMLElement | null>,
  target: () => HTMLElement | null,
  change: unknown,
): void {
  const inside = useRef(false)
  const targetRef = useRef(target)
  useEffect(() => {
    targetRef.current = target
  })

  useEffect(() => {
    inside.current = root.current?.contains(document.activeElement) === true
    const follow = (event: Event): void => {
      inside.current = event.target instanceof Node && root.current?.contains(event.target) === true
    }
    document.addEventListener('focusin', follow, true)
    document.addEventListener('pointerdown', follow, true)
    return () => {
      document.removeEventListener('focusin', follow, true)
      document.removeEventListener('pointerdown', follow, true)
    }
  }, [root])

  useEffect(() => {
    if (!shouldHandBack(inside.current, document.activeElement, document.body)) return
    targetRef.current()?.focus()
  }, [change])
}
