// Cell 05's line options as the hook holds them (issue 399, spec 036 FR-010):
// `useLineOptions` rendered, with fake timers, so the guards that act late -
// after the redraw delay, or as the screen goes - are seen doing it.
//
// The suite renders nothing to a DOM, and needs none for this: the hook is
// called by a component that renders nothing, through React's own client,
// into a stand-in for the one element `createRoot` asks for and the window
// it reads the active element and the current event from. Nothing is added
// to the suite's dependencies. The run is a stand-in too, with the three
// things the hook reads of one: its snapshot, a way to hear it change, and
// `redrawLines`.
//
// Since issue 490 the guards are the cheap edits' one hook's
// (`notebook/useCheapEdit.ts`), and `cheap-edit.test.tsx` holds them for all
// four panels through their cells; here they are seen through the options'
// own hook, which is the only one with a gesture and a debounce together.
//
// Each test was watched failing under the mutation named in it.

import { act, type JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineState } from '../../src/shared/engine'
import type { ProjectLines, ProjectRecord } from '../../src/shared/project'
import type { RunState } from '../../src/shared/layout'
import { REDRAW_DELAY } from '../../src/renderer/src/colours'
import type { LayoutRun } from '../../src/renderer/src/engine/layoutRun'
import { useLineOptions, type LineOptionsState } from '../../src/renderer/src/useLineOptions'

// React's client reads this to know it is driven by `act`.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * The least `createRoot` and a commit ask of a container: an element's node
 * type and tag, a document to listen on, and a window whose active element
 * is nothing. The component renders nothing, so nothing is ever put in it.
 */
