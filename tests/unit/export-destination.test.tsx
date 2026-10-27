// @vitest-environment jsdom
// Cell 06's "Where it goes" (A5.5-19; issue 433, part b): the two presses,
// what each asks the bridge and shows of its answer, the refusal under the
// pair, and focus handed to "Choose folder" when "Use the app's folder"
// takes itself away. The kit's button is a native one here, since jsdom
// does not delegate focus into a shadow root (`kit-stubs.ts`).

import { act, type JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ExportDestination, { useDestination } from '../../src/renderer/src/export/ExportDestination'
import type { ProjectRecord } from '../../src/shared/project/types'
import { answered, BASE, byName, cleanup, press, renderPanel } from '../support/render'

vi.mock('../../src/renderer/src/kit/Button', async () =>
  (await import('../support/kit-stubs')).kitButtonStub(),
)

afterEach(cleanup)

const FOLDER = '/Volumes/Work/Reels'
const record = (destination: string | null): ProjectRecord => ({ ...BASE, destination })

function draw(
  destination: string | null,
  bridge: {
    chooseDestination?: (id: string) => Promise<ProjectRecord>
    useAppFolder?: (id: string) => Promise<ProjectRecord>
  },
  locked = false,
) {
  const chooseDestination = vi.fn(bridge.chooseDestination ?? (async () => record(FOLDER)))
  const useAppFolder = vi.fn(bridge.useAppFolder ?? (async () => record(null)))
  const view = renderPanel(<Field recorded={destination} locked={locked} />, {
    api: { export: { chooseDestination, useAppFolder } },
  })
  return { view, chooseDestination, useAppFolder }
}

/** The field with its folder held above it, as the composition holds it. */
function Field({ recorded, locked }: { recorded: string | null; locked: boolean }): JSX.Element {
  const destination = useDestination(recorded)
  return <ExportDestination projectId={BASE.id} destination={destination} locked={locked} />
}

const where = (): Element | null => document.getElementById('export-destination-where')

describe('where cell 06’s export goes', () => {
  it('draws the field by its label, its line and its two names', () => {
    draw(FOLDER, {})
    const field = document.querySelector('.field.export-destination')
    expect(field?.querySelector('#export-destination-label')?.textContent).toBe('Where it goes')
    expect(where()?.className).toBe('path')
    expect(field?.querySelector('.toolbar')).not.toBeNull()
    for (const name of ['Choose folder', 'Use the app’s folder'])
      expect(byName('button', name).getAttribute('aria-describedby'), name).toBe(
        'export-destination-where',
      )
  })

  it('asks the main process to choose, once, and shows the folder it answers', async () => {
    // Mutation: the `changing` ref removed - two presses in one turn then
    // send two calls.
    const { chooseDestination } = draw(null, {})
    expect(where()?.className).toBe('message')
    expect(where()?.textContent).toMatch(/^This project’s exports go to the app’s export folder/)
    act(() => {
      byName('button', 'Choose folder').click()
      byName('button', 'Choose folder').click()
    })
    await answered()
    expect(chooseDestination.mock.calls).toEqual([[BASE.id]])
    expect(where()?.className).toBe('path')
    expect(where()?.textContent).toBe(FOLDER)
    // The second button is drawn now there is a folder to forget.
    expect(byName('button', 'Use the app’s folder')).toBeTruthy()
  })

  it('forgets the folder, takes its own button away and hands focus to Choose folder', async () => {
    // Mutation: the hand-back removed - focus is then left on the body.
    const { useAppFolder } = draw(FOLDER, {})
    const forget = byName('button', 'Use the app’s folder')
    act(() => forget.focus())
    press('Use the app’s folder')
    await answered()
    expect(useAppFolder.mock.calls).toEqual([[BASE.id]])
    expect(() => byName('button', 'Use the app’s folder')).toThrow('no button named')
    expect(where()?.className).toBe('message')
    expect(document.activeElement).toBe(byName('button', 'Choose folder'))
  })

  it('says a refusal under the pair and keeps the folder', async () => {
    draw(FOLDER, {
      chooseDestination: async () => {
        throw new Error('That folder is inside the app, so exports cannot go there.')
      },
    })
    press('Choose folder')
    await answered()
    const alert = document.querySelector('.export-destination [role="alert"]')
    expect(alert?.textContent).toBe('That folder is inside the app, so exports cannot go there.')
    expect(alert?.className).toBe('message error')
    expect(alert?.previousElementSibling?.className).toBe('toolbar')
    expect(where()?.textContent).toBe(FOLDER)
  })

  it('keeps focus where it was when a refused forget leaves its button', async () => {
    draw(FOLDER, {
      useAppFolder: async () => {
        throw new Error('The project could not be saved.')
      },
    })
    const forget = byName('button', 'Use the app’s folder')
    act(() => forget.focus())
    press('Use the app’s folder')
    await answered()
    expect(document.activeElement).toBe(byName('button', 'Use the app’s folder'))
  })

  it('sends nothing while locked', async () => {
    const { chooseDestination, useAppFolder } = draw(FOLDER, {}, true)
    press('Choose folder')
    press('Use the app’s folder')
    await answered()
    expect(chooseDestination).not.toHaveBeenCalled()
    expect(useAppFolder).not.toHaveBeenCalled()
  })

  it('takes a folder the record brings when it is read again', () => {
    const { view } = draw(null, {})
    view.rerender(<Field recorded={FOLDER} locked={false} />)
    expect(where()?.textContent).toBe(FOLDER)
  })
})
