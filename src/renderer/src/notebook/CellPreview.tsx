import { useState, type JSX } from 'react'
import type { EngineInfo } from '../../../shared/protocol'
import { CELL_LIST, type CellId, type CellState } from '../runGraph'
import Cell from './Cell'
import { exportFooter, frameFooter, processStrip } from './CellFooter'

// The cell's sample page, for a person or the end-to-end test to walk:
// `?cell-preview`. Nothing in the app links to it, as nothing links to the
// progress line's.
//
// It exists because the cell is built a branch before the notebook it goes
// in (A5.5-05 before A5.5-08), so there is no cell on screen to walk yet.
// A fixture is also the honest way to see all four states at once, which no
// real project shows.

const STATES: CellState[] = ['ready', 'running', 'stale', 'error']

const SUMMARY: Record<CellId, string | null> = {
  data: 'LA Metro Rail, rail and subway, Los Angeles County MTA, 110 stops in the feed',
  process: 'd1deeb11, made 13/09/2026, 14:03:00',
  frame: 'Tuesday 17 March, the engine’s choice',
  style: 'Warm dark',
  lines: '3 lines recoloured, an order you chose',
  export: null,
}

// The provenance strip, drawn by the component the cells draw it with and
// from the builders they build it with (A5.5-11), over fixture data. Not a
// hand-written imitation: this page is what `tests/e2e/notebook.spec.ts`
// walks, and an imitation of a component that exists drifts from it
// silently - which is what the `<span>` that stood here was already doing.
//
// `processFooter` itself is not used, and cannot be: it asks the project
// screen's context for the engine's state, and there is no project on this
// page. `processStrip` is the composition underneath it, which takes the
// engine's answer as an argument - so this page draws the strip cell 02
// draws, rather than a second composition of the same parts.
const SAMPLE_INFO: EngineInfo = {
  engine: '0.8.3',
  protocol: 1,
  python: '3.12.7',
  loom: { commit: '6c38a2f1d0e9b8a7c6d5e4f3a2b1c0d9e8f7a6b5', backend: 'native' },
  ffmpeg: 'ffmpeg',
  home: '/engine-home',
}

const FOOTER: Record<CellId, JSX.Element | undefined> = {
  // Cells 01, 04 and 05 have no provenance and draw no strip at all.
  data: undefined,
  process: processStrip(
    {
      layout: 'd1deeb11f0c4ab93e2f5d0a7b6c5e4d3c2b1a09876543210fedcba9876543210',
      made: '2026-09-13T14:03:00+00:00',
      built: { mode: 'rail', agency: 'LACMTA' },
    },
    SAMPLE_INFO,
  ),
  frame: frameFooter({
    date: '2026-03-17',
    service: {
      start: '2026-03-01',
      end: '2026-06-30',
      busiest: '2026-03-17',
      anchor: '2026-03-10',
    },
  }),
  style: undefined,
  lines: undefined,
  export: exportFooter({ state: 'done', file: 'los-angeles-reel.mp4' }),
}

export default function CellPreview(): JSX.Element {
  const [open, setOpen] = useState<Record<string, boolean>>({ 'data-0': true })
  return (
    <main className="panel">
      <h1>Cells</h1>
      <p>
        Every cell in every state, open and collapsed. Nothing here is a project: the sentences are
        fixtures.
      </p>
      {STATES.map((state) => (
        <section key={state}>
          <h2>{state}</h2>
          {CELL_LIST.map((cell) => {
            const key = `${cell.id}-${STATES.indexOf(state)}`
            return (
              <Cell
                key={key}
                number={cell.number}
                name={cell.name}
                state={state}
                summary={SUMMARY[cell.id]}
                open={open[key] ?? false}
                onToggle={(next) => setOpen((was) => ({ ...was, [key]: next }))}
                footer={FOOTER[cell.id]}
              >
                <p>The controls of cell {cell.number} go here.</p>
                <label>
                  A half-typed value
                  <input type="text" defaultValue="" />
                </label>
              </Cell>
            )
          })}
        </section>
      ))}
    </main>
  )
}
