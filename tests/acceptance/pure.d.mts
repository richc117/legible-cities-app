// Types for pure.mjs, the acceptance run's shared pure pieces.

import type { SpawnSyncReturns } from 'node:child_process'

export type Result =
  | 'pass'
  | 'fail'
  | 'not automated'
  | 'pass, part not automated'
  | 'pass, part not checked'
  | 'not run'

export const RESULTS: readonly Result[]

export function makeRedact(options?: {
  home?: string
  temp?: string
  platform?: string
  realpath?: (path: string) => string
}): (text: string) => string

export const redact: (text: string) => string

export function cell(text: string, redactText?: (text: string) => string): string

export function fillStep(
  markdown: string,
  n: number,
  result: Result,
  notes: string,
  redactText?: (text: string) => string,
): string

export function parseSums(text: string): Map<string, string>

export function writtenSince(path: string, since: number): boolean

export function tagContains(options: {
  tag: string | undefined
  commit: string
  cwd: string
  run?: (
    command: string,
    args: string[],
    options: { cwd: string; encoding: 'utf8'; timeout: number; windowsHide: boolean },
  ) => Pick<SpawnSyncReturns<string>, 'status' | 'stdout'>
}): boolean | null
