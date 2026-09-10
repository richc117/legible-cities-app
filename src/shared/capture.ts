// A capture job: the frames the export path takes from a project's page, and
// nothing about how they are encoded. The shape is the engine's own - the job
// `bin/_record.js` receives, its beats as `export.beat_payload` builds them -
// so that when `export.plan` arrives over the protocol (engine issue E09b)
// its answer maps onto this without translation. Validated on the main side
// before a window exists (`src/main/capture.ts`).
//
// Contract: specs/009-capture/contracts/capture.md. How the frames are taken,
// and why that way: ADR-024.

export const VIEWS = ['geographic', 'map', 'linear', 'time'] as const
export type View = (typeof VIEWS)[number]

/** A stretch of video with one set of state. A field left null carries over. */
export interface Beat {
  /** Video seconds this beat lasts. */
  secs: number
  view?: View | null
  labels?: boolean | null
  /** The clock, in seconds of the service day, set at the beat's start. */
  at?: number | null
  /** Simulated seconds per video second. */
  speed?: number | null
  /** Run the clock across the beat's whole span instead of at `speed`. */
  sweep?: boolean
  /** A sweep's length forward from wherever the clock is; or use `lo`/`hi`. */
  hours?: number | null
  lo?: number | null
  hi?: number | null
  /** Transition length in seconds; the engine defaults it to min(secs, 1.2). */
  tween?: number | null
}

export interface CaptureJob {
  /** The project page under app://local/projects/<id>/, with its present-mode query. */
  url: string
  /** The viewport, in CSS pixels. */
  width: number
  height: number
  /** The device scale factor the page is emulated at; a frame is width*scale by height*scale. */
  scale: number
  fps: number
  /** Milliseconds allowed, with the clock already stopped, for the first geometry pass and the fonts. */
  settle: number
  beats: Beat[]
}

/** What the page reports through `__present.state()`, as far as the capture reads it. */
export interface PresentState {
  now: number
  clock: string
  shown: number
  viewName?: string
}

/** How many frames a job produces: the engine's `frame_count`, beat by beat. */
export function frameTotal(beats: readonly Beat[], fps: number): number {
  return beats.reduce((sum, beat) => sum + Math.round(beat.secs * fps), 0)
}
