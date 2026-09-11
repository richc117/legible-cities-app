import { isEngineErrorShape, ERROR_CODES, type EngineState } from '../../../shared/engine'
import {
  EXPORT_STAGES,
  type ExportProgress,
  type ExportResult,
  type OfferedPreset,
} from '../../../shared/export'
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
  run(projectId: string, preset: OfferedPreset): { id: string; result: Promise<ExportResult> }
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

export class ExportRun {
  #snapshot: ExportSnapshot = IDLE
  #listeners = new Set<(s: ExportSnapshot) => void>()
  /** The export in flight, by the bridge's token. */
  #id: string | null = null
  /** The last export that wrote a file, for the reveal. */
  #written: string | null = null
  readonly #bridge: ExportBridge
  readonly #preset: OfferedPreset
  readonly #off: () => void

  constructor(bridge: ExportBridge, preset: OfferedPreset) {
    this.#bridge = bridge
    this.#preset = preset
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
    for (const listener of this.#listeners) listener(this.#snapshot)
  }

  /** The project and the engine's state as they are at this moment. */
  start(project: ProjectRecord, engine: EngineState | null): void {
    if (this.#snapshot.state === 'running') return

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

    const request = this.#bridge.run(project.id, this.#preset)
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
