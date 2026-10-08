import type { Methods, RenderStageResult, StageName } from '../../../shared/protocol'

// One stage drawing per layout, stage, width and day per session. The engine
// draws a stored stage on request (render.stage, E15) and the answer does
// not change while the id and the set behind it stand; the set's `made`
// is part of the key, so a forced re-layout under the same id is drawn
// anew. The SVG is the engine's and is handed to a sandboxed frame; the
// counts are the engine's and are shown as sent. The day is part of the key
// because the description's minutes are of a day (issue 105): the same
// drawing asked for another day answers other minutes, and the engine reads
// a timetable to say them.

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
  date: string | null = null,
): Promise<RenderStageResult> {
  const slot = `${key}/${layout}/${made ?? ''}/${stage}/${width}/${date ?? ''}`
  const held = cache.get(slot)
  if (held !== undefined) return held
  // Without a day the field is left out: the engine refuses a null, and
  // answers an untimed description, which the words leave out.
  const params: Methods['render.stage']['params'] = { key, layout, stage, width }
  if (date !== null) params.date = date
  const pending = client.request('render.stage', params).result
  cache.set(slot, pending)
  pending.catch(() => cache.delete(slot))
  return pending
}

/** For a test: nothing remembered. */
export function forgetAllStages(): void {
  cache.clear()
}

// What the pane is made of, kept here beside its arithmetic and not in
// `StageView.tsx`: the end-to-end specs import these, and a spec loads its
// imports with Playwright's own loader, which cannot read a component that
// imports an icon through `import.meta.glob`. A file under `tests/e2e` or
// `tests/support` imports this module and never a component.

export const STAGES: { stage: StageName; label: string; gloss: string }[] = [
  { stage: 'gtfs2graph', label: 'gtfs2graph', gloss: 'as the feed draws its routes' },
  { stage: 'loom', label: 'loom', gloss: 'lines sorted onto shared track' },
]

/**
 * What the two buttons are, said once under the heading (issue 282). The
 * names stay the engine's, so a stage here matches a stage in its log; the
 * sentence is what says what they are and how they relate to the map below. `topo` and `octi` are not offered: topo is
 * gtfs2graph with platforms merged, a difference of counts and not of
 * picture, and octi is the schematic the viewer already shows.
 */
export const STAGES_EXPLAINED =
  'The map below is the schematic. These are two earlier stages of the same layout, drawn where the routes really run: gtfs2graph is the network as the feed draws it, and loom is the same network after the engine has sorted the lines onto shared track, before anything is straightened. The names are the engine’s, so a stage here matches a stage in its log.'

/** The pane's frame takes no permission at all: the whole of its sandbox. */
export const STAGE_SANDBOX = ''

/** The width the engine draws at, whatever the pane's: wide enough that a large network stays sharp when zoomed. */
export const DRAW_WIDTH = 1600

/**
 * The frame's document. srcdoc is parsed as HTML whatever it holds, so the
 * engine's SVG would land inline in a body with the browser's margin and
 * grow scrollbars; this is the chrome around it, not the drawing. The
 * frame's policy is the interface's own (a srcdoc document inherits it),
 * so loosening csp() in the main process loosens this frame too.
 */
export function frameDocument(svg: string): string {
  return (
    '<!doctype html><style>html,body{margin:0;overflow:hidden;background:transparent}' +
    'svg{display:block}</style>' +
    svg
  )
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
