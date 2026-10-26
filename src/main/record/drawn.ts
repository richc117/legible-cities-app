// What a map was drawn from, as the store writes it at the end of a draw
// (spec 037, FR-003, User Story 5): made from what the run sent, never from
// the record at the write. Main only, since only the store writes `drawn`.
// Pure: no Electron, no filesystem.

import { linesSent, styleSent } from '../../shared/project/helpers'
import type { DrawnFrom, SentSet, Theme } from '../../shared/project/types'
import { isEngineVersion } from '../../shared/project/validate'
import type { Station } from '../../shared/trip'

/**
 * What the map a run has just drawn was drawn from (spec 037, FR-003):
 * every field of what the run sent, copied, and nothing read from the
 * record's own choices. The theme is the record's at the write, since no
 * draw sends one and the page is told it in place (`setTheme`).
 *
 * `stations` is what the build answered (issue 272). Where it answered none
 * the app would take, the list the last draw kept is carried while the
 * layout and its `made` are the ones it was listed for; from another
 * layout, or the same id laid out again since, it is left out rather than
 * claimed.
 *
 * `engine` is the version of the engine that answered the draw (issue 494),
 * which main knows and the run does not send. Kept where it is a version
 * (`isEngineVersion`), and left out otherwise - never carried from the
 * block before, which another engine may have drawn.
 */
export function drawnFromSent(
  sent: SentSet,
  theme: Theme,
  before: DrawnFrom | null,
  stations?: Station[],
  engine?: string | null,
): DrawnFrom {
  const drawn: DrawnFrom = {
    layout: sent.layout,
    made: sent.made,
    date: sent.date,
    colors: { ...sent.colors },
    defaultColor: sent.defaultColor,
    lineOrder: [...sent.lineOrder],
    theme,
    // As `map.build` was sent it, which `sentSet` already made it; made so
    // again here, where the record is written, since the set came from the
    // renderer.
    style: styleSent(sent.style),
  }
  // The line options as they were sent (issue 394), and no key for none, so
  // a block drawn without any is the block it always was.
  const lines = linesSent(sent.lines)
  if (Object.keys(lines).length > 0) drawn.lines = lines
  if (stations !== undefined) {
    // The two fields and nothing else, whatever the caller's objects carried.
    drawn.stations = stations.map(({ id, name }) => ({ id, name }))
  } else if (
    before !== null &&
    before.stations !== undefined &&
    before.layout === sent.layout &&
    before.made === sent.made
  ) {
    drawn.stations = before.stations.map((station) => ({ ...station }))
  }
  if (isEngineVersion(engine)) drawn.engine = engine
  return drawn
}
