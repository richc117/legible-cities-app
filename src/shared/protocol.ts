// Generated from the engine's own description of its protocol.
// Run `npm run typegen` to regenerate; edits here are lost.
//
// Engine: v0.2.1, protocol 1.
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
 * Run gtfs2graph, topo, loom and octi for a registered feed, each stage
 * cached under the home. Mode and agency come from the registry entry;
 * passing them arrives with the native backend and user feeds.
 */
export interface GraphBuildParams {
  key: FeedKey
  /**
   * Re-run every stage even if its output is cached. A new layout may place
   * stations differently.
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
  stages: {
    gtfs2graph: StageSummary
    topo: StageSummary
    loom: StageSummary
    octi: StageSummary
  }
  /**
   * Where each stage's GeoJSON is cached, as absolute paths under the home.
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
 * day, from the cached stages (built first if missing).
 */
export interface MapBuildParams {
  key: FeedKey
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
  /**
   * Re-run the layout stages first. A new layout may place stations
   * differently.
   */
  force?: boolean
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
 * The `data` of an error response. `hint` is a sentence for a person and is
 * what a UI shows; `detail` says where, for a log.
 */
export interface ErrorData {
  kind: 'params' | 'feed' | 'loom' | 'schedule' | 'export' | 'io' | 'engine'
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
