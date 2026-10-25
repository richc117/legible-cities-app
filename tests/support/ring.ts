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
 * no second band, and no pair.
 */
export function twoTone(outline: RingReading, shadow: RingReading): RingReading | null {
  if (outline.kind !== 'outline' || shadow.kind !== 'shadow') return null
  if (outline.element === undefined || outline.element !== shadow.element) return null
  const visible = shown(shadow, outline)
  if (visible <= 0) return null
  const better = [outline, shadow]
    .filter((band) => band.ratio !== null)
    .sort((a, b) => (b.ratio as number) - (a.ratio as number))[0]
  // Only a band that is itself visible against the ground is part of the ring:
  // a 1px band at 5:1 beside a 1px band at 1.1:1 is a 1px ring at 5:1, not a
  // 2px one.
  const seen = (ratio: number | null): boolean => ratio !== null && ratio >= MIN_RING_CONTRAST
  return {
    kind: 'two-tone',
    width: (seen(outline.ratio) ? outline.width : 0) + (seen(shadow.ratio) ? visible : 0),
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
