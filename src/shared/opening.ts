// The opening of a video or GIF export (issue 392, spec 035): a title card,
// the network drawing itself in, or the card and then the draw-in, played
// before the storyboard. The engine draws both (its issue 44, v0.15.0): a
// beat with `card` puts the title card up over the whole beat, and a beat
// with `draw_in` draws the network in over it, the capture stepping the
// fraction a frame at a time (`src/main/capture.ts`).
//
// What an opening is, as the record keeps it, lives here, beside the
// export's choice (`export.ts`), because the main process judges a choice
// as the store and as the bridge, and builds every plan. Cell 06's own
// words and the field reading are the renderer's (`renderer/src/opening.ts`).

import type { Storyboard, StoryboardBeat, View } from './protocol'

/**
 * The openings a record keeps, in the order the select offers them. None is
 * never kept: a choice without `opening` plays the storyboard as it is, which
 * is what every export before this feature did.
 */
export const OPENINGS = ['card', 'draw-in', 'card-then-draw-in'] as const

/** An opening a record may hold. */
export type StoredOpening = (typeof OPENINGS)[number]

/** An opening as cell 06 shows it, none included. */
export type Opening = 'none' | StoredOpening

export function isOpening(value: unknown): value is StoredOpening {
  return typeof value === 'string' && (OPENINGS as readonly string[]).includes(value)
}

/** Does this opening put the title card up? */
export const hasCard = (opening: Opening): boolean =>
  opening === 'card' || opening === 'card-then-draw-in'

/** Does this opening draw the network in? */
export const hasDrawIn = (opening: Opening): boolean =>
  opening === 'draw-in' || opening === 'card-then-draw-in'

/** A duration's bounds, closed, and what it is when nobody set it, in seconds. */
export interface SecondsRange {
  low: number
  high: number
  fallback: number
}

/**
 * The title card's seconds: 1 to 10, 2 unless set (issue 392, decided 10 Oct
 * 2026). The engine's own floor is 1 (its `CARD_SECS`) and its ceiling a
 * beat's 30; the ten is the app's.
 */
export const CARD_SECONDS: SecondsRange = { low: 1, high: 10, fallback: 2 }

/**
 * The draw-in's seconds: 2 to 20, 6 unless set. The engine's floor is 2 (its
 * `DRAW_IN_SECS`); the twenty is the app's.
 */
export const DRAW_IN_SECONDS: SecondsRange = { low: 2, high: 20, fallback: 6 }

/** A number of seconds inside a range: finite, and between its two ends. */
export function inSeconds(value: unknown, range: SecondsRange): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= range.low && value <= range.high
  )
}

/**
 * An export choice's three opening fields (issue 392). Each is optional and
 * absent means its default: no opening, a card of 2 seconds, a draw-in of 6.
 * A record never holds a default; a choice set back to one loses the key.
 */
export interface OpeningChoice {
  opening?: StoredOpening
  cardSecs?: number
  drawInSecs?: number
}

/** The three fields' names, for a validator that refuses any other and a reader that takes these. */
export const OPENING_KEYS = ['opening', 'cardSecs', 'drawInSecs'] as const

/** The refusal of a title card's seconds, as cell 06 says it beside the field. */
export const CARD_REFUSED = `A title card lasts from ${CARD_SECONDS.low} to ${CARD_SECONDS.high} seconds.`

/** The refusal of a draw-in's seconds. */
export const DRAW_IN_REFUSED = `A draw-in lasts from ${DRAW_IN_SECONDS.low} to ${DRAW_IN_SECONDS.high} seconds.`

/**
 * Why a choice's opening fields are not ones a record may hold, or null. The
 * main-side handler and the store both ask it, through
 * `validateExportChoice`, since both are trusted and the choice arrived from
 * the page.
 */
export function validateOpeningFields(choice: Record<string, unknown>): string | null {
  if (choice.opening !== undefined && !isOpening(choice.opening))
    return 'the opening must be a title card, the network drawing in, or the card and then the draw-in'
  if (choice.cardSecs !== undefined && !inSeconds(choice.cardSecs, CARD_SECONDS))
    return CARD_REFUSED
  if (choice.drawInSecs !== undefined && !inSeconds(choice.drawInSecs, DRAW_IN_SECONDS))
    return DRAW_IN_REFUSED
  return null
}

/**
 * The opening fields a stored choice holds, read field by field: one that
 * would be refused on write is read as not held, and the rest kept. An
 * opening read as none plays the storyboard as every export before this
 * feature did, so a field written by hand never costs the person their
 * preset or their options (spec 035, FR-003).
 */
export function readOpeningFields(value: Record<string, unknown>): OpeningChoice {
  const read: OpeningChoice = {}
  if (isOpening(value.opening)) read.opening = value.opening
  if (inSeconds(value.cardSecs, CARD_SECONDS)) read.cardSecs = value.cardSecs
  if (inSeconds(value.drawInSecs, DRAW_IN_SECONDS)) read.drawInSecs = value.drawInSecs
  return read
}

// ---------------------------------------------------------------- the list

/**
 * The views the network can draw itself in on, the engine's `DRAW_IN_VIEWS`:
 * the time chart fades the network out, and on the rows an interchange is a
 * dot a line.
 */
export const DRAW_IN_VIEWS = ['geographic', 'map'] as const satisfies readonly View[]

