// The export run hands focus from its Cancel to its Reveal when the export
// finishes (A6-07, `focusHandback.ts`), with the kit real: a browser test
// (ADR-059), in Playwright's Chromium, because the hand-back lands on a
// `<fig-button>` and only a browser delegates focus from the host into its
// shadow root. jsdom leaves `host.focus()` on the host and moves nothing, so
// there this test could pass only with the kit replaced.
//
// It is the browser project's first test, and what proves the project on
// the three platforms CI runs it on.
//
// The run is the real `ExportRun` on a bridge that starts nothing in main:
// its export is answered when the test says. Controls are found as a person
// finds them, by role and name, through the kit's shadow roots.
//
// Mutation, watched failing: the `focus()` call taken out of
// `useFocusHandback` in `focusHandback.ts`
// (`targetRef.current()?.focus({ preventScroll: true })` made
// `targetRef.current()`) - the test fails on where focus went: the body.

import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import type { ExportChoice, ExportResult } from '../../src/shared/export'
import { ExportRun, type ExportBridge } from '../../src/renderer/src/engine/exportRun'
import ExportRunPanel from '../../src/renderer/src/ExportRun'
import { BASE, READY, renderPanel, type RenderedPanel } from '../support/render'

const CHOICE: ExportChoice = { preset: 'instagram-reel', options: {} }

/** The button a person would find by this name: the kit's inner `<button>`. */
const button = async (name: string): Promise<HTMLElement> =>
  (await page.getByRole('button', { name, exact: true }).element()) as HTMLElement

/** The element focus is on for a button inside a shadow root: its host, as the document sees it. */
const hostOf = (element: Element): Element => {
  const root = element.getRootNode()
  return root instanceof ShadowRoot ? root.host : element
}

/** Where focus is, said for a failure: the element, and its label where it has one. */
const said = (element: Element | null): string =>
  element === null ? 'nothing' : `<${element.localName}>${element.getAttribute('aria-label') ?? ''}`

let view: RenderedPanel | null = null

afterEach(() => {
  view?.unmount()
  view = null
})

describe('the export run, in a browser, with the kit', () => {
  it('moves focus from the Cancel that went to the Reveal that came when the export finishes', async () => {
    let finish!: (result: ExportResult) => void
    const bridge: ExportBridge = {
      run: () => ({
        id: 'export-1',
        result: new Promise<ExportResult>((resolve) => {
          finish = resolve
        }),
      }),
      cancel: async () => undefined,
      reveal: async () => undefined,
      onProgress: () => () => undefined,
    }
    const run = new ExportRun(bridge)
    view = renderPanel(<ExportRunPanel run={run} project={BASE} engine={READY} choice={CHOICE} />)
    act(() => run.start(BASE, READY, CHOICE))

    const cancel = await button('Cancel')
    act(() => cancel.focus())
    expect(document.activeElement, 'focus is on Cancel before the export ends').toBe(hostOf(cancel))

    await act(async () => {
      finish({ file: 'Los Angeles.mp4', bytes: 1, frames: 1 })
      await Promise.resolve()
    })

    const reveal = await button('Reveal')
    const host = hostOf(reveal)
    expect(host.localName, 'Reveal is the kit’s button').toBe('fig-button')
    expect(
      document.activeElement,
      `focus went to Reveal, not ${said(document.activeElement)}`,
    ).toBe(host)
    // The kit delegates focus from its host to the button inside: that is
    // the element a keyboard press reaches.
    expect(host.shadowRoot?.activeElement, 'and inside it, to its own button').toBe(reveal)
  })
})
