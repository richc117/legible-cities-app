import { isEngineErrorShape, ERROR_CODES, type EngineState } from '../../../shared/engine'
import {
  EXPORT_STAGES,
  type ExportProgress,
  type ExportChoice,
  type ExportResult,
} from '../../../shared/export'
import { failureOf, LogBuffer, nextJobId, screenPaths, type Job } from '../../../shared/jobs'
import type { RunState } from '../../../shared/layout'
import type { ProjectRecord } from '../../../shared/project'
import type { Stage } from '../ProgressLine'

// One export for one project, seen from the page, with no React in it. The
// export itself runs in the main process, where the capture lives (ADR-024);
// this is the state the page keeps of it: the three stages as they are
// reported, the last sentence, and how it ended. The bridge underneath is
// the whole of what it knows (specs/010-export/contracts/bridge.md).
//
// Unlike the layout run, a report here names the stage that is running, and
// says how far along it is, because the main process is the one reporting
// and it knows. A stage is done when a later one is reported or the export
// ends well.

export interface ExportSnapshot {
  state: RunState
  stages: Stage[]
  /** The last sentence the export reported. */
  message: string | null
  /** The sentence for a person, when the export failed. */
  error: string | null
  /** The file's name, once it has been written. Never its path. */
  file: string | null
  /**
   * True when the engine stopped while writing the file: its own cleanup
   * died with it, so a partial file may be left where the reel would go.
   */
  left: boolean
}

/** What the page can do with an export, and no more; a test passes a stub. */
export interface ExportBridge {
  run(projectId: string, choice: ExportChoice): { id: string; result: Promise<ExportResult> }
  cancel(id: string): Promise<void>
  reveal(id: string): Promise<void>
  onProgress(listener: (progress: ExportProgress) => void): () => void
}

export const freshStages = (): Stage[] =>
  EXPORT_STAGES.map((label) => ({ id: label, label, state: 'pending' as const }))

/** Every stage before the named one done, that one running, the rest waiting. */
export function stagesAt(stages: Stage[], running: string): Stage[] {
  const at = stages.findIndex((s) => s.id === running)
  if (at === -1) return stages
  return stages.map((stage, i) => ({
    ...stage,
    state: i < at ? ('done' as const) : i === at ? ('running' as const) : ('pending' as const),
  }))
}

/** The sentence a person reads for a failure: the engine's, or the app's; never a path. */
export function sentenceFor(reason: unknown): string {
  if (isEngineErrorShape(reason)) return reason.data?.hint ?? reason.message
  return reason instanceof Error ? reason.message : 'The export did not finish.'
}

/** The engine died or stopped answering: whatever it was writing, it did not clean up. */
const ENGINE_GONE = new Set<number>([ERROR_CODES.engineExited, ERROR_CODES.inactive])

const IDLE: ExportSnapshot = {
  state: 'idle',
  stages: freshStages(),
  message: null,
  error: null,
  file: null,
  left: false,
}

/** What the run keeps about its latest attempt beyond the snapshot, for the inspector (A1-03). */
interface Attempt {
  id: string
  label: string
  projectId: string
  started: number
  ended: number | null
  /** The export's progress sentences: it has no engine log of its own. */
  log: LogBuffer
  detail: string | null
  rawDetail: string | null
}

export class ExportRun {
  #snapshot: ExportSnapshot = IDLE
  #listeners = new Set<(s: ExportSnapshot) => void>()
  #attempt: Attempt | null = null
  /** The export in flight, by the bridge's token. */
  #id: string | null = null
  /** The last export that wrote a file, for the reveal. */
  #written: string | null = null
  readonly #bridge: ExportBridge
  readonly #off: () => void

