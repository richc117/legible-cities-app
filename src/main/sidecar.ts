// The engine's supervisor: one child process, one connection, a state the
// interface can show. Starts the engine, checks it is the one the app was
// built for, forwards requests and notifications, bounds every request,
// restarts on an exit nobody asked for, and ends everything on quit.
// Contract: specs/004-sidecar-supervisor/contracts/sidecar.md. No Electron
// import: the tests run it against a stand-in engine as a real child.

import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import {
  describeState,
  EngineError,
  ERROR_CODES,
  type EnginePin,
  type EngineState,
} from '../shared/engine'
import { JsonRpcClient, ProtocolError } from './jsonrpc'

export { describeState }

export interface Bounds {
  handshakeMs: number
  inactivityMs: number
  shutdownMs: number
  terminateMs: number
  /** Waits before the second, third and fourth launch; their count is the restart limit. */
  restartDelaysMs: number[]
  /** Ready this long, or one request answered, and the failure count starts afresh. */
  stableMs: number
}

export const DEFAULT_BOUNDS: Bounds = {
  handshakeMs: 10_000,
  inactivityMs: 600_000,
  shutdownMs: 3_000,
  terminateMs: 3_000,
  restartDelaysMs: [1_000, 2_000, 4_000],
  stableMs: 30_000,
}

export interface Notification {
  method: string
  params: unknown
}

export interface SidecarOptions {
  /** The interpreter and its arguments, or null with a reason when there is none. */
  command: string[] | null
  unavailableReason?: string
  env: Record<string, string>
  pin: EnginePin
  log: (message: string) => void
  onMismatch?: (expected: EnginePin, found: { version: string; protocol: number }) => void
  bounds?: Partial<Bounds>
  platform?: NodeJS.Platform
}

const STDERR_TAIL = 20

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal !== null) return `ended by signal ${signal}`
  return `exited with code ${code ?? 'unknown'}`
}

export class Sidecar {
  private _state: EngineState = { state: 'starting', attempt: 1 }
  private child: ChildProcess | null = null
  private client: JsonRpcClient | null = null
  private exited: Promise<void> = Promise.resolve()
  private failures = 0
  private stopping = false
  private started = false
  private tail: string[] = []
  private readonly bounds: Bounds
  private readonly platform: NodeJS.Platform
  private readonly stateListeners = new Set<(state: EngineState) => void>()
  private readonly notificationListeners = new Set<(n: Notification) => void>()
  private readonly inactivity = new Map<number, NodeJS.Timeout>()
  private restartTimer: NodeJS.Timeout | null = null
  private stableTimer: NodeJS.Timeout | null = null
  /** An endChild() in progress, so stop() waits for it rather than passing it. */
  private ending: Promise<void> | null = null
  private stopped: Promise<void> | null = null

  constructor(private readonly options: SidecarOptions) {
    this.bounds = { ...DEFAULT_BOUNDS, ...options.bounds }
    this.platform = options.platform ?? process.platform
  }

  get state(): EngineState {
    return this._state
  }

  onState(listener: (state: EngineState) => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  onNotification(listener: (n: Notification) => void): () => void {
    this.notificationListeners.add(listener)
    return () => this.notificationListeners.delete(listener)
  }

  /** The process id of the running engine, for tests and the log. */
  get pid(): number | undefined {
    return this.child?.pid
  }

  start(): void {
    if (this.started) return
    this.started = true
    if (this.options.command === null) {
      this.setState({
        state: 'unavailable',
        reason: this.options.unavailableReason ?? 'No interpreter can run the engine.',
      })
      return
    }
    this.launch()
  }

  // -- requests --

  request(
    method: string,
    params?: Record<string, unknown>,
  ): { id: number; result: Promise<unknown> } {
    const client = this.client
    if (this._state.state !== 'ready' || client === null) {
      const error = new EngineError(ERROR_CODES.notReady, describeState(this._state), {
        kind: 'state',
        detail: describeState(this._state),
        hint: describeState(this._state),
      })
      return { id: 0, result: Promise.reject(error) }
    }
    const { id, result } = client.request(method, params)
    this.armInactivity(client, id)
    const settled = result.then(
      (value) => {
        this.disarmInactivity(id)
        this.stable()
        return value
      },
      (error: EngineError) => {
        this.disarmInactivity(id)
        // The engine answered, even with an error: it is working.
        if (error.code !== ERROR_CODES.engineExited && error.code !== ERROR_CODES.inactive)
          this.stable()
        throw error
      },
    )
    return { id, result: settled }
  }

  cancel(id: number): void {
    this.client?.cancel(id)
  }

  private armInactivity(client: JsonRpcClient, id: number): void {
    this.disarmInactivity(id)
    const minutes = Math.round(this.bounds.inactivityMs / 60_000)
    const timer = setTimeout(() => {
      this.inactivity.delete(id)
      const message =
        minutes >= 1
          ? `No progress for ${minutes} minute${minutes === 1 ? '' : 's'}; the request was cancelled.`
          : `No progress for ${this.bounds.inactivityMs} ms; the request was cancelled.`
      this.log(`request ${id}: ${message}`)
      client.cancel(id)
      client.fail(
        id,
        new EngineError(ERROR_CODES.inactive, message, {
          kind: 'inactive',
          detail: message,
          hint: message,
        }),
      )
    }, this.bounds.inactivityMs)
    this.inactivity.set(id, timer)
  }

  private disarmInactivity(id: number): void {
    const timer = this.inactivity.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.inactivity.delete(id)
    }
  }

