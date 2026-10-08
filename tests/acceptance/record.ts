// The acceptance run's record, in the shape of the results template at the
// end of docs/acceptance.md: a table of the run, a table of the twenty-one
// steps, the six versions from Settings, and anything else. The spec fills
// what it drives; the workflow fills steps 1, 2 and 21 through
// tests/acceptance/record-cli.mjs, which edits the same rows.
//
// The record is pasted into a public issue, so every note goes through
// `redact` first (tests/acceptance/pure.mjs, shared with the CLI): the home
// folder is written as `~` and the temporary folder as `<temp>`, in every
// spelling a path can take on this machine. A step's result is one of
// pure.mjs's RESULTS: "pass, part not automated" is a step whose every
// automated check held and which asks for something a machine cannot judge,
// "pass, part not checked" one that asks for something the release under
// test predates; either part is named in the notes, never counted as passed.

import { readFileSync, writeFileSync } from 'node:fs'
import { cell, redact, type Result } from './pure.mjs'

export { redact }
export type { Result }

/** The checklist's step titles, word for word, from the results template. */
export const STEP_TITLES: Record<number, string> = {
  1: 'Download and check the installer',
  2: 'Install and open it the first time',
  3: 'First run: the front door, the engine and the bundled tools',
  4: 'Open a sample city, and watch it download and lay out (___ s)',
  5: 'Cell 01, Data: the feed and where its routes run',
  6: 'Cell 02, Process: the layout and what the build had to fudge',
  7: 'Cell 03, Frame and service day: pick a day, scrub the clock',
  8: 'Cell 04, Style: the theme and the sizes',
  9: 'Cell 05, Lines: colours, by dragging',
  10: 'Cell 05, Lines: the order',
  11: 'Cell 06, Export: a reel (___ s)',
  12: 'Cell 06, Export: a post and a GIF',
  13: 'Outputs, and Reveal',
  14: 'A project from a feed at an address (Caltrain: ___ s)',
  15: "Another sample's operator, and deleting a project",
  16: 'The jobs inspector',
  17: 'Quit, reopen, and rename',
  18: 'Copy diagnostics',
  19: 'Licences',
  20: 'Reset engine data',
  21: 'Uninstall, and what is left',
}

/** The run table's rows, in the template's order. */
export const FIELDS = [
  'App version',
  'Engine version',
  'OS and version',
  'Machine',
  'Clean machine?',
  'Date',
  'Run by',
  'Installer file name',
  'Its SHA-256',
  'Matches SHA256SUMS.txt?',
  'Started, finished',
  'Time taken',
] as const

export type Field = (typeof FIELDS)[number]

export interface Row {
  title: string
  result: Result
  notes: string
}

/** What a workflow step already found, handed to the spec as JSON. */
export interface Prior {
  fields?: Partial<Record<Field, string>>
  steps?: Record<string, { result: Result; notes: string }>
}

export class RunRecord {
  readonly #path: string
  readonly #fields = new Map<Field, string>()
  readonly #rows = new Map<number, Row>()
  #versions: string[] = []
  readonly #else: string[] = []

  constructor(path: string) {
    this.#path = path
    for (const [n, title] of Object.entries(STEP_TITLES)) {
      this.#rows.set(Number(n), { title, result: 'not run', notes: '' })
    }
  }

  field(name: Field, value: string): void {
    this.#fields.set(name, value)
  }

  /** A field, unless something (the workflow's prior) has already set it. */
  fieldUnlessSet(name: Field, value: string): void {
    if (!this.#fields.has(name)) this.#fields.set(name, value)
  }

  step(n: number, result: Result, notes: string, title?: string): void {
    const row = this.#rows.get(n)
    if (row === undefined) throw new Error(`no step ${n} in the checklist`)
    this.#rows.set(n, { title: title ?? row.title, result, notes })
  }

  result(n: number): Result | undefined {
    return this.#rows.get(n)?.result
  }

  versions(lines: string[]): void {
    this.#versions = lines
  }

  anythingElse(line: string): void {
    this.#else.push(line)
  }

  /** What a workflow step found before the spec ran. */
  applyPrior(path: string | undefined): void {
    if (path === undefined || path === '') return
    let prior: Prior
    try {
      prior = JSON.parse(readFileSync(path, 'utf8')) as Prior
    } catch {
      return
    }
    for (const [name, value] of Object.entries(prior.fields ?? {})) {
      if ((FIELDS as readonly string[]).includes(name) && typeof value === 'string') {
        this.field(name as Field, value)
      }
    }
    for (const [n, step] of Object.entries(prior.steps ?? {})) {
      this.step(Number(n), step.result, step.notes)
    }
  }

  render(): string {
    const lines = [
      '## Acceptance run',
      '',
      '| | |',
      '|---|---|',
      ...FIELDS.map((name) => `| ${name} | ${cell(this.#fields.get(name) ?? '')} |`),
      '',
      '## Steps',
      '',
      '| # | Step | Result | Notes and failure issues |',
      '|---|---|---|---|',
      ...[...this.#rows.entries()]
        .sort(([a], [b]) => a - b)
        .map(([n, row]) => `| ${n} | ${cell(row.title)} | ${row.result} | ${cell(row.notes)} |`),
      '',
      '## Versions from Settings',
      '',
      ...(this.#versions.length === 0
        ? ['(not read)']
        : this.#versions.map((line) => `- ${redact(line)}`)),
      '',
      '## Anything else',
      '',
      ...this.#else.map((line) => `- ${redact(line)}`),
      '',
    ]
    return lines.join('\n')
  }

  write(): void {
    writeFileSync(this.#path, this.render())
  }
}
