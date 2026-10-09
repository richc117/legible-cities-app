// Generated from the engine's own description of its protocol.
// Run `npm run typegen` to regenerate; edits here are lost.
//
// Engine: v0.14.0, protocol 1.
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
 * Ask when a feed runs and which day to draw: its service window and the
 * busiest weekday scanning from an anchor. A long request, like graph.build:
 * it downloads the feed when it is not cached, reporting that download's
 * bytes as job/progress (stage download), and reads its calendar and trips,
 * which sends no progress.
 */
export interface FeedsServiceParams {
  key: FeedKey
  /**
   * The day to scan from; the engine's today when omitted, and echoed either
   * way so a caller can store it. An anchor outside the window scans from
   * the window's middle.
   */
  anchor?: ServiceDate
  /**
   * The lines the map draws, as graph.build names them in stages.octi.lines.
   * Trips are counted on those lines, as the map build counts them, so the
   * day is the map's; every trip in the feed counts when omitted.
   */
  lines?: string[]
}

export interface FeedsServiceResult {
  /**
   * The first day the feed's calendar covers.
   */
  start: ServiceDate
  /**
   * The last.
   */
  end: ServiceDate
  /**
   * The weekday in the window with the most trips, scanning from the anchor:
   * the same feed and anchor give the same day on every machine.
   */
  busiest_weekday: ServiceDate
  /**
   * The anchor the choice was made from.
   */
  anchor: ServiceDate
}

/**
 * A calendar day, YYYY-MM-DD. map.build never picks one, because its choice
 * would depend on the day the request was made; feeds.service picks one from
 * an anchor the caller gives.
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
 * A colour a client chooses, written #rrggbb. The feed's own route_color
 * arrives without the hash and is the feed's, not the client's.
 */
export type HexColor = string

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
   * The graph-to-graph stages and their arguments, in order. A layout laid
   * out with a tuning shows LOOM's flags for it here (topo's -d; octi's -b,
   * -g, --pen-N and --diag-pen), written as LOOM prints numbers; a field
   * left at LOOM's default shows none.
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
 * the mode, the agency, the label options, the tuning, the LOOM build). The
 * same inputs name the same layout; a layout already stored is answered
 * without running anything. Mode, agency and the label options default to
 * the registry entry; the tuning, to LOOM's own settings.
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
   * Keep only this agency_id; the registry entry's when omitted; empty for
   * every operator, whatever the entry says.
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
  tuning?: LayoutTuning
}

/**
 * LOOM's own settings for a layout, by name, with no slider mapped over
 * them. Every field is optional. Each is passed to the tool it belongs to as
 * that tool's flag (merge_distance to topo as -d; grid, grid_size and the
 * penalties to octi as -b, -g and --pen-N or --diag-pen), and the flags are
 * part of the layout's id: a tuned layout is a layout of its own, the same
 * tuning always names the same one, and LayoutMeta.stages shows the flags. A
 * field equal to LOOM's default writes no flag, so leaving the object out,
 * sending {} and sending nothing but defaults all name the layout stored
 * today. Numbers are written as LOOM's own help prints them (50, 1.5, never
 * 50.0), so equal values name the same layout whether they were sent as
 * integers or as decimals. A value outside its range, a grid that is not one
 * of the four, a field that is not on the list and a null where an object
 * goes are refused with the params kind and a sentence naming the field
 * (tuning.merge_distance, tuning.penalties.deg45), before any tool starts.
 * LOOM's other flags are not offered.
 */
export interface LayoutTuning {
  /**
   * How far apart two segments of track may be, in metres, and still be
   * merged into one (topo's -d, --max-aggr-dist). LOOM's default is 50,
   * which writes no flag.
   */
  merge_distance?: number
  /**
   * The grid octi lays the network on (octi's -b, --base-graph): octilinear,
   * the 45-degree multiples the map has always been drawn on, ortholinear,
   * orthoradial or hexalinear. LOOM's default is octilinear, which writes no
   * flag. Its research variants (quadtree, octihanan, chulloctilinear,
   * porthoradial, pseudoorthoradial) are not offered.
   */
  grid?: 'octilinear' | 'ortholinear' | 'orthoradial' | 'hexalinear'
  /**
   * The grid's cell length as a percentage of the distance between adjacent
   * stations (octi's -g, --grid-size, written with a percent sign). A
   * smaller cell gives octi more places to put a station, a larger one
   * fewer. LOOM's default is 100, which writes no flag.
   */
  grid_size?: number
  penalties?: LayoutPenalties
}

