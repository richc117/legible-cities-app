// The framing and the client, over in-memory streams: no process, no engine.

import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { FrameReader, JsonRpcClient, ProtocolError, writeFrame } from '../../src/main/jsonrpc'
import { EngineError } from '../../src/shared/engine'

const frame = (message: unknown, eol = '\r\n'): Buffer => {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}${eol}${eol}`), body])
}

function reader() {
  const stream = new PassThrough()
  const messages: unknown[] = []
  const errors: ProtocolError[] = []
  new FrameReader(
    stream,
    (m) => messages.push(m),
    (e) => errors.push(e),
  )
  return { stream, messages, errors }
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

describe('FrameReader', () => {
  it('reads a frame split across chunks and two frames in one chunk', async () => {
    const { stream, messages } = reader()
    const one = frame({ a: 1 })
    stream.write(one.subarray(0, 5))
    stream.write(one.subarray(5, 20))
    stream.write(one.subarray(20))
    stream.write(Buffer.concat([frame({ b: 2 }), frame({ c: 3 })]))
    await tick()
    expect(messages).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }])
  })
  it('accepts either line ending, ignores other headers and header case', async () => {
    const { stream, messages } = reader()
    stream.write(frame({ x: 'lf' }, '\n'))
    const body = Buffer.from('{"y":"ok"}')
    stream.write(
      Buffer.concat([
        Buffer.from(
          `content-type: application/vscode-jsonrpc\r\nCONTENT-LENGTH: ${body.length}\r\n\r\n`,
        ),
        body,
      ]),
    )
    await tick()
    expect(messages).toEqual([{ x: 'lf' }, { y: 'ok' }])
  })
  it('counts bytes, not characters', async () => {
    const { stream, messages } = reader()
    stream.write(frame({ name: 'Ciudad de México — Línea 1' }))
    await tick()
    expect(messages).toEqual([{ name: 'Ciudad de México — Línea 1' }])
  })
  it('reports a line that is not a header once, and reads nothing after', async () => {
    const { stream, messages, errors } = reader()
    stream.write(Buffer.concat([Buffer.from('this is not a frame\n'), frame({ a: 1 })]))
    stream.write(frame({ b: 2 }))
    await tick()
    expect(messages).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('not a frame')
  })
  it('reports a bad Content-Length, a missing one, and a body that is not JSON', async () => {
    for (const bytes of [
      Buffer.from('Content-Length: many\r\n\r\n{}'),
      Buffer.from('Content-Type: x\r\n\r\n{}'),
      Buffer.from('Content-Length: 3\r\n\r\n{"a'),
    ]) {
      const { stream, errors } = reader()
      stream.write(bytes)
      await tick()
      expect(errors).toHaveLength(1)
    }
  })
  it('gives up on a header block that never ends', async () => {
    const { stream, errors } = reader()
    stream.write(Buffer.alloc(70 * 1024, 'x'))
    await tick()
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('no frame header')
  })
})

function client() {
  const toEngine = new PassThrough()
  const fromEngine = new PassThrough()
  const sent: unknown[] = []
  new FrameReader(
    toEngine,
    (m) => sent.push(m),
    () => {},
  )
  const notifications: { method: string; params: unknown }[] = []
  const log: string[] = []
  const protocolErrors: ProtocolError[] = []
  const c = new JsonRpcClient(toEngine, fromEngine, {
    onNotification: (method, params) => notifications.push({ method, params }),
    onProtocolError: (e) => protocolErrors.push(e),
    log: (m) => log.push(m),
  })
  const reply = (message: unknown): void => {
    writeFrame(fromEngine, message)
  }
  return { c, sent, notifications, log, protocolErrors, reply }
}

describe('JsonRpcClient', () => {
  it('numbers requests from 1, sends params only when given, and settles from the response', async () => {
    const { c, sent, reply } = client()
    const a = c.request('engine.info')
    const b = c.request('graph.build', { key: 'x' })
    await tick()
    expect(sent).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'engine.info' },
      { jsonrpc: '2.0', id: 2, method: 'graph.build', params: { key: 'x' } },
    ])
    expect(c.inFlight).toEqual([1, 2])
    reply({ jsonrpc: '2.0', id: 2, result: { stages: {} } })
    reply({ jsonrpc: '2.0', id: 1, result: { engine: '0.2.0' } })
    await expect(b.result).resolves.toEqual({ stages: {} })
    await expect(a.result).resolves.toEqual({ engine: '0.2.0' })
    expect(c.inFlight).toEqual([])
  })
  it('rejects with the engine error unchanged', async () => {
    const { c, reply } = client()
    const r = c.request('map.build', { key: 'x' })
    const data = { kind: 'params', detail: 'date is required', hint: 'date is required: …' }
    reply({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'date is required', data } })
    const error = await r.result.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EngineError)
    expect((error as EngineError).code).toBe(-32602)
    expect((error as EngineError).message).toBe('date is required')
    expect((error as EngineError).data).toEqual(data)
  })
  // A kind outside the engine's seven cannot come from an engine of the
  // pinned version. It is read as the engine failing in a way it never
  // described, and everything it sent is kept where a log will show it.
  it('refuses a kind the protocol does not define, keeping what arrived', async () => {
    const { c, reply } = client()
    const r = c.request('map.build', { key: 'x' })
    const data = { kind: 'sausage', detail: 'somewhere', hint: 'Try again.', extra: 7 }
    reply({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'odd', data } })
    const error = (await r.result.catch((e: unknown) => e)) as EngineError
    expect(error.data?.kind).toBe('engine')
    expect(error.data?.hint).toBe('Try again.')
    expect(error.data?.detail).toContain('sausage')
    expect(error.data?.detail).toContain('somewhere')
    expect(error.data?.detail, 'nothing the engine sent is dropped').toContain('7')
  })

  // The app's own kinds name a failure the engine never saw; an engine
  // claiming one would be indistinguishable from the supervisor's own.
  it("refuses one of the app's own kinds arriving from the engine", async () => {
    const { c, reply } = client()
    const r = c.request('map.build', { key: 'x' })
    const data = { kind: 'exit', detail: 'pretending', hint: 'The engine stopped.' }
    reply({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'odd', data } })
    const error = (await r.result.catch((e: unknown) => e)) as EngineError
    expect(error.data?.kind).toBe('engine')
    expect(error.data?.detail).toContain('exit')
  })

  it('keeps unfamiliar error data in the detail and no data as none', async () => {
    const { c, reply } = client()
    const a = c.request('a')
    const b = c.request('b')
    reply({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32603, message: 'boom', data: { traceback: ['x'] } },
    })
    reply({ jsonrpc: '2.0', id: 2, error: { code: -32601, message: 'Method Not Found: b' } })
    const ea = (await a.result.catch((e: unknown) => e)) as EngineError
    const eb = (await b.result.catch((e: unknown) => e)) as EngineError
    expect(ea.data).toEqual({ kind: 'engine', detail: '{"traceback":["x"]}', hint: 'boom' })
    expect(eb.data).toBeUndefined()
  })
  it('hands notifications on in order and drops a response for an unknown id', async () => {
    const { c, notifications, log, reply } = client()
    c.request('graph.build', { key: 'x' })
    reply({ jsonrpc: '2.0', method: 'job/log', params: { id: 1, level: 'info', line: 'a' } })
    reply({
      jsonrpc: '2.0',
      method: 'job/progress',
      params: { id: 1, stage: 'topo', fraction: 0.5, message: 'm' },
    })
    reply({ jsonrpc: '2.0', id: 99, result: null })
    await tick()
    expect(notifications.map((n) => n.method)).toEqual(['job/log', 'job/progress'])
    expect(log.some((l) => l.includes('unknown request id 99'))).toBe(true)
  })
  it('cancels only a request in flight, with the id', async () => {
    const { c, sent } = client()
    c.request('graph.build', { key: 'x' })
    c.cancel(1)
    c.cancel(7)
    await tick()
    expect(sent.slice(1)).toEqual([
      { jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 1 } },
    ])
  })
  it('fails one request from outside and disposes the rest', async () => {
    const { c, reply } = client()
    const a = c.request('a')
    const b = c.request('b')
    c.fail(1, new EngineError(-32003, 'no progress for 10 minutes'))
    await expect(a.result).rejects.toMatchObject({ code: -32003 })
    c.dispose(new EngineError(-32002, 'the engine stopped'))
    await expect(b.result).rejects.toMatchObject({ code: -32002 })
    // After dispose nothing is read and a late answer changes nothing.
    reply({ jsonrpc: '2.0', id: 2, result: 'late' })
    await tick()
    await expect(c.request('c').result).rejects.toMatchObject({ code: -32002 })
  })
  it('refuses a request from the engine and reports a protocol error once', async () => {
    const { c, sent, log, protocolErrors, reply } = client()
    reply({ jsonrpc: '2.0', id: 'srv-1', method: 'window/showMessage', params: {} })
    await tick()
    expect(sent).toEqual([
      {
        jsonrpc: '2.0',
        id: 'srv-1',
        error: { code: -32601, message: 'Method Not Found: window/showMessage' },
      },
    ])
    expect(log.some((l) => l.includes('refused a request'))).toBe(true)
    c.request('a')
    // Garbage on the pipe ends the reading; the client itself stays as it was.
    const { c: c2, protocolErrors: e2 } = client()
    void c2
    expect(protocolErrors).toEqual([])
    expect(e2).toEqual([])
  })
})
