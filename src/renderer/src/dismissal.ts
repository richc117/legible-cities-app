import { useEffect, useRef, type RefObject } from 'react'

// A tooltip a person sent away with Escape stays away until the pointer and
// the focus have both left what it belongs to (WCAG 1.4.13). The first
// version cleared the mark on one edge event, the pointer's leave, and one
// leave that was not delivered - or a leave that came while the focus was
// still inside - kept the mark for good (issue 327). So the mark follows
// state instead: wherever the pointer and the focus are now, a mark on
// anything else goes, and the events that say where they are now are
// watched for as long as a mark is showing.

/**
 * The marks that stand. A dismissal is kept only while its owner is still
 * under the pointer or holds the focus; every other one is over. The array
 * it was given comes back when nothing goes, so a state set from it does
 * not draw again.
 */
export function keepDismissed(
  dismissed: readonly string[],
  hoveredKey: string | null,
  focusedKey: string | null,
): readonly string[] {
  const kept = dismissed.filter((key) => key === hoveredKey || key === focusedKey)
  return kept.length === dismissed.length ? dismissed : kept
}

/**
 * The key of the owner a node is inside, read from the attribute that
 * names it, or null for anything else: no node, the document, a node
 * outside every owner. Typed for what it uses so that a test needs no DOM.
 */
export function keyOf(
  node: { closest?: (selector: string) => Element | null } | null | undefined,
  attribute: string,
): string | null {
  if (typeof node?.closest !== 'function') return null
  return node.closest(`[${attribute}]`)?.getAttribute(attribute) ?? null
}

/**
 * While a mark is showing, re-apply the rule to whatever the document says
 * about the pointer and the focus: a pointer moving, a pointer leaving the
 * document, the focus arriving and the focus leaving. These are listened
 * for in the capture phase on the document, so that nothing between the
 * target and the document can stop them, and they replace the two
 * boundary events a component's own handlers would have to catch. `hovered`
 * is the component's record of what is under the pointer, which this keeps
 * true as well. Returns the way to stop.
 */
export function watchDismissals(
  attribute: string,
  hovered: RefObject<string | null>,
  apply: (hoveredKey: string | null, focusedKey: string | null) => void,
): () => void {
  const focusedNow = (): string | null => keyOf(document.activeElement, attribute)
  const onMove = (event: PointerEvent): void => {
    hovered.current = keyOf(event.target as Element | null, attribute)
    apply(hovered.current, focusedNow())
  }
  // A pointer that leaves the document is an out with nowhere to go. It
  // is the one boundary event the moves above cannot stand in for.
  const onOut = (event: PointerEvent): void => {
    if (event.relatedTarget !== null) return
    hovered.current = null
    apply(null, focusedNow())
  }
  const onFocusIn = (event: FocusEvent): void =>
    apply(hovered.current, keyOf(event.target as Element | null, attribute))
  // The element losing focus is still the active one while its focusout is
  // dispatched, so the answer is where the focus is going, which is the
  // event's related target (null when it goes nowhere).
  const onFocusOut = (event: FocusEvent): void =>
    apply(hovered.current, keyOf(event.relatedTarget as Element | null, attribute))

  document.addEventListener('pointermove', onMove, true)
  document.addEventListener('pointerout', onOut, true)
  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('focusout', onFocusOut, true)
  return () => {
    document.removeEventListener('pointermove', onMove, true)
    document.removeEventListener('pointerout', onOut, true)
    document.removeEventListener('focusin', onFocusIn, true)
    document.removeEventListener('focusout', onFocusOut, true)
  }
}

/**
 * Watch for as long as `showing` says a mark stands, and not otherwise, so
 * that a page with nothing dismissed pays for no listener on every pointer
 * move. `apply` may change on every render.
 */
export function useDismissalWatch(
  attribute: string,
  showing: boolean,
  hovered: RefObject<string | null>,
  apply: (hoveredKey: string | null, focusedKey: string | null) => void,
): void {
  const latest = useRef(apply)
  useEffect(() => {
    latest.current = apply
  })
  useEffect(() => {
    if (!showing) return undefined
    return watchDismissals(attribute, hovered, (over, focused) => latest.current(over, focused))
  }, [attribute, showing, hovered])
}
