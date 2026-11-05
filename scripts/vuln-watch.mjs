// Ask OSV about every component the installers carry, and judge its answer
// against the triage this repository keeps (issue 557).
//
//   node scripts/vuln-watch.mjs [--pins <file>] [--triage <file>] [--summary <file>]
//
// The components are read from vendor/pins.json and, for the Python
// packages the runtime carries, from vendor/python-requirements.txt beside
// it (the file python.requirements.sha256 pins). Each becomes one OSV query
// (`watchList`): a commit where the pins name one, a version of a GIT
// repository or of a PyPI or npm package where they name a version. They
// go to https://api.osv.dev/v1/querybatch, a page at a time, and every id
// it returns is read in full from /v1/vulns/<id>. The ids are then compared
// with vendor/vuln-triage.json (`judge`), which holds one entry per id: the
// component and version it matched, the severity OSV gives as OSV gives it
// (`osv_severity`) and the rating read from it (`severity`), a verdict
// (`not-affected`, `not-reachable`, `fixed-in-pin` or `open`), a reason, the
// day it was triaged and, for an open one, the day it is due.
//
// The table it prints, and appends to --summary when given (the workflow
// passes $GITHUB_STEP_SUMMARY), has:
//
// - the ids OSV returns that the triage does not cover: new ones, and ones
//   triaged for another component or version, or under another severity,
//   since a verdict holds for what it was read against;
// - the open ids past their due date;
// - the triaged ids OSV no longer returns, to be taken out of the triage;
// - the open ids within their budget, the closed ones by verdict, what was
//   asked, and what is not watched and why (`UNWATCHED`).
//
// The fix budget (issue 557): medium or above within 60 days, critical or
// high in a reachable path within 14. An open entry is reachable or not yet
// shown not to be, so a critical or high one is due within 14 days of its
// triage and any other within 60; low and unrated ones take 60 as well, so
// nothing open is undated. `validateTriage` refuses a due date past that.
//
// Exit status: 0 when every id OSV returns is triaged and no open one is past
// its due date; 1 when one is untriaged or overdue; 2 when the arguments,
// the pins or the triage cannot be read or are malformed; 3 when OSV could
// not be asked or answered something unreadable. A network failure is never
// reported clean: nothing was judged.
//
// Every decision is a function the unit test calls with OSV's answers as
// fixtures (tests/unit/vuln-watch.test.ts); only `fetchOsv` talks to the
// network, through the fetch it is handed, and only when this runs as a
// script. It needs nothing but Node: no dependency, no token.

import { appendFileSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const OSV_API = 'https://api.osv.dev'

/** The Python packages the runtime carries, beside the pins file. */
export const REQUIREMENTS = 'python-requirements.txt'

export const EXIT = { clean: 0, findings: 1, usage: 2, unreachable: 3 }

export const VERDICTS = ['not-affected', 'not-reachable', 'fixed-in-pin', 'open']

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'unrated']

/** Days from triage to due, for an open entry, by severity. */
export const BUDGET_DAYS = { critical: 14, high: 14, medium: 60, low: 60, unrated: 60 }

/** Each request to OSV is given this long; a wedged one fails the run. */
export const REQUEST_TIMEOUT_MS = 30_000

/** OSV pages a query's answer; more rounds than this is an answer gone wrong. */
const MAX_PAGES = 20

/** Details are read this many at a time. */
const DETAIL_CONCURRENCY = 8

/** The top-level keys of the pins file this watch knows how to read. */
export const KNOWN_PINS = [
  '$comment',
  'loom',
  'loom_windows_port',
  'loom_windows_static',
  'engine',
  'python',
  'ffmpeg',
  'electron_ffmpeg',
]

/**
 * What the installers carry that no query covers, and why. Printed on every
 * run, so the gap is in the table rather than in somebody's memory.
 */
