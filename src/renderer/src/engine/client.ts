// The one way app code asks the engine something.
//
// The bridge underneath (A1-01) takes a method name and an object and
// answers with `unknown`, deliberately: it is transport, and it should not
// know what the engine's methods are. This is the layer that does. Every
// method, its parameters and its result come from `src/shared/protocol.ts`,
// which is generated from the engine's own description of itself, so a
// change on the engine's side that the app has not followed is a build
// error here rather than a refused request in front of a person.
//
// The client tightens nothing and relaxes nothing: it is a projection of
// the description. Contract:
// specs/006-typed-engine-client/contracts/client.md.

import type { JobLog, JobProgress } from '../../../shared/engine'
import type { Method, Methods } from '../../../shared/protocol'

export type Params<M extends Method> = Methods[M]['params']
export type Result<M extends Method> = Methods[M]['result']

/**
 * The parameters of a call, as an argument list. A method whose parameters
 * are `NoParams` is called with none; every other method must pass its
 * object, and the compiler refuses a call that forgets.
 */
export type Args<M extends Method> =
  null extends Params<M> ? [params?: Params<M>] : [params: Params<M>]

/** What the bridge gives us. Narrower than `window.api.engine` on purpose:
 *  a test passes a stub, and the client cannot reach anything else. */
export interface EngineBridge {
  request(
    method: string,
    params?: Record<string, unknown>,
  ): { id: string; result: Promise<unknown> }
  cancel(id: string): Promise<void>
  onProgress(listener: (progress: JobProgress) => void): () => void
  onLog(listener: (line: JobLog) => void): () => void
}

/** A request in flight: its answer, its own notifications, and cancellation. */
export interface RequestHandle<T> {
  /** The token the bridge minted for this request, not the engine's numbering. */
  readonly id: string
  /** The engine's result, or a rejection carrying its error unchanged. */
  readonly result: Promise<T>
  onProgress(listener: (progress: JobProgress) => void): () => void
  onLog(listener: (line: JobLog) => void): () => void
  /** Ask the engine to stop. After the request has settled this does nothing. */
  cancel(): void
}

type Listeners = { progress: Set<(p: JobProgress) => void>; log: Set<(l: JobLog) => void> }

export class EngineClient {
  readonly #bridge: EngineBridge
  readonly #inFlight = new Map<string, Listeners>()
  readonly #offProgress: () => void
  readonly #offLog: () => void
  #disposed = false

  constructor(bridge: EngineBridge) {
    this.#bridge = bridge
    // One subscription each, fanned out by token. The bridge already
    // delivers a request's answer after its last notification, on the same
    // ordered channel (specs/004 research §1); nothing here may disturb
    // that, which is why a request's listeners are released when its
    // promise settles and not a moment earlier.
    this.#offProgress = bridge.onProgress((progress) => {
      for (const listener of this.#inFlight.get(progress.id)?.progress ?? []) listener(progress)
    })
    this.#offLog = bridge.onLog((line) => {
      for (const listener of this.#inFlight.get(line.id)?.log ?? []) listener(line)
    })
  }

  request<M extends Method>(method: M, ...args: Args<M>): RequestHandle<Result<M>> {
    // A disposed client has released the subscriptions it fans out from, so
    // a request through it would answer and never report a stage. Saying so
    // is better than being quietly deaf.
    if (this.#disposed) throw new Error('This EngineClient has been disposed.')
    const params = args[0]
    const sent = this.#bridge.request(
      method,
      params === null || params === undefined ? undefined : (params as Record<string, unknown>),
    )
    const listeners: Listeners = { progress: new Set(), log: new Set() }
    this.#inFlight.set(sent.id, listeners)

    let settled = false
    const release = (): void => {
      settled = true
      listeners.progress.clear()
      listeners.log.clear()
      this.#inFlight.delete(sent.id)
    }
    const result = sent.result.then(
      (value) => {
        release()
        return value as Result<M>
      },
      (error: unknown) => {
        release()
        throw error
      },
    )

    return {
      id: sent.id,
      result,
      onProgress: (listener) => {
        if (settled) return () => {}
        listeners.progress.add(listener)
        return () => listeners.progress.delete(listener)
      },
      onLog: (listener) => {
        if (settled) return () => {}
        listeners.log.add(listener)
        return () => listeners.log.delete(listener)
      },
      cancel: () => {
        if (settled) return
        void this.#bridge.cancel(sent.id).catch(() => {
          // The bridge refuses an id it does not know, which is what a race
          // between cancelling and settling looks like. The request's own
          // promise carries the outcome; there is nothing to report here.
        })
      },
    }
  }

  /** Release the two global subscriptions. For a test, and for a caller
   *  that owns a client's lifetime. Requests in flight keep their promises. */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#offProgress()
    this.#offLog()
    this.#inFlight.clear()
  }
}
