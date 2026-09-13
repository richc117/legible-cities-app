// What the app's logs said about saving, for the end-to-end suite (issue 93).
//
// A choice that did not reach a record on the Windows runner could have been
// a write the store refused or a change that never reached it, and the logs
// are what tell the two apart: the store logs a write that failed, and one
// that landed only after a retry, and nothing when a write lands first time.
// Read here so a failed wait can say what the logs said beside it, and so the
// suite's teardown can say whether the retry fired in a run that passed.

import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'

/** The store's own lines, and the settings store's warnings. */
export const STORE_LINES = /\[projects\] |\[settings\] warning: /

/** The two lines the retry writes: one that landed after a refusal, one that failed. */
export const RETRY_LINES = /saved after \d+ attempts|write failed \(/

/** Every `.log` file directly in `folder`, older rotation first; none when it is not there. */
export function logFiles(folder: string): string[] {
  let names: string[]
  try {
    names = readdirSync(folder)
  } catch {
    return []
  }
  return names
    .filter((name) => name.endsWith('.log'))
    .sort((a, b) => Number(b.endsWith('.old.log')) - Number(a.endsWith('.old.log')))
    .map((name) => join(folder, name))
}

/**
 * The lines of every log in `folder` that match `pattern`, stamped at or
 * after `since` when it is given. Each line begins with its ISO timestamp,
 * which orders as a string.
 */
export function logLines(folder: string, pattern: RegExp, since?: Date): string[] {
  const floor = since?.toISOString()
  const lines: string[] = []
  for (const file of logFiles(folder)) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      if (line === '' || !pattern.test(line)) continue
      if (floor !== undefined && line.slice(0, floor.length) < floor) continue
      lines.push(line)
    }
  }
  return lines
}

/**
 * Every folder named `logs` at most `depth` levels under `root`, never
 * through a symbolic link: where a launch with its own profile keeps its
 * logs (`<temporary folder>/profile/logs`).
 */
export function logFolders(root: string, depth = 3): string[] {
  const found: string[] = []
  const walk = (dir: string, left: number): void => {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      const path = join(dir, name)
      try {
        if (!lstatSync(path).isDirectory()) continue
      } catch {
        continue
      }
      if (name === 'logs') found.push(path)
      else if (left > 1) walk(path, left - 1)
    }
  }
  walk(root, depth)
  return found
}

/**
 * A wait for the record which, on failure, says what the screen and the
 * launch's logs said beside it. A write the store refused shows its sentence
 * in an alert and a `[projects]` line; a change that never reached the store
 * shows neither. The assertion itself is the caller's and is not changed.
 */
export async function withWhatTheScreenSaid(
  page: Page,
  logs: { folder: string; since: Date },
  wait: () => Promise<void>,
): Promise<void> {
  try {
    await wait()
  } catch (error) {
    if (!(error instanceof Error)) throw error
    const alerts = await page
      .getByRole('alert')
      .allInnerTexts()
      .catch(() => [] as string[])
    const shown = alerts.map((text) => text.trim()).filter((text) => text !== '')
    const said =
      shown.length === 0 ? 'No alert was showing.' : `The screen said: ${shown.join(' | ')}`
    const lines = logLines(logs.folder, STORE_LINES, logs.since)
    const logged =
      lines.length === 0
        ? 'The logs held no [projects] line and no [settings] warning for this launch.'
        : `The logs said:\n${lines.join('\n')}`
    const before = error.message
    error.message = `${before}\n\n${said}\n${logged}`
    if (error.stack !== undefined) error.stack = error.stack.replace(before, () => error.message)
    throw error
  }
}
