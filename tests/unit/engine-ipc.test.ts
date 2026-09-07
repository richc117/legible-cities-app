// The engine bridge's main side: tokens to ids and back, answers resolved
// with the error data intact, notifications forwarded to the window with
// the page's id, and only the top frame allowed through.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { registerEngineHandlers, type EngineSource } from '../../src/main/engine-ipc'
import type { Notification } from '../../src/main/sidecar'
import { CHANNELS } from '../../src/shared/api'
import { EngineError, ERROR_CODES, type EngineState } from '../../src/shared/engine'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

interface Deferred {
  resolve(value: unknown): void
  reject(error: unknown): void
}

function harness(topFrame = true) {
  const handlers = new Map<string, Handler>()
  const ipc = {
    handle: (channel: string, h: Handler) => handlers.set(channel, h),
  } as unknown as IpcMain
  const sent: { channel: string; payload: unknown }[] = []
  const log: string[] = []
  const requests: { id: number; method: string; params: unknown; deferred: Deferred }[] = []
  const cancelled: number[] = []
  let stateListener: ((s: EngineState) => void) | null = null
  let notificationListener: ((n: Notification) => void) | null = null
  let nextId = 1
  let state: EngineState = { state: 'ready', version: '0.2.0', protocol: 1 }
  const engine: EngineSource = {
    get state() {
      return state
    },
    request(method, params) {
      if (state.state !== 'ready') {
        return { id: 0, result: Promise.reject(new EngineError(ERROR_CODES.notReady, 'not ready')) }
      }
      const id = nextId++
      let deferred!: Deferred
      const result = new Promise<unknown>((resolve, reject) => {
        deferred = { resolve, reject }
      })
      requests.push({ id, method, params, deferred })
      return { id, result }
    },
    cancel: (id) => cancelled.push(id),
    onState: (l) => {
      stateListener = l
      return () => {}
    },
    onNotification: (l) => {
      notificationListener = l
      return () => {}
    },
  }
  registerEngineHandlers(
    ipc,
    engine,
    () => topFrame,
    (channel, payload) => sent.push({ channel, payload }),
    (m) => log.push(m),
  )
  const event = {} as IpcMainInvokeEvent
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(event, ...args)
  return {
    handlers,
    call,
    sent,
    log,
    requests,
    cancelled,
    setState: (s: EngineState) => {
      state = s
      stateListener?.(s)
    },
    notify: (n: Notification) => notificationListener?.(n),
  }
}

