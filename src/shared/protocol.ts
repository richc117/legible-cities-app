// Generated from the engine's own description of its protocol.
// Run `npm run typegen` to regenerate; edits here are lost.
//
// Engine: v0.5.0, protocol 1.
// Source: vendor/protocol.schema.json, printed by the engine's
// `python -m schematic.serve --schema` and committed verbatim.

/**
 * A JSON-RPC request id, as the client chose it.
 */
export type RequestId = number | string

/**
 * The method takes no parameters: omit `params`, or send an empty object.
 */
export type NoParams = null | Record<string, never>

export interface Ok {
  ok: true
}

/**
 * The key of a registered feed: lower-case letters, digits and hyphens, as
 * in the engine's registry and its file names.
 */
export type FeedKey = string

/**
 * A folder name under the engine's home, never a path: the desktop app
 * passes its project id.
 */
export type Token = string

/**
 * A calendar day, YYYY-MM-DD. The engine never picks one: its choice would
 * depend on the day the request was made.
 */
export type ServiceDate = string

/**
 * The handshake. A client refuses to continue unless `protocol` is the
 * version it was built for and `engine` is the tag it pinned.
 */
export interface EngineInfo {
  /**
   * The engine's version, as in its package metadata.
   */
  engine: string
  protocol: 1
  python: string
  loom: {
    /**
     * The LOOM commit the binaries were built from; null when the backend
     * cannot say.
     */
    commit: string | null
    backend: 'docker' | 'native'
  }
  /**
   * The ffmpeg the engine would run (SCHEMATIC_FFMPEG, else the first on
   * PATH), or null.
   */
  ffmpeg: string | null
  /**
   * SCHEMATIC_HOME as resolved: where feeds, graphs and output live.
   */
  home: string
}

/**
 * A stored layout's id: the sha256, as 64 hex digits, of everything that
 * went into it. The same feed, options and LOOM name the same id before
 * anything runs; the desktop app stores it with a project.
 */
export type LayoutId = string

/**
 * What a stored layout was made from, as written beside it in .meta.json.
 * The inputs are what its id hashes; engine, made and migrated are not.
 */
export interface LayoutMeta {
  feed: FeedKey
  /**
   * The sha256 of the feed zip as downloaded.
   */
  feed_sha256: string
  mode: string
  agency: string | null
  label_pattern: string | null
  label_strip: string | null
  /**
   * The LOOM commit the host passed as SCHEMATIC_LOOM_COMMIT; null when it
   * was not told.
   */
  loom: string | null
  /**
   * The graph-to-graph stages and their arguments, in order.
   */
  stages: [string, string[]][]
  /**
   * The engine version that made it.
   */
  engine: string
  /**
   * When, as an ISO 8601 timestamp in UTC.
   */
  made: string
  /**
   * True for a set from before layouts had names, moved under its id once;
   * its inputs are the feed and options as they were at migration.
   */
  migrated: boolean
}

/**
 * Lay a registered feed out: gtfs2graph, topo, loom and octi, stored under
 * the home as one layout named by the hash of its inputs (the feed's bytes,
 * the mode, the agency, the label options, the LOOM build). The same inputs
 * name the same layout; a layout already stored is answered without running
 * anything. Mode, agency and the label options default to the registry
 * entry.
 */
export interface GraphBuildParams {
  key: FeedKey
  /**
   * What gtfs2graph keeps of the feed (LOOM's -m): names such as tram,
   * subway, rail, bus, ferry or all, or route_type numbers, comma-joined for
   * several; the registry entry's when omitted.
   */
  mode?: string
  /**
   * Keep only this agency_id; the registry entry's when omitted.
   */
  agency?: string
  /**
   * A regular expression applied to route_long_name when route_short_name is
   * blank; group 1 is the line's label.
   */
  label_pattern?: string
  /**
   * A regular expression removed from every label.
   */
  label_strip?: string
  /**
   * Lay the feed out again under the same id. The stored layout stays until
   * the new set is whole, then is replaced; a new layout may place stations
   * differently.
   */
  force?: boolean
}

export interface StageSummary {
  nodes: number
  stations: number
  junctions: number
  edges: number
  lines: string[]
  /**
   * The share of drawn length on a 45-degree multiple; only the octi stage
   * carries it.
   */
  octilinear?: number
}

export interface GraphBuildResult {
  layout: LayoutId
  meta: LayoutMeta
  stages: {
    gtfs2graph: StageSummary
    topo: StageSummary
    loom: StageSummary
    octi: StageSummary
  }
  /**
   * Where each stage's GeoJSON is stored, as absolute paths under the home:
   * graphs/<key>/<layout>/.
   */
  paths: {
    gtfs2graph: string
    topo: string
    loom: string
    octi: string
  }
}

/**
 * Draw the map and the animation page for a registered feed on one service
 * day, from a stored layout. Never lays the feed out: a layout that is not
 * stored is refused, with a hint to lay it out first.
 */
