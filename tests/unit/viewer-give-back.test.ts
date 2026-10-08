// The loop that sends a restore to a page that has just loaded (issue 349):
// what each call carries is decided when it is sent, not when the list was
// composed. No frame, window or bridge: the page is a function that records
// what it was sent. The scenario this exists for is a theme pressed while the
// document after a run is loading - the press sends its own `setTheme` in the
// tick its record write returns, and a restore composed before that must not
// then send the old theme on top of it.

import { describe, expect, it } from 'vitest'
import type { Theme } from '../../src/shared/project'
import { rememberTheme, themeAsItStands } from '../../src/renderer/src/themeMemory'
import type { Remembered } from '../../src/renderer/src/transportState'
import { giveBack, type GiveBack } from '../../src/renderer/src/viewerGiveBack'
import { restoreCalls, type ViewerCall } from '../../src/renderer/src/viewerRestore'

const STATE = { now: 26_400, viewName: 'schematic', labels: true, speed: 30, playing: false }

interface Setup {
  sent: [string, unknown[]][]
  now: GiveBack
}

/** A page that records what it is sent, and the moment each thing is read. */
function setup(over: Partial<GiveBack> = {}): Setup {
  const sent: [string, unknown[]][] = []
  const now: GiveBack = {
    alive: () => true,
    remembered: (): Remembered => ({ speed: null, playing: null }),
    theme: () => 'warm-dark',
    send: async (method, args) => {
      sent.push([method, args])
    },
    ...over,
  }
  return { sent, now }
}

describe('giveBack', () => {
  it('sends every call in order, the theme first', async () => {
    const { sent, now } = setup()
    await giveBack(restoreCalls(STATE, 'warm-dark'), now)
    expect(sent.map(([method]) => method)).toEqual([
      'setTheme',
      'setPlaying',
      'showView',
      'setLabels',
      'setSpeed',
      'seek',
    ])
    expect(sent[0]).toEqual(['setTheme', ['warm-dark']])
  })

  it('sends the theme as it stands when the call is sent, not as the list was composed', async () => {
    // Composed while the screen still said warm dark; the press's write has
    // returned since, so the memory says sepia by the time the call is sent.
    const calls = restoreCalls(STATE, 'warm-dark')
    const { sent, now } = setup({ theme: () => 'sepia' })
    await giveBack(calls, now)
    expect(sent[0], 'the first call is the theme as it stands').toEqual(['setTheme', ['sepia']])
    expect(sent.slice(1).map(([method]) => method)).not.toContain('setTheme')
  })

  it('reads the theme again for every call, not once before the loop', async () => {
    // A list with the theme twice is not one the app composes; it is the
    // smallest way to see that the theme is read at each call's moment.
    const calls: ViewerCall[] = [
      { method: 'setTheme', args: ['warm-dark'] },
      { method: 'seek', args: [26_400] },
      { method: 'setTheme', args: ['warm-dark'] },
    ]
    let theme: Theme = 'warm-dark'
    const sent: [string, unknown[]][] = []
    const { now } = setup({
      theme: () => theme,
      send: async (method, args) => {
        sent.push([method, args])
        if (method === 'seek') theme = 'sepia'
      },
    })
    await giveBack(calls, now)
    expect(sent.filter(([method]) => method === 'setTheme')).toEqual([
      ['setTheme', ['warm-dark']],
      ['setTheme', ['sepia']],
    ])
  })

  it('gives a document the theme a press wrote while its restore was being composed', async () => {
    // The whole chain, with the real memory: composed from the record, a
    // press's write returns (and writes the memory, synchronously, before it
    // sends its own call), and the restore's first call is sent.
    const id = 'give-back-press'
    const recorded: Theme = 'warm-dark'
    const calls = restoreCalls(STATE, themeAsItStands(id, recorded))
    rememberTheme(id, 'sepia')
    const { sent, now } = setup({ theme: () => themeAsItStands(id, recorded) })
    await giveBack(calls, now)
    expect(sent[0], 'record sepia, switch Sepia, and the map sepia').toEqual([
      'setTheme',
      ['sepia'],
    ])
  })

  it('still reads the speed and the pause again for each call', async () => {
    let remembered: Remembered = { speed: null, playing: null }
    const sent: [string, unknown[]][] = []
    const { now } = setup({
      remembered: () => remembered,
      send: async (method, args) => {
        sent.push([method, args])
        // A Pause and a new speed pressed during the loop.
        if (method === 'setTheme') remembered = { speed: 300, playing: true }
      },
    })
    await giveBack(restoreCalls({ ...STATE, playing: true }, 'warm-dark'), now)
    expect(sent.find(([method]) => method === 'setSpeed')).toEqual(['setSpeed', [300]])
    expect(sent[sent.length - 1], 'started again as it now is').toEqual(['setPlaying', [true]])
  })

  it('stops the moment the navigation it was for has been replaced', async () => {
    let alive = true
    const sent: [string, unknown[]][] = []
    const { now } = setup({
      alive: () => alive,
      send: async (method, args) => {
        sent.push([method, args])
        alive = false
      },
    })
    await giveBack(restoreCalls(STATE, 'warm-dark'), now)
    expect(sent, 'one call, and no more into a page that is not on screen').toHaveLength(1)
  })

  it('goes on after a call is refused, or the bridge throws before it can ask', async () => {
    const sent: string[] = []
    let n = 0
    await giveBack(restoreCalls(STATE, 'warm-dark'), {
      ...setup().now,
      send: (method) => {
        sent.push(method)
        n += 1
        if (n === 1) return Promise.reject(new Error('this map cannot do that'))
        if (n === 2) throw new Error('no bridge')
        return Promise.resolve()
      },
    })
    expect(sent, 'every call was still sent').toEqual([
      'setTheme',
      'setPlaying',
      'showView',
      'setLabels',
      'setSpeed',
      'seek',
    ])
  })
})
