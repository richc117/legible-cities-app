// @vitest-environment jsdom
// Cell 04's Look across an engine restart (issue 433, part c): the looks
// the select offers are the running engine's, and an engine that comes back
// at another version offers none of the last one's while it is asked.
//
// Drawn through `renderCell('style')` with the kit real; the select is
// found by its name, and what it offers and says is read from the document.
// The looks are remembered per engine version by `looks.ts`, so each test
// starts and ends with nothing remembered.
//
// Each test was watched failing under the mutation in
// `style-looks.mutations.json`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EngineState } from '../../src/shared/engine'
import { forgetLooks, LOOK_SENTENCE, looksFor, LOOKS_WAITING } from '../../src/renderer/src/looks'
import { answered, byName, cleanup, renderCell } from '../support/render'

const V1: EngineState = { state: 'ready', version: '0.19.0', protocol: 1 }
const V2: EngineState = { state: 'ready', version: '0.20.0', protocol: 1 }

/** The engine's answer to `style.presets`: one look, Beck. */
const PRESETS = {
  presets: [{ name: 'beck' as const, style: { line_width: 6, station_shape: 'tick' as const } }],
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
})
