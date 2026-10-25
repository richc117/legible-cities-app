import { LAYOUT_STAGES, type RunState } from '../../../shared/layout'
import {
  cameTooLate,
  isEngineErrorShape,
  ERROR_CODES,
  type EngineState,
} from '../../../shared/engine'
import {
  drawnDate,
  orderOf,
  paletteOf,
  type LineOrder,
  type Palette,
  type ProjectLines,
  type ProjectRecord,
  type ProjectStyle,
  type SentSet,
  type ServiceWindow,
  sentSet,
} from '../../../shared/project'
import {
  failureOf,
  LogBuffer,
  nextJobId,
  screenPaths,
  type Job,
  type JobKind,
} from '../../../shared/jobs'
import type { Diagnostics, MapBuildResult, Methods } from '../../../shared/protocol'
import { readStations, type Station } from '../../../shared/trip'
import { linesParams } from '../lineOptions'
import type { Stage } from '../ProgressLine'
import type { RunAllPlan } from '../runAll'
import { styleParams } from '../styleRules'
import { askedWith, tuningParams } from '../tuningRules'

// One layout run for one project, with no React in it: the rule is that
// logic lives in something callable without rendering, and the tests are
// what that buys (.claude/rules/renderer.md).
//
// The sequence is contracts/run.md's. Ask the engine for the layout, which
// answers with the layout's id and the stage graphs' paths; then which day
// to draw, from the machine's date and the lines the layout drew (ADR-031,
// specs/012); then for the map from that id, which writes the page where
// the app already serves a project's output. The two long calls report a
// stage only when it has finished, so a report marks its own stage done
// and the next one running, and the sentence on screen always describes
// the last stage to finish rather than the one being waited for. The map
// call repeats the four layout stages; a repeat for a stage already done is
// ignored. Nothing is written until every call has returned, and what is
// written is the engine's id, the engine's window and the day.
//
// A rebuild is the map call alone, from the stored layout, for a day a
// person chose: the layout stages are never run, and the day is written
// only when the map has been drawn - though since A5.5-15 it is on the
// record before the run starts, and this is what makes the map agree with
// it. A recolour is the same shape for a palette a person chose (A4-01):
// the stored layout, the palette written only once the map carries it, and
// the day the map already showed, never the record's, which may be a day
// chosen and waiting to be drawn. A restyle is the same shape for the map's
// sizes (issue 350). Every draw, whichever started it, sends the palette,
// the order, the style and the line options (issue 394) the project is
// being drawn with, so the map on screen and the record never disagree.
//
// Every run reads its record from the store at its start, after the
// controls that hold a choice back have flushed it (`beforeStart`), and
// hands its completion what its map.build was sent, which the store keeps as
// `drawn` (spec 037; docs/ARCHITECTURE.md, "The record session").
//
// A cancel stops the run between its calls, and asks the call in flight to
// stop. What that call answers decides what happened, not when the cancel
// was pressed (engine v0.18.0, its issue 80): the cancelled error means it
// wrote nothing a client sees, and a result means it finished and wrote
// what the result names - with `cancel_too_late` when the cancel reached it
// after its point of no return. So a map.build that answers a result is a
// finished draw whoever cancelled: the record is written as for any draw,
// `drawn` moves and the frame is loaded again, and the run says the cancel
// came too late. A graph.build that answers a result has stored its layout;
// the run stops there, before feeds.service, and where the cancel came too
// late says the next run draws from that layout. It does not say the layout
// is kept: beside "The project is as it was" that would read as two answers.

/** What a run says when its map was drawn before the cancel reached it. */
export const MAP_KEPT = 'The map was already drawn when you cancelled; it is kept.'

/** Why a rebuild is refused for a project that has drawn nothing to rebuild from. */
const NO_LAYOUT_FOR_A_DAY = 'Lay the project out before choosing a day.'

/** What a layout run says when its layout was stored before the cancel reached it. */
export const LAYOUT_KEPT =
  'The layout was already made when you cancelled; the next run draws from it.'

export interface RunSnapshot {
  state: RunState
  stages: Stage[]
  /** The engine's sentence for the last stage that finished. */
  message: string | null
  /** The engine's sentence for a person, when the run failed. */
  error: string | null
  /** Set when the layout's id differs from the one the project had stored. */
  changed: boolean
  /** Set when the id is the same but the set was laid out again since, by another project. */
  relaid: boolean
  /** Set when the run was a re-layout: every stage run again on purpose. */
  forced: boolean
  /**
   * Set when a re-layout stopped after the engine had already replaced the
   * stored layout but before the map was drawn from it: the project's id
   * still names the layout, the layout is new, and the page on screen is
   * the old map until the next run draws it.
   */
  replaced: boolean
  /** Set when the run is a rebuild for a chosen day: the map call alone. */
  rebuilt: boolean
  /** Set when the run is a redraw for chosen colours: the map call alone (A4-01). */
  recoloured: boolean
  /**
   * Set, with `recoloured`, when the run is a redraw for chosen line options
   * (issue 394): it refines the colours' kind of run, so everything that reads
   * `recoloured` still holds and only the words differ.
   */
  optioned: boolean
  /** Set when the run is a redraw for a chosen line order: the map call alone (A4-02). */
  reordered: boolean
  /** Set when the run is a redraw for chosen sizes: the map call alone (issue 350). */
  restyled: boolean
  /**
   * Set when a redraw failed after its map had been drawn (issue 399): the
   * engine wrote the page with what was chosen, and the record then refused
   * to keep it - a label past the store's bound, the reset's flag. The
   * project keeps what it had, and the next build draws the map from that;
   * the page on disk is the one drawn. Cleared at every start.
   */
  unkept: boolean
  /** The day a rebuild drew for; null for a layout run. */
  day: string | null
  /** What the map call said about the map it drew; null until one has. */
  report: RunReport | null
  /**
   * The feed's download inside this run, for drawing: a preset's zip
   * fetched the first time the layout needs it, which engine v0.10.0
   * reports as stage `download` (E36, issue 178). Set by the download's
   * reports and left null by a run whose feed was on disk; the first stage
   * the layout itself reports clears it. It says how far the bytes have
   * come, and nothing about whether the zip was kept: see `feedMissing`.
   */
  download: RunDownload | null
  /**
   * Set when a layout run ended before its first stage finished and the
   * feed is not on disk, asked of the engine's registry as the run ended
   * (issue 178). That, and not how far the bytes had come, is what makes an
   * ending the feed's: the engine refuses a page that is not a zip only
   * after its last byte, a download can fail before its first, and one of
   * unknown size reports a fraction of 0 to its end. Null when the
   * registry did not answer in time: unknown, which keeps the project and
   * does not let cell 01's inspection start a download of its own.
   */
  feedMissing: boolean | null
  /**
   * The layout the run's stage reports name (engine v0.14.0, issue 382):
   * set from the first report that carries one, so cell 01 can ask the
   * engine for each stage as it is reported, before the run ends. Null
   * until then, at every start, and for a run that never reported a stage;
   * a download's reports carry none.
   */
  layout: string | null
}

