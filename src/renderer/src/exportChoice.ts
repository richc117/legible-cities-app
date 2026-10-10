import {
  CAPTION_MAX,
  CLOCK_CORNERS,
  copyChoice,
  DEFAULT_CHOICE,
  DEFAULT_QUALITY,
  isOfferedPreset,
  isStoryboardName,
  lengthOf,
  playsStoryboard,
  trimAsEngine,
  validateCaption,
  type ExportChoice,
  type ExportChoiceOptions,
  type ExportPreview,
  type OfferedPreset,
  type Quality,
} from '../../shared/export'
import type { ClockCorner, Preset, Storyboard, View } from '../../shared/protocol'
import { debounce, type Debounced } from './debounce'

// The export tab's logic, with no React in it (A5-01, specs/022-export-tab):
// which presets are offered and how they read, what an option defaults to,
// what a change does to the choice, and the preview's planning, debounced
// and with a late answer dropped. The tab (ExportTab.tsx) is then only a
// screen, and these are what the unit tests hold.
//
// Nothing here decides what an export looks like. The engine's tables say
// what a preset is; its plan says what the page shows. The defaults below
// are what `export.plan` does when an option is not sent, restated only so
// the controls can show them - and an option a person sets back to its
// default is removed rather than sent, so the engine's own default stays
// the one that applies.

/**
 * How long the tab waits after the last change before it plans a preview,
 * in milliseconds. A person tabbing through a row of checkboxes plans once
 * when they stop.
 */
export const PREVIEW_DELAY = 250

/** A preset the engine returned and the app offers. */
export type OfferedRow = Preset & { name: OfferedPreset }

/** The engine's two tables, as the tab uses them. */
export interface ExportTables {
  presets: OfferedRow[]
  storyboards: Storyboard[]
}

/** The engine's presets the app offers, in the engine's own order. */
export function offeredOf(presets: readonly Preset[]): OfferedRow[] {
  return presets.filter((preset): preset is OfferedRow => isOfferedPreset(preset.name))
}

/** The offered presets by platform, each platform where its first preset is. */
export function byPlatform(
  presets: readonly OfferedRow[],
): { platform: string; presets: OfferedRow[] }[] {
  const groups = new Map<string, OfferedRow[]>()
  for (const preset of presets) {
    const group = groups.get(preset.platform)
    if (group === undefined) groups.set(preset.platform, [preset])
    else group.push(preset)
  }
  return [...groups].map(([platform, rows]) => ({ platform, presets: rows }))
}

/** Is this preset a video or a GIF, which play a storyboard? The shared rule, under the tab's name. */
export const plays = playsStoryboard

/** A preset as the chooser lists it: the engine's name, its size and what it makes. */
export function presetWords(preset: Preset): string {
  const made =
    preset.format === 'gif'
      ? 'GIF'
      : preset.kind === 'video'
        ? `video, ${preset.format.toUpperCase()}`
        : `still, ${preset.format.toUpperCase()}`
  return `${preset.name}: ${preset.width} by ${preset.height}, ${made}`
}

/** A storyboard as the chooser lists it: its name, the views it visits and its length. */
export function storyboardWords(storyboard: Storyboard): string {
  const views = storyboard.views.split(' -> ').filter((view) => view !== '')
  const visited =
    views.length <= 1
      ? (views[0] ?? 'one view')
      : `${views.slice(0, -1).join(', ')} and ${views[views.length - 1]}`
  const seconds = Math.round(storyboard.seconds * 10) / 10
  return `${storyboard.name}: ${visited}, ${seconds} seconds`
}

/** What `export.plan` does with an option it is not sent, for this preset. */
export interface OptionDefaults {
  view: View
  labels: boolean
  title: boolean
  clock: boolean
  quality: Quality
}

export function defaultsFor(preset: Pick<Preset, 'view' | 'labels' | 'kind'>): OptionDefaults {
  return {
    view: preset.view,
    labels: preset.labels,
    // The engine's plan: a title unless told not to, a clock on a video.
    title: true,
    clock: preset.kind === 'video',
    quality: DEFAULT_QUALITY,
  }
}

