// The project record's shape (spec 037, User Story 5): its types, the lists
// its types are made from, and the engine's tables and own values for each
// field. Pure: no Electron, no filesystem, and no value imported from another
// module of the record, so the preload, the renderer and the main process
// share one definition and the unit tests run in Node. What validates the
// shape is `./validate` (both processes) and `src/main/record/validate.ts`
// (main only); what reads a stored record is `src/main/record/parse.ts`.
// Contract: specs/003-project/contracts/record.md.

import type { ExportChoice } from '../export'
import type { LineOptions } from '../protocol'
import type { Station } from '../trip'

/**
 * What a person chose for the map's sizes, in SVG user units at the map's
 * width (1,800 by default, so a line width of 7 is seven of 1,800), except
 * `lineGap`, a multiple of the line width. Every field is optional and the
 * absence of one is the engine's own number: the app sends only what a
 * person set (ADR-049). The names are the engine's `Style` in camel case.
 */
export interface ProjectStyle {
  lineWidth?: number
  lineGap?: number
  stationRadius?: number
  interchangeRadius?: number
  stationStroke?: number
  labelSize?: number
  labelOffset?: number
  /** The margin round the drawing, on every side (ADR-050). */
  padding?: number
  /**
   * The marker of a station on one line (engine issue 74, issue 391): the
   * engine's circle, TfL's tick or a square. Absent is the circle.
   */
  stationShape?: StationShape
  /** The marker of a station where lines meet: the ring or a square. Absent is the ring. */
  interchangeShape?: InterchangeShape
  /**
   * The face the station names are set in (engine issue 76): the system's,
   * or one of the two the engine ships and embeds. Absent is the system's.
   */
  labelFont?: LabelFont
  /**
   * The radius of a train's dot on the animation page, in the sizes' unit
   * (engine issue 75). Kept with the style, the smallest change, and sent as
   * `map.build`'s own `dot_radius`, never inside `style`: it is the
   * animation's and never reaches the SVG (spec 034, FR-004).
   */
  dotRadius?: number
  /** How far behind a train its trail reaches, in seconds of playback; sent as `map.build`'s own `trail`. */
  trail?: number
}

/** The eight, in the order the cell draws them. */
export const STYLE_KEYS = [
  'lineWidth',
  'lineGap',
  'stationRadius',
  'interchangeRadius',
  'stationStroke',
  'labelSize',
  'labelOffset',
  'padding',
] as const satisfies readonly (keyof ProjectStyle)[]

export type StyleKey = (typeof STYLE_KEYS)[number]

/**
 * What the engine accepts of each field: its name on the wire and its closed
 * range, held to the engine's `render.STYLE_RANGES` (v0.12.0) by a unit test
 * against the protocol's schema. `ratio` marks the one field with no unit, a
 * multiple of the line width.
 */
export const STYLE_RANGES: Readonly<
  Record<StyleKey, { wire: string; low: number; high: number; ratio: boolean }>
> = {
  lineWidth: { wire: 'line_width', low: 1, high: 24, ratio: false },
  lineGap: { wire: 'line_gap', low: 1, high: 3, ratio: true },
  stationRadius: { wire: 'station_radius', low: 1, high: 20, ratio: false },
  interchangeRadius: { wire: 'interchange_radius', low: 1, high: 30, ratio: false },
  stationStroke: { wire: 'station_stroke', low: 0, high: 8, ratio: false },
  labelSize: { wire: 'label_size', low: 6, high: 32, ratio: false },
  labelOffset: { wire: 'label_offset', low: 0, high: 40, ratio: false },
  padding: { wire: 'padding', low: 0, high: 200, ratio: false },
}

/**
 * The markers and the faces the engine offers (`render.STATION_SHAPES`,
 * `INTERCHANGE_SHAPES` and `LABEL_FONTS` at v0.15.0), in the engine's order
 * and its names. An interchange is never a tick. Held to the protocol's
 * enums by a unit test.
 */