  // -- the process --

  private launch(): void {
    const command = this.options.command as string[]
    const attempt = this.failures + 1
    this.setState({ state: 'starting', attempt })
    this.tail = []
    this.log(`starting, attempt ${attempt}: ${command.join(' ')}`)

    let child: ChildProcess
    try {
      child = spawn(command[0], command.slice(1), {
        env: this.options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        // Its own process group on POSIX, so ending the engine ends what it started.
        detached: this.platform !== 'win32',
      })
    } catch (error) {
      this.couldNotStart((error as Error).message)
      return
    }
    this.child = child
    let exitedResolve: () => void = () => {}
    this.exited = new Promise<void>((resolve) => {
      exitedResolve = resolve
    })

    child.on('error', (error: NodeJS.ErrnoException) => {
      // Before it ran at all: not found or not executable. Retrying would
      // find the same answer, so this is the interpreter's fault, not a crash.
      if (this.child === child && child.pid === undefined) {
        this.child = null
        exitedResolve()
        this.couldNotStart(`${error.code ?? error.message}`)
      } else {
        this.log(`process error: ${error.message}`)
      }
    })

    if (child.stderr !== null) {
      createInterface({ input: child.stderr }).on('line', (line) => {
        this.tail.push(line)
        if (this.tail.length > STDERR_TAIL) this.tail.shift()
        this.log(`stderr: ${line}`)
      })
    }

    if (child.stdout === null || child.stdin === null) {
      this.couldNotStart('the process has no pipes')
      return
    }
    const client = new JsonRpcClient(child.stdin, child.stdout, {
      onNotification: (method, params) => this.deliver(method, params),
      onProtocolError: (error: ProtocolError) => {
        if (this.child !== child) return
        this.log(`protocol error: ${error.message}`)
        void this.failed(
          `The engine wrote something that is not a message (${error.message}).`,
          child,
        )
      },
      log: (message) => this.log(message),
    })
    this.client = client
    // A write to a pipe whose reader has gone must not take the app down.
    child.stdin.on('error', (error: Error) => this.log(`stdin: ${error.message}`))

    // 'exit' settles the requests at once; the reason waits for 'close', when
    // the stderr pipe has given up its last lines, or one second, whichever
    // comes first (a grandchild holding the pipe must not hold the reason).
    let unexpected: string | null = null
    let reported = false
    const report = (): void => {
      if (reported || unexpected === null) return
      reported = true
      // A line with a path in it stays in the log; the reason is shown on screen.
      const shown = this.tail.filter((line) => !/[\\/]/.test(line)).slice(-3)
      const tail =
        shown.length > 0
          ? `; it wrote: ${shown.join(' | ')}`
          : this.tail.length > 0
            ? '; what it wrote is in the log'
            : ''
      void this.failed(`The engine ${unexpected}${tail}.`, null)
    }
    child.once('exit', (code, signal) => {
      exitedResolve()
      if (this.child !== child) return
      this.child = null
      this.client = null
      client.dispose(
        new EngineError(ERROR_CODES.engineExited, 'The engine stopped before answering.', {
          kind: 'exit',
          detail: describeExit(code, signal),
          hint: 'The engine stopped before answering.',
        }),
      )
      this.clearInactivity()
      if (this.stopping || this._state.state === 'mismatched') {
        this.log(`process ${describeExit(code, signal)}`)
        return
      }
      unexpected = describeExit(code, signal)
      setTimeout(report, 1_000)
    })
    child.once('close', report)

    this.handshake(client, child)
  }

