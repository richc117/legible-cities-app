// @vitest-environment jsdom
// The cheap edits, rendered (spec 037 part 2, issue 490, User Story 3): the
// line colours, the line order, the sizes with their looks and markers, and
// the line options, each driven through its own cell by one table of
// behaviours - the wait, the hold, the put-back, adoption and the panel
// going - against the one hook they share (`notebook/useCheapEdit.ts`).
//
// The cells are drawn into jsdom through `tests/support/render.tsx`
// (ADR-059): the adapter, its panels, the hook and the rules it asks are the
// app's own, and so are the kit, the cell's chrome and the looks' selects.
// The line order is pressed as a person presses it, by its "Move line A
// down" and "Move line A up" buttons, and the station's marker is changed by
// a real `change` on its select; what they show is read from the document.
// Two leaves stay stand-ins that keep the props they were last drawn with
// and draw nothing, because their gestures are a drag in a popover and a
// disclosure's own controls, which jsdom cannot make: the colour chip
// (`useColourPanel`, pressed through `onPick`, `onPickEnd`, `onClosed` and
// its reset) and the line options (`LineOptionsDisclosure`, through
// `onChoose`).
//
// The run is the stand-in in `tests/support/stand-in-run.ts`, with what a
// panel reads of one: its snapshot, a way to hear it change, and the four
// redraws, which start (`running`, of their kind) or are refused at once
// (`failed`, of their kind, with the engine's sentence) as `LayoutRun.#begin`
// does.
//
// Each row was watched failing under a mutation of the hook, named in its
// describe or beside it; the run of each is in the pull request.

import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineState } from '../../src/shared/engine'
import type { RunState } from '../../src/shared/layout'
import type { LineChoice, ProjectRecord } from '../../src/shared/project/types'
import { REDRAW_DELAY } from '../../src/renderer/src/colours'
import type { ExportRun } from '../../src/renderer/src/engine/exportRun'
import type { LayoutRun, RunSnapshot } from '../../src/renderer/src/engine/layoutRun'
import { ProjectProvider } from '../../src/renderer/src/notebook/context'
import ProjectHeader from '../../src/renderer/src/notebook/ProjectHeader'
import { READ_RETRY_MAX, useRefusedGone } from '../../src/renderer/src/notebook/useCheapEdit'
import {
  answered,
  BASE,
  byName,
  defaultProjectState,
  INSPECTION,
  press,
  renderCell,
  renderPanel,
  type RenderedCell,
} from '../support/render'
import { REFUSAL, snap, StandInRun, type Kind } from '../support/stand-in-run'

// The two leaves, each keeping the props it was last drawn with by its name.
const leaves = vi.hoisted(() => ({
  chips: new Map<string, Record<string, unknown>>(),
  options: new Map<string, Record<string, unknown>>(),
}))

vi.mock('../../src/renderer/src/ColourChip', () => ({
  useColourPanel: (props: Record<string, unknown>) => {
    leaves.chips.set(props.label as string, props)
    return { chip: null, panel: null }
  },
}))
vi.mock('../../src/renderer/src/LineOptionsDisclosure', () => ({
  default: (props: Record<string, unknown>) => {
    leaves.options.set(props.label as string, props)
    return null
  },
}))

/** An export, as far as the cells' `busyNow` reads one. */
const exporter = { snapshot: { state: 'idle' as RunState } }

const inspected = Promise.resolve(INSPECTION)

/** What the bridge answers for the store's record (the screen's, unless a test moves it) and the engine. */
const bridge: {
  record: ProjectRecord | null
  engine: EngineState
  reads: number
  /** Errors the next reads are refused with, one each, in order. */
  fails: Error[]
} = {
  record: null,
  reads: 0,
  fails: [],
  engine: { state: 'ready', version: '0.19.0', protocol: 1 },
}

let view: RenderedCell
let mounted = false
let run: StandInRun

/** The record the screen holds now. */
const shownRecord = (): ProjectRecord => {
  const project = view.state.project
  if (project === null) throw new Error('the screen holds no record')
  return project
}

/** The screen drawn again with some of its state changed. */
function draw(patch: { project?: ProjectRecord; settling?: boolean; exporting?: boolean }): void {
  const { project, ...rest } = patch
  view.rerender(
    project === undefined ? rest : { ...rest, project: { ...project, readOnly: false } },
  )
}

/** The project's record moves: an answer to a write, or a finished run's read-back. */
const record = (patch: Partial<ProjectRecord>): void =>
  draw({ project: { ...shownRecord(), ...patch } })

/** Time passes, and whatever React was told meanwhile is drawn. */
function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

/** The run tells its listeners, as a real one does, and the screen draws. */
function moved(next: RunSnapshot): void {
  act(() => run.move(next))
}