// Exported for tests/unit/style-record.test.ts alone, which holds the three to the schema.
export const STATION_SHAPES = ['circle', 'tick', 'square'] as const
type StationShape = (typeof STATION_SHAPES)[number]
export const INTERCHANGE_SHAPES = ['circle', 'square'] as const
type InterchangeShape = (typeof INTERCHANGE_SHAPES)[number]
export const LABEL_FONTS = ['system', 'inter', 'atkinson-hyperlegible-next'] as const
type LabelFont = (typeof LABEL_FONTS)[number]

/** The three fields a person chooses from a list, in the order the cell draws them. */
export const CHOICE_KEYS = [
  'stationShape',
  'interchangeShape',
  'labelFont',
] as const satisfies readonly (keyof ProjectStyle)[]

export type ChoiceKey = (typeof CHOICE_KEYS)[number]

/** What each choice is called on the wire, inside `style`, and what it may be. */
export const STYLE_CHOICES: Readonly<
  Record<ChoiceKey, { wire: string; options: readonly string[] }>
> = {
  stationShape: { wire: 'station_shape', options: STATION_SHAPES },
  interchangeShape: { wire: 'interchange_shape', options: INTERCHANGE_SHAPES },
  labelFont: { wire: 'label_font', options: LABEL_FONTS },
}

/** The two numbers that say how a train is drawn, in the order the cell draws them. */
export const TRAIN_KEYS = ['dotRadius', 'trail'] as const satisfies readonly (keyof ProjectStyle)[]

export type TrainKey = (typeof TRAIN_KEYS)[number]

/**
 * What the engine accepts of the two train numbers (`animate.DOT_RADIUS_RANGE`
 * and `TRAIL_RANGE` at v0.15.0, `serve._animation_number`): each a parameter
 * of `map.build` itself, by the name its refusal writes, its closed range,
 * and the unit the refusal says it in. Held to the schema by a unit test.
 */
export const TRAIN_RANGES: Readonly<
  Record<TrainKey, { wire: string; low: number; high: number; unit: string }>
> = {
  dotRadius: { wire: 'dot_radius', low: 2, high: 12, unit: "SVG user units at the map's width" },
  trail: { wire: 'trail', low: 0, high: 3, unit: 'seconds of playback' },
}

/** Every field a person types a number into: the eight sizes, then the trains. */
export const FIGURE_KEYS = [...STYLE_KEYS, ...TRAIN_KEYS] as const

export type FigureKey = StyleKey | TrainKey

/**
 * Every field of the group, in the order the cell draws them (spec 034,
 * FR-005): the eight sizes, the two markers and the face, the trains. One
 * list drives the validator, the reader and what is kept.
 */
export const STYLE_GROUP = [
  ...STYLE_KEYS,
  ...CHOICE_KEYS,
  ...TRAIN_KEYS,
] as const satisfies readonly (keyof ProjectStyle)[]

export type StyleGroupKey = (typeof STYLE_GROUP)[number]

export const isTrainKey = (key: FigureKey): key is TrainKey =>
  (TRAIN_KEYS as readonly string[]).includes(key)

/**
 * The two themes the engine's page draws itself in: warm-dark, which is
 * what it draws without being told, and sepia, the cream of the pocket map.
 * They are the page's own names and travel to it on its address (A4-03).
 */
export type Theme = 'warm-dark' | 'sepia'

/**
 * The two, and nothing else; a record that names another is drawn
 * warm-dark. One list, which the switch offers and the validator checks, so
 * a third theme cannot be half-added.
 */
export const THEMES = ['warm-dark', 'sepia'] as const satisfies readonly Theme[]

/**
 * What the engine answered when the project was laid out: the days its
 * feed's calendar covers, the busiest weekday scanning from the anchor,
 * and the anchor, so the choice can be reproduced (ADR-031, engine E21).
 * Four calendar days, YYYY-MM-DD.
 */
export interface ServiceWindow {
  start: string
  end: string
  busiest: string
  anchor: string
}

/**
 * What the page on screen was drawn from (ADR-045, A5.5-04): the layout and
 * when the engine made it, the day, the colours, the default colour, the
 * order, the style and the line options the draw that produced the map now
 * in the project's output folder sent `map.build` (its `SentSet`, spec 037),
 * and the theme the page was last told.
 *
 * It is set from what the run sent, never from the record at the write, and
 * that is what makes staleness a comparison of the record against it, with
 * no events and no dirty flags: a field of the record that differs from it
 * is a field the map on screen does not show, a choice made while the run
 * went included.
 *
 * It carries `made` and not only `layout` because two projects can draw
 * from one layout set and either can re-lay it out under the other, the
 * case A3-06 added `made` for: without it a re-laid set would read current
 * over a page drawn from the geometry it replaced.
 */
