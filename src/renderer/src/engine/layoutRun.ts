import { LAYOUT_STAGES, type RunState } from '../../../shared/layout'
import { isEngineErrorShape, ERROR_CODES, type EngineState } from '../../../shared/engine'
import {
  orderOf,
  paletteOf,
  type LineOrder,
  type Palette,
  type ProjectRecord,
  type ServiceWindow,
} from '../../../shared/project'
import type { Diagnostics, MapBuildResult, Methods } from '../../../shared/protocol'
import type { Stage } from '../ProgressLine'

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
// only when the map has been drawn. A recolour is the same shape for a
// palette a person chose (A4-01): the stored day, the stored layout, and
// the palette written only once the map carries it. Every draw, whichever
// started it, sends the palette the project is being drawn with, so the
// map on screen and the record never disagree.

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
  /** The day a rebuild drew for; null for a layout run. */
  day: string | null
  /** What the map call said about the map it drew; null until one has. */
  report: RunReport | null
}

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

interface Handle<T> {
  result: Promise<T>
  onProgress(listener: (p: { stage: string; message: string }) => void): () => void
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
    },
  ): Promise<{ changed: boolean; relaid: boolean }>
  /** A rebuild for a chosen day finished: the day is written, inside the window or not at all. */
  completeRebuild(id: string, done: { date: string }): Promise<unknown>
  /** A redraw for chosen colours finished: the palette is written, never before the map is drawn. */
  completeColors(id: string, palette: Palette): Promise<unknown>
  /** A redraw for a chosen line order finished: the order is written, never before the map is drawn. */
  completeOrder(id: string, order: LineOrder): Promise<unknown>
  /** The anchor the engine's choice is made from: the machine's date, injected so a test can fix it. */
  today(): string
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
  day: null,
  report: null,
}

export class LayoutRun {
  #snapshot: RunSnapshot = IDLE
  #listeners = new Set<(s: RunSnapshot) => void>()
  #inFlight: { cancel(): void } | null = null
  #cancelled = false
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
    for (const listener of this.#listeners) listener(this.#snapshot)
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
    if (
      !this.#begin(engine, {
        forced: force,
        rebuilt: false,
        recoloured: false,
        reordered: false,
        day: null,
      })
    )
      return

    void (async () => {
      try {
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
        })
        this.#inFlight = layout
        layout.onProgress((p) => this.#report(p))
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
        const window = await service.result
        if (this.#cancelled) return this.#stopped()
        // A project keeps the day it has; the engine's day is for one without.
        const date = project.date ?? window.busiest_weekday

        // The map is drawn from the layout just answered, by its id; the
        // engine never lays out on the way to a map.
        const report = await this.#draw(
          project,
          built.layout,
          date,
          paletteOf(project),
          orderOf(project),
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
        day: date,
      })
      return
    }
    if (
      !this.#begin(engine, {
        forced: false,
        rebuilt: true,
        recoloured: false,
        reordered: false,
        day: date,
      })
    )
      return

    void (async () => {
      try {
        const report = await this.#draw(project, layout, date, paletteOf(project), orderOf(project))
        if (this.#cancelled) return this.#stopped()
        await completeRebuild(project.id, { date })
        this.#finish({ changed: false, relaid: false }, report)
      } catch (reason) {
        this.#failed(reason)
      }
    })()
  }

  /**
   * The map alone, from the stored layout, for the stored day, in a palette
   * a person chose (A4-01). The layout stages never run and the day never
   * moves: a colour is a render, not a layout (ADR-023). The palette is
   * written only when the map has been drawn, as a chosen day is, so the
   * record never claims a colour the page on screen does not show.
   */
  recolour(project: ProjectRecord, engine: EngineState | null, palette: Palette): void {
    if (this.#snapshot.state === 'running') return
    const { completeColors } = this.#options
    const layout = project.layout
    const date = project.date
    if (layout === null || date === null) {
      this.#set({
        state: 'failed',
        error: 'Lay the project out before choosing colours.',
        forced: false,
        replaced: false,
        rebuilt: false,
        recoloured: true,
        reordered: false,
        day: date,
      })
      return
    }
    if (
      !this.#begin(engine, {
        forced: false,
        rebuilt: false,
        recoloured: true,
        reordered: false,
        day: date,
      })
    )
      return

    void (async () => {
      try {
        const report = await this.#draw(project, layout, date, palette, orderOf(project))
        if (this.#cancelled) return this.#stopped()
        await completeColors(project.id, palette)
        this.#finish({ changed: false, relaid: false }, report)
      } catch (reason) {
        this.#failed(reason)
      }
    })()
  }

  /**
   * The map alone, from the stored layout, for the stored day, with the
   * lines arranged as a person put them (A4-02). The same shape as a
   * recolour: the layout stages never run, the day never moves, and the
   * order is written only when the map has been drawn in it.
   */
  reorder(project: ProjectRecord, engine: EngineState | null, order: LineOrder): void {
    if (this.#snapshot.state === 'running') return
    const { completeOrder } = this.#options
    const layout = project.layout
    const date = project.date
    if (layout === null || date === null) {
      this.#set({
        state: 'failed',
        error: 'Lay the project out before arranging the lines.',
        forced: false,
        replaced: false,
        rebuilt: false,
        recoloured: false,
        reordered: true,
        day: date,
      })
      return
    }
    if (
      !this.#begin(engine, {
        forced: false,
        rebuilt: false,
        recoloured: false,
        reordered: true,
        day: date,
      })
    )
      return

    void (async () => {
      try {
        const report = await this.#draw(project, layout, date, paletteOf(project), order)
        if (this.#cancelled) return this.#stopped()
        await completeOrder(project.id, order)
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
        ...kind,
      })
      return false
    }
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
      ...kind,
    })
    return true
  }

  /**
   * The map call, from a layout by its id, for a day, in a palette; its
   * stages reported as they finish. The palette is an argument rather than
   * the project's, because a colour change draws before it is stored, as a
   * chosen day is drawn before it is stored (A3-04, A4-01).
   *
   * It answers what the engine measured rather than setting it: the figures
   * belong to a finished run, beside the sentence that says it finished, so
   * they never appear on screen before the map they describe and never go
   * again because the record could not be written (spec 017).
   */
  async #draw(
    project: ProjectRecord,
    layout: string,
    date: string,
    palette: Palette,
    order: LineOrder,
  ): Promise<RunReport | null> {
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
    })
    this.#inFlight = map
    map.onProgress((p) => this.#report(p))
    const drawn = await map.result
    this.#inFlight = null
    // What the engine measured drawing this map: kept for the panel, and
    // for a rebuild too, which draws the same way for another day.
    return reportOf(drawn, date)
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
      this.#set({
        state: 'cancelled',
        stages: this.#snapshot.stages.map((s) =>
          s.state === 'running' ? { ...s, state: 'pending' as const } : s,
        ),
        report: null,
      })
      return
    }
    this.#set({
      state: 'failed',
      error: sentenceFor(reason),
      stages: this.#snapshot.stages.map((s) =>
        s.state === 'running' ? { ...s, state: 'failed' as const } : s,
      ),
      report: null,
    })
  }

  /** Cancelled between the awaits: nothing was written, and nothing is. */
  #stopped(): void {
    this.#set({
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

  #report(p: { stage: string; message: string }): void {
    const stages = advance(this.#snapshot.stages, p.stage)
    if (stages === this.#snapshot.stages) return
    const sentence = readableMessage(p.stage, p.message)
    this.#set({ stages, message: sentence ?? this.#snapshot.message })
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
