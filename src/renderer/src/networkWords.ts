import type { StageDescription, StageSummary } from '../../shared/protocol'

// The geographic pane's long text alternative (issue 105, spec 031): the
// engine's `description` of the stage graph turned into the sentences a
// screen reader reads and a sighted person can read beside the drawing.
//
// **This module computes nothing.** The engine ordered the lines, decided
// which stations are one run and which are branches, found where lines meet
// and timed the longest trip (FR-007, constitution principle II): what is
// here is wording. There is no sort, no search for a junction and no
// distance; a count is the length of a list the engine sent. A field that
// is missing is left out of the words and never worked out from another.
//
// It returns strings and arrays and no JSX, so a unit test can hold every
// sentence, and `StageView.tsx` draws them as text nodes: a station's name
// is a feed's and may hold anything, and none of it is markup (FR-008).
//
// The wording follows the spec's own sentences:
//
//   On the day drawn, the longest trip on one line takes 104 minutes: the
//   Yellow from San Francisco International Airport to Antioch.
//   Blue: from Daly City to Dublin / Pleasanton, 20 stations; meets Red at
//   MacArthur, and Green and Red at Bay Fair.
//
// Where the spec is silent the choice is made here and kept small: a list of
// the lines inside one interchange reads "B, C and D" (no serial comma)
// while the interchanges themselves read "X at P, Y at Q, and Z at R" (with
// one), so the comma and "and" that close the list are never mistaken for
// those inside an entry.

/** What a station the feed gives no name reads as. */
export const UNNAMED = 'an unnamed station'

/** The disclosure's button: a noun phrase, as the notebook's other section names are. */
export const WORDS_SUMMARY = 'The network in words'

/** Its disclosed group, named apart so one name is not heard twice. */
export const WORDS_GROUP = "The network's extent and its lines"

/** One line, as sentences and lists. */
export interface LineWords {
  label: string
  /** The line's item: "A: from X to Y, 3 stations; meets B at X." */
  sentence: string
  /** The button of the line's own disclosure. */
  disclosure: string
  /** Its disclosed group's name. */
  group: string
  /** The stations of the line's run, in order. */
  stations: string[]
  /** Each further piece of the line (a branch, a separate section), in order. */
  further: { heading: string; stations: string[] }[]
}

export interface NetworkWords {
  /** The extent sentence; null where the engine sent no extent (no service day, or no trip that day). */
  extent: string | null
  /** One entry per line, in the order the engine sent them. */
  lines: LineWords[]
}

const named = (name: string): string => (name.trim() === '' ? UNNAMED : name)

const count = (n: number, one: string): string =>
  `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`

