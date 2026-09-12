// The project store: one project.json per folder under <engine home>/projects,
// created, listed, read, renamed and deleted here and nowhere else. Every
// identifier passes the origin's rule before a path is built from it, and no
// filesystem error leaves this module with its own message, because a
// Node fs message names the path and an error thrown here is what the
// renderer shows. Contracts: specs/003-project/contracts/record.md and
// data-model.md.

import { randomBytes } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_COLOR,
  DEFAULT_MODE,
  DEFAULT_STYLE,
  DEFAULT_THEME,
  ID_PATTERN,
  RECORD_VERSION,
  parseRecord,
  summarise,
  validateAgency,
  validateFeedKey,
  validateMode,
  validateName,
  validateLineOrder,
  validatePalette,
  type CreateProjectInput,
  type DeleteResult,
  type LineOrder,
  type Palette,
  type ProjectInputs,
  type ProjectRecord,
  type ProjectSummary,
  type RebuildDone,
  validateMade,
  validateServiceDate,
  validateServiceWindow,
  withinWindow,
} from '../shared/project'
import { isLayoutId, type LayoutDone, type LayoutResult } from '../shared/layout'
import { isValidProjectId } from './paths'

const RECORD_FILE = 'project.json'
// A fresh temporary name per write, written first and then renamed over the
// record, so a crash mid-write leaves the previous record whole (FR-004) and
// two overlapping writes cannot share a file. Readers open only project.json.
const tempFile = (): string => `project.json.${randomBytes(4).toString('hex')}.tmp`

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'
const ALPHABET = LETTERS + '0123456789'
const ID_LENGTH = 12

/** The code of a filesystem failure, never its message, which names the path. */
function reasonOf(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code
  return typeof code === 'string' ? code : 'unknown error'
}

/** A uniform index below `limit` from one random byte; the biased tail is redrawn. */
function randomIndex(limit: number): number {
  const usable = 256 - (256 % limit)
  for (;;) {
    const byte = randomBytes(1)[0]
    if (byte < usable) return byte % limit
  }
}

/**
 * A fresh identifier: twelve characters, a letter first so it can never
 * read as a number or a device name, then letters and digits. Never derived
 * from the name (FR-002), and checked against the origin's rule anyway.
 */
export function newId(): string {
  for (;;) {
    let id = LETTERS[randomIndex(LETTERS.length)]
    while (id.length < ID_LENGTH) id += ALPHABET[randomIndex(ALPHABET.length)]
    if (ID_PATTERN.test(id) && isValidProjectId(id)) return id
  }
}

function check(problem: string | null): void {
  if (problem !== null) throw new Error(problem)
}

type Loaded = { record: ProjectRecord; readOnly: boolean }
type ReadResult = Loaded | { missing: true } | { reason: string }

export class ProjectStore {
  private readonly root: string
  private readonly output: string
  #writing = 0

  /** Both folders derive from the engine home, so neither can be handed a stray path. */
  constructor(
    home: string,
    private readonly log: (message: string) => void,
  ) {
    this.root = join(home, 'projects')
    this.output = join(home, 'out')
  }

  /**
   * How many writes are part-way through. Both folders are under the engine
   * home, so this is what the settings screen's reset asks before it starts
   * removing that home's contents: a record being renamed into place is a
   * write it must not interrupt (A1-04).
   */
  get writing(): number {
    return this.#writing
  }