export interface DrawnFrom {
  layout: string
  made: string | null
  date: string | null
  colors: Record<string, string>
  defaultColor: string
  lineOrder: string[]
  theme: Theme
  /**
   * The sizes the map carries: what `map.build` was sent, in the app's names
   * (`styleSent`), so empty for a map drawn without a style. Like the
   * colours and the order it is a cheap edit's and raises no staleness; a
   * block from before the field existed holds none, which is what it was
   * drawn with (issue 350).
   */
  style: ProjectStyle
  /**
   * The options its lines were drawn with (issue 394, spec 036): what
   * `map.build` was sent as `lines`, as `linesSent` makes it - a name, a
   * hidden line, a width, a casing and a dash by line label, each only where
   * it is not the engine's own. Absent for a map drawn with none, which is
   * every map drawn before the field existed, so a block from before it
   * reads as what it was drawn with. Like the colours it is a cheap edit's
   * and raises no staleness.
   */
  lines?: ProjectLines
  /**
   * The stations the map draws, as `map.build` listed them for it - each an
   * id the page's `setTrip` takes and the name the map writes - in the
   * engine's order (issue 272, spec 030 FR-004). Cell 03's Trip section
   * offers these and nothing the app derives, and it has to outlive the
   * build: a project opened again shows its map from the stored files
   * without one.
   *
   * It is the map's own fact, like the colours and the order: every draw -
   * a layout run, a rebuild, a recolour, a reorder, a resize - writes the
   * list its build answered, since a redraw draws the stored set as it is
   * now and another project may have laid it out again (A3-06); a draw whose
   * build answered none the app would take keeps the list it had while the
   * layout is the one it was listed for (`drawnFromSent`). Absent for a record
   * drawn before it was kept, for a block
   * whose list does not read whole, and for a map drawn from another layout
   * than the list was - which reads as "draw the map again to pick a trip",
   * never as a map with no stations. Added without moving `RECORD_VERSION`
   * (specs/028-the-notebook/contracts/run-graph.md, "Adding a field"). A
   * trip is never written here or anywhere in the record (FR-001).
   */
  stations?: Station[]
  /**
   * The version of the engine that drew the map, as its handshake answered
   * it (`engine.info`'s `engine`, which the supervisor holds equal to the
   * pin's), written by main at every draw and never sent by the renderer
   * (issue 494). It is how a page an older engine drew is told by version:
   * one drawn below the running engine's is redrawn as its project opens,
   * even where its seam has every method the pinned page has, since the
   * engine can change what it draws without adding one (engine issue 76's
   * embedded label face).
   *
   * Absent for a map drawn before it was kept, and for a value that is not
   * the engine's version as `isEngineVersion` reads it, which is dropped and
   * leaves the rest of the block as it was. A page whose `drawn` names no
   * engine counts as older (decided by the maintainer, 25 Oct 2026), so it is
   * redrawn once as its project opens and named then (`redrawOnOpen`).
   * Like the theme it describes the draw and raises no staleness. Added
   * without moving `RECORD_VERSION`
   * (specs/028-the-notebook/contracts/run-graph.md, "Adding a field"),
   * inside `drawn` because it is a fact of the draw and is renewed with it.
   */
  engine?: string
}

