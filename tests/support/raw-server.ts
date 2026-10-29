// An engine server spoken to on its stdio in its own framing, with the
// params of each request written as JSON *text*: the conformance table
// (`conformance.ts`) needs numbers no JavaScript value holds (`1e999` is
// `Infinity` here and `null` on the wire) and requests with no params at
// all, which the app's own client could never send and a hand-written one
// could. The stand-in and the real engine are both started through it.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

/** A reply to one request: the result, or the error as the engine writes it. */
export interface Reply {
  result?: unknown
  error?: {
    code: number
    message: string
    data?: { kind?: string; hint?: string; detail?: string; [more: string]: unknown }
  }
}

/** A notification the server sent: `job/progress` or `job/log`, with its params. */
export interface Notification {
  method: string
  params?: Record<string, unknown>
}

// Under vitest's own test timeout, so a request that hangs says which it was.
export const DEADLINE_MS = 20_000

export class Server {
  #child: ChildProcessWithoutNullStreams
  #buffer = Buffer.alloc(0)
  #waiting = new Map<number, (reply: Reply) => void>()
  #next = 1
  #exited = false
  #why = 'the server has exited'
  #ended: (() => void)[] = []
  /** Every notification read so far, in the order it came. */
  readonly notifications: Notification[] = []

  constructor(command: string, env: Record<string, string>, cwd: string) {
    this.#child = spawn(command, ['-m', 'schematic.serve'], {
      env,
      cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    // Drained and dropped: the server logs to its stderr and nothing here reads it.
    this.#child.stderr.resume()
    const ended = (why: string): void => {
      if (this.#exited) return
      this.#exited = true
      this.#why = why
      for (const end of this.#ended) end()
    }
    this.#child.once('exit', () => ended('the server has exited'))
    // An interpreter that is not there never starts, and says so only here.
    this.#child.once('error', (error) =>
      ended(`the server could not be run (${command}): ${error.message}`),
    )
    // A write to a server that exited between the check and the write.
    this.#child.stdin.on('error', () => {})
    this.#child.stdout.on('data', (chunk: Buffer) => {
      this.#buffer = Buffer.concat([this.#buffer, chunk])
      this.#read()
    })
  }

  #read(): void {
    for (;;) {
      const end = this.#buffer.indexOf('\r\n\r\n')
      if (end < 0) return
      const head = this.#buffer.subarray(0, end).toString('ascii')
      const length = Number(/content-length:\s*(\d+)/i.exec(head)?.[1])
      const start = end + 4
      if (this.#buffer.length < start + length) return
      const message = JSON.parse(this.#buffer.subarray(start, start + length).toString('utf8')) as {
        id?: number
        method?: string
        params?: Record<string, unknown>
      } & Reply
      this.#buffer = this.#buffer.subarray(start + length)
      if (message.id !== undefined) this.#waiting.get(message.id)?.(message)
      else if (message.method !== undefined)
        this.notifications.push({ method: message.method, params: message.params })
    }
  }

  /** The id the next request will carry. */
  get nextId(): number {
    return this.#next
  }

  /** One request, its params written as `paramsText` (JSON), or left out. */
  request(method: string, paramsText?: string, deadlineMs = DEADLINE_MS): Promise<Reply> {
    const id = this.#next++
    const body =
      `{"jsonrpc":"2.0","id":${id},"method":${JSON.stringify(method)}` +
      (paramsText === undefined ? '' : `,"params":${paramsText}`) +
      '}'
    return new Promise<Reply>((resolve, reject) => {
      // A server that has ended answers nothing, so say so at once and not at the deadline.
      if (this.#exited) return reject(new Error(`${method}: ${this.#why}`))
      const timer = setTimeout(() => {
        this.#waiting.delete(id)
        reject(new Error(`${method} was not answered in ${deadlineMs} ms`))
      }, deadlineMs)
      this.#ended.push(() => {
        clearTimeout(timer)
        reject(new Error(`${method}: ${this.#why}, unanswered`))
      })
      this.#waiting.set(id, (reply) => {
        clearTimeout(timer)
        this.#waiting.delete(id)
        resolve(reply)
      })
      this.#child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    })
  }

  async stop(): Promise<void> {
    if (this.#exited) return
    const exited = new Promise<void>((resolve) => this.#child.once('exit', () => resolve()))
    this.#child.stdin.end()
    const killer = setTimeout(() => this.#child.kill(), 10_000)
    await exited
    clearTimeout(killer)
  }
}
