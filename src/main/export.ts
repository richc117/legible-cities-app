// The export, in the main process: the engine plans one preset of a
// project's page, the app takes the frames in its own offscreen window
// (ADR-024), and the engine encodes them and writes the sidecar beside the
// file. The flow lives here rather than in the page because the capture
// does, and the capture is never exposed to the renderer (specs/009,
// FR-013). Everything Electron - the window, the shell, the folders - is
// injected, so the order and the cleanup are asserted in a unit test.
//
// The frames are the export's own: written under the engine home while the
// export lasts and removed when it ends, whichever way. The file goes under
// the export folder from the configuration, in a folder named after the
// project, and its name is the engine's. Nothing here writes anywhere else.
// Contract: specs/010-export/contracts/bridge.md.

import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { frameTotal, type CaptureJob } from '../shared/capture'
import { EngineError, ERROR_CODES, engineError, withoutPaths } from '../shared/engine'
import type { ExportProgress, ExportResult, ExportStage, OfferedPreset } from '../shared/export'
import type { ProjectRecord, Theme } from '../shared/project'
import type {
  CaptureJob as PlannedJob,
  ExportEncodeParams,
  ExportEncodeResult,
  ExportPlanParams,
} from '../shared/protocol'
import {
  CaptureError,
  validateCaptureJob,
  type CaptureOptions,
  type CaptureResult,
} from './capture'
import { isObject } from './ipc-shape'
import { RESERVED_NAME } from './paths'
import type { Notification } from './sidecar'

/** What the export needs from the supervisor; a test hands in a fake. */
export interface ExportEngine {
  request(
    method: string,
    params?: Record<string, unknown>,
  ): { id: number; result: Promise<unknown> }
  cancel(id: number): void
  onNotification(listener: (n: Notification) => void): () => void
}

export interface ExporterOptions {
  engine: ExportEngine
  projects: { get(id: string): Promise<ProjectRecord & { readOnly: boolean }> }
  capture: (job: CaptureJob, options: CaptureOptions) => Promise<CaptureResult>
  /** Where a running export's frames go: `<framesRoot>/<token>/`. */
  framesRoot: string
  /**
   * Where the file goes: `<exportFolder()>/<project>/<filename>`. Asked at
   * each export rather than held, so a folder changed in Settings takes
   * effect without a restart (specs/019-settings, FR-005).
   */
  exportFolder: () => string
  /**
   * Why no export may start at all, or null. Settings sets this while it is
   * removing the engine's home: an export begun during that `rm` would be
   * writing its frames into a folder being walked away (A1-04).
   */
  blocked?: () => string | null
  log: (message: string) => void
}

interface Control {
  projectId: string
  cancelled: boolean
  abort: AbortController
  /** The engine request in flight, so a cancel reaches it; 0 when there is none. */
  engineId: number
}

/** The engine's theme names for the record's. */
export function themeFor(theme: Theme): 'dark' | 'light' {
  return theme === 'sepia' ? 'light' : 'dark'
}

/** The page the engine wrote for a project, on the app's origin. */
export function pageUrl(project: Pick<ProjectRecord, 'id' | 'feed'>): string {
  return `app://local/projects/${project.id}/${project.feed}.html`
}

/**
 * A project's name as a folder: a name is a label and may be anything, a
 * folder may not. What a filesystem refuses becomes a hyphen, leading and
 * trailing dots and spaces go, and a name with nothing left, or one Windows
 * reserves, falls back to the identifier.
 */
