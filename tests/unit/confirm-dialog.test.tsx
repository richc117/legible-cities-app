// A confirmation, rendered without a browser (A6-07): idle it offers Cancel
// and says nothing; while its action runs Cancel takes no press, because the
// action cannot be taken back - unless the action is one the engine can be
// asked to stop (issue 351), when Cancel takes one press that asks for it.
// The running states - the refused presses and Escape, the sentence, the
// platform closing it - are driven in the built app
// (tests/e2e/accessibility.spec.ts and tests/e2e/feeds.spec.ts).

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ConfirmDialog, {
  BUSY_SENTENCE,
  busySentence,
  CANCEL_LABEL,
  cancelPress,
  stopState,
} from '../../src/renderer/src/ConfirmDialog'

describe('ConfirmDialog', () => {
  const markup = renderToStaticMarkup(
    <ConfirmDialog
      open={false}
      title="Remove Metro de Prueba?"
      description="This forgets the feed."
      confirmLabel="Remove"
      busyLabel="Removing Metro de Prueba…"
      onConfirm={() => Promise.resolve()}
      onCancel={() => undefined}
    />,
  )

  it('offers Cancel and the action, with a status line that says nothing until it runs', () => {
    expect(markup).toContain('Cancel')
    expect(markup).toContain('Remove')
    expect(markup).toMatch(/<p class="message" role="status"><\/p>/)
    expect(markup).not.toContain(BUSY_SENTENCE)
  })

  it('cancels before the action, and refuses the press while it runs', () => {
    expect(cancelPress(false)).toBe('cancel')
    expect(cancelPress(true)).toBe('refuse')
  })

  it('names its safe button in the caller’s words where Cancel would mean something else', () => {
    // The quit's question (issue 552): beside a running export, Cancel
    // already means stopping it. Mutations (`confirm-dialog.mutations.json`):
    // the label not drawn - the button reads Cancel whatever was given; the
    // default taken away - every other confirmation's safe button is blank.
    const asked = renderToStaticMarkup(
      <ConfirmDialog
        open={false}
        title="Quit while an export is running?"
        description="The export of Paris has not finished."
        confirmLabel="Quit anyway"
        cancelLabel="Keep working"
        busyLabel="Quitting…"
        onConfirm={() => Promise.resolve()}
        onCancel={() => undefined}
      />,
    )
    expect(asked).toContain('Keep working')
    expect(asked).not.toContain('Cancel')
    // The safe button is still the first of the two.
    expect(asked.indexOf('Keep working')).toBeLessThan(asked.indexOf('Quit anyway'))
    expect(CANCEL_LABEL).toBe('Cancel')
  })
})

describe('Cancel while the action runs', () => {
  const stoppable = {
    onStop: () => undefined,
    sentence: 'Cancel stops it.',
    asked: 'Cancelling.',
  }

  it('asks an action that can be stopped to stop, once, and refuses every press after', () => {
    expect(cancelPress(true, stopState(true, false))).toBe('stop')
    expect(cancelPress(true, stopState(true, true))).toBe('refuse')
  })

  it('refuses an action that cannot be stopped, and cancels the dialog before any action', () => {
    expect(cancelPress(true, stopState(false, false))).toBe('refuse')
    expect(cancelPress(true)).toBe('refuse')
    expect(cancelPress(false, stopState(true, false))).toBe('cancel')
    expect(cancelPress(false, stopState(false, false))).toBe('cancel')
  })

  it('says it cannot be stopped unless it can, and then what Cancel does, and then that it was asked', () => {
    expect(busySentence(undefined, false)).toBe(BUSY_SENTENCE)
    expect(busySentence(undefined, true)).toBe(BUSY_SENTENCE)
    expect(busySentence(stoppable, false)).toBe('Cancel stops it.')
    expect(busySentence(stoppable, true)).toBe('Cancelling.')
  })
})
