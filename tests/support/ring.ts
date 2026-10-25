// The rule the accessibility sweep holds a focus ring to (issue 436, R10-03).
//
// The sweep used to ask whether a control draws *an* indicator when it takes
// focus: an outline it did not have, or a shadow where it had none. That
// passes a one-pixel ring in a colour the ground swallows. WCAG 2.2 asks for
// more (2.4.13, Focus Appearance, at AAA; the design document holds the
// interface to it): the indicator is at least two CSS pixels thick and its
// colour differs from the ground it is drawn against by at least 3:1.
//
// The probe in `a11y.ts` runs in the page and reports what it measured from
// computed styles, one reading per ring a control draws when it takes focus.
// This file is the verdict on those readings, kept apart so that it runs in
// Node, under a unit test that can be watched going red
// (`tests/unit/ring.test.ts`).

export const MIN_RING_WIDTH = 2
export const MIN_RING_CONTRAST = 3

/** One ring a control draws when focused, as the page measured it. */
export interface RingReading {
  /** An `outline`, or a `box-shadow` that was not there at rest. */
  kind: 'outline' | 'shadow' | 'two-tone'
  /** Thickness in CSS pixels: the outline's width, or the shadow's spread. */
  width: number
  /** The ring's computed colour, as the page reported it. */
  colour: string
  /** The colour behind it once the layers under it were composed; null if it could not be read. */
  ground: string | null
  /** The ring against that ground; null if either could not be read. */
  ratio: number | null
  /** Which element of the control's chain drew it (the control, its host, its parent). */
  element?: number
  /** An outline's offset from the border box, in pixels; negative lies inside. */
  offset?: number
  /** A shadow drawn inside the border box rather than outside it. */
  inset?: boolean
  /** A shadow whose colour is fully opaque. */
  opaque?: boolean
}

/** A control and every ring it draws on taking focus. */
export interface RingsOf {
  control: string
  rings: RingReading[]
}

/** How much of a shadow shows beside an outline on the same element: the outline is painted over the shadow beneath it. */
function shown(shadow: RingReading, outline: RingReading | undefined): number {
  if (outline === undefined || shadow.inset === true) return shadow.width
  const offset = outline.offset ?? 0
  const from = Math.max(0, offset)
  const to = Math.min(shadow.width, offset + outline.width)
  return shadow.width - Math.max(0, to - from)
}

/**
 * An outline and a hard-edged shadow on the same element, side by side, read
 * as one ring of two bands (issue 436), for a control whose ground is not one
 * the interface chooses and so has no one ring colour that clears 3:1 on it:
 * it draws two, in the theme's ink and ground, and the better of the two is
 * what a person sees. No control draws one today; the support is here for the
 * first that needs it. The pair is as thick as the two bands together where they do
 * not overlap - an outline is painted over the shadow beneath it - and its
 * ratio is the better band's. Only a band that itself clears the contrast
 * counts towards the thickness. A shadow wholly hidden under the outline is
 * no second band, and no pair - unless the outline lies wholly over an opaque
 * band of its own (see `covers`), where it is still judged against that band.
 */
/** The channels of `rgb(r, g, b)` or `rgba(r, g, b, a)`, as the page reports them. */
function channels(text: string): [number, number, number, number] | null {
  const m = /^rgba?\(([^)]+)\)$/.exec(text.trim())
  if (m === null) return null
  const parts = m[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number)
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null
  return [parts[0], parts[1], parts[2], parts[3] ?? 1]
}

const luminance = ([r, g, b]: number[]): number => {
  const c = (v: number): number => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b)
}

