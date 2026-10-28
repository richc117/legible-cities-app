// @vitest-environment jsdom
// Cell 04's Look across an engine restart (issue 433, part c): the looks
// the select offers are the running engine's. An engine that comes back at
// another version offers none of the last one's while it is asked, an
// engine whose state becomes known starts again from what it is, and an
// answer to an engine that has gone since it was asked is not taken.
//
// Drawn through `renderCell('style')` with the kit real; the select is
// found by its name, and what it offers and says is read from the document.
// The looks are remembered per engine version by `looks.ts`, so each test
// starts and ends with nothing remembered.
//
// Each test was watched failing under its mutation in
// `style-looks.mutations.json`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EngineState } from '../../src/shared/engine'
import type { StylePresets } from '../../src/shared/protocol'
import { forgetLooks, LOOK_SENTENCE, looksFor, LOOKS_WAITING } from '../../src/renderer/src/looks'
import { answered, byName, cleanup, renderCell } from '../support/render'

const V1: EngineState = { state: 'ready', version: '0.19.0', protocol: 1 }
const V2: EngineState = { state: 'ready', version: '0.20.0', protocol: 1 }
const STARTING: EngineState = { state: 'starting', attempt: 1 }
const RESTARTING: EngineState = { state: 'restarting', attempt: 1, reason: 'it stopped' }

/** The engine's answer to `style.presets`: one look, Beck. */
const PRESETS: StylePresets = {
  presets: [
    {
      name: 'beck',
      style: {
        line_width: 6,
        line_gap: 1.33,
        station_radius: 3.6,
        interchange_radius: 7.5,
        station_stroke: 3,
        label_size: 11,
        label_offset: 10,
        padding: 24,
        station_shape: 'tick',
      },
    },
  ],
}

beforeEach(forgetLooks)
afterEach(() => {
  cleanup()
  forgetLooks()
})

/** What the Look select offers, by value, and what is said under it. */
function look(): { offered: string[]; said: string | null | undefined } {
  const select = byName('combobox', 'Look') as HTMLSelectElement
  const said = select.getAttribute('aria-describedby')
  return {
    offered: [...select.options].map((option) => option.value),
    said: said === null ? null : document.getElementById(said)?.textContent,
  }
}

describe('cell 04’s Look, as the engine restarts', () => {
  it('offers none of the last engine’s looks while one at another version is asked', async () => {
    // The engine at v1 has answered, as it does the first time any
    // project's cell 04 asks.
    await looksFor({ request: () => ({ result: Promise.resolve(PRESETS) }) }, V1.version)
    const view = renderCell('style', { engine: V1 })
    await answered()
    expect(look()).toEqual({ offered: ['engine-own', 'beck'], said: LOOK_SENTENCE })

    // It comes back at v2, whose answer is still on its way (the bridge's
    // request never answers): the select waits, and offers no v1 look.
    view.rerender({ engine: V2 })
    await answered()
    expect(look()).toEqual({ offered: ['engine-own'], said: LOOKS_WAITING })
  })

  it('starts again from what the engine is once its state is known', async () => {
    // Every project screen reads the engine's state as unknown for a moment
    // as it opens, and shows the last list an engine answered meanwhile.
    await looksFor({ request: () => ({ result: Promise.resolve(PRESETS) }) }, V1.version)
    const view = renderCell('style', { engine: null })
    await answered()
    expect(look()).toEqual({ offered: ['engine-own', 'beck'], said: LOOK_SENTENCE })

    // The state arrives, and the engine is starting: there are no looks to
    // offer until it is running.
    view.rerender({ engine: STARTING })
    await answered()
    expect(look()).toEqual({ offered: ['engine-own'], said: LOOKS_WAITING })
  })

  for (const [ending, settle] of [
    ['refused', (answer: Deferred) => answer.reject(new Error('the engine stopped'))],
    ['answered', (answer: Deferred) => answer.resolve(PRESETS)],
  ] as const)
    it(`takes no answer to the engine that went: its first request ${ending} after it did`, async () => {
      // The first time an engine at v1 is asked, its answer still on its way.
      const answer = deferred()
      void looksFor({ request: () => ({ result: answer.promise }) }, V1.version)
      const view = renderCell('style', { engine: V1 })
      await answered()
      expect(look()).toEqual({ offered: ['engine-own'], said: LOOKS_WAITING })

      // The engine goes, and only then is the request it had out settled.
      view.rerender({ engine: RESTARTING })
      await answered()
      settle(answer)
      await answered()
      expect(look()).toEqual({ offered: ['engine-own'], said: LOOKS_WAITING })
    })
})

interface Deferred {
  promise: Promise<StylePresets>
  resolve(value: StylePresets): void
  reject(reason: Error): void
}

/** An answer the test settles when it chooses. */
function deferred(): Deferred {
  let resolve: (value: StylePresets) => void = () => undefined
  let reject: (reason: Error) => void = () => undefined
  const promise = new Promise<StylePresets>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