export interface ProjectRecord {
  version: number
  id: string
  name: string
  feed: string
  mode: string
  agency: string | null
  /** The service day, YYYY-MM-DD; null until the first layout resolves it (ADR-031). */
  date: string | null
  /** The feed's window and the engine's choice, stored at a layout run; null before one. */
  service: ServiceWindow | null
  style: ProjectStyle
  colors: Record<string, string>
  defaultColor: string
  lineOrder: string[]
  /**
   * What a person chose for each line beyond its colour and its place
   * (issue 394, spec 036): a name, whether it is drawn, its width, a casing
   * and a dash, by line label, in the engine's own names, so an entry is
   * exactly what `map.build` takes for the line. Each field is kept only
   * where it is not the engine's own and an entry with none is removed
   * (`linesSent`), so a project that never touched them has no `lines` at
   * all. Written once the map carries them (`projects.completeLines`), as
   * the colours are.
   *
   * Added at `RECORD_VERSION` 2 without moving it
   * (specs/028-the-notebook/contracts/run-graph.md, "Adding a field"): its
   * absence is every line drawn as the engine draws it, which is what every
   * map before it was, and the one released build holds records at version 1
   * and reads this one as read-only, so it never writes one and cannot drop
   * a name a person typed.
   */
  lines?: ProjectLines
  theme: Theme
  /**
   * What the project was last set to export: the preset, the storyboard and
   * the options (A5-01), and since issue 392 the opening a video plays first
   * (`opening`, `cardSecs`, `drawInSecs`, each optional, absent meaning none
   * and the defaults; added without moving `RECORD_VERSION`, spec 035). The
   * reel with the engine's defaults for a record from before the export tab,
   * which is what the one button exported.
   */
  export: ExportChoice
  /**
   * Where this project's exports go, over the app's own export folder
   * (A5.5-19); null to use the app's, which is what every project did
   * before and what a project that has never been told otherwise still
   * does. The folder is the platform's dialog's own answer: no path
   * crosses the bridge inward, so the only two values that reach a record
   * are one this process's own chooser handed out and null.
   *
   * Added at `RECORD_VERSION` 1 and it does not move it: a record without
   * it reads as "the app's folder", which is what an older record meant,
   * and an older build that drops it sends the next export to the app's
   * folder rather than misreading anything
   * (specs/028-the-notebook/contracts/run-graph.md).
   */
  destination: string | null
  /**
   * LOOM's own settings a person chose for this project's layout (issue 385,
   * spec 033): the grid, the merge distance, the grid size and the bend
   * penalties. Absent means LOOM's defaults, and a field at LOOM's own
   * number is never kept (`settledTuning`), so a project that never touched
   * the tuning has no `tuning` at all and a reset removes it. Written the
   * moment it is chosen (`projects.setTuning`) and sent to `graph.build` by
   * the next layout run; nothing is laid out for it on its own.
   *
   * Added at `RECORD_VERSION` 2 without moving it
   * (specs/028-the-notebook/contracts/run-graph.md, "Adding a field"): its
   * absence is what every project before it was laid out with, and the one
   * released build holds records at version 1 and reads this one as
   * read-only, so it never writes one and cannot drop it.
   */
  tuning?: ProjectTuning
  /** The stored layout's identifier; null until the first layout produces one (ADR-027). */
  layout: string | null
  /**
   * The mode and agency the stored layout was made with, from the engine's
   * meta, so the screen can say when the record's differ (A2-02). Null
   * before a layout, and for a record from before this was kept.
   */
  built: ProjectInputs | null
  /**
   * The tuning the stored layout was asked with (issue 385, spec 033 FR-008):
   * what the layout run that wrote `layout` sent `graph.build`, in `tuning`'s
   * shape and under its rules, written by `completeLayout` in the same write
   * as the layout's id and by nothing else. Absent means LOOM's defaults,
   * which is what every layout before the field was asked with, so an
   * existing project reads current.
   *
   * It is `built`'s counterpart for the tuning: `built` is what the engine's
   * meta says the layout was made with, and this is what the app asked it
   * with, because reading the tuning back from `LayoutMeta.stages` would mean
   * computing LOOM's flags here. A record whose `tuning` would not send what
   * this does has a layout of another tuning: the run graph's `tuning`
   * source. Added without moving `RECORD_VERSION`, as `tuning` was.
   */
  laidOutWith?: ProjectTuning
  /**
   * When the stored layout was made, as the engine wrote it beside the set
   * (an ISO timestamp): the same id names the same inputs, and a different
   * `made` under it is a set laid out again since (A3-06). Null before.
   */
  made: string | null
  /**
   * What the map now on disk was drawn from (A5.5-04), written by the six
   * handlers that write the record at the end of a draw, from what the
   * draw sent (`drawnFromSent`, spec 037); null for a record
   * from before this was kept, which means only that we cannot prove its
   * map is current - never that it is stale.
   */
  drawn: DrawnFrom | null
  /**
   * When the project's screen was last opened (A5.6-04), an ISO timestamp,
   * written by `projects.markOpened` as the screen opens and by nothing
   * else - an edit moves `modified`, never this. The front door lists
   * projects newest opened first.
   *
   * Added at `RECORD_VERSION` 1 without moving it
   * (specs/028-the-notebook/contracts/run-graph.md): null means "not
   * opened since this was kept", which sorts by `created` instead, and an
   * older build that drops it loses only an order the next opening puts
   * back.
   */
  opened: string | null
  created: string
  modified: string
  /**
   * How many times the store has written this record (spec 037, FR-001): a
   * whole number the store raises by one on every write, never the
   * renderer, so two answers about one project can be told apart by which
   * is the later. Absent reads as 0, which is every record written before it
   * was kept, and the first write makes it 1. Added without moving
   * `RECORD_VERSION` (ADR-056's additive rule): an older build that does not
   * know it carries it back as written, and this build raises it from there.
   */
  revision?: number
}

