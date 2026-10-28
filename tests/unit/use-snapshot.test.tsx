// @vitest-environment jsdom
// A run's snapshot as a component reads it (`useSnapshot.ts`, issue 433):
// React's own outside-store hook over the run, so every cell, the screen's
// state and the export follow their run by one read and not by a copy kept
// in state and set from an effect.
//
// A probe draws the snapshot's state and keeps the state each of its
// renders saw. The run is the stand-in every rendered test uses
// (`tests/support/stand-in-run.ts`): it replaces its snapshot object on a
// move and keeps it otherwise, as every real source does.
//
// Mutations, each watched failing (`use-snapshot.mutations.json`): the
// snapshot read as a fresh copy each time - React renders for ever; the
// run's news not passed on to React - the probe stays where it was drawn.

import { act, useLayoutEffect, type JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { useSnapshot } from '../../src/renderer/src/useSnapshot'
import { cleanup, renderPanel } from '../support/render'
import { snap, StandInRun } from '../support/stand-in-run'

afterEach(cleanup)

/** The run's state as drawn, with the state each render saw kept in `seen`. */
function Probe({ source, seen }: { source: StandInRun; seen: string[] }): JSX.Element {
  const { state } = useSnapshot(source)
  seen.push(state)
  return <p data-probe="">{state}</p>
}

/** Moves the run once, after the commit and before any effect that subscribes has run. */
function MovesFirst({ source }: { source: StandInRun }): null {
  useLayoutEffect(() => source.move(snap('done')), [source])
  return null
}

const drawn = (): string | null | undefined => document.querySelector('[data-probe]')?.textContent

describe('a run’s snapshot, read by a component', () => {
  it('draws the run as it stands, then each move it makes', () => {
    const run = new StandInRun()
    renderPanel(<Probe source={run} seen={[]} />)
    expect(drawn(), 'as it stood').toBe('idle')
    act(() => run.move(snap('running')))
    expect(drawn(), 'the move').toBe('running')
    act(() => run.move(snap('done')))
    expect(drawn(), 'the next').toBe('done')
  })

  it('hears a move made after its render and before it had subscribed', () => {
    // The gap the old effect closed by reading the run again as it
    // subscribed: a move in it tells no listener of the probe's.
    const run = new StandInRun()
    renderPanel(
      <>
        <Probe source={run} seen={[]} />
        <MovesFirst source={run} />
      </>,
    )
    expect(drawn()).toBe('done')
  })

  it('draws a new run’s state on the first render after the run is swapped', () => {
    // The old hook drew the run it held before for one render, then put
    // the new one's in from an effect.
    const first = new StandInRun()
    const second = new StandInRun()
    second.moveQuietly(snap('failed'))
    const seen: string[] = []
    const view = renderPanel(<Probe source={first} seen={seen} />)
    const before = seen.length
    view.rerender(<Probe source={second} seen={seen} />)
    expect(seen.slice(before)[0], 'the first render after the swap').toBe('failed')
    expect(drawn()).toBe('failed')
    act(() => first.move(snap('running')))
    expect(drawn(), 'the run let go of is no longer heard').toBe('failed')
  })
})
