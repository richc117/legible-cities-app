// The first-run check of the bundled tools (A6-02, specs/026-first-run-check).
//
// Once per start, after the engine's first start has settled, the main
// process makes LOOM and ffmpeg do something real: `gtfs2graph` over a tiny
// GTFS folder the app carries, which must print a line graph, and
// `ffmpeg -version` and `ffprobe -version`, which must each say who they
// are. Asking a LOOM tool its version proves nothing (it answers
// `-128-NOTFOUND` whatever it is), and a zero exit from `gtfs2graph` proves
// little more: over a feed with nothing in the mode it prints an empty
// collection and exits 0 (research.md, section 1). So the output is parsed.
//
// No Electron import. The spawner, the clock and the temporary folder are
// injected, so every outcome is asserted in a unit test; `index.ts` hands in
// the real ones.
//
// Every spawn follows the child-process rules: an argument array, never a
// shell; `windowsHide`; a timeout; its standard error in the log; and the
// child ended at quit (`abort`). The working directory is a fresh folder
// under the platform's temporary folder, removed afterwards - never the
// bundle and never the engine's home.

import { spawn as nodeSpawn } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  failureSentence,
  FIRST_RUN_TOOLS,
  RUNNING_RESULT,
  TOOL_NAMES,
  type FailureKind,
  type FirstRunResult,
  type FirstRunTool,
  type ToolCheck,
} from '../shared/first-run'
import type { ToolTarget } from './config'
import { shortenHome } from './diagnostics-text'

/**
 * How long one spawn may take. Generous: a first launch on macOS can wait on
 * Gatekeeper's scan of a binary it has not seen, and a check that gives up
 * on a healthy tool is worse than one that takes a while to say so.
 */
export const TOOL_TIMEOUT_MS = 15_000

/** The most standard output kept from a tool: the fixture's line graph is about 2 KB. */
export const MAX_STDOUT_BYTES = 1024 * 1024

/** The most standard error kept for the log. */
export const MAX_STDERR_BYTES = 16 * 1024

/**
 * How long a killed child is given to close before the check stops waiting
 * for it. On Windows a process that is terminating still holds its working
 * directory, and the temporary folder is removed right after (US3-3).
 */
export const CLOSE_GRACE_MS = 2_000

/** The longest detail shown to a person. */
export const MAX_DETAIL_CHARS = 400

/** The tables the fixture must hold; one missing is a broken install, not a broken LOOM. */
export const FIXTURE_TABLES = [
  'agency.txt',
  'stops.txt',
  'routes.txt',
  'trips.txt',
  'stop_times.txt',
  'calendar.txt',
] as const

/** The folder the fixture is carried in, under the resources or the repository's `resources/`. */
export const FIXTURE_FOLDER = 'first-run-gtfs'

/** The lines the log file gets, under the `first-run` tag. */
export const LOG_TAG = 'first-run'