export interface MapBuildParams {
  key: FeedKey
  layout: LayoutId
  date: ServiceDate
  /**
   * The folder under the home's out/ to write into. Omitted, the files go
   * into out/ itself.
   */
  out?: Token
  /**
   * The SVG's width in CSS pixels.
   */
  width?: number
  /**
   * Line labels in the order they stack on shared track; the rest follow.
   */
  line_order?: string[]
}

/**
 * Result.summary() as data.
 */
export interface Diagnostics {
  stations: number
  junctions: number
  edges: number
  lines: string[]
  octilinear: number
  stops: {
    matched: number
    total: number
    by: {
      station_id: number
      parent_station: number
      name: number
    }
    /**
     * The first few stop ids that matched no node.
     */
    unmatched: string[]
  }
  trips: {
    total: number
    paths: number
    unrouted: number
  }
  degraded: {
    skipped_calls: number
    borrowed_track: number
  }
  labels_dropped: number
  peak_concurrent: number
}

export interface MapBuildResult {
  layout: LayoutId
  date: ServiceDate
  files: {
    svg: string
    /**
     * The self-contained animation page.
     */
    html: string
    positions: string
  }
  /**
   * Result.summary(), the lines the CLI prints.
   */
  summary: string
  diagnostics: Diagnostics
}

/**
 * Sent while a long request runs, once per step as it finishes.
 */
export interface JobProgress {
  id: RequestId
  stage: string
  fraction: number
  message: string
}

/**
 * A line a tool wrote to stderr while a long request ran, as it arrived.
 */
export interface JobLog {
  id: RequestId
  level: 'debug' | 'info' | 'warning' | 'error'
  line: string
}

export interface CancelParams {
  id: RequestId
}

/**
 * A preset's name; export.presets describes each. Held equal to the engine's
 * table by a test.
 */
export type PresetName =
  | 'instagram-post'
  | 'instagram-square'
  | 'instagram-story'
  | 'linkedin'
  | 'linkedin-link'
  | 'bluesky'
  | 'x'
  | 'instagram-reel'
  | 'bluesky-video'
  | 'linkedin-video'
  | 'instagram-reel-gif'
  | 'linkedin-gif'
  | 'bluesky-gif'
  | 'portfolio-svg'
  | 'portfolio-mp4'
  | 'portfolio-gif'

/**
 * A storyboard's name; export.storyboards describes each. Held equal to the
 * engine's table by a test.
 */
export type StoryboardName =
  'transform' | 'transform-loop' | 'essay-loop' | 'tour' | 'reveal' | 'morph' | 'day' | 'run'

/**
 * A view the page can show.
 */
export type View = 'geographic' | 'map' | 'linear' | 'time'

/**
 * A time of day, HH:MM or HH:MM:SS; past midnight stays past midnight (25:44
 * is 1:44 the next morning).
 */
export type Clock = string

/**
 * The page's own address, with its scheme. The desktop app serves a
 * project's page on its own origin and passes that; the engine's default is
 * the site's file.
 */
export type PageUrl = string

/**
 * A path the client owns, absolute, never inside the engine's own
 * repository.
 */
export type AbsolutePath = string

/**
 * One destination, with the dimensions and limits that destination has.
 */
export interface Preset {
  name: string
  platform: string
  width: number
  height: number
  kind: 'still' | 'video' | 'vector'
  format: 'png' | 'jpg' | 'mp4' | 'gif' | 'svg'
  view: View
  labels: boolean
  /**
   * Video only: the storyboard the preset plays unless told otherwise.
   */
  storyboard: string | null
  fps: number
  /**
   * The platform's upload limit, where it has one.
   */
  max_bytes: number | null
  frame_top: number
  /**
   * Whether the platform draws its own interface over the image.
   */
  safe_zones: boolean
  note: string
}

export interface ExportPresets {
  presets: Preset[]
}

/**
 * A stretch of video with one set of state, as the storyboard is written. A
 * field left null carries over from the beat before.
 */
export interface StoryboardBeat {
  secs: number
  view: View | null
  labels: boolean | null
  at: Clock | null
  speed: number | null
  sweep: boolean
  hours: number | null
  span: Clock[] | null
  tween: number | null
}

export interface Storyboard {
  name: string
  /**
   * The views it visits, in order, as a sentence fragment; empty for one
   * view.
   */
  views: string
  seconds: number
  /**
   * Whether any beat needs the feed's geographic geometry.
   */
  geographic: boolean
  beats: StoryboardBeat[]
}

export interface ExportStoryboards {
  storyboards: Storyboard[]
}

/**
 * The dressing of an export; every field optional and defaulted as
 * bin/export defaults it.
 */
