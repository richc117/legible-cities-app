// @vitest-environment jsdom
// Cell 05's two lists across an engine restart (issue 433, part c): the
// colours' rows and the order's are drawn from the feed as the engine read
// it, and an engine that goes takes them with it, so the rows of the last
// reading are not shown again while the feed is read anew.
//
// Drawn through `renderCell('lines')` with the kit real; each list is found
// by its name. Each test was watched failing under its mutation in
// `lines-inspection.mutations.json`.

import { afterEach, describe, expect, it } from 'vitest'
import type { EngineState } from '../../src/shared/engine'
import { answered, byName, cleanup, READY, renderCell } from '../support/render'
import { pending } from '../support/project-state'

afterEach(cleanup)

const RESTARTING: EngineState = { state: 'restarting', attempt: 1, reason: 'it stopped' }

/** Whether the list named `name` is drawn. */
function drawn(name: string): boolean {
  try {
    byName('list', name)
    return true
  } catch {
    return false
  }
}

/**
 * The cell drawn with the feed read, then the engine going, then coming
 * back with the feed's reading still on its way: whether the list named
 * `name` is drawn at each of the three.
 */
async function acrossARestart(name: string): Promise<boolean[]> {
  const view = renderCell('lines')
  await answered()
  const seen = [drawn(name)]
  view.rerender({ engine: RESTARTING })
  await answered()
  seen.push(drawn(name))
  view.rerender({ engine: READY, inspect: () => pending() })
  await answered()
  seen.push(drawn(name))
  return seen
}

describe('cell 05’s lists, as the engine restarts', () => {
  it('draws no colour rows of the last reading while the feed is read again', async () => {
    expect(await acrossARestart('Lines')).toEqual([true, false, false])
  })
})