/**
 * The choice as the tab can use it, against the engine's tables: a saved
 * preset or storyboard the engine no longer returns falls back to the reel
 * and its own storyboard, and says which name was dropped (User Story 5,
 * scenario 3). A storyboard saved beside a still preset means nothing and
 * is left out quietly, and so is a clock corner the preset would refuse - a
 * record written by hand, or against an older table - the way a change of
 * preset drops one, so the plan is not refused for a corner the select
 * would not show (issue 352).
 */
export function usable(
  saved: ExportChoice,
  tables: ExportTables,
): { choice: ExportChoice; dropped: string | null } {
  const preset = tables.presets.find((row) => row.name === saved.preset)
  if (preset === undefined) return { choice: copyChoice(DEFAULT_CHOICE), dropped: saved.preset }
  const options = withoutRefusedCorner(saved.options, preset)
  const read = options === saved.options ? saved : { ...copyChoice(saved), options }
  if (read.storyboard !== undefined) {
    if (!plays(preset)) {
      const kept = copyChoice(read)
      delete kept.storyboard
      return { choice: kept, dropped: null }
    }
    if (!tables.storyboards.some((board) => board.name === read.storyboard))
      return { choice: copyChoice(DEFAULT_CHOICE), dropped: read.storyboard }
  }
  return { choice: read, dropped: null }
}

/**
 * The storyboard a choice plays, as the engine's table lists it: the one it
 * names, else the preset's own; none for a still, or one the table lacks.
 */
export function playedBy(
  choice: Pick<ExportChoice, 'storyboard'>,
  preset: Pick<Preset, 'kind' | 'storyboard'>,
  tables: Pick<ExportTables, 'storyboards'>,
): Storyboard | undefined {
  if (!plays(preset)) return undefined
  const name = choice.storyboard ?? preset.storyboard
  return tables.storyboards.find((board) => board.name === name)
}

type Flag = 'labels' | 'title' | 'clock'

/**
 * The corner the engine puts the clock in when it is told none: the
 * platform's own interface covers the bottom right of a preset with safe
 * zones, so there it is the top right; everywhere else it is where the clock
 * has always sat. Restated only so the select can show it, and so a corner
 * set back to it is removed rather than sent (issue 352, ADR-052).
 */
export const defaultCorner = (preset: Pick<Preset, 'safe_zones'>): ClockCorner =>
  preset.safe_zones ? 'top-right' : 'bottom-right'

/** What decides, besides the preset, which corners are offered. */
export interface NameBlock {
  /** The title is drawn: city, network and service day, top left. */
  title: boolean
  /** A caption is set: it is drawn under the title, top left. */
  caption: boolean
}

/**
 * The corners the select offers, which are the ones the engine will plan
 * (issue 352, ADR-052; `_clock_corner` in the engine's `export.py`). A
 * corner the engine refuses is absent and not disabled. The bottom right is
 * absent on a preset with safe zones, because the platform's own buttons
 * cover it; the top left is absent while the title or a caption is drawn, on
 * any preset, because that is where the name block sits. So a reel, which
 * draws its title unless told not to, offers the top right and the bottom
 * left; a LinkedIn video offers the other three, and all four once the
 * title is off and there is no caption. The engine still judges whatever
 * is sent.
 */
export function offeredCorners(
  preset: Pick<Preset, 'safe_zones'>,
  drawn: NameBlock,
): ClockCorner[] {
  return CLOCK_CORNERS.filter((corner) => {
    if (corner === 'bottom-right') return !preset.safe_zones
    if (corner === 'top-left') return !(drawn.title || drawn.caption)
    return true
  })
}

const CORNER_NAMES: Record<ClockCorner, string> = {
  'top-left': 'top left',
  'top-right': 'top right',
  'bottom-left': 'bottom left',
  'bottom-right': 'bottom right',
}