/** An outline colour against an opaque colour it is drawn over; null if either cannot be read. */
function against(ink: string, ground: string): number | null {
  const fg = channels(ink)
  const bg = channels(ground)
  if (fg === null || bg === null) return null
  const a = fg[3]
  const drawn = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a))
  const l1 = luminance(drawn)
  const l2 = luminance(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/**
 * Whether an outline lies wholly over the same element's outer, opaque,
 * hard-edged shadow: from its offset out to its offset and its width is within
 * the shadow's spread. Then what the outline is drawn on is that shadow, and
 * it is known whatever the page is behind it (a control laid over a frame,
 * like "Skip past the map", carries its own ground for exactly this).
 */
function covers(outline: RingReading, shadow: RingReading): boolean {
  const offset = outline.offset ?? 0
  return (
    shadow.inset !== true &&
    shadow.opaque === true &&
    offset >= 0 &&
    offset + outline.width <= shadow.width
  )
}

export function twoTone(outline: RingReading, shadow: RingReading): RingReading | null {
  if (outline.kind !== 'outline' || shadow.kind !== 'shadow') return null
  if (outline.element === undefined || outline.element !== shadow.element) return null
  const covered = covers(outline, shadow)
  const visible = shown(shadow, outline)
  if (visible <= 0 && !covered) return null
  // Over its own band the outline's ground is the band, wherever the page
  // behind is unreadable. The band itself, on a ground that is unreadable, has
  // no ratio of its own and contributes no width.
  const outlineRatio = covered ? against(outline.colour, shadow.colour) : outline.ratio
  // Only a band that is itself visible against the ground is part of the ring:
  // a 1px band at 5:1 beside a 1px band at 1.1:1 is a 1px ring at 5:1, not a
  // 2px one.
  const seen = (ratio: number | null): boolean => ratio !== null && ratio >= MIN_RING_CONTRAST
  const bands = [
    { ratio: outlineRatio, ground: covered ? shadow.colour : outline.ground },
    { ratio: shadow.ratio, ground: shadow.ground },
  ].filter((band): band is { ratio: number; ground: string | null } => band.ratio !== null)
  const better = bands.sort((a, b) => b.ratio - a.ratio)[0]
  return {
    kind: 'two-tone',
    width: (seen(outlineRatio) ? outline.width : 0) + (seen(shadow.ratio) ? visible : 0),
    colour: `${outline.colour} then ${shadow.colour}`,
    ground: better?.ground ?? null,
    ratio: better?.ratio ?? null,
  }
}

const withPairs = (readings: RingReading[]): RingReading[] => {
  // A shadow beside an outline is only as thick as what shows of it.
  const rings = readings.map((ring) =>
    ring.kind === 'shadow'
      ? {
          ...ring,
          width: shown(
            ring,
            ring.element === undefined
              ? undefined
              : readings.find((o) => o.kind === 'outline' && o.element === ring.element),
          ),
        }
      : ring,
  )
  const pairs: RingReading[] = []
  for (const outline of readings)
    for (const shadow of readings) {
      const pair = twoTone(outline, shadow)
      if (pair !== null) pairs.push(pair)
    }
  return [...rings, ...pairs]
}

const holds = (ring: RingReading): boolean =>
  ring.width >= MIN_RING_WIDTH && ring.ratio !== null && ring.ratio >= MIN_RING_CONTRAST

const says = (ring: RingReading): string =>
  `${ring.kind} ${ring.width}px ${ring.colour} on ${ring.ground ?? 'a ground that could not be read'}` +
  ` = ${ring.ratio === null ? 'unmeasured' : `${ring.ratio.toFixed(2)}:1`}`

/**
 * The controls none of whose rings is both at least two pixels thick and at
 * least 3:1 against its ground, each with what was measured. A control passes
 * on any one ring that holds: a kit control may draw a ring and a halo, and
 * the halo is not the indicator. A control that shows something on focus
 * which is neither an outline nor a hard-edged shadow (a blurred glow) has no
 * ring to hold, and is listed.
 */
export function weakRings(controls: RingsOf[]): string[] {
  return controls
    .filter(({ rings }) => !withPairs(rings).some(holds))
    .map(
      ({ control, rings }) =>
        `${control}: ` +
        (rings.length === 0
          ? 'it shows something on focus, but no outline and no hard-edged shadow'
          : withPairs(rings).map(says).join('; ')),
    )
}

/** An element's ring as computed: its outline (`none`, or style, width and colour) and its box-shadow. */
export interface RingStyle {
  outline: string
  shadow: string
}

/**
 * One stop of a Tab walk as the page read it: the control, and for each
 * element of its chain (the control, its host, its parent) its ring while it
 * held focus, its ring at rest, and the rings measured while it held focus.
 */
export interface StopReading {
  control: string
  /** A frame, whose page draws its own focus and is not judged here. */
  frame: boolean
  focused: RingStyle[]
  /**
   * The chain at rest, or null where it could not be read: an element of it
   * has left the document and no reading of it from before it took focus
   * was kept.
   */
  rest: RingStyle[] | null
  measured: { outline: RingReading | null; shadows: RingReading[] }[]
}

/** What a walk's stops come to: controls that drew nothing, the rings of those that did, and controls that could not be judged. */
export interface StopVerdict {
  unringed: string[]
  rings: RingsOf[]
  unjudged: string[]
}

/**
 * Which stops drew a ring on taking focus, and what it was (issue 436).
 *
 * An outline the control did not have at rest, or a shadow where it had
 * none: a shadow that merely changes does not count, because a kit text
 * field drops its resting edge on focus and would pass with no ring at all.
 * The rings counted are the same ones, and are what R10-03 measures.
 *
 * **A stop whose rest could not be read is unjudged, and said**, never
 * dropped. The walk read it as reached, so the sweep would otherwise pass it
 * having judged nothing: the colour panel's controls are unmounted once
 * focus leaves the panel, which closes it, and the first version of this
 * skipped every control no longer in the document, so a sweep of the open
 * picker judged none of its controls and was green.
 */
export function judgeStops(stops: StopReading[]): StopVerdict {
  const verdict: StopVerdict = { unringed: [], rings: [], unjudged: [] }
  for (const stop of stops) {
    if (stop.frame) continue
    const rest = stop.rest
    if (rest === null) {
      verdict.unjudged.push(stop.control)
      continue
    }
    const drawn: RingReading[] = []
    let shows = false
    stop.focused.forEach((focused, i) => {
      const at = stop.measured[i]
      const outline = focused.outline !== 'none' && focused.outline !== rest[i].outline
      const shadow = focused.shadow !== 'none' && rest[i].shadow === 'none'
      if (outline || shadow) shows = true
      if (outline && at.outline) drawn.push({ ...at.outline, element: i })
      if (shadow) drawn.push(...at.shadows.map((ring) => ({ ...ring, element: i })))
    })
    if (!shows) verdict.unringed.push(stop.control)
    else verdict.rings.push({ control: stop.control, rings: drawn })
  }
  return verdict
}
