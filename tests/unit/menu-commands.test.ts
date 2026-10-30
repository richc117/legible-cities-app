// @vitest-environment jsdom
// The wait behind the menu's New project (issue 554): the card is pressed
// once, whether it is there already or drawn later, and a wait that is
// stopped - the screen changed before the Library drew it - presses nothing.

import { afterEach, describe, expect, it } from 'vitest'
import { NEW_PROJECT_CARD_CLASS } from '../../src/renderer/src/Card'
import { NEW_PROJECT_CARD, whenPresent } from '../../src/renderer/src/menuCommands'

/** A turn of the event loop: a MutationObserver's records are delivered as a microtask. */
const settled = (): Promise<void> => new Promise((done) => setTimeout(done, 0))

function card(): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = `card ${NEW_PROJECT_CARD_CLASS}`
  return button
}

let root: HTMLElement
afterEach(() => {
  root?.remove()
})

function setUp(): { found: Element[] } {
  root = document.createElement('div')
  document.body.appendChild(root)
  return { found: [] }
}

describe('whenPresent', () => {
  it('finds the card by the class Card.tsx gives it', () => {
    expect(card().matches(NEW_PROJECT_CARD)).toBe(true)
  })

  it('calls at once for a card that is there, and once only', async () => {
    const { found } = setUp()
    const there = root.appendChild(card())
    const stop = whenPresent(root, NEW_PROJECT_CARD, (element) => found.push(element))
    expect(found).toEqual([there])
    root.appendChild(card())
    await settled()
    expect(found).toEqual([there])
    stop()
  })

  it('waits for a card drawn later, calls once, and stops watching', async () => {
    // Mutation (`menu-commands.mutations.json`): the observer is not
    // disconnected when it finds the card - a second card drawn later is
    // pressed again.
    const { found } = setUp()
    whenPresent(root, NEW_PROJECT_CARD, (element) => found.push(element))
    root.appendChild(document.createElement('p'))
    await settled()
    expect(found).toEqual([])
    const wrapper = root.appendChild(document.createElement('div'))
    const later = wrapper.appendChild(card())
    await settled()
    expect(found).toEqual([later])
    later.remove()
    root.appendChild(card())
    await settled()
    expect(found).toEqual([later])
  })

  it('calls nothing once it is stopped', async () => {
    // Mutation (`menu-commands.mutations.json`): the returned stop does not
    // disconnect - a Library drawn after the screen changed is pressed.
    const { found } = setUp()
    const stop = whenPresent(root, NEW_PROJECT_CARD, (element) => found.push(element))
    stop()
    root.appendChild(card())
    await settled()
    expect(found).toEqual([])
  })
})
