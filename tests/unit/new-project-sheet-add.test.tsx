// @vitest-environment jsdom
// The New project sheet's add from an address, to its end (A5.6-05; issue
// 433, part c): once the feed is in, the button reads Create, the name is
// the feed's own and focus is on Name, the field the end has just enabled
// again; and an add another opening left going never claims this
// opening's Create when it ends. The add is the real `FeedAdd` over a
// stand-in client whose answer the test gives. jsdom has the `<dialog>`
// and not its modal half, stubbed here, and does not delegate focus into
// the kit's button, which is a native one here (`kit-stubs.ts`).

import { act } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { FeedAdd, type AddClient } from '../../src/renderer/src/engine/feedAdd'
import NewProjectSheet, { type SheetStart } from '../../src/renderer/src/NewProjectSheet'
import type { FeedRecord } from '../../src/shared/protocol'
import { answered, byName, cleanup, press, READY, renderPanel } from '../support/render'

vi.mock('../../src/renderer/src/kit/Button', async () =>
  (await import('../support/kit-stubs')).kitButtonStub(),
)

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

afterEach(cleanup)

const FEED: FeedRecord = {
  key: 'metro-de-prueba',
  name: 'Metro de Prueba',
  city: 'Prueba',
  network: 'Metro',
  url: 'https://example.org/gtfs.zip',
  mode: 'all',
  label_pattern: null,
  label_strip: null,
  agency: null,
  geographic: true,
  notes: [],
  headways: false,
  source: 'user',
  cached: true,
}

const ADDRESS: SheetStart = { source: 'address' }

/** A feed add whose one request the test answers. */
function adder(): { run: FeedAdd; answer: (feed: FeedRecord) => void } {
  let answer!: (feed: FeedRecord) => void
  const client: AddClient = {
    request: () => ({
      result: new Promise<FeedRecord>((resolve) => (answer = resolve)),
      onProgress: () => () => undefined,
      cancel: () => undefined,
    }),
  }
  return { run: new FeedAdd(client), answer: (feed) => answer(feed) }
}

function draw(run: FeedAdd) {
  const onAdded = vi.fn()
  renderPanel(
    <NewProjectSheet
      open
      start={ADDRESS}
      feeds={[]}
      run={run}
      engine={READY}
      pickZip={async () => null}
      onCreate={async () => undefined}
      onAdded={onAdded}
      taken={[]}
      onCancel={() => undefined}
    />,
  )
  return { onAdded }
}

/** Text typed into a kit field, as the platform reports it. */
function type(field: HTMLElement, text: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, text)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const submit = (): string | null | undefined =>
  document.querySelector('.actions button[type="submit"]')?.textContent

describe('the New project sheet’s add', () => {
  it('ends with Create, the feed’s name and focus on Name', async () => {
    const { run, answer } = adder()
    const { onAdded } = draw(run)
    expect(submit()).toBe('Add the feed')
    type(byName('textbox', 'Feed address'), 'https://example.org/gtfs.zip')
    press('Add the feed')
    expect(run.snapshot.state).toBe('running')
    const name = byName('textbox', 'Name') as HTMLInputElement
    expect(name.disabled, 'Name is held while the add goes').toBe(true)

    answer(FEED)
    await answered()
    expect(run.snapshot.state).toBe('done')
    expect(submit()).toBe('Create')
    expect(name.disabled).toBe(false)
    expect(name.closest('fig-input-text')?.getAttribute('value')).toBe('Metro de Prueba')
    expect(document.activeElement, 'focus is on Name').toBe(name)
    expect(onAdded).toHaveBeenCalledTimes(1)
  })

  it('does not take Create from an add another opening left going', async () => {
    // Mutation (`new-project-sheet-add.mutations.json`): `attempt > 0`
    // dropped from the derivation of the feed added - the add an earlier
    // opening left going claims this opening's Create when it ends.
    const { run, answer } = adder()
    run.start({ url: 'https://example.org/gtfs.zip' }, READY)
    const { onAdded } = draw(run)
    expect(run.snapshot.state, 'still going as this opening shows').toBe('running')
    answer(FEED)
    await answered()
    expect(run.snapshot.state).toBe('done')
    expect(submit()).toBe('Add the feed')
    expect(byName('textbox', 'Name').closest('fig-input-text')?.getAttribute('value')).toBe('')
    expect(onAdded, 'the front door lists again on its own').not.toHaveBeenCalled()
  })
})