  /** Count a write for as long as it is touching the disk. */
  async #track<T>(work: () => Promise<T>): Promise<T> {
    this.#writing += 1
    try {
      return await work()
    } finally {
      this.#writing -= 1
    }
  }

  private dir(id: string): string {
    return join(this.root, id)
  }

  private file(id: string): string {
    return join(this.dir(id), RECORD_FILE)
  }

  /** Generated output lives under the engine home's out/<id>. */
  private outputDir(id: string): string {
    return join(this.output, id)
  }

  private checkId(id: string): void {
    if (!ID_PATTERN.test(id) || !isValidProjectId(id)) throw new Error('invalid id')
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  }

  /** The record in a folder, or why the folder is not a project. */
  private async read(folder: string): Promise<ReadResult> {
    let text: string
    try {
      text = await readFile(this.file(folder), 'utf8')
    } catch (error) {
      const code = reasonOf(error)
      return code === 'ENOENT' ? { missing: true } : { reason: `unreadable (${code})` }
    }
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return { reason: 'invalid JSON' }
    }
    const parsed = parseRecord(json)
    if ('error' in parsed) return { reason: parsed.error }
    // A folder copied by hand carries another project's identity; listing
    // it would show an entry that get() cannot resolve.
    if (parsed.record.id !== folder) return { reason: 'record id does not match its folder' }
    return parsed
  }

  private async load(id: string): Promise<Loaded> {
    this.checkId(id)
    const result = await this.read(id)
    if ('record' in result) return result
    if ('reason' in result) this.log(`projects/${id}: ${result.reason}`)
    throw new Error('not found')
  }

  private async writeAtomic(id: string, record: ProjectRecord): Promise<void> {
    const text = JSON.stringify(record, null, 2) + '\n'
    const temp = join(this.dir(id), tempFile())
    await this.#track(async () => {
      try {
        await writeFile(temp, text, 'utf8')
        await rename(temp, this.file(id))
      } catch (error) {
        await rm(temp, { force: true }).catch(() => undefined)
        this.log(`projects/${id}: write failed (${reasonOf(error)})`)
        throw new Error('the project could not be saved', { cause: error })
      }
    })
  }

  /** A folder for a new identifier; a collision, however unlikely, draws again. */
  private async claimFolder(): Promise<string> {
    try {
      await mkdir(this.root, { recursive: true })
    } catch (error) {
      this.log(`projects: cannot create the projects folder (${reasonOf(error)})`)
      throw new Error('the project could not be saved', { cause: error })
    }
    for (;;) {
      const id = newId()
      try {
        await mkdir(this.dir(id))
        return id
      } catch (error) {
        if (reasonOf(error) === 'EEXIST') continue
        this.log(`projects/${id}: cannot create the folder (${reasonOf(error)})`)
        throw new Error('the project could not be saved', { cause: error })
      }
    }
  }

  private async entries(): Promise<Dirent[]> {
    try {
      return await readdir(this.root, { withFileTypes: true })
    } catch (error) {
      // No folder yet means no projects; anything else is worth a line.
      const code = reasonOf(error)
      if (code !== 'ENOENT') this.log(`projects: cannot list (${code})`)
      return []
    }
  }

  async list(): Promise<ProjectSummary[]> {
    const summaries: ProjectSummary[] = []
    for (const entry of await this.entries()) {
      if (entry.isSymbolicLink()) {
        this.log(`projects/${entry.name}: symbolic link ignored`)
        continue
      }
      if (!entry.isDirectory()) continue
      if (!ID_PATTERN.test(entry.name) || !isValidProjectId(entry.name)) {
        this.log(`projects/${entry.name}: not a project identifier`)
        continue
      }
      const result = await this.read(entry.name)
      if ('record' in result) {
        summaries.push(summarise(result.record, result.readOnly))
      } else {
        this.log(`projects/${entry.name}: ${'reason' in result ? result.reason : 'no record'}`)
      }
    }
    // Timestamps share one format, so they order as strings; the id breaks
    // a tie so the list is stable between two calls.
    return summaries.sort(
      (a, b) => b.modified.localeCompare(a.modified) || a.id.localeCompare(b.id),
    )
  }

  async get(id: string): Promise<ProjectRecord & { readOnly: boolean }> {
    const { record, readOnly } = await this.load(id)
    return { ...record, readOnly }
  }

  async create(input: CreateProjectInput): Promise<ProjectRecord> {
    const name = input.name.trim()
    const mode = input.mode ?? DEFAULT_MODE
    const agency = input.agency == null ? null : input.agency.trim() || null
    check(validateName(name))
    check(validateFeedKey(input.feed))
    check(validateMode(mode))
    check(validateAgency(agency))

    // Counted from the folder's creation, not from the record's write: the
    // gap between the two is a folder on disk with nothing in it, which a
    // reset must not walk through either.
    return this.#track(() => this.#createTracked(input, name, mode, agency))
  }

  async #createTracked(
    input: CreateProjectInput,
    name: string,
    mode: string,
    agency: string | null,
  ): Promise<ProjectRecord> {
    const id = await this.claimFolder()
    const now = new Date().toISOString()
    const record: ProjectRecord = {
      version: RECORD_VERSION,
      id,
      name,
      feed: input.feed,
      mode,
      agency,
      date: null,
      service: null,
      style: { ...DEFAULT_STYLE },
      colors: {},
      defaultColor: DEFAULT_COLOR,
      lineOrder: [],
      theme: DEFAULT_THEME,
      layout: null,
      made: null,
      built: null,
      created: now,
      modified: now,
    }
    try {
      await this.writeAtomic(id, record)
    } catch (error) {
      // An empty folder would be logged as a broken project on every listing.
      await rm(this.dir(id), { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
    return record
  }

  async rename(id: string, name: string): Promise<ProjectRecord> {
    return this.#track(() => this.#renameTracked(id, name))
  }

  async #renameTracked(id: string, name: string): Promise<ProjectRecord> {
    this.checkId(id)
    const trimmed = name.trim()
    check(validateName(trimmed))
    const { record, readOnly } = await this.load(id)
    if (readOnly) throw new Error('read-only')
    // Written back in the current form: the reader normalised the record,
    // so the version it carries is ours (record.md).
    const updated: ProjectRecord = {
      ...record,
      version: RECORD_VERSION,
      name: trimmed,
      modified: new Date().toISOString(),
    }
    await this.writeAtomic(id, updated)
    return updated
  }

  /**
   * The mode and agency a person chose with the feed in view (A2-02). The
   * engine names a layout by its inputs, so a change here means the next
   * run draws a different layout, which the run says; nothing is re-laid
   * out here. An empty agency is none.
   */
  async setInputs(id: string, inputs: ProjectInputs): Promise<ProjectRecord> {
    return this.#track(() => this.#setInputsTracked(id, inputs))
  }

  async #setInputsTracked(id: string, inputs: ProjectInputs): Promise<ProjectRecord> {
    this.checkId(id)
    const agency = inputs.agency == null ? null : inputs.agency.trim() || null
    check(validateMode(inputs.mode))
    check(validateAgency(agency))
    const { record, readOnly } = await this.load(id)
    if (readOnly) throw new Error('read-only')
    if (record.mode === inputs.mode && record.agency === agency) return record
    const updated: ProjectRecord = {
      ...record,
      version: RECORD_VERSION,
      mode: inputs.mode,
      agency,
      modified: new Date().toISOString(),
    }
    await this.writeAtomic(id, updated)
    return updated
  }

  /**
   * A run finished: the layout it was drawn from, the feed's window, the
   * day it was drawn for and the modification time go in together, or none
   * of them does. The layout's id is the engine's own, the hash of the
   * layout's inputs, as graph.build answered it (ADR-033); the window and
   * the engine's day are feeds.service's answer (ADR-031); nothing is read
   * from disk here.
   *
   * A project keeps a service day it already has: the day is resolved once
   * and never recomputed, because a day chosen afresh would depend on when
   * the person asked. The window is replaced every run, because a fresh
   * feed may carry a fresh calendar.
   */
  async completeLayout(id: string, done: LayoutDone): Promise<LayoutResult> {
    return this.#track(() => this.#completeLayoutTracked(id, done))
  }

  async #completeLayoutTracked(id: string, done: LayoutDone): Promise<LayoutResult> {
    this.checkId(id)
    check(validateServiceDate(done.date))
    check(validateServiceWindow(done.service))
    check(validateMade(done.made))
    check(validateMode(done.built?.mode ?? ''))
    check(validateAgency(done.built?.agency ?? null))
    const { record, readOnly } = await this.load(id)
    if (readOnly) throw new Error('read-only')
    if (!isLayoutId(done.layout))
      throw new Error('the layout run did not say which layout it drew from')
    const layout = done.layout
    const { start, end, busiest, anchor } = done.service
    const updated: ProjectRecord = {
      ...record,
      version: RECORD_VERSION,
      layout,
      made: done.made,
      built: { mode: done.built.mode, agency: done.built.agency?.trim() || null },
      date: record.date ?? done.date,
      service: { start, end, busiest, anchor },
      modified: new Date().toISOString(),
    }
    await this.writeAtomic(id, updated)
    // A different id is a different layout. The same id with a different
    // `made` is the same inputs laid out again since this project last drew
    // from them, by another project sharing the set (A3-06). A record with
    // no id or no `made` has nothing to differ from.
    const changed = record.layout !== null && record.layout !== layout
    const relaid =
      !changed && record.layout === layout && record.made !== null && record.made !== done.made
    return { record: updated, changed, relaid }
  }

  /**
   * A rebuild for a chosen day finished: the map was drawn from the stored
   * layout for that day, so the day is written. This is the gate the spec
   * puts in the trusted process: the day must lie inside the window the
   * engine answered, and there must be a layout to have drawn from.
   */
  async completeRebuild(id: string, done: RebuildDone): Promise<ProjectRecord> {
    return this.#track(() => this.#completeRebuildTracked(id, done))
  }

  async #completeRebuildTracked(id: string, done: RebuildDone): Promise<ProjectRecord> {
    this.checkId(id)
    check(validateServiceDate(done.date))
    const { record, readOnly } = await this.load(id)
    if (readOnly) throw new Error('read-only')
    if (record.layout === null) throw new Error('lay the project out first')
    if (record.service === null)
      throw new Error('lay the project out again to learn which days the feed covers')
    if (!withinWindow(done.date, record.service))
      throw new Error(`the feed covers ${record.service.start} to ${record.service.end}`)
    const updated: ProjectRecord = {
      ...record,
      version: RECORD_VERSION,
      date: done.date,
      modified: new Date().toISOString(),
    }
    await this.writeAtomic(id, updated)
    return updated
  }

  /**
   * The line colours a person chose (A4-01), written once the map has been
   * drawn with them, as a chosen day is: nothing is stored that the page on
   * screen does not already show. The engine resolves an override over the
   * feed's own colour over the default, so only the two fields are kept
   * here; the app resolves nothing and stores no feed colour.
   */
  async completeColors(id: string, palette: Palette): Promise<ProjectRecord> {
    return this.#track(() => this.#completeColorsTracked(id, palette))
  }

  async #completeColorsTracked(id: string, palette: Palette): Promise<ProjectRecord> {
    this.checkId(id)
    check(validatePalette(palette))
    const { record, readOnly } = await this.load(id)
    if (readOnly) throw new Error('read-only')
    if (record.layout === null) throw new Error('lay the project out first')
    const updated: ProjectRecord = {
      ...record,
      version: RECORD_VERSION,
      colors: { ...palette.colors },
      defaultColor: palette.defaultColor,
      modified: new Date().toISOString(),
    }
    await this.writeAtomic(id, updated)
    return updated
  }

  /**
   * The order a person arranged the lines in (A4-02), written once the map
   * has been drawn in it, as the colours are. The order is the whole
   * arrangement the panel showed, not a change to the one stored, so what
   * is written is what was seen.
   */
  async completeOrder(id: string, order: LineOrder): Promise<ProjectRecord> {
    return this.#track(() => this.#completeOrderTracked(id, order))
  }

  async #completeOrderTracked(id: string, order: LineOrder): Promise<ProjectRecord> {
    this.checkId(id)
    check(validateLineOrder(order))
    const { record, readOnly } = await this.load(id)
    if (readOnly) throw new Error('read-only')
    if (record.layout === null) throw new Error('lay the project out first')
    const updated: ProjectRecord = {
      ...record,
      version: RECORD_VERSION,
      lineOrder: [...order],
      modified: new Date().toISOString(),
    }
    await this.writeAtomic(id, updated)
    return updated
  }

  async delete(id: string): Promise<DeleteResult> {
    this.checkId(id)
    return this.#track(() => this.#deleteTracked(id))
  }

  async #deleteTracked(id: string): Promise<DeleteResult> {
    if (!(await this.exists(this.dir(id)))) throw new Error('not found')
    const result: DeleteResult = { removed: [], failed: [] }
    const targets = [
      { folder: 'project', path: this.dir(id) },
      { folder: 'output', path: this.outputDir(id) },
    ] as const
    // Each removal is attempted whatever happened to the other, so the
    // record goes where it can and the person hears about the rest.
    for (const { folder, path } of targets) {
      if (!(await this.exists(path))) continue
      try {
        await rm(path, { recursive: true, force: true })
        result.removed.push(folder)
      } catch (error) {
        result.failed.push({ folder, reason: reasonOf(error) })
      }
    }
    return result
  }
}
