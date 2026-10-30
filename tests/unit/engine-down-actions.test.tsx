// @vitest-environment jsdom
// Where focus goes when Try again is pressed on the Library while the engine
// is down (issue 562): to the Sample cities heading before the bridge is
// asked, since a retry that starts takes the buttons away with the state
// that drew them; and back to Try again when the retry is refused, which
// leaves the button where it was, after the line under it says why. The
// kit's button is the native stub, because jsdom does not delegate focus
// into a shadow root (`tests/support/kit-stubs.ts`).

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EngineDownActions from '../../src/renderer/src/EngineDownActions'
import { SAMPLES_HEADING_ID } from '../../src/renderer/src/SampleCities'
import { RETRY_REFUSALS } from '../../src/shared/engine'
import { answered, byName, cleanup, press, renderPanel } from '../support/render'

vi.mock('../../src/renderer/src/kit/Button', async () =>
  (await import('../support/kit-stubs')).kitButtonStub(),
)

afterEach(cleanup)

function draw(onRetry: () => Promise<string | null>) {
  renderPanel(
    <section>
      <h2 id={SAMPLES_HEADING_ID} tabIndex={-1}>
        Sample cities
      </h2>
      <EngineDownActions
        actions={{ retry: true }}
        onRetry={onRetry}
        onCopyDiagnostics={async () => ''}
        onOpenInstallGuide={async () => undefined}
      />
    </section>,
  )
  return document.getElementById(SAMPLES_HEADING_ID) as HTMLElement
}

const line = (): string | null | undefined => document.querySelector('[role="status"]')?.textContent

describe('Try again and focus (issue 562)', () => {
  it('hands focus to the Sample cities heading before the bridge is asked', async () => {
    let focusedWhenAsked: Element | null = null
    const heading = draw(async () => {
      focusedWhenAsked = document.activeElement
      return null
    })
    act(() => byName('button', 'Try again').focus())
    press('Try again')
    await answered()
    expect(focusedWhenAsked).toBe(heading)
    expect(document.activeElement).toBe(heading)
    expect(line()).toBe('')
  })

  it('puts focus back on Try again when the retry is refused, after saying why', async () => {
    draw(async () => RETRY_REFUSALS.stillStopping)
    act(() => byName('button', 'Try again').focus())
    press('Try again')
    await answered()
    expect(line()).toBe(RETRY_REFUSALS.stillStopping)
    expect(document.activeElement).toBe(byName('button', 'Try again'))
  })

  it('puts focus back on Try again when the bridge itself fails', async () => {
    draw(async () => {
      throw new Error('forbidden')
    })
    press('Try again')
    await answered()
    expect(line()).toBe('The engine could not be asked to start again: forbidden.')
    expect(document.activeElement).toBe(byName('button', 'Try again'))
  })
})
