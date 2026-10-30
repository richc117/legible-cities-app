// @vitest-environment jsdom
// The New project sheet says what a feed and GTFS are, where the choice of
// source is made, and offers the page that says where to find one (issue
// 555): the sentence is drawn, the "Start from" group is described by it,
// and the button asks the bridge for the "feeds" page by name and by
// nothing else. jsdom has the `<dialog>` and not its modal half, stubbed
// here as the sheet's other tests stub it; the kit's button is a native one
// (`kit-stubs.ts`), since this test only presses it.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { FeedAdd, type AddClient } from '../../src/renderer/src/engine/feedAdd'
import NewProjectSheet from '../../src/renderer/src/NewProjectSheet'
import { FIND_A_FEED, SOURCE_HINT } from '../../src/shared/feedHelp'
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

/** An add that is never started here, so its client is never asked. */
const NO_CLIENT: AddClient = {
  request: () => {
    throw new Error('this test starts no add')
  },
}

function draw(open: (page: string) => Promise<void>): void {
  renderPanel(
    <NewProjectSheet
      open
      start={{ source: 'feed' }}
      feeds={[]}
      run={new FeedAdd(NO_CLIENT)}
      engine={READY}
      pickZip={async () => null}
      onCreate={async () => undefined}
      onAdded={() => undefined}
      taken={[]}
      onCancel={() => undefined}
    />,
    { api: { help: { open } } },
  )
}

/** What the fieldset's `aria-describedby` resolves to, as the platform would read it. */
function descriptionOf(element: Element): string {
  return (element.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

describe('the New project sheet’s help for a feed', () => {
  it('says what a feed and GTFS are, and describes the Start from group by it', () => {
    // Mutation (`new-project-sheet-hint.mutations.json`): the fieldset's
    // `aria-describedby` deleted - the sentence is on the screen and the
    // group it belongs to is described by nothing.
    draw(async () => undefined)
    const group = document.querySelector('fieldset.source-choice')
    expect(group, 'the Start from group is drawn').not.toBeNull()
    expect(descriptionOf(group as Element)).toBe(SOURCE_HINT)
    expect(SOURCE_HINT).toMatch(/feed/)
    expect(SOURCE_HINT).toMatch(/GTFS/)
  })

  it('asks the bridge for the feeds page, by name', () => {
    // Mutation (`new-project-sheet-hint.mutations.json`): the button asks
    // for another page - the guide opens where "Where to find a feed" was
    // pressed.
    const open = vi.fn(async () => undefined)
    draw(open)
    press(FIND_A_FEED)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('feeds')
  })

  it('says so, under the button, when the page would not open', async () => {
    // Mutation (`new-project-sheet-hint.mutations.json`): the rejection
    // swallowed - the button does nothing and says nothing.
    draw(async () => Promise.reject(new Error('There is no such help page.')))
    const status = document.querySelector('fieldset.source-choice [role="status"]')
    expect(status, 'the line is there before it has anything to say').not.toBeNull()
    expect(status?.textContent).toBe('')
    press(FIND_A_FEED)
    await answered()
    expect(status?.textContent).toBe(
      'The feeds page could not be opened: There is no such help page.',
    )
    expect(byName('button', FIND_A_FEED), 'the sheet stays as it was').toBeTruthy()
  })

  it('clears the line on the next press', async () => {
    let fail = true
    draw(async () => (fail ? Promise.reject(new Error('no browser')) : undefined))
    const status = (): string | undefined =>
      document.querySelector('fieldset.source-choice [role="status"]')?.textContent
    press(FIND_A_FEED)
    await answered()
    expect(status()).toBe('The feeds page could not be opened: no browser.')
    fail = false
    press(FIND_A_FEED)
    await answered()
    expect(status()).toBe('')
  })
})
