// @vitest-environment jsdom
// A size being typed while the record comes back (issue 659). A theme
// pressed writes the record, and the record that comes back carries the
// same style as a new object, which cell 04's sizes take again. The gate's
// step 8 typed a line width of 30 in that beat and pressed Enter: the field
// had been put back to the engine's 7 under it, so the Enter committed 7,
// and nothing was refused or drawn.
//
// The kit's text input is not defined in jsdom, so its host carries no
// inner input; typing is the custom `input` event the kit dispatches, with
// the value in its detail, which is what the wrapper listens for.
//
// Mutations, watched failing: `style-rules.mutations.json`.

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExportRun } from '../../src/renderer/src/engine/exportRun'
import { styleRangeSentence } from '../../src/shared/project/sentences'
import type { RunState } from '../../src/shared/layout'
import { BASE, cleanup, INSPECTION, renderCell } from '../support/render'

vi.mock('../../src/renderer/src/kit/Button', async () =>
  (await import('../support/kit-stubs')).kitButtonStub(),
)

const exporter = { snapshot: { state: 'idle' as RunState } }

afterEach(cleanup)

/** The kit's host for the field labelled `name`, and the control round it. */
function field(name: string): { host: HTMLElement; control: HTMLElement } {
  const label = [...document.querySelectorAll('label')].find((each) => each.textContent === name)
  const control = label?.parentElement?.querySelector<HTMLElement>('.style-control') ?? null
  const host = control?.firstElementChild as HTMLElement | null
  if (control === null || host === null) throw new Error(`no field is labelled ${name}`)
  return { host, control }
}

describe('a size typed as the record comes back', () => {
  it('keeps the typed figure, so its Enter is refused beside the field (issue 659)', async () => {
    const view = renderCell('style', {
      project: { ...BASE, theme: 'sepia', style: {}, readOnly: false },
      exporter: exporter as unknown as ExportRun,
      exporting: false,
      settling: false,
    })
    await act(async () => {
      await Promise.resolve(INSPECTION)
    })
    const { host, control } = field('Line width')
    act(() => {
      host.dispatchEvent(new CustomEvent('input', { detail: '30', bubbles: true }))
    })
    // Warm dark pressed a moment before: its write comes back as a new
    // record whose style is a new object holding the same nothing.
    view.rerender({
      project: { ...BASE, theme: 'warm-dark', style: {}, readOnly: false },
    })
    expect(host.getAttribute('value'), 'the field still says what was typed').toBe('30')
    act(() => {
      control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    const alert = control.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe(styleRangeSentence('lineWidth'))
  })
})
