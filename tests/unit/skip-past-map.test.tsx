// Skip past the map (issue 106): the control's markup, rendered without a
// browser, and where it sends focus, as the function the project screen
// calls. The end-to-end sweep presses it in the built app, with a page in
// the frame that holds many controls of its own
// (tests/e2e/accessibility.spec.ts).

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import SkipPastMap, { skipTarget, type SkipCandidate } from '../../src/renderer/src/SkipPastMap'

type Candidate = SkipCandidate & { name: string }

const candidate = (
  name: string,
  { disabled = false, connected = true }: { disabled?: boolean; connected?: boolean } = {},
): Candidate => ({
  name,
  isConnected: connected,
  hasAttribute: (attribute: string) => attribute === 'disabled' && disabled,
})

describe('SkipPastMap', () => {
  it('is a native button named for what it passes over, with the class that hides it at rest', () => {
    const html = renderToStaticMarkup(<SkipPastMap onSkip={() => undefined} />)
    expect(html).toBe('<button type="button" class="skip-link">Skip past the map</button>')
  })
})

describe('skipTarget', () => {
  const heading = candidate('heading')

  it("sends focus to the toolbar's first button when it can take it", () => {
    expect(skipTarget([candidate('Rename'), candidate('Delete project')], heading)?.name).toBe(
      'Rename',
    )
  })

  it('passes over a disabled button, as a read-only project has Rename', () => {
    expect(
      skipTarget([candidate('Rename', { disabled: true }), candidate('Delete project')], heading)
        ?.name,
    ).toBe('Delete project')
  })

  it('passes over a button not yet mounted or already gone', () => {
    expect(
      skipTarget([null, candidate('Rename', { connected: false }), candidate('Delete')], heading)
        ?.name,
    ).toBe('Delete')
  })

  it('falls back to the heading when no button can take focus, so focus is never lost', () => {
    expect(
      skipTarget(
        [candidate('Rename', { disabled: true }), candidate('Delete project', { disabled: true })],
        heading,
      )?.name,
    ).toBe('heading')
  })
})
