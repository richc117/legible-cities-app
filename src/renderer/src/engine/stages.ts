import type { Methods, RenderStageResult, StageName } from '../../../shared/protocol'

// One stage drawing per layout, stage and width per session. The engine
// draws a stored stage on request (render.stage, E15) and the answer does
// not change while the id and the set behind it stand; the set's `made`
// is part of the key, so a forced re-layout under the same id is drawn
// anew. The SVG is the engine's and is handed to a sandboxed frame; the
// counts are the engine's and are shown as sent.

export interface StageClient {
  request(
    method: 'render.stage',
    params: Methods['render.stage']['params'],
  ): { result: Promise<RenderStageResult> }
}

const cache = new Map<string, Promise<RenderStageResult>>()

export function stageFor(
  client: StageClient,
  key: string,
  layout: string,
  made: string | null,
  stage: StageName,
  width: number,
): Promise<RenderStageResult> {
  const slot = `${key}/${layout}/${made ?? ''}/${stage}/${width}`
  const held = cache.get(slot)
  if (held !== undefined) return held
  const pending = client.request('render.stage', { key, layout, stage, width }).result
  cache.set(slot, pending)
  pending.catch(() => cache.delete(slot))
  return pending
}

/** For a test: nothing remembered. */
export function forgetAllStages(): void {
  cache.clear()
}

// The pane's arithmetic, pure so a test can hold it: a transform of the
// frame from outside, never a script inside it.

export interface View {
  x: number
  y: number
  scale: number
}

export const MIN_SCALE = 0.25
export const MAX_SCALE = 8
export const STEP = 1.25
export const NUDGE = 40

export const clamp = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

/** Zoom by a factor about a point of the pane, so what is under it stays put. */
export function zoomAt(view: View, factor: number, at: { x: number; y: number }): View {
  const scale = clamp(view.scale * factor)
  const ratio = scale / view.scale
  return {
    scale,
    x: at.x - (at.x - view.x) * ratio,
    y: at.y - (at.y - view.y) * ratio,
  }
}

export const pan = (view: View, dx: number, dy: number): View => ({
  ...view,
  x: view.x + dx,
  y: view.y + dy,
})

/** The drawing fitted whole into the pane, centred. */
export function fit(
  drawing: { width: number; height: number },
  pane: { width: number; height: number },
): View {
  if (drawing.width <= 0 || drawing.height <= 0 || pane.width <= 0 || pane.height <= 0)
    return { x: 0, y: 0, scale: 1 }
  const scale = clamp(Math.min(pane.width / drawing.width, pane.height / drawing.height))
  return {
    scale,
    x: (pane.width - drawing.width * scale) / 2,
    y: (pane.height - drawing.height * scale) / 2,
  }
}

/** A key press on the pane, as a change of view; null for a key it does not take. */
export function keyed(
  view: View,
  key: string,
  pane: { width: number; height: number },
): View | null {
  const centre = { x: pane.width / 2, y: pane.height / 2 }
  switch (key) {
    case '+':
    case '=':
      return zoomAt(view, STEP, centre)
    case '-':
    case '_':
      return zoomAt(view, 1 / STEP, centre)
    case 'ArrowLeft':
      return pan(view, NUDGE, 0)
    case 'ArrowRight':
      return pan(view, -NUDGE, 0)
    case 'ArrowUp':
      return pan(view, 0, NUDGE)
    case 'ArrowDown':
      return pan(view, 0, -NUDGE)
    default:
      return null
  }
}