/** Where a download inside a run has got, in the engine's words. */
export interface RunDownload {
  /** "downloaded 65,536 of 1,732,403 bytes", as the engine counts them. */
  message: string
  /** Of the download's own bytes; 0 while the server has not said how many. */
  fraction: number
}

/**
 * Whether a run is at its download: it reported one that has not reached
 * its end, and no stage of its own since. A download whose size the server
 * never said reports fraction 0 throughout, and counts as going on until
 * the layout's first stage reports.
 */
/** How long an ending waits on the registry's answer before claiming nothing (issue 178). */
export const ON_DISK_DEADLINE = 10_000

export const downloading = (run: Pick<RunSnapshot, 'download'> | null): boolean =>
  // Loosely: a snapshot made before the field existed has no download.
  run?.download != null && run.download.fraction < 1

/**
 * What `map.build` answered about the map it drew, for the panel that
 * reads it (specs/017). It is the run's, not the record's: it describes
 * the build that just happened, and a build the app did not watch has
 * none. The result's file paths are deliberately left behind.
 */
export interface RunReport {
  /** The day the map was drawn for, as the engine echoed it. */
  date: string
  /** The build's numbers, exactly as the engine sent them. */
  diagnostics: Diagnostics
  /** What the build had to fudge, in the engine's own sentences. */
  caveats: string[]
  /** The engine's weighted proportion of the network it fudged; 0 is clean. */
  issues: number
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isFigure = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isLabels = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string')

/**
 * The diagnostics block, read rather than assumed. Every field the panel
 * reaches for is checked here, to the depth it reaches: the panel walks
 * four levels in (`stops.by.station_id`), the renderer has no error
 * boundary, and a block half the shape it claims would take the window
 * blank *after* the map had been drawn and the record written. A block
 * that is not whole is no block: the panel shows nothing and everything
 * else about the run is unaffected.
 */
export function readDiagnostics(raw: unknown): Diagnostics | null {
  if (!isObject(raw)) return null
  const { stops, trips, degraded } = raw
  if (!isObject(stops) || !isObject(trips) || !isObject(degraded)) return null
  const by = stops.by
  if (!isObject(by)) return null
  const figures = [
    raw.stations,
    raw.junctions,
    raw.edges,
    raw.octilinear,
    raw.labels_dropped,
    raw.peak_concurrent,
    stops.matched,
    stops.total,
    by.station_id,
    by.parent_station,
    by.name,
    trips.total,
    trips.paths,
    trips.unrouted,
    degraded.skipped_calls,
    degraded.borrowed_track,
  ]
  if (!figures.every(isFigure)) return null
  if (!isLabels(raw.lines) || !isLabels(stops.unmatched)) return null
  return raw as unknown as Diagnostics
}

/**
 * The part of a map result worth keeping, or nothing. The answer crosses
 * from another process, so its shape is read rather than assumed: an
 * engine that sent no diagnostics, or a block that is not whole, leaves
 * the panel with nothing to show, which is what a run whose result the app
 * cannot read should do.
 */
export function reportOf(result: MapBuildResult, date: string): RunReport | null {
  const answer = result as Partial<MapBuildResult> | null | undefined
  if (!isObject(answer)) return null
  const { caveats, issues } = answer
  const diagnostics = readDiagnostics(answer.diagnostics)
  if (diagnostics === null) return null
  return {
    date: typeof answer.date === 'string' ? answer.date : date,
    diagnostics,
    caveats: Array.isArray(caveats) ? caveats.filter((c) => typeof c === 'string') : [],
    issues: isFigure(issues) ? issues : 0,
  }
}

/**
 * The stations a map result lists (engine v0.13.0, issue 272), whole, or
 * null where there are none the app would take. The answer crosses from
 * another process, so it is read rather than assumed, as the report is.
 */
export function stationsFrom(result: MapBuildResult): Station[] | null {
  const answer = result as Partial<MapBuildResult> | null | undefined
  if (!isObject(answer)) return null
  return readStations(answer.stations)
}

/** A list to hand the record's writer, or nothing at all where there is none. */
const stationsOf = (stations: Station[] | null): { stations?: Station[] } =>
  stations === null ? {} : { stations }

interface Handle<T> {
  result: Promise<T>
  onProgress(
    listener: (p: { stage: string; message: string; fraction?: number; layout?: string }) => void,
  ): () => void
  /** The engine's log lines for this request; the typed client has it, a test stub may not. */
  onLog?(listener: (l: { level: string; line: string }) => void): () => void
  cancel(): void
}

/**
 * The part of the typed client a run uses, and no more. Naming the two
 * methods with their generated parameter and result types means the run
 * cannot send the engine something the protocol does not define, and a test
 * can pass a stub without an Electron bridge behind it.
 */
export type RunMethod = 'graph.build' | 'feeds.service' | 'map.build'

export interface RunClient {
  request<M extends RunMethod>(
    method: M,
    params: Methods[M]['params'],
  ): Handle<Methods[M]['result']>
}

/**
 * What a run needs for its whole life. Deliberately nothing from a screen:
 * a run outlives the view that started it, because a person can leave a
 * project while it runs and come back to it.
 */
export interface RunOptions {
  client: RunClient
  /**
   * The project's record as the store holds it once every write sent before
   * this read has landed (spec 037, FR-006/FR-007): `projects.get`, which
   * main queues behind the project's writes. A run reads its inputs here and
   * nowhere else, so a choice committed by the very press that starts it -
   * a field left for "Lay out", a day still in its debounce - is in what it
   * sends.
   */
  read(id: string): Promise<ProjectRecord>
  complete(
    id: string,
    done: {
      date: string
      layout: string
      made: string
      built: { mode: string; agency: string | null }
      service: ServiceWindow
      /** The stations the map was drawn with, for cell 03's trip (issue 272); absent when unread. */
      stations?: Station[]
      /** The tuning graph.build was sent (issue 385); absent for a run sent none. */
      tuning?: import('../../../shared/project').ProjectTuning
      /** What the run's map.build was sent (spec 037), which the record keeps as `drawn`. */
      sent: SentSet
    },
  ): Promise<{ changed: boolean; relaid: boolean }>
  /**
   * A rebuild for a chosen day finished: the day is written, inside the
   * window or not at all, with the stations the map was drawn with.
   */
  completeRebuild(id: string, done: { sent: SentSet; stations?: Station[] }): Promise<unknown>
  /**
   * A redraw for chosen colours finished: the palette is written, never
   * before the map is drawn, with the stations the build answered where it
   * answered a list (issue 272), and what its map.build was sent (spec 037).
   * So are the three below.
   */
  completeColors(
    id: string,
    palette: Palette,
    sent: SentSet,
    stations?: Station[],
  ): Promise<unknown>
  /** A redraw for a chosen line order finished: the order is written, never before the map is drawn. */
  completeOrder(id: string, order: LineOrder, sent: SentSet, stations?: Station[]): Promise<unknown>
  /** A redraw for chosen sizes finished: the style is written, never before the map is drawn. */
  completeStyle(
    id: string,
    style: ProjectStyle,
    sent: SentSet,
    stations?: Station[],
  ): Promise<unknown>
  /**
   * A redraw for chosen line options finished (issue 394): the options are
   * written, never before the map is drawn.
   */
  completeLines(
    id: string,
    lines: ProjectLines,
    sent: SentSet,
    stations?: Station[],
  ): Promise<unknown>
  /** The anchor the engine's choice is made from: the machine's date, injected so a test can fix it. */
  today(): string
  /**
   * Whether a feed's zip is on disk now, asked afresh of the engine's
   * registry when a layout run ends before its first stage (issue 178).
   * Left out, a feed is taken to be on disk and no ending is the feed's.
   */
  onDisk?(key: string): Promise<boolean>
}

export const freshStages = (): Stage[] =>
  LAYOUT_STAGES.map((label) => ({ id: label, label, state: 'pending' as const }))

/**
 * A report names the stage that has just finished: mark it done, and set the
 * first stage still waiting to running. A stage already done is the map
 * call repeating the layout's, and is left alone.
 */
export function advance(stages: Stage[], finished: string): Stage[] {
  const at = stages.findIndex((s) => s.id === finished)
  if (at === -1 || stages[at].state === 'done') return stages
  const next = stages.map((stage, i) => (i === at ? { ...stage, state: 'done' as const } : stage))
  const waiting = next.findIndex((s) => s.state === 'pending')
  if (waiting !== -1) next[waiting] = { ...next[waiting], state: 'running' }
  return next
}

/**
 * The engine's progress messages are sentences about what a stage produced,
 * except the last: the write stage reports the folder it wrote into, which
 * is an absolute path. A path is not for a screen (constitution V, and the
 * supervisor strips them from what it shows), so a message that carries one
 * is replaced by what the stage did.
 */
export function readableMessage(stage: string, message: string): string | null {
  if (message === '') return null
  // The write stage's message is the folder, and only that one is a path by
  // design. A slash alone is not evidence: the schedule stage says "matched
  // 114/114 stops", and a line label can be "A/C/E". So the test is for
  // something path-shaped, and it is a backstop rather than the rule.
  if (stage === 'write') return 'Wrote the map and its page.'
  return looksLikePath(message) ? `Finished ${stage}.` : message
}

const looksLikePath = (message: string): boolean =>
  /(^|[\s(])(?:[A-Za-z]:[\\/]|[\\/][^\s\\/])/.test(message)

/** The sentence a person reads for a failure: the engine's, never a path. */
export function sentenceFor(reason: unknown): string {
  if (isEngineErrorShape(reason)) return reason.data?.hint ?? reason.message
  return reason instanceof Error ? reason.message : 'The layout run did not finish.'
}

const IDLE: RunSnapshot = {
  state: 'idle',
  stages: freshStages(),
  message: null,
  error: null,
  changed: false,
  relaid: false,
  ...kindFlags({ kind: 'layout', forced: false }),
  replaced: false,
  unkept: false,
  report: null,
  download: null,
  feedMissing: false,
  layout: null,
}

/**
 * What a run keeps about its latest attempt beyond the snapshot, for the
 * inspector (A1-03): who it is for, when it started and ended, the engine's
 * detail when it failed, and the last lines of its log. The snapshot is
 * untouched by it; the job is derived from both.
 */
interface Attempt {
  id: string
  kind: JobKind
  label: string
  projectId: string
  started: number
  ended: number | null
  log: LogBuffer
  detail: string | null
  rawDetail: string | null
}

/** What one map call is built from: the arguments of the request, and of its sent set. */
type DrawArgs = Parameters<typeof sentSet>[0]

/** What Run all would start for a record (issue 407): `runAllPlan`'s answer, handed in. */
type RunAllPlanOf = (record: ProjectRecord, run: RunSnapshot) => RunAllPlan

/**
 * Which kind of run is going (issue 429). The snapshot still carries the
 * kind as flags, because a dozen readers and their tests ask one flag each;
 * but the flags are set here and nowhere else, from this union, and every
 * question that spans kinds is a function of it below, so that "is this a
 * redraw?" is not written out again in each reader.
 *
 * - `layout`: the stages and the map; `forced` is a re-layout.
 * - `rebuild`: the map alone, for a chosen day (cell 03).
 * - `colours`, `order`, `sizes`: the map alone, for a chosen palette, line
 *   order or set of sizes (cells 05, 05, 04).
 * - `options`: the colours' kind of run, refined: the map alone, for chosen
 *   line options (issue 394), so everything that reads `recoloured` still
 *   holds for it and only the words differ.
 *
 * `day` is the day the map is drawn for; a layout has none.
 */
export type RunKindOf =
  | { kind: 'layout'; forced: boolean }
  | { kind: 'rebuild' | 'colours' | 'options' | 'order' | 'sizes'; day: string | null }

/** The snapshot's flags that say which kind of run is going. */
interface RunKind {
  forced: boolean
  rebuilt: boolean
  recoloured: boolean
  optioned: boolean
  reordered: boolean
  restyled: boolean
  day: string | null
}

/** The flags a kind of run sets on the snapshot: the one place they are written. */
export function kindFlags(k: RunKindOf): RunKind {
  return {
    forced: k.kind === 'layout' && k.forced,
    rebuilt: k.kind === 'rebuild',
    recoloured: k.kind === 'colours' || k.kind === 'options',
    optioned: k.kind === 'options',
    reordered: k.kind === 'order',
    restyled: k.kind === 'sizes',
    day: k.kind === 'layout' ? null : k.day,
  }
}

/**
 * The kind of run a snapshot's flags describe. Takes any part of the
 * snapshot, so a reader that picked only the flags it needs can ask. The
 * order of the tests is the order the sentences were always chosen in:
 * sizes, order, options, colours, day.
 */
export function kindOfRun(
  flags: Partial<
    Pick<
      RunSnapshot,
      'forced' | 'rebuilt' | 'recoloured' | 'optioned' | 'reordered' | 'restyled' | 'day'
    >
  >,
): RunKindOf {
  const day = flags.day ?? null
  if (flags.restyled === true) return { kind: 'sizes', day }
  if (flags.reordered === true) return { kind: 'order', day }
  if (flags.optioned === true) return { kind: 'options', day }
  if (flags.recoloured === true) return { kind: 'colours', day }
  if (flags.rebuilt === true) return { kind: 'rebuild', day }
  return { kind: 'layout', forced: flags.forced === true }
}

type KindFlags = Parameters<typeof kindOfRun>[0]

/** A run that draws the map alone from the stored layout: a day, colours, line options, an order or sizes. */
export const isRedraw = (flags: KindFlags): boolean => kindOfRun(flags).kind !== 'layout'

/**
 * A redraw for a cheap edit - colours, line options, an order or sizes - as
 * against a day's rebuild: the runs whose panel holds its control while they
 * go and whose figures stay until their own arrive.
 */
export const isTuningRedraw = (flags: KindFlags): boolean => {
  const { kind } = kindOfRun(flags)
  return kind !== 'layout' && kind !== 'rebuild'
}

export class LayoutRun {
  #snapshot: RunSnapshot = IDLE
  #listeners = new Set<(s: RunSnapshot) => void>()
  #inFlight: { cancel(): void } | null = null
  #cancelled = false
  #attempt: Attempt | null = null
  /** The feed of the layout run going, the one that may download; null for a redraw. */
  #feedKey: string | null = null
  /** When the last download report was drawn, so a large feed's thousands of chunks are not. */
  #drawnDownload = 0
  /** A report the throttle held back, drawn if the run ends before the next one. */
  #heldDownload: RunDownload | null = null
  /** Ends a start's read of the record, for a cancel; null while nothing reads. */
  #wake: (() => void) | null = null
  /** Told of each press on a layout run, a rebuild or Run all, first (issue 407, `beforeStart`). */
  readonly #starting = new Set<() => void>()
  readonly #options: RunOptions

  constructor(options: RunOptions) {
    this.#options = options
  }

  get snapshot(): RunSnapshot {
    return this.#snapshot
  }

  subscribe(listener: (s: RunSnapshot) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #set(patch: Partial<RunSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch }
    const attempt = this.#attempt
    if (attempt !== null && attempt.ended === null && this.#snapshot.state !== 'running')
      attempt.ended = Date.now()
    for (const listener of this.#listeners) listener(this.#snapshot)
  }

  /** A new attempt begins: every start, refused or not, is a job of its own. */
  #open(kind: JobKind, label: string, projectId: string): void {
    this.#attempt = {
      id: nextJobId(),
      kind,
      label,
      projectId,
      started: Date.now(),
      ended: null,
      log: new LogBuffer(),
      detail: null,
      rawDetail: null,
    }
  }

  #log(line: { level: string; line: string }): void {
    this.#attempt?.log.push(`[${line.level}] ${line.line}`)
  }

  /**
   * The latest attempt as a job, or null when the run has never started.
   * Derived from the snapshot, so the inspector and the project screen
   * cannot disagree about a state (specs/024-jobs, SC-002).
   */
  job(): Job | null {
    const attempt = this.#attempt
    const { state, stages, message, error } = this.#snapshot
    if (attempt === null || state === 'idle') return null
    const failed = state === 'failed'
    return {
      id: attempt.id,
      kind: attempt.kind,
      projectId: attempt.projectId,
      projectName: null,
      label: attempt.label,
      state,
      stages: stages.map(({ id, label, state: s }) => ({ id, label, state: s })),
      message,
      hint: failed ? screenPaths(error) : null,
      detail: failed ? attempt.detail : null,
      rawDetail: failed ? attempt.rawDetail : null,
      log: attempt.log.lines,
      dropped: attempt.log.dropped,
      started: attempt.started,
      ended: attempt.ended,
    }
  }

  /**
   * Hear each press on a run, before the run reads its record (issue 407):
   * a layout run, a rebuild, Run all, and since spec 037 the four redraws
   * too. A control that holds a choice back on a timer - cell 03's day,
   * written a beat after it is picked - sends it here, so its write is sent
   * before the run's read, and the store answers the read with it: the run
   * draws the day, rather than the day landing while the run goes. A redraw
   * draws the day the map already shows, which a day chosen does not move -
   * except for a record from before `drawn` was kept, whose redraw draws the
   * record's own day: told, its day lands before the read, so the redraw
   * draws it and the store takes the completion, rather than refusing a
   * redraw of a day the record no longer holds after the map is drawn.
   */
  beforeStart(listener: () => void): () => void {
    this.#starting.add(listener)
    return () => {
      this.#starting.delete(listener)
    }
  }

  /** A press on any run: every `beforeStart` listener, first. */
  #pressed(): void {
    for (const listener of this.#starting) listener()
  }

  /**
   * A layout run of the project, with the engine's state as it is at this
   * moment. `force` is the re-layout: every stage runs again, and the engine
   * keeps the stored layout until the new set is whole, so a cancel or a
   * failure leaves the project exactly as it was.
   *
   * The run is going from the press - its job, its flags, Cancel on the
   * screen - and plans from the record the store answers once every write
   * sent before the press has landed (`#read`, spec 037), never from the
   * record handed, which may be a render behind.
   */
  start(
    handed: ProjectRecord,
    engine: EngineState | null,
    options: { force?: boolean } = {},
  ): void {
    if (this.#snapshot.state === 'running') return
    this.#pressed()
    this.#startLayout(handed, engine, options.force === true)
  }

  /** `start` once a second run has been refused: the job, the engine's refusal, the record read. */
  #startLayout(handed: ProjectRecord, engine: EngineState | null, force: boolean): void {
    this.#open('layout', force ? 'Re-layout' : 'Layout run', handed.id)
    if (!this.#begin(engine, kindFlags({ kind: 'layout', forced: force }))) return
    // Only a layout can download its feed; a redraw works from the stored
    // layout, whose feed is on disk. No writer moves the feed.
    this.#feedKey = handed.feed

    void (async () => {
      const project = await this.#readFor(handed.id)
      if (project === null) return
      await this.#layOut(project, force)
    })()
  }

  /**
   * The layout run proper, from the record it has read: graph.build,
   * feeds.service and map.build, then the one write. Called by a start and
   * by Run all once it has chosen a layout (issue 407); graph.build is
   * asked in the turn it is called in.
   */
  async #layOut(project: ProjectRecord, force: boolean): Promise<void> {
    const { client, complete, today } = this.#options
    try {
      // LOOM's settings the record holds (issue 385), taken once, as the
      // run starts, so what is sent and what the store is told was sent
      // are one copy; none at all for a project that never tuned, whose
      // request is the one it always was. A tuned layout is a layout of
      // its own, so this is part of what names it.
      const asked = askedWith(project.tuning)

      // The project's mode and agency are its inputs (A2-02): the engine
      // names a layout by them, so a change here is a different layout.
      // An agency of none is left out, which the engine reads as the
      // registry entry's.
      // An agency of none is sent as the empty string, which the engine
      // reads as every operator; left out, it would read as the registry
      // entry's, and a feed whose entry names one could never be drawn
      // whole (engine v0.7.1).
      const layout = client.request('graph.build', {
        key: project.feed,
        mode: project.mode,
        agency: project.agency ?? '',
        ...(force ? { force } : {}),
        ...tuningParams(asked.tuning),
      })
      this.#inFlight = layout
      layout.onProgress((p) => this.#report(p))
      layout.onLog?.((l) => this.#log(l))
      const built = await layout.result
      // A forced layout call that has answered has already replaced the
      // stored set; whatever happens from here, the screen must say so.
      if (force) this.#set({ replaced: true })
      // The handle's cancel is a no-op once its request has settled, so a
      // cancel that lands between the calls is caught here instead, and
      // nothing more is asked. The layout the call answered is stored either
      // way: a result is a finished call (engine v0.18.0), and one the
      // cancel reached too late says so, which the run says in turn, with
      // the layout's id as the engine answered it.
      if (this.#cancelled)
        return this.#stopped(
          cameTooLate(built) ? { message: LAYOUT_KEPT, layout: built.layout } : {},
        )

      // Which day to draw: the engine's rule from the machine's date as the
      // anchor, counting trips on the lines the layout drew, so the day is
      // the map's (ADR-031). The feed is cached by now, so this is short,
      // and it reports no stage; the sentence says what is being waited for.
      this.#set({ message: 'Choosing the service day from the timetable.' })
      const service = client.request('feeds.service', {
        key: project.feed,
        anchor: today(),
        lines: built.stages.octi.lines,
      })
      this.#inFlight = service
      service.onLog?.((l) => this.#log(l))
      const window = await service.result
      if (this.#cancelled) return this.#stopped()
      // A project keeps the day it has; the engine's day is for one without.
      const date = project.date ?? window.busiest_weekday

      // The map is drawn from the layout just answered, by its id; the
      // engine never lays out on the way to a map. Whatever it answers is a
      // map on disk, a cancel or not (`#draw`), so the record is written.
      const { report, stations, late, sent } = await this.#draw(project, {
        layout: built.layout,
        made: built.meta.made,
        date,
        palette: paletteOf(project),
        order: orderOf(project),
        style: project.style,
        lines: project.lines,
      })

      const written = await complete(project.id, {
        date,
        layout: built.layout,
        made: built.meta.made,
        // What the engine made the layout with, as its meta records it;
        // the screen says when the record's inputs have moved since.
        built: { mode: built.meta.mode, agency: built.meta.agency || null },
        service: {
          start: window.start,
          end: window.end,
          busiest: window.busiest_weekday,
          anchor: window.anchor,
        },
        // What cell 03's trip picks from (issue 272): the map's own list,
        // kept with the record because a project opened again draws its
        // map from the stored files without a build.
        ...stationsOf(stations),
        // The tuning graph.build was sent above, which the record keeps as
        // what this layout was asked with (issue 385): this run's, not the
        // record's now, which a tuning committed meanwhile has moved.
        ...asked,
        // What map.build was sent, which the record keeps as `drawn` (spec
        // 037): the run's own day and the choices it read at its start, not
        // the record's now.
        sent,
      })
      // The store cannot see `force`: a re-layout from this project moves
      // `made` too, and that is not another project's doing.
      this.#finish({ changed: written.changed, relaid: written.relaid && !force }, report, late)
    } catch (reason) {
      this.#failed(reason)
    }
  }

  /**
   * The map alone, from the stored layout, for a day a person chose. The
   * layout stages never run; the day is written only when the map has been
   * drawn, and the main process refuses a day outside the stored window.
   *
   * It reads its record as a layout run does (`#read`): the store's, once
   * the writes sent before the press have landed. No writer moves the
   * layout, so the one handed at the press is the one checked here.
   */
  rebuild(handed: ProjectRecord, engine: EngineState | null, date: string): void {
    if (this.#snapshot.state === 'running') return
    this.#pressed()
    this.#startRebuild(handed, engine, date)
  }

  /** `rebuild` once a second run has been refused: the job, the refusals, the record read. */
  #startRebuild(handed: ProjectRecord, engine: EngineState | null, date: string): void {
    this.#open('rebuild', `Rebuild for ${date}`, handed.id)
    if (handed.layout === null) {
      this.#set({
        state: 'failed',
        error: NO_LAYOUT_FOR_A_DAY,
        ...kindFlags({ kind: 'rebuild', day: date }),
        replaced: false,
        unkept: false,
        download: null,
        feedMissing: false,
        layout: null,
      })
      return
    }
    if (!this.#begin(engine, kindFlags({ kind: 'rebuild', day: date }))) return

    void (async () => {
      const project = await this.#readFor(handed.id)
      if (project === null) return
      if (project.layout === null) return this.#failed(new Error(NO_LAYOUT_FOR_A_DAY))
      await this.#drawDay(project, project.layout, date)
    })()
  }

  /**
   * The rebuild proper, from the record it has read: map.build for the day
   * from the stored layout, then the day written. Called by a rebuild and by
   * Run all once it has chosen one (issue 407).
   */
  async #drawDay(project: ProjectRecord, layout: string, date: string): Promise<void> {
    const { completeRebuild } = this.#options
    // Whether the map was drawn before anything failed: a write refused
    // after it leaves a page the record does not describe (`unkept`).
    let drawn = false
    try {
      const { report, stations, late, sent } = await this.#draw(project, {
        layout,
        made: project.made,
        date,
        palette: paletteOf(project),
        order: orderOf(project),
        style: project.style,
        lines: project.lines,
      })
      drawn = true
      await completeRebuild(project.id, { sent, ...stationsOf(stations) })
      this.#finish({ changed: false, relaid: false }, report, late)
    } catch (reason) {
      this.#failed(reason, drawn)
    }
  }

  /**
   * Run all (A5.5-22): a layout run, or a rebuild for the record's day,
   * whichever `planOf` - `runAllPlan`, handed in, so this module needs
   * nothing of the run graph's - answers for the record the run reads and
   * the run as the press found it (issue 407).
   *
   * The plan is made from the record the store answers once the writes sent
   * before the press have landed (`#read`, spec 037), not the one the screen
   * held at the press. The run is going from the press as the press's plan
   * would go, with its job and its flags, and makes the plan again from the
   * record it reads: a tuning that landed makes it a layout though only the
   * day was behind at the press, and a day that landed is the day a rebuild
   * draws and writes. Where the record read leaves nothing to run, nothing
   * runs (`#withdraw`). An engine that cannot run refuses at once, as a
   * press on cell 02's or cell 03's own button does.
   */
  runAll(handed: ProjectRecord, engine: EngineState | null, planOf: RunAllPlanOf): void {
    if (this.#snapshot.state === 'running') return
    this.#pressed()
    // The run as the press found it, for the plan, which reads a failure
    // and a re-layout stopped half way from it: the one before this press,
    // never the one the press itself starts.
    const before = { snapshot: this.#snapshot, attempt: this.#attempt }
    const pressed = planOf(handed, before.snapshot)
    if (engine === null || engine.state !== 'ready') {
      if (pressed.kind === 'layout') this.#startLayout(handed, engine, false)
      else if (pressed.kind === 'rebuild') this.#startRebuild(handed, engine, pressed.date)
      return
    }
    // Going from the press as the press's plan would go - its job, its
    // flags, the cell that reads running - until the record is read. The
    // engine is ready, so `#begin` starts it.
    if (pressed.kind === 'rebuild') {
      this.#open('rebuild', `Rebuild for ${pressed.date}`, handed.id)
      this.#begin(engine, kindFlags({ kind: 'rebuild', day: pressed.date }))
    } else {
      // A plan of nothing goes this way too, as a layout, for as long as the
      // read: cell 02 reads running and the inspector lists a layout run
      // until the plan is made again. It is rare - the header offers Run all
      // only for a plan of its own, so this is a record read newer than the
      // render's - and nothing runs unless the record read leaves a run to
      // make.
      this.#open('layout', 'Layout run', handed.id)
      this.#begin(engine, kindFlags({ kind: 'layout', forced: false }))
      this.#feedKey = handed.feed
    }

    void (async () => {
      const project = await this.#readFor(handed.id)
      if (project === null) return
      const plan = planOf(project, before.snapshot)
      if (plan.kind === 'none') return this.#withdraw(before)
      if (plan.kind === 'layout' || project.layout === null) {
        this.#become('layout', 'Layout run', kindFlags({ kind: 'layout', forced: false }))
        this.#feedKey = project.feed
        return this.#layOut(project, false)
      }
      this.#become(
        'rebuild',
        `Rebuild for ${plan.date}`,
        kindFlags({ kind: 'rebuild', day: plan.date }),
      )
      this.#feedKey = null
      return this.#drawDay(project, project.layout, plan.date)
    })()
  }

  /**
   * Run all's run, once it has chosen it after its read (issue 407): the job
   * and the flags the press gave it become the chosen run's where they
   * differ, so the cell that reads running and the job the inspector lists
   * are the run that is going. The same job - its id, its start and its log
   * - since it is the same press.
   */
  #become(kind: JobKind, label: string, flags: RunKind): void {
    const attempt = this.#attempt
    if (attempt !== null) {
      attempt.kind = kind
      attempt.label = label
    }
    const now = this.#snapshot
    if ((Object.keys(flags) as (keyof RunKind)[]).some((key) => now[key] !== flags[key]))
      this.#set(flags)
  }

  /**
   * Run all found nothing to run in the record it read (issue 407): a mode
   * or a day put back as the press took focus from it.
   * The press started no run, so the run is put back as it stood before the
   * press - that snapshot, the very object, and that attempt - rather than
   * ended: no job ends, no cell says it was stopped, and the screen, which
   * reads a record back only after a run that has just finished, does not
   * take one put back for one (`useProjectState.ts`).
   *
   * Except a redraw for colours, line options, the order or the sizes that
   * had stopped. Its panel puts its control back to the record on the
   * change *into* its own stop (`stoppedNow`, `usePutBack`), and the press
   * was a change out of it: put back as it was, the stop would read as a
   * second one, and the panel would drop a change a person made while Run
   * all waited and that panel held. The run goes back to idle instead, with
   * no kind, no sentence and no figures of that redraw, so no panel sees a
   * stop of its own; a run that finished, or never ran, goes back exactly.
   */
  #withdraw(before: { snapshot: RunSnapshot; attempt: Attempt | null }): void {
    const was = before.snapshot
    const stoppedRedraw =
      (was.state === 'cancelled' || was.state === 'failed') && isTuningRedraw(was)
    this.#feedKey = null
    this.#attempt = before.attempt
    this.#snapshot = stoppedRedraw ? IDLE : was
    for (const listener of this.#listeners) listener(this.#snapshot)
  }

  /**
   * The map alone, from the stored layout, for the day it already showed,
   * in a palette a person chose (A4-01). The layout stages never run and the day never
   * moves: a colour is a render, not a layout (ADR-023). The palette is
   * written only when the map has been drawn, as a chosen day is, so the
   * record never claims a colour the page on screen does not show.
   */
  recolour(project: ProjectRecord, engine: EngineState | null, palette: Palette): void {
    const { completeColors } = this.#options
    this.#redraw(project, engine, {
      kind: 'colours',
      label: 'Redraw in new colours',
      refusal: 'Lay the project out before choosing colours.',
      chosen: () => ({ palette }),
      write: (id, sent, stations) =>
        stations === null
          ? completeColors(id, palette, sent)
          : completeColors(id, palette, sent, stations),
    })
  }

  /**
   * The map alone, from the stored layout, for the day it already showed,
   * with the lines arranged as a person put them (A4-02). The same shape as a
   * recolour: the layout stages never run, the day never moves - the day
   * the map already showed is drawn again - and the order is written only
   * when the map has been drawn in it.
   */
  reorder(project: ProjectRecord, engine: EngineState | null, order: LineOrder): void {
    const { completeOrder } = this.#options
    this.#redraw(project, engine, {
      kind: 'order',
      label: 'Redraw in a new line order',
      refusal: 'Lay the project out before arranging the lines.',
      chosen: () => ({ order }),
      write: (id, sent, stations) =>
        stations === null
          ? completeOrder(id, order, sent)
          : completeOrder(id, order, sent, stations),
    })
  }

  /**
   * The map alone, from the stored layout, for the day it already showed,
   * with the sizes a person chose (issue 350, ADR-049). The same shape as a
   * recolour: the layout stages never run and the day never moves - the day
   * the map already showed is drawn again - and the style is written only
   * when the map has been drawn with it, so the record never claims a size
   * the page on screen does not show. A size is a render, never a layout:
   * the stations do not move, and the labels it re-places move the drawing's
   * box and nothing else.
   *
   * `map.build` is sent a `style` only for a style that sets something
   * (`styleParams`), so a project whose sizes are all the engine's own asks
   * for exactly what it asked for before the parameter existed.
   */
  restyle(project: ProjectRecord, engine: EngineState | null, style: ProjectStyle): void {
    const { completeStyle } = this.#options
    this.#redraw(project, engine, {
      kind: 'sizes',
      label: 'Redraw in new sizes',
      refusal: 'Lay the project out before choosing sizes.',
      chosen: () => ({ style }),
      write: (id, sent, stations) =>
        stations === null
          ? completeStyle(id, style, sent)
          : completeStyle(id, style, sent, stations),
    })
  }

  /**
   * The map alone, from the stored layout, for the day it already showed,
   * with the line options a person chose (issue 394, spec 036): a name,
   * hidden, a width, a casing and a dash by line label. The same shape as a
   * recolour: the layout stages never run, the day never moves, and the
   * options are written only when the map has been drawn with them.
   *
   * It is the colours' kind of run (`recoloured`, refined by `optioned` so
   * that cell 02 says what was drawn): the options live in cell
   * 05's colours list, so the cell reads running while it goes and ready
   * after, `cellOfRun` answers `lines` without being told anything new, and
   * a stop puts the colours and the options back together. Its job says
   * what it is.
   */
  redrawLines(project: ProjectRecord, engine: EngineState | null, lines: ProjectLines): void {
    const { completeLines } = this.#options
    this.#redraw(project, engine, {
      kind: 'options',
      label: 'Redraw with new line options',
      refusal: 'Lay the project out before choosing line options.',
      chosen: () => ({ lines }),
      write: (id, sent, stations) =>
        stations === null
          ? completeLines(id, lines, sent)
          : completeLines(id, lines, sent, stations),
    })
  }

  /**
   * One of the four redraws: the map alone, from the stored layout, for the
   * day the map on disk was drawn for, with the one choice the redraw is for
   * and everything else as the record holds it. Refused at once for a
   * project with nothing drawn, as the panels ask (`refusedAtStart`), and
   * otherwise going from the press; it reads its record as every run does
   * (`#read`, spec 037), and writes the choice only once the map carries it.
   *
   * The day is the drawn one, not the record's, which may be a day chosen
   * and not yet drawn (A5.5-15): a colour is a render, and a render must
   * not quietly draw a day nobody asked it to.
   */
  #redraw(
    handed: ProjectRecord,
    engine: EngineState | null,
    redraw: {
      kind: 'colours' | 'order' | 'sizes' | 'options'
      label: string
      refusal: string
      chosen: () => Partial<Pick<DrawArgs, 'palette' | 'order' | 'style' | 'lines'>>
      write: (id: string, sent: SentSet, stations: Station[] | null) => Promise<unknown>
    },
  ): void {
    if (this.#snapshot.state === 'running') return
    this.#pressed()
    this.#open('rebuild', redraw.label, handed.id)
    const date = drawnDate(handed)
    if (handed.layout === null || date === null) {
      this.#set({
        state: 'failed',
        error: redraw.refusal,
        ...kindFlags({ kind: redraw.kind, day: date }),
        replaced: false,
        unkept: false,
        download: null,
        feedMissing: false,
        layout: null,
      })
      return
    }
    if (!this.#begin(engine, kindFlags({ kind: redraw.kind, day: date }))) return

    void (async () => {
      const project = await this.#readFor(handed.id)
      if (project === null) return
      const layout = project.layout
      const day = drawnDate(project)
      if (layout === null || day === null) return this.#failed(new Error(redraw.refusal))
      // The day the record read says the map shows, which the flags say too.
      if (day !== this.#snapshot.day) this.#set({ day })
      // Whether the map was drawn before anything failed: a write refused
      // after it leaves a page the record does not describe (`unkept`).
      let drawn = false
      try {
        const { report, stations, late, sent } = await this.#draw(project, {
          layout,
          made: project.made,
          date: day,
          palette: paletteOf(project),
          order: orderOf(project),
          style: project.style,
          lines: project.lines,
          ...redraw.chosen(),
        })
        drawn = true
        await redraw.write(project.id, sent, stations)
        this.#finish({ changed: false, relaid: false }, report, late)
      } catch (reason) {
        this.#failed(reason, drawn)
      }
    })()
  }

  /**
   * The record a run plans from: the store's answer to `projects.get`, which
   * main queues behind the project's writes, so it holds every write sent
   * before it (spec 037, FR-006/FR-007). The screen's writes, the debounced
   * day flushed by `beforeStart` among them, were sent before the press
   * that starts the run, and so before this read: the run sends what was
   * chosen before the press. A write sent after it is not in it: a run
   * sends what it was started with (spec 033, FR-007).
   *
   * The run is `running` while it reads, so Cancel is on the screen, and a
   * cancel ends the read at once with null.
   */
  #read(id: string): Promise<ProjectRecord | null> {
    return new Promise<ProjectRecord | null>((settle, fail) => {
      this.#wake = () => settle(null)
      this.#options.read(id).then(settle, fail)
    }).finally(() => {
      this.#wake = null
    })
  }

  /**
   * `#read` for a run that has just begun: the record, or null when the run
   * was cancelled while it read or the read failed, either of which has
   * ended the run already.
   */
  async #readFor(id: string): Promise<ProjectRecord | null> {
    let project: ProjectRecord | null
    try {
      project = await this.#read(id)
    } catch (reason) {
      this.#failed(reason)
      return null
    }
    if (project === null || this.#cancelled) {
      this.#stopped()
      return null
    }
    return project
  }

  /** The engine ready, the line reset, the snapshot running; false when it cannot start. */
  #begin(engine: EngineState | null, kind: RunKind): boolean {
    if (engine === null || engine.state !== 'ready') {
      // The kind is this attempt's even when it fails to start, or the
      // sentence for the failure would be the previous run's.
      this.#set({
        state: 'failed',
        error:
          engine === null
            ? 'The engine is still starting. Try again in a moment.'
            : `The engine is not ready to run a layout: ${engine.state}.`,
        replaced: false,
        unkept: false,
        // A failed start is not the last run's download (issue 178), nor
        // its layout (issue 382).
        download: null,
        feedMissing: false,
        layout: null,
        ...kind,
      })
      return false
    }
    this.#feedKey = null
    this.#cancelled = false
    const started = freshStages()
    started[0] = { ...started[0], state: 'running' }
    this.#set({
      state: 'running',
      stages: started,
      message: null,
      error: null,
      changed: false,
      relaid: false,
      replaced: false,
      unkept: false,
      // The panel describes the build being started, so the last one's
      // figures go now rather than when this one answers.
      report: null,
      download: null,
      feedMissing: false,
      // Named again by this run's first stage report (issue 382).
      layout: null,
      ...kind,
    })
    return true
  }

  /**
   * The map call, from a layout by its id, for a day, in a palette; its
   * stages reported as they finish. The palette is an argument rather than
   * the project's, because a colour change draws before it is stored, as a
   * chosen day is drawn before it is stored (A3-04, A4-01); the order, the
   * style and the line options are arguments for the same reason.
   *
   * It answers what the engine measured rather than setting it: the figures
   * belong to a finished run, beside the sentence that says it finished, so
   * they never appear on screen before the map they describe and never go
   * again because the record could not be written (spec 017). With them, the
   * stations the map draws (issue 272), read whole or not at all, for the
   * handlers that write `drawn`, every draw's: a recolour, a reorder and a
   * resize draw from the stored set as it is now, which another project may
   * have laid out again since, so the list is the build's and not the
   * record's to assume.
   *
   * This is the one place any run asks for a map - a layout, a rebuild, Run
   * all, the four redraws - so it is the one place that decides what a map
   * call's answer means after a cancel (engine v0.18.0). The cancelled error
   * rejects, as any error does, and nothing was written. A result is a map
   * on disk, the files it names drawn and in place, whoever pressed Cancel
   * and whenever: the caller writes the record from it as from any draw.
   * `late` is the result's own `cancel_too_late`, read as untrusted data,
   * and says only that the cancel reached the engine after its point of no
   * return, for the sentence; never when the press came.
   */
  async #draw(
    project: ProjectRecord,
    draw: DrawArgs,
  ): Promise<{
    report: RunReport | null
    stations: Station[] | null
    late: boolean
    sent: SentSet
  }> {
    const { layout, date, palette, order, style, lines } = draw
    // What the request below is built from, copied once, which every
    // completion hands the record as what the map was drawn from (spec 037).
    const sent = sentSet(draw)
    const map = this.#options.client.request('map.build', {
      key: project.feed,
      layout,
      date,
      out: project.id,
      // Sent on every draw, so a layout, a re-layout, a chosen day and a
      // colour change all draw the colours the project has chosen. The
      // engine ignores a colour for a label its layout does not carry, so
      // an override outlives a narrower mode.
      colors: palette.colors,
      default_color: palette.defaultColor,
      // The arrangement, the same way (A4-02). Left out when there is none,
      // so a project nobody has arranged asks for exactly what it asked for
      // before the panel existed. The engine draws the lines an order names
      // first and every other line after them, so a stale arrangement can
      // neither drop a line nor draw one twice (engine issue 28).
      ...(order.length === 0 ? {} : { line_order: order }),
      // The sizes, the same way (issue 350): left out when nothing is set,
      // so a project nobody has sized asks for exactly what it asked for
      // before the engine took a style, and only the fields a person set go
      // when something is. Never a colour: the page's theme owns those.
      // Since issue 391 the markers and the label face go inside `style` and
      // the trains' `dot_radius` and `trail` beside it, on every draw, so a
      // day, a colour or an order keeps them (`styleParams`).
      ...styleParams(style),
      // The line options, the same way (issue 394): a name, a hidden line, a
      // width, a casing and a dash by line label, left out when there are
      // none, so a project that chose none asks for exactly what it asked
      // for before; on every draw, so a day, a colour, an order or a size
      // keeps a hidden line hidden.
      ...linesParams(lines),
    })
    this.#inFlight = map
    map.onProgress((p) => this.#report(p))
    map.onLog?.((l) => this.#log(l))
    const drawn = await map.result
    this.#inFlight = null
    // What the engine measured drawing this map: kept for the panel, and
    // for a rebuild too, which draws the same way for another day.
    return {
      report: reportOf(drawn, date),
      stations: stationsFrom(drawn),
      late: cameTooLate(drawn),
      sent,
    }
  }

  /**
   * A run that finished: its map drawn and its record written. `late` says
   * the map call's answer carried `cancel_too_late` (`#draw`): the person
   * pressed Cancel and the map was already in place, so the run says the
   * map is kept, beside the sentence for what was drawn.
   */
  #finish(
    outcome: { changed: boolean; relaid: boolean },
    report: RunReport | null,
    late = false,
  ): void {
    this.#set({
      state: 'done',
      stages: this.#snapshot.stages.map((s) => ({ ...s, state: 'done' as const })),
      changed: outcome.changed,
      relaid: outcome.relaid,
      replaced: false,
      report,
      ...(late ? { message: MAP_KEPT } : {}),
    })
  }

  /**
   * A run that failed. `drawn` says the map call had answered before the
   * failure, so what failed was the write after it (issue 399, `unkept`).
   */
  #failed(reason: unknown, drawn = false): void {
    this.#inFlight = null
    if (isEngineErrorShape(reason) && reason.code === ERROR_CODES.cancelled) {
      this.#end({
        state: 'cancelled',
        stages: this.#snapshot.stages.map((s) =>
          s.state === 'running' ? { ...s, state: 'pending' as const } : s,
        ),
        report: null,
      })
      return
    }
    if (this.#attempt !== null) Object.assign(this.#attempt, failureOf(reason))
    this.#end({
      state: 'failed',
      error: sentenceFor(reason),
      unkept: drawn,
      stages: this.#snapshot.stages.map((s) =>
        s.state === 'running' ? { ...s, state: 'failed' as const } : s,
      ),
      report: null,
    })
  }

  /**
   * A run that did not finish, ended. A layout that ended before its first
   * stage may have ended at its feed: the registry is asked, afresh,
   * whether the zip is on disk, and the answer goes out with the ending in
   * one change, so nothing reading the snapshot sees one without the other
   * (issue 178). The run stays `running` for that moment, which is also
   * what keeps a second start out.
   */
  #end(ending: Partial<RunSnapshot>): void {
    let patch = ending
    const feed = this.#feedKey
    const onDisk = this.#options.onDisk
    this.#feedKey = null
    // A download report the throttle held back is the last word on the bytes.
    const held = this.#heldDownload
    this.#heldDownload = null
    if (held !== null) patch = { ...patch, download: held }
    if (feed === null || onDisk === undefined || this.#snapshot.stages[0]?.state === 'done') {
      this.#set({ ...patch, feedMissing: false })
      return
    }
    // A deadline, so an engine that has stopped answering cannot hold the
    // run at `running`. Unanswered, answered late or refused, the answer is
    // unknown (null): the project is kept, as for any ending that is not the
    // feed's, and the gate does not let the inspection download on its own.
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<boolean | null>((settle) => {
      timer = setTimeout(() => settle(null), ON_DISK_DEADLINE)
    })
    void Promise.race([
      onDisk(feed).then(
        (there) => !there,
        () => null,
      ),
      late,
    ]).then((missing) => {
      clearTimeout(timer)
      this.#set({ ...patch, feedMissing: missing })
    })
  }

  /**
   * Cancelled between the awaits, before the next call was asked: the record
   * is not written, and nothing more is asked of the engine. A call that had
   * answered keeps what it did - a layout graph.build stored stays stored -
   * and `kept` is what the run then says of it: the sentence, and the
   * layout's id as the call answered it, where its cancel came too late.
   */
  #stopped(kept: { message?: string; layout?: string } = {}): void {
    this.#end({
      state: 'cancelled',
      stages: this.#snapshot.stages.map((s) =>
        s.state === 'running' ? { ...s, state: 'pending' as const } : s,
      ),
      // A run that did not finish left the record and the page on screen
      // as they were; the figures of a map nobody is looking at would
      // describe something else (spec 017).
      report: null,
      ...(kept.message === undefined ? {} : { message: kept.message }),
      ...(kept.layout === undefined ? {} : { layout: kept.layout }),
    })
  }

  #report(p: { stage: string; message: string; fraction?: number; layout?: string }): void {
    // A feed downloading inside the run (engine v0.10.0, E36): cell 01's,
    // not a stage of the line, so it is kept apart from the stages.
    if (p.stage === 'download') {
      // The engine reports every 64 KiB; drawn at most four times a second,
      // and always at the last byte, a large feed's thousands of chunks do
      // not re-render the screen or refill a live region each time.
      const fraction = p.fraction ?? 0
      const now = Date.now()
      if (this.#snapshot.download !== null && fraction < 1 && now - this.#drawnDownload < 250) {
        // Kept, so a download of unknown size - a fraction of 0 to its end -
        // still ends on its last count if the run ends here.
        this.#heldDownload = { message: p.message, fraction }
        return
      }
      this.#drawnDownload = now
      this.#heldDownload = null
      this.#set({ download: { message: p.message, fraction } })
      return
    }
    if (this.#snapshot.download !== null) {
      // The layout's own first stage: the download is behind it, whatever
      // its last report said.
      this.#heldDownload = null
      this.#set({ download: null })
    }
    // The layout the stage is of (engine v0.14.0, issue 382), taken from
    // the first report that names one and kept for the run: the map call's
    // replays name the same layout, and nothing else names one at all.
    const named: { layout?: string } =
      this.#snapshot.layout === null && typeof p.layout === 'string' ? { layout: p.layout } : {}
    const stages = advance(this.#snapshot.stages, p.stage)
    if (stages === this.#snapshot.stages) {
      if (named.layout !== undefined) this.#set(named)
      return
    }
    const sentence = readableMessage(p.stage, p.message)
    this.#set({ stages, message: sentence ?? this.#snapshot.message, ...named })
  }

  cancel(): void {
    if (this.#snapshot.state !== 'running') return
    this.#cancelled = true
    this.#inFlight?.cancel()
    // A start still reading its record stops reading (spec 037).
    this.#wake?.()
  }

  /** Releases the client's subscriptions. The view calls this when it goes. */
  dispose(): void {
    this.#listeners.clear()
  }
}
