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
import { claimFramesRoot, reasonOf } from './frames'
import { frameTotal, type CaptureJob } from '../shared/capture'
import { EngineError, ERROR_CODES, engineError, withoutPaths } from '../shared/engine'
import {
  planOptions,
  type ExportChoice,
  type ExportPreview,
  type ExportProgress,
  type ExportResult,
  type ExportStage,
} from '../shared/export'
import type { ProjectRecord, Theme } from '../shared/project'
import type {
  CaptureJob as PlannedJob,
  ExportEncodeParams,
  ExportEncodeResult,
  ExportPlanParams,
  Preset,
} from '../shared/protocol'
import {
  CaptureError,
  validateCaptureJob,
  type CaptureOptions,
  type CaptureResult,
} from './capture'
import { isObject, toShape } from './ipc-shape'
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

/**
 * The capture's half of the engine's plan: the recorder's job, field for
 * field.
 *
 * A still has no beats: the engine's recorder seeks to the plan's `at` and
 * takes one screenshot. The app's capture takes frames from beats and
 * nothing else, so a still becomes one beat one frame long that pins the
 * clock at `at` and stops it there (speed 0, no tween), and the capture's
 * own rules - the clock stopped before any wait, the settle, the paint
 * wait - apply to it unchanged. A still the plan did not pin gets no beat,
 * and `validateCaptureJob` refuses it: a frame that does not name its time
 * is not reproducible.
 */
export function jobOf(plan: PlannedJob): CaptureJob {
  const beats =
    plan.mode === 'still'
      ? typeof plan.at === 'number'
        ? [
            {
              secs: 1 / plan.fps,
              view: plan.view,
              labels: null,
              at: plan.at,
              speed: 0,
              sweep: false,
              hours: null,
              lo: null,
              hi: null,
              tween: 0,
            },
          ]
        : []
      : plan.beats
  return {
    url: plan.url,
    width: plan.width,
    height: plan.height,
    scale: plan.scale,
    fps: plan.fps,
    settle: plan.settle,
    beats,
  }
}

/** The one frame a still's capture writes, which is what `export.encode` takes as its source. */
export const STILL_FRAME = '000000.png'

/**
 * Is this address the project's own page, with a query and nothing else
 * in front of it? The preview's address goes into the map's frame, which
 * the viewer bridge attaches by the project's prefix (ADR-028), so an
 * answer that named any other page is refused rather than shown.
 */