/**
 * The costs octi adds while it routes, in its own scale, which has no unit:
 * a higher cost makes octi avoid what it prices. Every field is optional,
 * from 0 to 10, and one equal to LOOM's default writes no flag.
 */
export interface LayoutPenalties {
  /**
   * octi's --pen-45, the cost where a route makes that angle. LOOM's default
   * is 2.
   */
  deg45?: number
  /**
   * octi's --pen-90, the cost where a route makes that angle. LOOM's default
   * is 1.5.
   */
  deg90?: number
  /**
   * octi's --pen-135, the cost where a route makes that angle. LOOM's
   * default is 1.
   */
  deg135?: number
  /**
   * octi's --pen-180, the cost where a route makes that angle. LOOM's
   * default is 0.
   */
  deg180?: number
  /**
   * octi's --diag-pen, the cost of running on a diagonal. LOOM's default is
   * 0.5.
   */
  diagonal?: number
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
 * Draw the map, the animation page and a thumbnail pair for a registered
 * feed on one service day, from a stored layout. Never lays the feed out: a
 * layout that is not stored is refused, with a hint to lay it out first.
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
   * A colour per line label, over the feed's own route_color. A label the
   * layout does not carry is ignored, so a client can keep colours for lines
   * a narrower mode dropped.
   */
  colors?: Record<string, HexColor>
  /**
   * The colour of a line the feed leaves uncoloured, on the map and in the
   * page's chips, dots and chart alike; #888888 when omitted.
   */
  default_color?: HexColor
  /**
   * Line labels in the order they stack on shared track, the later over the
   * earlier, and the order of the page's rows in the Linear and Time views.
   * A line the list leaves out follows the ones it names, and a label the
   * layout does not carry is ignored, so a partial or stale order never
   * drops a line.
   */
  line_order?: string[]
  /**
   * A display name and a hidden flag per line, keyed by line label. A label
   * the layout does not carry is ignored, so a client can keep its choices
   * for lines a narrower mode dropped. Hiding is a drawing choice: a hidden
   * line comes off the map, its trips, the page and the thumbnails, a
   * station only it served is not drawn, and no stored layout changes;
   * render.stage still shows every line.
   */
  lines?: Record<string, LineOptions>
  style?: MapStyle
}

/**
 * How the map is drawn, in the engine's own numbers. Every field is
 * optional; omitting the object, or any field, draws exactly what is drawn
 * without it. The numbers are in SVG user units at the map's width (the map
 * is fitted to MapBuildParams.width, 1800 by default, so a line width of 7
 * is seven of 1800), except line_gap, a multiple of line_width.
 * interchange_radius may not be below station_radius, judged on the values
 * the map would be drawn with (a field left out counts as its default): a
 * rule the schema cannot hold and the server does. label_size and
 * label_offset re-place the labels and move the drawing's viewBox, never the
 * stored layout. The four colours are the literals a standalone SVG falls
 * back to; the animation page's theme overrides them, which is why the
 * desktop app does not send them.
 */
export interface MapStyle {
  /**
   * Line stroke width, in SVG user units at the map's width; 7 when omitted.
   */
  line_width?: number
  /**
   * Pitch of parallel tracks as a multiple of line_width, so it has no unit;
   * 1.6 when omitted.
   */
  line_gap?: number
  /**
   * Radius of a station on one route, in SVG user units at the map's width;
   * 4.2 when omitted.
   */
  station_radius?: number
  /**
   * Radius of a station where routes meet, in SVG user units at the map's
   * width; 6 when omitted. Not below station_radius.
   */
  interchange_radius?: number
  /**
   * Width of a station's outline, in SVG user units at the map's width; 2.2
   * when omitted.
   */
  station_stroke?: number
  /**
   * Font size of a station's name, in SVG user units at the map's width; 11
   * when omitted. The labels are placed again, so the viewBox moves.
   */
  label_size?: number
  /**
   * Distance of a name from its station, in SVG user units at the map's
   * width; 9 when omitted. The labels are placed again, so the viewBox
   * moves.
   */
  label_offset?: number
  /**
   * Margin round the drawing on every side, in SVG user units at the map's
   * width; 24 when omitted.
   */
  padding?: number
  /**
   * The ground, as the literal a standalone SVG falls back to; the page's
   * theme overrides it. #ffffff when omitted.
   */
  background?: HexColor
  /**
   * A station's fill, as the literal a standalone SVG falls back to; the
   * page's theme overrides it. #ffffff when omitted.
   */
  station_fill?: HexColor
  /**
   * A station's outline, as the literal a standalone SVG falls back to; the
   * page's theme overrides it. #111111 when omitted.
   */
  station_stroke_color?: HexColor
  /**
   * The station names, as the literal a standalone SVG falls back to; the
   * page's theme overrides it. #111111 when omitted.
   */
  label_color?: HexColor
}

