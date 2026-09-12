import { DEFAULT_COLOR, isHexColor, validateLineLabel, type Palette } from '../../shared/project'
import type { Inspection, Route } from '../../shared/protocol'
import { keeps, routesOf } from './Inspect'

// The colour handling, with no React in it: which lines a project has,
// what each is drawn in, and what an edit does to the palette. The rule
// that logic lives in something callable without rendering is what makes
// these testable (.claude/rules/renderer.md), and the panel above them
// (LineColours.tsx) is then only a screen.
//
// Nothing here resolves a colour for the engine. The engine resolves an
// override over the feed's own route_color over the default, once, and
// hands the resolved table to the page (render.line_colors, E06); the app
// sends the same two fields the CLI does and computes the same answer only
// so it can show a swatch and say, in words, where the colour came from.

/**
 * How long the panel waits after the last change before it builds, in
 * milliseconds. Long enough that a drag through a hue is one build, short
 * enough that a single choice feels answered.
 */
export const REDRAW_DELAY = 400

/** One line the map draws: its label, and the colour the feed publishes for it. */
export interface Line {
  label: string
  /** The feed's own route_color as `#rrggbb`, or null when the feed leaves it blank. */
  feed: string | null
}

/** Where a line's colour came from, in the engine's own order of preference. */
export type ColourSource = 'override' | 'feed' | 'default'

export interface Shown {
  color: string
  source: ColourSource
}

/**
 * The lines a project's map draws, from the feed as the engine read it.
 *
 * The routes are narrowed by the same two choices the layout was made with
 * and then grouped by label, because the map draws one line per label and a
 * feed may publish several routes under one (a route per direction, or per
 * pattern). The first colour the feed publishes for a label is that line's;
 * a label with no coloured route reads as none.
 *
 * This is a superset of the labels the stored layout carries, and
 * deliberately so: the layout's own `stages.octi.lines` name exactly what
 * the map draws but carry no colour and are in hand only during a run. The
 * engine ignores a colour for a label its layout does not carry, which is
 * what makes the wider list safe and what lets an override outlive a
 * narrower mode (protocol, MapBuildParams.colors).
 */
export function linesOf(
  inspection: Inspection,
  inputs: { mode: string; agency: string | null },
): Line[] {
  const byType = new Map(inspection.route_types.map((t) => [t.route_type, t]))
  const kept = routesOf(inspection.routes, inputs.agency).filter((route: Route) => {
    const type = byType.get(route.route_type)
    return type === undefined ? false : keeps(inputs.mode, type)
  })
  const lines = new Map<string, Line>()
  for (const route of kept) {
    // A label the record could not hold is not offered: choosing a colour
    // for it would draw the map and then be refused on the way to disk,
    // and the screen would disagree with the page. `parseRecord` drops the
    // same labels on read.
    if (validateLineLabel(route.label) !== null) continue
    const held = lines.get(route.label)
    const feed = feedColour(route.color)
    if (held === undefined) lines.set(route.label, { label: route.label, feed })
    else if (held.feed === null) held.feed = feed
  }
  return [...lines.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { numeric: true }),
  )
}

/**
 * A feed's route_color as the engine reports it: six hex digits with no
 * hash, or null. Anything else is treated as no colour rather than shown
 * as one, because a swatch is a claim about the feed.
 */
export function feedColour(color: string | null | undefined): string | null {
  if (typeof color !== 'string') return null
  const hex = color.startsWith('#') ? color : `#${color}`
  return isHexColor(hex) ? hex.toLowerCase() : null
}

/**
 * What a line is drawn in, and which of the three it came from: the
 * person's override, else the feed's own colour, else the default. The
 * engine's order, held here so the screen can say it.
 */
export function shownColour(line: Line, palette: Palette): Shown {
  const override = hasOverride(palette, line.label) ? palette.colors[line.label] : undefined
  if (isHexColor(override)) return { color: override.toLowerCase(), source: 'override' }
  if (line.feed !== null) return { color: line.feed, source: 'feed' }
  return { color: palette.defaultColor, source: 'default' }
}

/**
 * Has this line an override of its own? `in` would answer yes for a line
 * labelled `toString` or `constructor`, because it walks the prototype
 * chain, and a feed's labels are not ours to choose.
 */
export function hasOverride(palette: Palette, label: string): boolean {
  return Object.prototype.hasOwnProperty.call(palette.colors, label)
}

/**
 * The palette with one line overridden. A colour that is not one is
 * refused, and so is a label the record could not hold: the panel changes
 * nothing the store would reject.
 */
export function withOverride(palette: Palette, label: string, colour: string): Palette {
  const hex = readHex(colour)
  if (hex === null || validateLineLabel(label) !== null) return palette
  return { ...palette, colors: { ...palette.colors, [label]: hex } }
}

/** The palette with one line's override removed: back to the feed, or the default. */
export function withoutOverride(palette: Palette, label: string): Palette {
  if (!hasOverride(palette, label)) return palette
  const colors = { ...palette.colors }
  delete colors[label]
  return { ...palette, colors }
}

/** The palette with another default for the lines the feed leaves uncoloured. */
export function withDefault(palette: Palette, colour: string): Palette {
  const hex = readHex(colour)
  if (hex === null) return palette
  return { ...palette, defaultColor: hex }
}

/** Every override gone and the default back to the record's: one reset for all. */
export function resetAll(): Palette {
  return { colors: {}, defaultColor: DEFAULT_COLOR }
}

/** Is there anything to reset? A palette with no override and the plain default is not. */
export function isReset(palette: Palette): boolean {
  return Object.keys(palette.colors).length === 0 && palette.defaultColor === DEFAULT_COLOR
}

/**
 * A colour as a person may type it: with or without the hash, in three
 * digits or six, in either case. Answers `#rrggbb` in lower case, or null
 * for anything that is not a colour.
 */
export function readHex(text: string): string | null {
  const body = text.trim().replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{3}$/.test(body)) {
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`
  }
  return /^[0-9a-f]{6}$/.test(body) ? `#${body}` : null
}

/** Where this line's colour came from, for a person and for a screen reader. */
export function sourceWords(shown: Shown): string {
  if (shown.source === 'override') return `your colour, ${shown.color}`
  if (shown.source === 'feed') return `the colour in the feed, ${shown.color}`
  return `the default, ${shown.color}`
}

/** What the feed publishes for this line, in words. */
export function feedWords(line: Line): string {
  return line.feed === null ? 'no colour in feed' : line.feed
}

/**
 * What a change should do at this moment: build it, wait for the way to
 * clear, or nothing at all because it is not a change. A layout, a rebuild
 * or an export is reading the page a colour build would rewrite, so a
 * change made during one waits rather than being refused - no control has
 * to disable itself under a person's hands (FR-009).
 */
export function nextStep(next: Palette, stored: Palette, busy: boolean): 'build' | 'wait' | 'none' {
  if (samePalette(next, stored)) return 'none'
  return busy ? 'wait' : 'build'
}

/** Two palettes with the same overrides and the same default; nothing is rebuilt for a change that is not one. */
export function samePalette(a: Palette, b: Palette): boolean {
  if (a.defaultColor !== b.defaultColor) return false
  const keys = Object.keys(a.colors)
  if (keys.length !== Object.keys(b.colors).length) return false
  return keys.every((key) => a.colors[key] === b.colors[key])
}
