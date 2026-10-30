// @vitest-environment jsdom
// Where focus goes at the three resets and their Put back (issue 561): a
// reset that leaves something to put back disables itself, so it hands
// focus to Put back, the control that came; Put back goes as it is pressed
// and hands focus back to the reset, pressable again; and a reset with
// nothing to put back hands focus to its heading, as it always did (A6-07).
//
// The kit's button is the native one here (`tests/support/kit-stubs.ts`,
// ADR-059), because jsdom does not delegate focus into a shadow root and a
// hand-back onto a kit button cannot be seen otherwise; a native button is
// focused and pressed as a person's is, and a disabled one cannot be
// focused. The colour chip and the line options are the stand-ins
// `cheap-edit.test.tsx` uses, since neither is pressed here.
//
// Mutations, watched failing: `put-back-focus.mutations.json`.

import { act, type JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunState } from '../../src/shared/layout'
import type { DrawnFrom, ProjectRecord, ProjectTuning } from '../../src/shared/project/types'
import type { ExportRun } from '../../src/renderer/src/engine/exportRun'
import LayoutTuning from '../../src/renderer/src/LayoutTuning'
import { REDRAW_DELAY } from '../../src/renderer/src/colours'
import {
  PUT_BACK_COLOURS,
  PUT_BACK_SIZES,
  PUT_BACK_TUNING,
  TUNING_RESET_SAID,
} from '../../src/renderer/src/putBackWords'
import { RESET_LABEL } from '../../src/renderer/src/tuningRules'
import {
  answered,
  BASE,
  byName,
  cleanup,
  INSPECTION,
  renderCell,
  renderPanel,
  type RenderedCell,
} from '../support/render'
import { snap, StandInRun } from '../support/stand-in-run'

vi.mock('../../src/renderer/src/kit/Button', async () =>
  (await import('../support/kit-stubs')).kitButtonStub(),
)
vi.mock('../../src/renderer/src/ColourChip', () => ({
  useColourPanel: () => ({ chip: null, panel: null }),
}))
vi.mock('../../src/renderer/src/LineOptionsDisclosure', () => ({ default: () => null }))

const exporter = { snapshot: { state: 'idle' as RunState } }
const inspected = Promise.resolve(INSPECTION)

let run: StandInRun

beforeEach(() => {
  vi.useFakeTimers()
  run = new StandInRun()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** What the map was drawn from, for a record whose every cheap edit the map carries. */
const drawnFrom = (record: ProjectRecord): DrawnFrom => ({
  layout: record.layout ?? '',
  made: record.made,
  date: record.date,
  colors: record.colors,
  defaultColor: record.defaultColor,
  lineOrder: record.lineOrder,
  theme: record.theme,
  style: record.style,
})

/** A press of the button named `name` as a keyboard's: focused, then pressed. */
function pressFocused(name: string): void {
  const button = byName('button', name)
  act(() => {
    button.focus()
    button.click()
  })
  expect(document.activeElement, `${name} was focused for the press`).not.toBe(document.body)
}

/** The name of what holds focus: a button's words, or the heading it is. */
const focused = (): string => {
  const active = document.activeElement
  if (active === null || active === document.body) return 'nothing'
  return active.localName === 'button' ? (active.textContent ?? '') : active.localName
}

async function openCell(
  cell: 'lines' | 'style',
  project: Partial<ProjectRecord>,
): Promise<RenderedCell> {
  const view = renderCell(
    cell,
    {
      project: { ...BASE, ...project, readOnly: false },
      exporter: exporter as unknown as ExportRun,
      exporting: false,
      settling: false,
    },
    { run },
  )
  await act(async () => {
    await inspected
  })
  return view
}

/** Time passes: a debounced change is drawn. */
const wait = (ms: number): void =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })

const CELLS = [
  {
    name: 'Reset every line',
    cell: 'lines' as const,
    putBack: PUT_BACK_COLOURS,
    before: { colors: { A: '#111111' } } as Partial<ProjectRecord>,
    after: { colors: {} } as Partial<ProjectRecord>,
    own: { recoloured: true },
    delay: 0,
  },
  {
    name: 'Reset to the engine’s sizes',
    cell: 'style' as const,
    putBack: PUT_BACK_SIZES,
    before: { style: { lineWidth: 12 } } as Partial<ProjectRecord>,
    after: { style: {} } as Partial<ProjectRecord>,
    own: { restyled: true },
    delay: REDRAW_DELAY,
  },
]

