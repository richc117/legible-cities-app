// What "Copy diagnostics" puts on the clipboard, composed here in the main
// process where the logs and the versions are, and written as `~` wherever
// the person's home folder appears (specs/023-logs-and-diagnostics).
//
// No Electron import: every fact is handed in, so the order, the home-folder
// rule and a missing log are all asserted in a unit test. Nothing here
// sends anything anywhere; the text's only destination is the clipboard,
// and the person reads it before they paste it.

import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { DIAGNOSTICS_REPORTS } from '../shared/api'
import { describeCheck, FIRST_RUN_TOOLS, summarize, type FirstRunResult } from '../shared/first-run'
import { escapeRegExp, SEP } from '../shared/patterns'
import { lenientDecode, redactUrls } from './redact'

/** Read-only, and on POSIX never through a symbolic link, as the log is written. */
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)

/** How many lines of each log the copy carries. */
export const TAIL_LINES = 200

/** The most of a log file read for its tail, in bytes. */
export const TAIL_BYTES = 256 * 1024

/** The most project reports one copy takes from the page, and the size of each. */
export const MAX_REPORTS = DIAGNOSTICS_REPORTS.count
export const MAX_REPORT_BYTES = DIAGNOSTICS_REPORTS.bytes

export interface DiagnosticsInput {
  app: { name: string; version: string }
  /** `process.versions`' three that matter: Electron, Chromium and Node. */
  versions: { electron?: string; chrome?: string; node?: string }
  os: { type: string; release: string; arch: string }
  /** The engine's own `engine.info` answer, or a sentence saying why there is none. */
  engine: { info: unknown } | { absent: string }
  /** The first-run check of the bundled LOOM and ffmpeg, as it stands (A6-02). */
  firstRun: FirstRunResult
  mainLog: string
  engineLog: string
  /** Each project's report as its own panel copies it. */
  reports: string[]
}

/**
 * Whether the reports the page sent are what the bridge accepts: a list of
 * at most twenty strings of at most 64 KB each. Only the main side decides.
 */
export function areReports(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > MAX_REPORTS) return false
  // Indexed, not `every`: `every` skips the holes of a sparse array, and a
  // hole is not a report.
  for (let i = 0; i < value.length; i += 1) {
    const report: unknown = value[i]
    if (typeof report !== 'string' || Buffer.byteLength(report, 'utf8') > MAX_REPORT_BYTES) {
      return false
    }
  }
  return true
}

const section = (title: string, body: string): string => `## ${title}\n\n${body.trimEnd()}\n`

/**
 * The most the copy may hold, in characters counted as `.length` (UTF-16
 * units, never fewer than the code points, so the count errs on the safe
 * side). GitHub does not document a limit on an issue's body; its own error
 * says 65,536 characters, and everything else the form carries (the steps,
 * what happened, the version) shares that body. 48,000 leaves about 17,000
 * for those (issue 567).
 */
export const DIAGNOSTICS_BUDGET = 48_000

/** What a copy over the budget lost: the trimmed lines and reports, as the line under the heading counts them. */
interface Kept {
  main: string[]
  engine: string[]
  /** How many of the oldest reports are gone. */
  reportsDropped: number
}

/** `main.log, the last 200 lines`, or what is left of that once a copy was trimmed. */
function logTitle(name: string, kept: number, trimmed: boolean): string {
  if (!trimmed) return `${name}.log, the last ${TAIL_LINES} lines`
  if (kept === 0) return `${name}.log, no lines kept`
  return kept === 1 ? `${name}.log, the last line` : `${name}.log, the last ${kept} lines`
}

/** The sentence under the heading of a copy that was cut to the budget. */
function trimLine(kept: Kept, reports: number): string {
  return (
    `Trimmed to fit a GitHub issue: main.log keeps its last ${kept.main.length} lines, ` +
    `engine.log ${kept.engine.length}, and ${reports - kept.reportsDropped} of ${reports} map reports. ` +
    'The whole logs are in the logs folder (Settings › Open logs folder); attach them to the report.'
  )
}