/**
 * What the front door lists for each project: the row's own words, and the
 * record's fields the run graph reads to say how far the project has got
 * (A5.6-04), so the renderer derives it with the notebook's own function
 * rather than with a second rule in the main process.
 */
export interface ProjectSummary extends Pick<
  ProjectRecord,
  | 'id'
  | 'name'
  | 'feed'
  | 'date'
  | 'mode'
  | 'agency'
  | 'layout'
  | 'made'
  | 'built'
  | 'drawn'
  | 'opened'
  | 'created'
  | 'modified'
  | 'tuning'
  | 'laidOutWith'
> {
  readOnly: boolean
}

export interface CreateProjectInput {
  name: string
  feed: string
  mode?: string
  agency?: string | null
}

/**
 * What a rebuild for a chosen day hands back once the map is drawn: what
 * its `map.build` was sent (spec 037), whose day is the day written.
 */
export interface RebuildDone {
  sent: SentSet
  /**
   * The stations `map.build` answered for the map just drawn (issue 272),
   * written into `drawn`; left out, the list the record had is kept when
   * the layout is the one it was listed for.
   */
  stations?: Station[]
}

/** The two inputs a person chooses with the feed in view (A2-02): what LOOM keeps, and whose routes. */
export interface ProjectInputs {
  mode: string
  agency: string | null
}

/**
 * What a project chooses for its lines (A4-01): the overrides a person set,
 * by line label, and what a line the feed leaves uncoloured is drawn in.
 * Exactly the record's two fields, and exactly what `map.build` takes as
 * `colors` and `default_color`. The engine resolves an override over the
 * feed's own `route_color` over the default, once, so the map, the chips
 * and the time chart agree (engine E06).
 */
export interface Palette {
  colors: Record<string, string>
  defaultColor: string
}

/**
 * Line labels in the order they are drawn, the later over the earlier where
 * they share track, and the same order the page lists them in. Exactly the
 * record's `lineOrder` and exactly `map.build`'s `line_order`.
 *
 * Empty is the engine's own order, alphabetical by label; the request then
 * carries no `line_order` at all. A partial order is safe: the engine draws
 * the lines it names first and every other line after them, and ignores a
 * label the layout does not carry (engine issue 28).
 */
export type LineOrder = string[]

export interface DeleteResult {
  removed: string[]
  failed: { folder: 'project' | 'output'; reason: string }[]
}

/**
 * The engine's `Style` numbers at the pinned engine (v0.12.0, `render.py`),
 * and since v0.15.0 its markers, face and train numbers, as data. They are what a field shows while it is unset and what a value is
 * compared with to know it is no choice at all; they are never sent. Until
 * issue 350 this held `10, 8, 11, 26` under a comment calling them the
 * engine's, and they were not (ADR-049); `OLD_STYLE` keeps them for the one
 * place that still needs to recognise them.
 */
