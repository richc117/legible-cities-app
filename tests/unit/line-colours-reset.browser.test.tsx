// Reset every line closes a colour panel left open, by itself (issue 436,
// `closePanels` in `LineColours.tsx`), when nothing moves focus to close it:
// the panel was opened and the reset pressed by activations that move no
// focus (a screen reader's, in browse mode), and the reset has nothing to
// put back (issue 561), so no control comes for focus to go to. A browser
// test (ADR-059): the panel is a real auto popover and the reset the kit's
// button, which jsdom has neither of.
//
// Mutation, watched failing: `closePanels()` taken out of `resetEvery` -
// the panel is still open after the reset. The mutation job refuses a
// browser test, so it is run by hand (see the pull request).

import { act, useRef, type JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import type { ProjectRecord } from '../../src/shared/project/types'
import type { LayoutRun } from '../../src/renderer/src/engine/layoutRun'
import LineColours from '../../src/renderer/src/LineColours'
import { BASE, INSPECTION, READY, renderPanel, type RenderedPanel } from '../support/render'
import { StandInRun } from '../support/stand-in-run'

const inspected = Promise.resolve(INSPECTION)

/** The section and a heading above it to hand focus to, as cell 05 draws them. */
function Section({ run, project }: { run: StandInRun; project: ProjectRecord }): JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null)
  return (
    <>
      <h2 tabIndex={-1} ref={heading}>
        05 Lines
      </h2>
      <LineColours
        run={run as unknown as LayoutRun}
        project={project}
        engine={READY}
        inspect={() => inspected}
        handback={heading}
      />
    </>
  )
}

const element = async (role: 'button', name: string): Promise<HTMLElement> =>
  (await page.getByRole(role, { name, exact: true }).element()) as HTMLElement

const openPanels = (): number => document.querySelectorAll('.colour-popover:popover-open').length

let view: RenderedPanel | null = null

afterEach(() => {
  view?.unmount()
  view = null
})

describe('Reset every line, in a browser, with the kit', () => {
  it('closes a colour panel left open when it has nothing to put back and moves no focus', async () => {
    const project = { ...BASE, colors: { A: '#111111' }, drawn: null, readOnly: false }
    view = renderPanel(<Section run={new StandInRun()} project={project} />)
    await act(async () => {
      await inspected
    })
    const chip = await element('button', 'Choose the colour of line A')
    act(() => chip.focus())
    act(() => chip.click())
    expect(openPanels(), 'the panel is open').toBe(1)
    const reset = await element('button', 'Reset every line')
    act(() => reset.click())
    expect(openPanels(), 'the reset closed it').toBe(0)
    await expect
      .element(page.getByRole('button', { name: 'Put back your colours' }))
      .not.toBeInTheDocument()
  })
})
