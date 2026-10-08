// An export: one preset of a project's page, planned by the engine, captured
// by the app and encoded by the engine, run in the main process and watched
// from the page. What crosses the bridge is here; the flow is
// `src/main/export.ts`. Contracts: specs/010-export/contracts/bridge.md and
// specs/022-export-tab.

import { VIEWS } from './capture'
import type { EngineErrorShape } from './engine'
import { COLORS_MAX, validateLineLabel } from './project'
import type { ClockCorner, ExportOptions, Preset, PresetName, StoryboardName } from './protocol'

/**
 * The presets the interface offers: the thirteen social ones (A5-01). Each
 * is checked against the engine's own list at build time, so a preset the
 * engine renamed is a type error here rather than a refused request in
 * front of a person. The three `portfolio-*` presets are the published
 * site's own deliverables, and `portfolio-svg` is vector, which
 * `export.plan` refuses; neither is the app's to offer.
 */
export const OFFERED_PRESETS = [
  'instagram-post',
  'instagram-square',
  'instagram-story',
  'instagram-reel',
  'instagram-reel-gif',
  'linkedin',
  'linkedin-link',
  'linkedin-video',
  'linkedin-gif',
  'bluesky',
  'bluesky-video',
  'bluesky-gif',
  'x',
] as const satisfies readonly PresetName[]

export type OfferedPreset = (typeof OFFERED_PRESETS)[number]

export function isOfferedPreset(value: unknown): value is OfferedPreset {
  return typeof value === 'string' && (OFFERED_PRESETS as readonly string[]).includes(value)
}

/**
 * Every storyboard the engine has, as a list the validator can read. The
 * generated `StoryboardName` is a type only; this is held equal to it by
 * `tests/unit/export.test.ts`, against the schema the type was made from.
 */
export const STORYBOARD_NAMES = [
  'transform',
  'transform-loop',
  'essay-loop',
  'tour',
  'reveal',
  'morph',
  'day',
  'run',
] as const satisfies readonly StoryboardName[]

export function isStoryboardName(value: unknown): value is StoryboardName {
  return typeof value === 'string' && (STORYBOARD_NAMES as readonly string[]).includes(value)
}

/** The three qualities `export.plan` knows; `standard` is what it uses when told none. */
export const QUALITIES = ['draft', 'standard', 'high'] as const
export type Quality = (typeof QUALITIES)[number]
export const DEFAULT_QUALITY: Quality = 'standard'

/**
 * The options a person chooses in the export tab: the engine's own
 * `ExportOptions` without the four that are not theirs to set there. The
 * theme is the project's (A4-03), the safe zones are the app's to draw in a
 * preview and never in a file, the storyboard sits beside the options, and
 * a fade is not offered (specs/022-export-tab).
 */
export type ExportChoiceOptions = Omit<ExportOptions, 'theme' | 'safe' | 'storyboard' | 'fade'>

/** The keys of `ExportChoiceOptions`, for a validator that refuses any other. */
export const CHOICE_OPTION_KEYS = [
  'view',
  'labels',
  'title',
  'clock',
  'at',
  'lines',
  'quality',
  'tag',
  'caption',
  'clock_corner',
] as const satisfies readonly (keyof ExportChoiceOptions)[]

/**
 * What a project was last set to export (A5-01): a preset, a storyboard for
 * a video or GIF preset, and the options. A storyboard or an option that is
 * absent is the engine's default for the preset, and is not sent.
 *
 * `alt` is the sidecar's alt text in the person's own words (issue 352). It
 * is not one of the engine's plan options: it travels in `export.encode`'s
 * provenance, so it sits beside `options` and not in them. Absent means the
 * engine writes its own sentence.
 */
export interface ExportChoice {
  preset: OfferedPreset
  storyboard?: StoryboardName
  options: ExportChoiceOptions
  alt?: string
}

/** What the one button exported before this: the reel, with the engine's defaults. */
export const DEFAULT_CHOICE: ExportChoice = { preset: 'instagram-reel', options: {} }

/** The engine's `Clock`: HH:MM or HH:MM:SS, and past midnight stays past midnight. */
export const CLOCK_PATTERN = /^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?$/
/** The engine's `Token`: a short filename suffix. */
export const TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** A start time, or why it is not one; a sentence a person reads beside the field. */
export function validateClock(value: unknown): string | null {
  if (typeof value !== 'string' || !CLOCK_PATTERN.test(value))
    return 'the start time must be written HH:MM, such as 07:30'
  const [, minutes, seconds] = value.split(':').map(Number)
  if (minutes > 59 || (seconds !== undefined && seconds > 59))
    return 'the start time has more than 59 minutes or seconds'
  return null
}

