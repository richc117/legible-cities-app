// The first-run check of the bundled tools (A6-02, specs/026-first-run-check):
// what crosses the bridge, and the sentences the log, the dialog, Settings
// and the diagnostics copy all say, kept here so the four agree.
//
// No Electron and no Node import: the page reads this too.

/** The two tools the check runs, in the order every list of them is written. */
export const FIRST_RUN_TOOLS = ['loom', 'ffmpeg'] as const

export type FirstRunTool = (typeof FIRST_RUN_TOOLS)[number]

/**
 * Why a tool failed. `missing`: its folder or file is not there. `install`:
 * what the app checks it with is not there, so the tool could not be judged.
 * `timeout`: it did not answer in time. `not-running`: it could not be
 * started, exited non-zero, was ended by a signal, or printed the wrong thing.
 */
export type FailureKind = 'missing' | 'install' | 'timeout' | 'not-running'

export type ToolCheck =
  | { outcome: 'running' }
  | { outcome: 'passed'; ms: number }
  | {
      outcome: 'failed'
      kind: FailureKind
      /** The person's sentence: what failed and what it stops. */
      sentence: string
      /** What happened, with no absolute path in it: it is shown on screen. */
      detail: string
      ms: number
    }
  | { outcome: 'skipped'; reason: string }

export interface FirstRunResult {
  /** Whether every tool that applies has an outcome other than `running`. */
  finished: boolean
  loom: ToolCheck
  ffmpeg: ToolCheck
}

/** The result before the check has started or finished: both running. */
export const RUNNING_RESULT: FirstRunResult = {
  finished: false,
  loom: { outcome: 'running' },
  ffmpeg: { outcome: 'running' },
}

/** How each tool is named to a person. */
export const TOOL_NAMES: Record<FirstRunTool, string> = { loom: 'LOOM', ffmpeg: 'ffmpeg' }

/** What a tool that will not run stops. */
export const TOOL_STOPS: Record<FirstRunTool, string> = {
  loom: 'maps cannot be laid out',
  ffmpeg: 'exports cannot be made',
}

/**
 * The sentence for a failure. `named` is whether a person named the tool
 * (SCHEMATIC_LOOM_BIN, SCHEMATIC_FFMPEG) rather than the app carrying it.
 */
export function failureSentence(tool: FirstRunTool, kind: FailureKind, named: boolean): string {
  const subject =
    tool === 'loom'
      ? named
        ? 'The LOOM tools SCHEMATIC_LOOM_BIN names'
        : 'The bundled LOOM tools'
      : named
        ? 'The ffmpeg SCHEMATIC_FFMPEG names'
        : 'The bundled ffmpeg'
  const plural = tool === 'loom'
  const stops = TOOL_STOPS[tool]
  switch (kind) {
    case 'missing':
      return `${subject} ${plural ? 'are' : 'is'} missing, so ${stops}.`
    case 'timeout':
      return `${subject} did not answer in time, so ${stops}.`
    case 'install':
      return `This installation is incomplete: the small feed the app checks LOOM with is missing, so the LOOM tools could not be checked and ${stops}.`
    case 'not-running':
      return `${subject} did not run, so ${stops}.`
  }
}

/** The tools whose check failed, in order. */
export function failedTools(result: FirstRunResult): FirstRunTool[] {
  return FIRST_RUN_TOOLS.filter((tool) => result[tool].outcome === 'failed')
}

/** Whether the check has finished with a failure a person must be told about. */
export function needsTelling(result: FirstRunResult): boolean {
  return result.finished && failedTools(result).length > 0
}

/** What became of one tool, as Settings writes it beside the tool's name. */
export function describeOutcome(check: ToolCheck): string {
  switch (check.outcome) {
    case 'running':
      return 'checking…'
    case 'passed':
      return `ran (${check.ms} ms).`
    case 'skipped':
      return `not checked (${check.reason}).`
    case 'failed':
      return `${check.sentence} ${check.detail}`
  }
}

/** One line for one tool, as the diagnostics copy writes it. */
export function describeCheck(tool: FirstRunTool, check: ToolCheck): string {
  return `${TOOL_NAMES[tool]}: ${describeOutcome(check)}`
}

/** The check as a whole, in one sentence. */
export function summarize(result: FirstRunResult): string {
  if (!result.finished) return 'Checking the bundled LOOM and ffmpeg…'
  const outcomes = FIRST_RUN_TOOLS.map((tool) => result[tool].outcome)
  if (outcomes.every((o) => o === 'passed')) return 'The bundled LOOM and ffmpeg ran.'
  if (outcomes.every((o) => o === 'skipped')) {
    const reasons = FIRST_RUN_TOOLS.map((tool) => {
      const check = result[tool]
      return check.outcome === 'skipped' ? check.reason : ''
    })
    return reasons.every((reason) => reason.startsWith('development:'))
      ? 'The check did not run (development: no bundled tools named).'
      : `The check did not run (${reasons[0]}).`
  }
  if (outcomes.includes('failed')) return 'Not every tool the app needs ran.'
  return 'The tools this run names ran; the others were not checked.'
}