/** The text with the oldest `dropped` things gone, in the order `dropOrder` gives. */
function assemble(input: DiagnosticsInput, kept: Kept | null): string {
  const { app, versions, os, engine } = input
  const reports = kept === null ? input.reports : input.reports.slice(kept.reportsDropped)
  const heading = `# ${app.name} diagnostics\n`
  const parts = [
    kept === null ? heading : `${heading}\n${trimLine(kept, input.reports.length)}\n`,
    section('App', `${app.name} ${app.version}`),
    section(
      'Runtime',
      [
        `Electron ${versions.electron ?? 'unknown'}`,
        `Chromium ${versions.chrome ?? 'unknown'}`,
        `Node ${versions.node ?? 'unknown'}`,
      ].join('\n'),
    ),
    section('Operating system', `${os.type} ${os.release} (${os.arch})`),
    section('Engine', 'info' in engine ? JSON.stringify(engine.info, null, 2) : engine.absent),
    section(
      'Bundled tools',
      [
        summarize(input.firstRun),
        ...FIRST_RUN_TOOLS.map((tool) => describeCheck(tool, input.firstRun[tool])),
      ].join('\n'),
    ),
    section(
      logTitle('main', kept?.main.length ?? 0, kept !== null),
      kept === null ? input.mainLog : kept.main.join('\n') || 'No lines kept.',
    ),
    section(
      logTitle('engine', kept?.engine.length ?? 0, kept !== null),
      kept === null ? input.engineLog : kept.engine.join('\n') || 'No lines kept.',
    ),
    section(
      'Maps drawn this session',
      input.reports.length === 0
        ? 'No map has been drawn since the app started.'
        : reports.length === 0
          ? 'No report kept.'
          : reports.map((r) => r.trimEnd()).join('\n\n---\n\n'),
    ),
  ]
  return parts.join('\n')
}

/** What one step of the trimming takes away. */
type Drop = 'main' | 'engine' | 'report'

/**
 * The steps from the whole copy to nothing but its head, in order: the
 * oldest line of whichever log is longer now (so the two shrink together,
 * and the one that said more says less first), then, once the logs are
 * empty, the oldest map report. The head sections are not in it.
 */
function dropOrder(input: DiagnosticsInput, main: string[], engine: string[]): Drop[] {
  const size = (lines: string[]): number => lines.reduce((n, l) => n + l.length + 1, 0)
  let mainSize = size(main)
  let engineSize = size(engine)
  let m = 0
  let e = 0
  const order: Drop[] = []
  while (m < main.length || e < engine.length) {
    if (e >= engine.length || (m < main.length && mainSize >= engineSize)) {
      mainSize -= main[m].length + 1
      m += 1
      order.push('main')
    } else {
      engineSize -= engine[e].length + 1
      e += 1
      order.push('engine')
    }
  }
  for (let r = 0; r < input.reports.length; r += 1) order.push('report')
  return order
}

/**
 * The text, in the order the spec gives, before the home folder is shortened.
 *
 * It is the one place the whole text exists (the page sends the map reports
 * in, main adds the logs), so it is where the budget is kept: a text over
 * `DIAGNOSTICS_BUDGET` loses its oldest log lines and then its oldest map
 * reports, and says so in a line under the heading. App, Runtime, Operating
 * system, Engine and Bundled tools are never cut: they are what a report
 * cannot do without, and they are small.
 */
export function composeDiagnostics(input: DiagnosticsInput): string {
  const whole = assemble(input, null)
  if (whole.length <= DIAGNOSTICS_BUDGET) return whole
  const main = input.mainLog.split('\n')
  const engine = input.engineLog.split('\n')
  const order = dropOrder(input, main, engine)
  const after = (steps: number): string => {
    const gone = order.slice(0, steps)
    const count = (kind: Drop): number => gone.filter((d) => d === kind).length
    return assemble(input, {
      main: main.slice(count('main')),
      engine: engine.slice(count('engine')),
      reportsDropped: count('report'),
    })
  }
  // The fewest steps that fit: each step only shortens the text, bar the
  // digits of the counts in the line that says so, which the final loop
  // makes good.
  let low = 1
  let high = order.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (after(middle).length <= DIAGNOSTICS_BUDGET) high = middle
    else low = middle + 1
  }
  let steps = low
  while (steps < order.length && after(steps).length > DIAGNOSTICS_BUDGET) steps += 1
  return after(steps)
}

/** The platforms whose file systems ignore case by default, where a path can come back in either. */
const caseless = (platform: string): boolean => platform === 'win32' || platform === 'darwin'

/** One separator or more: either slash, doubled, or percent-encoded in a URL. */
const SEPARATOR = `${SEP}+`
const LEADING_SEPARATOR = SEP