function container(): Element {
  const document: Record<string, unknown> = {
    nodeType: 9,
    activeElement: null,
    body: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
  const window = { document, HTMLIFrameElement: class {} }
  document.defaultView = window
  vi.stubGlobal('window', window)
  return {
    nodeType: 1,
    nodeName: 'DIV',
    tagName: 'DIV',
    ownerDocument: document,
    firstChild: null,
    textContent: '',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as Element
}

type Snap = { state: RunState; recoloured: boolean; optioned: boolean }

/**
 * A run as far as the hook reads one. `moveQuietly` changes its snapshot
 * without telling anyone, which is a run that has moved on since the last
 * render: the listener's re-render has not happened yet.
 */
class StandInRun {
  snapshot: Snap = { state: 'idle', recoloured: false, optioned: false }
  readonly #listeners = new Set<(snapshot: Snap) => void>()
  /** What `redrawLines` does: start a redraw, or refuse it at once as the run does. */
  starts: 'run' | 'refuse' = 'run'
  readonly redrawLines = vi.fn<
    (project: ProjectRecord, engine: unknown, lines: ProjectLines) => void
  >(() => {
    if (this.snapshot.state === 'running') return
    this.move(
      this.starts === 'run'
        ? { state: 'running', recoloured: true, optioned: true }
        : { state: 'failed', recoloured: true, optioned: true },
    )
  })

  subscribe(listener: (snapshot: Snap) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  moveQuietly(patch: Partial<Snap>): void {
    this.snapshot = { ...this.snapshot, ...patch }
  }

  move(patch: Partial<Snap>): void {
    this.moveQuietly(patch)
    for (const listener of this.#listeners) listener(this.snapshot)
  }

  /** Every set of options a redraw was started with, in order. */
  drawn(): ProjectLines[] {
    return this.redrawLines.mock.calls.map(([, , lines]) => lines)
  }
}

const READY: EngineState = { state: 'ready', version: '0.16.1', protocol: 1 }
const record = (lines?: ProjectLines): ProjectRecord => ({ id: 'p1', lines }) as ProjectRecord

interface Props {
  run: StandInRun
  project: ProjectRecord
  held?: boolean
  busyNow?: () => boolean
}

let root: Root
let mounted = false
let shown: LineOptionsState
let props: Props

function Harness(given: Props): JSX.Element | null {
  shown = useLineOptions({
    run: given.run as unknown as LayoutRun,
    project: given.project,
    engine: READY,
    held: given.held,
    busyNow: given.busyNow,
  })
  return null
}

/** The screen drawn with these props, or drawn again with some changed. */
function render(next: Partial<Props>): void {
  props = { ...props, ...next }
  act(() => root.render(<Harness {...props} />))
}

/** Time passes, and whatever React was told meanwhile is drawn. */
function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

/** The run tells its listeners, as a real one does, and the screen draws. */
function moved(run: StandInRun, patch: Partial<Snap>): void {
  act(() => run.move(patch))
}

function unmount(): void {
  act(() => root.unmount())
  mounted = false
}

beforeEach(() => {
  vi.useFakeTimers()
  root = createRoot(container())
  mounted = true
  props = { run: new StandInRun(), project: record() }
})

afterEach(() => {
  if (mounted) unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('a choice is drawn after the delay, once the way is clear', () => {
  it('draws a choice once, after the delay, and not before', () => {
    const run = new StandInRun()
    render({ run })
    act(() => shown.choose('A', { hidden: true }))
    expect(shown.lines, 'shown at once').toEqual({ A: { hidden: true } })
    wait(REDRAW_DELAY - 1)
    expect(run.redrawLines).not.toHaveBeenCalled()
    wait(1)
    expect(run.drawn()).toEqual([{ A: { hidden: true } }])
  })
})

describe('the guards that act late', () => {
  it('waits while a casing’s colour is under a hand, and draws what the hand left', () => {
    // A line hidden, then a casing's colour dragged on another before the
    // delay ends. Mutation: the cheap edits' hook asking `mustWait` without
    // `unbuilt.live !== null` - the hidden line would be drawn under the
    // hand, without the casing on screen beside it.
    const run = new StandInRun()
    render({ run, project: record({ B: { casing: { width: 0.5, color: '#000000' } } }) })
    act(() => shown.choose('A', { hidden: true }))
    act(() => shown.follow('B', { casing: { width: 0.5, color: '#ff0000' } }))
    wait(REDRAW_DELAY * 3)
    expect(
      run.redrawLines,
      'nothing is drawn while the hand is on the colour',
    ).not.toHaveBeenCalled()
    act(() => shown.panelClosed())
    wait(REDRAW_DELAY)
    expect(run.drawn()).toEqual([
      { A: { hidden: true }, B: { casing: { width: 0.5, color: '#ff0000' } } },
    ])
  })

  it('waits while the run has moved on since the screen last drew, then draws', () => {
    // A layout run ends in the beat between the last render and the delay's
    // end: its record has not been read, and a draw now would draw the
    // colours, the order and the sizes from before it. Mutation:
    // `useLineOptions` asking `mustWait` with `rendered: run.snapshot`, the
    // run as it is now rather than as the screen drew it, or `mustWait`
    // without its identity clause - the draw would go at the delay's end.
    const run = new StandInRun()
    render({ run })
    act(() => shown.choose('A', { hidden: true }))
    run.moveQuietly({ state: 'done' })
    wait(REDRAW_DELAY)
    expect(run.redrawLines, 'not while the screen has not seen the run end').not.toHaveBeenCalled()
    moved(run, {})
    wait(REDRAW_DELAY)
    expect(run.drawn()).toEqual([{ A: { hidden: true } }])
  })

  it('waits while the record a finished run wrote is read back, then draws', () => {
    // The colours section hands the hook `held` as `disabled || settling`.
    // Mutation: the cheap edits' hook asking `mustWait` without `held` - the
    // draw would go during the read-back, from the record before the run.
    const run = new StandInRun()
    render({ run, held: true })
    act(() => shown.choose('A', { hidden: true }))
    wait(REDRAW_DELAY * 5)
    expect(run.redrawLines, 'not while the record is read back').not.toHaveBeenCalled()
    render({ held: false })
    wait(REDRAW_DELAY)
    expect(run.drawn()).toEqual([{ A: { hidden: true } }])
  })

  it('draws a choice undone while its build ran, once that build has written', () => {
    // The issue's own case: a line hidden, its build running, and the
    // switch turned back on before it ends. Mutation: `nextLinesStep`
    // comparing before it waits - the line shown again equals the record
    // still on disk and is dropped, the build writes the line hidden, and
    // the switch goes back off by itself.
    const run = new StandInRun()
    render({ run })
    act(() => shown.choose('A', { hidden: true }))
    wait(REDRAW_DELAY)
    expect(run.snapshot.state).toBe('running')
    act(() => shown.choose('A', {}))
    wait(REDRAW_DELAY * 2)
    expect(run.drawn(), 'held while the build runs').toEqual([{ A: { hidden: true } }])
    // The build ends, having written the line hidden, and the record is read.
    moved(run, { state: 'done' })
    render({ project: record({ A: { hidden: true } }) })
    expect(shown.lines, 'the switch stays where the person left it').toEqual({})
    wait(REDRAW_DELAY)
    expect(run.drawn()).toEqual([{ A: { hidden: true } }, {}])
  })
})

describe('the screen going', () => {
  it('draws a choice held as the screen goes once the way clears, and arms nothing after', () => {
    // An export started since the last render holds the page; the screen
    // goes, and then the export ends. The choice is flushed (spec 037, User
    // Story 3 scenario 5): it waits on with nobody's screen behind it and is
    // drawn once the export lets go, since the redraw reads its own record
    // from the store. Mutation: the hook's `leave` dropping a change it
    // finds held rather than arming its wait - the choice would be lost.
    let exporting = true
    const run = new StandInRun()
    render({ run, busyNow: () => exporting })
    act(() => shown.choose('A', { hidden: true }))
    wait(REDRAW_DELAY)
    expect(run.redrawLines).not.toHaveBeenCalled()
    unmount()
    wait(REDRAW_DELAY * 5)
    expect(run.redrawLines, 'not while the export holds the page').not.toHaveBeenCalled()
    exporting = false
    wait(REDRAW_DELAY)
    expect(run.drawn()).toEqual([{ A: { hidden: true } }])
    expect(vi.getTimerCount(), 'and nothing is left waiting').toBe(0)
  })

  it('draws a choice seen on screen at once if the way is clear as the screen goes', () => {
    // Mutation: the hook's `leave` cancelling, rather than flushing.
    const run = new StandInRun()
    render({ run })
    act(() => shown.choose('A', { hidden: true }))
    unmount()
    expect(run.drawn()).toEqual([{ A: { hidden: true } }])
  })
})

describe('a start refused after a stop of its own kind', () => {
  it('goes back to the record at once, as for any stop', () => {
    // An options redraw failed when the engine went; a choice made while it
    // restarts is refused at its start, `failed` to `failed` with the kind
    // unmoved. Mutation: the hook not acting on `refusedAtStart`'s answer -
    // the switch would stay off though the line was neither drawn nor kept.
    const run = new StandInRun()
    run.moveQuietly({ state: 'failed', recoloured: true, optioned: true })
    run.starts = 'refuse'
    render({ run })
    act(() => shown.choose('A', { hidden: true }))
    expect(shown.lines).toEqual({ A: { hidden: true } })
    wait(REDRAW_DELAY)
    expect(run.redrawLines).toHaveBeenCalledTimes(1)
    expect(shown.lines, 'back to the record').toEqual({})
  })

  it('is left to the stop the screen sees when the stop before was of another kind', () => {
    // A layout run failed, then the options' start is refused: the kind
    // moved, so `usePutBack` puts the rows back at the next render.
    const run = new StandInRun()
    run.moveQuietly({ state: 'failed', recoloured: false, optioned: false })
    run.starts = 'refuse'
    render({ run })
    act(() => shown.choose('A', { hidden: true }))
    wait(REDRAW_DELAY)
    expect(shown.lines).toEqual({})
  })
})
