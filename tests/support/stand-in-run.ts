// A layout run as far as a cell reads one, for the rendered unit tests
// (ADR-059): its snapshot, a way to hear it change, and the four cheap
// redraws, which start (`running`, of their kind) or are refused at once
// (`failed`, of their kind, with the engine's sentence) as `LayoutRun.#begin`
// does. It is the one copy; `tests/support/render.tsx` draws a cell with a
// fresh one unless a test hands it its own.

import { vi } from 'vitest'
import type { RunState } from '../../src/shared/layout'
import type {
  LineOrder,
  Palette,
  ProjectLines,
  ProjectRecord,
  ProjectStyle,
} from '../../src/shared/project/types'
import type { RunSnapshot } from '../../src/renderer/src/engine/layoutRun'

/** Which cheap redraw a snapshot is of. */
export type Kind = Pick<RunSnapshot, 'recoloured' | 'optioned' | 'reordered' | 'restyled'>

export const NO_KIND: Kind = {
  recoloured: false,
  optioned: false,
  reordered: false,
  restyled: false,
}

/** The engine's own sentence for a start it refuses at once (`LayoutRun.#begin`). */
export const REFUSAL = 'The engine is still starting. Try again in a moment.'

/** A run snapshot in full, as `LayoutRun` keeps one, at `state` and of `kind`. */
export const snap = (
  state: RunState,
  kind: Partial<Kind> = {},
  error: string | null = null,
): RunSnapshot =>
  ({
    state,
    stages: [],
    message: null,
    error,
    changed: false,
    relaid: false,
    forced: false,
    replaced: false,
    rebuilt: false,
    ...NO_KIND,
    ...kind,
    unkept: false,
    day: null,
    report: null,
    download: null,
    feedMissing: false,
    layout: null,
  }) as RunSnapshot

/**
 * A run as far as a panel reads one. `moveQuietly` changes its snapshot
 * without telling anyone, which is a run that has moved on since the last
 * render: the listener's re-render has not happened yet.
 */
export class StandInRun {
  snapshot: RunSnapshot = snap('idle')
  /** What a redraw's start does: start, or be refused at once as the run does. */
  starts: 'run' | 'refuse' = 'run'
  readonly #listeners = new Set<(snapshot: RunSnapshot) => void>()
  readonly recolour = vi.fn((_p: ProjectRecord, _e: unknown, palette: Palette) => {
    void palette
    this.#begin({ recoloured: true })
  })
  readonly redrawLines = vi.fn((_p: ProjectRecord, _e: unknown, lines: ProjectLines) => {
    void lines
    this.#begin({ recoloured: true, optioned: true })
  })
  readonly reorder = vi.fn((_p: ProjectRecord, _e: unknown, order: LineOrder) => {
    void order
    this.#begin({ reordered: true })
  })
  readonly restyle = vi.fn((_p: ProjectRecord, _e: unknown, style: ProjectStyle) => {
    void style
    this.#begin({ restyled: true })
  })
  #begin(kind: Partial<Kind>): void {
    if (this.snapshot.state === 'running') return
    this.move(this.starts === 'run' ? snap('running', kind) : snap('failed', kind, REFUSAL))
  }
  subscribe(listener: (snapshot: RunSnapshot) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
  moveQuietly(next: RunSnapshot): void {
    this.snapshot = next
  }
  move(next: RunSnapshot): void {
    this.moveQuietly(next)
    for (const listener of this.#listeners) listener(this.snapshot)
  }
}
