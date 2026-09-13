// A confirmation, rendered without a browser (A6-07): idle it offers Cancel
// and says nothing; while its action runs Cancel takes no press, because the
// action cannot be taken back. The running states - the refused presses and
// Escape, the sentence, the platform closing it - are driven in the built
// app (tests/e2e/accessibility.spec.ts).

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ConfirmDialog, { BUSY_SENTENCE, cancelPress } from '../../src/renderer/src/ConfirmDialog'

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
})
