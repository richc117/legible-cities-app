// A job: one layout run, rebuild, export or feed add of this session, in
// one read-only shape the inspector can list whatever kind of run it came
// from (A1-03, specs/024-jobs). No Electron and no React: the runs derive
// their job from what they already hold, the registry in the renderer lists
// them, and the main process knows only the bound on the text a job's log
// is copied as.

import { withoutPaths, isEngineErrorShape } from './engine'
import type { StageState } from './layout'

export type JobKind = 'layout' | 'rebuild' | 'export' | 'feed-add'

export type JobState = 'running' | 'done' | 'failed' | 'cancelled'

/** One stage as the progress line draws it; the run's own stages, copied. */
export interface JobStage {
  id: string
  label: string
  state: StageState
}

export interface Job {
  /** Unique for the session; a new attempt of the same run is a new job. */
  id: string
  kind: JobKind
  /** The project the run belongs to; null for a feed add. */
  projectId: string | null
  /** The project's name, filled in by whoever lists the jobs; the run knows only the id. */
  projectName: string | null
  /** What the job is, in a few words: "Layout run", "Export as instagram-reel". */
  label: string
  state: JobState
  stages: JobStage[]
  /** The last sentence the run reported. */
  message: string | null
  /** The engine's sentence for a person when the job failed, paths taken out. */
  hint: string | null
  /** The engine's detail when the job failed, paths taken out; null when it said nothing more. */
  detail: string | null
  /** The last `MAX_LOG_LINES` lines of the job's log. */
  log: string[]
  /** How many earlier lines were dropped to keep the log that short. */
  dropped: number
  /** Milliseconds since the epoch. */
  started: number
  ended: number | null
  /** The detail as the engine sent it, paths and all, for the copied log only. */
  rawDetail: string | null
}

/** The finished jobs a session keeps, newest first; running jobs are never dropped. */
export const MAX_FINISHED = 20

/** The lines of log one job keeps. LOOM can print thousands. */
export const MAX_LOG_LINES = 200

/** The most text "Copy log" may send to the main process, in bytes of UTF-8. */
export const JOB_LOG_BYTES = 256 * 1024

/** The longest single log line kept, in characters; a longer one is cut and says so. */
export const MAX_LOG_LINE_CHARS = 2000

let sequence = 0

/** A job id no other job this session has. */
export function nextJobId(): string {
  sequence += 1
  return `job-${sequence}`
}

export const isFinished = (state: JobState): boolean => state !== 'running'

/** The last lines of a log, and how many came before them. */
export class LogBuffer {
  #lines: string[] = []
  #dropped = 0
  readonly #max: number

  constructor(max = MAX_LOG_LINES) {
    this.#max = max
  }

  push(line: string): void {
    const kept =
      line.length > MAX_LOG_LINE_CHARS ? `${line.slice(0, MAX_LOG_LINE_CHARS)} [line cut]` : line
    this.#lines.push(kept)
    if (this.#lines.length > this.#max) {
      this.#lines.shift()
      this.#dropped += 1
    }
  }