/** "a", "a and b", "a, b and c". */
function andList(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** "a", "a, and b", "a, b, and c": the comma stays before the last "and" in a pair. */
function entryList(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

/**
 * The pane's accessible name: the stage, its gloss and the counts the
 * engine sent for it (FR-002).
 */
export function paneName(
  stage: { label: string; gloss: string },
  counts: Pick<StageSummary, 'stations' | 'lines'>,
): string {
  return `The ${stage.label} stage, ${stage.gloss}: ${count(counts.lines.length, 'line')}, ${count(counts.stations, 'station')}`
}

function extentSentence(extent: NonNullable<StageDescription['extent']>): string {
  const minutes = count(extent.minutes, 'minute')
  const from = named(extent.from)
  // A trip that ends where it began is a round trip (the engine writes the
  // two names equal then); the line is then not named, as the spec words it.
  const trip =
    extent.from === extent.to
      ? `a round trip from ${from}`
      : `the ${extent.line} from ${from} to ${named(extent.to)}`
  return `On the day drawn, the longest trip on one line takes ${minutes}: ${trip}.`
}

function lineWords(line: StageDescription['lines'][number]): LineWords {
  const branches = line.branches.filter((branch) => branch.stations.length > 0)
  const total = line.stations.length + branches.reduce((n, b) => n + b.stations.length, 0)

  let head: string
  if (total === 1) {
    // The only station is the run's, or, for a line with no run, the one a
    // piece of it holds.
    head = `${line.label}: one station, ${named(line.stations[0] ?? branches[0].stations[0])}`
  } else if (line.termini.length >= 2) {
    head = `${line.label}: from ${named(line.termini[0])} to ${named(line.termini[1])}, ${count(total, 'station')}`
  } else if (line.termini.length === 1 && line.stations.length > 1) {
    head = `${line.label}: a loop of ${count(total, 'station')} through ${named(line.termini[0])}`
  } else if (line.termini.length === 1) {
    head = `${line.label}: from ${named(line.termini[0])}, ${count(total, 'station')}`
  } else {
    head = `${line.label}: ${count(total, 'station')}`
  }

  // Branches and separate pieces, in the order the engine lists them: a
  // separate piece is followed by its own branches, which leave stations of
  // that piece.
  const pieces = branches.map((branch) => {
    const first = named(branch.stations[0])
    const last = named(branch.stations[branch.stations.length - 1])
    if (branch.at !== null) return `with a branch from ${named(branch.at)} to ${last}`
    return branch.stations.length === 1
      ? `and a separate section of one station, ${first}`
      : `and a separate section from ${first} to ${last}`
  })

  const meetings = line.meets
    .filter((meeting) => meeting.lines.length > 0)
    .map((meeting) => `${andList(meeting.lines)} at ${named(meeting.station)}`)
  const meets = meetings.length === 0 ? 'meets no other line' : `meets ${entryList(meetings)}`

  return {
    label: line.label,
    sentence: `${head}${pieces.map((piece) => `, ${piece}`).join('')}; ${meets}.`,
    disclosure: `Stations on ${line.label}, in order`,
    group: `The stations of ${line.label}`,
    stations: line.stations.map(named),
    further: branches.map((branch) => ({
      heading:
        branch.at === null
          ? 'A separate section, in order'
          : `Branch from ${named(branch.at)}, in order`,
      stations: branch.stations.map(named),
    })),
  }
}

/** The description as words: the extent sentence and one item per line. */
export function networkWords(description: StageDescription): NetworkWords {
  return {
    extent: description.extent === null ? null : extentSentence(description.extent),
    lines: description.lines.map(lineWords),
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

/**
 * The description as it came over the wire, or null when it is not one.
 *
 * The type says it is always there; an older pin sends none, and a field
 * the app reads is checked before it is trusted, as the service window is
 * (`validateServiceWindow`). Whole or not at all: a description with one
 * line wrong draws none, because words for the lines that parsed would say
 * a network has fewer lines than it has. Nothing is inferred in its place.
 * The per-line `trip` is not read here and is not checked.
 */
export function readDescription(value: unknown): StageDescription | null {
  if (!isRecord(value) || !Array.isArray(value.lines)) return null
  const extent = value.extent
  if (extent !== null) {
    if (
      !isRecord(extent) ||
      typeof extent.minutes !== 'number' ||
      typeof extent.line !== 'string' ||
      typeof extent.from !== 'string' ||
      typeof extent.to !== 'string'
    )
      return null
  }
  for (const line of value.lines) {
    if (
      !isRecord(line) ||
      typeof line.label !== 'string' ||
      !isStrings(line.termini) ||
      !isStrings(line.stations) ||
      !Array.isArray(line.meets) ||
      !Array.isArray(line.branches)
    )
      return null
    for (const meeting of line.meets) {
      if (!isRecord(meeting) || typeof meeting.station !== 'string' || !isStrings(meeting.lines))
        return null
    }
    for (const branch of line.branches) {
      if (
        !isRecord(branch) ||
        !(branch.at === null || typeof branch.at === 'string') ||
        !isStrings(branch.stations)
      )
        return null
    }
  }
  return value as unknown as StageDescription
}
