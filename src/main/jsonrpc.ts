// JSON-RPC 2.0 over two byte streams with Content-Length framing, the way
// a language server speaks it and the way the engine does. Our own rather
// than a library because the engine keys its progress notifications by
// the request's id, which this client assigns and therefore knows
// (specs/004-sidecar-supervisor/research.md, section 1). No Electron
// import; tested over in-memory streams.

import type { Readable, Writable } from 'node:stream'
import { EngineError, isEngineErrorKind, type ErrorData } from '../shared/engine'

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProtocolError'
  }
}

// A header block longer than this with no end in sight is not a header
// block: something that is not the engine is writing to the pipe.
const MAX_HEADER = 64 * 1024

/**
 * Reads frames from a stream: header lines, a blank line, a body of exactly
 * `Content-Length` bytes. Unknown headers are ignored; a header line without
 * a colon, a bad length, a frame without a length, or a body that is not
 * JSON is a protocol error, reported once, after which nothing more is read.
 */
export class FrameReader {
  private buffer: Buffer = Buffer.alloc(0)
  private failed = false

  constructor(
    stream: Readable,
    private readonly onMessage: (message: unknown) => void,
    private readonly onError: (error: ProtocolError) => void,
  ) {
    stream.on('data', (chunk: Buffer) => {
      if (this.failed) return
      this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
      try {
        this.drain()
      } catch (error) {
        this.failed = true
        this.onError(
          error instanceof ProtocolError ? error : new ProtocolError((error as Error).message),
        )
      }
    })
  }

  private drain(): void {
    for (;;) {
      const separator = findHeaderEnd(this.buffer)
      if (separator === null) {
        if (this.buffer.length > MAX_HEADER) {
          throw new ProtocolError(`no frame header in ${this.buffer.length} bytes`)
        }
        return
      }
      const header = this.buffer.subarray(0, separator.index).toString('latin1')
      let length: number | null = null
      for (const line of header.split(/\r?\n/)) {
        if (line === '') continue
        const colon = line.indexOf(':')
        if (colon < 0) throw new ProtocolError(`not a frame: ${line.slice(0, 80)}`)
        const name = line.slice(0, colon).trim().toLowerCase()
        const value = line.slice(colon + 1).trim()
        if (name === 'content-length') {
          length = Number(value)
          if (!Number.isInteger(length) || length < 0) {
            throw new ProtocolError(`invalid Content-Length: ${value.slice(0, 40)}`)
          }
        }
      }
      if (length === null) throw new ProtocolError('a frame without Content-Length')
      const start = separator.index + separator.length
      if (this.buffer.length < start + length) return
      const body = this.buffer.subarray(start, start + length).toString('utf8')
      this.buffer = this.buffer.subarray(start + length)
      let message: unknown
      try {
        message = JSON.parse(body)
      } catch {
        throw new ProtocolError(`a frame whose body is not JSON: ${body.slice(0, 80)}`)
      }
      this.onMessage(message)
    }
  }
}

function findHeaderEnd(buffer: Buffer): { index: number; length: number } | null {
  const crlf = buffer.indexOf('\r\n\r\n')
  const lf = buffer.indexOf('\n\n')
  if (crlf < 0 && lf < 0) return null
  if (crlf >= 0 && (lf < 0 || crlf < lf)) return { index: crlf, length: 4 }
  return { index: lf, length: 2 }
}

export function writeFrame(stream: Writable, message: unknown): void {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  stream.write(
    Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]),
  )
}

export interface ClientHandlers {
  onNotification(method: string, params: unknown): void
  onProtocolError(error: ProtocolError): void
  log(message: string): void
}