/** The part of a child process the check uses. */
export interface ToolProcess {
  stdout: NodeJS.ReadableStream | null
  stderr: NodeJS.ReadableStream | null
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown
  on(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown
  kill(signal?: NodeJS.Signals): boolean
}

export type Spawner = (
  command: string,
  args: string[],
  options: { cwd: string; windowsHide: true; shell: false; stdio: ['ignore', 'pipe', 'pipe'] },
) => ToolProcess

/** How one spawn ended. */
export type ProcessEnd =
  | {
      kind: 'exit'
      code: number | null
      signal: NodeJS.Signals | null
      stdout: string
      stderr: string
    }
  | { kind: 'error'; code: string; stderr: string }
  | { kind: 'timeout'; stderr: string }
  | { kind: 'overflow'; stderr: string }
  | { kind: 'aborted'; stderr: string }

/**
 * Run one tool and wait for it, bounded. Resolves once, whichever comes
 * first: the child's close, a spawn error, the deadline, or more output than
 * the cap. On the last two the child is killed and given `closeGraceMs` to
 * close - long enough for Windows to let go of its working folder - but no
 * longer, since a child that ignores a kill must not hold the check.
 */
export function runProcess(
  spawner: Spawner,
  command: string,
  args: string[],
  options: {
    cwd: string
    timeoutMs: number
    maxStdout: number
    /** Held while the child lives, so a quit can end it. */
    track: (kill: () => void) => () => void
    /** How long a killed child is waited for; `CLOSE_GRACE_MS` by default. */
    closeGraceMs?: number
  },
): Promise<ProcessEnd> {
  return new Promise((resolve) => {
    let child: ToolProcess
    try {
      child = spawner(command, args, {
        cwd: options.cwd,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({
        kind: 'error',
        code: (error as NodeJS.ErrnoException).code ?? 'unknown',
        stderr: '',
      })
      return
    }
    let settled = false
    const stdout: Buffer[] = []
    let stdoutBytes = 0
    let stderr = ''
    const kill = (): void => {
      try {
        child.kill('SIGKILL')
      } catch {
        // Already gone.
      }
    }
    const untrack = options.track(kill)
    let closed = false
    /** Called on close; set when a killed child is being waited for. */
    let onClosed: (() => void) | null = null
    const finish = (end: ProcessEnd): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      untrack()
      resolve(end)
    }
    /** Kill the child, then settle with `end` once it closes or the grace is spent. */
    const killThen = (end: () => ProcessEnd): void => {
      if (settled || onClosed !== null) return
      clearTimeout(timer)
      kill()
      if (closed) return finish(end())
      const grace = setTimeout(() => finish(end()), options.closeGraceMs ?? CLOSE_GRACE_MS)
      onClosed = () => {
        clearTimeout(grace)
        finish(end())
      }
    }
    const timer = setTimeout(() => killThen(() => ({ kind: 'timeout', stderr })), options.timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled || onClosed !== null) return
      stdoutBytes += chunk.length
      if (stdoutBytes > options.maxStdout) {
        killThen(() => ({ kind: 'overflow', stderr }))
        return
      }
      stdout.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-MAX_STDERR_BYTES)
    })
    child.on('error', (error) => {
      if (onClosed === null) finish({ kind: 'error', code: error.code ?? 'unknown', stderr })
    })
    child.on('close', (code, signal) => {
      closed = true
      if (onClosed !== null) return onClosed()
      finish({
        kind: 'exit',
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr,
      })
    })
  })
}

/** A Windows loader's exit code is a large NTSTATUS, which is read in hexadecimal. */
function exitCode(code: number): string {
  return code > 0xffff || code < 0
    ? `${code} (0x${(code >>> 0).toString(16).toUpperCase()})`
    : String(code)
}

/** The first line of a text that is not blank, or ''. */
export function firstLine(text: string): string {
  return (
    text
      .replace(/\r/g, '')
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim() ?? ''
  )
}

