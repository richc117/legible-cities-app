// What the page needs to answer the app's menu (issue 554): whether a modal
// dialog is up, which every command waits behind, and the press of the New
// project card, which is how the menu's New project opens the sheet.
//
// A native accelerator fires whatever the page shows, so Command-comma or
// Control-N would otherwise change the screen behind an open dialog, with
// the dialog still modal over a screen it no longer belongs to. A command
// that arrives then is dropped, as a press on the covered page would be.
//
// New project presses the card rather than opening the sheet some other way:
// the sheet is the Library's, opened from that card and handing focus back
// to it when it closes, so the menu's way in is the card's own, focus
// included. The card is drawn once the Library has read its projects, which
// may be after the screen has changed to it, so the press waits for it.

/** The New project card on the Library (`Card.tsx`'s `create`). */
export const NEW_PROJECT_CARD = 'button.card-new'

/** Whether a page `<dialog>` is open as a modal, which the menu's commands wait behind. */
export function modalOpen(doc: Document): boolean {
  return doc.querySelector('dialog:modal') !== null
}

/**
 * Call `then` with the first element under `root` matching `selector`, now
 * if there is one, else as soon as one is added. Returns the way to stop
 * waiting; once it has been called, it never calls again.
 */
export function whenPresent<T extends Element>(
  root: Element,
  selector: string,
  then: (element: T) => void,
): () => void {
  const now = root.querySelector<T>(selector)
  if (now !== null) {
    then(now)
    return () => undefined
  }
  const observer = new MutationObserver(() => {
    const found = root.querySelector<T>(selector)
    if (found === null) return
    observer.disconnect()
    then(found)
  })
  observer.observe(root, { childList: true, subtree: true })
  return () => observer.disconnect()
}