/** A corner as the select names it. */
export const cornerWords = (corner: ClockCorner): string => CORNER_NAMES[corner]

/**
 * The sentence under the clock's corner: why a corner is not on offer, and
 * the note a platform's bottom zone comes with (issue 352, ADR-052). The
 * engine's own note, with the zone's size in it, arrives with the plan once
 * the bottom left is chosen, and is shown with the plan's other notes; this
 * is the same warning before it is chosen, which is when it can be acted on,
 * and it carries no figure the app would have to know.
 */
export function cornerNote(
  preset: Pick<Preset, 'safe_zones'>,
  clock: boolean,
  drawn: NameBlock,
): string {
  if (!clock) return 'The clock is off, so it has no corner to choose.'
  const sentences: string[] = []
  if (preset.safe_zones)
    sentences.push(
      'The platform’s own buttons cover the bottom right, so it is not offered. Bottom left is inside its bottom zone, where they can cover the clock; top right keeps it clear.',
    )
  if (drawn.title || drawn.caption)
    sentences.push(
      'The title and a caption sit top left, so the clock is not offered there while either is drawn.',
    )
  return sentences.join(' ')
}

/** The name block as a choice's options leave it: the title is on unless told off. */
const nameBlockOf = (
  options: ExportChoiceOptions,
  preset: Pick<Preset, 'view' | 'labels' | 'kind'>,
): NameBlock => ({
  title: options.title ?? defaultsFor(preset).title,
  caption: options.caption !== undefined,
})

/**
 * Options with a corner the preset or the name block would refuse taken out,
 * the way an option a preset cannot take already is. The corner goes back to
 * the engine's default, which is what the select then shows.
 */
export function withoutRefusedCorner(
  options: ExportChoiceOptions,
  preset: Pick<Preset, 'view' | 'labels' | 'kind' | 'safe_zones'>,
): ExportChoiceOptions {
  const corner = options.clock_corner
  if (corner === undefined || offeredCorners(preset, nameBlockOf(options, preset)).includes(corner))
    return options
  const kept = { ...options }
  delete kept.clock_corner
  return kept
}

/**
 * A choice with one option changed. An option set to what the engine does
 * without it is removed, and so is an empty start time, tag, caption or list
 * of lines: none of them is sent (FR-004). A change that leaves the chosen
 * corner one the engine would refuse - the title turned on beside the top
 * left - takes the corner out too.
 */
export function withOption(
  choice: ExportChoice,
  preset: Pick<Preset, 'view' | 'labels' | 'kind' | 'safe_zones'>,
  change:
    | { key: 'view'; value: View }
    | { key: Flag; value: boolean }
    | { key: 'quality'; value: Quality }
    | { key: 'at' | 'tag' | 'caption'; value: string }
    | { key: 'clock_corner'; value: ClockCorner }
    | { key: 'lines'; value: string[] },
): ExportChoice {
  const defaults = defaultsFor(preset)
  const options: ExportChoiceOptions = { ...copyChoice(choice).options }
  const set = (key: keyof ExportChoiceOptions, value: unknown, unset: boolean): void => {
    if (unset) delete options[key]
    else (options as Record<string, unknown>)[key] = value
  }
  switch (change.key) {
    case 'view':
    case 'quality':
    case 'labels':
    case 'title':
    case 'clock':
      set(change.key, change.value, change.value === defaults[change.key])
      break
    case 'at':
    case 'tag':
    case 'caption':
      set(change.key, change.value.trim(), change.value.trim() === '')
      break
    case 'clock_corner':
      set('clock_corner', change.value, change.value === defaultCorner(preset))
      break
    case 'lines':
      set('lines', [...change.value], change.value.length === 0)
      break
  }
  return { ...copyChoice(choice), options: withoutRefusedCorner(options, preset) }
}

/**
 * A choice with the sidecar's alt text: trimmed, and none at all when it is
 * blank, so the engine writes its own sentence (issue 352). It is the
 * person's words and not an option, so it sits beside the options.
 */