  constructor(bridge: ExportBridge) {
    this.#bridge = bridge
    // One subscription for the run's whole life, filtered by the id of the
    // export in flight, so a report for another project's export is ignored.
    this.#off = bridge.onProgress((progress) => {
      if (progress.id === this.#id) this.#report(progress)
    })
  }

  get snapshot(): ExportSnapshot {
    return this.#snapshot
  }

  subscribe(listener: (s: ExportSnapshot) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #set(patch: Partial<ExportSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch }
    const attempt = this.#attempt
    if (attempt !== null && attempt.ended === null && this.#snapshot.state !== 'running')
      attempt.ended = Date.now()
    for (const listener of this.#listeners) listener(this.#snapshot)
  }

  /**
   * The latest attempt as a job, or null when the export has never
   * started. Derived from the snapshot, so the inspector and the export tab
   * cannot disagree about a state (specs/024-jobs).
   */
  job(): Job | null {
    const attempt = this.#attempt
    const { state, stages, message, error } = this.#snapshot
    if (attempt === null || state === 'idle') return null
    const failed = state === 'failed'
    return {
      id: attempt.id,
      kind: 'export',
      projectId: attempt.projectId,
      projectName: null,
      label: attempt.label,
      state,
      stages: stages.map(({ id, label, state: s }) => ({ id, label, state: s })),
      message,
      hint: failed ? screenPaths(error) : null,
      detail: failed ? attempt.detail : null,
      rawDetail: failed ? attempt.rawDetail : null,
      log: attempt.log.lines,
      dropped: attempt.log.dropped,
      started: attempt.started,
      ended: attempt.ended,
    }
  }

  /**
   * The project, the engine's state and what to export, as they are at this
   * moment. The choice is the export tab's (A5-01); the main process checks
   * it again before the engine sees it.
   */
  start(project: ProjectRecord, engine: EngineState | null, choice: ExportChoice): void {
    if (this.#snapshot.state === 'running') return
    this.#attempt = {
      id: nextJobId(),
      label: `Export as ${choice.preset}`,
      projectId: project.id,
      started: Date.now(),
      ended: null,
      log: new LogBuffer(),
      detail: null,
      rawDetail: null,
    }

    if (engine === null || engine.state !== 'ready') {
      this.#set({
        state: 'failed',
        error:
          engine === null
            ? 'The engine is still starting. Try again in a moment.'
            : `The engine is not ready to export: ${engine.state}.`,
      })
      return
    }
    if (project.layout === null) {
      this.#set({ state: 'failed', error: 'Lay the project out before exporting it.' })
      return
    }

    const started = freshStages()
    started[0] = { ...started[0], state: 'running' }
    this.#set({
      state: 'running',
      stages: started,
      message: null,
      error: null,
      file: null,
      left: false,
    })

    const request = this.#bridge.run(project.id, choice)
    this.#id = request.id
    request.result.then(
      (result) => {
        if (this.#id !== request.id) return
        this.#id = null
        this.#written = request.id
        this.#set({
          state: 'done',
          stages: this.#snapshot.stages.map((s) => ({ ...s, state: 'done' as const })),
          file: result.file,
        })
      },
      (reason: unknown) => {
        if (this.#id !== request.id) return
        this.#id = null
        if (isEngineErrorShape(reason) && reason.code === ERROR_CODES.cancelled) {
          this.#set({
            state: 'cancelled',
            stages: this.#snapshot.stages.map((s) =>
              s.state === 'running' ? { ...s, state: 'pending' as const } : s,
            ),
          })
          return
        }
        if (this.#attempt !== null) Object.assign(this.#attempt, failureOf(reason))
        const encoding = this.#snapshot.stages.some(
          (s) => s.id === 'encode' && s.state === 'running',
        )
        this.#set({
          state: 'failed',
          error: sentenceFor(reason),
          left: encoding && isEngineErrorShape(reason) && ENGINE_GONE.has(reason.code),
          stages: this.#snapshot.stages.map((s) =>
            s.state === 'running' ? { ...s, state: 'failed' as const } : s,
          ),
        })
      },
    )
  }

  #report(progress: ExportProgress): void {
    // One line per stage, the newest report replacing the last: the plan's
    // sentence survives a capture that reports every frame.
    if (progress.message !== '')
      this.#attempt?.log.push(`${progress.stage}: ${progress.message}`, progress.stage)
    this.#set({
      stages: stagesAt(this.#snapshot.stages, progress.stage),
      message: progress.message === '' ? this.#snapshot.message : progress.message,
    })
  }

  cancel(): void {
    if (this.#snapshot.state !== 'running' || this.#id === null) return
    void this.#bridge.cancel(this.#id).catch(() => {
      // An id the main side no longer knows is an export that has just
      // ended; its result carries the outcome.
    })
  }

  /** Show the file that was written; nothing until there is one. */
  reveal(): void {
    if (this.#snapshot.state !== 'done' || this.#written === null) return
    void this.#bridge.reveal(this.#written).catch(() => {})
  }

  /** Releases the bridge subscription. The view calls this when it goes. */
  dispose(): void {
    this.#listeners.clear()
    this.#off()
  }
}
