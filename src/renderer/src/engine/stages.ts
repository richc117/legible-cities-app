import type { Methods, RenderStageResult, StageName } from '../../../shared/protocol'
import type { RunSnapshot } from './layoutRun'

// One stage drawing per layout, set, stage, width and day per session. The
// engine draws a stored stage on request (render.stage, E15) and the answer
// does not change while the id and the set behind it stand; the set is part
// of the key, so a forced re-layout under the same id is drawn anew. The
// set is the stored one's `made`, or, while a layout run is in flight, the
// run's own identity (`stageSet`, issue 382), because the engine draws a
// running build's stages from the build and `made` is still the stored
// set's until the run ends. The SVG is the engine's and is handed to a
// sandboxed frame; the counts are the engine's and are shown as sent. The
// day is part of the key because the description's minutes are of a day
// (issue 105): the same drawing asked for another day answers other
// minutes, and the engine reads a timetable to say them.

export interface StageClient {
  request(
    method: 'render.stage',
    params: Methods['render.stage']['params'],
  ): { result: Promise<RenderStageResult> }
}

const cache = new Map<string, Promise<RenderStageResult>>()

/**
 * The set a drawing is cached under (issue 382, specs/032 FR-005): the
 * stored set's `made`, or, while a layout run is in flight, the run's own
 * identity in its place. During a forced re-layout `made` is still the
 * stored set's, and a run that was stopped leaves it as it was for the next
 * one, so a drawing taken from a build would otherwise be answered for the
 * stored set, or for another build, and theirs for it. A run's is written
 * so that no `made` can be the same: the engine writes `made` as an ISO
 * time, which has no space in it.
 */
export function stageSet(made: string | null, run: string | null): string | null {
  return run === null ? made : runSet(run)
}

/** A run's own set, as `stageSet` writes it. */
export const runSet = (run: string): string => `run ${run}`

const slotOf = (
  key: string,
  layout: string,
  set: string | null,
  stage: StageName,
  width: number,
  date: string | null,
): string => JSON.stringify([key, layout, set, stage, width, date])

export function stageFor(
  client: StageClient,
  key: string,
  layout: string,
  set: string | null,
  stage: StageName,
  width: number,
  date: string | null = null,
): Promise<RenderStageResult> {
  const slot = slotOf(key, layout, set, stage, width, date)
  const held = cache.get(slot)
  if (held !== undefined) return held
  // Without a day the field is left out: the engine refuses a null, and
  // answers an untimed description, which the words leave out.
  const params: Methods['render.stage']['params'] = { key, layout, stage, width }
  if (date !== null) params.date = date
  const pending = client.request('render.stage', params).result
  cache.set(slot, pending)
  // A refusal is not remembered, so the next ask asks again; only this
  // ask's own entry goes, never one made for the slot since it was forgotten.
  pending.catch(() => {
    if (cache.get(slot) === pending) cache.delete(slot)
  })
  return pending
}

/**
 * Every drawing held for one set, forgotten: a layout run's, once the run
 * has ended, since the build it drew from is in the store or gone and the
 * view reads the store from then on (issue 382, FR-006).
 */