export const DEFAULT_STYLE: Readonly<Required<ProjectStyle>> = {
  lineWidth: 7,
  lineGap: 1.6,
  stationRadius: 4.2,
  interchangeRadius: 6,
  stationStroke: 2.2,
  labelSize: 11,
  labelOffset: 9,
  padding: 24,
  // The engine's own markers, face and trains (v0.15.0): what is drawn
  // without the field, so a field at one of these is no choice (spec 034).
  stationShape: 'circle',
  interchangeShape: 'circle',
  labelFont: 'system',
  dotRadius: 5,
  trail: 0,
}

export const DEFAULT_COLOR = '#888888'
export const DEFAULT_THEME: Theme = 'warm-dark'
export const DEFAULT_MODE = 'all'

// ---- The layout's tuning (issue 385, spec 033; engine issue 37, v0.14.0)

/**
 * The grids octi lays a network on, in the engine's words and order
 * (`pipeline.GRIDS` at v0.14.0): octilinear, the 45-degree multiples the map
 * has always been drawn on and LOOM's own, then ortholinear, orthoradial and
 * hexalinear. The engine refuses its research variants itself, so these four
 * are all the app offers (spec 033, FR-002). Held to the protocol's enum by
 * a unit test.
 */
export const GRIDS = ['octilinear', 'ortholinear', 'orthoradial', 'hexalinear'] as const

export type Grid = (typeof GRIDS)[number]

/**
 * LOOM's own settings a person chose for a project's layout, in the engine's
 * names in camel case (`LayoutTuning`), the five bend penalties flat beside
 * the others rather than inside a `penalties` object, so that one list drives
 * the fields, the validator and the reader. Every field is optional and the
 * absence of one is LOOM's own number: the app sends only what a person set,
 * and the engine writes no flag for a field at LOOM's default either.
 */
export interface ProjectTuning {
  /** topo's `-d`: how far apart two stretches of track may be, in metres, and still be merged. */
  mergeDistance?: number
  /** octi's `-b`: the grid the network is laid on. */
  grid?: Grid
  /** octi's `-g`: the grid's cell, as a percentage of the distance between adjacent stations. */
  gridSize?: number
  /** octi's `--pen-45`, `--pen-90`, `--pen-135`, `--pen-180`: the cost of a bend of that angle. */
  deg45?: number
  deg90?: number
  deg135?: number
  deg180?: number
  /** octi's `--diag-pen`: the cost of running on a diagonal. */
  diagonal?: number
}

/** The seven numbers, in the order the section draws them. */
export const TUNING_KEYS = [
  'mergeDistance',
  'gridSize',
  'deg45',
  'deg90',
  'deg135',
  'deg180',
  'diagonal',
] as const satisfies readonly (keyof ProjectTuning)[]

export type TuningKey = (typeof TUNING_KEYS)[number]

/** The five of them that travel inside the engine's `penalties` object. */
export const PENALTY_KEYS = [
  'deg45',
  'deg90',
  'deg135',
  'deg180',
  'diagonal',
] as const satisfies readonly TuningKey[]

/** What a penalty counts, in the engine's words for its refusal. */
const COST = 'as a cost without a unit'

/**
 * What the engine accepts of each number (`pipeline`'s table at v0.14.0): its
 * name on the wire, as its refusal sentence writes it, its closed range, and
 * what it counts, in the engine's own words. Held to the committed protocol
 * schema by a unit test, as the style's ranges are.
 */
export const TUNING_RANGES: Readonly<
  Record<TuningKey, { wire: string; low: number; high: number; unit: string }>
> = {
  mergeDistance: { wire: 'merge_distance', low: 5, high: 500, unit: 'in metres' },
  gridSize: {
    wire: 'grid_size',
    low: 25,
    high: 400,
    unit: 'as a percentage of the distance between adjacent stations',
  },
  deg45: { wire: 'penalties.deg45', low: 0, high: 10, unit: COST },
  deg90: { wire: 'penalties.deg90', low: 0, high: 10, unit: COST },
  deg135: { wire: 'penalties.deg135', low: 0, high: 10, unit: COST },
  deg180: { wire: 'penalties.deg180', low: 0, high: 10, unit: COST },
  diagonal: { wire: 'penalties.diagonal', low: 0, high: 10, unit: COST },
}