export interface ExportOptions {
  view?: View
  labels?: boolean
  /**
   * The city and network over the map.
   */
  title?: boolean
  clock?: boolean
  theme?: 'dark' | 'light'
  /**
   * The clock to start at; a still is taken here.
   */
  at?: Clock
  /**
   * Line labels to keep; the rest are hidden.
   */
  lines?: string[]
  storyboard?: StoryboardName
  /**
   * draft: 1x and fast; standard: 2x, resampled to the preset's size; high:
   * 2x, kept.
   */
  quality?: 'draft' | 'standard' | 'high'
  fade?: number
  /**
   * A filename suffix, so two dressings of one preset can share a folder.
   */
  tag?: Token
  /**
   * Draw the platform's safe zones; never for a deliverable.
   */
  safe?: boolean
}

/**
 * Describe an export: what to capture and how to encode it. Pure and
 * instant; nothing is written. A vector preset is refused (it is resolved
 * from the built map, not captured).
 */
export interface ExportPlanParams {
  key: FeedKey
  preset: PresetName
  page?: PageUrl
  /**
   * The service day the title names, when the caller knows it (the app's
   * project does).
   */
  date?: ServiceDate
  options?: ExportOptions
}

/**
 * A beat as the recorder takes it: times in seconds of the service day, the
 * span resolved.
 */
export interface BeatPayload {
  secs: number
  view: View | null
  labels: boolean | null
  at: number | null
  speed: number | null
  sweep: boolean
  hours: number | null
  lo: number | null
  hi: number | null
  tween: number | null
}

/**
 * One export, described: the capture half is the job the engine's own
 * recorder takes (url, width, height in CSS pixels, scale, fps, format,
 * settle, beats, at); the rest is what export.encode needs afterwards.
 * Handed back to export.encode unchanged.
 */
export interface CaptureJob {
  key: FeedKey
  preset: PresetName
  mode: 'still' | 'video'
  url: PageUrl
  width: number
  height: number
  scale: number
  fps: number
  format: 'png' | 'jpg' | 'mp4' | 'gif'
  /**
   * Milliseconds to wait, with the clock stopped, for the page's first
   * geometry pass and its fonts.
   */
  settle: number
  beats: BeatPayload[]
  /**
   * Deliver the captured pixels as they are rather than resampling to the
   * preset's size.
   */
  keep: boolean
  crf: number
  fade: number
  stem: string
  theme: 'dark' | 'light'
  view: View
  /**
   * Empty for a still.
   */
  storyboard: StoryboardName | ''
  /**
   * The clock, in seconds, a still is taken at; a video's beats seek for
   * themselves.
   */
  at: number | null
  /**
   * What a person should hear before the capture, such as a sweep too fast
   * to read.
   */
  notes: string[]
  /**
   * stem plus the format's extension; the plan's convenience.
   */
  filename: string
}

/**
 * What the caller knows about the map that the atlas's data would not; it
 * goes into the sidecar over the atlas's, field by field.
 */
export interface Provenance {
  service_date?: ServiceDate
  trips?: number
  stations?: number
  lines?: number
  caveats?: string[]
}

/**
 * The frames the client captured (a directory of 000000.png onwards), or its
 * still, to the deliverable at dest with its sidecar beside it. The source
 * is read and never touched; a cancel, a failure or a file over the
 * platform's limit leaves nothing at dest.
 */
export interface ExportEncodeParams {
  plan: CaptureJob
  /**
   * The frames directory for a video plan, the captured still for a still
   * plan.
   */
  source: AbsolutePath
  /**
   * The file to write; its folder is created.
   */
  dest: AbsolutePath
  provenance?: Provenance
}

export interface ExportEncodeResult {
  files: {
    path: string
    bytes: number
  }[]
  /**
   * The sidecar as written beside the file: what it is, the network's
   * caveats, alt text.
   */
  sidecar: Record<string, unknown>
}

/**
 * The `data` of an error response. `hint` is a sentence for a person and is
 * what a UI shows; `detail` says where, for a log.
 */
export interface ErrorData {
  kind: 'params' | 'feed' | 'loom' | 'schedule' | 'export' | 'io' | 'engine' | 'layout'
  detail: string
  hint: string
}

/** Every request the engine answers, with its parameters and its result. */
export interface Methods {
  'engine.info': {
    params: NoParams
    result: EngineInfo
  }
  'engine.shutdown': {
    params: NoParams
    result: Ok
  }
  'graph.build': {
    params: GraphBuildParams
    result: GraphBuildResult
  }
  'map.build': {
    params: MapBuildParams
    result: MapBuildResult
  }
  'export.presets': {
    params: NoParams
    result: ExportPresets
  }
  'export.storyboards': {
    params: NoParams
    result: ExportStoryboards
  }
  'export.plan': {
    params: ExportPlanParams
    result: CaptureJob
  }
  'export.encode': {
    params: ExportEncodeParams
    result: ExportEncodeResult
  }
}

/** Every notification the engine sends, with its parameters. */
export interface Notifications {
  'job/progress': JobProgress
  'job/log': JobLog
  '$/cancelRequest': CancelParams
}

export type Method = keyof Methods
export type NotificationName = keyof Notifications

/** The protocol version this app was generated against. */
export const PROTOCOL = 1 as const