export function forgetStagesOf(set: string): void {
  for (const slot of [...cache.keys()]) {
    if ((JSON.parse(slot) as unknown[])[2] === set) cache.delete(slot)
  }
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

/** A stage as the pane names it: the engine's name, and what it is. */
export interface StageWords {
  stage: StageName
  label: string
  gloss: string
}

/**
 * The four stages of a layout in the engine's order, with what the pane
 * says each one is. Two are offered as buttons (`STAGES`); a layout run
 * draws all four as it reaches them (issue 382), so `topo` and `octi` have
 * words too, taken from what `docs/DESIGN.md` 8.2 says they are.
 */
export const LAYOUT_STAGE_WORDS: readonly StageWords[] = [
  { stage: 'gtfs2graph', label: 'gtfs2graph', gloss: 'as the feed draws its routes' },
  { stage: 'topo', label: 'topo', gloss: 'with platforms merged' },
  { stage: 'loom', label: 'loom', gloss: 'lines sorted onto shared track' },
  { stage: 'octi', label: 'octi', gloss: 'straightened into the schematic' },
]

/** A stage's words; any stage the engine names has them. */
export const wordsOf = (stage: StageName): StageWords =>
  LAYOUT_STAGE_WORDS.find((s) => s.stage === stage) ?? LAYOUT_STAGE_WORDS[0]

/** The two stages a person chooses between, as buttons. */
export const STAGES: StageWords[] = LAYOUT_STAGE_WORDS.filter(
  (s) => s.stage === 'gtfs2graph' || s.stage === 'loom',
)

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

// The layout as it solves (issue 382, specs/032). While a layout run goes,
// the pane draws each stage as the run reports it, from the engine's own
// `render.stage` over the build. What decides what to ask, what to show and
// what to say is here, pure, so a table can hold it; `StageView.tsx` keeps
// the requests in flight and draws what these answer.

/** The four stages of a layout, in the engine's order. */
export const LAYOUT_ORDER: readonly StageName[] = LAYOUT_STAGE_WORDS.map((s) => s.stage)

const isStageName = (value: unknown): value is StageName =>
  typeof value === 'string' && (LAYOUT_ORDER as readonly string[]).includes(value)

/** A layout run as the stage view sees it, from the first report that named its layout. */
export interface Reveal {
  /** The run's own identity, its job id: what its drawings are cached under (FR-005). */
  run: string
  /** The layout the run's reports named. */
  layout: string
  state: 'running' | 'done' | 'cancelled' | 'failed'
  /** The layout's stages the run has reported, in the engine's order. */
  reported: StageName[]
  /** The layout stage the run is at; null once the four are reported. */
  running: StageName | null
}

type RevealFacts = Pick<
  RunSnapshot,
  'state' | 'stages' | 'layout' | 'rebuilt' | 'recoloured' | 'reordered' | 'restyled'
>

/**
 * The run seen as a reveal, or null where there is nothing to reveal: no
 * run, a run that has named no layout yet, or a redraw, whose map call
 * names the stored layout on its replays and lays nothing out. A finished
 * run is a reveal only until the record it wrote has been read back
 * (`settling`), and the view holds nothing meanwhile, so it goes from the
 * build's drawings to the store's with no moment of the stored set it
 * replaced, nor of a project with no layout; a stopped one stays, for the
 * view to say what went (FR-006).
 */
export function revealOf(run: RevealFacts, job: string | null, settling: boolean): Reveal | null {
  if (job === null || run.layout === null) return null
  if (run.rebuilt || run.recoloured || run.reordered || run.restyled) return null
  if (run.state === 'idle' || (run.state === 'done' && !settling)) return null
  const stateOf = (stage: StageName): string | undefined =>
    run.stages.find((s) => s.id === stage)?.state
  const at = run.stages.find((s) => s.state === 'running')?.id
  return {
    run: job,
    layout: run.layout,
    state: run.state,
    reported: LAYOUT_ORDER.filter((stage) => stateOf(stage) === 'done'),
    running: isStageName(at) ? at : null,
  }
}

/**
 * The stage a "not yet" refusal waits on (`data.building` and `data.stage`,
 * engine v0.14.0), which need not be the stage asked for: a description
 * with a day waits on octi. Null for any other refusal, which the view
 * shows as it shows a refusal (FR-003).
 */
export function waitsOn(reason: unknown): StageName | null {
  if (typeof reason !== 'object' || reason === null) return null
  const data = (reason as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return null
  const { building, stage } = data as { building?: unknown; stage?: unknown }
  return building === true && isStageName(stage) ? stage : null
}

/** Where one stage's request stands during a reveal. */
export type Asked =
  | { state: 'asking' }
  /** Refused as not yet: `on` is the stage it waits on, `since` what was reported when it was asked. */
  | { state: 'waiting'; on: StageName; since: readonly StageName[] }
  | { state: 'drawn' }
  | { state: 'refused' }

/**
 * The stages to ask the engine for now, in the engine's order: each one the
 * run has reported and that has not been asked for, and each refused as not
 * yet whose stage has been reported since it was asked - the next report
 * that names it, which may have come before the refusal did. One whose
 * stage was already reported when it was asked is not asked again: the
 * engine's answer was wrong, and asking again would be a loop (FR-003).
 */
export function toAsk(
  asked: Partial<Record<StageName, Asked>>,
  reported: readonly StageName[],
): StageName[] {
  return LAYOUT_ORDER.filter((stage) => {
    if (!reported.includes(stage)) return false
    const at = asked[stage]
    if (at === undefined) return true
    return at.state === 'waiting' && reported.includes(at.on) && !at.since.includes(at.on)
  })
}

const latestOf = (drawn: readonly StageName[]): StageName | null =>
  [...LAYOUT_ORDER].reverse().find((stage) => drawn.includes(stage)) ?? null

/**
 * The stage the pane shows while a run goes: the latest drawn, in the
 * engine's order, so the pane follows the run; or a drawn stage a person
 * pressed, until the next stage is drawn (`pressed.drawn` is how many were
 * drawn at the press).
 */
export function shownStage(
  drawn: readonly StageName[],
  pressed: { stage: StageName; drawn: number } | null,
): StageName | null {
  if (pressed !== null && pressed.drawn === drawn.length && drawn.includes(pressed.stage))
    return pressed.stage
  return latestOf(drawn)
}

/**
 * The pane's sentence while a run goes (FR-007): the stage drawn - the
 * latest, in the engine's order - and the stage running. Once no stage of
 * the layout is running the map is being drawn from it.
 */
export function revealSentence(drawn: readonly StageName[], running: StageName | null): string {
  const latest = latestOf(drawn)
  const now = running === null ? 'the layout’s four stages are done.' : `${running} running.`
  return latest === null ? `Nothing drawn yet; ${now}` : `${latest} drawn; ${now}`
}

/** What the live region says as a stage is drawn: once each. */
export const drawnAnnouncement = (stage: StageName): string => `${stage} drawn.`

/**
 * What the live region says for the stages drawn since it last spoke, in
 * the engine's order: a stage asked for again lands with the one it waited
 * on, and both are said.
 */
export const drawnAnnouncements = (stages: readonly StageName[]): string =>
  stages.map(drawnAnnouncement).join(' ')

/** What a press on a stage the run has not drawn yet says, beside the pane and aloud. */
export const notDrawnYet = (stage: StageName): string => `${stage} is not drawn yet.`

/**
 * The one sentence a run that stopped leaves (FR-006): what it drew is gone
 * with its build, and a project that has a stored layout is shown it again.
 */
export function clearedSentence(ending: 'cancelled' | 'failed', stored: boolean): string {
  const gone = `The layout run ${ending === 'cancelled' ? 'was cancelled' : 'failed'}, so its stages are no longer drawn.`
  return stored ? `${gone} The stored layout is shown as it was.` : gone
}
