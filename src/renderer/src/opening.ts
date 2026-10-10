import { copyChoice, type ExportChoice } from '../../shared/export'
import {
  CARD_REFUSED,
  CARD_SECONDS,
  DRAW_IN_REFUSED,
  DRAW_IN_SECONDS,
  inSeconds,
  type Opening,
  type SecondsRange,
} from '../../shared/opening'
import { parseFigure } from './styleRules'

// Cell 06's Opening (issue 392, spec 035): the select, its words, the two
// durations and what a commit does to the choice. The logic of
// `ExportOpening.tsx`, pure, so a unit test holds it without rendering and
// an end-to-end spec may read its sentences (a spec never imports a
// component). What an opening is - the three the record keeps, the ranges,
// the list it sends - is `shared/opening.ts`'s, because the main process
// judges and sends the same things.

/** The select's name. */
export const OPENING_LABEL = 'Opening'

/** The four as the select offers them, in order, in the issue's words. */
export const OPENING_OPTIONS: readonly { value: Opening; words: string }[] = [
  { value: 'none', words: 'None' },
  { value: 'card', words: 'Title card' },
  { value: 'draw-in', words: 'The network drawing in' },
  { value: 'card-then-draw-in', words: 'Title card, then the network drawing in' },
]

/** What the select does, said under it. */
export const OPENING_SENTENCE =
  'What plays before the storyboard: a title card naming the city, the network and the service day, with the caption under them, or the network drawing itself in, line by line.'

/** Said beside the preview while an opening is chosen (FR-005): the preview does not play it. */
export const PREVIEW_NOTE =
  'The opening plays in the export and not in the preview, which shows the map it plays over.'

/** The two durations' fields: the choice's key, the label, the range, the rule and the refusal. */
export const SECONDS_FIELDS = {
  cardSecs: {
    id: 'export-card',
    label: 'Card',
    range: CARD_SECONDS,
    rule: `How long the title card stays up: ${CARD_SECONDS.low} to ${CARD_SECONDS.high} seconds, ${CARD_SECONDS.fallback} unless you change it.`,
    refused: CARD_REFUSED,
  },
  drawInSecs: {
    id: 'export-draw-in',
    label: 'Draw-in',
    range: DRAW_IN_SECONDS,
    rule: `How long the network takes to draw itself in: ${DRAW_IN_SECONDS.low} to ${DRAW_IN_SECONDS.high} seconds, ${DRAW_IN_SECONDS.fallback} unless you change it.`,
    refused: DRAW_IN_REFUSED,
  },
} as const

/** Which of the two a field is. */
export type SecondsKey = keyof typeof SECONDS_FIELDS

/** The opening a choice plays: the stored one, or none. */
export const openingOf = (choice: ExportChoice): Opening => choice.opening ?? 'none'

/**
 * A choice with another opening. None removes the key, since a record never
 * holds it; the durations stay, as every option stays across presets.
 */
export function withOpening(choice: ExportChoice, opening: Opening): ExportChoice {
  const next = copyChoice(choice)
  if (opening === 'none') delete next.opening
  else next.opening = opening
  return next
}

/** What a duration's field shows: the choice's seconds, else the default. */
export const secondsText = (seconds: number | undefined, range: SecondsRange): string =>
  String(seconds ?? range.fallback)

/** A typed duration, read: the seconds (null for an emptied field, which is the default), or why not. */
export type SecondsReading = { ok: true; seconds: number | null } | { ok: false; problem: string }

/**
 * A duration's field read when it is committed (Enter, or leaving it): an
 * empty field is the default; a number in the range is taken, a decimal
 * included; anything else is refused in the field's sentence and nothing is
 * written (spec 035, FR-002).
 */
export function readSeconds(draft: string, key: SecondsKey): SecondsReading {
  const field = SECONDS_FIELDS[key]
  if (draft.trim() === '') return { ok: true, seconds: null }
  const figure = parseFigure(draft)
  return inSeconds(figure, field.range)
    ? { ok: true, seconds: figure }
    : { ok: false, problem: field.refused }
}

/**
 * A choice with a duration. The default, and an emptied field, remove the
 * key: a record never holds a duration at its default (FR-003).
 */
export function withSeconds(
  choice: ExportChoice,
  key: SecondsKey,
  seconds: number | null,
): ExportChoice {
  const next = copyChoice(choice)
  if (seconds === null || seconds === SECONDS_FIELDS[key].range.fallback) delete next[key]
  else next[key] = seconds
  return next
}
