import { useEffect, useRef, useState, type JSX } from 'react'
import type { Inspection } from '../../../../shared/protocol'
import Inspect from '../../Inspect'
import StageView from '../../StageView'
import DownloadLine from '../../DownloadLine'
import Cell from '../Cell'
import type { CellViewProps } from '../cells'
import { useProject } from '../context'

// Cell 01, Data: what the project is made of (ADR-045).
//
// The feed, the mode and the operator the layout was built with, the
// Inspect view that chooses the last two (A2-02), and the geographic view
// of the stages the engine ran (A2-03). The three fields come from the
// `<dl class="fields">` the project screen carried whole; it is split at
// placement rather than left for three branches to share.
//
// Nothing here is re-authored: `Inspect` and `StageView` are the panels
// that were on the screen before, with the props they had.
//
// Of the cell's four children only `Inspect` is told that a run or an
// export is going, and it disables the mode, the operator and the two
// buttons beside them, so it is given the cell's heading to hand focus to
// (issue 221), as cells 03 to 06 give theirs. The stored fields are text.
// `DownloadLine` comes and goes with the run and holds no control.
// `StageView` takes no `disabled`: its two stage buttons and its pane stay
// live through a run, and it never leaves the cell once a layout exists.
//
// The one thing this file writes is the sentence the row carries while the
// cell is collapsed. It is here and not in a table beside the six cells
// because it is prose about this cell's own subject: a table of summaries
// would have to know what every cell is made of, and each new one would
// edit the file all six share (A5.5-09).

/**
 * What the collapsed cell says it holds: how many stops the engine counted
 * in the feed, and nothing else. The feed, the mode and the operator are
 * in the open cell and in the footer, and a row cut with an ellipsis
 * before the fact a person came for said too much (issue 279).
 *
 * Null until the inspection has arrived - before it, the stop count is not
 * known, and a cell with nothing true to say says nothing rather than a
 * sentence with a hole in it (DESIGN.md 8.2). A refused inspection is the
 * same case: `Inspect` says why in the open cell, and the row does not
 * repeat a failure as a description.
 *
 * The figure is the engine's. It is the feed's own total, which is what
 * `feeds.inspect` answers: the engine counts stops per feed and not per
 * mode, and inventing a filtered count here would be the app drawing a
 * conclusion the engine did not (constitution II). It says "in the feed"
 * for that reason: `stops.total` is the feed's whole stop table, entrances
 * and boarding areas included, and a bare count would be read as the count
 * of what the mode and the operator keep.
 */
export function dataSummary(inspection: Inspection | null): string | null {
  if (inspection === null) return null
  const { total } = inspection.stops
  return `${total.toLocaleString()} ${total === 1 ? 'stop' : 'stops'} in the feed`
}

/**
 * The feed as the engine reads it, for the row's sentence.
 *
 * `Inspect` reads it too and asks for it at the same moment; the inspection
 * module answers both from one request per feed and day, so this costs the
 * engine nothing (`engine/inspections.ts`). Holding it here rather than
 * taking it from `Inspect` keeps the panel's props as A2-02 wrote them, and
 * keeps the cell's own sentence in the cell's own file.
 */
function useInspection(
  feed: string | null,
  ready: boolean,
  inspect: (key: string) => Promise<Inspection>,
): Inspection | null {
  const [inspection, setInspection] = useState<Inspection | null>(null)
  useEffect(() => {
    if (feed === null || !ready) return
    let left = false
    inspect(feed).then(
      (answer) => {
        if (!left) setInspection(answer)
      },
      // A refusal is `Inspect`'s to say, in the open cell and once.
      () => undefined,
    )
    return () => {
      left = true
    }
  }, [feed, ready, inspect])
  return inspection
}

export default function DataCell({ cell, state, open, onToggle }: CellViewProps): JSX.Element {
  const { project, engine, inspect, setInputs, registry, readStage, layingOut, exporting, run } =
    useProject()
  const inspection = useInspection(project?.feed ?? null, engine?.state === 'ready', inspect)
  const heading = useRef<HTMLHeadingElement>(null)
  return (
    <Cell
      number={cell.number}
      name={cell.name}
      state={state}
      summary={project === null ? null : dataSummary(inspection)}
      open={open}
      onToggle={onToggle}
      headingRef={heading}
    >
      {project !== null && (
        <>
          <dl className="fields">
            <dt>Feed</dt>
            <dd>{project.feed}</dd>
            <dt>Mode</dt>
            <dd>{project.mode}</dd>
            <dt>Agency</dt>
            <dd>{project.agency ?? 'none'}</dd>
          </dl>
          {/* The feed's download, when the layout run is fetching it
              (issue 178): here, with the feed, not in cell 02. */}
          <DownloadLine run={run} />
          {!project.readOnly && (
            <Inspect
              project={project}
              engine={engine}
              inspect={inspect}
              onInputs={setInputs}
              registry={registry}
              disabled={layingOut || exporting}
              handback={heading}
            />
          )}
          {project.layout !== null && (
            <StageView project={project} engine={engine} read={readStage} />
          )}
        </>
      )}
    </Cell>
  )
}