/**
 * What a client chose for one line of the map. Every field is optional; an
 * empty object changes nothing.
 */
export interface LineOptions {
  /**
   * The line's display name, written where the page writes the line's label:
   * its chip, its row and the time chart's band, and the trains' titles. The
   * label stays the line's key everywhere else (the SVG's data-line,
   * ExportOptions.lines). From 1 to 40 characters, with no line break.
   */
  name?: string
  /**
   * True leaves the line off the map: no track, no trips, no chip, row or
   * band, and no colour in the thumbnails; the lines it shared track with
   * close up over its place.
   */
  hidden?: boolean
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
    /**
     * A small picture of the map for the dark palette: the network alone,
     * about 400 units wide, no ground, every colour a literal, in the
     * request's colors, default_color and line_order. Safe to show in an
     * img.
     */
    thumb_dark: string
    /**
     * The same picture for the light palette.
     */
    thumb_light: string
  }
  /**
   * Every station the map draws, sorted by name as code points and then by
   * id: what a client offers to pick a trip from. A station only a hidden
   * line served is not drawn and not listed.
   */
  stations: {
    /**
     * The station's node id in the stored layout: what the page's
     * window.__present.setTrip takes.
     */
    id: string
    /**
     * The name the map writes for it; the empty string where the feed gives
     * none.
     */
    name: string
  }[]
  /**
   * Result.summary(), the lines the CLI prints.
   */
  summary: string
  diagnostics: Diagnostics
  /**
   * What the build had to fudge, as sentences a person can read: the atlas's
   * caveats, from the same numbers.
   */
  caveats: string[]
  /**
   * How much of the network the build had to fudge, as one weighted
   * proportion; 0 is clean. What the atlas is ordered by.
   */
  issues: number
}

/**
 * Sent while a long request runs, once per step as it finishes. A feed
 * downloaded inside any long request -- a preset's zip fetched the first
 * time a layout, an inspection, a service-day read or a draw needs it --
 * reports stage download when that download happens, once per chunk: its
 * fraction is of the download's own bytes (0 when the server did not say how
 * many), not of the request, and its message counts them; the request's own
 * steps follow with their fractions of the request. A feed already on disk
 * reports no download. A report of one of a layout's four stages names the
 * layout in `layout`: each stage as graph.build finishes it, the four
 * graph.build replays for a stored layout, and the four map.build replays
 * before its own steps; a client can draw a stage with render.stage as soon
 * as it is reported, before the request ends. No other report carries it, a
 * download's included, which comes before the layout's id is known.
 */
