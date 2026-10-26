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

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FrameReader, writeFrame } from '../../src/main/jsonrpc'
import { FAKE_ENGINE, PINNED_ENGINE } from './python'

/** The longest the warm-up may take, the interpreter's slowest first start included. */
export const WARM_DEADLINE_MS = 60_000

/** The prefix of the warm-up's own engine home, so it is plainly not a test's. */
export const WARM_PREFIX = 'legible-cities-warm-'

export interface Warmed {
  /** Whole milliseconds from the spawn to engine.info answered. */
  ms: number
}

export interface WarmOptions {
  /** Added over the environment the stand-in is started with; a test points the bytecode cache elsewhere. */
  env?: Record<string, string>
  deadlineMs?: number
}

/**
 * Warm the interpreter and the stand-in. Resolves with how long the stand-in
 * took to answer engine.info; rejects, never hangs, when it cannot.
 */
export function warmEngine(python: string, options: WarmOptions = {}): Promise<Warmed> {
  const deadlineMs = options.deadlineMs ?? WARM_DEADLINE_MS
  const home = mkdtempSync(join(tmpdir(), WARM_PREFIX))
  // The control file the stand-in reads once at start: the version the app pins,
  // so the answer is the one a launch would accept.
  writeFileSync(join(home, 'fake-engine.json'), JSON.stringify({ version: PINNED_ENGINE }))
  const spawnedAt = performance.now()
  return new Promise<Warmed>((resolve, reject) => {
    const child = spawn(python, ['-m', 'schematic.serve'], {
      env: {
        ...process.env,
        SCHEMATIC_HOME: home,
        PYTHONPATH: FAKE_ENGINE,
        PYTHONUNBUFFERED: '1',
        ...options.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let settled = false
    const stderr: string[] = []
    const finish = (outcome: { ms: number } | Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // Ask it to leave, as the supervisor does, then make sure it has.
      try {
        writeFrame(child.stdin, { jsonrpc: '2.0', id: 2, method: 'engine.shutdown' })
        child.stdin.end()
      } catch {
        // The pipe may be gone already; the kill below still applies.
      }
      const forced = setTimeout(() => child.kill(), 3_000)
      child.once('close', () => {
        clearTimeout(forced)
        rmSync(home, { recursive: true, force: true })
        if (outcome instanceof Error) reject(outcome)
        else resolve(outcome)
      })
    }
    const timer = setTimeout(
      () => finish(new Error(`no answer to engine.info within ${deadlineMs} ms`)),
      deadlineMs,
    )
    child.on('error', (error) => finish(error))
    child.stdin.on('error', () => {})
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk.toString('utf8')))
    child.once('exit', (code) => {
      if (!settled)
        finish(new Error(`the stand-in exited with code ${code}: ${stderr.join('').trim()}`))
    })
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
