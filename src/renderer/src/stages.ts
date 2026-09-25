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
// **A stage is named for the first thing it does.** Nothing in the
// wireframes covers `animate` or `write`, and both are plain English as the
// engine has them, so they stand. `render` is the one place the wireframes
// offer a word and it is not taken: the engine's own docstring for it is
// "Draw the graph", and the labels are placed in the room that is left, so
// the wireframes' "labels" names the part that happens last and may not
// happen at all (`labels_dropped` is a diagnostic for exactly that).
//
// The mapping is deliberately not in `src/shared/layout.ts`: those are the
// engine's names in the engine's order, asserted against the real engine by
// a gated test (`tests/unit/layout-real.test.ts`), and that test is what
// catches a pipeline that has changed shape. A word on a screen must not be
// able to move it.
//
// It is also not applied in `engine/layoutRun.ts`, where the stages are
// made. A run's snapshot is what a copied log and a failure's detail are
// composed from, and those are quoted at the engine: `composeJobLog` writes
// `gtfs2graph: failed`, whatever a screen calls it. The words go on at the
// screen, and every line a person reads - cell 02's and the inspector's -
// puts them on.

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
  // Draws the graph - the engine's own first sentence for it - and places
  // the labels in the room that is left. Named for the first thing it does,
  // as `gtfs2graph` is; "labels", which the wireframes offer, names the part
  // that happens last and may not happen at all.
  render: 'draw',
  // The engine's own word: the wireframes name no step for it.
  animate: 'animate',
  // The engine's own word again; its sentence is "Wrote the map and its page."
  write: 'write',
}

/**
 * The word for one stage, or the engine's own name for a stage this table
 * does not know.
 *
 * The fallback is a backstop and not a behaviour anyone can see: the stages
 * a run draws are the fresh eight, and `advance` in `engine/layoutRun.ts`
 * drops a report whose stage is not already among them, so a stage this
 * table has never heard of cannot reach a screen through the app as it
 * stands. It is here because the alternative - a lookup that answers
 * `undefined` - would put a station with no name on the line if that ever
 * changed, and because nothing should have to be true for this function to
 * be safe to call.
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