/** A filename tag, or why it is not one. */
export function validateTag(value: unknown): string | null {
  if (typeof value !== 'string' || !TAG_PATTERN.test(value))
    return 'a tag is up to 64 letters, digits, dots, underscores and hyphens, starting with a letter or digit'
  return null
}

/** The corners the page can put the clock in, in the engine's own order. */
export const CLOCK_CORNERS = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
] as const satisfies readonly ClockCorner[]

export function isClockCorner(value: unknown): value is ClockCorner {
  return typeof value === 'string' && (CLOCK_CORNERS as readonly string[]).includes(value)
}

/** The longest caption, in characters: the engine's `CAPTION_MAX`. */
export const CAPTION_MAX = 80
/** The longest alt text, in characters: the engine's bound on `provenance.alt`. */
export const ALT_MAX = 1000

/**
 * Where a caption may not break: the engine's `LINE_BREAKS`, which are the
 * two a keyboard makes and the two Unicode adds. A single-line field strips
 * the first two from what is typed or pasted and not the others.
 */
const LINE_BREAK = /[\r\n\u2028\u2029]/

/**
 * A length as the engine counts it: in code points, so one emoji is one and
 * not the two a JavaScript string's `length` says.
 */
export const lengthOf = (text: string): number => Array.from(text).length

/**
 * Text trimmed as the engine trims it. Python's `str.strip()` also removes
 * U+001C to U+001F and U+0085, which JavaScript's `trim()` leaves, so an alt
 * text made only of those would pass a `trim()` and be refused by
 * `export.encode` after the capture has run (issue 352).
 */
export const trimAsEngine = (text: string): string =>
  // The control characters are the point: they are what Python strips.
  // eslint-disable-next-line no-control-regex
  text.replace(/^[\s\u001c-\u001f\u0085]+|[\s\u001c-\u001f\u0085]+$/g, '')

/**
 * A caption, or why it is not one, in the engine's own sentence
 * (`check_caption` in `export.py`): the bound, then which side of it this one
 * is on. Never trimmed here; the tab trims what a person typed before it asks.
 */
export function validateCaption(value: unknown): string | null {
  const bound = `A caption is 1 to ${CAPTION_MAX} characters on one line`
  if (typeof value !== 'string') return `${bound}; this one is not text.`
  if (LINE_BREAK.test(value)) return `${bound}; this one has a line break.`
  const length = lengthOf(value)
  if (length < 1 || length > CAPTION_MAX) return `${bound}; this one is ${length}.`
  return null
}

/**
 * The sidecar's alt text, or why it is not one: 1 to 1,000 characters once
 * trimmed, because the engine writes it trimmed and refuses one that is
 * blank (`provenance.alt` in `serve.py`). The sentences are the engine's,
 * without the name of the field on the wire.
 */
export function validateAlt(value: unknown): string | null {
  if (typeof value !== 'string') return 'The alt text must be text.'
  const length = lengthOf(trimAsEngine(value))
  if (length === 0)
    return 'The alt text is empty; leave it out, and the sidecar keeps the description the engine writes.'
  if (length > ALT_MAX)
    return `The alt text is ${length.toLocaleString('en-US')} characters; it may be at most ${ALT_MAX.toLocaleString('en-US')}.`
  return null
}

/**
 * The options, or the first reason they are not. Checked in the main-side
 * handler because they arrived from another process, and in the store
 * because the store is the trusted layer; the tab uses the two field
 * checks above for its sentences.
 */
export function validateChoiceOptions(options: unknown): string | null {
  if (!isPlainObject(options)) return 'the options must be an object'
  for (const key of Object.keys(options))
    if (!(CHOICE_OPTION_KEYS as readonly string[]).includes(key))
      return `${key} is not an option the export tab sets`
  const { view, labels, title, clock, at, lines, quality, tag, caption, clock_corner } = options
  if (view !== undefined && !(VIEWS as readonly unknown[]).includes(view))
    return `the view must be one of ${VIEWS.join(', ')}`
  for (const [name, flag] of [
    ['labels', labels],
    ['title', title],
    ['clock', clock],
  ] as const)
    if (flag !== undefined && typeof flag !== 'boolean') return `${name} must be on or off`
  if (at !== undefined) {
    const problem = validateClock(at)
    if (problem !== null) return problem
  }
  if (lines !== undefined) {
    if (!Array.isArray(lines)) return 'the lines must be a list of line labels'
    if (lines.length > COLORS_MAX) return `that is more than ${COLORS_MAX} lines`
    const seen = new Set<string>()
    for (const label of lines) {
      if (typeof label !== 'string') return 'the lines must be a list of line labels'
      const problem = validateLineLabel(label)
      if (problem !== null) return problem
      if (seen.has(label)) return `${label} is in the lines twice`
      seen.add(label)
    }
  }
  if (quality !== undefined && !(QUALITIES as readonly unknown[]).includes(quality))
    return 'the quality must be draft, standard or high'
  if (tag !== undefined) {
    const problem = validateTag(tag)
    if (problem !== null) return problem
  }
  if (caption !== undefined) {
    const problem = validateCaption(caption)
    if (problem !== null) return problem
  }
  if (clock_corner !== undefined && !isClockCorner(clock_corner))
    return `the clock's corner must be one of ${CLOCK_CORNERS.join(', ')}`
  return null
}

