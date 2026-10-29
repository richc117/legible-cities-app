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
/** How many of the server's last stderr lines a failure carries. */
export const STDERR_LINES = 20
/** How much of a stderr line with no end yet is kept: its last characters. */
export const STDERR_LINE_CHARS = 2_000

export class Server {
  #child: ChildProcessWithoutNullStreams
  #buffer = Buffer.alloc(0)
  #waiting = new Map<number, (reply: Reply) => void>()
  #next = 1
  #exited = false
  #why = 'the server has exited'
  #ended: (() => void)[] = []
  #stderr: string[] = []
  #partial = ''
  /** Every notification read so far, in the order it came. */
  readonly notifications: Notification[] = []

  constructor(command: string, env: Record<string, string>, cwd: string) {
    this.#child = spawn(command, ['-m', 'schematic.serve'], {
      env,
      cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    // The server logs to its stderr: its last lines are kept, so a server
    // that ends says why in the failure of the request it left unanswered,
    // and not only that it has exited.
    this.#child.stderr.setEncoding('utf8')
    this.#child.stderr.on('data', (chunk: string) => {
      const lines = (this.#partial + chunk).split(/\r?\n/)
      this.#partial = (lines.pop() ?? '').slice(-STDERR_LINE_CHARS)
      // The last of them only, each at most a line's worth, pushed one at a
      // time: a chunk of many lines is no argument list.
      for (const line of lines.slice(-STDERR_LINES))
        this.#stderr.push(line.slice(0, STDERR_LINE_CHARS))
      if (this.#stderr.length > STDERR_LINES)
        this.#stderr.splice(0, this.#stderr.length - STDERR_LINES)
    })
    const ended = (why: string): void => {
      if (this.#exited) return
      this.#exited = true
      this.#why = why
      for (const end of this.#ended) end()
    }
    // On close, once its stderr has been read to the end, rather than on exit.
    this.#child.once('close', (code, signal) =>
      ended(
        `the server has exited (${signal === null ? `exit ${code}` : `ended by ${signal}`})` +
          this.#stderrTail(),
      ),
    )
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

  /** The server's last stderr lines, as the end of a failure's sentence, or nothing. */
  #stderrTail(): string {
    const lines = [...this.#stderr, ...(this.#partial === '' ? [] : [this.#partial])]
    return lines.length === 0 ? '' : `; the last of its stderr:\n${lines.join('\n')}`
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
        reject(new Error(`${method} was not answered in ${deadlineMs} ms${this.#stderrTail()}`))
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
    // Gone already, whether or not its stdio has closed: a child of the
    // server's can hold its stderr open after the server itself has exited.
    if (this.#exited || this.#child.exitCode !== null || this.#child.signalCode !== null) return
    // Whichever comes first: the exit, or the close where the exit was missed.
    const exited = new Promise<void>((resolve) => {
      this.#child.once('exit', () => resolve())
      this.#child.once('close', () => resolve())
    })
    this.#child.stdin.end()
    const killer = setTimeout(() => this.#child.kill(), 10_000)
    await exited
    clearTimeout(killer)
  }
}
