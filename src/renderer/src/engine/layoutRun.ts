import { LAYOUT_STAGES, type RunState } from '../../../shared/layout'
import { isEngineErrorShape, ERROR_CODES, type EngineState } from '../../../shared/engine'
import {
  drawnDate,
  orderOf,
  paletteOf,
  type LineOrder,
  type Palette,
  type ProjectRecord,
  type ProjectStyle,
  type ServiceWindow,
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
import type { Stage } from '../ProgressLine'
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
// the order and the style the project is being drawn with, so the map on
// screen and the record never disagree.

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
  /** Set when the run is a redraw for a chosen line order: the map call alone (A4-02). */
  reordered: boolean
  /** Set when the run is a redraw for chosen sizes: the map call alone (issue 350). */
  restyled: boolean
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
    },
  ): Promise<{ changed: boolean; relaid: boolean }>
  /**
   * A rebuild for a chosen day finished: the day is written, inside the
   * window or not at all, with the stations the map was drawn with.
   */
  completeRebuild(id: string, done: { date: string; stations?: Station[] }): Promise<unknown>
  /**
   * A redraw for chosen colours finished: the palette is written, never
   * before the map is drawn, with the stations the build answered where it
   * answered a list (issue 272). So are the two below.
   */
  completeColors(id: string, palette: Palette, stations?: Station[]): Promise<unknown>
  /** A redraw for a chosen line order finished: the order is written, never before the map is drawn. */
  completeOrder(id: string, order: LineOrder, stations?: Station[]): Promise<unknown>
  /** A redraw for chosen sizes finished: the style is written, never before the map is drawn. */
  completeStyle(id: string, style: ProjectStyle, stations?: Station[]): Promise<unknown>
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
  forced: false,
  replaced: false,
  rebuilt: false,
  recoloured: false,
  reordered: false,
  restyled: false,
  day: null,
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
   * The project and the engine's state as they are at this moment.
   * `force` is the re-layout: every stage runs again, and the engine keeps
   * the stored layout until the new set is whole, so a cancel or a failure
   * leaves the project exactly as it was.
   */
  start(
    project: ProjectRecord,
    engine: EngineState | null,
    options: { force?: boolean } = {},
  ): void {
    if (this.#snapshot.state === 'running') return
    const { client, complete, today } = this.#options
    const force = options.force === true
    this.#open('layout', force ? 'Re-layout' : 'Layout run', project.id)
    if (
      !this.#begin(engine, {
        forced: force,
        rebuilt: false,
        recoloured: false,
        reordered: false,
        restyled: false,
        day: null,
      })
    )
      return
    // Only a layout can download its feed; a redraw works from the stored
    // layout, whose feed is on disk.
    this.#feedKey = project.feed

    void (async () => {
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
        // cancel that lands between the calls, or while the record is being
        // written, is caught here instead.
        if (this.#cancelled) return this.#stopped()

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
        // engine never lays out on the way to a map.
        const { report, stations } = await this.#draw(
          project,
          built.layout,
          date,
          paletteOf(project),
          orderOf(project),
          project.style,
        )
        if (this.#cancelled) return this.#stopped()

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
        })
        // The store cannot see `force`: a re-layout from this project moves
        // `made` too, and that is not another project's doing.
        this.#finish({ changed: written.changed, relaid: written.relaid && !force }, report)
      } catch (reason) {
        this.#failed(reason)
      }
    })()
  }

  /**
   * The map alone, from the stored layout, for a day a person chose. The
   * layout stages never run; the day is written only when the map has been
   * drawn, and the main process refuses a day outside the stored window.
   */
  rebuild(project: ProjectRecord, engine: EngineState | null, date: string): void {
    if (this.#snapshot.state === 'running') return
    const { completeRebuild } = this.#options
    this.#open('rebuild', `Rebuild for ${date}`, project.id)
    const layout = project.layout
    if (layout === null) {
      this.#set({
        state: 'failed',
        error: 'Lay the project out before choosing a day.',
        forced: false,
        replaced: false,
        rebuilt: true,
        recoloured: false,
        reordered: false,
        restyled: false,
        day: date,
        download: null,
        feedMissing: false,
        layout: null,
      })
      return
    }
    if (
      !this.#begin(engine, {
        forced: false,
        rebuilt: true,
        recoloured: false,
        reordered: false,
        restyled: false,
        day: date,
      })
    )
      return

    void (async () => {
      try {
        const { report, stations } = await this.#draw(
          project,
          layout,
          date,
          paletteOf(project),
          orderOf(project),
          project.style,
        )
        if (this.#cancelled) return this.#stopped()
        await completeRebuild(project.id, { date, ...stationsOf(stations) })
        this.#finish({ changed: false, relaid: false }, report)
      } catch (reason) {
        this.#failed(reason)
      }
    })()
  }

  /**
   * The map alone, from the stored layout, for the day it already showed,
   * in a palette a person chose (A4-01). The layout stages never run and the day never
   * moves: a colour is a render, not a layout (ADR-023). The palette is
   * written only when the map has been drawn, as a chosen day is, so the
   * record never claims a colour the page on screen does not show.
   */
  recolour(project: ProjectRecord, engine: EngineState | null, palette: Palette): void {
    if (this.#snapshot.state === 'running') return
    const { completeColors } = this.#options
    this.#open('rebuild', 'Redraw in new colours', project.id)
    const layout = project.layout
    // The day the map on disk was drawn for, not the record's, which may be
    // a day chosen and not yet drawn (A5.5-15): a colour is a render, and a
    // render must not quietly draw a day nobody asked it to.
    const date = drawnDate(project)
    if (layout === null || date === null) {
      this.#set({
        state: 'failed',
        error: 'Lay the project out before choosing colours.',
        forced: false,
        replaced: false,
        rebuilt: false,
        recoloured: true,
        reordered: false,
        restyled: false,
        day: date,
        download: null,
        feedMissing: false,
        layout: null,
      })
      return
    }
    if (
      !this.#begin(engine, {
        forced: false,
        rebuilt: false,
        recoloured: true,
        reordered: false,
        restyled: false,
        day: date,
      })
    )
      return

    void (async () => {
      try {
        const { report, stations } = await this.#draw(
          project,
          layout,
          date,
          palette,
          orderOf(project),
          project.style,
        )
        if (this.#cancelled) return this.#stopped()
        await (stations === null
          ? completeColors(project.id, palette)
          : completeColors(project.id, palette, stations))
        this.#finish({ changed: false, relaid: false }, report)
      } catch (reason) {
        this.#failed(reason)
      }
    })()
  }

  /**
   * The map alone, from the stored layout, for the day it already showed,
   * with the lines arranged as a person put them (A4-02). The same shape as a
   * recolour: the layout stages never run, the day never moves - the day
   * the map already showed is drawn again - and the order is written only
   * when the map has been drawn in it.
   */
  reorder(project: ProjectRecord, engine: EngineState | null, order: LineOrder): void {
    if (this.#snapshot.state === 'running') return
    const { completeOrder } = this.#options
    this.#open('rebuild', 'Redraw in a new line order', project.id)
    const layout = project.layout
    // The drawn day, as a recolour takes it, and for the same reason.
    const date = drawnDate(project)
    if (layout === null || date === null) {
      this.#set({
        state: 'failed',
        error: 'Lay the project out before arranging the lines.',
        forced: false,
        replaced: false,
        rebuilt: false,
        recoloured: false,
        reordered: true,
        restyled: false,
        day: date,
        download: null,
        feedMissing: false,
        layout: null,
      })
      return
    }
    if (
      !this.#begin(engine, {
        forced: false,
        rebuilt: false,
        recoloured: false,
        reordered: true,
        restyled: false,
        day: date,
      })
    )
      return

    void (async () => {
      try {
        const { report, stations } = await this.#draw(
          project,
          layout,
          date,
          paletteOf(project),
          order,
          project.style,
        )
        if (this.#cancelled) return this.#stopped()
        await (stations === null
          ? completeOrder(project.id, order)
          : completeOrder(project.id, order, stations))
        this.#finish({ changed: false, relaid: false }, report)
      } catch (reason) {
        this.#failed(reason)
      }
    })()
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
    if (this.#snapshot.state === 'running') return
    const { completeStyle } = this.#options
    this.#open('rebuild', 'Redraw in new sizes', project.id)
    const layout = project.layout
    // The drawn day, as a recolour takes it, and for the same reason.
    const date = drawnDate(project)
    if (layout === null || date === null) {
      this.#set({
        state: 'failed',
        error: 'Lay the project out before choosing sizes.',
        forced: false,
        replaced: false,
        rebuilt: false,
        recoloured: false,
        reordered: false,
        restyled: true,
        day: date,
        download: null,
        feedMissing: false,
        layout: null,
      })
      return
    }
    if (
      !this.#begin(engine, {
        forced: false,
        rebuilt: false,
        recoloured: false,
        reordered: false,
        restyled: true,
        day: date,
      })
    )
      return

    void (async () => {
      try {
        const { report, stations } = await this.#draw(
          project,
          layout,
          date,
          paletteOf(project),
          orderOf(project),
          style,
        )
        if (this.#cancelled) return this.#stopped()
        await (stations === null
          ? completeStyle(project.id, style)
          : completeStyle(project.id, style, stations))
        this.#finish({ changed: false, relaid: false }, report)
      } catch (reason) {
        this.#failed(reason)
      }
    })()
  }

  /** The engine ready, the line reset, the snapshot running; false when it cannot start. */
  #begin(
    engine: EngineState | null,
    kind: {
      forced: boolean
      rebuilt: boolean
      recoloured: boolean
      reordered: boolean
      restyled: boolean
      day: string | null
    },
  ): boolean {
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
   * chosen day is drawn before it is stored (A3-04, A4-01); the order and
   * the style are arguments for the same reason.
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
   */
  async #draw(
    project: ProjectRecord,
    layout: string,
    date: string,
    palette: Palette,
    order: LineOrder,
    style: ProjectStyle,
  ): Promise<{ report: RunReport | null; stations: Station[] | null }> {
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
      ...styleParams(style),
    })
    this.#inFlight = map
    map.onProgress((p) => this.#report(p))
    map.onLog?.((l) => this.#log(l))
    const drawn = await map.result
    this.#inFlight = null
    // What the engine measured drawing this map: kept for the panel, and
    // for a rebuild too, which draws the same way for another day.
    return { report: reportOf(drawn, date), stations: stationsFrom(drawn) }
  }

  #finish(outcome: { changed: boolean; relaid: boolean }, report: RunReport | null): void {
    this.#set({
      state: 'done',
      stages: this.#snapshot.stages.map((s) => ({ ...s, state: 'done' as const })),
      changed: outcome.changed,
      relaid: outcome.relaid,
      replaced: false,
      report,
    })
  }

  #failed(reason: unknown): void {
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

  /** Cancelled between the awaits: nothing was written, and nothing is. */
  #stopped(): void {
    this.#end({
      state: 'cancelled',
      stages: this.#snapshot.stages.map((s) =>
        s.state === 'running' ? { ...s, state: 'pending' as const } : s,
      ),
      // A run that did not finish left the record and the page on screen
      // as they were; the figures of a map nobody is looking at would
      // describe something else (spec 017).
      report: null,
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
  }

  /** Releases the client's subscriptions. The view calls this when it goes. */
  dispose(): void {
    this.#listeners.clear()
  }
}