/**
 * Why a stored alt text is not one, or null. A blank one is none and is not
 * a problem: the tab never writes it and `sentChoice` drops it.
 */
function storedAltProblem(alt: unknown): string | null {
  return typeof alt === 'string' && trimAsEngine(alt) === '' ? null : validateAlt(alt)
}

/** A whole choice, or the first reason it is not one. */
export function validateExportChoice(choice: unknown): string | null {
  if (!isPlainObject(choice)) return 'the export choice must be an object'
  for (const key of Object.keys(choice))
    if (key !== 'preset' && key !== 'storyboard' && key !== 'options' && key !== 'alt')
      return `${key} is not part of an export choice`
  if (!isOfferedPreset(choice.preset)) return 'the app does not offer that preset'
  if (choice.storyboard !== undefined && !isStoryboardName(choice.storyboard))
    return 'that is not a storyboard the engine has'
  // A blank one is no alt text, as an empty caption is no caption: the tab
  // never writes it, `sentChoice` drops it, and a record that holds one is
  // read as it is and not thrown away whole.
  if (choice.alt !== undefined) {
    const problem = storedAltProblem(choice.alt)
    if (problem !== null) return problem
  }
  return validateChoiceOptions(choice.options)
}

/**
 * A copy of a choice that has passed `validateExportChoice`, with nothing
 * on it but its own fields, so a caller's object is never stored or sent
 * by reference.
 */
export function copyChoice(choice: ExportChoice): ExportChoice {
  const options: ExportChoiceOptions = {}
  for (const key of CHOICE_OPTION_KEYS) {
    const value = choice.options[key]
    if (value === undefined) continue
    ;(options as Record<string, unknown>)[key] = Array.isArray(value) ? [...value] : value
  }
  const copy: ExportChoice =
    choice.storyboard === undefined
      ? { preset: choice.preset, options }
      : { preset: choice.preset, storyboard: choice.storyboard, options }
  if (choice.alt !== undefined) copy.alt = choice.alt
  return copy
}

/** What the engine's table says of a preset that decides which options reach its plan. */
export type PresetShape = Pick<Preset, 'kind' | 'format'>

/**
 * Does this preset play a storyboard? A video or a GIF does, and every
 * storyboard's first beat names its own view and its own clock, which the
 * capture applies. A view or a start time sent beside one would change
 * the preview's first frame and not the file's, and a start time would
 * move the capture's "no trains" check to a clock the file never shows.
 */
export const playsStoryboard = (preset: Pick<Preset, 'kind'>): boolean => preset.kind === 'video'

/**
 * Is this preset a still the engine writes as JPEG? The app's capture
 * writes PNG, and at draft and high quality the engine keeps the captured
 * file as it is rather than resampling it, so the result would be PNG
 * bytes under a `.jpg` name, or a file over the platform's limit. Only
 * standard quality, which re-encodes, is offered for one.
 */
export const standardQualityOnly = (preset: PresetShape): boolean =>
  preset.kind === 'still' && preset.format === 'jpg'

/**
 * The part of a choice that is sent for this preset. A record keeps
 * whatever a person chose; what reaches the engine leaves out a view and a
 * start time for a preset that plays a storyboard, a storyboard for a
 * still, and a quality other than standard for a JPEG still. Applied in the
 * main process, which builds every plan, so the tab hiding the controls is
 * a convenience and not the guard. The caption and the clock's corner go
 * through as they are for every preset, and a corner nobody chose is never
 * made up: the engine's default for the preset is the engine's to apply, so
 * an export that sets neither plans what it planned before (issue 352).
 */
