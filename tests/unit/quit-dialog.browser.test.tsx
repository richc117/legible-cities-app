// The question a quit or a close asks first, as the page shows it (issue
// 552, specs/039-quit-guard, FR-002, FR-004 and the accessibility section):
// a browser test (ADR-059), in Playwright's Chromium, because what is held
// here is the platform's - a modal `<dialog>` in the top layer, where focus
// goes as it opens and as it closes, what Escape does, and a modal opened
// over another - and jsdom has none of it. The kit is real, so focus lands
// on a `<fig-button>` as it does in the app.
//
// The bridge is a stub that hands the test the page's listener: the test
// asks the question as main would, and reads the answers the page sends
// back. The runs are stub jobs handed to the dialog.
//
// Mutations, each watched failing here (a browser test cannot be an entry in
// a `.mutations.json`, which runs the Node project only):
// - `cancelLabel={words.keep}` taken off `ConfirmDialog` in `QuitDialog.tsx`:
//   the first test finds no button named "Keep working".
// - `cancelRef.current?.focus()` taken out of `ConfirmDialog.tsx`: the first
//   test finds focus on the dialog and not on Keep working.
// - `awaiting.current = null` taken out of `answer` in `QuitDialog.tsx`: the
//   Escape test reads two answers for one question.
// - the `runsToStop` loop taken out of `answer`: the Close anyway test reads
//   an answer with nothing stopped before it.
// - `question.kind === 'close'` made `true` in that loop: the Quit anyway
//   test reads two runs stopped.
// - `if (question === null) { setOpen(false); return }` made a bare
//   `return`: the last test finds the dialog still open.

import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import QuitDialog, { type QuitRuns } from '../../src/renderer/src/QuitDialog'
import type { Job } from '../../src/shared/jobs'
import type { AskedQuit, QuitAnswer, RunningLayout } from '../../src/shared/quit'
import { renderPanel, type RenderedPanel } from '../support/render'

/** The button a person would find by this name: the kit's inner `<button>`. */
const button = async (name: string): Promise<HTMLElement> =>
  (await page.getByRole('button', { name, exact: true }).element()) as HTMLElement

/** The element focus is on for a button inside a shadow root: its host, as the document sees it. */
const hostOf = (element: Element): Element => {
  const root = element.getRootNode()
  return root instanceof ShadowRoot ? root.host : element
}

const textOf = (id: string | null): string | null =>
  id === null ? null : (document.getElementById(id)?.textContent ?? null)

const job = (id: string, kind: Job['kind'], state: Job['state'] = 'running'): Job => ({
  id,
  kind,
  projectId: kind === 'feed-add' ? null : `${id}00000000`.slice(0, 12),
  projectName: null,
  label: kind,
  state,
  stages: [],
  message: null,
  hint: null,
  detail: null,
  rawDetail: null,
  log: [],
  dropped: 0,
  started: 1_000,
  ended: state === 'running' ? null : 2_000,
})

const EXPORT_OF_PARIS: AskedQuit = {
  id: 1,
  kind: 'quit',
  exports: 1,
  layouts: 0,
  names: ['Paris'],
}

let view: RenderedPanel | null = null
let other: HTMLElement | null = null

afterEach(() => {
  view?.unmount()
  view = null
  other?.remove()
  other = null
})

/** The dialog mounted over a bridge the test speaks for, and what the page did. */
function mounted(jobs: Job[] = []) {
  const did: string[] = []
  const reports: RunningLayout[][] = []
  let listener: ((question: AskedQuit | null) => void) | null = null
  const runs: QuitRuns = {
    jobs: () => jobs,
    subscribe: () => () => undefined,
    cancel: (id) => did.push(`cancel ${id}`),
  }
  view = renderPanel(<QuitDialog runs={runs} />, {
    api: {
      app: {
        onQuitQuestion: (heard) => {
          listener = heard
          return () => {
            if (listener === heard) listener = null
          }
        },
        answerQuit: async (id: number, answer: QuitAnswer) => {
          did.push(`answer ${id} ${answer}`)
        },
        reportLayouts: async (layouts: RunningLayout[]) => {
          reports.push(layouts)
        },
      },
    },
  })
  const ask = async (question: AskedQuit | null): Promise<void> => {
    await act(async () => {
      listener?.(question)
      await Promise.resolve()
    })
  }
  const dialog = (): HTMLDialogElement | null => document.querySelector('dialog[aria-labelledby]')
  const press = async (name: string): Promise<void> => {
    const pressed = await button(name)
    await act(async () => {
      pressed.click()
      await Promise.resolve()
    })
  }
  return { did, reports, ask, dialog, press }
}

