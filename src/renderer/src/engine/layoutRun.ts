import { LAYOUT_STAGES, type RunState } from '../../../shared/layout'
import { isEngineErrorShape, ERROR_CODES, type EngineState } from '../../../shared/engine'
import type { ProjectRecord } from '../../../shared/project'
import type { Methods } from '../../../shared/protocol'
import type { Stage } from '../ProgressLine'

// One layout run for one project, with no React in it: the rule is that
// logic lives in something callable without rendering, and the tests are
// what that buys (.claude/rules/renderer.md).
//
// The sequence is contracts/run.md's. Ask the engine for the layout, which
// answers with the layout's id and the stage graphs' paths; then for the
// map from that id, which writes the page where the app already serves a
// project's output. Both report a stage only when it has finished, so a
// report marks its own stage done and the next one running, and the
// sentence on screen always describes the last stage to finish rather than
// the one being waited for. The map call repeats the four layout stages; a
// repeat for a stage already done is ignored. Nothing is written until
// both calls have returned, and what is written is the engine's id.

export interface RunSnapshot {
  state: RunState
  stages: Stage[]
  /** The engine's sentence for the last stage that finished. */
  message: string | null
  /** The engine's sentence for a person, when the run failed. */
  error: string | null
  /** Set when the layout's id differs from the one the project had stored. */
  changed: boolean
  /** Set when the run was a re-layout: every stage run again on purpose. */
  forced: boolean
  /**
   * Set when a re-layout stopped after the engine had already replaced the
   * stored layout but before the map was drawn from it: the project's id
   * still names the layout, the layout is new, and the page on screen is
   * the old map until the next run draws it.
   */
  replaced: boolean
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
export type RunMethod = 'graph.build' | 'map.build'

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
  complete(id: string, done: { date: string; layout: string }): Promise<{ changed: boolean }>
  /** The day a project without one is given; injected so a test can fix it. */
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
  forced: false,
  replaced: false,
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

    if (engine === null || engine.state !== 'ready') {
      this.#set({
        state: 'failed',
        error:
          engine === null
            ? 'The engine is still starting. Try again in a moment.'
            : `The engine is not ready to run a layout: ${engine.state}.`,
      })
      return
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
      forced: force,
      replaced: false,
    })

    const date = project.date ?? today()
    void (async () => {
      try {
        // The registry entry's mode and agency apply: choosing them per
        // project is A2-02's, and until then the record's are placeholders.
        const layout = client.request(
          'graph.build',
          force ? { key: project.feed, force } : { key: project.feed },
        )
        this.#inFlight = layout
        layout.onProgress((p) => this.#report(p))
        const built = await layout.result
        // A forced layout call that has answered has already replaced the
        // stored set; whatever happens from here, the screen must say so.
        if (force) this.#set({ replaced: true })
        // The handle's cancel is a no-op once its request has settled, so a
        // cancel that lands between the two calls, or while the record is
        // being written, is caught here instead.
        if (this.#cancelled) return this.#stopped()

        // The map is drawn from the layout just answered, by its id; the
        // engine never lays out on the way to a map.
        const map = client.request('map.build', {
          key: project.feed,
          layout: built.layout,
          date,
          out: project.id,
        })
        this.#inFlight = map
        map.onProgress((p) => this.#report(p))
        await map.result
        this.#inFlight = null
        if (this.#cancelled) return this.#stopped()

        const written = await complete(project.id, { date, layout: built.layout })
        this.#set({
          state: 'done',
          stages: this.#snapshot.stages.map((s) => ({ ...s, state: 'done' as const })),
          changed: written.changed,
          replaced: false,
        })
      } catch (reason) {
        this.#inFlight = null
        if (isEngineErrorShape(reason) && reason.code === ERROR_CODES.cancelled) {
          this.#set({
            state: 'cancelled',
            stages: this.#snapshot.stages.map((s) =>
              s.state === 'running' ? { ...s, state: 'pending' as const } : s,
            ),
          })
          return
        }
        this.#set({
          state: 'failed',
          error: sentenceFor(reason),
          stages: this.#snapshot.stages.map((s) =>
            s.state === 'running' ? { ...s, state: 'failed' as const } : s,
          ),
        })
      }
    })()
  }

  /** Cancelled between the awaits: nothing was written, and nothing is. */
  #stopped(): void {
    this.#set({
      state: 'cancelled',
      stages: this.#snapshot.stages.map((s) =>
        s.state === 'running' ? { ...s, state: 'pending' as const } : s,
      ),
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
