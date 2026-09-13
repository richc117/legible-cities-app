// The engine bridge's main side: three handlers over the supervisor and
// four events to the window. The page addresses a request by a token it
// minted; this layer maps it to the id the engine saw and back, so a
// notification reaches the page with the page's own id. A request's answer
// travels as an event too, on the same channel as its progress and log
// lines and after them, because an invoke reply is not ordered against
// events and the page must never see a result before the last progress.
// Contract: specs/004-sidecar-supervisor/contracts/bridge.md.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { CHANNELS, type EngineAccepted, type EngineSettled } from '../shared/api'
import type { EngineState, JobLog, JobProgress } from '../shared/engine'
import { badCall, isObject, TOKEN, toShape } from './ipc-shape'
import type { Notification } from './sidecar'

/** What the handlers need from the supervisor; a test hands in a fake. */
export interface EngineSource {
  readonly state: EngineState
  request(
    method: string,
    params?: Record<string, unknown>,
  ): { id: number; result: Promise<unknown> }
  cancel(id: number): void
  onState(listener: (state: EngineState) => void): () => void
  onNotification(listener: (n: Notification) => void): () => void
}

export type Send = (channel: string, payload: unknown) => void

/** A refusal before the engine sees a request: null lets it through, a sentence stops it. */
export type Guard = (
  method: string,
  params: Record<string, unknown> | undefined,
) => Promise<string | null>

const LEVELS = new Set(['debug', 'info', 'warning', 'error'])

export function registerEngineHandlers(
  ipcMain: IpcMain,
  engine: EngineSource,
  isTopFrame: (event: IpcMainInvokeEvent) => boolean,
  send: Send,
  log: (message: string) => void,
  guard: Guard = async () => null,
): () => void {
  const idOf = new Map<string, number>()
  const tokenOf = new Map<number, string>()

  const handle = (channel: string, handler: (...args: unknown[]) => Promise<unknown>): void => {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (!isTopFrame(event)) throw new Error('forbidden')
      return handler(...args)
    })
  }

  handle(CHANNELS.engineState, async () => engine.state)

  handle(CHANNELS.engineRequest, async (token, method, params): Promise<EngineAccepted> => {
    if (typeof token !== 'string' || !TOKEN.test(token)) return badCall('a request needs an id')
    if (typeof method !== 'string' || method === '') return badCall('a request needs a method name')
    if (params !== undefined && !isObject(params)) return badCall('parameters must be an object')
    if (idOf.has(token)) return badCall('a request with this id is already running')
    // The token is taken before the guard's await, so a second invoke with
    // the same token during it is refused rather than reaching the engine
    // twice with one map entry between them.
    idOf.set(token, 0)
    // The gate: what may be asked of the registry on a person's behalf is
    // decided here, with what the main process knows (the paths its own
    // chooser answered, the feeds its projects name), never on the page.
    const refused = await guard(method, params as Record<string, unknown> | undefined)
    if (refused !== null) {
      idOf.delete(token)
      return badCall(refused)
    }
    const { id, result } = engine.request(method, params as Record<string, unknown> | undefined)
    if (id !== 0) {
      idOf.set(token, id)
      tokenOf.set(id, token)
    } else {
      idOf.delete(token)
    }
    // Settle on the event channel, after every notification for the id.
    result.then(
      (value) => {
        const settled: EngineSettled = { id: token, ok: true, result: value }
        send(CHANNELS.engineSettled, settled)
      },
      (error: unknown) => {
        const settled: EngineSettled = { id: token, ok: false, error: toShape(error) }
        send(CHANNELS.engineSettled, settled)
      },
    )
    void result
      .finally(() => {
        idOf.delete(token)
        tokenOf.delete(id)
      })
      .catch(() => {})
    return { accepted: true }
  })

  handle(CHANNELS.engineCancel, async (token) => {
    if (typeof token !== 'string') return
    const id = idOf.get(token)
    if (id !== undefined) engine.cancel(id)
  })

  const offState = engine.onState((state) => send(CHANNELS.engineStateChanged, state))
  const offNotifications = engine.onNotification(({ method, params }) => {
    if (!isObject(params) || typeof params.id !== 'number') return
    const token = tokenOf.get(params.id)
    if (token === undefined) return
    if (
      method === 'job/progress' &&
      typeof params.stage === 'string' &&
      typeof params.fraction === 'number' &&
      typeof params.message === 'string'
    ) {
      const progress: JobProgress = {
        id: token,
        stage: params.stage,
        fraction: params.fraction,
        message: params.message,
      }
      send(CHANNELS.engineProgress, progress)
    } else if (
      method === 'job/log' &&
      typeof params.level === 'string' &&
      LEVELS.has(params.level) &&
      typeof params.line === 'string'
    ) {
      const line: JobLog = { id: token, level: params.level as JobLog['level'], line: params.line }
      send(CHANNELS.engineLog, line)
    } else {
      log(`dropped a ${method} notification of an unexpected shape`)
    }
  })
  return () => {
    offState()
    offNotifications()
  }
}