/**
 * What may not follow a match for it to be the whole folder name: a letter,
 * a digit, `_`, `~` or `-`, or a full stop that carries on into a name. A
 * full stop that ends a sentence, or a file name's extension after a
 * separator, is not part of the folder's name.
 */
const NAME_GOES_ON = '(?![\\p{L}\\p{N}_~-]|\\.[\\p{L}\\p{N}_-])'

/** A home's folder names, without the empty ones a leading or trailing separator leaves. */
function segmentsOf(home: string): string[] | null {
  const segments = home.split(/[\\/]+/)
  while (segments.length > 0 && segments[segments.length - 1] === '') segments.pop()
  // A home that is the root, or nothing, would match every separator.
  if (segments.filter((s) => s !== '').length === 0) return null
  return segments
}

/** One segment as a log could have written it: as it is, or percent-encoded. */
function segmentSource(segment: string): string {
  const encoded = encodeURIComponent(segment)
  return encoded === segment
    ? escapeRegExp(segment)
    : `(?:${escapeRegExp(segment)}|${escapeRegExp(encoded)})`
}

/**
 * The 8.3 short name Windows gives a long folder name, by shape: the first
 * six characters of the part before the last full stop once spaces and full
 * stops are gone, a tilde, a number, and up to three characters of
 * extension (`john.smith` is `JOHN~1.SMI`). The temporary folder is usually
 * written this way (`RUNNER~1` for a user whose name is longer than eight
 * characters), so a home found only in its long form would leak the start
 * of the user's name through every path under it.
 *
 * Best effort: Windows also drops characters a short name cannot hold, and
 * can hash a name it has too many of. The guarantee is the short home read
 * from the temporary folder itself (`shortHomeFrom`), which is matched
 * exactly; this pattern catches the ordinary cases that one did not see.
 */
function shortNameSource(segment: string): string | null {
  const dot = segment.lastIndexOf('.')
  const base = dot > 0 ? segment.slice(0, dot) : segment
  const stem = base.replace(/[\s.]/g, '').slice(0, 6)
  return stem === '' ? null : `${escapeRegExp(stem)}~\\d+(?:\\.[^\\\\/\\s]{1,3})?`
}

/**
 * A pattern for a home folder written any way a log could have it: either
 * separator, a doubled backslash from an escaped string, percent-encoded as
 * in a file URL, on Windows its 8.3 short name, and on Windows and macOS in
 * any case. It matches only a whole folder name, so a home ending in `al`
 * does not match a folder called `alice` beside it. The error door matches
 * every folder it knows with it too (`paths-in-text.ts`, issue 419).
 */
export function homePattern(home: string, platform: string): RegExp | null {
  const segments = segmentsOf(home)
  if (segments === null) return null
  // A leading separator is one, not a run: `file:///tmp/x` keeps its
  // `file://` and loses only the home.
  const joinParts = (parts: string[]): string =>
    parts[0] === '' ? LEADING_SEPARATOR + parts.slice(1).join(SEPARATOR) : parts.join(SEPARATOR)
  const sources = segments.map((segment) => (segment === '' ? '' : segmentSource(segment)))
  const alternatives = [joinParts(sources)]
  if (platform === 'win32' && segments.length > 1) {
    const short = shortNameSource(segments[segments.length - 1])
    if (short !== null) alternatives.push(joinParts([...sources.slice(0, -1), short]))
  }
  return new RegExp(
    `(?:${alternatives.join('|')})${NAME_GOES_ON}`,
    caseless(platform) ? 'giu' : 'gu',
  )
}

const patterns = (homes: readonly string[], platform: string): RegExp[] =>
  [...new Set(homes)]
    // The longest first, so a home inside another is not half-replaced.
    .sort((a, b) => b.length - a.length)
    .map((home) => homePattern(home, platform))
    .filter((p): p is RegExp => p !== null)

/** Every occurrence of a home folder written as `~`. */
export function shortenHome(text: string, homes: readonly string[], platform: string): string {
  let out = text
  for (const pattern of patterns(homes, platform)) out = out.replace(pattern, '~')
  return out
}

/**
 * Whether a home folder is still in the text anywhere: written any of the
 * ways the replacement knows, or once the text's percent-escapes are decoded.
 */
