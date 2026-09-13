import {
  isEngineErrorShape,
  ERROR_CODES,
  withoutPaths,
  type EngineState,
} from '../../../shared/engine'
import type { FeedRecord, Methods } from '../../../shared/protocol'
import type { Stage } from '../ProgressLine'

// Adding one feed, with no React in it (.claude/rules/renderer.md). The
// engine downloads when the source is a URL and reports its bytes as the
// `download` stage, then checks the zip's tables as the `check` stage; a
// file needs no download, so only the check reports. A cancel lands
// between the download's chunks and leaves nothing behind (engine E09c).
// The engine's hint is what a person reads when it refuses.

export const ADD_STAGES = ['download', 'check'] as const

export interface AddSnapshot {
  state: 'idle' | 'running' | 'done' | 'failed' | 'cancelled'
  stages: Stage[]
  /** The engine's last sentence: how many bytes, or that the check passed. */
  message: string | null
  /** The engine's sentence for a person, when it refused. */
  error: string | null
  /** The feed, once added. */
  feed: FeedRecord | null
}

interface Handle<T> {
  result: Promise<T>
  onProgress(
    listener: (p: { stage: string; fraction: number; message: string }) => void,
  ): () => void
  cancel(): void
}

/** The one method this run uses, typed by the protocol. */
export interface AddClient {
  request(method: 'feeds.add', params: Methods['feeds.add']['params']): Handle<FeedRecord>
}

export type AddSource = { file: string } | { url: string }

export const freshStages = (): Stage[] =>
  ADD_STAGES.map((label) => ({ id: label, label, state: 'pending' as const }))

/**
 * The sentence a person reads for a failure: the engine's, never a path.
 * A feed refusal names the file by its name already; an I/O failure's hint
 * is "reason: path" (the engine's classify), so the path is taken out.
 */
export function sentenceFor(reason: unknown): string {
  if (isEngineErrorShape(reason)) return withoutPaths(reason.data?.hint ?? reason.message)
  return reason instanceof Error ? reason.message : 'The feed could not be added.'
}

const IDLE: AddSnapshot = {
  state: 'idle',
  stages: freshStages(),
  message: null,
  error: null,
  feed: null,
}

export class FeedAdd {
  #snapshot: AddSnapshot = IDLE
  #listeners = new Set<(s: AddSnapshot) => void>()
  #inFlight: { cancel(): void } | null = null
  readonly #client: AddClient

  constructor(client: AddClient) {
    this.#client = client
  }

  get snapshot(): AddSnapshot {
    return this.#snapshot
  }

  subscribe(listener: (s: AddSnapshot) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #set(patch: Partial<AddSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch }
    for (const listener of this.#listeners) listener(this.#snapshot)
  }

  /** Back to nothing, for the next opening of the dialog. */
  reset(): void {
    if (this.#snapshot.state === 'running') return
    this.#set(IDLE)
  }

  start(source: AddSource, engine: EngineState | null): void {
    if (this.#snapshot.state === 'running') return
    if (engine === null || engine.state !== 'ready') {
      this.#set({
        state: 'failed',
        error:
          engine === null
            ? 'The engine is still starting. Try again in a moment.'
            : `The engine is not ready to add a feed: ${engine.state}.`,
      })
      return
    }
    // A file skips the download: its first stage is the check.
    const stages = freshStages()
    const first = 'url' in source ? 0 : 1
    if (first === 1) stages[0] = { ...stages[0], state: 'done' }
    stages[first] = { ...stages[first], state: 'running' }
    this.#set({ state: 'running', stages, message: null, error: null, feed: null })

    const handle = this.#client.request('feeds.add', {
      source: 'url' in source ? source.url : source.file,
    })
    this.#inFlight = handle
    handle.onProgress((p) => this.#report(p))
    void handle.result.then(
      (feed) => {
        this.#inFlight = null
        this.#set({
          state: 'done',
          stages: this.#snapshot.stages.map((s) => ({ ...s, state: 'done' as const })),
          feed,
        })
      },
      (reason: unknown) => {
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
      },
    )
  }

  /**
   * A report names the stage that is running and how far it is; the
   * download's last report and the check's only one say a stage is done.
   */
  #report(p: { stage: string; fraction: number; message: string }): void {
    const at = this.#snapshot.stages.findIndex((s) => s.id === p.stage)
    if (at === -1) return
    const stages = this.#snapshot.stages.map((stage, i) => {
      if (i < at) return { ...stage, state: 'done' as const }
      if (i === at)
        return { ...stage, state: p.fraction >= 1 ? ('done' as const) : ('running' as const) }
      return stage
    })
    if (p.fraction >= 1 && at + 1 < stages.length)
      stages[at + 1] = { ...stages[at + 1], state: 'running' }
    this.#set({ stages, message: p.message || this.#snapshot.message })
  }

  cancel(): void {
    if (this.#snapshot.state !== 'running') return
    this.#inFlight?.cancel()
  }
}