describe('the quit’s question, in a browser, with the kit', () => {
  it('opens as a modal dialog named by its title, with focus on Keep working', async () => {
    const { ask, dialog, reports } = mounted()
    expect(dialog(), 'nothing is in the document until a question is asked').toBeNull()
    expect(reports, 'and main is told at once what the page runs').toEqual([[]])

    await ask(EXPORT_OF_PARIS)
    const shown = dialog()!
    expect(shown.open).toBe(true)
    expect(shown.matches(':modal'), 'modal, so the page behind it takes nothing').toBe(true)
    expect(textOf(shown.getAttribute('aria-labelledby'))).toBe('Quit while an export is running?')
    expect(textOf(shown.getAttribute('aria-describedby'))).toBe(
      'The export of Paris has not finished. Quitting stops it, and nothing of it is kept.',
    )
    const keep = await button('Keep working')
    await button('Quit anyway')
    expect(
      [...shown.querySelectorAll('fig-button')].map((b) => b.textContent),
      'two buttons, the safe one first, and neither is Cancel',
    ).toEqual(['Keep working', 'Quit anyway'])
    expect(document.activeElement, 'focus is on Keep working').toBe(hostOf(keep))
  })

  it('answers keep on Keep working, closes, and returns focus where it was', async () => {
    const { ask, dialog, press, did } = mounted()
    other = document.body.appendChild(document.createElement('button'))
    other.textContent = 'Where focus was'
    other.focus()

    await ask(EXPORT_OF_PARIS)
    expect(document.activeElement).not.toBe(other)
    await press('Keep working')
    expect(did).toEqual(['answer 1 keep'])
    expect(dialog()!.open).toBe(false)
    expect(document.activeElement, 'focus is back where it was').toBe(other)
  })

  it('answers keep on Escape, once', async () => {
    const { ask, dialog, did } = mounted()
    await ask(EXPORT_OF_PARIS)
    await act(async () => {
      await userEvent.keyboard('{Escape}')
    })
    await expect.poll(() => dialog()!.open).toBe(false)
    // The element is cancelled and then closes, and tells the page both
    // times: one answer.
    expect(did).toEqual(['answer 1 keep'])
  })

  it('answers anyway on Quit anyway, and stops no run itself: the quit stops everything', async () => {
    const { ask, dialog, press, did } = mounted([job('a', 'export'), job('b', 'layout')])
    await ask({ ...EXPORT_OF_PARIS, layouts: 1, names: ['Paris', 'Lyon'] })
    await press('Quit anyway')
    expect(did).toEqual(['answer 1 anyway'])
    expect(dialog()!.open).toBe(false)
  })

  it('stops every export and layout still running on Close anyway, before it answers', async () => {
    const { ask, press, did, dialog } = mounted([
      job('a', 'export'),
      job('b', 'layout'),
      job('c', 'rebuild'),
      job('d', 'feed-add'),
      job('e', 'export', 'done'),
    ])
    await ask({ id: 2, kind: 'close', exports: 1, layouts: 1, names: ['Paris', 'Lyon'] })
    const shown = dialog()!
    expect(textOf(shown.getAttribute('aria-labelledby'))).toBe('Close while 2 runs are going?')
    expect(textOf(shown.getAttribute('aria-describedby'))).toBe(
      'The runs of Paris and Lyon have not finished. Closing stops them, and nothing of them is kept.',
    )
    await press('Close anyway')
    expect(did).toEqual(['cancel a', 'cancel b', 'answer 2 anyway'])
  })

  it('opens over another modal dialog, and hands it focus back when it closes', async () => {
    const { ask, dialog, press } = mounted()
    // A confirmation a person is half way through, as the delete's is.
    const first = document.createElement('dialog')
    other = document.body.appendChild(first)
    const inside = first.appendChild(document.createElement('button'))
    inside.textContent = 'Delete'
    first.showModal()
    inside.focus()

    await ask(EXPORT_OF_PARIS)
    const shown = dialog()!
    expect(shown.matches(':modal')).toBe(true)
    expect(first.open, 'the first dialog is still open behind it').toBe(true)
    const keep = await button('Keep working')
    expect(document.activeElement, 'focus is in the question').toBe(hostOf(keep))
    // The one opened last is on top: what is under the middle of the
    // question is the question, not the dialog behind it.
    const box = shown.getBoundingClientRect()
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    expect(shown.contains(top), 'the question is drawn above the other dialog').toBe(true)

    await press('Keep working')
    expect(shown.open).toBe(false)
    expect(first.open).toBe(true)
    expect(document.activeElement, 'focus is back in the dialog that was open').toBe(inside)
  })

  it('asks again, with the new question’s words and focus on Keep working again', async () => {
    const { ask, dialog, press, did } = mounted()
    await ask(EXPORT_OF_PARIS)
    await press('Keep working')
    await ask({ id: 2, kind: 'close', exports: 0, layouts: 1, names: ['Lyon'] })
    const shown = dialog()!
    expect(shown.open).toBe(true)
    expect(textOf(shown.getAttribute('aria-labelledby'))).toBe('Close while a layout is running?')
    const keep = await button('Keep working')
    expect(document.activeElement).toBe(hostOf(keep))
    await press('Close anyway')
    expect(did).toEqual(['answer 1 keep', 'answer 2 anyway'])
  })

  it('closes without an answer when main takes the question back', async () => {
    const { ask, dialog, did } = mounted()
    await ask(EXPORT_OF_PARIS)
    expect(dialog()!.open).toBe(true)
    // A second quit answered it in the main process.
    await ask(null)
    await expect.poll(() => dialog()!.open).toBe(false)
    expect(did).toEqual([])
  })
})
