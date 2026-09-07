// The engine bridge's main side: three handlers over the supervisor and
// three events to the window. The page addresses a request by a token it
// minted; this layer maps it to the id the engine saw and back, so a
// notification reaches the page with the page's own id. An answer is
// always resolved, never rejected: a rejection loses its data on the way
// through Electron, and the engine's error data is the point.
// Contract: specs/004-sidecar-supervisor/contracts/bridge.md.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from '../shared/api'
import {
  EngineError,
  ERROR_CODES,
  type EngineErrorShape,
  type EngineState,
  type JobLog,
  type JobProgress,
} from '../shared/engine'
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

export type Answer = { ok: true; result: unknown } | { ok: false; error: EngineErrorShape }

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const TOKEN = /^[A-Za-z0-9-]{1,64}$/
const LEVELS = new Set(['debug', 'info', 'warning', 'error'])

function badCall(what: string): Answer {
  return {
    ok: false,
    error: new EngineError(ERROR_CODES.badCall, what, {
      kind: 'params',
      detail: what,
      hint: what,
    }).toJSON(),
  }
}

function toShape(error: unknown): EngineErrorShape {
  if (error instanceof EngineError) return error.toJSON()
  const message = error instanceof Error ? error.message : String(error)
  return { code: -32603, message }
}

export function registerEngineHandlers(
  ipcMain: IpcMain,
  engine: EngineSource,
  isTopFrame: (event: IpcMainInvokeEvent) => boolean,
  send: Send,
  log: (message: string) => void,
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

  handle(CHANNELS.engineRequest, async (token, method, params): Promise<Answer> => {
    if (typeof token !== 'string' || !TOKEN.test(token)) return badCall('a request needs an id')
    if (typeof method !== 'string' || method === '') return badCall('a request needs a method name')
    if (params !== undefined && !isObject(params)) return badCall('parameters must be an object')
    if (idOf.has(token)) return badCall('a request with this id is already running')
    const { id, result } = engine.request(method, params as Record<string, unknown> | undefined)
    if (id !== 0) {
      idOf.set(token, id)
      tokenOf.set(id, token)
    }
    try {
      return { ok: true, result: await result }
    } catch (error) {
      return { ok: false, error: toShape(error) }
    } finally {
      idOf.delete(token)
      tokenOf.delete(id)
    }
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
