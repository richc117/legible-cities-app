// Types for upgrade.mjs, the update over 0.1.0's pure pieces.

import type { Result } from './pure.mjs'

export const FROM_VERSION: string
export const UPGRADE_RECORD: 1

export type Phase = 'seed' | 'after' | 'back'
export const PHASES: readonly Phase[]

export interface MadeFields {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  /** Null where the text gives no seconds. */
  second: number | null
}

export function parseMade(text: string): MadeFields | null
export function localFields(
  iso: string,
  timeZone?: string,
): (MadeFields & { second: number }) | null
export function madeAt(text: string, iso: string, timeZone?: string): boolean
export function sameMade(a: string, b: string): boolean

export interface PhaseResult {
  ok: boolean
  problems: string[]
  notes: string[]
}

export interface Seed {
  version: string
  userData: string
  exportFolder: string
  projectFile: string
  projectVersion: number
  /** Cell 02's Layout as 0.1.0 showed it: the id's first eight figures. */
  layout: string
  /** The record's own layout id. */
  layoutId: string
  made: string
  madeIso: string
  date: string | null
  projectSha256: string
  exportFile: string
  exportSha256: string
}

export interface After {
  version: string
  projectSha256: string
}

export interface Upgrade {
  record: 1
  seed?: Seed
  after?: After
  phases: Partial<Record<Phase, PhaseResult>>
}

export function readUpgrade(text: string): Upgrade
export function seedOf(upgrade: Upgrade): Seed

export const NOT_AUTOMATED: string

export function upgradeRow(
  upgrade: Upgrade | string,
  outcomes: readonly (readonly [string, string])[],
): { result: Result; notes: string; previous: string }

export function notRunRow(reason: string): { result: Result; notes: string; previous: string }

export function refusal(env: Record<string, string | undefined>): string | null

export function defaultProfile(options: {
  platform: string
  home: string
  appData?: string
  product?: string
}): string

export function quietFor<T>(
  read: () => Promise<T>,
  quiet: T,
  options: {
    duration: number
    every: number
    now?: () => number
    wait?: (ms: number) => Promise<void>
  },
): Promise<{ ok: boolean; seen: T[] }>

export function timesEntered<T>(sequence: readonly T[], value: T): number