describe.each(CELLS)('$name', ({ name, cell, putBack, before, after, own, delay }) => {
  it('hands focus on to the reset when the reset’s redraw later fails', async () => {
    // Put back goes with the stop - nothing was reset - and focus with it
    // to the reset, pressable again as the control goes back to the record.
    // Mutation (`put-back-focus.mutations.json`): the hand-back keyed on
    // nothing that moves - focus is left on the body.
    await openCell(cell, { ...before, drawn: drawnFrom({ ...BASE, ...before }) })
    pressFocused(name)
    wait(delay)
    expect(focused()).toBe(putBack)
    act(() => run.move(snap('failed', own, 'The redraw failed.')))
    expect(focused(), 'on the reset, which can be pressed again').toBe(name)
  })

  it('hands focus back to Put back when Put back’s redraw later fails, offered again', async () => {
    const view = await openCell(cell, { ...before, drawn: drawnFrom({ ...BASE, ...before }) })
    pressFocused(name)
    wait(delay)
    act(() => run.move(snap('done', own)))
    const reset = { ...BASE, ...before, ...after }
    view.rerender({ project: { ...reset, drawn: drawnFrom(reset), readOnly: false } })
    pressFocused(putBack)
    wait(delay)
    expect(focused()).toBe(name)
    act(() => run.move(snap('failed', own, 'The redraw failed.')))
    expect(focused(), 'Put back is offered again, and the reset has nothing to reset').toBe(putBack)
  })

  it('hands focus to Put back, and Put back hands it back to the reset', async () => {
    await openCell(cell, { ...before, drawn: drawnFrom({ ...BASE, ...before }) })
    pressFocused(name)
    expect(focused(), 'on the control that came').toBe(putBack)
    pressFocused(putBack)
    expect(focused(), 'back on the reset, pressable again').toBe(name)
  })

  it('hands focus to the cell’s heading when there is nothing to put back', async () => {
    await openCell(cell, before)
    pressFocused(name)
    expect(focused()).toBe('h2')
  })
})

describe('Reset to LOOM’s defaults', () => {
  const LAYOUT = 'a'.repeat(64)
  /** The section drawn for a record, open; what it returns draws it again for another tuning. */
  const section = (
    laidOutWith: ProjectTuning | undefined,
    onChange: (tuning: ProjectTuning) => Promise<void> = async () => {},
  ): ((tuning: ProjectTuning | undefined) => void) => {
    const drawn = (tuning: ProjectTuning | undefined): JSX.Element => (
      <LayoutTuning
        project={
          {
            ...BASE,
            layout: LAYOUT,
            ...(tuning === undefined ? {} : { tuning }),
            ...(laidOutWith === undefined ? {} : { laidOutWith }),
          } as ProjectRecord
        }
        onChange={onChange}
      />
    )
    const panel = renderPanel(drawn({ grid: 'hexalinear', deg90: 4 }))
    act(() => byName('button', 'Layout tuning tuned').click())
    return (tuning) => panel.rerender(drawn(tuning))
  }
  const offered = (name: string): boolean => {
    try {
      byName('button', name)
      return true
    } catch {
      return false
    }
  }
  const line = (): string | null =>
    document.querySelector('.layout-tuning p.message[role="status"]')?.textContent ?? null

  it('hands focus to Put back for a layout made with a tuning, and Put back hands it back', async () => {
    section({ grid: 'hexalinear' })
    pressFocused(RESET_LABEL)
    expect(focused()).toBe(PUT_BACK_TUNING)
    pressFocused(PUT_BACK_TUNING)
    await answered()
    expect(focused()).toBe(RESET_LABEL)
  })

  it('hands focus to the section’s heading for a layout made with LOOM’s defaults', () => {
    section(undefined)
    pressFocused(RESET_LABEL)
    expect(focused()).toBe('h3')
  })

  it('hands focus back to Put back when its write is refused later, offered again', async () => {
    // The store answers Put back's write with a refusal after focus has
    // gone to Reset: the fields go back to the record, Reset has nothing to
    // clear, and Put back is there again.
    let calls = 0
    const record = section({ grid: 'hexalinear' }, () => {
      calls += 1
      return calls === 2 ? Promise.reject(new Error('read-only')) : Promise.resolve()
    })
    pressFocused(RESET_LABEL)
    await answered()
    // Reset's write landed: the record holds no tuning.
    record(undefined)
    pressFocused(PUT_BACK_TUNING)
    expect(focused()).toBe(RESET_LABEL)
    await answered()
    expect(focused()).toBe(PUT_BACK_TUNING)
  })

  it('says nothing of a reset made on another project', async () => {
    // The section handed another project, whose tuning is LOOM's own over a
    // tuned layout too. Mutation (`put-back-focus.mutations.json`): the line
    // said for whichever project the section holds - a reset said of a
    // project nobody reset.
    const drawn = (id: string, tuning?: ProjectTuning): JSX.Element => (
      <LayoutTuning
        project={
          {
            ...BASE,
            id,
            layout: LAYOUT,
            laidOutWith: { grid: 'hexalinear' },
            ...(tuning === undefined ? {} : { tuning }),
          } as ProjectRecord
        }
        onChange={async () => {}}
      />
    )
    const panel = renderPanel(drawn('kq7x2mzp4dna', { grid: 'hexalinear', deg90: 4 }))
    act(() => byName('button', 'Layout tuning tuned').click())
    pressFocused(RESET_LABEL)
    await answered()
    expect(line()).toBe(TUNING_RESET_SAID)
    panel.rerender(drawn('kq7x2mzp4dnb'))
    expect(offered(PUT_BACK_TUNING), 'the other project has a tuning to put back').toBe(true)
    expect(line(), 'and no reset to speak of').toBe('')
  })

  it('says its line from Reset’s press, and any other write takes it away', async () => {
    // Mutation (`put-back-focus.mutations.json`): the line said whenever
    // Put back is offered - it fills on a section opened after a reset, or
    // when one field moves away from the layout's tuning.
    section({ grid: 'hexalinear' })
    expect(line(), 'empty as the section opens, though Put back is offered').toBe('')
    pressFocused(RESET_LABEL)
    expect(line()).toBe(TUNING_RESET_SAID)
    pressFocused(PUT_BACK_TUNING)
    await answered()
    expect(line(), 'Put back is a write of its own').toBe('')
  })
})
