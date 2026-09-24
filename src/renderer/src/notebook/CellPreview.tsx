import { useState, type JSX } from 'react'
import { CELL_LIST, type CellId, type CellState } from '../runGraph'
import Cell from './Cell'

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
  data: 'LA Metro Rail, rail and subway, one operator, 110 stops',
  process: 'Laid out d1deeb11, made 13 September',
  frame: 'Tuesday 17 March, the engine’s choice',
  style: 'Warm dark',
  lines: 'Six lines, three with a colour of their own',
  export: null,
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
                footer={cell.id === 'process' ? <span>Engine 0.8.3, LOOM 6c38a2f</span> : undefined}
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