  get lines(): string[] {
    return [...this.#lines]
  }

  get dropped(): number {
    return this.#dropped
  }
}

/**
 * The engine's two sentences about a failure: the hint a person reads and
 * the detail a report needs. Both have their paths taken out for a screen;
 * the detail is also kept as sent, for the copied log, where the main
 * process writes the home folder as `~`.
 */
export function failureOf(reason: unknown): {
  detail: string | null
  rawDetail: string | null
} {
  if (!isEngineErrorShape(reason)) return { detail: null, rawDetail: null }
  const raw = reason.data?.detail
  if (typeof raw !== 'string' || raw === '') return { detail: null, rawDetail: null }
  return { detail: withoutPaths(raw), rawDetail: raw }
}

/** Running jobs first, newest first; then the finished ones, newest first. */
export function orderJobs(jobs: readonly Job[]): Job[] {
  const running = jobs.filter((j) => j.state === 'running').sort((a, b) => b.started - a.started)
  const finished = jobs
    .filter((j) => j.state !== 'running')
    .sort((a, b) => (b.ended ?? b.started) - (a.ended ?? a.started))
  return [...running, ...finished]
}

/**
 * The finished list with one more job at its head, at most `MAX_FINISHED`
 * long. A job already there is not added twice.
 */
export function keepFinished(list: readonly Job[], job: Job, max = MAX_FINISHED): Job[] {
  if (list.some((j) => j.id === job.id)) return [...list]
  return [job, ...list].slice(0, max)
}

const STATE_WORDS: Record<JobState, string> = {
  running: 'running',
  done: 'finished',
  failed: 'failed',
  cancelled: 'cancelled',
}

/** A job's state in the words the screen and the copy use. */
export const describeJobState = (state: JobState): string => STATE_WORDS[state]

/** Who the job is for: the project's name, or what a feed add is. */
export function jobSubject(job: Pick<Job, 'projectId' | 'projectName' | 'kind'>): string {
  if (job.kind === 'feed-add') return 'Feeds'
  return job.projectName ?? 'A project'
}

/**
 * The one sentence said when a job ends, on every screen: who it was for,
 * what it was, and how it ended. Short, and never the engine's hint, which
 * the run's own screen and the inspector already show in full; a sentence
 * that repeated it would be read twice.
 */
export function endSentence(job: Job): string {
  return `${jobSubject(job)}: ${job.label}, ${describeJobState(job.state)}.`
}

/**
 * The jobs that have ended since the ids in `seen` were noted, oldest end
 * first, and `seen` with them added. A job is announced once, however many
 * times the list is read.
 */
export function newlyEnded(
  jobs: readonly Job[],
  seen: ReadonlySet<string>,
): { ended: Job[]; seen: Set<string> } {
  const next = new Set(seen)
  const ended = jobs
    .filter((job) => job.state !== 'running' && !seen.has(job.id))
    .sort((a, b) => (a.ended ?? a.started) - (b.ended ?? b.started))
  for (const job of ended) next.add(job.id)
  return { ended, seen: next }
}

const encoder = new TextEncoder()
const bytesOf = (text: string): number => encoder.encode(text).length

const iso = (ms: number | null): string => (ms === null ? 'not yet' : new Date(ms).toISOString())

/**
 * What "Copy log" sends to the main process: the label, the state, the
 * times, the stages, the engine's sentences and the log lines, with a note
 * when earlier lines were dropped. Composed on the page, because the page
 * holds the job; redacted in the main process, because only that side is
 * trusted. Kept under `JOB_LOG_BYTES` by dropping the oldest lines first.
 */
export function composeJobLog(job: Job): string {
  const head = [
    `# ${job.label}, ${jobSubject(job)}`,
    '',
    `State: ${describeJobState(job.state)}`,
    `Started: ${iso(job.started)}`,
    `Ended: ${iso(job.ended)}`,
    '',
    '## Stages',
    '',
    ...job.stages.map((s) => `${s.label}: ${s.state}`),
    '',
  ]
  if (job.message !== null) head.push(`Last message: ${job.message}`, '')
  if (job.hint !== null) head.push('## Hint', '', job.hint, '')
  const detail = job.rawDetail ?? job.detail
  if (detail !== null && detail !== job.hint) head.push('## Detail', '', detail, '')

  const logTitle =
    job.kind === 'export'
      ? "## Progress\n\nAn export has no engine log of its own; these are the export's progress sentences."
      : '## Log'
  let lines = [...job.log]
  let dropped = job.dropped
  const compose = (): string => {
    const note =
      dropped > 0
        ? [
            `${dropped} earlier ${dropped === 1 ? 'line was' : 'lines were'} dropped; engine.log in the logs folder has the rest.`,
            '',
          ]
        : []
    const body = lines.length === 0 ? ['No log lines were received.'] : lines
    return [...head, logTitle, '', ...note, ...body, ''].join('\n')
  }
  let text = compose()
  while (bytesOf(text) > JOB_LOG_BYTES && lines.length > 0) {
    const cut = Math.max(1, Math.ceil(lines.length / 10))
    lines = lines.slice(cut)
    dropped += cut
    text = compose()
  }
  // A head alone over the bound is a detail the engine made enormous; the
  // copy is cut rather than refused.
  if (bytesOf(text) > JOB_LOG_BYTES) {
    const marker = '\n[cut to fit]\n'
    const room = JOB_LOG_BYTES - bytesOf(marker)
    while (bytesOf(text) > room) text = text.slice(0, Math.floor(text.length * 0.9))
    text = `${text}${marker}`
  }
  return text
}

/** A sentence for a screen: its paths taken out, or nothing. */
export function screenPaths(sentence: string | null): string | null {
  return sentence === null ? null : withoutPaths(sentence)
}
