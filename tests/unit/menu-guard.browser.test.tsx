// The menu's commands wait behind a modal dialog (issue 554): a native
// accelerator fires whatever the page shows, so App drops a command that
// arrives while a page `<dialog>` is modal. A browser test (ADR-059),
// because only a browser has `showModal()` and the `:modal` it matches;
// jsdom has neither, and a stub of the one cannot make the other match.
//
// The listener is called synchronously, where the bridge would deliver the
// command, and the screen is read after two frames, without retrying: a
// read that retries would pass as soon as the screen changed back, or
// before it changed at all.
//
// Mutation, watched failing (the mutation runner takes unit tests only, so
// it is recorded here, as the browser project's first test records its
// own): the first `if (modalOpen(document)) return` taken out of App.tsx's
// menu handler - the heading reads Settings behind the open dialog.

import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import App from '../../src/renderer/src/App'
import type { MenuCommand } from '../../src/shared/menu'
import type { SettingsView } from '../../src/shared/settings'
import { renderPanel, type RenderedPanel } from '../support/render'

const VIEW: SettingsView = {
  appVersion: '4.2.0-test',
  theme: 'system',
  engine: { path: '/engine', source: 'default', pending: null, locked: false },
  export: { path: '/exports', source: 'default', pending: null, locked: false },
}

const never = <T,>(): Promise<T> => new Promise<T>(() => undefined)
const twoFrames = (): Promise<void> =>
  new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))
const heading = (): string | null | undefined => document.querySelector('h1')?.textContent

let view: RenderedPanel | null = null
let dialog: HTMLDialogElement | null = null

afterEach(() => {
  dialog?.remove()
  dialog = null
  view?.unmount()
  view = null
})

describe('a menu command, in a browser', () => {
  it('does nothing while a dialog is modal, and is answered once it has closed', async () => {
    let listener: ((command: MenuCommand) => void) | null = null
    view = renderPanel(<App />, {
      api: {
        app: {
          onMenuCommand: (heard) => {
            listener = heard
            return () => {
              if (listener === heard) listener = null
            }
          },
        },
        settings: { read: async () => VIEW, engineSize: never },
        projects: { list: async () => [] },
        licences: { read: never },
        firstRun: { get: never, onChanged: () => () => undefined },
      },
    })
    await expect.poll(heading).toBe('Library')
    await expect.poll(() => listener).not.toBeNull()

    dialog = document.body.appendChild(document.createElement('dialog'))
    dialog.appendChild(document.createElement('button')).textContent = 'OK'
    dialog.showModal()
    expect(dialog.matches(':modal'), 'the dialog is modal').toBe(true)

    await act(async () => {
      listener?.('settings')
      await twoFrames()
    })
    expect(heading(), 'the screen behind the dialog is unchanged').toBe('Library')
    expect(dialog.open, 'and the dialog is still open').toBe(true)

    // Not vacuous: the same command, with the dialog gone, is answered.
    dialog.close()
    await act(async () => {
      listener?.('settings')
      await twoFrames()
    })
    expect(heading()).toBe('Settings')
  })
})