/**
 * LOOM's own numbers and grid, as data: what a field shows while it holds
 * nothing, and what a value is compared with to know it is no choice at all.
 * Never sent - the engine writes no flag for them either - and held to the
 * schema's "LOOM's default is" by a unit test.
 */
export const DEFAULT_TUNING: Readonly<Required<ProjectTuning>> = {
  mergeDistance: 50,
  grid: 'octilinear',
  gridSize: 100,
  deg45: 2,
  deg90: 1.5,
  deg135: 1,
  deg180: 0,
  diagonal: 0.5,
}

/** Every field of a tuning, in the engine's order: the merge distance, the grid, the size, the penalties. */
export const TUNING_FIELDS = [
  'mergeDistance',
  'grid',
  'gridSize',
  ...PENALTY_KEYS,
] as const satisfies readonly (keyof ProjectTuning)[]

// ---- A line's options (issue 394, spec 036; engine issues 42 and 55, at
// v0.12.0 and v0.16.0)

/**
 * What a person chose for one line beyond its colour and its place: a name,
 * whether it is drawn, its width, a casing and a dash. It is the engine's own
 * `LineOptions`, so the record's entry and `map.build`'s are one shape and a
 * pin that moves one is a build error here. Every field is optional and the
 * absence of one is the engine's own: the line's label, drawn, a width of 1,
 * no casing, solid.
 */
export type LineChoice = LineOptions

/** The options of every line that has any, by line label. */
export type ProjectLines = Record<string, LineChoice>

/** How a line's stroke is painted, in the engine's words and order (`render.LINE_DASHES`). */
export const LINE_DASHES = ['solid', 'dashed', 'dotted'] as const satisfies readonly NonNullable<
  LineChoice['dash']
>[]

export type LineDash = (typeof LINE_DASHES)[number]

/**
 * What the engine accepts of a line's options at v0.16.0 (`serve._lines`,
 * `render.LINE_WIDTH_RANGE` and `CASING_WIDTH_RANGE`): a name of 1 to 40
 * characters, counted as Python counts them (code points), with no line
 * break of any kind; a width that is a multiple of the map's line width; a
 * casing that is a multiple of it on each side. Held to the committed
 * protocol schema by a unit test.
 */
export const LINE_NAME_MAX = 40
export const LINE_WIDTH_RANGE = { low: 0.75, high: 1.5 } as const
export const CASING_WIDTH_RANGE = { low: 0, high: 1 } as const

/**
 * The engine's own, as data: what a field shows while it holds nothing, and
 * what a value is compared with to know it is no choice at all. A casing of
 * width 0 draws none.
 */
export const DEFAULT_LINE = { width: 1, casingWidth: 0, dash: 'solid' } as const

/**
 * What a casing is drawn in until a person chooses another (spec 036,
 * FR-005): white, a literal, as the engine takes it; the page's theme does
 * not change it. Here and not in the renderer, whose component files carry
 * no colour literal.
 */
export const DEFAULT_CASING_COLOR = '#ffffff'

/** The five fields, in the engine's order, and nothing else. */
export const LINE_FIELDS = [
  'name',
  'hidden',
  'width',
  'casing',
  'dash',
] as const satisfies readonly (keyof LineChoice)[]

/**
 * What one `map.build` was built from (spec 037, FR-002): the layout and
 * when the engine made it, the day, the palette, the order, the style and
 * the line options, exactly as the run sent them. The run that built the
 * request is the one place that knows what was sent, so every completion
 * carries this and `drawn` is made from it (`drawnFromSent`), never from the
 * record at the moment of the write, which a choice made while the run went
 * has moved since.
 *
 * The style is in the app's names as `styleSent` makes it, and the line
 * options as `linesSent` makes them, absent for none: what the request
 * carried, and what `drawn` has always held for them. The theme is not here,
 * because no `map.build` carries one: the page restyles in place (issue 349).
 */
export interface SentSet {
  layout: string
  made: string | null
  date: string
  colors: Record<string, string>
  defaultColor: string
  lineOrder: string[]
  style: ProjectStyle
  lines?: ProjectLines
}
