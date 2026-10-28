// @vitest-environment jsdom
// Settings' lines that the engine and its folder answer, drawn into the
// document with their effects running (issue 433, part c): the folder's
// size, "Measuring…" until the main process answers and again after a
// reset. The engine's `engine.info` is answered by a stand-in client in
// place of the bridge's; the reset's dialog is a `<dialog>` whose
// `showModal` jsdom lacks, stubbed here.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import Settings from '../../src/renderer/src/Settings'
import type { EngineState } from '../../src/shared/engine'
import type { EngineInfo } from '../../src/shared/protocol'
import { describeSize, type FolderSize, type SettingsView } from '../../src/shared/settings'
import { answered, cleanup, press, READY, renderPanel } from '../support/render'

/** What `engine.info` answers: an answer, or never. */
const engine = vi.hoisted(() => ({ info: null as EngineInfo | null }))

vi.mock('../../src/renderer/src/engine/runs', async (original) => ({
  ...(await original<typeof import('../../src/renderer/src/engine/runs')>()),
  engineClient: () => ({
    request: () => ({
      result: engine.info === null ? new Promise(() => undefined) : Promise.resolve(engine.info),
    }),
  }),
}))

const VIEW: SettingsView = {
  appVersion: '4.2.0-test',
  theme: 'system',
  engine: { path: '/engine', source: 'default', pending: null, locked: false },
  export: { path: '/exports', source: 'default', pending: null, locked: false },
}

const SIZE: FolderSize = { bytes: 4096, files: 3, partial: false, missing: false }

// jsdom has the element and not its modal half (ADR-059).
const dialog = HTMLDialogElement.prototype as Partial<HTMLDialogElement>
const had = { showModal: dialog.showModal, close: dialog.close }
beforeAll(() => {
  dialog.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  dialog.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})
afterAll(() => {
  dialog.showModal = had.showModal
  dialog.close = had.close
})

afterEach(() => {
  cleanup()
  engine.info = null
})

/** A promise and the hand that settles it. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => (resolve = settle))
  return { promise, resolve }
}

function draw(engineSize: () => Promise<FolderSize>, state: EngineState | null = READY) {
  const resetEngineData = vi.fn(async () => ({ removed: ['projects'], failed: [] }))
  const view = renderPanel(
    <Settings settings={VIEW} onChanged={() => undefined} engine={state} />,
    {
      api: {
        settings: { engineSize: vi.fn(engineSize), resetEngineData },
        licences: { read: () => new Promise(() => undefined) },
        firstRun: { get: () => new Promise(() => undefined), onChanged: () => () => undefined },
      },
    },
  )
  const redraw = (next: EngineState | null): void =>
    view.rerender(<Settings settings={VIEW} onChanged={() => undefined} engine={next} />)
  return { view, redraw, resetEngineData }
}

const sizeLine = (): string | null | undefined =>
  document.getElementById('engine-folder-size')?.textContent

describe('the engine folder’s size', () => {
  it('says it is measuring until the size comes, and again after a reset', async () => {
    // Mutation (`settings-engine.mutations.json`): the reset's own
    // `setSize(null)` removed from `measure` - after Reset the line keeps
    // the old figure while the folder is measured again.
    const sizes = [deferred<FolderSize>(), deferred<FolderSize>()]
    let asked = 0
    const { resetEngineData } = draw(() => sizes[asked++].promise)
    expect(sizeLine()).toBe('Measuring…')
    sizes[0].resolve(SIZE)
    await answered()
    expect(sizeLine()).toBe(describeSize(SIZE))

    press('Reset engine data')
    press('Reset')
    await answered()
    expect(resetEngineData).toHaveBeenCalledTimes(1)
    expect(asked, 'measured again after the reset').toBe(2)
    expect(sizeLine()).toBe('Measuring…')
    sizes[1].resolve({ bytes: 0, files: 0, partial: false, missing: true })
    await answered()
    expect(sizeLine()).toBe('empty (the folder is not there yet)')
  })
})