/** A handler a stand-in leaf was given, called as its gesture would call it. */
function gesture(call: () => void): void {
  act(call)
}

function unmount(): void {
  view.unmount()
  mounted = false
}

/** Opens the screen on `cell`, and lets the feed's lines arrive. */
async function open(cell: 'lines' | 'style', project: Partial<ProjectRecord> = {}): Promise<void> {
  view = renderCell(
    cell,
    {
      project: { ...BASE, ...project, readOnly: false },
      exporter: exporter as unknown as ExportRun,
      exporting: false,
      settling: false,
    },
    {
      run,
      // What a change drawn after its panel went reads now: the store's
      // record and the engine's state, as main would answer them.
      api: {
        projects: {
          get: () => {
            bridge.reads += 1
            const failing = bridge.fails.shift()
            return failing === undefined
              ? Promise.resolve({ ...(bridge.record ?? shownRecord()), readOnly: false })
              : Promise.reject(failing)
          },
        },
        engine: { state: () => Promise.resolve(bridge.engine) },
      },
    },
  )
  mounted = true
  await act(async () => {
    await inspected
  })
}

/** An export holds the page, or lets it go: what the cell is told and what `busyNow` reads. */
function exporting(going: boolean): void {
  exporter.snapshot = { state: going ? 'running' : 'idle' }
  draw({ exporting: going })
}

const prop = <T,>(map: Map<string, Record<string, unknown>>, name: string, key: string): T => {
  const props = map.get(name)
  if (props === undefined) throw new Error(`nothing drawn as ${name}`)
  return props[key] as T
}

/**
 * One cheap edit as the table drives it: how a change is made through its
 * control, what the control shows, what each of its redraws was started
 * with, and where its value sits in the record. `one` and `two` are changes
 * a person makes; `other` arrives only in a record, and differs from `one`.
 */
interface Panel {
  name: string
  cell: 'lines' | 'style'
  /** The panel's own kind of run, and another cheap edit's. */
  own: Partial<Kind>
  other: Partial<Kind>
  /** The colours' rule: tried at a gesture's end, with no delay before it. */
  atOnce: boolean
  base: unknown
  one: unknown
  two: unknown
  other_: unknown
  make: (value: unknown) => void
  shown: () => unknown
  drawn: () => unknown[]
  /** The record and the engine's state each redraw was started with. */
  drawnOn: () => [ProjectRecord, unknown][]
  record: (value: unknown) => Partial<ProjectRecord>
}

const on = (calls: unknown[][]): [ProjectRecord, unknown][] =>
  calls.map(([record, engine]) => [record as ProjectRecord, engine])

const A = 'Choose the colour of line A'

const COLOURS: Panel = {
  name: 'Line colours',
  cell: 'lines',
  own: { recoloured: true },
  other: { reordered: true },
  atOnce: true,
  base: '#0072bc',
  one: '#111111',
  two: '#222222',
  other_: '#333333',
  // A colour chosen is a gesture's end; the feed's own is the line's reset.
  make: (hex) =>
    gesture(() =>
      hex === '#0072bc'
        ? prop<{ onReset: () => void }>(leaves.chips, A, 'reset').onReset()
        : prop<(hex: string) => void>(leaves.chips, A, 'onPickEnd')(hex as string),
    ),
  shown: () => prop<string>(leaves.chips, A, 'colour'),
  drawnOn: () => on(run.recolour.mock.calls),
  drawn: () => run.recolour.mock.calls.map(([, , palette]) => palette.colors.A ?? '#0072bc'),
  record: (hex): Partial<ProjectRecord> => ({
    colors: hex === '#0072bc' ? {} : { A: hex as string },
  }),
}

/** The order on screen as the panel draws it: empty while it is the engine's own. */
const orderShown = (): string[] => {
  const labels = [...view.host.querySelectorAll('.line-name')].map((node) => node.textContent)
  const order = labels.filter((label) => ['A', 'B', 'C'].includes(label)).slice(-3)
  return order.join('') === 'ABC' ? [] : order
}

const ORDER: Panel = {
  name: 'Line order',
  cell: 'lines',
  own: { reordered: true },
  other: { restyled: true },
  atOnce: false,
  base: [],
  one: ['B', 'A', 'C'],
  two: ['B', 'C', 'A'],
  other_: ['C', 'A', 'B'],
  // Line A pressed down or up, one place a press, until the list stands as
  // asked.
  make: (target) => {
    const want = (target as string[]).join('') || 'ABC'
    for (let step = 0; step < 3; step++) {
      const now = orderShown().join('') || 'ABC'
      if (now === want) return
      press(`Move line A ${want.indexOf('A') > now.indexOf('A') ? 'down' : 'up'}`)
    }
  },
  shown: orderShown,
  drawnOn: () => on(run.reorder.mock.calls),
  drawn: () => run.reorder.mock.calls.map(([, , order]) => order),
  record: (order) => ({ lineOrder: order as string[] }),
}

