import {
  copyChoice,
  DEFAULT_CHOICE,
  DEFAULT_QUALITY,
  isOfferedPreset,
  isStoryboardName,
  type ExportChoice,
  type ExportChoiceOptions,
  type ExportPreview,
  type OfferedPreset,
  type Quality,
} from '../../shared/export'
import type { Preset, Storyboard, View } from '../../shared/protocol'
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

/** Is this preset a video or a GIF, which play a storyboard? */
export const plays = (preset: Pick<Preset, 'kind'>): boolean => preset.kind === 'video'

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
 * is left out quietly.
 */
export function usable(
  saved: ExportChoice,
  tables: ExportTables,
): { choice: ExportChoice; dropped: string | null } {
  const preset = tables.presets.find((row) => row.name === saved.preset)
  if (preset === undefined) return { choice: copyChoice(DEFAULT_CHOICE), dropped: saved.preset }
  if (saved.storyboard !== undefined) {
    if (!plays(preset))
      return { choice: { preset: saved.preset, options: saved.options }, dropped: null }
    if (!tables.storyboards.some((board) => board.name === saved.storyboard))
      return { choice: copyChoice(DEFAULT_CHOICE), dropped: saved.storyboard }
  }
  return { choice: saved, dropped: null }
}

type Flag = 'labels' | 'title' | 'clock'

/**
 * A choice with one option changed. An option set to what the engine does
 * without it is removed, and so is an empty start time, tag or list of
 * lines: none of them is sent (FR-004).
 */
export function withOption(
  choice: ExportChoice,
  preset: Pick<Preset, 'view' | 'labels' | 'kind'>,
  change:
    | { key: 'view'; value: View }
    | { key: Flag; value: boolean }
    | { key: 'quality'; value: Quality }
    | { key: 'at' | 'tag'; value: string }
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
      set(change.key, change.value.trim(), change.value.trim() === '')
      break
    case 'lines':
      set('lines', [...change.value], change.value.length === 0)
      break
  }
  return { ...choice, options }
}

/**
 * A choice with another preset. The options stay, since a person who
 * turned the clock off meant it; the storyboard goes back to the new
 * preset's own, which is what the chooser shows for a preset first picked.
 */
export function withPreset(choice: ExportChoice, preset: OfferedPreset): ExportChoice {
  return { preset, options: copyChoice(choice).options }
}

/** A choice with a storyboard; the preset's own is not stored, so it is not sent. */
export function withStoryboard(
  choice: ExportChoice,
  preset: Pick<Preset, 'storyboard'>,
  storyboard: string,
): ExportChoice {
  const { options } = copyChoice(choice)
  return !isStoryboardName(storyboard) || storyboard === preset.storyboard
    ? { preset: choice.preset, options }
    : { preset: choice.preset, storyboard, options }
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

/** The address the map's frame shows and the shape it is shown at. */
export interface PreviewAddress {
  url: string
  width: number
  height: number
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
