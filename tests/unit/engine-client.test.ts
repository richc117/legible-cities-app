// The typed client against a stub bridge: what it routes, what it releases
// and what it refuses to do twice. No Electron, no engine; the bridge is an
// interface the client takes in its constructor exactly so this is possible.

import { describe, expect, it, vi } from 'vitest'
import { EngineClient, type EngineBridge } from '../../src/renderer/src/engine/client'
import type { JobLog, JobProgress } from '../../src/shared/engine'

interface Deferred {
  resolve(value: unknown): void
  reject(error: unknown): void
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function stub() {
  const sent: { id: string; method: string; params?: Record<string, unknown> }[] = []
  const cancelled: string[] = []
  const deferred = new Map<string, Deferred>()
  let progress: ((p: JobProgress) => void) | null = null
  let log: ((l: JobLog) => void) | null = null
  let offProgress = 0
  let offLog = 0
  let next = 1

  const bridge: EngineBridge = {
    request(method, params) {
      const id = `tok-${next++}`
      sent.push({ id, method, params })
      const result = new Promise<unknown>((resolve, reject) => {
        deferred.set(id, { resolve, reject })
      })
      return { id, result }
    },
    cancel: async (id) => {
      cancelled.push(id)
    },
    onProgress: (listener) => {
      progress = listener
      return () => {
        offProgress++
      }
    },
    onLog: (listener) => {
      log = listener
      return () => {
        offLog++
      }
    },
  }

  return {
    bridge,
    sent,
    cancelled,
    settle: (id: string, value: unknown) => deferred.get(id)!.resolve(value),
    fail: (id: string, error: unknown) => deferred.get(id)!.reject(error),
    emitProgress: (p: JobProgress) => progress?.(p),
    emitLog: (l: JobLog) => log?.(l),
    unsubscribes: () => ({ progress: offProgress, log: offLog }),
  }
}

const progressFor = (id: string, stage = 'topo'): JobProgress => ({
  id,
  stage,
  fraction: 0.5,
  message: `${stage} running`,
})

describe('EngineClient.request', () => {
  it('sends the method and its parameters, and resolves with the result', async () => {
    const s = stub()
    const client = new EngineClient(s.bridge)
    const handle = client.request('graph.build', { key: 'la-metro-rail' })
    expect(s.sent).toEqual([
      { id: 'tok-1', method: 'graph.build', params: { key: 'la-metro-rail' } },
    ])
    expect(handle.id).toBe('tok-1')
    const answer = { stages: {}, paths: {} }
    s.settle('tok-1', answer)
    await expect(handle.result).resolves.toBe(answer)
  })

  it('sends no parameters for a method that takes none', () => {
    const s = stub()
    new EngineClient(s.bridge).request('engine.info')
    expect(s.sent[0]).toEqual({ id: 'tok-1', method: 'engine.info', params: undefined })
  })

  it('sends no parameters when null is passed for one that takes none', () => {
    const s = stub()
    new EngineClient(s.bridge).request('engine.shutdown', null)
    expect(s.sent[0].params).toBeUndefined()
  })

  it('rejects with the engine error unchanged, code, message and data', async () => {
    const s = stub()
    const client = new EngineClient(s.bridge)
    const handle = client.request('map.build', {
      key: 'la',
      layout: 'a'.repeat(64),
      date: '2026-09-07',
    })
    const error = {
      code: -32602,
      message: 'date is required',
      data: { kind: 'params', detail: 'date is required', hint: 'Choose a service day.' },
    }
    s.fail('tok-1', error)
    await expect(handle.result).rejects.toBe(error)
  })
})

describe('notifications reach their own request and nothing else', () => {
  it('routes progress and log by token', () => {
    const s = stub()
    const client = new EngineClient(s.bridge)
    const first = client.request('graph.build', { key: 'a' })
    const second = client.request('graph.build', { key: 'b' })
    const heard: string[] = []
    first.onProgress((p) => heard.push(`first:${p.stage}`))
    second.onProgress((p) => heard.push(`second:${p.stage}`))
    first.onLog((l) => heard.push(`first-log:${l.line}`))

    s.emitProgress(progressFor(first.id, 'topo'))
    s.emitProgress(progressFor(second.id, 'loom'))
    s.emitLog({ id: first.id, level: 'info', line: 'one' })
    s.emitLog({ id: second.id, level: 'info', line: 'two' })
    s.emitProgress(progressFor('tok-nobody', 'octi'))

    expect(heard).toEqual(['first:topo', 'second:loom', 'first-log:one'])
  })

  it('calls every listener a request has, and unsubscribing one leaves the other', () => {
    const s = stub()
    const handle = new EngineClient(s.bridge).request('graph.build', { key: 'a' })
    const one = vi.fn()
    const two = vi.fn()
    const offOne = handle.onProgress(one)
    handle.onProgress(two)
    s.emitProgress(progressFor(handle.id))
    offOne()
    s.emitProgress(progressFor(handle.id))
    expect(one).toHaveBeenCalledTimes(1)
    expect(two).toHaveBeenCalledTimes(2)
  })

  it('releases a request listeners when it settles, and not before', async () => {
    const s = stub()
    const client = new EngineClient(s.bridge)
    const handle = client.request('graph.build', { key: 'a' })
    const listener = vi.fn()
    handle.onProgress(listener)
    s.emitProgress(progressFor(handle.id))
    s.settle(handle.id, { stages: {}, paths: {} })
    await handle.result
    s.emitProgress(progressFor(handle.id))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('releases them when the request fails too', async () => {
    const s = stub()
    const handle = new EngineClient(s.bridge).request('graph.build', { key: 'a' })
    const listener = vi.fn()
    handle.onLog(listener)
    s.fail(handle.id, { code: -32000, message: 'no' })
    await expect(handle.result).rejects.toBeDefined()
    s.emitLog({ id: handle.id, level: 'error', line: 'late' })
    expect(listener).not.toHaveBeenCalled()
  })

  it('never calls a listener added after the request settled, and leaks nothing', async () => {
    const s = stub()
    const handle = new EngineClient(s.bridge).request('engine.info')
    s.settle(handle.id, { engine: '0.2.0', protocol: 1 })
    await handle.result
    const listener = vi.fn()
    const off = handle.onProgress(listener)
    s.emitProgress(progressFor(handle.id))
    expect(listener).not.toHaveBeenCalled()
    expect(() => off()).not.toThrow()
  })
})

describe('cancellation', () => {
  it('forwards the token once', () => {
    const s = stub()
    const handle = new EngineClient(s.bridge).request('graph.build', { key: 'a' })
    handle.cancel()
    expect(s.cancelled).toEqual([handle.id])
  })

  it('does nothing after the request has settled, and does not throw', async () => {
    const s = stub()
    const handle = new EngineClient(s.bridge).request('graph.build', { key: 'a' })
    s.settle(handle.id, { stages: {}, paths: {} })
    await handle.result
    expect(() => handle.cancel()).not.toThrow()
    expect(s.cancelled).toEqual([])
  })

  // User Story 3, scenario 2: the request ends with the engine's cancelled
  // error and its subscriptions go with it.
  it('ends with the cancelled error and releases the subscriptions', async () => {
    const s = stub()
    const handle = new EngineClient(s.bridge).request('graph.build', { key: 'a' })
    const listener = vi.fn()
    handle.onProgress(listener)
    s.emitProgress(progressFor(handle.id))
    handle.cancel()
    const cancelled = { code: -32800, message: 'Request Cancelled' }
    s.fail(handle.id, cancelled)
    await expect(handle.result).rejects.toBe(cancelled)
    s.emitProgress(progressFor(handle.id, 'late'))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('swallows a bridge that refuses the token, because the promise carries the outcome', async () => {
    const s = stub()
    const bridge: EngineBridge = { ...s.bridge, cancel: () => Promise.reject(new Error('unknown')) }
    const handle = new EngineClient(bridge).request('graph.build', { key: 'a' })
    expect(() => handle.cancel()).not.toThrow()
    await tick()
  })
})

describe('dispose', () => {
  it('refuses a request afterwards rather than answering without progress', () => {
    const s = stub()
    const client = new EngineClient(s.bridge)
    client.dispose()
    expect(() => client.request('engine.info')).toThrow(/disposed/i)
    expect(s.sent).toEqual([])
  })

  it('is safe to call twice', () => {
    const s = stub()
    const client = new EngineClient(s.bridge)
    client.dispose()
    client.dispose()
    expect(s.unsubscribes()).toEqual({ progress: 1, log: 1 })
  })

  it('releases both global subscriptions', () => {
    const s = stub()
    const client = new EngineClient(s.bridge)
    expect(s.unsubscribes()).toEqual({ progress: 0, log: 0 })
    client.dispose()
    expect(s.unsubscribes()).toEqual({ progress: 1, log: 1 })
  })

  it('stops routing afterwards without disturbing a promise in flight', async () => {
    const s = stub()
    const client = new EngineClient(s.bridge)
    const handle = client.request('graph.build', { key: 'a' })
    const listener = vi.fn()
    handle.onProgress(listener)
    client.dispose()
    s.emitProgress(progressFor(handle.id))
    expect(listener).not.toHaveBeenCalled()
    s.settle(handle.id, { stages: {}, paths: {} })
    await expect(handle.result).resolves.toBeDefined()
  })
})