/** A path's last folder or file name, in either separator whatever the platform. */
const lastName = (path: string): string =>
  path
    .split(/[\\/]+/)
    .filter((part) => part !== '')
    .pop() ?? ''

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A detail with its absolute paths taken out, since it is shown on screen
 * and copied: each path the check itself knows is written as `…/` and its
 * last folder name; the home folder, in any form the diagnostics copy knows
 * (its 8.3 short name included), as `~`; a path rooted at a drive or a share
 * (`C:\`, `\\server\`, `\\?\C:\`) as `…` to the end of its line, since
 * such a path may hold spaces and colons and nothing reliable ends it; and a
 * POSIX path as `…`. The log keeps the paths; that is a file on this machine.
 */
export function withoutPaths(
  text: string,
  known: readonly string[],
  homes: readonly string[] = [],
  platform: string = process.platform,
): string {
  let out = text
  for (const path of [...new Set(known)]
    .filter((p) => p !== '')
    .sort((a, b) => b.length - a.length)) {
    const forms = [path, path.replace(/\\/g, '/'), path.replace(/\//g, '\\')]
    for (const form of new Set(forms)) {
      out = out.replace(new RegExp(escape(form), 'gi'), `…/${lastName(path)}`)
    }
  }
  out = shortenHome(out, homes, platform)
  return (
    out
      // A drive letter, a share or a device path, and the rest of its line.
      .replace(/(^|[\s'"(=])(?:[A-Za-z]:[\\/]|\\\\[^\\\s]+[\\/]).*$/gm, '$1…')
      // A POSIX path of two segments or more.
      .replace(/(^|[\s'"(=])\/[^\s'"():/]+\/[^\s'"():]*/g, '$1…')
      .slice(0, MAX_DETAIL_CHARS)
  )
}

/** Whether a text is a GeoJSON line graph: a FeatureCollection with a LineString in it. */
export function lineGraph(text: string): { ok: true; lines: number } | { ok: false; why: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, why: 'it printed something that is not JSON' }
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { type?: unknown }).type !== 'FeatureCollection' ||
    !Array.isArray((parsed as { features?: unknown }).features)
  ) {
    return { ok: false, why: 'it printed JSON that is not a feature collection' }
  }
  const lines = ((parsed as { features: unknown[] }).features ?? []).filter(
    (feature) =>
      typeof feature === 'object' &&
      feature !== null &&
      (feature as { geometry?: { type?: unknown } }).geometry?.type === 'LineString',
  ).length
  return lines > 0
    ? { ok: true, lines }
    : { ok: false, why: 'it printed a feature collection with no line in it' }
}

/**
 * The engine's rule for ffprobe (`export.ffprobe_path` at v0.8.3): beside
 * ffmpeg, with the first `ffmpeg` in the file's name replaced. Null when the
 * name has none, where the engine would look on PATH - which the check never
 * does.
 */
export function ffprobeBeside(ffmpeg: string): string | null {
  const name = basename(ffmpeg)
  return name.includes('ffmpeg') ? join(dirname(ffmpeg), name.replace('ffmpeg', 'ffprobe')) : null
}

export interface FirstRunDeps {
  targets: Record<FirstRunTool, ToolTarget>
  /** The fixture's folder: the resources' in a package, the repository's in development. */
  fixture: string
  spawn?: Spawner
  /** Is there a file (true), a folder ('folder'), or nothing (false) at a path. */
  kind?: (path: string) => Promise<'file' | 'folder' | null>
  makeTemp?: () => Promise<string>
  removeTemp?: (dir: string) => Promise<void>
  now?: () => number
  timeoutMs?: number
  /** How long a killed child is waited for; `CLOSE_GRACE_MS` by default. */
  closeGraceMs?: number
  /**
   * More paths a detail must not show, written as their last folder name:
   * the app's resources, or the repository in development.
   */
  known?: readonly string[]
  /**
   * The home folder in every form to write as `~` (the settings service's
   * lookup, as "Copy diagnostics" uses); on a failure to answer, the home as
   * the platform names it. Asked only when a tool has failed.
   */
  homes?: () => Promise<readonly string[]>
  platform?: string
  log: { info: (message: string) => void; warn: (message: string) => void }
}

const defaultKind = async (path: string): Promise<'file' | 'folder' | null> => {
  try {
    const found = await stat(path)
    return found.isDirectory() ? 'folder' : found.isFile() ? 'file' : null
  } catch {
    return null
  }
}

type Verdict =
  | { outcome: 'passed'; stderr?: string[] }
  | { outcome: 'failed'; kind: FailureKind; detail: string; stderr?: string[] }

/**
 * The check, once per start. `result` is what the bridge reads; `onChange`
 * is how the window hears of each change; `run` starts it (a second call is
 * the same run); `abort` ends every child at quit.
 */
export class FirstRunCheck {
  #result: FirstRunResult
  readonly #deps: FirstRunDeps
  readonly #listeners = new Set<(result: FirstRunResult) => void>()
  readonly #children = new Set<() => void>()
  #running: Promise<FirstRunResult> | null = null
  #aborted = false

  constructor(deps: FirstRunDeps) {
    this.#deps = deps
    // What is skipped is known before anything runs.
    this.#result = { ...RUNNING_RESULT }
    for (const tool of FIRST_RUN_TOOLS) {
      const target = deps.targets[tool]
      if (target.kind === 'skip') this.#result[tool] = { outcome: 'skipped', reason: target.reason }
    }
    this.#result.finished = FIRST_RUN_TOOLS.every((t) => this.#result[t].outcome !== 'running')
  }

  get result(): FirstRunResult {
    return this.#result
  }

  onChange(listener: (result: FirstRunResult) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  run(): Promise<FirstRunResult> {
    // A quit that came first - the engine's stop is itself a settled state -
    // starts nothing.
    if (this.#aborted) return Promise.resolve(this.#result)
    this.#running ??= this.#run()
    return this.#running
  }

  /** End every child the check started; later outcomes are neither published nor logged. */
  abort(): void {
    this.#aborted = true
    const live = [...this.#children]
    for (const kill of live) kill()
    if (live.length > 0) this.#deps.log.info(`ended ${live.length} running check(s) at quit`)
  }

  async #run(): Promise<FirstRunResult> {
    const { targets, log } = this.#deps
    for (const tool of FIRST_RUN_TOOLS) {
      const target = targets[tool]
      if (target.kind === 'skip') log.info(`${TOOL_NAMES[tool]} skipped: ${target.reason}`)
    }
    if (this.#result.finished) {
      log.info(`finished: ${summaryLine(this.#result)}`)
      return this.#result
    }
    const makeTemp =
      this.#deps.makeTemp ?? (() => mkdtemp(join(tmpdir(), 'legible-cities-first-run-')))
    const removeTemp =
      this.#deps.removeTemp ??
      ((dir: string) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
    // Every outcome is gathered here and published once, after the
    // temporary folder is gone and the summary is in the log: `finished` is
    // what the launch check waits for before it quits, so nothing it looks
    // for may come after it (specs/026, US2-4).
    const outcomes: Partial<Record<FirstRunTool, ToolCheck>> = {}
    let cwd: string
    try {
      cwd = await makeTemp()
    } catch (error) {
      // Without a folder of its own the check will not run a tool anywhere
      // else; that is this machine's temporary folder failing, not a tool.
      const code = (error as NodeJS.ErrnoException).code ?? 'unknown'
      for (const tool of FIRST_RUN_TOOLS) {
        if (targets[tool].kind !== 'check') continue
        outcomes[tool] = {
          outcome: 'skipped',
          reason: `the temporary folder could not be made (${code})`,
        }
      }
      log.warn(`the temporary folder could not be made (${code}); nothing was checked`)
      return this.#publish(outcomes)
    }
    try {
      // A quit that came while the folder was being made: nothing is spawned.
      if (this.#aborted) return this.#result
      await Promise.all(
        FIRST_RUN_TOOLS.map(async (tool) => {
          const target = targets[tool]
          if (target.kind !== 'check') return
          const started = this.#now()
          const verdict =
            tool === 'loom'
              ? await this.#loom(target.path, cwd)
              : await this.#ffmpeg(target.path, cwd)
          const ms = Math.max(0, Math.round(this.#now() - started))
          if (this.#aborted) return
          // Each line a tool printed on standard error, as its own log line,
          // whether it passed or not.
          for (const line of verdict.stderr ?? []) log.info(line)
          if (verdict.outcome === 'passed') {
            log.info(`${TOOL_NAMES[tool]} passed in ${ms} ms`)
            outcomes[tool] = { outcome: 'passed', ms }
            return
          }
          // The tool's folder too: ffprobe sits beside ffmpeg, and the
          // resources and the home, so no part of a user's name is left.
          const known = [
            target.path,
            dirname(target.path),
            this.#deps.fixture,
            cwd,
            ...(this.#deps.known ?? []),
          ]
          outcomes[tool] = {
            outcome: 'failed',
            kind: verdict.kind,
            sentence: failureSentence(tool, verdict.kind, target.named),
            detail: withoutPaths(
              verdict.detail,
              known,
              await this.#homes(),
              this.#deps.platform ?? process.platform,
            ),
            ms,
          }
          log.warn(`${TOOL_NAMES[tool]} failed in ${ms} ms (${verdict.kind}): ${verdict.detail}`)
        }),
      )
    } finally {
      await removeTemp(cwd).catch((error: NodeJS.ErrnoException) =>
        log.warn(`the temporary folder could not be removed (${error.code ?? 'unknown'})`),
      )
    }
    return this.#publish(outcomes)
  }

  /** Log the summary, then publish every outcome at once; nothing after a quit. */
  #publish(outcomes: Partial<Record<FirstRunTool, ToolCheck>>): FirstRunResult {
    if (this.#aborted) return this.#result
    const next: FirstRunResult = { ...this.#result, ...outcomes }
    next.finished = FIRST_RUN_TOOLS.every((t) => next[t].outcome !== 'running')
    this.#deps.log.info(`finished: ${summaryLine(next)}`)
    this.#result = next
    for (const listener of this.#listeners) listener(next)
    return next
  }

  /** The home folder's forms to hide, bounded by the lookup itself; the platform's name for it on a refusal. */
  async #homes(): Promise<readonly string[]> {
    if (this.#deps.homes === undefined) return []
    try {
      return await this.#deps.homes()
    } catch {
      return [homedir()]
    }
  }

  #timeoutMs(): number {
    return this.#deps.timeoutMs ?? TOOL_TIMEOUT_MS
  }

  #now(): number {
    return (this.#deps.now ?? Date.now)()
  }

  #spawn(command: string, args: string[], cwd: string): Promise<ProcessEnd> {
    // A quit that landed during the file checks: no process after it.
    if (this.#aborted) return Promise.resolve({ kind: 'aborted', stderr: '' })
    return runProcess(this.#deps.spawn ?? (nodeSpawn as unknown as Spawner), command, args, {
      cwd,
      timeoutMs: this.#timeoutMs(),
      maxStdout: MAX_STDOUT_BYTES,
      closeGraceMs: this.#deps.closeGraceMs,
      track: (kill) => {
        // A quit that came first: nothing new may outlive it.
        if (this.#aborted) kill()
        this.#children.add(kill)
        return () => this.#children.delete(kill)
      },
    })
  }

  async #loom(folder: string, cwd: string): Promise<Verdict> {
    const kind = this.#deps.kind ?? defaultKind
    if ((await kind(folder)) !== 'folder') {
      return { outcome: 'failed', kind: 'missing', detail: `There is no LOOM folder at ${folder}.` }
    }
    let exe: string | null = null
    for (const name of ['gtfs2graph', 'gtfs2graph.exe']) {
      if ((await kind(join(folder, name))) === 'file') {
        exe = join(folder, name)
        break
      }
    }
    if (exe === null) {
      return { outcome: 'failed', kind: 'missing', detail: `${folder} has no gtfs2graph.` }
    }
    const fixture = this.#deps.fixture
    for (const table of FIXTURE_TABLES) {
      if ((await kind(join(fixture, table))) !== 'file') {
        return {
          outcome: 'failed',
          kind: 'install',
          detail: `The app's test feed has no ${table} (${fixture}).`,
        }
      }
    }
    const end = await this.#spawn(exe, ['-m', 'subway', fixture], cwd)
    return judge('gtfs2graph', end, this.#timeoutMs(), (stdout) => {
      const graph = lineGraph(stdout)
      return graph.ok ? null : `gtfs2graph exited 0, but ${graph.why}.`
    })
  }

  async #ffmpeg(ffmpeg: string, cwd: string): Promise<Verdict> {
    const kind = this.#deps.kind ?? defaultKind
    if ((await kind(ffmpeg)) !== 'file') {
      return { outcome: 'failed', kind: 'missing', detail: `There is no ffmpeg at ${ffmpeg}.` }
    }
    const ffprobe = ffprobeBeside(ffmpeg)
    if (ffprobe === null) {
      return {
        outcome: 'failed',
        kind: 'missing',
        detail: `ffprobe cannot be found beside ${ffmpeg}, whose name does not say ffmpeg.`,
      }
    }
    if ((await kind(ffprobe)) !== 'file') {
      return { outcome: 'failed', kind: 'missing', detail: `There is no ffprobe at ${ffprobe}.` }
    }
    const verdicts = await Promise.all(
      (
        [
          ['ffmpeg', ffmpeg],
          ['ffprobe', ffprobe],
        ] as const
      ).map(async ([name, path]) =>
        judge(name, await this.#spawn(path, ['-version'], cwd), this.#timeoutMs(), (stdout) => {
          const first = firstLine(stdout)
          return first.startsWith(`${name} version `)
            ? null
            : `${name} -version exited 0, but printed "${first.slice(0, 80)}" first.`
        }),
      ),
    )
    return (
      verdicts.find((v) => v.outcome === 'failed') ?? {
        outcome: 'passed',
        stderr: verdicts.flatMap((v) => v.stderr ?? []),
      }
    )
  }
}

/** The most lines of a tool's standard error the log gets. */
export const MAX_STDERR_LINES = 20

/** A spawn's end as a verdict: `check` looks at a zero exit's output and says what is wrong, or null. */
function judge(
  name: string,
  end: ProcessEnd,
  timeoutMs: number,
  check: (stdout: string) => string | null,
): Verdict {
  const said = firstLine(end.stderr)
  const stderr = end.stderr
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(-MAX_STDERR_LINES)
    .map((line) => `${name} stderr: ${line}`)
  const withSaid = (sentence: string): string =>
    said === '' ? sentence : `${sentence} It said: ${said}`
  switch (end.kind) {
    case 'timeout':
      return {
        outcome: 'failed',
        kind: 'timeout',
        detail: `${name} gave no answer within ${timeoutMs / 1000} s and was ended.`,
        stderr,
      }
    case 'aborted':
      return {
        outcome: 'failed',
        kind: 'not-running',
        detail: `${name} was not started: the app is quitting.`,
        stderr,
      }
    case 'overflow':
      return {
        outcome: 'failed',
        kind: 'not-running',
        detail: `${name} printed more than ${MAX_STDOUT_BYTES / 1024} KB and was ended.`,
        stderr,
      }
    case 'error':
      return {
        outcome: 'failed',
        kind: 'not-running',
        detail: withSaid(`${name} could not be started (${end.code}).`),
        stderr,
      }
    case 'exit': {
      if (end.signal !== null) {
        return {
          outcome: 'failed',
          kind: 'not-running',
          detail: withSaid(`${name} was ended by ${end.signal}.`),
          stderr,
        }
      }
      if (end.code !== 0) {
        return {
          outcome: 'failed',
          kind: 'not-running',
          detail: withSaid(`${name} exited with code ${exitCode(end.code ?? -1)}.`),
          stderr,
        }
      }
      const wrong = check(end.stdout)
      return wrong === null
        ? { outcome: 'passed', stderr }
        : { outcome: 'failed', kind: 'not-running', detail: withSaid(wrong), stderr }
    }
  }
}

/**
 * The log's summary of a finished check, one clause per tool:
 * `LOOM passed (12 ms), ffmpeg passed (20 ms)`. `scripts/launch-packaged.mjs`
 * looks for exactly this from inside each packaged app.
 */
export function summaryLine(result: FirstRunResult): string {
  return FIRST_RUN_TOOLS.map((tool) => {
    const check = result[tool]
    const name = TOOL_NAMES[tool]
    switch (check.outcome) {
      case 'passed':
        return `${name} passed (${check.ms} ms)`
      case 'failed':
        return `${name} failed (${check.kind}, ${check.ms} ms)`
      case 'skipped':
        return `${name} skipped`
      case 'running':
        return `${name} running`
    }
  }).join(', ')
}