export function withAlt(choice: ExportChoice, alt: string): ExportChoice {
  const next = copyChoice(choice)
  const text = trimAsEngine(alt)
  if (text === '') delete next.alt
  else next.alt = text
  return next
}

/**
 * A choice with another preset. The options stay, since a person who
 * turned the clock off meant it, and so does the alt text; the storyboard
 * goes back to the new preset's own, which is what the chooser shows for a
 * preset first picked. A clock corner the new preset would refuse goes, as
 * an option it cannot take does: the bottom right is the platform's own
 * button rail on a reel. `row` is the engine's entry for the new preset;
 * without it the corner stays and the engine judges it.
 */
export function withPreset(
  choice: ExportChoice,
  preset: OfferedPreset,
  row?: Pick<Preset, 'view' | 'labels' | 'kind' | 'safe_zones'>,
): ExportChoice {
  const next = copyChoice(choice)
  delete next.storyboard
  next.preset = preset
  if (row !== undefined) next.options = withoutRefusedCorner(next.options, row)
  return next
}

/** A choice with a storyboard; the preset's own is not stored, so it is not sent. */
export function withStoryboard(
  choice: ExportChoice,
  preset: Pick<Preset, 'storyboard'>,
  storyboard: string,
): ExportChoice {
  const next = copyChoice(choice)
  delete next.storyboard
  if (isStoryboardName(storyboard) && storyboard !== preset.storyboard) next.storyboard = storyboard
  return next
}

/** From this many characters on, the caption field says how many it has of the 80. */
export const CAPTION_COUNT_FROM = 60

/** What the caption field says about what has been typed so far (issue 352). */
export interface CaptionReading {
  /** The caption as it would be stored: trimmed. */
  text: string
  /** The engine's sentence for a caption it would refuse; null for none, and for a blank field. */
  problem: string | null
  /** "n of 80", once the caption nears the bound; null before that. */
  count: string | null
}

/**
 * A caption field's draft, read before anything is written or sent: trimmed
 * as the stored caption is, refused in the engine's own sentence (an 81st
 * character, a line break), and counted in the engine's own way once it
 * nears the bound. A blank draft is no caption, and no refusal.
 */
export function readCaption(draft: string): CaptionReading {
  const text = draft.trim()
  const length = lengthOf(text)
  return {
    text,
    problem: text === '' ? null : validateCaption(text),
    count: length >= CAPTION_COUNT_FROM ? `${length} of ${CAPTION_MAX}` : null,
  }
}

/** Do two choices ask the engine for the same thing? */
export function sameChoice(a: ExportChoice, b: ExportChoice): boolean {
  return JSON.stringify(copyChoice(a)) === JSON.stringify(copyChoice(b))
}

/** The lines option with one line turned on or off, in the order the lines are listed. */
export function toggledLines(
  all: readonly string[],
  kept: readonly string[] | undefined,
  label: string,
  on: boolean,
): string[] {
  const chosen = new Set(kept ?? [])
  if (on) chosen.add(label)
  else chosen.delete(label)
  // A kept label the feed no longer lists stays, after the listed ones: it
  // was a person's choice, and the engine ignores a label it does not draw.
  const listed = all.filter((line) => chosen.has(line))
  const unlisted = [...chosen].filter((line) => !all.includes(line))
  return [...listed, ...unlisted]
}

/**
 * What cell 06's preview frame shows (ADR-046): the address `export.plan`
 * answered, and the preset's own size, whose ratio the frame keeps and
 * which its caption names. The plan's size is not used for either: the
 * engine may plan at another scale than the preset's (a stand-in plans at
 * half), and the caption says what the file will be.
 */
export interface PreviewAddress {
  url: string
  width: number
  height: number
  /** Whether the preset has safe zones, which the page shades on this address. */
  safe: boolean
}

/** The greatest common divisor, for a ratio in its lowest terms. */
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/**
 * A preset's shape as a person names one: "9:16", "4:5", "16:9", or, where
 * the lowest terms are not a ratio anyone says ("400:209"), the width to
 * one as a decimal ("1.91:1"), which is how the platforms write that one.
 */
