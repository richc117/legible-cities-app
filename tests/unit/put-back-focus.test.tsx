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
// Mutation, watched failing (`put-back-focus.mutations.json`): the colours'
// reset handing focus to the heading whatever comes.

import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunState } from '../../src/shared/layout'
import type { DrawnFrom, ProjectRecord, ProjectTuning } from '../../src/shared/project/types'
import type { ExportRun } from '../../src/renderer/src/engine/exportRun'
import LayoutTuning from '../../src/renderer/src/LayoutTuning'
import {
  PUT_BACK_COLOURS,
  PUT_BACK_SIZES,
  PUT_BACK_TUNING,
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
} from '../support/render'
import { StandInRun } from '../support/stand-in-run'

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

async function openCell(cell: 'lines' | 'style', project: Partial<ProjectRecord>): Promise<void> {
  renderCell(
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
}

const CELLS = [
  {
    name: 'Reset every line',
    cell: 'lines' as const,
    putBack: PUT_BACK_COLOURS,
    before: { colors: { A: '#111111' } },
  },
  {
    name: 'Reset to the engine’s sizes',
    cell: 'style' as const,
    putBack: PUT_BACK_SIZES,
    before: { style: { lineWidth: 12 } },
  },
]

describe.each(CELLS)('$name', ({ name, cell, putBack, before }) => {
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
  const section = (laidOutWith: ProjectTuning | undefined): void => {
    renderPanel(
      <LayoutTuning
        project={
          {
            ...BASE,
            layout: LAYOUT,
            tuning: { grid: 'hexalinear', deg90: 4 },
            ...(laidOutWith === undefined ? {} : { laidOutWith }),
          } as ProjectRecord
        }
        onChange={async () => {}}
      />,
    )
    act(() => byName('button', 'Layout tuning tuned').click())
  }

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
})
