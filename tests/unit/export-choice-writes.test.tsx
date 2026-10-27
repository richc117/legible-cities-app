// @vitest-environment jsdom
// Cell 06's writes of its choice (issue 433, part b; "The record session"
// in docs/ARCHITECTURE.md): a choice is written the moment it is made, what
// was last *sent* decides whether a change needs writing, the answer is
// taken when it comes, and nothing is ordered or queued. Driven through the
// hook itself, in a component that does nothing else, drawn by
// `renderPanel`.

import { act, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  useExportChoice,
  type ExportChoiceState,
} from '../../src/renderer/src/export/useExportChoice'
import type { ExportChoice } from '../../src/shared/export'
import { answered, cleanup, renderPanel } from '../support/render'

afterEach(cleanup)

const REEL: ExportChoice = { preset: 'instagram-reel', options: {} }
const DRAFT: ExportChoice = { preset: 'instagram-reel', options: { quality: 'draft' } }
const HIGH: ExportChoice = { preset: 'instagram-reel', options: { quality: 'high' } }

/** The hook in a component of its own, its answer kept where the test reads it. */
function draw(onChoice: (choice: ExportChoice) => Promise<void>, readOnly = false) {
  let state!: ExportChoiceState
  function Harness(): JSX.Element {
    state = useExportChoice({ record: REEL, tables: null, readOnly, onChoice })
    return <p role="alert">{state.writeProblem}</p>
  }
  const view = renderPanel(<Harness />)
  return {
    view,
    change: (next: ExportChoice) => act(() => state.change(next)),
    get state() {
      return state
    },
  }
}

describe('the export choice’s writes', () => {
  it('sends a change the moment it is made, and holds it at once', () => {
    const onChoice = vi.fn(() => new Promise<void>(() => undefined))
    const drawn = draw(onChoice)
    drawn.change(DRAFT)
    expect(onChoice.mock.calls).toEqual([[DRAFT]])
    expect(drawn.state.choice).toEqual(DRAFT)
  })

  it('does not send a change that is what was last sent', () => {
    const onChoice = vi.fn(() => new Promise<void>(() => undefined))
    const drawn = draw(onChoice)
    drawn.change({ ...REEL, options: {} })
    expect(onChoice).not.toHaveBeenCalled()
  })

  it('sends a change back to the record’s value while a write is out', () => {
    // Mutation: `sameChoice(next, sent.current)` compared with the record
    // instead - the change back to the reel's own is then skipped, and the
    // record keeps the draft in between.
    const onChoice = vi.fn(() => new Promise<void>(() => undefined))
    const drawn = draw(onChoice)
    drawn.change(DRAFT)
    drawn.change(REEL)
    expect(onChoice.mock.calls).toEqual([[DRAFT], [REEL]])
  })

  it('says a refused write, and sends the next change whatever it is', async () => {
    const onChoice = vi
      .fn<(choice: ExportChoice) => Promise<void>>()
      .mockRejectedValueOnce(new Error('The project could not be saved.'))
      .mockResolvedValue(undefined)
    const drawn = draw(onChoice)
    drawn.change(DRAFT)
    await answered()
    expect(drawn.state.writeProblem).toBe('The project could not be saved.')
    expect(drawn.view.host.querySelector('[role="alert"]')?.textContent).toBe(
      'The project could not be saved.',
    )
    // What is on disk is unknown, so the same choice is sent again.
    drawn.change(DRAFT)
    await answered()
    expect(onChoice.mock.calls).toEqual([[DRAFT], [DRAFT]])
    expect(drawn.state.writeProblem, 'the newest write landed').toBeNull()
  })

  it('clears the refusal only when the newest write has answered', async () => {
    let finishFirst!: () => void
    const onChoice = vi
      .fn<(choice: ExportChoice) => Promise<void>>()
      .mockRejectedValueOnce(new Error('refused'))
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishFirst = resolve)))
      .mockImplementationOnce(() => new Promise<void>(() => undefined))
    const drawn = draw(onChoice)
    drawn.change(DRAFT)
    await answered()
    drawn.change(HIGH)
    drawn.change(DRAFT)
    finishFirst()
    await answered()
    expect(drawn.state.writeProblem, 'a newer write is still out').toBe('refused')
  })

  it('sends nothing for a read-only project', () => {
    const onChoice = vi.fn(async () => undefined)
    const drawn = draw(onChoice, true)
    drawn.change(DRAFT)
    drawn.change(HIGH)
    expect(onChoice).not.toHaveBeenCalled()
    expect(drawn.state.choice, 'the choice is still held').toEqual(HIGH)
  })
})