export function folderName(name: string, id: string): string {
  const safe = name
    .replace(/[\\/:*?"<>|]|\p{Cc}/gu, '-')
    .slice(0, 80)
    .replace(/^[\s.]+|[\s.]+$/g, '')
  return safe === '' || RESERVED_NAME.test(safe) ? id : safe
}

/** The engine's stem plus an extension, and nothing a path could hide in. */
const FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.[a-z0-9]{2,4}$/

/** The capture's half of the engine's plan: the recorder's job, field for field. */
export function jobOf(plan: PlannedJob): CaptureJob {
  return {
    url: plan.url,
    width: plan.width,
    height: plan.height,
    scale: plan.scale,
    fps: plan.fps,
    settle: plan.settle,
    beats: plan.beats,
  }
}

const cancelled = (): EngineError =>
  engineError(ERROR_CODES.cancelled, 'The export was cancelled.', 'export')

/** Every way an export can end badly, as the one error shape the bridge carries. */
export function normalise(reason: unknown): EngineError {
  if (reason instanceof EngineError) return reason
  if (reason instanceof CaptureError) {
    if (reason.cancelled) return cancelled()
    return engineError(ERROR_CODES.exportFailed, withoutPaths(reason.message), 'export')
  }
  const message = reason instanceof Error ? reason.message : String(reason)
  return engineError(ERROR_CODES.exportFailed, withoutPaths(message), 'io')
}

export class Exporter {
  readonly #options: ExporterOptions
  readonly #live = new Map<string, Control>()
  readonly #busy = new Set<string>()
  /** The files being written, so two projects that resolve to one file take turns. */
  readonly #writing = new Set<string>()
  readonly #finished = new Map<string, string>()
  readonly #listeners = new Set<(p: ExportProgress) => void>()

  constructor(options: ExporterOptions) {
    this.#options = options
  }

  onProgress(listener: (p: ExportProgress) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /**
   * Start an export. Refused synchronously, with an error thrown, for what
   * is known at once; everything later is the result's rejection.
   */
  start(
    token: string,
    projectId: string,
    preset: OfferedPreset,
  ): { result: Promise<ExportResult> } {
    const blocked = this.#options.blocked?.() ?? null
    if (blocked !== null) throw engineError(ERROR_CODES.badCall, blocked, 'params')
    if (this.#live.has(token))
      throw engineError(ERROR_CODES.badCall, 'an export with this id is already running', 'params')
    if (this.#busy.has(projectId))
      throw engineError(ERROR_CODES.badCall, 'This project is already being exported.', 'params')
    const control: Control = {
      projectId,
      cancelled: false,
      abort: new AbortController(),
      engineId: 0,
    }
    this.#live.set(token, control)
    this.#busy.add(projectId)
    const result = this.#run(token, projectId, preset, control)
      .then(
        (done) => {
          this.#finished.set(token, done.path)
          return done.result
        },
        (reason: unknown) => {
          throw normalise(reason)
        },
      )
      .finally(() => {
        this.#live.delete(token)
        this.#busy.delete(projectId)
      })
    return { result }
  }

  /** Stop an export wherever it is; unknown or finished ids do nothing. */
  cancel(token: string): void {
    const control = this.#live.get(token)
    if (control === undefined) return
    control.cancelled = true
    control.abort.abort()
    if (control.engineId !== 0) this.#options.engine.cancel(control.engineId)
  }

  /** The file a finished export wrote, for the reveal; null for any other id. */
  fileOf(token: string): string | null {
    return this.#finished.get(token) ?? null
  }

  /** A quit: every running export is cancelled. */
  abortAll(): void {
    for (const token of this.#live.keys()) this.cancel(token)
  }

  /** How many exports are running; the tests read it to prove nothing is left. */
  get live(): number {
    return this.#live.size
  }

  #emit(id: string, stage: ExportStage, fraction: number, message: string): void {
    const progress: ExportProgress = { id, stage, fraction, message }
    for (const listener of this.#listeners) listener(progress)
  }

  #stopIfCancelled(control: Control): void {
    if (control.cancelled) throw cancelled()
  }

  async #request<T>(
    method: string,
    params: Record<string, unknown>,
    control: Control,
    onFraction?: (fraction: number) => void,
  ): Promise<T> {
    const { engine } = this.#options
    const { id, result } = engine.request(method, params)
    control.engineId = id
    let off = (): void => {}
    if (onFraction !== undefined && id !== 0) {
      off = engine.onNotification(({ method: name, params: p }) => {
        if (name !== 'job/progress' || !isObject(p) || p.id !== id) return
        if (typeof p.fraction === 'number' && Number.isFinite(p.fraction))
          onFraction(Math.max(0, Math.min(1, p.fraction)))
      })
    }
    // A cancel that landed while the request was being made must reach it.
    if (control.cancelled && id !== 0) engine.cancel(id)
    try {
      return (await result) as T
    } finally {
      off()
      control.engineId = 0
    }
  }

  async #run(
    token: string,
    projectId: string,
    preset: OfferedPreset,
    control: Control,
  ): Promise<{ result: ExportResult; path: string }> {
    const { projects, capture, framesRoot, exportFolder, log } = this.#options
    const project = await projects.get(projectId)
    if (project.readOnly)
      throw engineError(
        ERROR_CODES.badCall,
        'This project was made by a newer version of the app and cannot be exported here.',
        'params',
      )
    if (project.layout === null || project.date === null)
      throw engineError(ERROR_CODES.badCall, 'Lay the project out before exporting it.', 'params')
    this.#stopIfCancelled(control)

    // The plan is the engine's: what to capture and how to encode it, from
    // the preset's own tables. The page is the project's, on the app's
    // origin, and the service day is the project's stored one (ADR-031).
    this.#emit(token, 'plan', 0, 'Planning the export.')
    const planParams = {
      key: project.feed,
      preset,
      page: pageUrl(project),
      date: project.date,
      options: { theme: themeFor(project.theme) },
    } satisfies ExportPlanParams
    const plan = await this.#request<PlannedJob>('export.plan', planParams, control)
    this.#stopIfCancelled(control)
    if (!isObject(plan))
      throw engineError(ERROR_CODES.exportFailed, 'The engine sent no plan.', 'export')
    const job = jobOf(plan)
    const problem = validateCaptureJob(job)
    if (problem !== null)
      throw engineError(
        ERROR_CODES.exportFailed,
        `The engine's plan cannot be captured: ${problem}.`,
        'export',
      )
    if (typeof plan.filename !== 'string' || !FILENAME.test(plan.filename))
      throw engineError(
        ERROR_CODES.exportFailed,
        "The engine's plan names no usable file.",
        'export',
      )
    const total = frameTotal(job.beats, job.fps)
    // The notes are the engine's advice about the storyboard; they go on
    // screen, so they get the same treatment as a hint.
    const notes = Array.isArray(plan.notes)
      ? plan.notes.filter((n): n is string => typeof n === 'string').map((n) => withoutPaths(n))
      : []
    this.#emit(
      token,
      'plan',
      1,
      [`Planned ${plan.filename}: ${total} frames at ${job.fps} frames per second.`, ...notes].join(
        ' ',
      ),
    )

    // Two projects with one name and one feed resolve to one file. A later
    // export replaces an earlier one, as it does for a single project; two
    // at once would have two encodes writing the same file, so the second
    // is refused until the first has finished.
    const dest = join(exportFolder(), folderName(project.name, project.id), plan.filename)
    if (this.#writing.has(dest))
      throw engineError(
        ERROR_CODES.badCall,
        'Another export is writing this file; wait for it to finish.',
        'params',
      )
    this.#writing.add(dest)

    const frames = join(framesRoot, token)
    try {
      this.#emit(token, 'capture', 0, `Capturing ${total} frames.`)
      const captured = await capture(job, {
        frames,
        signal: control.abort.signal,
        onProgress: (done, of) =>
          this.#emit(token, 'capture', done / of, `Captured ${done} of ${of} frames.`),
      })
      this.#stopIfCancelled(control)

      this.#emit(token, 'encode', 0, `Encoding ${captured.frames} frames.`)
      const encodeParams = {
        plan,
        source: frames,
        dest,
        provenance: { service_date: project.date },
      } satisfies ExportEncodeParams
      const encoded = await this.#request<ExportEncodeResult>(
        'export.encode',
        encodeParams,
        control,
        (fraction) =>
          this.#emit(
            token,
            'encode',
            fraction,
            `Encoded ${Math.round(fraction * captured.frames)} of ${captured.frames} frames.`,
          ),
      )
      const files = isObject(encoded) && Array.isArray(encoded.files) ? encoded.files : []
      const written = files.find((f) => isObject(f) && f.path === dest) ?? files[0]
      const bytes = isObject(written) && typeof written.bytes === 'number' ? written.bytes : 0
      log(`exported ${plan.filename}: ${captured.frames} frames, ${bytes} bytes`)
      return { result: { file: plan.filename, bytes, frames: captured.frames }, path: dest }
    } finally {
      this.#writing.delete(dest)
      // The frames never outlive the export, whichever way it ended. The
      // capture removes them itself on its own failure; this covers the rest.
      await rm(frames, { recursive: true, force: true }).catch((error: Error) =>
        log(`could not remove the frames: ${error.message}`),
      )
    }
  }
}
