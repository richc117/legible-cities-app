// @vitest-environment jsdom
// The page stops listening for the quit's question when its dialog is
// unmounted, and an uncaught error while the interface renders unmounts all
// of it (issue 552, specs/039-quit-guard). The window is still there then,
// its renderer alive and answering, so nothing else tells main that no
// dialog will be drawn; without this word a quit during a run would be held
// for a question on a blank page.
//
// What is held here is React's own behaviour as much as the dialog's: that a
// root left with an uncaught render error runs the cleanups of what it had
// mounted. Drawn under `StrictMode`, as `main.tsx` draws the app, with the
// subscription the preload makes (`quitQuestionListeners`) over a channel
// nothing is sent on. The dialog draws nothing until a question is asked, so
// jsdom needs no `<dialog>` for it.
//
// Mutation (`quit-listening.mutations.json`): `offQuestion()` taken out of
// the dialog's cleanup - main is never told the page has stopped.

import { act, StrictMode, useState, type JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import QuitDialog, { type QuitRuns } from '../../src/renderer/src/QuitDialog'
import type { Api } from '../../src/shared/api'
import { quitQuestionListeners } from '../../src/shared/quit'

// React's client reads this to know it is driven by `act`.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NO_RUNS: QuitRuns = {
  jobs: () => [],
  subscribe: () => () => undefined,
  cancel: () => undefined,
}

let root: Root | null = null
let container: HTMLElement | null = null
const before = (window as { api?: unknown }).api

afterEach(() => {
  if (root !== null) act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  ;(window as { api?: unknown }).api = before
})

/** The dialog beside a part of the interface that can be made to throw as it renders. */
function mounted() {
  const told: boolean[] = []
  window.api = {
    app: {
      onQuitQuestion: quitQuestionListeners({
        hear: () => () => undefined,
        tell: (listening) => told.push(listening),
      }),
      answerQuit: async () => undefined,
      reportLayouts: async () => undefined,
    },
  } as unknown as Api
  let breakIt!: () => void
  function Part(): JSX.Element {
    const [broken, setBroken] = useState(false)
    breakIt = () => setBroken(true)
    if (broken) throw new Error('the interface broke')
    return <p>Library</p>
  }
  container = document.body.appendChild(document.createElement('div'))
  // A root as `main.tsx` makes it, with no handler for an uncaught error:
  // React reports the error and takes everything it had drawn off the screen.
  root = createRoot(container)
  act(() =>
    root?.render(
      <StrictMode>
        <QuitDialog runs={NO_RUNS} />
        <Part />
      </StrictMode>,
    ),
  )
  /** Break the part as it next renders, and answer what `act` threw: the error nothing caught. */
  const breakThePart = (): unknown => {
    try {
      act(() => breakIt())
    } catch (error) {
      return error
    }
    return null
  }
  return { told, breakThePart }
}

describe('the page’s word that it listens for the quit’s question', () => {
  it('is given while the dialog is mounted', () => {
    const { told } = mounted()
    expect(told.at(-1), 'main is told the page listens').toBe(true)
    expect(container?.textContent).toBe('Library')
  })

  it('is taken back when an uncaught error takes the interface down', () => {
    const { told, breakThePart } = mounted()
    expect(String(breakThePart()), 'the error went uncaught').toContain('the interface broke')
    expect(container?.innerHTML, 'and React took everything off the screen').toBe('')
    expect(told.at(-1), 'main is told the page no longer listens').toBe(false)
    // As many times stopped as started, however the mount was doubled.
    expect(told.filter((listening) => listening).length).toBe(
      told.filter((listening) => !listening).length,
    )
  })

  it('is taken back when the dialog is unmounted in the ordinary way', () => {
    const { told } = mounted()
    act(() => root?.unmount())
    root = null
    expect(told.at(-1)).toBe(false)
  })
})
