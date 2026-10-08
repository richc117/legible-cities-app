import type { MapStyle } from '../../shared/protocol'
import { STYLE_KEYS, STYLE_RANGES, styleSent, type ProjectStyle } from '../../shared/project'

// The map's sizes on the wire (issue 350, ADR-049).
//
// What a style sends is decided in `shared/project.ts`, beside the record,
// because the main process needs the same rule to record what a draw carried
// (`styleSent`): the fields a person chose, none at the engine's own number,
// both radii whenever either, and nothing at all for a style the engine would
// refuse. This module only puts that in the engine's names.

/**
 * The `style` object `map.build` is sent for a project's sizes, in the
 * engine's snake-case names, or null when there is none to send.
 *
 * Null, never `{}`: an omitted object draws exactly what is drawn without the
 * parameter, which is what keeps every existing project's map where it is,
 * and an empty one would be a request the app has never made. The four
 * colours the engine also takes (`background`, `station_fill`,
 * `station_stroke_color`, `label_color`) are not in `ProjectStyle` and so
 * cannot be here: the page's theme owns the furniture (ADR-049).
 */
export function mapStyle(style: ProjectStyle): MapStyle | null {
  const sent = styleSent(style)
  const wire: Record<string, number> = {}
  for (const key of STYLE_KEYS) {
    const value = sent[key]
    if (value !== undefined) wire[STYLE_RANGES[key].wire] = value
  }
  return Object.keys(wire).length === 0 ? null : (wire as MapStyle)
}

/**
 * The part of `map.build`'s params a style adds: `{ style }` when something
 * is set, and nothing at all - not a key with nothing in it - when not.
 */
export function styleParams(style: ProjectStyle): { style?: MapStyle } {
  const wire = mapStyle(style)
  return wire === null ? {} : { style: wire }
}
