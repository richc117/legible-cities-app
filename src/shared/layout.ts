// A layout run: the stages it goes through, what it writes, and the one
// value the app derives rather than the engine.
// Contracts: specs/007-layout-run/contracts/run.md and bridge.md.

/**
 * The stages a run reports, in order.
 *
 * This mirrors the engine's own pipeline at protocol 1: the four layout
 * tools, then the four the map build adds. It is a coupling the app cannot
 * avoid, because a line has to be drawn before anything has finished, and
 * one it must not hide: a gated test lays a project out against the real
 * engine and asserts these names in this order, so a pipeline that changes
 * shape fails a test rather than drawing a wrong picture.
 */
export const LAYOUT_STAGES = [
  'gtfs2graph',
  'topo',
  'loom',
  'octi',
  'schedule',
  'render',
  'animate',
  'write',
] as const

export type LayoutStage = (typeof LAYOUT_STAGES)[number]

/** The four the layout call reports; the map call repeats them. */
export const GRAPH_STAGES = LAYOUT_STAGES.slice(0, 4) as readonly LayoutStage[]

export type StageState = 'pending' | 'running' | 'done' | 'failed'

export type RunState = 'idle' | 'running' | 'done' | 'failed' | 'cancelled'

/** What the renderer hands the main process when a run has finished. */
export interface LayoutDone {
  /** The service day the map was built for, YYYY-MM-DD. */
  date: string
  /** The stage graphs the engine named, in its own stage order. */
  paths: string[]
}

/** What the main process answers with once a run's record is written. */
export interface LayoutResult {
  record: import('./project').ProjectRecord
  /** True when the project had a different layout stored before this run. */
  changed: boolean
}

/** A layout identifier: the SHA-256 of the stage graphs, as hex. */
export function isLayoutId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

/** The first eight characters, which is what a screen shows. */
export function shortLayoutId(id: string): string {
  return id.slice(0, 8)
}
