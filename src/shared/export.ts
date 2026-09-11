// An export: one preset of a project's page, planned by the engine, captured
// by the app and encoded by the engine, run in the main process and watched
// from the page. What crosses the bridge is here; the flow is
// `src/main/export.ts`. Contract: specs/010-export/contracts/bridge.md.

import type { EngineErrorShape } from './engine'
import type { PresetName } from './protocol'

/**
 * The presets the interface offers. Each is checked against the engine's own
 * list at build time, so a preset the engine renamed is a type error here
 * rather than a refused request in front of a person. One for the first
 * reel; the rest arrive with A5-01.
 */
export const OFFERED_PRESETS = ['instagram-reel'] as const satisfies readonly PresetName[]

export type OfferedPreset = (typeof OFFERED_PRESETS)[number]

export function isOfferedPreset(value: unknown): value is OfferedPreset {
  return typeof value === 'string' && (OFFERED_PRESETS as readonly string[]).includes(value)
}

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