export interface JobProgress {
  id: RequestId
  stage: string
  fraction: number
  message: string
  /**
   * The layout the reported stage is of; on stage reports alone.
   */
  layout?: LayoutId
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
 * A person's words for the frame, 1 to 80 characters with no line break. The
 * page draws it as text, never markup, under the title at the size of the
 * date line: at most two lines at 1,080 wide.
 */
export type Caption = string

/**
 * Where the page draws the clock. Left out, it is bottom-right, where the
 * clock has always sat, except on a preset with safe zones (instagram-reel,
 * instagram-story), where it is top-right: there bottom-right is refused,
 * because the platform's own interface covers it, and bottom-left comes with
 * a note.
 */
export type ClockCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

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
 * A stretch of video with one set of state, as the storyboard is written;
 * export.storyboards answers every field, and a client writing a list gives
 * only secs and what changes. A field left out or null carries over from the
 * beat before. The server also checks what this cannot say: the beats last
 * 90 seconds in all at most, a span's first clock is before its second, the
 * first beat names a view and has tween 0 or none, since frame 0 must
 * already be in a view, and the first beat names at unless it sweeps without
 * hours, since frame 0 is not reproducible without a clock.
 */
export interface StoryboardBeat {
  secs: number
  view?: View | null
  labels?: boolean | null
  at?: Clock | null
  speed?: number | null
  sweep?: boolean
  hours?: number | null
  span?: Clock[] | null
  tween?: number | null
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
  /**
   * The view a still is taken in. For a video it opens a named storyboard:
   * the first beat takes it, with no transition. Refused beside a list on a
   * video preset, whose first beat names its view.
   */
  view?: View
  labels?: boolean
  /**
   * The city and network over the map.
   */
  title?: boolean
  clock?: boolean
  theme?: 'dark' | 'light'
  /**
   * The clock to start at; a still is taken here. For a video it opens a
   * named storyboard, as its first beat's clock. Refused beside a list on a
   * video preset, whose first beat carries its own.
   */
  at?: Clock
  /**
   * Line labels to keep; the rest are hidden.
   */
  lines?: string[]
  /**
   * What a video plays: a storyboard's name, or a list of beats written as
   * export.storyboards writes them, played in order. A list's first beat
   * names the view frame 0 is in, and its clock unless it sweeps without
   * hours. A still ignores either.
   */
  storyboard?: StoryboardName | StoryboardBeat[]
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
  caption?: Caption
  clock_corner?: ClockCorner
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
   * The storyboard's name; custom for a list of beats; empty for a still.
   */
  storyboard: StoryboardName | 'custom' | ''
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
   * The caption as given; null for none.
   */
  caption: Caption | null
  /**
   * The corner resolved, given even where the clock is off and the address
   * names none.
   */
  clock_corner: ClockCorner
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
  /**
   * The sidecar's alt text in the caller's own words, written trimmed, in
   * place of the description the engine generates; omitted, the generated
   * one stands. At most 1,000 characters, counted as Unicode code points (a
   * JavaScript string's length counts UTF-16 units, so one emoji is one here
   * and two there). Text of only whitespace is refused by the server.
   */
  alt?: string
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
 * A registry entry, preset or added by a person: what the engine knows about
 * a feed before it reads it. `cached` says whether its zip is on disk.
 */
export interface FeedRecord {
  key: FeedKey
  name: string
  city: string
  network: string
  /**
   * Where the zip came from; empty for a feed added from a file.
   */
  url: string
  mode: string
  label_pattern: string | null
  label_strip: string | null
  agency: string | null
  geographic: boolean
  notes: string[]
  /**
   * Whether the feed's service is run from frequencies.txt (trains at a
   * scheduled interval) rather than a timetable of trip times. A preset says
   * so in the registry; for a feed added through feeds.add it is decided
   * when the zip is checked: frequencies.txt has rows and the trips they
   * name in trips.txt are at least half of the feed's trips.
   */
  headways: boolean
  /**
   * Which half of the registry: a preset is curated in the engine and cannot
   * be removed; a user feed was added through feeds.add.
   */
  source: 'preset' | 'user'
  cached: boolean
}

export interface FeedsList {
  feeds: FeedRecord[]
}

/**
 * Add a feed a person chose, from a URL or a zip the client owns, and keep
 * it across restarts. A long request: the download reports its bytes as
 * job/progress (stage download), then the check reports once (stage check).
 * The zip must carry stops, routes, trips, stop_times and a calendar in one
 * of its two forms; a refusal names the missing table and leaves nothing
 * behind. A cancel is honoured until the moment the feed is kept, and
 * answers with the cancelled error (-32800): the feed is then in neither the
 * registry nor the cache, so a client told an add was cancelled need not go
 * looking for one. The name defaults to the feed's first agency, the key to
 * a slug of the name made unique.
 */
export interface FeedsAddParams {
  /**
   * A URL with its scheme, or an absolute path to a zip the client owns.
   */
  source: string
  key?: FeedKey
  name?: string
  /**
   * What gtfs2graph keeps of the feed (LOOM's -m); all when omitted.
   * feeds.inspect suggests one.
   */
  mode?: string
  /**
   * Keep only this agency_id; every operator when omitted.
   */
  agency?: string
}

/**
 * Forget a feed a person added, with its zips and its stored layouts. A
 * preset is refused with kind feed. A long request: the registry's write is
 * the point of no return, and a cancel before it leaves the feed registered
 * with every file in place.
 */
export interface FeedsRemoveParams {
  key: FeedKey
}

/**
 * The feed is forgotten and its files are gone. `cancel_too_late` is
 * present, and true, only when a cancel arrived after the point of no return
 * and so was not honoured; otherwise the answer is exactly `{"ok": true}`.
 */
export interface FeedsRemoveResult {
  ok: true
  cancel_too_late?: true
}

/**
 * What is in a feed, as data, before anything is laid out: read from the raw
 * zip, never the agency-filtered copy, so the answer is what a choice of
 * mode and agency is made from. A long request when the feed is not cached;
 * a few seconds for a large one. Never reads stop_times.
 */
export interface FeedsInspectParams {
  key: FeedKey
  /**
   * The day the service choice scans from, as feeds.service takes it; the
   * engine's today when omitted, and echoed.
   */
  anchor?: ServiceDate
}

export interface Agency {
  agency_id: string
  agency_name: string
}

export interface Route {
  route_id: string
  agency_id: string
  short_name: string
  long_name: string
  /**
   * The label the map would draw: route_short_name, or the long name through
   * the feed's label pattern, then the strip.
   */
  label: string
  /**
   * GTFS route_type as published; -1 when missing.
   */
  route_type: number
  /**
   * route_color as the spec asks for it: six hex digits, upper case, without
   * the hash. Null when the feed leaves it out or writes something that is
   * not a colour, which a client must not paint with.
   */
  color: string | null
  /**
   * route_text_color on the same terms as color.
   */
  text_color: string | null
  /**
   * Rows in trips.txt; a headway-based trip is a template that expands into
   * runs.
   */
  trips: number
}

export interface RouteType {
  route_type: number
  /**
   * The GTFS name: tram, subway, rail, bus, ferry, cable tram, aerial lift,
   * funicular, trolleybus, monorail; an extended code says which it folds
   * onto.
   */
  name: string
  /**
   * The LOOM mode (gtfs2graph -m) that keeps this type, so a client can show
   * which types a chosen mode draws; null for a type LOOM has no name for.
   * The mode all keeps every type.
   */
  mode: string | null
  /**
   * Every -m name that keeps this type, the canonical one first (subway and
   * metro; tram and streetcar; rail and train); empty for a type LOOM has no
   * name for. A numeric mode keeps its own code.
   */
  modes: string[]
  routes: number
  trips: number
}

/**
 * Rows of stops.txt by location_type, and the total.
 */
export interface StopCounts {
  stops: number
  stations: number
  entrances: number
  generic_nodes: number
  boarding_areas: number
  total: number
}

/**
 * A feed as the Inspect screen shows it.
 */
export interface Inspection {
  key: FeedKey
  name: string
  /**
   * The GTFS tables present, by stem.
   */
  tables: string[]
  agencies: Agency[]
  routes: Route[]
  route_types: RouteType[]
  stops: StopCounts
  trips: number
  /**
   * Trips with frequencies.txt windows: templates, expanded into runs when
   * the day is built.
   */
  frequency_trips: number
  /**
   * The window and the engine's day from the anchor, as feeds.service
   * answers them; null when the feed has no calendar, with a warning saying
   * so.
   */
  service: FeedsServiceResult | null
  /**
   * A LOOM mode from the route types: all for a feed with nothing but
   * rail-like types, else the most common rail-like type, else the most
   * common. The app shows it; the person decides.
   */
  suggested_mode: string | null
  /**
   * Sentences for a person: a headway-based timetable, an expired or
   * unstarted calendar, a calendar_dates-only schedule, routes without short
   * names, several operators in one feed.
   */
  warnings: string[]
}

/**
 * One of the pipeline's four stages, in order.
 */
export type StageName = 'gtfs2graph' | 'topo' | 'loom' | 'octi'

/**
 * One stored stage graph of a layout, drawn as SVG, with its counts (E15)
 * and its description (StageDescription): what a geographic view shows
 * beside the schematic map, and what its text alternative is written from.
 * Never lays out; a stage that is not stored is refused with kind layout.
 * While graph.build is laying the layout out in the same engine, a stage the
 * build has finished (job/progress has reported it, naming the layout) is
 * drawn from what the build has written, exactly as a stored stage is; one
 * it has not reached is refused with kind layout and building true in the
 * error's data, whose stage is the stage the answer waits on (octi when date
 * asks for minutes, which are read from it), and is worth asking again at
 * the next progress report. A stored layout that is being laid out again
 * (force) is drawn from its new build once the build has finished what the
 * answer needs, and from the store as before until then, never refused. Once
 * the build is done the store answers, as for any stored layout; a build
 * that is cancelled or fails leaves nothing of its own to draw.
 */
export interface RenderStageParams {
  key: FeedKey
  layout: LayoutId
  stage: StageName
  /**
   * The drawing's width in CSS pixels; the canvas grows for labels.
   */
  width?: number
  /**
   * Draw station names.
   */
  labels?: boolean
  /**
   * The project's service day, which times each line of the description by
   * its commonest trip that day. Left out, every trip and the extent are
   * null and no timetable is read: the engine never picks a day for it. Null
   * is refused; leave it out instead.
   */
  date?: ServiceDate
}

export interface RenderStageResult {
  layout: LayoutId
  stage: StageName
  /**
   * A self-contained SVG document, themed through CSS variables with literal
   * fallbacks.
   */
  svg: string
  width: number
  height: number
  counts: StageSummary
  description: StageDescription
}

/**
 * The stage graph drawn, in fields a text alternative is written from; the
 * engine writes no sentence. A station is named as the map draws it, the
 * empty string where the feed gives no name, never its id; a junction LOOM
 * inserted (no station) is never named, listed or met at. The minutes are of
 * the layout and the request's date, not of the stage, so every stage
 * answers the same ones; only the order of their two names follows the
 * stage.
 */
export interface StageDescription {
  /**
   * The line whose trip takes the most minutes, with that trip; the first in
   * label order on a tie. Null without a date, or when no line has a trip
   * that day.
   */
  extent: {
    minutes: number
    /**
     * The line's label.
     */
    line: string
    from: string
    to: string
  } | null
  /**
   * One entry per line label, in label order (sorted). For every line, its
   * stations and every branch's together are the line's stations, each once.
   */
  lines: {
    label: string
    /**
     * The first and last station of the line's spine, its longest run
     * (linear.spine), never a headsign; one for a loop, or for a spine of
     * one station.
     */
    termini: string[]
    /**
     * The spine's stations in order, termini first and last. A loop, a line
     * whose graph is one cycle, lists its cycle once, from the station with
     * the smallest node id toward that station's neighbour with the smaller
     * id.
     */
    stations: string[]
    /**
     * Every station of the line whose node carries another line on any edge,
     * in the order of stations and then of each branch's stations.
     */
    meets: {
      station: string
      /**
       * The other lines there, in label order.
       */
      lines: string[]
    }[]
    /**
     * The stations off the spine, as simple paths in travel order: from each
     * spine station in order, each way off it in node id order, a branch and
     * then the branches that fork from it. A branch ends where it forks
     * again, and each way on from the fork is a branch of its own. Empty for
     * a loop.
     */
    branches: {
      /**
       * The station the branch leaves. Where it leaves the run at a junction
       * that is not a station, the station next to the junction along that
       * run on the side with more stations to the run's end, toward its
       * start on a tie; where it leaves a junction ending a branch, the
       * nearest station back along that branch, else that branch's own at.
       * Null for a further piece of the line that touches the rest nowhere,
       * whose stations are that piece's own spine and whose branches follow
       * it.
       */
      at: string | null
      /**
       * In travel order away from at. A branch that would pass no station is
       * left out; the branches beyond it are kept.
       */
      stations: string[]
    }[]
    /**
     * The line's commonest trip on the date: its trips that day grouped by
     * their first and last calls at a mapped station, the largest group
     * winning (on a tie the shorter median, then the names that sort first),
     * its median duration in whole minutes rounded half up. from and to are
     * in the order the line's stations and then its branches list them, a
     * name the stage does not list keeping the trip's own order; equal for a
     * trip that ends where it began. Null without a date, or when the line
     * has no trip that day.
     */
    trip: {
      minutes: number
      from: string
      to: string
    } | null
  }[]
}

/**
 * The `data` of an error response. `hint` is a sentence for a person and is
 * what a UI shows; `detail` says where, for a log. render.stage's refusal of
 * a stage that a running build has not reached yet also carries layout,
 * stage and building; no other error does.
 */
export interface ErrorData {
  kind: 'params' | 'feed' | 'loom' | 'schedule' | 'export' | 'io' | 'engine' | 'layout'
  detail: string
  hint: string
  layout?: LayoutId
  /**
   * The stage the answer waits on.
   */
  stage?: StageName
  /**
   * The layout is being laid out and is not stored: ask again at the next
   * job/progress report. Absent from the refusal of a layout that is neither
   * stored nor building.
   */
  building?: true
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
  'feeds.service': {
    params: FeedsServiceParams
    result: FeedsServiceResult
  }
  'feeds.list': {
    params: NoParams
    result: FeedsList
  }
  'feeds.add': {
    params: FeedsAddParams
    result: FeedRecord
  }
  'feeds.remove': {
    params: FeedsRemoveParams
    result: FeedsRemoveResult
  }
  'feeds.inspect': {
    params: FeedsInspectParams
    result: Inspection
  }
  'render.stage': {
    params: RenderStageParams
    result: RenderStageResult
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