  private handshake(client: JsonRpcClient, child: ChildProcess): void {
    const { id, result } = client.request('engine.info')
    const seconds = Math.round(this.bounds.handshakeMs / 1000)
    const timer = setTimeout(() => {
      client.fail(
        id,
        new EngineError(ERROR_CODES.inactive, `no answer to the handshake within ${seconds} s`),
      )
    }, this.bounds.handshakeMs)
    result.then(
      (info) => {
        clearTimeout(timer)
        if (this.child !== child) return
        this.checkIdentity(info, child)
      },
      (error: EngineError) => {
        clearTimeout(timer)
        if (this.child !== child) return
        if (error.code === ERROR_CODES.engineExited) return // the exit handler reports it
        void this.failed(`The engine did not complete the handshake: ${error.message}.`, child)
      },
    )
  }

  private checkIdentity(info: unknown, child: ChildProcess): void {
    const version = isObject(info) && typeof info.engine === 'string' ? info.engine : 'unknown'
    const protocol = isObject(info) && typeof info.protocol === 'number' ? info.protocol : 0
    const home = isObject(info) && typeof info.home === 'string' ? info.home : 'unknown'
    const { pin } = this.options
    if (version !== pin.version || protocol !== pin.protocol) {
      this.log(
        `mismatch: expected engine ${pin.version} protocol ${pin.protocol}, found ${version} protocol ${protocol}`,
      )
      this.setState({ state: 'mismatched', expected: pin, found: { version, protocol } })
      this.options.onMismatch?.(pin, { version, protocol })
      void this.endChild(child, 'mismatch')
      return
    }
    this.log(
      `ready: engine ${version}, protocol ${protocol} (expected ${pin.version}, ${pin.protocol}); home ${home}`,
    )
    this.setState({ state: 'ready', version, protocol })
    this.armStable()
  }

  private deliver(method: string, params: unknown): void {
    const id = isObject(params) && typeof params.id === 'number' ? params.id : null
    if (id !== null && this.inactivity.has(id)) {
      const client = this.client
      if (client !== null) this.armInactivity(client, id)
    } else if (id !== null && !(this.client?.inFlight.includes(id) ?? false)) {
      this.log(`dropped ${method} for an unknown request id ${id}`)
      return
    }
    for (const listener of this.notificationListeners) listener({ method, params })
  }

  // -- failure and restart --

  private couldNotStart(what: string): void {
    this.client = null
    this.setState({
      state: 'unavailable',
      reason: `The interpreter could not be started (${what}); check LEGIBLE_ENGINE_PYTHON or the engine checkout.`,
    })
  }

  private async failed(reason: string, child: ChildProcess | null): Promise<void> {
    if (this.stopping) return
    this.clearStable()
    this.failures += 1
    const delays = this.bounds.restartDelaysMs
    const giveUp = this.failures > delays.length
    // The state changes now, before the child is ended: a request meanwhile
    // is refused with this reason, not with "ready".
    if (giveUp) {
      this.log(`giving up after ${this.failures} consecutive failures: ${reason}`)
      this.setState({
        state: 'stopped',
        reason: `${reason} It failed ${this.failures} times in a row.`,
      })
    } else {
      const attempt = this.failures + 1
      this.log(
        `${reason} Restarting in ${delays[this.failures - 1]} ms, attempt ${attempt} of ${delays.length + 1}`,
      )
      this.setState({ state: 'restarting', attempt, reason })
    }
    if (child !== null) await this.endChild(child, 'failure')
    // stop() may have run while the child was being ended.
    if (this.stopping || giveUp) return
    this.restartTimer = setTimeout(
      () => {
        this.restartTimer = null
        if (!this.stopping) this.launch()
      },
      delays[this.failures - 1],
    )
  }

  private armStable(): void {
    this.clearStable()
    this.stableTimer = setTimeout(() => this.stable(), this.bounds.stableMs)
  }

