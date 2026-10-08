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
 * A pause in milliseconds that the panels' waits are measured in. The line
 * colours do not use it to decide when a gesture is over: a colour builds
 * when the picker is released or the hex field's button is pressed, never
 * on a quiet interval (issue 262), so a drag of any speed is one build.
 * They use it for the one thing that is a wait, a release the page could
 * not take because a run or an export was reading it, which asks again
 * whether the way is clear after this long. The line order still builds a
 * move on it as a debounce (`LineOrder.tsx`), which is why it is kept here.
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

/**
 * What a person has chosen that the map does not carry yet, in the two
 * shapes it can take (issue 262). The map follows the end of a gesture and
 * not its every colour, so between a gesture's first colour and the map
 * carrying its last, the screen shows colours the record does not hold, and
 * the panel has to know that or it will throw them away.
 */
export interface Unbuilt {
  /**
   * The colours a gesture has reached and not yet released: a drag with the
   * pointer still down, or an arrow key still held. The swatch and the hex
   * field follow it; nothing has been sent.
   */
  readonly live: Palette | null
  /**
   * The last release that could not be built because a run or an export was
   * reading the page. It builds once the way is clear, and a later release
   * replaces it.
   */
  readonly held: Palette | null
}

/** Nothing chosen and unbuilt: the screen shows the record. */
export const NOTHING_UNBUILT: Unbuilt = { live: null, held: null }

/** What to do about a release, and what is left unbuilt after it. */
export interface Outcome {
  step: 'build' | 'wait' | 'none'
  unbuilt: Unbuilt
}

/**
 * A gesture reached `next`: the swatch follows and nothing is built.
 * Whatever is already waiting stays waiting.
 */
export function reached(unbuilt: Unbuilt, next: Palette): Unbuilt {
  return { ...unbuilt, live: next }
}

/**
 * The gesture ended on `next`: the picker was released, or the hex field's
 * button was pressed. This is the commit point, and it is decided by
 * `nextStep` as every change is - built if the way is clear, held if it is
 * not, nothing if it is no change. It replaces a release that was waiting,
 * which is what a later choice means.
 */
export function released(unbuilt: Unbuilt, next: Palette, stored: Palette, busy: boolean): Outcome {
  return decide({ ...unbuilt, live: null }, next, stored, busy)
}

/**
 * Ask again whether a held release can be built now. While another
 * gesture is going it cannot: that gesture's release will say what to
 * build, and building the older choice under a person's hand would be a
 * second build for what they see as one.
 */
export function retried(unbuilt: Unbuilt, stored: Palette, busy: boolean): Outcome {
  if (unbuilt.held === null) return { step: 'none', unbuilt }
  if (unbuilt.live !== null) return { step: 'wait', unbuilt }
  return decide(unbuilt, unbuilt.held, stored, busy)
}

function decide(unbuilt: Unbuilt, next: Palette, stored: Palette, busy: boolean): Outcome {
  const step = nextStep(next, stored, busy)
  return { step, unbuilt: { live: unbuilt.live, held: step === 'wait' ? next : null } }
}

/**
 * A build that stopped wrote nothing, so the screen goes back to the
 * record and nothing is left unbuilt: a release that was waiting is
 * dropped, because building it would draw colours a person has just been
 * told the project did not keep, and so is a gesture's live colour. The
 * picker clears its changed flag when the colour it is given moves under
 * it, so a pointer or a key released without another move never reports
 * its end, and a gesture left standing would hold the record off the screen
 * and every release back until the panel closed, and then build a colour
 * the swatch stopped showing. The gesture's next colour reaches `reached`
 * again, and its end follows.
 */
export function stopped(): Unbuilt {
  return NOTHING_UNBUILT
}

/**
 * May the record, as it has just been read, replace the colours on screen?
 * Not while a gesture is going or a release is waiting: the view reads the
 * record again whenever any run finishes, and under a pointer that would
 * move the picker's thumb back under the person's hand.
 */
export function mayAdoptRecord(unbuilt: Unbuilt): boolean {
  return unbuilt.live === null && unbuilt.held === null
}