/** The station marker's select, the platform's own inside the kit's dropdown. */
const marker = (): HTMLSelectElement => byName('combobox', 'Station marker') as HTMLSelectElement

/**
 * A choice made on the select named `name`, as a person makes it: its value
 * set through the platform's own setter, which is what React's tracker
 * reads, and then the `change` the platform sends.
 */
function choose(name: string, value: string): void {
  const select = byName('combobox', name) as HTMLSelectElement
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const SIZES: Panel = {
  name: 'Sizes',
  cell: 'style',
  own: { restyled: true },
  other: { reordered: true },
  atOnce: false,
  base: 'circle',
  one: 'tick',
  two: 'square',
  other_: 'square',
  // The station's marker, one of the choices a look feeds the sizes with,
  // changed on its select as a person changes it.
  make: (shape) => choose('Station marker', shape as string),
  shown: () => marker().value,
  drawnOn: () => on(run.restyle.mock.calls),
  drawn: () => run.restyle.mock.calls.map(([, , style]) => style.stationShape ?? 'circle'),
  record: (shape) => ({ style: shape === 'circle' ? {} : { stationShape: shape as 'tick' } }),
}

const OPTIONS: Panel = {
  name: 'Line options',
  cell: 'lines',
  own: { recoloured: true, optioned: true },
  other: { recoloured: true },
  atOnce: false,
  base: {},
  one: { hidden: true },
  two: { width: 1.25 },
  other_: { dash: 'dashed' },
  make: (choice) =>
    gesture(() =>
      prop<(next: LineChoice) => void>(leaves.options, 'A', 'onChoose')(choice as LineChoice),
    ),
  shown: () => prop<LineChoice>(leaves.options, 'A', 'choice'),
  drawnOn: () => on(run.redrawLines.mock.calls),
  drawn: () => run.redrawLines.mock.calls.map(([, , lines]) => lines.A ?? {}),
  record: (choice) => ({
    lines: Object.keys(choice as object).length === 0 ? undefined : { A: choice as LineChoice },
  }),
}

const PANELS = [COLOURS, ORDER, SIZES, OPTIONS]

/** The wait before a change is first tried: none for a colour, the delay for the others. */
const firstTry = (panel: Panel): void => {
  if (!panel.atOnce) wait(REDRAW_DELAY)
}

beforeEach(() => {
  vi.useFakeTimers()
  run = new StandInRun()
  exporter.snapshot = { state: 'idle' }
  bridge.record = null
  bridge.reads = 0
  bridge.fails = []
  bridge.engine = { state: 'ready', version: '0.19.0', protocol: 1 }
  for (const map of Object.values(leaves)) map.clear()
})

afterEach(() => {
  if (mounted) unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// Mutations of `useCheapEdit.ts`: the delay not kept (`arm` with 0 for
// `latest.current.delay`) - the three debounced rows draw before the delay;
// `atOnce` not kept (`change` always arming) - the colours' row draws nothing
// at the release.
describe.each(PANELS)('$name: a change is drawn after the panel’s delay', (panel) => {
  it(
    panel.atOnce
      ? 'follows a gesture without drawing, and draws once at its end, at once'
      : 'draws two changes in quick succession once, after the delay and not before',
    async () => {
      await open(panel.cell)
      if (panel.atOnce) {
        for (const hex of ['#010101', '#020202', '#030303'])
          gesture(() => prop<(hex: string) => void>(leaves.chips, A, 'onPick')(hex))
        wait(REDRAW_DELAY * 3)
        expect(panel.drawn(), 'a colour on the way draws nothing').toEqual([])
        panel.make(panel.one)
        expect(panel.drawn(), 'drawn at the release, with no wait').toEqual([panel.one])
      } else {
        panel.make(panel.one)
        wait(REDRAW_DELAY / 2)
        panel.make(panel.two)
        expect(panel.shown(), 'shown at once').toEqual(panel.two)
        wait(REDRAW_DELAY - 1)
        expect(panel.drawn(), 'not before the delay').toEqual([])
        wait(1)
        expect(panel.drawn(), 'once, with the last').toEqual([panel.two])
      }
    },
  )
})

// Mutation: `mustWait` asked without the screen's hold (`held: facts.held ||`
// taken out of `attempt`) - every row here draws during the read-back. The
// line order's under R7-02's own mutation (`held: disabled || settling` in
// `LineOrder.tsx` made `held: disabled`) too: the hold no test could fail
// before (codebase review R7-02).
describe.each(PANELS)('$name: a change is held while the way is not clear', (panel) => {
  it('holds a change while the record a finished run wrote is read back, then draws it', async () => {
    await open(panel.cell)
    draw({ settling: true })
    panel.make(panel.one)
    wait(REDRAW_DELAY * 5)
    expect(panel.drawn(), 'nothing while the record is read back').toEqual([])
    expect(panel.shown(), 'and the change stays on screen').toEqual(panel.one)
    draw({ settling: false })
    wait(REDRAW_DELAY)
    expect(panel.drawn()).toEqual([panel.one])
  })

  it('holds a change while a run goes, and draws it once the screen has seen the run end', async () => {
    // Mutation: `mustWait` asked with `rendered: run.snapshot` - the run as
    // it is now rather than as the screen drew it - the change is drawn in
    // the beat after the run ends, before the screen has its record.
    await open(panel.cell)
    moved(snap('running'))
    panel.make(panel.one)
    wait(REDRAW_DELAY * 3)
    expect(panel.drawn(), 'nothing while a layout goes').toEqual([])
    run.moveQuietly(snap('done'))
    wait(REDRAW_DELAY * 2)
    expect(panel.drawn(), 'nor in the beat before the screen has seen it end').toEqual([])
    moved(run.snapshot)
    wait(REDRAW_DELAY)
    expect(panel.drawn()).toEqual([panel.one])
  })

  it('holds a change while an export reads the page, and draws it once', async () => {
    await open(panel.cell)
    exporting(true)
    panel.make(panel.one)
    wait(REDRAW_DELAY * 5)
    expect(panel.drawn()).toEqual([])
    exporting(false)
    wait(REDRAW_DELAY)
    expect(panel.drawn()).toEqual([panel.one])
  })
})

// Mutations: `refusedAtStart`'s answer not acted on (`putBack()` taken out of
// `attempt`) - the first row keeps the change on screen; `usePutBack` not
// called by the hook - the second row's control never goes back.
describe.each(PANELS)('$name: the control goes back to the record when its draw stops', (panel) => {
  it('goes back at once when its own start is refused after a stop of its own', async () => {
    run.moveQuietly(snap('failed', panel.own, REFUSAL))
    run.starts = 'refuse'
    await open(panel.cell)
    panel.make(panel.one)
    // A colour is tried at its release, so it is refused before it can be seen.
    if (!panel.atOnce) expect(panel.shown()).toEqual(panel.one)
    firstTry(panel)
    expect(panel.drawn(), 'the start was asked for').toEqual([panel.one])
    expect(panel.shown(), 'and the control is back to the record').toEqual(panel.base)
    // The panel is there to go back, and cell 02 says why: the project's
    // status line is not told (it is for a panel that has gone).
    expect(heard()).toBeNull()
  })

  it('goes back once when its own redraw stops, and not for a record that arrives while it stays stopped', async () => {
    // Issue 360: a change made after the stop and held for an export is not
    // put back, nor dropped, by a rename.
    await open(panel.cell)
    panel.make(panel.one)
    firstTry(panel)
    expect(run.snapshot.state).toBe('running')
    moved(snap('cancelled', panel.own))
    expect(panel.shown(), 'back to the record').toEqual(panel.base)
    exporting(true)
    panel.make(panel.two)
    wait(REDRAW_DELAY * 3)
    record({ name: 'LA Metro' })
    wait(REDRAW_DELAY * 3)
    expect(panel.shown(), 'not taken back by a rename').toEqual(panel.two)
    exporting(false)
    wait(REDRAW_DELAY)
    expect(panel.drawn(), 'and drawn once the export let go').toEqual([panel.one, panel.two])
  })

  it('does not go back for a stop of another kind of run', async () => {
    await open(panel.cell)
    exporting(true)
    panel.make(panel.one)
    moved(snap('failed', panel.other, 'Another redraw failed.'))
    expect(panel.shown()).toEqual(panel.one)
  })
})

// Mutation: the own-redraw clause taken out of the hook's adoption effect
// (`if (snapshot.state === 'running' && own(snapshot)) return`) - the first
// row takes the record mid-redraw. On `main` the line order and the colours
// took it there, and the sizes and the line options did not (Rule 2).
describe.each(PANELS)('$name: the record is taken when the panel’s own redraw ends', (panel) => {
  it('does not take the record for its fields while its own redraw goes, and takes it after', async () => {
    await open(panel.cell)
    panel.make(panel.one)
    firstTry(panel)
    expect(run.snapshot.state).toBe('running')
    // A record answered before the redraw's own write, carrying another value.
    record({ ...panel.record(panel.other_), name: 'LA Metro' })
    expect(panel.shown(), 'not taken mid-redraw').toEqual(panel.one)
    // The redraw ends, and its record is read back.
    moved(snap('done', panel.own))
    record(panel.record(panel.one))
    expect(panel.shown()).toEqual(panel.one)
    // A record that moves the field now, with nothing drawing, is taken.
    record(panel.record(panel.other_))
    expect(panel.shown(), 'taken once nothing is drawing').toEqual(panel.other_)
  })

  it('takes a record at once while a redraw of another kind goes', async () => {
    await open(panel.cell)
    moved(snap('running', panel.other))
    record(panel.record(panel.other_))
    expect(panel.shown()).toEqual(panel.other_)
  })
})

// Mutations: the hook's `leave` cancelling (clearing its timer and
// returning) - the rows draw nothing; `leave` not waiting on when the way is
// held - the held rows' change is dropped; `drawGone` not saying what it was
// refused with - the refusal's line stays empty; and the ones named beside
// the rows the review of issue 490 asked for.
describe.each(PANELS)('$name: a change waiting as its panel goes is flushed', (panel) => {
  it.runIf(!panel.atOnce)(
    'draws a change still in its delay at once as the panel goes',
    async () => {
      await open(panel.cell)
      panel.make(panel.one)
      unmount()
      expect(panel.drawn()).toEqual([panel.one])
    },
  )

  it('draws a change held as the panel goes once the way clears, and never before', async () => {
    await open(panel.cell)
    exporting(true)
    panel.make(panel.one)
    wait(REDRAW_DELAY * 2)
    unmount()
    wait(REDRAW_DELAY * 5)
    await answered()
    expect(panel.drawn(), 'not while the export reads the page').toEqual([])
    exporter.snapshot = { state: 'idle' }
    wait(REDRAW_DELAY)
    await answered()
    expect(panel.drawn()).toEqual([panel.one])
    expect(vi.getTimerCount(), 'and nothing is left waiting').toBe(0)
  })

  it('draws it from the record and the engine’s state read when it is drawn, not the last render’s', async () => {
    // Mutation: `attemptGone` drawing with `facts.project` and `facts.engine`
    // - a project laid out since the panel went would be refused as one with
    // nothing drawn, and an engine started since as not ready (review of
    // issue 490).
    await open(panel.cell)
    exporting(true)
    panel.make(panel.one)
    unmount()
    bridge.record = { ...shownRecord(), name: 'Read now' }
    bridge.engine = { state: 'ready', version: '0.19.1', protocol: 1 }
    exporter.snapshot = { state: 'idle' }
    wait(REDRAW_DELAY)
    await answered()
    const [[record, engine]] = panel.drawnOn()
    expect(record.name).toBe('Read now')
    expect(engine).toBe(bridge.engine)
  })

  it('draws nothing for a change the record read then already holds', async () => {
    // Mutation: `drawGone` not comparing with the record it was handed.
    await open(panel.cell)
    exporting(true)
    panel.make(panel.one)
    unmount()
    bridge.record = { ...shownRecord(), ...panel.record(panel.one) }
    exporter.snapshot = { state: 'idle' }
    wait(REDRAW_DELAY)
    await answered()
    expect(bridge.reads, 'the record was read, so nothing drawn is an answer').toBe(1)
    expect(panel.drawn()).toEqual([])
    expect(vi.getTimerCount(), 'and nothing is left waiting').toBe(0)
  })

  it('drops a change held as the panel went when the panel’s own redraw then stops', async () => {
    // A stop stops everything, with the panel there or not. Mutation: the
    // gone editor not listening to the run (`orphan`'s `stoppedNow`).
    await open(panel.cell)
    panel.make(panel.one)
    firstTry(panel)
    expect(run.snapshot.state).toBe('running')
    panel.make(panel.two)
    unmount()
    run.move(snap('cancelled', panel.own))
    expect(vi.getTimerCount(), 'dropped at the stop, with nothing left waiting').toBe(0)
    wait(REDRAW_DELAY * 5)
    await answered()
    expect(panel.drawn()).toEqual([panel.one])
    expect(bridge.reads, 'and never read for a draw').toBe(0)
  })

  it('drops it too when its own redraw stopped in the beat before the panel went', async () => {
    // The stop lands after the last render and before the unmount, so the
    // panel never drew it. Mutation: `orphan` watching from the run as it is
    // at the unmount rather than as the panel drew it (second review).
    await open(panel.cell)
    panel.make(panel.one)
    firstTry(panel)
    panel.make(panel.two)
    run.moveQuietly(snap('cancelled', panel.own))
    unmount()
    expect(vi.getTimerCount(), 'nothing waits').toBe(0)
    wait(REDRAW_DELAY * 5)
    await answered()
    expect(panel.drawn()).toEqual([panel.one])
  })

  it('is taken over by a panel of its kind that comes back, so only the later choice is drawn', async () => {
    // The project left while an export holds a change, and opened again
    // before it ends. Mutation: `here` not taking the orphan over - the
    // panel shows the record, and the change left behind is drawn after the
    // one made since, over it (review of issue 490).
    await open(panel.cell)
    exporting(true)
    panel.make(panel.one)
    unmount()
    for (const map of Object.values(leaves)) map.clear()
    await open(panel.cell)
    exporting(true)
    expect(panel.shown(), 'the change left behind is on screen again').toEqual(panel.one)
    panel.make(panel.two)
    exporting(false)
    wait(REDRAW_DELAY * 5)
    await answered()
    expect(panel.drawn(), 'one draw, of the later choice').toEqual([panel.two])
  })

  it('says a flush refused at its start on the project’s status line', async () => {
    await open(panel.cell)
    exporting(true)
    panel.make(panel.one)
    unmount()
    run.starts = 'refuse'
    exporter.snapshot = { state: 'idle' }
    wait(REDRAW_DELAY)
    await answered()
    expect(panel.drawn()).toEqual([panel.one])
    expect(heard(), 'the engine’s sentence, for the status line').toBe(REFUSAL)
    // The next start moves the run on, and the sentence goes with it.
    run.move(snap('running', panel.own))
    expect(heard()).toBeNull()
  })

  it('does not say the refusal again when Run all puts the very snapshot back', async () => {
    // Run all with nothing left to run goes back to the snapshot it started
    // from (`LayoutRun.#withdraw`), the same object. Mutation:
    // `sayRefusedGone` keeping the sentence by the snapshot alone, with no
    // listener to forget it at the run's first move.
    await open(panel.cell)
    exporting(true)
    panel.make(panel.one)
    unmount()
    run.starts = 'refuse'
    exporter.snapshot = { state: 'idle' }
    wait(REDRAW_DELAY)
    await answered()
    const refused = run.snapshot
    expect(heard()).toBe(REFUSAL)
    run.move(snap('running'))
    run.move(refused)
    expect(heard(), 'not again, for the same snapshot put back').toBeNull()
  })

  it('waits on when the record cannot be read for a moment, and draws it after', async () => {
    // Mutation: any refused read ending the change, as one for a project
    // that is gone does.
    await open(panel.cell)
    exporting(true)
    panel.make(panel.one)
    unmount()
    bridge.fails = [new Error("Error invoking remote method 'projects:get': Error: busy")]
    exporter.snapshot = { state: 'idle' }
    wait(REDRAW_DELAY)
    await answered()
    expect(panel.drawn(), 'not on the refused read').toEqual([])
    // Asked again after twice the delay (the back-off's first step).
    wait(REDRAW_DELAY * 2)
    await answered()
    expect(bridge.reads).toBe(2)
    expect(panel.drawn()).toEqual([panel.one])
  })

  it('asks again after twice the last wait while reads are refused, up to its cap', async () => {
    // An engine that stays away refuses every read. Mutation: the wait not
    // doubled (`arm(unbuilt.backoff)` made `arm()`) - asked every delay, for
    // as long as the engine is away.
    await open(panel.cell)
    exporting(true)
    panel.make(panel.one)
    unmount()
    bridge.fails = Array.from(
      { length: 9 },
      () => new Error("Error invoking remote method 'engine:state': Error: unavailable"),
    )
    exporter.snapshot = { state: 'idle' }
    wait(REDRAW_DELAY)
    await answered()
    expect(bridge.reads, 'the first try').toBe(1)
    const waits = [2, 4, 8, 16, 32, 64].map((times) => REDRAW_DELAY * times)
    for (const each of [...waits, READ_RETRY_MAX, READ_RETRY_MAX]) {
      const before = bridge.reads
      wait(each - 1)
      await answered()
      expect(bridge.reads, `not before ${each}ms`).toBe(before)
      wait(1)
      await answered()
      expect(bridge.reads, `asked again after ${each}ms`).toBe(before + 1)
    }
    expect(READ_RETRY_MAX, 'the cap is reached before the doubling would pass it').toBeLessThan(
      REDRAW_DELAY * 128,
    )
    expect(panel.drawn(), 'never dropped, nor drawn without its record').toEqual([])
    // The engine answers: drawn, and nothing left waiting.
    wait(READ_RETRY_MAX)
    await answered()
    expect(panel.drawn()).toEqual([panel.one])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('starts its back-off again once a read has answered', async () => {
    // A refused read, then one that answers while the way is held again,
    // then another refusal: the wait after it is the first step, twice the
    // delay, not the step after the last. Mutation: the back-off not reset
    // on an answer (`unbuilt.backoff = 0` taken out).
    await open(panel.cell)
    exporting(true)
    panel.make(panel.one)
    unmount()
    bridge.fails = [new Error("Error invoking remote method 'engine:state': Error: unavailable")]
    exporter.snapshot = { state: 'idle' }
    wait(REDRAW_DELAY)
    await answered()
    expect(bridge.reads, 'refused').toBe(1)
    // Asked again after twice the delay, and answered - but an export has
    // taken the page while the read was on its way.
    wait(REDRAW_DELAY * 2)
    exporter.snapshot = { state: 'running' }
    await answered()
    expect(bridge.reads, 'answered').toBe(2)
    bridge.fails = [new Error("Error invoking remote method 'engine:state': Error: unavailable")]
    exporter.snapshot = { state: 'idle' }
    wait(REDRAW_DELAY)
    await answered()
    expect(bridge.reads, 'refused again').toBe(3)
    wait(REDRAW_DELAY * 2 - 1)
    await answered()
    expect(bridge.reads, 'not before twice the delay').toBe(3)
    wait(1)
    await answered()
    expect(bridge.reads, 'asked again after twice the delay, not after more').toBe(4)
    expect(panel.drawn()).toEqual([panel.one])
  })

  it('ends quietly when the project is gone', async () => {
    // Mutation: a "not found" kept waiting like any other refused read.
    await open(panel.cell)
    exporting(true)
    panel.make(panel.one)
    unmount()
    bridge.fails = [new Error("Error invoking remote method 'projects:get': Error: not found")]
    exporter.snapshot = { state: 'idle' }
    wait(REDRAW_DELAY)
    await answered()
    expect(bridge.reads).toBe(1)
    expect(vi.getTimerCount(), 'nothing waits').toBe(0)
    wait(REDRAW_DELAY * 3)
    await answered()
    expect(panel.drawn()).toEqual([])
    expect(heard()).toBeNull()
  })
})

/** What the project's status line is told of a refused flush, for the run as it now stands. */
function heard(): string | null {
  let said: string | null = null
  function Probe(): null {
    said = useRefusedGone(run as unknown as LayoutRun, run.snapshot)
    return null
  }
  renderPanel(<Probe />).unmount()
  return said
}

// Cell 05 holds two cheap edits, the colours and the line options, and a
// redraw for line options is the colours' kind of run to the run graph
// (`recoloured`). Each goes back for its own stop only (issue 394).
describe('the colours and the line options, in one cell', () => {
  it('a stopped options redraw does not put a held colour back, nor a stopped colours redraw a held option', async () => {
    // Mutation: the colours' own kind read as `recoloured` alone.
    await open('lines')
    exporting(true)
    COLOURS.make(COLOURS.one)
    moved(snap('failed', OPTIONS.own, 'The options redraw failed.'))
    expect(COLOURS.shown(), 'the colour stays').toEqual(COLOURS.one)
    OPTIONS.make(OPTIONS.one)
    moved(snap('failed', COLOURS.own, 'The colours redraw failed.'))
    expect(OPTIONS.shown(), 'the option stays').toEqual(OPTIONS.one)
  })
})

// The colours' gesture rule (issue 262), which `colours.test.ts` held over
// the panel's own copy of it until issue 490: what a release does, what a
// release that could not be built does, and when the record may take the
// screen back. No interval is in any of it: a drag of any speed, with any
// pause in it, is the same calls in the same order.
describe('the colours: the map follows the end of a gesture', () => {
  const pick = (hex: string): void =>
    gesture(() => prop<(hex: string) => void>(leaves.chips, A, 'onPick')(hex))
  const closed = (): void => gesture(() => prop<() => void>(leaves.chips, A, 'onClosed')())

  it('a gesture of fifty colours is one build, at its end, with the colour it ended on', async () => {
    await open('lines')
    for (let i = 0; i < 50; i++) pick(`#${String(i + 10).repeat(3)}`)
    expect(COLOURS.shown()).toBe('#595959')
    expect(COLOURS.drawn()).toEqual([])
    COLOURS.make('#222222')
    expect(COLOURS.drawn()).toEqual(['#222222'])
  })

  it('a panel closed with a gesture still going draws what the swatch showed', async () => {
    await open('lines')
    pick('#111111')
    closed()
    expect(COLOURS.drawn()).toEqual(['#111111'])
  })

  it('a later release replaces a held one: one build when the way clears, with the later', async () => {
    await open('lines')
    exporting(true)
    COLOURS.make('#111111')
    COLOURS.make('#222222')
    exporting(false)
    wait(REDRAW_DELAY)
    expect(COLOURS.drawn()).toEqual(['#222222'])
  })

  it('a release back to the record after a held one builds nothing once clear', async () => {
    await open('lines')
    exporting(true)
    COLOURS.make('#111111')
    COLOURS.make('#0072bc')
    exporting(false)
    wait(REDRAW_DELAY * 3)
    expect(COLOURS.drawn()).toEqual([])
  })

  it('a colour put back while the build of the one before runs is held, and drawn once that build has written (issue 399)', async () => {
    // Mutation: the comparison made before the hold (`facts.same` asked
    // ahead of `mustWait` in `attempt`) - the colour put back equals the
    // record still on disk and is dropped, the build writes #111111, and
    // the swatch follows the record back to it by itself.
    await open('lines')
    COLOURS.make('#111111')
    expect(run.snapshot.state).toBe('running')
    COLOURS.make('#0072bc')
    wait(REDRAW_DELAY * 2)
    expect(COLOURS.drawn(), 'held while the build runs').toEqual(['#111111'])
    moved(snap('done', COLOURS.own))
    record(COLOURS.record('#111111'))
    expect(COLOURS.shown(), 'the swatch stays where the person left it').toBe('#0072bc')
    wait(REDRAW_DELAY)
    expect(COLOURS.drawn()).toEqual(['#111111', '#0072bc'])
  })

  it('does not build a held release under a gesture that is going; that gesture’s end is the one build', async () => {
    await open('lines')
    exporting(true)
    COLOURS.make('#111111')
    pick('#222222')
    exporting(false)
    wait(REDRAW_DELAY * 3)
    expect(COLOURS.drawn(), 'nothing under the hand').toEqual([])
    COLOURS.make('#333333')
    expect(COLOURS.drawn()).toEqual(['#333333'])
  })

  it('a record arriving under a gesture, or with a release held, does not move the chip', async () => {
    await open('lines')
    pick('#111111')
    record(COLOURS.record('#333333'))
    expect(COLOURS.shown(), 'under a gesture').toBe('#111111')
    exporting(true)
    COLOURS.make('#222222')
    record(COLOURS.record('#444444'))
    expect(COLOURS.shown(), 'with a release held').toBe('#222222')
  })

  it('a stop drops the held release and the gesture alike, and the record is shown again', async () => {
    await open('lines')
    COLOURS.make('#111111')
    pick('#222222')
    moved(snap('failed', COLOURS.own, 'The redraw failed.'))
    expect(COLOURS.shown()).toBe('#0072bc')
    // Nothing is left standing to hold the record off, or to build later.
    record(COLOURS.record('#333333'))
    expect(COLOURS.shown()).toBe('#333333')
    wait(REDRAW_DELAY * 3)
    expect(COLOURS.drawn()).toEqual(['#111111'])
  })
})

describe('the line order says it is waiting', () => {
  it('while a move is held, and not once it is drawn', async () => {
    // The order's own words: an export is minutes, and a move that waits
    // must not look like one that landed.
    await open('lines')
    exporting(true)
    ORDER.make(ORDER.one)
    wait(REDRAW_DELAY)
    const status = (): string =>
      [...view.host.querySelectorAll('.hint')].map((node) => node.textContent).join(' ')
    expect(status()).toContain('Waiting for the map to be free')
    exporting(false)
    wait(REDRAW_DELAY)
    expect(ORDER.drawn()).toEqual([ORDER.one])
    expect(status()).not.toContain('Waiting for the map to be free')
  })

  it('takes the line’s colour from the record at once while its own redraw goes', async () => {
    // Every other field is the record's at once (User Story 3, scenario 4).
    await open('lines')
    ORDER.make(ORDER.one)
    wait(REDRAW_DELAY)
    expect(run.snapshot.state).toBe('running')
    record({ colors: { A: '#123456' } })
    // The document writes a colour back in its own form: #123456 is rgb(18, 52, 86).
    const swatches = [...view.host.querySelectorAll<HTMLElement>('.swatch')].map(
      (node) => node.style.background,
    )
    expect(swatches).toContain('rgb(18, 52, 86)')
  })
})

describe('the project’s status line says a refused flush', () => {
  const failed = snap('failed', { recoloured: true }, REFUSAL)
  const line = (refused: string | null): string =>
    renderToStaticMarkup(
      <ProjectProvider value={{ ...defaultProjectState(), runSnapshot: failed, refused }}>
        <ProjectHeader />
      </ProjectProvider>,
    )

  it('after the cell’s failure, on the line and in its alert', () => {
    // Mutation: the header drawing `sentence` and `failure` as they were.
    const drawn = line(REFUSAL)
    expect(drawn).toContain(`05 Lines failed. ${REFUSAL}</p>`)
    expect(drawn).toContain(`role="alert">05 Lines failed. ${REFUSAL}</p>`)
  })

  it('and nothing more while there is none', () => {
    const drawn = line(null)
    expect(drawn).toContain('>05 Lines failed.</p>')
    expect(drawn).not.toContain(REFUSAL)
  })
})