interface Pending {
  method: string
  resolve(value: unknown): void
  reject(error: EngineError): void
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// The engine's error data has kind, detail and hint. Anything else that
// arrives as data (a library's traceback, nothing at all) is kept in
// `detail` so no information is lost and the shape the page reads holds.
//
// Only the engine's own seven kinds count here. The app's three (`state`,
// `inactive`, `exit`) name a failure the engine never saw, and an engine
// claiming one of those would be indistinguishable from the supervisor's
// own, which is exactly what keeping the two sets apart prevents. A kind
// outside the seven cannot come from an engine of the pinned version, so
// it is read as the engine failing in a way it never described: the kind
// becomes `engine`, and the whole of what it sent is kept in `detail`.
function errorData(data: unknown, message: string): ErrorData | undefined {
  if (data === undefined || data === null) return undefined
  if (isObject(data) && typeof data.detail === 'string' && typeof data.hint === 'string') {
    if (isEngineErrorKind(data.kind)) {
      return { kind: data.kind, detail: data.detail, hint: data.hint }
    }
    return { kind: 'engine', detail: JSON.stringify(data), hint: data.hint }
  }
  return { kind: 'engine', detail: JSON.stringify(data), hint: message }
}

/**
 * A client over one connection: numeric ids from 1, the requests in
 * flight, responses matched to them, notifications handed on, and
 * `$/cancelRequest` by id. `dispose()` rejects everything in flight with the
 * error given and ignores the streams from then on.
 */
export class JsonRpcClient {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private disposed = false

  constructor(
    private readonly input: Writable,
    output: Readable,
    private readonly handlers: ClientHandlers,
  ) {
    new FrameReader(
      output,
      (message) => this.receive(message),
      (error) => {
        if (!this.disposed) this.handlers.onProtocolError(error)
      },
    )
  }

  get inFlight(): number[] {
    return [...this.pending.keys()]
  }

  request(method: string, params?: unknown): { id: number; result: Promise<unknown> } {
    const id = this.nextId++
    const result = new Promise<unknown>((resolve, reject) => {
      if (this.disposed) {
        reject(new EngineError(-32002, 'the connection is closed'))
        return
      }
      this.pending.set(id, { method, resolve, reject })
      const message: Record<string, unknown> = { jsonrpc: '2.0', id, method }
      if (params !== undefined) message.params = params
      writeFrame(this.input, message)
    })
    return { id, result }
  }

  notify(method: string, params?: unknown): void {
    if (this.disposed) return
    const message: Record<string, unknown> = { jsonrpc: '2.0', method }
    if (params !== undefined) message.params = params
    writeFrame(this.input, message)
  }

  cancel(id: number): void {
    if (this.pending.has(id)) this.notify('$/cancelRequest', { id })
  }

  /** Settle one request from outside with an error: an inactivity bound, a shutdown. */
  fail(id: number, error: EngineError): void {
    const pending = this.pending.get(id)
    if (pending === undefined) return
    this.pending.delete(id)
    pending.reject(error)
  }

  dispose(error: EngineError): void {
    if (this.disposed) return
    this.disposed = true
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      pending.reject(error)
    }
  }

  private receive(message: unknown): void {
    if (this.disposed) return
    if (!isObject(message) || message.jsonrpc !== '2.0') {
      this.handlers.log(
        `ignored a message that is not JSON-RPC 2.0: ${JSON.stringify(message).slice(0, 120)}`,
      )
      return
    }
    if (typeof message.method === 'string') {
      if ('id' in message) {
        // The engine never asks us anything; say so rather than hang it.
        writeFrame(this.input, {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: `Method Not Found: ${message.method}` },
        })
        this.handlers.log(`refused a request from the engine: ${message.method}`)
        return
      }
      this.handlers.onNotification(message.method, message.params)
      return
    }
    const id = message.id
    const pending = typeof id === 'number' ? this.pending.get(id) : undefined
    if (pending === undefined) {
      this.handlers.log(`dropped a response for an unknown request id ${String(id)}`)
      return
    }
    this.pending.delete(id as number)
    if (isObject(message.error)) {
      const { code, message: text, data } = message.error
      pending.reject(
        new EngineError(
          typeof code === 'number' ? code : -32603,
          typeof text === 'string' ? text : 'error',
          errorData(data, typeof text === 'string' ? text : 'error'),
        ),
      )
      return
    }
    pending.resolve(message.result)
  }
}
