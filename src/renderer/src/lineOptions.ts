import type { MapBuildParams } from '../../shared/protocol'
import { linesSent, type ProjectLines } from '../../shared/project'

// Cell 05's line options, with no React in it (issue 394, spec 036): what
// `map.build` is sent for them. The record's entry is the engine's own
// `LineOptions`, so the wire form is the record's options as they are kept
// (`linesSent`), under the key the engine reads them by.

/**
 * What `map.build` is sent for a project's line options: `lines`, keyed by
 * line label, each line only the fields that are not the engine's own, and
 * nothing at all for a project that chose none, so its request is the one it
 * always sent (spec 036, FR-009). A line's colour and its place in the stack
 * are not here: they stay `colors`, `default_color` and `line_order`, which
 * `lines` does not carry, so nothing in it competes with them.
 */
export function linesParams(lines: ProjectLines | undefined): Pick<MapBuildParams, 'lines'> {
  const sent = linesSent(lines)
  return Object.keys(sent).length === 0 ? {} : { lines: sent }
}
