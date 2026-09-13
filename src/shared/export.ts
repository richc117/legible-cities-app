// An export: one preset of a project's page, planned by the engine, captured
// by the app and encoded by the engine, run in the main process and watched
// from the page. What crosses the bridge is here; the flow is
// `src/main/export.ts`. Contracts: specs/010-export/contracts/bridge.md and
// specs/022-export-tab.

import { VIEWS } from './capture'
import type { EngineErrorShape } from './engine'
import { COLORS_MAX, validateLineLabel } from './project'
import type { ExportOptions, PresetName, StoryboardName } from './protocol'

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
] as const satisfies readonly (keyof ExportChoiceOptions)[]

/**
 * What a project was last set to export (A5-01): a preset, a storyboard for
 * a video or GIF preset, and the options. A storyboard or an option that is
 * absent is the engine's default for the preset, and is not sent.
 */
export interface ExportChoice {
  preset: OfferedPreset
  storyboard?: StoryboardName
  options: ExportChoiceOptions
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
  const { view, labels, title, clock, at, lines, quality, tag } = options
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
  return null
}

/** A whole choice, or the first reason it is not one. */
export function validateExportChoice(choice: unknown): string | null {
  if (!isPlainObject(choice)) return 'the export choice must be an object'
  for (const key of Object.keys(choice))
    if (key !== 'preset' && key !== 'storyboard' && key !== 'options')
      return `${key} is not part of an export choice`
  if (!isOfferedPreset(choice.preset)) return 'the app does not offer that preset'
  if (choice.storyboard !== undefined && !isStoryboardName(choice.storyboard))
    return 'that is not a storyboard the engine has'
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
  return choice.storyboard === undefined
    ? { preset: choice.preset, options }
    : { preset: choice.preset, storyboard: choice.storyboard, options }
}

/**
 * The options `export.plan` is given for a choice: the person's, the
 * storyboard beside them, and the project's theme in the engine's word for
 * it. `safe` is added only by the preview, and only here, so an export's
 * plan cannot carry it (FR-006).
 */
export function planOptions(
  choice: ExportChoice,
  theme: 'dark' | 'light',
  safe = false,
): ExportOptions {
  const { options } = copyChoice(choice)
  return {
    ...options,
    ...(choice.storyboard === undefined ? {} : { storyboard: choice.storyboard }),
    theme,
    ...(safe ? { safe: true } : {}),
  }
}

/**
 * What the preview's plan answered: the address the map's frame is sent
 * to, with the size it was planned for and the engine's notes; or the
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

/** What `export:run` answers at once: started, or refused before it started. */
export type ExportAccepted = { accepted: true } | { accepted: false; error: EngineErrorShape }

/** How an export ends, on the same ordered channel as its progress. */
export type ExportSettled =
  | { id: string; ok: true; result: ExportResult }
  | { id: string; ok: false; error: EngineErrorShape }
