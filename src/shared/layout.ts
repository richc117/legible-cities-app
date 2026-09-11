// A layout run: the stages it goes through and what it writes.
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

/** What the renderer hands the main process when a layout run has finished. */
export interface LayoutDone {
  /** The service day the map was built for, YYYY-MM-DD. */
  date: string
  /** The layout's id, as the engine answered it: the hash of the layout's inputs. */
  layout: string
  /** The feed's window and the engine's day, as feeds.service answered them. */
  service: import('./project').ServiceWindow
}

/** What the main process answers with once a run's record is written. */
export interface LayoutResult {
  record: import('./project').ProjectRecord
  /** True when the project had a different layout stored before this run. */
  changed: boolean
}

/**
 * A layout identifier: the engine's, the SHA-256 of everything that went
 * into the layout (the feed's bytes, the mode, the agency, the label
 * options, the LOOM build), as hex. Since ADR-033 it is the engine's own;
 * a record written before that carries the app's digest of the stage
 * graphs, the same shape and a different value, which the next run replaces.
 */
export function isLayoutId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

/** The first eight characters, which is what a screen shows. */
export function shortLayoutId(id: string): string {
  return id.slice(0, 8)
}