export function isProjectPage(url: unknown, project: Pick<ProjectRecord, 'id' | 'feed'>): boolean {
  if (typeof url !== 'string' || /\s/.test(url)) return false
  const page = pageUrl(project)
  return url === page || url.startsWith(`${page}?`)
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

/**
 * The engine's entry for the chosen preset, from `export.presets`, with the
 * fields the app decides by checked, since they arrived from another
 * process; a preset the engine no longer lists is refused.
 */
export function entryOf(
  table: unknown,
  choice: Pick<ExportChoice, 'preset'>,
): Pick<Preset, 'name' | 'kind' | 'format' | 'safe_zones'> {
  const presets = isObject(table) && Array.isArray(table.presets) ? table.presets : []
  const entry: unknown = presets.find((p) => isObject(p) && p.name === choice.preset)
  if (
    !isObject(entry) ||
    !['still', 'video', 'vector'].includes(entry.kind as string) ||
    typeof entry.format !== 'string'
  )
    throw engineError(ERROR_CODES.badCall, 'The engine no longer offers that preset.', 'params')
  return {
    name: choice.preset,
    kind: entry.kind as Preset['kind'],
    format: entry.format as Preset['format'],
    safe_zones: entry.safe_zones === true,
  }
}

/** The engine's advice about the plan; it goes on screen, so it gets the same treatment as a hint. */
function notesOf(plan: PlannedJob): string[] {
  return Array.isArray(plan.notes)
    ? plan.notes.filter((n): n is string => typeof n === 'string').map((n) => withoutPaths(n))
    : []
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
  start(token: string, projectId: string, choice: ExportChoice): { result: Promise<ExportResult> } {
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
    const result = this.#run(token, projectId, choice, control)
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

  /**
   * The address the map's frame shows while the export tab is open
   * (specs/022-export-tab): the engine's plan for this choice, on the
   * project's page, with the platform's safe zones asked for exactly when
   * the preset has them. Not a job: nothing is captured, written or
   * reported, and a refusal is answered rather than thrown, in the engine's
   * own shape, so its sentence reaches the screen.
   *
   * The reset's guard applies as it does to an export, because this asks
   * the engine something while that guard is meant to keep it quiet.
   */
  async preview(projectId: string, choice: ExportChoice): Promise<ExportPreview> {
    try {
      // On both sides of the read: a reset confirmed while the record is
      // being read must still keep this from asking the engine anything.
      const refuseIfBlocked = (): void => {
        const blocked = this.#options.blocked?.() ?? null
        if (blocked !== null) throw engineError(ERROR_CODES.badCall, blocked, 'params')
      }
      refuseIfBlocked()
      const project = await this.#options.projects.get(projectId)
      refuseIfBlocked()
      if (project.layout === null || project.date === null)
        throw engineError(
          ERROR_CODES.badCall,
          'Lay the project out before previewing it.',
          'params',
        )
      const { engine } = this.#options
      // Which presets draw the platform's interface over the picture, and
      // which options a preset takes, are the engine's table, not the
      // app's: asked each time, since both calls are pure and instant,
      // rather than held across an engine restart.
      const entry = entryOf(await engine.request('export.presets').result, choice)
      const params = {
        key: project.feed,
        preset: choice.preset,
        page: pageUrl(project),
        date: project.date,
        options: planOptions(choice, entry, themeFor(project.theme), entry.safe_zones),
      } satisfies ExportPlanParams
      const plan = (await engine.request('export.plan', params).result) as PlannedJob
      if (!isObject(plan) || !isProjectPage(plan.url, project))
        throw engineError(
          ERROR_CODES.exportFailed,
          "The engine's plan names another page.",
          'export',
        )
      if (
        !Number.isInteger(plan.width) ||
        !Number.isInteger(plan.height) ||
        plan.width < 1 ||
        plan.height < 1
      )
        throw engineError(ERROR_CODES.exportFailed, "The engine's plan has no size.", 'export')
      return {
        ok: true,
        url: plan.url,
        width: plan.width,
        height: plan.height,
        notes: notesOf(plan),
      }
    } catch (error) {
      return { ok: false, error: toShape(normalise(error)) }
    }
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
    params: Record<string, unknown> | undefined,
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
    choice: ExportChoice,
    control: Control,
  ): Promise<{ result: ExportResult; path: string }> {
    const { projects, capture, framesRoot, exportFolder, log } = this.#options
    // Read once, at the start, and held: an export that was planned for one
    // folder must not be written to another because the plan's round trip
    // to the engine gave someone time to change it in Settings (A1-04).
    const destination = exportFolder()
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
    // Which options this preset takes is the engine's table: a view and a
    // start time are not sent beside a storyboard, whose first beat names
    // its own, and a JPEG still is made at standard quality only.
    const entry = entryOf(
      await this.#request<unknown>('export.presets', undefined, control),
      choice,
    )
    this.#stopIfCancelled(control)
    // The options are the person's, from the export tab, and the theme the
    // project's own. `safe` is never set here, whatever the preview showed:
    // the safe zones are a preview aid and never a deliverable (FR-006).
    const planParams = {
      key: project.feed,
      preset: choice.preset,
      page: pageUrl(project),
      date: project.date,
      options: planOptions(choice, entry, themeFor(project.theme)),
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
    // The plan is the engine's own answer to the table it just gave; one
    // that disagrees with it is not captured. A JPEG still the engine would
    // keep as captured would be PNG bytes under a `.jpg` name.
    if ((plan.mode === 'still') !== (entry.kind === 'still') || plan.format !== entry.format)
      throw engineError(
        ERROR_CODES.exportFailed,
        "The engine's plan does not match its preset.",
        'export',
      )
    if (plan.mode === 'still' && plan.format === 'jpg' && plan.keep === true)
      throw engineError(
        ERROR_CODES.exportFailed,
        'A JPEG still can only be made at standard quality.',
        'export',
      )
    if (typeof plan.filename !== 'string' || !FILENAME.test(plan.filename))
      throw engineError(
        ERROR_CODES.exportFailed,
        "The engine's plan names no usable file.",
        'export',
      )
    const total = frameTotal(job.beats, job.fps)
    const still = plan.mode === 'still'
    const notes = notesOf(plan)
    this.#emit(
      token,
      'plan',
      1,
      [
        still
          ? `Planned ${plan.filename}: a still.`
          : `Planned ${plan.filename}: ${total} frames at ${job.fps} frames per second.`,
        ...notes,
      ].join(' '),
    )

    // Two projects with one name and one feed resolve to one file. A later
    // export replaces an earlier one, as it does for a single project; two
    // at once would have two encodes writing the same file, so the second
    // is refused until the first has finished.
    const dest = join(destination, folderName(project.name, project.id), plan.filename)
    if (this.#writing.has(dest))
      throw engineError(
        ERROR_CODES.badCall,
        'Another export is writing this file; wait for it to finish.',
        'params',
      )
    // Claimed before every export, not only at startup: "Reset engine data"
    // removes the frames folder and its mark with it, and the capture makes
    // the folder again on its way to `<root>/<token>`, unmarked. Without
    // this, one reset would turn the sweep off for the life of the install.
    // Safe to repeat, because a claim never adopts a folder it did not make.
    //
    // Before the file is claimed below, not after: everything between that
    // claim and the `try` has to reach the `finally` that releases it, and
    // this does not have to be inside it.
    await claimFramesRoot(framesRoot).catch(() =>
      log('the frames folder could not be claimed; leftovers will not be cleared'),
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
      // A video is encoded from the folder of frames; a still from its one
      // frame, which is the file `export.encode` takes for a still plan.
      const encodeParams = {
        plan,
        source: still ? join(frames, STILL_FRAME) : frames,
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
      // The code, never the message: a filesystem error's message carries
      // the path, and nothing this module logs may.
      await rm(frames, { recursive: true, force: true }).catch((error: unknown) =>
        log(`could not remove the frames (${reasonOf(error)})`),
      )
    }
  }
}