export function sentChoice(choice: ExportChoice, preset: PresetShape): ExportChoice {
  const copy = copyChoice(choice)
  // The engine writes the alt trimmed and refuses a blank one, so what is
  // sent is the trimmed text, or nothing: a record is a file anything can
  // write, and the tab trimming what it stores is a convenience.
  if (copy.alt !== undefined) {
    const alt = trimAsEngine(copy.alt)
    if (alt === '') delete copy.alt
    else copy.alt = alt
  }
  if (playsStoryboard(preset)) {
    delete copy.options.view
    delete copy.options.at
  } else {
    delete copy.storyboard
  }
  if (standardQualityOnly(preset)) delete copy.options.quality
  return copy
}

/**
 * The options `export.plan` is given for a choice: the person's, as far as
 * this preset takes them, the storyboard beside them, and the project's
 * theme in the engine's word for it. `safe` is added only by the preview,
 * and only here, so an export's plan cannot carry it (FR-006). The alt text
 * is not here: it is not a plan option, and travels in `export.encode`'s
 * provenance (`sentChoice(...).alt`).
 */
export function planOptions(
  choice: ExportChoice,
  preset: PresetShape,
  theme: 'dark' | 'light',
  safe = false,
): ExportOptions {
  const sent = sentChoice(choice, preset)
  return {
    ...sent.options,
    ...(sent.storyboard === undefined ? {} : { storyboard: sent.storyboard }),
    theme,
    ...(safe ? { safe: true } : {}),
  }
}

/**
 * What the preview's plan answered: the address cell 06's preview frame is
 * sent to, with the size it was planned for and the engine's notes; or the
 * engine's refusal, in its own shape, so its sentence reaches the screen.
 */
export type ExportPreview =
  | { ok: true; url: string; width: number; height: number; notes: string[] }
  | { ok: false; error: EngineErrorShape }

/** The three stages an export goes through, in order. */
export const EXPORT_STAGES = ['plan', 'capture', 'encode'] as const

export type ExportStage = (typeof EXPORT_STAGES)[number]

/** One report from a running export: the stage it is in, how far, and a sentence. */
export interface ExportProgress {
  id: string
  stage: ExportStage
  /** 0 to 1 within the stage. */
  fraction: number
  message: string
}

/** What a finished export hands the page: the file's name, never its path. */
export interface ExportResult {
  file: string
  bytes: number
  frames: number
}

/**
 * One thing a project has produced, as the rail's Outputs list says it
 * (A5.5-21, DESIGN.md 8.2, "Outputs").
 *
 * Read from the sidecar the engine already writes beside every deliverable
 * and not from anything the session remembers: until now a finished export
 * was findable only in the inspector, and only until the app was closed.
 * Nothing here is a path - the file's own name, never the folder it is in
 * (constitution V).
 */
export interface ExportOutput {
  /** The deliverable's own name, as the sidecar records it. Never a path. */
  file: string
  /** The preset the sidecar names, or null where it names none. */
  preset: string | null
  /** When the sidecar was written, which is when the export finished; ISO 8601. */
  made: string
  /**
   * False when the file has been moved or deleted since. The sidecar stays,
   * so the row still says what was made, reads as gone, and offers nothing
   * to press.
   */
  present: boolean
}

/**
 * How many outputs the rail lists. A folder somebody has exported into for
 * a year is not a list anybody reads to the end, and the whole of it
 * crosses the bridge on every read; newest first, so what is missing from
 * the end is what nobody is looking for.
 */
export const OUTPUTS_MAX = 50

/** What `export:run` answers at once: started, or refused before it started. */
export type ExportAccepted = { accepted: true } | { accepted: false; error: EngineErrorShape }

/** How an export ends, on the same ordered channel as its progress. */
export type ExportSettled =
  | { id: string; ok: true; result: ExportResult }
  | { id: string; ok: false; error: EngineErrorShape }

/**
 * A choice as a record stores it, read whole or as the reel: the project's
 * own file is read at every open, and anything on the machine can write it.
 * An alt text that is not usable - blank, over 1,000 characters, or not text
 * - is read as none and the rest of the choice is kept, since it is not a plan
 * option and the choice does not depend on it; any other fault gives the
 * choice up for the reel, as the service window is (a half-valid choice is
 * not half-trusted).
 */
export function readStoredChoice(value: unknown): ExportChoice {
  let candidate = value
  if (isPlainObject(value) && value.alt !== undefined && validateAlt(value.alt) !== null) {
    const without = { ...value }
    delete without.alt
    candidate = without
  }
  return validateExportChoice(candidate) === null
    ? copyChoice(candidate as ExportChoice)
    : copyChoice(DEFAULT_CHOICE)
}