  private clearStable(): void {
    if (this.stableTimer !== null) {
      clearTimeout(this.stableTimer)
      this.stableTimer = null
    }
  }

  private stable(): void {
    if (this.failures !== 0 && this._state.state === 'ready') {
      this.log(`the engine is stable again; ${this.failures} earlier failure(s) forgiven`)
    }
    if (this._state.state === 'ready') this.failures = 0
  }

  private clearInactivity(): void {
    for (const timer of this.inactivity.values()) clearTimeout(timer)
    this.inactivity.clear()
  }

  // -- shutdown --

  /** Quit: cancel, ask, terminate, kill; resolves when nothing is running. Idempotent. */
  stop(): Promise<void> {
    this.stopped ??= this.doStop()
    return this.stopped
  }

  private async doStop(): Promise<void> {
    this.stopping = true
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.clearStable()
    if (this._state.state !== 'unavailable' && this._state.state !== 'stopped') {
      this.setState({ state: 'stopped', reason: 'The app is quitting.' })
    }
    // A failure or a mismatch may be ending a child right now: that is the
    // same work, so wait for it rather than quit past it.
    if (this.ending !== null) await this.ending
    const child = this.child
    if (child !== null) await this.endChild(child, 'quit')
  }

  /** Shut one child down: the request, then the group or the tree, then force. */
  private endChild(child: ChildProcess, why: string): Promise<void> {
    const work = this.endChildNow(child, why).finally(() => {
      if (this.ending === work) this.ending = null
    })
    this.ending = work
    return work
  }

  private async endChildNow(child: ChildProcess, why: string): Promise<void> {
    const client = this.client
    if (this.child === child) {
      // Mark it as no longer ours first, so its exit is not a failure.
      this.child = null
      this.client = null
    }
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = this.exited
    this.clearInactivity()
    const stopped = new EngineError(
      ERROR_CODES.engineExited,
      'The engine stopped before answering.',
      {
        kind: 'exit',
        detail: why,
        hint: 'The engine stopped before answering.',
      },
    )
    if (client !== null) {
      for (const id of client.inFlight) {
        client.cancel(id)
        client.fail(id, stopped)
      }
      try {
        client.request('engine.shutdown').result.catch(() => {})
      } catch {
        // The pipe may already be gone; the steps below still apply.
      }
    }
    if (await this.waitFor(exited, this.bounds.shutdownMs)) {
      this.log(`ended on request (${why})`)
      client?.dispose(stopped)
      return
    }
    this.log(`did not end on request within ${this.bounds.shutdownMs} ms; terminating (${why})`)
    this.terminate(child)
    if (await this.waitFor(exited, this.bounds.terminateMs)) {
      this.log('ended on terminate')
      client?.dispose(stopped)
      return
    }
    this.log(`did not end on terminate within ${this.bounds.terminateMs} ms; killing`)
    this.kill(child)
    await this.waitFor(exited, this.bounds.terminateMs)
    client?.dispose(stopped)
  }

  private terminate(child: ChildProcess): void {
    if (child.pid === undefined) return
    if (this.platform === 'win32') {
      // Forceful already, and the whole tree: the engine's layout tool goes with it.
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: this.bounds.terminateMs,
      })
      killer.on('error', (error) => this.log(`taskkill: ${error.message}`))
      if (killer.stderr !== null) {
        createInterface({ input: killer.stderr }).on('line', (line) =>
          this.log(`taskkill: ${line}`),
        )
      }
      return
    }
    this.signal(child, 'SIGTERM')
  }

  private kill(child: ChildProcess): void {
    if (this.platform === 'win32') return // taskkill /F was the end
    this.signal(child, 'SIGKILL')
  }

  private signal(child: ChildProcess, signal: NodeJS.Signals): void {
    if (child.pid === undefined) return
    try {
      process.kill(-child.pid, signal) // the group
    } catch {
      try {
        child.kill(signal)
      } catch {
        // Already gone.
      }
    }
  }

  private waitFor(exited: Promise<void>, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms)
      void exited.then(() => {
        clearTimeout(timer)
        resolve(true)
      })
    })
  }

  // -- state --

  private setState(state: EngineState): void {
    this._state = state
    this.log(`state: ${describeState(state)}`)
    for (const listener of this.stateListeners) listener(state)
  }

  private log(message: string): void {
    this.options.log(message)
  }
}
