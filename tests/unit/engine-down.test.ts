import { describe, expect, it } from 'vitest'
import { isDown, isSettled, type EngineState } from '../../src/shared/engine'

// Which states of the engine are "not coming back" and which have "settled"
// are decided here and nowhere else (issue 595): the first-run check waits
// on the one, the Library's samples region reads the other. A table, so a
// state added to the union has to be placed in it.

const pin = { repo: 'https://github.com/x/y', tag: 'v1.0.0', version: '1.0.0', protocol: 1 }

const states: Record<EngineState['state'], EngineState> = {
  starting: { state: 'starting', attempt: 1 },
  ready: { state: 'ready', version: '1.0.0', protocol: 1 },
  restarting: { state: 'restarting', attempt: 2, reason: 'It exited.' },
  unavailable: { state: 'unavailable', reason: 'The engine could not be started.' },
  mismatched: { state: 'mismatched', expected: pin, found: { version: '0.9.0', protocol: 1 } },
  stopped: { state: 'stopped', reason: 'It exited. The engine failed 3 times in a row.' },
}

const table: ReadonlyArray<{ state: EngineState['state']; down: boolean; settled: boolean }> = [
  { state: 'starting', down: false, settled: false },
  { state: 'ready', down: false, settled: true },
  { state: 'restarting', down: false, settled: false },
  { state: 'unavailable', down: true, settled: true },
  { state: 'mismatched', down: true, settled: true },
  { state: 'stopped', down: true, settled: true },
]

describe('which engine states are down and which have settled', () => {
  it('holds a row for every state', () => {
    expect(table.map((r) => r.state).sort()).toEqual(Object.keys(states).sort())
  })

  it.each(table)('$state: down is $down', ({ state, down }) => {
    expect(isDown(states[state])).toBe(down)
  })

  it.each(table)('$state: settled is $settled', ({ state, settled }) => {
    expect(isSettled(states[state])).toBe(settled)
  })
})