export const UNWATCHED = [
  {
    component:
      "The Python runtime's own libraries (OpenSSL, SQLite, libffi, xz, bzip2, mpdecimal, Expat, Tcl/Tk, libuuid)",
    why: 'vendor/pins.json records the python-build-standalone release, not their versions; zlib, which the Windows runtime also carries, is watched as zlib.',
  },
  {
    component: 'Chromium, inside Electron',
    why: "OSV holds no records keyed to Chromium's versions; its fixes reach the app as Electron releases, which Dependabot proposes.",
  },
  {
    component: "Electron's FFmpeg library, and the libopus inside it",
    why: "Chromium's fork of FFmpeg is pinned by a commit of the fork, which is not in the upstream history OSV's FFmpeg records name, and libopus's revision is recorded only in a note.",
  },
  {
    component: 'bzip2 1.0.8, in the Windows LOOM tools',
    why: "OSV's bzip2 records name commits of its repository and list no release versions, and the pins record a release tarball, not a commit.",
  },
  {
    component: "GCC's runtime, mingw-w64's CRT and winpthreads, in the Windows LOOM tools",
    why: 'MSYS2 installs them at whatever it ships on the day of the build; no version is pinned.',
  },
]

// ---- pure decisions ------------------------------------------------------

/** The packages a requirements file pins, as `{ name, version }`, in its order. */
export function parseRequirements(text) {
  const found = []
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)==([^\s;\\]+)/.exec(line)
    if (match) found.push({ name: match[1], version: match[2] })
  }
  return found
}

/** The value at a dotted path of the pins, or throws naming the path. */
function pinned(pins, path) {
  let value = pins
  for (const key of path.split('.')) {
    value = value !== null && typeof value === 'object' ? value[key] : undefined
  }
  if (typeof value !== 'string' || value === '') {
    throw new Error(
      `vendor/pins.json has no ${path}; the watch reads it, so teach it the pins' new shape`,
    )
  }
  return value
}

/**
 * Every query the pins and the requirements make, as `{ component, version,
 * from, query }`: `from` the pins paths it stands for, `query` OSV's. Two
 * pins that ask the same question share one query. Throws when the pins name
 * a component the watch does not know or lack a field it reads, so a change
 * to the pins cannot quietly drop a component from the watch.
 */
export function watchList(pins, requirementsText) {
  if (pins === null || typeof pins !== 'object' || Array.isArray(pins)) {
    throw new Error('vendor/pins.json is not an object')
  }
  const unknown = Object.keys(pins).filter((key) => !KNOWN_PINS.includes(key))
  if (unknown.length > 0) {
    throw new Error(
      `vendor/pins.json names ${unknown.join(', ')}, which the watch does not read: add a query for it, or a line in UNWATCHED saying why there is none`,
    )
  }
  const list = []
  const add = (entry) => {
    const key = JSON.stringify(entry.query)
    const same = list.find((other) => JSON.stringify(other.query) === key)
    if (same) same.from.push(...entry.from)
    else list.push(entry)
  }
  const git = (repo, tag) => ({ package: { ecosystem: 'GIT', name: repo }, version: tag })
  const commit = (path, component, version) =>
    add({ component, version, from: [path], query: { commit: pinned(pins, path) } })

  const python = pinned(pins, 'python.version')
  add({
    component: 'CPython',
    version: python,
    from: ['python.version'],
    query: git('https://github.com/python/cpython', `v${python}`),
  })
  const pip = pinned(pins, 'python.pip.version')
  add({
    component: 'pip',
    version: pip,
    from: ['python.pip.version'],
    query: { package: { ecosystem: 'PyPI', name: 'pip' }, version: pip },
  })
  const packages = parseRequirements(requirementsText)
  if (packages.length === 0) {
    throw new Error(`${REQUIREMENTS} pins no package; the watch would ask about none of them`)
  }
  for (const { name, version } of packages) {
    add({
      component: name,
      version,
      from: [`python.requirements (${REQUIREMENTS})`],
      query: { package: { ecosystem: 'PyPI', name }, version },
    })
  }
  commit('engine.commit', 'engine', pinned(pins, 'engine.version'))
  commit('ffmpeg.source.commit', 'FFmpeg', pinned(pins, 'ffmpeg.version'))
  commit('ffmpeg.x264.commit', 'x264', pinned(pins, 'ffmpeg.x264.commit').slice(0, 12))
  for (const path of ['ffmpeg.zlib.version', 'loom_windows_static.zlib.version']) {
    const zlib = pinned(pins, path)
    add({
      component: 'zlib',
      version: zlib,
      from: [path],
      query: git('https://github.com/madler/zlib', `v${zlib}`),
    })
  }
  commit('loom.commit', 'LOOM', pinned(pins, 'loom.commit').slice(0, 12))
  commit(
    'loom_windows_port.commit',
    'LOOM Windows port',
    pinned(pins, 'loom_windows_port.commit').slice(0, 12),
  )
  const electron = pinned(pins, 'electron_ffmpeg.electron.version')
  add({
    component: 'Electron',
    version: electron,
    from: ['electron_ffmpeg.electron.version'],
    query: { package: { ecosystem: 'npm', name: 'electron' }, version: electron },
  })
  return list
}