export function containsHome(text: string, homes: readonly string[], platform: string): boolean {
  // Decoded leniently, escape by escape where a run will not decode whole.
  const decoded = lenientDecode(text)
  const forms = [...homes, ...homes.map((home) => encodeURI(home))]
  return patterns(forms, platform).some((pattern) =>
    [text, decoded].some((candidate) => {
      pattern.lastIndex = 0
      return pattern.test(candidate)
    }),
  )
}

/**
 * The home folder as Windows writes it in 8.3 short form, derived from the
 * temporary folder: when the temporary folder's real path starts with the
 * long home and the path as the environment gives it does not, the same
 * number of leading folders of the raw path is the short home. Null when
 * that is not the case, or the two paths do not line up after the home.
 */
export function shortHomeFrom(home: string, rawTemp: string, realTemp: string): string | null {
  const split = (path: string): string[] => path.split(/[\\/]+/).filter((s) => s !== '')
  const lower = (parts: string[]): string[] => parts.map((p) => p.toLowerCase())
  const homeParts = lower(split(home))
  const raw = split(rawTemp)
  const real = lower(split(realTemp))
  if (homeParts.length === 0 || raw.length !== real.length || raw.length <= homeParts.length) {
    return null
  }
  const startsWithHome = (parts: string[]): boolean =>
    homeParts.every((part, i) => parts[i] === part)
  if (!startsWithHome(real) || startsWithHome(lower(raw))) return null
  // Everything after the home must be the same folders, or the prefix is
  // not the home written short but some other path.
  const rest = homeParts.length
  if (lower(raw.slice(rest)).join('/') !== real.slice(rest).join('/')) return null
  return raw.slice(0, rest).join('\\')
}

/**
 * The finished copy: composed within the budget, shortened, and checked. A home folder that
 * survived the replacement is a bug here, and the copy is refused rather
 * than made (FR-006).
 */
export function diagnosticsText(
  input: DiagnosticsInput,
  homes: readonly string[],
  platform: string,
): string {
  // URLs first: log files written before the logs redacted them still hold
  // whole addresses, and a copy is where they would leave the machine.
  const finish = (text: string): string => shortenHome(redactUrls(text), homes, platform)
  // What varies in length is finished before the budget is kept, because a
  // redacted value can be longer than the one it hides; the whole is then
  // finished once more, which changes nothing in the parts that were.
  const text = finish(
    composeDiagnostics({
      ...input,
      mainLog: finish(input.mainLog),
      engineLog: finish(input.engineLog),
      reports: input.reports.map(finish),
    }),
  )
  if (containsHome(text, homes, platform)) {
    throw new Error('the diagnostics still named your home folder, so nothing was copied')
  }
  return text
}

/**
 * The last lines of one file, reading at most its last `bytes`, and whether
 * that read covered the whole file; null when there is no such file.
 */
async function tailOf(
  path: string,
  lines: number,
  bytes: number,
): Promise<{ lines: string[]; whole: boolean } | null> {
  let handle
  try {
    handle = await open(path, READ_FLAGS)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, bytes)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    const all = buffer.toString('utf8').split('\n')
    // A read that starts mid-file starts mid-line, perhaps mid-character.
    if (length < size) all.shift()
    if (all.length > 0 && all[all.length - 1] === '') all.pop()
    return { lines: all.slice(-lines), whole: length === size }
  } finally {
    await handle.close()
  }
}

/**
 * The last `lines` lines of a log: the current file's, topped up from the
 * file before its last rotation when the current one is short and was read
 * whole - a short read of a large file is a bound, not a short log - so a
 * copy made just after a rotation still has something to read. A log with
 * neither file says so; a file that cannot be read says why, by its code.
 */
export async function tailLog(
  folder: string,
  name: string,
  lines = TAIL_LINES,
  bytes = TAIL_BYTES,
): Promise<string> {
  try {
    const current = await tailOf(join(folder, `${name}.log`), lines, bytes)
    const have = current?.lines.length ?? 0
    const older =
      have < lines && (current === null || current.whole)
        ? await tailOf(join(folder, `${name}.old.log`), lines - have, bytes)
        : null
    if (current === null && older === null) return `There is no ${name}.log yet.`
    const joined = [...(older?.lines ?? []), ...(current?.lines ?? [])]
    return joined.length === 0 ? `${name}.log is empty.` : joined.join('\n')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'an unknown error'
    return `${name}.log could not be read (${code}).`
  }
}