export function ratioWords(width: number, height: number): string {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return ''
  const d = gcd(width, height)
  const [w, h] = [width / d, height / d]
  if (w <= 32 && h <= 32) return `${w}:${h}`
  return width >= height ? `${(width / height).toFixed(2)}:1` : `1:${(height / width).toFixed(2)}`
}

/**
 * The caption under cell 06's preview (FR-004): the ratio and the size,
 * and, where the page shades the platform's own buttons, that the shading
 * is guidance and not in the file.
 */
export function previewCaption(address: Pick<PreviewAddress, 'width' | 'height' | 'safe'>): string {
  const size = `${ratioWords(address.width, address.height)}, ${address.width} x ${address.height}`
  return address.safe
    ? `${size}. The shaded parts are where the platform puts its own buttons: guidance, and not in the export.`
    : `${size}.`
}

/** A sentence for a refusal: the engine's hint, then its message. */
export function refusalWords(preview: Extract<ExportPreview, { ok: false }>): string {
  return preview.error.data?.hint ?? preview.error.message
}

/**
 * The preview's planning: once, `delay` after the last change, and only the
 * newest answer applied. A plan that answers after a newer one has been
 * asked for is dropped, so a slow answer can never put an older address in
 * the frame (FR-009).
 */
export class PreviewPlanner {
  readonly #ask: (choice: ExportChoice) => Promise<ExportPreview>
  readonly #answer: (preview: ExportPreview, choice: ExportChoice) => void
  readonly #debounced: Debounced<[ExportChoice]>
  #asked = 0
  #stopped = false

  constructor(
    ask: (choice: ExportChoice) => Promise<ExportPreview>,
    answer: (preview: ExportPreview, choice: ExportChoice) => void,
    delay = PREVIEW_DELAY,
  ) {
    this.#ask = ask
    this.#answer = answer
    this.#debounced = debounce((choice: ExportChoice) => this.#plan(choice), delay)
  }

  /** Plan this choice once the changes stop. */
  schedule(choice: ExportChoice): void {
    // An answer still on its way was asked for a choice that is no longer
    // the one on screen: it is dropped now, not when the next plan is asked,
    // or it would land in the frame during the wait.
    this.#asked += 1
    this.#stopped = false
    this.#debounced(choice)
  }

  /** Forget a waiting plan, and drop any answer still to come. */
  cancel(): void {
    this.#debounced.cancel()
    this.#asked += 1
    this.#stopped = true
  }

  #plan(choice: ExportChoice): void {
    const asked = ++this.#asked
    const current = (): boolean => asked === this.#asked && !this.#stopped
    this.#ask(choice).then(
      (preview) => {
        if (current()) this.#answer(preview, choice)
      },
      (error: unknown) => {
        if (!current()) return
        const message = error instanceof Error ? error.message : 'The preview could not be planned.'
        this.#answer({ ok: false, error: { code: -32603, message } }, choice)
      },
    )
  }
}

/** The engine's tables, asked once while the engine stays up; a refusal is not kept. */
export interface TablesClient {
  request(method: 'export.presets'): { result: Promise<{ presets: Preset[] }> }
  request(method: 'export.storyboards'): { result: Promise<{ storyboards: Storyboard[] }> }
}

let tables: Promise<ExportTables> | null = null

export function exportTablesFor(client: TablesClient): Promise<ExportTables> {
  if (tables !== null) return tables
  const pending = Promise.all([
    client.request('export.presets').result,
    client.request('export.storyboards').result,
  ]).then(([presets, storyboards]) => ({
    presets: offeredOf(presets.presets),
    storyboards: storyboards.storyboards,
  }))
  tables = pending
  pending.catch(() => {
    if (tables === pending) tables = null
  })
  return pending
}

/** The engine went away; the one that comes back may be another version, so ask it again. */
export function forgetExportTables(): void {
  tables = null
}
