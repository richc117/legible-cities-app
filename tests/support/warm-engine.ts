// Start the stand-in engine once, ask it who it is, and stop it, before any
// test launches the app (issue 529).
//
// The first launch of a run pays every cold cost at once: the interpreter
// read from disk, the stand-in's 2,600 lines compiled to bytecode because no
// `__pycache__` exists in a fresh checkout, and on Windows a scanner reading
// each of those files for the first time. On a loaded runner that has taken
// longer than the supervisor's 10 s handshake (`handshakeMs`), and the
// run's first test then waited through a restart it had no time for.
//
// This does the same work the app's first start would, outside the app, so
// the first test's launch is warm like every later one. It is best effort:
// a warm-up that fails changes nothing but the first test's odds, so it
// says so and the run goes on. It starts the interpreter the way the
// supervisor does (an argument array, `windowsHide`, a deadline, stderr
// read) and asks the way the supervisor does, over the supervisor's own
// framing.

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { engineEnvironment } from '../../src/main/interpreter'
import { FrameReader, writeFrame } from '../../src/main/jsonrpc'
import { DEFAULT_BOUNDS } from '../../src/main/sidecar'
import { FAKE_ENGINE, PINNED_ENGINE } from './python'

/** The longest the warm-up may take, the interpreter's slowest first start included. */
export const WARM_DEADLINE_MS = 60_000

/** The prefix of the warm-up's own engine home, so it is plainly not a test's. */
export const WARM_PREFIX = 'legible-cities-warm-'

export interface Warmed {
  /** Whole milliseconds from the spawn to engine.info answered. */
  ms: number
  /** Set when the warm-up's own folder could not be removed; the warm-up still stands. */
  leftover?: string
}

export interface WarmOptions {
  deadlineMs?: number
  /** After engine.shutdown, how long before the stand-in is terminated (the supervisor's `shutdownMs`). */
  shutdownMs?: number
  /** After the terminate, how long before it is killed (the supervisor's `terminateMs`). */
  terminateMs?: number
  /** Merged over the stand-in's control file; a test makes it hard to stop with this. */
  control?: Record<string, unknown>
  /** Removes the warm-up's engine home; a test makes it fail. */
  remove?: (path: string) => void
}

/**
 * A folder removed with the retries Windows needs: a scanner or the child's
 * own just-closed handle can hold a file for a moment (EBUSY, EPERM).
 */
const removeFolder = (path: string): void =>
  rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/**
 * Warm the interpreter and the stand-in. Resolves with how long the stand-in
 * took to answer engine.info; rejects, never hangs and never throws from a
 * listener, when it cannot. The stand-in is started with the environment the
 * app gives the engine (`engineEnvironment`), so its bytecode is compiled
 * where a launch will read it.
 */
export function warmEngine(python: string, options: WarmOptions = {}): Promise<Warmed> {
  const deadlineMs = options.deadlineMs ?? WARM_DEADLINE_MS
  const shutdownMs = options.shutdownMs ?? DEFAULT_BOUNDS.shutdownMs
  const terminateMs = options.terminateMs ?? DEFAULT_BOUNDS.terminateMs
  const remove = options.remove ?? removeFolder
  const home = mkdtempSync(join(tmpdir(), WARM_PREFIX))
  /** Remove the home; a failure is reported, never thrown. */
  const cleanUp = (): string | undefined => {
    try {
      remove(home)
      return undefined
    } catch (error) {
      return `${home}: ${(error as Error).message}`
    }
  }
  // The control file the stand-in reads once at start: the version the app pins,
  // so the answer is the one a launch would accept.
  writeFileSync(
    join(home, 'fake-engine.json'),
    JSON.stringify({ version: PINNED_ENGINE, ...options.control }),
  )
  const spawnedAt = performance.now()
  return new Promise<Warmed>((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(python, ['-m', 'schematic.serve'], {
        env: engineEnvironment({
          config: { home, loomBin: null, loomCommit: null, ffmpeg: null },
          base: { ...process.env, PYTHONPATH: FAKE_ENGINE },
          development: true,
        }),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      cleanUp()
      reject(error)
      return
    }
    let settled = false
    const stderr: string[] = []
    const finish = (outcome: { ms: number } | Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // Ask it to leave, as the supervisor does; then terminate; then kill.
      // A process that outlives all three would leave 'close' for ever.
      try {
        if (child.stdin !== null)
          writeFrame(child.stdin, { jsonrpc: '2.0', id: 2, method: 'engine.shutdown' })
      } catch {
        // The pipe may be gone already; the steps below still apply.
      }
      const killer = setTimeout(() => child.kill('SIGKILL'), shutdownMs + terminateMs)
      const terminator = setTimeout(() => child.kill(), shutdownMs)
      child.once('close', () => {
        clearTimeout(terminator)
        clearTimeout(killer)
        const leftover = cleanUp()
        if (outcome instanceof Error) reject(outcome)
        else resolve(leftover === undefined ? outcome : { ...outcome, leftover })
      })
    }
    const timer = setTimeout(
      () => finish(new Error(`no answer to engine.info within ${deadlineMs} ms`)),
      deadlineMs,
    )
    child.on('error', (error) => finish(error))
    child.stdin?.on('error', () => {})
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf8')))
    child.once('exit', (code) => {
      if (!settled)
        finish(new Error(`the stand-in exited with code ${code}: ${stderr.join('').trim()}`))
    })
    if (child.stdout === null || child.stdin === null) {
      finish(new Error('the stand-in has no pipes'))
      return
    }
    new FrameReader(
      child.stdout,
      (message) => {
        const answered =
          typeof message === 'object' && message !== null && (message as { id?: unknown }).id === 1
        if (answered) finish({ ms: Math.round(performance.now() - spawnedAt) })
      },
      (error) => finish(error),
    )
    writeFrame(child.stdin, { jsonrpc: '2.0', id: 1, method: 'engine.info' })
  })
}