/** How a query reads in the table. */
export function coordinates(query) {
  if (query.commit !== undefined) return `commit ${query.commit}`
  return `${query.package.ecosystem} ${query.package.name} @ ${query.version}`
}

/**
 * The severity OSV gives a record, as it gives it: the newest CVSS vector,
 * else the database's own rating, else null (unrated).
 */
export function osvSeverity(record) {
  const listed = Array.isArray(record?.severity) ? record.severity : []
  for (const type of ['CVSS_V4', 'CVSS_V3', 'CVSS_V2']) {
    const found = listed.find((s) => s?.type === type && typeof s.score === 'string')
    if (found) return found.score
  }
  const own = record?.database_specific?.severity
  return typeof own === 'string' && own !== '' ? own : null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

function isDate(text) {
  if (typeof text !== 'string' || !DATE.test(text)) return false
  const parsed = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text
}

/** `date` (YYYY-MM-DD) plus `days`, as YYYY-MM-DD. */
export function addDays(date, days) {
  const at = new Date(`${date}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

/** How many sentences a reason has: a full stop, ! or ? before a capital, a digit or the end. */
export function sentences(text) {
  return (
    String(text)
      .trim()
      .match(/[.!?][)"'`]*(?=\s+[A-Z0-9`"'(]|$)/g) ?? []
  ).length
}

const FIELDS = [
  'id',
  'component',
  'version',
  'severity',
  'osv_severity',
  'verdict',
  'reason',
  'triaged',
]

/** Every way the triage is malformed, each as a sentence; empty where it is not. */
export function validateTriage(triage) {
  if (triage === null || typeof triage !== 'object' || !Array.isArray(triage.entries)) {
    return ['the triage is not an object with an "entries" list']
  }
  const problems = []
  const seen = new Set()
  triage.entries.forEach((entry, index) => {
    const name =
      entry !== null && typeof entry === 'object' && typeof entry.id === 'string'
        ? entry.id
        : `entry ${index}`
    const say = (text) => problems.push(`${name}: ${text}`)
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      say('is not an object')
      return
    }
    for (const field of FIELDS) {
      if (!(field in entry)) say(`has no "${field}"`)
    }
    for (const field of Object.keys(entry)) {
      if (!FIELDS.includes(field) && field !== 'due') say(`has a field "${field}" the form lacks`)
    }
    for (const field of ['id', 'component', 'version', 'reason']) {
      if (field in entry && (typeof entry[field] !== 'string' || entry[field].trim() === '')) {
        say(`has an empty or non-text "${field}"`)
      }
    }
    if (typeof entry.id === 'string') {
      if (seen.has(entry.id)) say('is triaged twice')
      seen.add(entry.id)
    }
    if ('severity' in entry && !SEVERITIES.includes(entry.severity)) {
      say(`has severity ${JSON.stringify(entry.severity)}, not one of ${SEVERITIES.join(', ')}`)
    }
    if ('osv_severity' in entry) {
      const given = entry.osv_severity
      if (given !== null && (typeof given !== 'string' || given === '')) {
        say('has an "osv_severity" that is neither null nor text')
      } else if ((given === null) !== (entry.severity === 'unrated')) {
        say(
          given === null
            ? 'is rated although OSV gives it no severity: "unrated"'
            : 'is "unrated" although OSV gives it a severity: rate it from that',
        )
      }
    }
    if ('verdict' in entry && !VERDICTS.includes(entry.verdict)) {
      say(`has verdict ${JSON.stringify(entry.verdict)}, not one of ${VERDICTS.join(', ')}`)
    }
    if (typeof entry.reason === 'string' && entry.reason.trim() !== '') {
      const n = sentences(entry.reason)
      if (n < 1 || n > 3) say(`has a reason of ${n} sentences, where one to three are asked`)
    }
    if ('triaged' in entry && !isDate(entry.triaged))
      say('has a "triaged" that is not a YYYY-MM-DD date')
    if (entry.verdict === 'open') {
      if (!('due' in entry)) say('is open and has no "due" date')
      else if (!isDate(entry.due)) say('has a "due" that is not a YYYY-MM-DD date')
      else if (isDate(entry.triaged) && SEVERITIES.includes(entry.severity)) {
        const latest = addDays(entry.triaged, BUDGET_DAYS[entry.severity])
        if (entry.due < entry.triaged) say('is due before it was triaged')
        else if (entry.due > latest) {
          say(
            `is due ${entry.due}, past the ${BUDGET_DAYS[entry.severity]}-day budget for ${entry.severity} (${latest})`,
          )
        }
      }
    } else if ('due' in entry) {
      say(`has a "due" date although it is ${entry.verdict}, not open`)
    }
  })
  return problems
}

/** A record's first sentence, on one line, for the table: its summary, else its details. */
export function headline(record) {
  const flat = String(record?.summary || record?.details || '')
    .replace(/\s+/g, ' ')
    .trim()
  const end = flat.search(/[.!?](\s|$)/)
  const first = end === -1 ? flat : flat.slice(0, end + 1)
  return first.length > 160 ? `${first.slice(0, 159)}…` : first
}

/**
 * OSV's answer judged against the triage. `returned[i]` is the ids OSV gave
 * for `watch[i]`; `details` each id's record. Every id OSV returns lands in
 * exactly one of untriaged, overdue, open or closed; every triaged id it
 * does not return lands in dropped.
 */
export function judge({ watch, returned, details, triage, today }) {
  const triaged = new Map(triage.entries.map((entry) => [entry.id, entry]))
  const found = new Map()
  watch.forEach((asked, index) => {
    for (const id of returned[index] ?? []) {
      if (!found.has(id)) found.set(id, [])
      found.get(id).push({ component: asked.component, version: asked.version })
    }
  })
  const untriaged = []
  const overdue = []
  const open = []
  const closed = []
  for (const id of [...found.keys()].sort()) {
    const matches = found.get(id)
    const record = details[id] ?? {}
    const rated = osvSeverity(record)
    const where = matches.map((m) => `${m.component} ${m.version}`).join(', ')
    const entry = triaged.get(id)
    let note = null
    if (entry === undefined) {
      note = 'not in the triage'
    } else if (!matches.some((m) => m.component === entry.component)) {
      note = `triaged for ${entry.component}, now returned for ${where}`
    } else if (
      !matches.some((m) => m.component === entry.component && m.version === entry.version)
    ) {
      note = `triaged at ${entry.component} ${entry.version}, now returned for ${where}`
    } else if (entry.osv_severity !== rated) {
      note = `triaged as ${entry.osv_severity ?? 'unrated'}, OSV now gives ${rated ?? 'unrated'}`
    }
    if (note !== null) {
      untriaged.push({ id, where, rated, summary: headline(record), note })
    } else if (entry.verdict === 'open' && today > entry.due) {
      overdue.push({ id, where, entry })
    } else if (entry.verdict === 'open') {
      open.push({ id, where, entry })
    } else {
      closed.push({ id, where, entry })
    }
  }
  const dropped = triage.entries
    .filter((entry) => !found.has(entry.id))
    .map((entry) => ({ id: entry.id, entry }))
  return { untriaged, overdue, open, closed, dropped, returned: found.size }
}

/** Whether a judgement fails the run. */
export function failed(judgement) {
  return judgement.untriaged.length > 0 || judgement.overdue.length > 0
}

function cell(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\|/g, '\\|')
}

function table(head, rows) {
  if (rows.length === 0) return 'None.\n'
  const line = (cells) => `| ${cells.map((c) => cell(c)).join(' | ')} |`
  return (
    [line(head), `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(line)].join('\n') + '\n'
  )
}

/** The report, as Markdown: what stdout prints and the job summary shows. */
export function report({ judgement, watch, returned, today, triaged }) {
  const out = []
  out.push(`## Vulnerability watch, ${today}\n`)
  out.push(
    `OSV was asked about ${watch.length} components from vendor/pins.json and vendor/${REQUIREMENTS}, and returned ${judgement.returned} ids; vendor/vuln-triage.json has ${triaged} entries.\n`,
  )
  out.push(`### New or untriaged: ${judgement.untriaged.length}\n`)
  out.push(
    table(
      ['Id', 'Matched', 'Severity OSV gives', 'Summary', 'Why it needs triage'],
      judgement.untriaged.map((u) => [u.id, u.where, u.rated ?? 'unrated', u.summary, u.note]),
    ),
  )
  out.push(`### Open past their due date: ${judgement.overdue.length}\n`)
  out.push(
    table(
      ['Id', 'Matched', 'Severity', 'Due', 'Reason'],
      judgement.overdue.map((o) => [o.id, o.where, o.entry.severity, o.entry.due, o.entry.reason]),
    ),
  )
  out.push(`### Triaged, and no longer returned by OSV: ${judgement.dropped.length}\n`)
  out.push(
    table(
      ['Id', 'Triaged for', 'Verdict'],
      judgement.dropped.map((d) => [
        d.id,
        `${d.entry.component} ${d.entry.version}`,
        d.entry.verdict,
      ]),
    ),
  )
  out.push(`### Open within their budget: ${judgement.open.length}\n`)
  out.push(
    table(
      ['Id', 'Matched', 'Severity', 'Due', 'Reason'],
      judgement.open.map((o) => [o.id, o.where, o.entry.severity, o.entry.due, o.entry.reason]),
    ),
  )
  out.push(`### Triaged and closed: ${judgement.closed.length}\n`)
  out.push(
    table(
      ['Verdict', 'Ids'],
      VERDICTS.filter((v) => v !== 'open')
        .map((v) => [v, judgement.closed.filter((c) => c.entry.verdict === v)])
        .filter(([, list]) => list.length > 0)
        .map(([v, list]) => [v, `${list.length}: ${list.map((c) => c.id).join(', ')}`]),
    ),
  )
  out.push('### What was asked\n')
  out.push(
    table(
      ['Component', 'Version', 'Asked as', 'From', 'Ids'],
      watch.map((w, i) => [
        w.component,
        w.version,
        coordinates(w.query),
        w.from.join(', '),
        String((returned[i] ?? []).length),
      ]),
    ),
  )
  out.push('### Not watched\n')
  out.push(
    table(
      ['Component', 'Why'],
      UNWATCHED.map((u) => [u.component, u.why]),
    ),
  )
  out.push(
    failed(judgement)
      ? `**Failed:** ${judgement.untriaged.length} untriaged, ${judgement.overdue.length} past their due date. Triage each in vendor/vuln-triage.json (SECURITY.md says how).\n`
      : '**Clean:** every id OSV returns is triaged, and no open one is past its due date.\n',
  )
  return out.join('\n')
}

// ---- the network ---------------------------------------------------------

/** OSV could not be asked, or answered something that cannot be read. */
export class OsvUnavailable extends Error {}

async function call(fetchImpl, url, init, timeoutMs, what) {
  let response
  try {
    response = await fetchImpl(url, { ...init, signal: globalThis.AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    throw new OsvUnavailable(`${what}: ${error?.message ?? error}`)
  }
  if (!response || !response.ok) {
    throw new OsvUnavailable(`${what}: HTTP ${response?.status ?? 'no response'}`)
  }
  try {
    return await response.json()
  } catch (error) {
    throw new OsvUnavailable(`${what}: the answer is not JSON (${error?.message ?? error})`)
  }
}

/**
 * OSV's answer for every query, `{ returned, details }`: `returned[i]` the
 * ids for `watch[i]`, `details` each id's full record. Throws OsvUnavailable
 * on any failure to ask or to read the answer, never a partial result.
 */
export async function fetchOsv(watch, { fetch: fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const returned = watch.map(() => [])
  let pending = watch.map((_, index) => ({ index, token: null }))
  for (let round = 0; pending.length > 0; round += 1) {
    if (round >= MAX_PAGES) {
      throw new OsvUnavailable(`querybatch was still paging after ${MAX_PAGES} rounds`)
    }
    const queries = pending.map(({ index, token }) =>
      token === null ? watch[index].query : { ...watch[index].query, page_token: token },
    )
    const answer = await call(
      fetchImpl,
      `${OSV_API}/v1/querybatch`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ queries }),
      },
      timeoutMs,
      'querybatch',
    )
    const results = answer?.results
    if (!Array.isArray(results) || results.length !== pending.length) {
      throw new OsvUnavailable(
        `querybatch answered ${Array.isArray(results) ? results.length : 'no'} results for ${pending.length} queries`,
      )
    }
    const next = []
    results.forEach((result, at) => {
      const { index } = pending[at]
      const vulns = result?.vulns ?? []
      if (!Array.isArray(vulns))
        throw new OsvUnavailable('querybatch answered a result with no list')
      for (const vuln of vulns) {
        if (typeof vuln?.id !== 'string' || vuln.id === '') {
          throw new OsvUnavailable('querybatch answered a vulnerability with no id')
        }
        if (!returned[index].includes(vuln.id)) returned[index].push(vuln.id)
      }
      if (typeof result?.next_page_token === 'string' && result.next_page_token !== '') {
        next.push({ index, token: result.next_page_token })
      }
    })
    pending = next
  }
  const ids = [...new Set(returned.flat())].sort()
  const details = {}
  for (let at = 0; at < ids.length; at += DETAIL_CONCURRENCY) {
    await Promise.all(
      ids.slice(at, at + DETAIL_CONCURRENCY).map(async (id) => {
        const record = await call(
          fetchImpl,
          `${OSV_API}/v1/vulns/${encodeURIComponent(id)}`,
          { method: 'GET' },
          timeoutMs,
          `vulns/${id}`,
        )
        if (record?.id !== id) {
          throw new OsvUnavailable(`vulns/${id} answered a record for ${record?.id ?? 'nothing'}`)
        }
        details[id] = record
      }),
    )
  }
  return { returned, details }
}

// ---- the command ---------------------------------------------------------

function parseArgs(argv) {
  const options = { pinsFile: null, triageFile: null, summary: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = () => {
      const next = argv[i + 1]
      if (next === undefined || next === '') throw new Error(`${arg} needs a value`)
      i += 1
      return resolve(next)
    }
    if (arg === '--pins') options.pinsFile = value()
    else if (arg === '--triage') options.triageFile = value()
    else if (arg === '--summary') options.summary = value()
    else throw new Error(`unknown argument ${arg}`)
  }
  options.pinsFile ??= join(repoRoot, 'vendor', 'pins.json')
  options.triageFile ??= join(repoRoot, 'vendor', 'vuln-triage.json')
  return options
}

const USAGE = 'usage: vuln-watch.mjs [--pins <file>] [--triage <file>] [--summary <file>]\n'

/**
 * The command, with the network and the clock handed in so a test can run
 * it whole. Resolves to the exit status.
 */
export async function main(argv, io = {}) {
  const out = io.out ?? process.stdout
  const err = io.err ?? process.stderr
  const fetchImpl = io.fetch ?? globalThis.fetch
  const today = io.today ?? new Date().toISOString().slice(0, 10)
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    err.write(`${error.message}\n${USAGE}`)
    return EXIT.usage
  }
  const summarise = (text) => {
    if (options.summary !== null) appendFileSync(options.summary, text)
  }
  let watch
  let triage
  try {
    const pins = JSON.parse(readFileSync(options.pinsFile, 'utf8'))
    const requirements = readFileSync(join(dirname(options.pinsFile), REQUIREMENTS), 'utf8')
    watch = watchList(pins, requirements)
    triage = JSON.parse(readFileSync(options.triageFile, 'utf8'))
  } catch (error) {
    err.write(`vuln-watch: ${error.message}\n`)
    return EXIT.usage
  }
  const problems = validateTriage(triage)
  if (problems.length > 0) {
    err.write('vuln-watch: the triage is not well formed, so nothing was judged:\n')
    for (const problem of problems) err.write(`  ${problem}\n`)
    return EXIT.usage
  }
  let answer
  try {
    answer = await fetchOsv(watch, { fetch: fetchImpl, timeoutMs: io.timeoutMs })
  } catch (error) {
    if (!(error instanceof OsvUnavailable)) throw error
    const text =
      `## Vulnerability watch, ${today}\n\n**OSV could not be asked:** ${error.message}. ` +
      'Nothing was judged, so this run says nothing about whether the components are clean.\n'
    err.write(text)
    summarise(text)
    return EXIT.unreachable
  }
  const judgement = judge({ watch, ...answer, triage, today })
  const text = report({
    judgement,
    watch,
    returned: answer.returned,
    today,
    triaged: triage.entries.length,
  })
  out.write(text)
  summarise(text)
  return failed(judgement) ? EXIT.findings : EXIT.clean
}

// Run as a script, not when a test imports the module.
function invokedDirectly() {
  if (process.argv[1] === undefined) return false
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}
if (invokedDirectly()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      process.stderr.write(`vuln-watch: ${error?.stack ?? error}\n`)
      process.exitCode = EXIT.usage
    },
  )
}
