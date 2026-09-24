import { useEffect, useState, type JSX } from 'react'
import type { Inspection } from '../../../../shared/protocol'
import type { ProjectRecord } from '../../../../shared/project'
import Inspect from '../../Inspect'
import StageView from '../../StageView'
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
// The one thing this file writes is the sentence the row carries while the
// cell is collapsed. It is here and not in a table beside the six cells
// because it is prose about this cell's own subject: a table of summaries
// would have to know what every cell is made of, and each new one would
// edit the file all six share (A5.5-09).

/** The words of a list, as prose: "rail", "rail and subway", "rail, subway and tram". */
function listOf(words: string[]): string {
  if (words.length < 2) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/**
 * What the collapsed cell says it holds: the feed, what LOOM keeps, whose
 * routes, and how many stops the engine counted in the feed.
 *
 * Null until the inspection has arrived - before it, the stop count is not
 * known and the feed has only a key, and a cell with nothing true to say
 * says nothing rather than a sentence with a hole in it (DESIGN.md 8.2).
 * A refused inspection is the same case: `Inspect` says why in the open
 * cell, and the row does not repeat a failure as a description.
 *
 * Every figure is the engine's. The stop count is the feed's own total,
 * which is what `feeds.inspect` answers: the engine counts stops per feed
 * and not per mode, and inventing a filtered count here would be the app
 * drawing a conclusion the engine did not (constitution II). It says "in
 * the feed" for that reason: the two slots before it are filters, so a
 * bare count in the fourth would be read as the count of what they keep,
 * and `stops.total` is the feed's whole stop table, entrances and boarding
 * areas included.
 */
export function dataSummary(
  project: Pick<ProjectRecord, 'feed' | 'mode' | 'agency'>,
  inspection: Inspection | null,
): string | null {
  if (inspection === null) return null
  const feed = inspection.name || project.feed
  // A record's mode is `MODE_PATTERN`: names or route_type numbers, comma
  // joined, with no spaces and no empty part, on write and on read alike.
  const modes = project.mode.split(',')
  // "all" is the engine's word for every route type, and the Mode control
  // says so in its own option; the row says it the same way.
  const mode = modes.includes('all') ? 'every type' : listOf(modes)
  const listed = inspection.agencies.find((a) => a.agency_id === project.agency)
  // The row names the operator as the Operator control names it: its name
  // when it has one, its id when the name is blank - a feed may carry an
  // empty agency_name, and `Inspect` defends against it twice - and the
  // control's own suffix when the feed no longer lists it at all, which is
  // the whole of what a person needs to know in that case.
  const operator =
    project.agency === null
      ? 'every operator'
      : listed === undefined
        ? `${project.agency} (not in this feed)`
        : listed.agency_name || listed.agency_id
  const { total } = inspection.stops
  const stops = `${total.toLocaleString()} ${total === 1 ? 'stop' : 'stops'} in the feed`
  return `${feed}, ${mode}, ${operator}, ${stops}`
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
  const { project, engine, inspect, setInputs, registry, readStage, layingOut, exporting } =
    useProject()
  const inspection = useInspection(project?.feed ?? null, engine?.state === 'ready', inspect)
  return (
    <Cell
      number={cell.number}
      name={cell.name}
      state={state}
      summary={project === null ? null : dataSummary(project, inspection)}
      open={open}
      onToggle={onToggle}
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
          {!project.readOnly && (
            <Inspect
              project={project}
              engine={engine}
              inspect={inspect}
              onInputs={setInputs}
              registry={registry}
              disabled={layingOut || exporting}
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