describe('registerEngineHandlers', () => {
  it('registers the three channels and nothing else', () => {
    const { handlers } = harness()
    expect([...handlers.keys()].sort()).toEqual(
      [CHANNELS.engineState, CHANNELS.engineRequest, CHANNELS.engineCancel].sort(),
    )
  })
  it('refuses a caller that is not the top frame', async () => {
    const { call, requests } = harness(false)
    await expect(call(CHANNELS.engineState)).rejects.toThrow('forbidden')
    await expect(call(CHANNELS.engineRequest, 't1', 'engine.info')).rejects.toThrow('forbidden')
    expect(requests).toEqual([])
  })
  it('answers the state and sends each change to the window', async () => {
    const { call, sent, setState } = harness()
    expect(await call(CHANNELS.engineState)).toEqual({
      state: 'ready',
      version: '0.2.0',
      protocol: 1,
    })
    setState({ state: 'restarting', attempt: 2, reason: 'it died' })
    expect(sent).toEqual([
      {
        channel: CHANNELS.engineStateChanged,
        payload: { state: 'restarting', attempt: 2, reason: 'it died' },
      },
    ])
  })
  it('accepts a request at once and settles it on the event channel with the result', async () => {
    const { call, requests, sent } = harness()
    expect(await call(CHANNELS.engineRequest, 'tok-1', 'engine.info', undefined)).toEqual({
      accepted: true,
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ id: 1, method: 'engine.info', params: undefined })
    requests[0].deferred.resolve({ engine: '0.2.0' })
    await tick()
    expect(sent).toEqual([
      {
        channel: CHANNELS.engineSettled,
        payload: { id: 'tok-1', ok: true, result: { engine: '0.2.0' } },
      },
    ])
  })
  it('settles an engine error with its code, message and data, after its notifications', async () => {
    const { call, requests, sent, notify } = harness()
    await call(CHANNELS.engineRequest, 'tok-2', 'map.build', { key: 'x' })
    notify({
      method: 'job/progress',
      params: { id: 1, stage: 'topo', fraction: 0.5, message: 'm' },
    })
    const data = { kind: 'params', detail: 'date is required', hint: 'date is required' }
    requests[0].deferred.reject(new EngineError(-32602, 'date is required', data))
    await tick()
    expect(sent.map((m) => m.channel)).toEqual([CHANNELS.engineProgress, CHANNELS.engineSettled])
    expect(sent[1].payload).toEqual({
      id: 'tok-2',
      ok: false,
      error: { code: -32602, message: 'date is required', data },
    })
  })
  it('refuses a bad call before the engine sees it', async () => {
    const { call, requests } = harness()
    for (const args of [
      [undefined, 'engine.info'],
      ['../x', 'engine.info'],
      ['tok', ''],
      ['tok', 7],
      ['tok', 'engine.info', 'not-an-object'],
      ['tok', 'engine.info', [1]],
    ]) {
      const answer = (await call(CHANNELS.engineRequest, ...args)) as {
        accepted: boolean
        error?: { code: number }
      }
      expect(answer.accepted).toBe(false)
      expect(answer.error?.code).toBe(ERROR_CODES.badCall)
    }
    expect(requests).toEqual([])
  })
  it('refuses a token already in flight, and frees it when the request settles', async () => {
    const { call, requests, sent } = harness()
    await call(CHANNELS.engineRequest, 'same', 'graph.build', { key: 'x' })
    const dup = (await call(CHANNELS.engineRequest, 'same', 'graph.build', { key: 'x' })) as {
      accepted: boolean
    }
    expect(dup.accepted).toBe(false)
    requests[0].deferred.resolve('done')
    await tick()
    expect(await call(CHANNELS.engineRequest, 'same', 'graph.build', { key: 'x' })).toEqual({
      accepted: true,
    })
    expect(requests).toHaveLength(2)
    requests[1].deferred.resolve('done again')
    await tick()
    expect(sent.filter((m) => m.channel === CHANNELS.engineSettled).map((m) => m.payload)).toEqual([
      { id: 'same', ok: true, result: 'done' },
      { id: 'same', ok: true, result: 'done again' },
    ])
  })
  it('passes a refusal from the supervisor through as a settled error', async () => {
    const { call, setState, sent } = harness()
    setState({ state: 'unavailable', reason: 'no engine' })
    expect(await call(CHANNELS.engineRequest, 'tok', 'engine.info')).toEqual({ accepted: true })
    await tick()
    const settled = sent.find((m) => m.channel === CHANNELS.engineSettled)
    expect(settled?.payload).toMatchObject({
      id: 'tok',
      ok: false,
      error: { code: ERROR_CODES.notReady },
    })
  })
  it('cancels by token and ignores an unknown one', async () => {
    const { call, requests, cancelled, sent } = harness()
    await call(CHANNELS.engineRequest, 'tok-c', 'graph.build', { key: 'x' })
    await call(CHANNELS.engineCancel, 'tok-c')
    await call(CHANNELS.engineCancel, 'nope')
    await call(CHANNELS.engineCancel, 42)
    expect(cancelled).toEqual([1])
    requests[0].deferred.reject(new EngineError(-32800, 'Request Cancelled'))
    await tick()
    expect(sent.at(-1)?.payload).toEqual({
      id: 'tok-c',
      ok: false,
      error: { code: -32800, message: 'Request Cancelled' },
    })
  })
  it('forwards progress and log lines with the page token, and drops the rest', async () => {
    const { call, requests, sent, notify, log } = harness()
    await call(CHANNELS.engineRequest, 'tok-p', 'graph.build', { key: 'x' })
    notify({ method: 'job/log', params: { id: 1, level: 'info', line: 'topo: running' } })
    notify({
      method: 'job/progress',
      params: { id: 1, stage: 'topo', fraction: 0.5, message: 'm' },
    })
    notify({
      method: 'job/progress',
      params: { id: 99, stage: 'topo', fraction: 0.5, message: 'm' },
    })
    notify({ method: 'job/progress', params: { id: 1, stage: 'topo' } })
    notify({ method: 'job/other', params: { id: 1 } })
    expect(sent).toEqual([
      {
        channel: CHANNELS.engineLog,
        payload: { id: 'tok-p', level: 'info', line: 'topo: running' },
      },
      {
        channel: CHANNELS.engineProgress,
        payload: { id: 'tok-p', stage: 'topo', fraction: 0.5, message: 'm' },
      },
    ])
    expect(log.filter((l) => l.includes('unexpected shape'))).toHaveLength(2)
    requests[0].deferred.resolve('ok')
    await tick()
    notify({ method: 'job/progress', params: { id: 1, stage: 'late', fraction: 1, message: 'm' } })
    expect(sent).toHaveLength(3)
    expect(sent[2].channel).toBe(CHANNELS.engineSettled)
  })
})