/**
 * The view an opening stands on (spec 035, FR-004, as of 10 Oct 2026): the
 * storyboard's own first view where the network can draw in on it - the map
 * or the geographic view - so the network draws in on the view the
 * storyboard starts from and nothing cuts away from it; else the map, before
 * a storyboard that opens on the rows or the time chart.
 */
export function openingView(storyboard: StoryboardBeats): View {
  const view = storyboard.beats[0]?.view
  return view === 'geographic' || view === 'map' ? view : 'map'
}

/** A storyboard as the list is made from it: its beats as `export.storyboards` writes them. */
export type StoryboardBeats = Pick<Storyboard, 'beats'>

/**
 * The clock the page starts at when its address names none (engine v0.15.0:
 * `let now = 7 * 3600` in `src/schematic/page/page.html`, line 1163, which the
 * engine's `export.PAGE_START = "07:00"` in `src/schematic/export.py`, line 72,
 * restates and its tests hold together). A storyboard asked for by its name
 * puts no clock on the page's address, so this is the clock the capture's
 * first look at the page - "no trains at ..." - has always read for one. The
 * opening's beats name it (spec 035, FR-004, as of 10 Oct 2026), so a list
 * puts the same clock on the address and an opening never makes the capture
 * refuse an export that succeeds without it.
 */
export const PAGE_START = '07:00'

/**
 * The clock a storyboard opens at: its first beat's `at`, or the first end of
 * the span it sweeps when it names none, which is where the engine's
 * recorder seeks to. Null for a storyboard whose first beat says neither,
 * which the engine refuses as a first beat and none of its storyboards is.
 * The opening is not made at it (it stands at `PAGE_START`); a storyboard
 * without one has no opening, since it would play from the opening's clock
 * and not its own.
 */
export function firstClock(storyboard: StoryboardBeats): string | null {
  const first = storyboard.beats[0]
  if (first === undefined) return null
  if (typeof first.at === 'string') return first.at
  if (first.sweep === true && first.hours == null && Array.isArray(first.span))
    return typeof first.span[0] === 'string' ? first.span[0] : null
  return null
}

/**
 * A beat with every field `export.storyboards` writes - the nine, nulls
 * included - and a flag only where it is true, as the engine writes them.
 */
function explicit(beat: StoryboardBeat): StoryboardBeat {
  const out: StoryboardBeat = {
    secs: beat.secs,
    view: beat.view ?? null,
    labels: beat.labels ?? null,
    at: beat.at ?? null,
    speed: beat.speed ?? null,
    sweep: beat.sweep ?? false,
    hours: beat.hours ?? null,
    span: Array.isArray(beat.span) ? [...beat.span] : null,
    tween: beat.tween ?? null,
  }
  if (beat.card === true) out.card = true
  if (beat.draw_in === true) out.draw_in = true
  return out
}

/** How long the opening's beats last; a duration left out is its default. */
export interface OpeningSeconds {
  card?: number
  drawIn?: number
}

/**
 * The list of beats `export.plan` is sent for a storyboard with an opening
 * (spec 035, FR-004), or null when there is no opening to play, in which
 * case the plan is asked for by the storyboard's name exactly as before.
 * Every opening is made for every storyboard, whatever view it opens on:
 * the engine takes a draw-in before one that opens on the rows (spec 035,
 * as of 10 Oct 2026), so the app refuses nothing the engine takes. A
 * storyboard whose first beat names no clock of its own (`firstClock`),
 * which the engine refuses and none of its own is, has none.
 *
 * The opening's beats come first, the card before the draw-in, so a card
 * followed by a draw-in stands on bare ground and the network draws in
 * under it. Each names the view it stands on (`openingView`: the
 * storyboard's own first view where that is the map or the geographic one,
 * else the map), the page's own start clock (`PAGE_START`), which is where
 * the capture has always looked for trains before a storyboard asked for by
 * name, a tween of 0, and a speed of 0: the clock holds under the opening,
 * which the card covers and the draw-in holds anyway. A card alone sits over
 * whatever that view shows. Where the storyboard's first beat names no
 * speed the opening names none either, so the storyboard plays at the speed
 * it always did.
 *
 * Then the storyboard's own beats, as `export.storyboards` writes them. Its
 * first, now second or third, keeps its view and its own clock, to which it
 * jumps after the opening - the network whole and the card gone by then -
 * and is sent a tween of 0: the engine reads a first beat's null tween as 0
 * and a later beat's as min(secs, 1.2), so 0 is what that beat was always
 * played with, and the storyboard plays as it did.
 */
export function openingBeats(
  storyboard: StoryboardBeats,
  opening: Opening,
  seconds: OpeningSeconds = {},
): StoryboardBeat[] | null {
  if (opening === 'none' || firstClock(storyboard) === null) return null
  const [first, ...rest] = storyboard.beats
  const speed = first.speed == null ? null : 0
  const view = openingView(storyboard)
  const opener = (secs: number): StoryboardBeat => ({
    secs,
    view,
    labels: null,
    at: PAGE_START,
    speed,
    sweep: false,
    hours: null,
    span: null,
    tween: 0,
  })
  const beats: StoryboardBeat[] = []
  if (hasCard(opening)) beats.push({ ...opener(seconds.card ?? CARD_SECONDS.fallback), card: true })
  if (hasDrawIn(opening))
    beats.push({ ...opener(seconds.drawIn ?? DRAW_IN_SECONDS.fallback), draw_in: true })
  beats.push({ ...explicit(first), tween: 0 })
  for (const beat of rest) beats.push(explicit(beat))
  return beats
}
