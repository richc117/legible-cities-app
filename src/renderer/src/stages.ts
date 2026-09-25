import type { LayoutStage } from '../../shared/layout'
import type { Stage } from './ProgressLine'

// What a person reads for each stage the engine reports (A5.5-10).
//
// The wireframes name eight steps - parse, filter, graph, collapse,
// octilinear, order, labels, trips - and the engine reports eight of its
// own - gtfs2graph, topo, loom, octi, schedule, render, animate, write.
// They are a different decomposition of the same work, and which words a
// screen uses is the app's to choose, so the whole of that choice is this
// one table and nothing else in the app renames a stage.
//
// Three rules made the table what it is.
//
// **One word per engine stage, never more.** The engine reports a stage
// when it has finished it, and it reports gtfs2graph once: parsing,
// filtering and graphing are inside that one report. Drawing them as three
// stations, each ticking at the same instant, would be the app claiming to
// have watched something the engine never told it about (constitution II).
// So the wireframes' first three words are one station, named for the
// first thing it does, and the engine gains a report before the screen
// gains a station.
//
// **The words follow the work, not the wireframes' order.** The engine
// orders the lines (loom) before it makes them octilinear (octi), where
// the wireframes list octilinear first; the stations are in the order the
// stages run, because a progress line that ran backwards through its own
// labels would be worse than either vocabulary.
//
// **Where the wireframes name nothing, the engine's own word stands.**
// Nothing in them covers `animate` or `write`, and inventing a word for a
// stage nobody has named would be the app describing work it does not do.
// Both are plain English as they are.
//
// The mapping is deliberately not in `src/shared/layout.ts`: those are the
// engine's names in the engine's order, asserted against the real engine by
// a gated test (`tests/unit/layout-real.test.ts`), and that test is what
// catches a pipeline that has changed shape. A word on a screen must not be
// able to move it.
//
// It is also not applied in `engine/layoutRun.ts`, where the stages are
// made: a run's snapshot is what the jobs inspector reports and what a
// copied log is read beside, and there the engine's own names are what
// matches the engine's own lines.

/**
 * The engine's stage names, in the words cell 02 draws.
 *
 * A `Record` keyed by `LayoutStage`, so a stage added to the pipeline is a
 * build error here rather than a station that quietly loses its name; the
 * unit test asserts the same thing again at run time, since the type alone
 * would not catch a table built dynamically.
 */
export const STAGE_WORDS: Record<LayoutStage, string> = {
  // Reads the feed, keeps the chosen mode and operator, and makes the first
  // graph: the wireframes' parse, filter and graph in one engine report.
  gtfs2graph: 'parse',
  // Collapses the graph to its topology.
  topo: 'collapse',
  // Orders the lines along each edge, which is what LOOM is for.
  loom: 'order',
  // Pulls the geometry onto eight directions.
  octi: 'octilinear',
  // Reads the timetable into the trips the map will run.
  schedule: 'trips',
  // Draws the map, and places the labels it has room for.
  render: 'labels',
  // The engine's own word: the wireframes name no step for it.
  animate: 'animate',
  // The engine's own word again; its sentence is "Wrote the map and its page."
  write: 'write',
}

/**
 * The word for one stage, or the engine's own name for a stage this table
 * does not know.
 *
 * A stage that is not in the table is drawn under the name the engine sent,
 * rather than under nothing: a pipeline that grows a stage between a
 * release of the engine and one of the app should show the stage it is on,
 * in whatever words it has, and the test above is what makes that a
 * temporary state rather than a permanent one.
 */
export function stageWord(id: string): string {
  return Object.prototype.hasOwnProperty.call(STAGE_WORDS, id) ? STAGE_WORDS[id as LayoutStage] : id
}

/**
 * A run's stages with their labels in the words a person reads. The ids,
 * the states and the engine's own sentences are untouched: only the label
 * changes, and only on the way to the screen.
 */
export function inWords(stages: Stage[]): Stage[] {
  return stages.map((stage) => ({ ...stage, label: stageWord(stage.id) }))
}
