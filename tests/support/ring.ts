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
  kind: 'outline' | 'shadow'
  /** Thickness in CSS pixels: the outline's width, or the shadow's spread. */
  width: number
  /** The ring's computed colour, as the page reported it. */
  colour: string
  /** The colour behind it once the layers under it were composed; null if it could not be read. */
  ground: string | null
  /** The ring against that ground; null if either could not be read. */
  ratio: number | null
}

/** A control and every ring it draws on taking focus. */
export interface RingsOf {
  control: string
  rings: RingReading[]
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
    .filter(({ rings }) => !rings.some(holds))
    .map(
      ({ control, rings }) =>
        `${control}: ` +
        (rings.length === 0
          ? 'it shows something on focus, but no outline and no hard-edged shadow'
          : rings.map(says).join('; ')),
    )
}
