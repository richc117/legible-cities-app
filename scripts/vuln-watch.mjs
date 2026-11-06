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
// go to https://api.osv.dev/v1/querybatch, a page at a time, with a few
// canaries (`CANARIES`): old versions OSV has long matched, one per kind of
// query, whose silence means OSV's matching has changed, not that the
// components are clean. Every id the components return is read in full
// from /v1/vulns/<id>, and the rating of the vector OSV gives it from the
// CVE record (https://cveawg.mitre.org/api/cve/<id>) that rates it. The ids
// are then compared with vendor/vuln-triage.json (`judge`), which holds an
// entry per id and component: the version it matched, the severity OSV
// gives as OSV gives it (`osv_severity`) and the rating read from it
// (`severity`), a verdict (`not-affected`, `not-reachable`, `fixed-in-pin`
// or `open`), a reason, the day it was triaged and, for an open one, the
// day it is due; `rating_note` where the rating is not the one the CVE
// record gives.
//
// The table it prints, and appends to --summary when given (the workflow
// passes $GITHUB_STEP_SUMMARY), has:
//
// - the ids OSV returns that the triage does not cover: new ones, ones
//   triaged for another component or version or under another severity,
//   since a verdict holds for what it was read against, and ones rated
//   below the CVE record's rating with no note saying why;
// - the open ids past their due date;
// - the triaged ids OSV no longer returns, to be taken out of the triage;
// - the open ids within their budget, the closed ones by verdict, what was
//   asked, the canaries, and what is not watched and why (`UNWATCHED`).
//
// The fix budget (issue 557): medium or above within 60 days, critical or
// high in a reachable path within 14. An open entry is reachable or not yet
// shown not to be, so a critical or high one is due within 14 days of its
// triage and any other within 60; low and unrated ones take 60 as well, so
// nothing open is undated. `validateTriage` refuses a due date past that.
//
// Exit status: 0 when every id OSV returns is triaged, no open one is past
// its due date and every triaged id is still returned; 1 when one is
// untriaged or overdue, or a triaged one is no longer returned; 2 when the arguments,
// the pins, the requirements or the triage cannot be read or are malformed;
// 3 when OSV or the CVE records could not be asked, answered something
// unreadable, or answered in a way that cannot be trusted (`distrust`: a
// silent canary, or no id at all for a component the triage holds ids for).
// None of those is reported clean: nothing was judged. The whole run stops
// at its own deadline (`RUN_DEADLINE_MS`), inside the workflow's timeout, so
// a slow OSV ends in that status rather than in a cancelled job.
//
// Every decision is a function the unit test calls with OSV's answers as
// fixtures (tests/unit/vuln-watch.test.ts); only `fetchOsv` talks to the
// network, through the fetch it is handed, and only when this runs as a
// script. It needs nothing but Node: no dependency, no token.

import { appendFileSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const OSV_API = 'https://api.osv.dev'

/** Where a CVE record is read, for the rating its CNA gives a vector. */
export const CVE_API = 'https://cveawg.mitre.org/api/cve'

/** The Python packages the runtime carries, beside the pins file. */
export const REQUIREMENTS = 'python-requirements.txt'

export const EXIT = { clean: 0, findings: 1, usage: 2, unreachable: 3 }

export const VERDICTS = ['not-affected', 'not-reachable', 'fixed-in-pin', 'open']

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'unrated']

/** How the severities order, for "rated below". */
const RANK = { unrated: 0, low: 1, medium: 2, high: 3, critical: 4 }

/** Days from triage to due, for an open entry, by severity. */
export const BUDGET_DAYS = { critical: 14, high: 14, medium: 60, low: 60, unrated: 60 }

/** Each request is given this long; a wedged one fails the run. */
export const REQUEST_TIMEOUT_MS = 30_000

/**
 * The whole run is given this long, every request included: two minutes
 * inside the workflow's `timeout-minutes: 10`, which checkout and Node's
 * setup share, so a slow OSV ends in EXIT.unreachable and its summary, never
 * in a job GitHub cancels with nothing said.
 */
export const RUN_DEADLINE_MS = 8 * 60_000

/** OSV pages a query's answer; more rounds than this is an answer gone wrong. */
const MAX_PAGES = 20

/** What an OSV id may hold, since it goes into a URL. */
const SAFE_ID = /^[A-Za-z0-9._:-]+$/

/** Records are read this many at a time. */
const DETAIL_CONCURRENCY = 8

/** The words a CVE record or a database uses for a rating, as the triage's. */
const RATINGS = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  MODERATE: 'medium',
  LOW: 'low',
  NONE: 'low',
}

/**
 * Queries OSV has matched for years, one for each kind the watch asks: each
 * must return its `expect` id, or OSV's answer is not trusted. A change in
 * how OSV matches a GIT tag, a commit or a package version would otherwise
 * read as every component going clean at once.
 */
export const CANARIES = [
  {
    kind: 'GIT tag',
    query: {
      package: { ecosystem: 'GIT', name: 'https://github.com/madler/zlib' },
      version: 'v1.2.11',
    },
    expect: 'CVE-2018-25032',
  },
  {
    kind: 'commit',
    query: { commit: 'cacf7f1d4e3d44d871b605da3b647f07d718623f' },
    expect: 'CVE-2018-25032',
  },
  {
    kind: 'PyPI',
    query: { package: { ecosystem: 'PyPI', name: 'requests' }, version: '2.19.1' },
    expect: 'GHSA-x84v-xcm2-53pg',
  },
  {
    kind: 'npm',
    query: { package: { ecosystem: 'npm', name: 'electron' }, version: '1.0.0' },
    expect: 'GHSA-fjqr-fx3f-g4rv',
  },
]

/** A key the pins may hold, its contents not read for components. */
const KNOWN = true
const known = (...names) => Object.fromEntries(names.map((name) => [name, KNOWN]))

/** In a shape, the rule for every key the shape does not name: a per-target map. */
const ANY = '*'

/**
 * Every key of the pins this watch knows how to read, as far down as a
 * component could be added: a key the pins gain anywhere in here and the
 * watch does not know refuses the run (`unknownPins`), so a component
 * cannot reach the installers unwatched. `KNOWN` marks what holds no
 * component of its own: metadata, the build's own tools, and what UNWATCHED
 * covers whole. A per-target map is descended through `ANY`, so a target
 * may be added but a library a target's licence record gains may not;
 * FFmpeg's configure lines are read in `watchList` (`ffmpegConfigure`).
 * Electron's FFmpeg is not descended: its trees, its build's dependencies
 * and its components are one row of UNWATCHED, everything it links
 * included, so a key added there names nothing the watch could ask about.
 */
export const PINS_SHAPE = {
  $comment: KNOWN,
  loom: known('repo', 'commit', 'note', 'binaries', 'licence'),
  loom_windows_port: known('repo', 'commit', 'note', 'licence'),
  loom_windows_static: {
    note: KNOWN,
    zlib: known(
      'version',
      'msys2_package',
      'msys2_revision',
      'msys2_source',
      'url',
      'sha256',
      'signature',
      'signing_key',
      'licence',
    ),
    // UNWATCHED says why.
    bzip2: KNOWN,
  },
  engine: known('repo', 'tag', 'commit', 'version', 'protocol', 'note', 'licence', 'schema_sha256'),
  python: {
    ...known('source', 'release', 'version', 'note', 'licence', 'licence_check', 'licence_texts'),
    // The packages are read from the requirements file; uv is a build tool.
    requirements: KNOWN,
    pip: known('note', 'version', 'sha256'),
    // The same CPython on each platform. A library the build compiles in
    // with no licence entry of its own is recorded under `unlisted` with its
    // version: zlib is read from there (`runtimeZlibs`), Expat and libmpdec
    // are in UNWATCHED, and any other refuses the run until it is one or the
    // other. `named_absent` and `not_linked` list licences that do not ship.
    targets: {
      [ANY]: {
        ...known('asset', 'sha256', 'triple', 'full'),
        licences: {
          unlisted: known('LICENSE.zlib.txt', 'LICENSE.expat.txt', 'LICENSE.mpdecimal.txt'),
          ...known('named_absent', 'not_linked'),
        },
      },
    },
  },
  ffmpeg: {
    ...known('version', 'note', 'licence'),
    targets: {
      [ANY]: known('runner', 'zlib', 'zlib_configure', 'x264_configure', 'configure', 'reports'),
    },
    source: known('url', 'sha256', 'signature', 'signing_key', 'repo', 'tag', 'commit', 'licence'),
    x264: known('repo', 'commit', 'sha256', 'licence'),
    zlib: known('version', 'url', 'sha256', 'signature', 'signing_key', 'licence'),
  },
  electron_ffmpeg: {
    // Electron's FFmpeg and what builds it, not descended: UNWATCHED says why.
    ...known(
      'note',
      'licence',
      'chromium',
      'ffmpeg',
      'chromium_trees',
      'chromium_deps',
      'electron_files',
      'components',
    ),
    electron: known('version', 'repo', 'tag', 'commit'),
  },
}

/**
 * What the installers carry that no query covers, and why. Printed on every
 * run, so the gap is in the table rather than in somebody's memory.
 */
export const UNWATCHED = [
  {
    component:
      "The Python runtime's own libraries (OpenSSL, SQLite, libffi, xz, bzip2, mpdecimal, Expat, libuuid)",
    why: "vendor/pins.json records the python-build-standalone release, not their versions; the Windows build's licence records name Expat's and libmpdec's in passing, and watching them waits on a triage of their matches. Its zlib is watched at the version its licence record names.",
  },
  {
    component: 'Chromium, inside Electron',
    why: "OSV holds no records keyed to Chromium's versions; its fixes reach the app as Electron releases, which Dependabot proposes.",
  },
  {
    component: "Electron's FFmpeg library, and everything it links (libopus among them)",
    why: "Chromium's fork of FFmpeg is pinned by a commit of the fork, which is not in the upstream history OSV's FFmpeg records name, and what it links is pinned only as Chromium's trees, with no versions OSV could match.",
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

/**
 * The packages a requirements file pins, as `{ name, version }`, in its
 * order. Blank lines, comments and the indented lines under a pin (its
 * hashes, its "via") are passed over; any other line it cannot read as
 * `name==version` throws, so a package cannot drop out of the watch by
 * being written another way.
 */
export function parseRequirements(text) {
  const found = []
  String(text)
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (line.trim() === '' || line.startsWith('#') || /^\s/.test(line)) return
      const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)==([^\s;\\]+)(?=\s|;|\\|$)/.exec(line)
      if (match !== null) found.push({ name: match[1], version: match[2] })
      else
        throw new Error(
          `${REQUIREMENTS} line ${index + 1}, ${JSON.stringify(line)}, is not a pin the watch can read (name==version)`,
        )
    })
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

/** Every dotted path in `value` that `shape` does not know. */
export function unknownPins(value, shape = PINS_SHAPE, path = '') {
  if (shape === KNOWN || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return []
  }
  const found = []
  for (const key of Object.keys(value)) {
    const at = path === '' ? key : `${path}.${key}`
    const rule = Object.hasOwn(shape, key) ? shape[key] : shape[ANY]
    if (rule === undefined) found.push(at)
    else found.push(...unknownPins(value[key], rule, at))
  }
  return found
}

/**
 * The `--enable-` options FFmpeg's configure lines may carry, by name, none
 * of them a library the watch is blind to: libx264, asked about at its
 * commit; zlib, which the Windows build compiles in from ffmpeg.zlib, asked
 * about at its version, and the others take from the operating system,
 * which the installers do not ship (`FFMPEG_ZLIB`); gpl and version3, the
 * licence switches, which link nothing; and the selectors of FFmpeg's own
 * encoders, decoders, parsers, muxers, demuxers, filters, input devices and
 * protocols that the pinned lines use. A selector names FFmpeg's code, not
 * a library: one that needs a library builds only with that library's own
 * option, which is not here, or with what autodetection finds, which
 * `FFMPEG_REQUIRED` turns off. Any other option refuses the run.
 */
const FFMPEG_ENABLES = [
  'libx264',
  'zlib',
  'gpl',
  'version3',
  'encoder',
  'decoder',
  'parser',
  'muxer',
  'demuxer',
  'filter',
  'indev',
  'protocol',
]

/** What every FFmpeg configure line carries (ADR-040): without them configure links what the runner has. */
const FFMPEG_REQUIRED = ['--disable-everything', '--disable-autodetect']

/** Where each FFmpeg target's zlib comes from: built from ffmpeg.zlib, or the operating system's. */
const FFMPEG_ZLIB = ['static', 'system']

/**
 * What in `pins`' FFmpeg configure lines could link a library the watch does
 * not ask about, each as a phrase naming its target: an `--enable-` option
 * outside FFMPEG_ENABLES, a library linked by hand (`--extra-libs`, `-l`,
 * `-framework`), a line without an option of FFMPEG_REQUIRED, or a zlib
 * from neither of FFMPEG_ZLIB's places.
 */
export function ffmpegConfigure(pins) {
  const targets = pins.ffmpeg?.targets
  const found = []
  if (targets === null || typeof targets !== 'object') return found
  for (const [target, entry] of Object.entries(targets)) {
    const at = `ffmpeg.targets.${target}`
    const line = ` ${String(entry?.configure ?? '').replace(/\s+/g, ' ')} `
    for (const option of FFMPEG_REQUIRED) {
      if (!line.includes(` ${option} `)) found.push(`no ${option} (${at}.configure)`)
    }
    for (const [, name] of line.matchAll(/ --enable-([\w-]+)/g)) {
      if (!FFMPEG_ENABLES.includes(name)) found.push(`--enable-${name} (${at}.configure)`)
    }
    for (const [, linked] of line.matchAll(/[\s'"=,](--extra-libs|-l[\w.+-]+|-framework)\b/g)) {
      found.push(`${linked} (${at}.configure)`)
    }
    if (!FFMPEG_ZLIB.includes(entry?.zlib)) {
      found.push(`a zlib that is ${JSON.stringify(entry?.zlib)} (${at}.zlib)`)
    }
  }
  return found
}

/**
 * The Python runtimes that link the operating system's zlib, which the
 * installers do not ship: python-build-standalone's macOS builds, whose
 * metadata has every zlib user link `z` with system: true (their libpython
 * links /usr/lib/libz.1.dylib), and whose licence records list no zlib under
 * `unlisted`. Every other target carries a zlib of its own.
 */
const SYSTEM_ZLIB = /^darwin-/

/**
 * The zlib each Python runtime carries, read from its licence record
 * (`python.targets.<target>.licences.unlisted["LICENSE.zlib.txt"].library`,
 * which says "zlib <version>, from ..."), as `{ path, version }`. A record
 * the watch cannot read a version from throws, and so does a target that
 * carries its own zlib with no record of it: were python-build-standalone's
 * metadata to name zlib, the record would go, and the pins record nothing
 * of the metadata the watch could read its version from instead.
 */
function runtimeZlibs(pins) {
  const targets = pins.python?.targets
  const found = []
  if (targets === null || typeof targets !== 'object') return found
  for (const [target, entry] of Object.entries(targets)) {
    const unlisted = entry?.licences?.unlisted
    if (!Object.hasOwn(unlisted ?? {}, 'LICENSE.zlib.txt')) {
      if (SYSTEM_ZLIB.test(target)) continue
      throw new Error(
        `vendor/pins.json's python.targets.${target} carries a zlib of its own, and its licence record names none (unlisted["LICENSE.zlib.txt"]): teach the watch where its version is recorded now`,
      )
    }
    const library = unlisted['LICENSE.zlib.txt']?.library
    const match = typeof library === 'string' ? /^zlib (\d+(?:\.\d+)+),/.exec(library) : null
    if (match === null) {
      throw new Error(
        `vendor/pins.json's python.targets.${target} records its zlib as ${JSON.stringify(library)}, which names no version the watch can read`,
      )
    }
    found.push({ path: `python.targets.${target}.licences (LICENSE.zlib.txt)`, version: match[1] })
  }
  return found
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
  const unknown = unknownPins(pins)
  if (unknown.length > 0) {
    throw new Error(
      `vendor/pins.json names ${unknown.join(', ')}, which the watch does not read: add it to PINS_SHAPE, and with it a query in watchList or, where none can be made, a line in UNWATCHED saying why; where it holds no component, PINS_SHAPE alone`,
    )
  }
  const configured = ffmpegConfigure(pins)
  if (configured.length > 0) {
    throw new Error(
      `vendor/pins.json builds FFmpeg with ${configured.join(', ')}, which could link a library the watch does not ask about: an option of FFMPEG_REQUIRED goes back on the line, a library linked by hand goes through its own --enable- option, and an --enable- option goes into FFMPEG_ENABLES, a library's with a query for it in watchList or, where none can be made, a line in UNWATCHED saying why`,
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
  const zlibs = ['ffmpeg.zlib.version', 'loom_windows_static.zlib.version'].map((path) => ({
    path,
    version: pinned(pins, path),
  }))
  zlibs.push(...runtimeZlibs(pins))
  for (const { path, version } of zlibs) {
    add({
      component: 'zlib',
      version,
      from: [path],
      query: git('https://github.com/madler/zlib', `v${version}`),
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

/** The CVE ids whose records rate `record`: its own id where it is one, then every CVE alias. */
export function cveIdsOf(record) {
  const pattern = /^CVE-\d{4}-\d{4,}$/
  const ids = [record?.id, ...(Array.isArray(record?.aliases) ? record.aliases : [])]
  return [...new Set(ids.filter((id) => typeof id === 'string' && pattern.test(id)))]
}

/** Every rating a CVE record gives, as `{ vector, rating }`: its CNA's and every ADP's. */
function recordRatings(cveRecord) {
  const adp = cveRecord?.containers?.adp
  const containers = [cveRecord?.containers?.cna, ...(Array.isArray(adp) ? adp : [])]
  const found = []
  for (const container of containers) {
    const metrics = Array.isArray(container?.metrics) ? container.metrics : []
    for (const metric of metrics) {
      for (const value of Object.values(metric ?? {})) {
        const rating =
          typeof value?.baseSeverity === 'string'
            ? RATINGS[value.baseSeverity.toUpperCase()]
            : undefined
        if (rating !== undefined) found.push({ vector: value.vectorString, rating })
      }
    }
  }
  return found
}

/** The highest of `ratings` (`{ rating, ... }`), or undefined for none. */
const highest = (ratings) =>
  ratings.reduce((a, b) => (a === undefined || RANK[b.rating] > RANK[a.rating] ? b : a), undefined)

/**
 * The rating OSV's severity for `record` carries, as `{ rating, by }`, read
 * against `cves`, the CVE records of `cveIdsOf(record)` by id (null for one
 * that could not be found). For a CVSS vector, the highest rating any of
 * those records gives that very vector, its CNA's or an ADP's; else the
 * database's own word in OSV's record. Where OSV gives no severity (the
 * PSF's own ids), the highest rating any of them gives, so an id that OSV
 * returns under the PSF's id alone is still held to the CVE's budget, and
 * "unrated" only where it has no CVE alias at all. Where something should
 * rate it and nothing does, `{ rating: null, why }`: a vector no record
 * names, or an alias whose record is missing, rejected or unscored.
 */
export function sourceRating(record, cves = {}) {
  const given = osvSeverity(record)
  const read = cveIdsOf(record).map((id) => ({ id, ratings: recordRatings(cves[id] ?? null) }))
  if (given === null) {
    if (read.length === 0) return { rating: 'unrated', by: 'OSV' }
    const unread = read.filter((r) => r.ratings.length === 0).map((r) => r.id)
    if (unread.length > 0) {
      return {
        rating: null,
        why: `OSV gives no severity, and no CVE record rates its alias ${unread.join(', ')} (missing, rejected or unscored)`,
      }
    }
    const best = highest(read.map((r) => ({ id: r.id, rating: highest(r.ratings).rating })))
    return { rating: best.rating, by: `the CVE record of its alias ${best.id}` }
  }
  if (given.startsWith('CVSS:')) {
    const named = highest(read.flatMap((r) => r.ratings.filter((x) => x.vector === given)))
    if (named !== undefined) return { rating: named.rating, by: 'the CVE record' }
  }
  const own = record?.database_specific?.severity
  const rating = typeof own === 'string' ? RATINGS[own.toUpperCase()] : undefined
  if (rating !== undefined) return { rating, by: "OSV's record" }
  return given.startsWith('CVSS:')
    ? { rating: null, why: 'nothing rates the vector OSV gives (no CVE record names it)' }
    : { rating: null, why: `nothing rates the severity OSV gives, ${given}` }
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

/**
 * How many sentences a reason has: a full stop, ! or ? before a space and a
 * word, a digit or a quote, or before the end. A sentence may begin with a
 * name written in lower case ("requests encodes ..."); a version number or
 * a file name, with no space after its dots, ends none, and nor do "e.g.",
 * "i.e." and an "etc." a lower-case word follows.
 */
export function sentences(text) {
  return (
    String(text)
      .trim()
      .replace(/\b(?:e\.g\.|i\.e\.|etc\.(?=\s+[a-z]))/g, '')
      .match(/[.!?][)"'`]*(?=\s+[A-Za-z0-9_`"'(]|$)/g) ?? []
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

/** The fields an entry may have besides FIELDS. */
const OPTIONAL = ['due', 'rating_note']

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
      if (!FIELDS.includes(field) && !OPTIONAL.includes(field)) {
        say(`has a field "${field}" the form lacks`)
      }
    }
    for (const field of ['id', 'component', 'version', 'reason', 'rating_note']) {
      if (field in entry && (typeof entry[field] !== 'string' || entry[field].trim() === '')) {
        say(`has an empty or non-text "${field}"`)
      }
    }
    if (typeof entry.id === 'string') {
      // An id OSV returns for two components has an entry for each.
      const key = JSON.stringify([entry.id, entry.component, entry.version])
      if (seen.has(key)) say('is triaged twice')
      seen.add(key)
    }
    if ('severity' in entry && !SEVERITIES.includes(entry.severity)) {
      say(`has severity ${JSON.stringify(entry.severity)}, not one of ${SEVERITIES.join(', ')}`)
    }
    if ('osv_severity' in entry) {
      const given = entry.osv_severity
      if (given !== null && (typeof given !== 'string' || given === '')) {
        say('has an "osv_severity" that is neither null nor text')
      } else if (given !== null && entry.severity === 'unrated') {
        // Where OSV gives none, the rating is its CVE alias's, else "unrated".
        say('is "unrated" although OSV gives it a severity: rate it from that')
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

/**
 * Why an entry's rating, read against the rating its source gives (`source`,
 * from `sourceRating`), needs a `rating_note` it lacks; null where it needs
 * none. A rating at or above the source's needs no note: the budget it buys
 * is no longer than the source's. Where nothing rates it, every rating does.
 */
export function unexplainedRating(entry, source) {
  if ('rating_note' in entry) return null
  if (source.rating === null) return `${source.why}: rate it, and say how in "rating_note"`
  if (RANK[entry.severity] < RANK[source.rating]) {
    const held = entry.severity === 'unrated' ? 'held as unrated' : `rated ${entry.severity}`
    return `${held}, below the ${source.rating} ${source.by} gives, and no "rating_note" says why`
  }
  return null
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
 * for `watch[i]`; `details` each id's record; `ratings` each id's rating from
 * `sourceRating`. Every component an id is returned for lands in exactly one
 * of untriaged, overdue, open or closed, judged by the entry for that id,
 * component and version; every entry whose id OSV no longer returns for its
 * component lands in dropped.
 */
export function judge({ watch, returned, details, ratings = {}, triage, today }) {
  const triaged = new Map()
  for (const entry of triage.entries) {
    if (!triaged.has(entry.id)) triaged.set(entry.id, [])
    triaged.get(entry.id).push(entry)
  }
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
    const record = details[id] ?? {}
    const rated = osvSeverity(record)
    const entries = triaged.get(id) ?? []
    for (const match of found.get(id)) {
      const where = `${match.component} ${match.version}`
      const entry = entries.find(
        (e) => e.component === match.component && e.version === match.version,
      )
      let note
      if (entries.length === 0) {
        note = 'not in the triage'
      } else if (entry === undefined) {
        const same = entries.find((e) => e.component === match.component)
        note =
          same !== undefined
            ? `triaged at ${same.component} ${same.version}, now returned for ${where}`
            : `triaged for ${entries.map((e) => e.component).join(', ')}, now returned for ${where}`
      } else if (entry.osv_severity !== rated) {
        note = `triaged as ${entry.osv_severity ?? 'unrated'}, OSV now gives ${rated ?? 'unrated'}`
      } else {
        note = unexplainedRating(entry, ratings[id] ?? sourceRating(record))
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
  }
  const dropped = triage.entries
    .filter((entry) => !(found.get(entry.id) ?? []).some((m) => m.component === entry.component))
    .map((entry) => ({ id: entry.id, entry }))
  return { untriaged, overdue, open, closed, dropped, returned: found.size }
}

/**
 * Whether a judgement fails the run: an id untriaged or overdue, or a
 * triaged id OSV no longer returns. The last is most often a fix, whose
 * entry comes out of the triage; but OSV answering part of what it used to
 * looks the same, and a run that passed over it would call clean an answer
 * it could not vouch for.
 */
export function failed(judgement) {
  return (
    judgement.untriaged.length > 0 || judgement.overdue.length > 0 || judgement.dropped.length > 0
  )
}

/**
 * Why OSV's answer cannot be trusted, each as a sentence; empty where it
 * can. A canary that no longer returns its id means OSV matches that kind of
 * query otherwise now; a query that returns nothing at all for a component
 * and version the triage holds entries for means its ids went at once, which
 * a fix does not do between two weekly runs and a broken answer does. Were
 * they really gone, their entries come out of the triage and the run passes.
 */
export function distrust({ watch, returned, triage, canaries = [], heard = [] }) {
  const doubts = []
  canaries.forEach((canary, index) => {
    if (!(heard[index] ?? []).includes(canary.expect)) {
      doubts.push(
        `the ${canary.kind} canary (${coordinates(canary.query)}) no longer returns ${canary.expect}, so OSV's matching for that kind of query has changed`,
      )
    }
  })
  watch.forEach((asked, index) => {
    if ((returned[index] ?? []).length > 0) return
    const held = triage.entries.filter(
      (e) => e.component === asked.component && e.version === asked.version,
    ).length
    if (held > 0) {
      doubts.push(
        `OSV returned no id for ${asked.component} ${asked.version}, which the triage holds ${held} for; if they are really gone, take their entries out of the triage`,
      )
    }
  })
  return doubts
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
export function report({ judgement, watch, returned, today, triaged, canaries = [], heard = [] }) {
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
  out.push('### Canaries\n')
  out.push(
    table(
      ['Kind', 'Asked as', 'Must return', 'Ids'],
      canaries.map((c, i) => [
        c.kind,
        coordinates(c.query),
        c.expect,
        String((heard[i] ?? []).length),
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
      ? `**Failed:** ${judgement.untriaged.length} untriaged, ${judgement.overdue.length} past their due date, ${judgement.dropped.length} no longer returned. Triage each new id in vendor/vuln-triage.json, and take out the entry of each one no longer returned once its advisory or the pin shows why (SECURITY.md says how).\n`
      : '**Clean:** every id OSV returns is triaged, no open one is past its due date, and OSV still returns every triaged id.\n',
  )
  return out.join('\n')
}

// ---- the network ---------------------------------------------------------

/** OSV could not be asked, or answered something that cannot be read. */
export class OsvUnavailable extends Error {
  lead = 'OSV could not be asked'
}

/** A CVE record could not be read. */
export class CveUnavailable extends OsvUnavailable {
  lead = 'The CVE records could not be read'
}

/**
 * One request, its JSON answer, or OsvUnavailable (`Failure`). It is given
 * `limits.timeoutMs`, or what is left of the run's deadline where that is
 * less, and the limit holds even against a fetch that ignores its signal.
 * With `missingOk`, a 404 is null.
 */
async function call(
  fetchImpl,
  url,
  init,
  limits,
  what,
  { missingOk = false, Failure = OsvUnavailable } = {},
) {
  const left = limits.deadline - Date.now()
  if (left <= 0) {
    throw new Failure(`${what}: the run's own deadline of ${limits.deadlineMs} ms passed first`)
  }
  const wait = Math.min(limits.timeoutMs, left)
  const bound =
    wait < limits.timeoutMs ? `the run's own deadline of ${limits.deadlineMs} ms` : `${wait} ms`
  const controller = new globalThis.AbortController()
  let timer
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      // Rejected first, so the race reports the limit, not the abort.
      reject(new Failure(`${what}: no answer within ${bound}`))
      controller.abort()
    }, wait)
  })
  // The races below see the rejection; this keeps one nobody awaits from
  // being an unhandled rejection.
  expired.catch(() => undefined)
  try {
    let response
    try {
      response = await Promise.race([
        fetchImpl(url, { ...init, signal: controller.signal }),
        expired,
      ])
    } catch (error) {
      if (error instanceof OsvUnavailable) throw error
      throw new Failure(`${what}: ${error?.message ?? error}`)
    }
    if (missingOk && response?.status === 404) return null
    if (!response || !response.ok) {
      throw new Failure(`${what}: HTTP ${response?.status ?? 'no response'}`)
    }
    try {
      return await Promise.race([response.json(), expired])
    } catch (error) {
      if (error instanceof OsvUnavailable) throw error
      throw new Failure(`${what}: the answer is not JSON (${error?.message ?? error})`)
    }
  } finally {
    clearTimeout(timer)
  }
}

/** `run` over `items`, `DETAIL_CONCURRENCY` at a time. */
async function inBatches(items, run) {
  for (let at = 0; at < items.length; at += DETAIL_CONCURRENCY) {
    await Promise.all(items.slice(at, at + DETAIL_CONCURRENCY).map(run))
  }
}

/**
 * OSV's answer for every query, `{ returned, details, ratings, heard }`:
 * `returned[i]` the ids for `watch[i]`, `details` each id's full record,
 * `ratings` each id's rating (`sourceRating`, over the CVE record where its
 * vector needs one), `heard[i]` the ids for `canaries[i]`, which are asked
 * beside the components and not read further. Throws OsvUnavailable on any
 * failure to ask or to read an answer, or at the run's deadline, never a
 * partial result.
 */
export async function fetchOsv(
  watch,
  { fetch: fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS, deadlineMs = RUN_DEADLINE_MS, canaries = [] },
) {
  const limits = { timeoutMs, deadlineMs, deadline: Date.now() + deadlineMs }
  const asked = [...watch.map((w) => w.query), ...canaries.map((c) => c.query)]
  const found = asked.map(() => [])
  let pending = asked.map((_, index) => ({ index, token: null }))
  for (let round = 0; pending.length > 0; round += 1) {
    if (round >= MAX_PAGES) {
      throw new OsvUnavailable(`querybatch was still paging after ${MAX_PAGES} rounds`)
    }
    const queries = pending.map(({ index, token }) =>
      token === null ? asked[index] : { ...asked[index], page_token: token },
    )
    const answer = await call(
      fetchImpl,
      `${OSV_API}/v1/querybatch`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ queries }),
      },
      limits,
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
        if (!SAFE_ID.test(vuln.id) || vuln.id === '.' || vuln.id === '..') {
          throw new OsvUnavailable(
            `querybatch answered the id ${JSON.stringify(vuln.id)}, which the watch will not put in a URL`,
          )
        }
        if (!found[index].includes(vuln.id)) found[index].push(vuln.id)
      }
      if (typeof result?.next_page_token === 'string' && result.next_page_token !== '') {
        next.push({ index, token: result.next_page_token })
      }
    })
    pending = next
  }
  const returned = found.slice(0, watch.length)
  const heard = found.slice(watch.length)
  const ids = [...new Set(returned.flat())].sort()
  const details = {}
  await inBatches(ids, async (id) => {
    const record = await call(
      fetchImpl,
      `${OSV_API}/v1/vulns/${encodeURIComponent(id)}`,
      { method: 'GET' },
      limits,
      `vulns/${id}`,
    )
    if (record?.id !== id) {
      throw new OsvUnavailable(`vulns/${id} answered a record for ${record?.id ?? 'nothing'}`)
    }
    details[id] = record
  })
  // The CVE records each id is rated from, its own and every alias's, for
  // a vector OSV gives, or for an id OSV gives no severity at all.
  const rateFrom = new Map()
  for (const id of ids) {
    const given = osvSeverity(details[id])
    if (given === null || given.startsWith('CVSS:')) rateFrom.set(id, cveIdsOf(details[id]))
  }
  const cveRecords = new Map()
  await inBatches([...new Set([...rateFrom.values()].flat())].sort(), async (cve) => {
    const cveRecord = await call(
      fetchImpl,
      `${CVE_API}/${cve}`,
      { method: 'GET' },
      limits,
      `the CVE record ${cve}`,
      { missingOk: true, Failure: CveUnavailable },
    )
    if (cveRecord !== null && cveRecord?.cveMetadata?.cveId !== cve) {
      throw new CveUnavailable(
        `the CVE record ${cve} answered for ${cveRecord?.cveMetadata?.cveId ?? 'nothing'}`,
      )
    }
    cveRecords.set(cve, cveRecord)
  })
  const ratings = {}
  for (const id of ids) {
    const cves = (rateFrom.get(id) ?? []).map((cve) => [cve, cveRecords.get(cve) ?? null])
    ratings[id] = sourceRating(details[id], Object.fromEntries(cves))
  }
  return { returned, details, ratings, heard }
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
 * The command, with the network, the clock and the limits handed in so a
 * test can run it whole. Resolves to the exit status.
 */
export async function main(argv, io = {}) {
  const out = io.out ?? process.stdout
  const err = io.err ?? process.stderr
  const fetchImpl = io.fetch ?? globalThis.fetch
  const today = io.today ?? new Date().toISOString().slice(0, 10)
  const canaries = io.canaries ?? CANARIES
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
  const refuse = (lead, why) => {
    const text =
      `## Vulnerability watch, ${today}\n\n**${lead}:** ${why}. ` +
      'Nothing was judged, so this run says nothing about whether the components are clean.\n'
    err.write(text)
    summarise(text)
    return EXIT.unreachable
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
    answer = await fetchOsv(watch, {
      fetch: fetchImpl,
      timeoutMs: io.timeoutMs,
      deadlineMs: io.deadlineMs,
      canaries,
    })
  } catch (error) {
    if (!(error instanceof OsvUnavailable)) throw error
    return refuse(error.lead, error.message)
  }
  const doubts = distrust({ watch, ...answer, triage, canaries })
  if (doubts.length > 0) return refuse("OSV's answer cannot be trusted", doubts.join('; '))
  const judgement = judge({ watch, ...answer, triage, today })
  const text = report({
    judgement,
    watch,
    returned: answer.returned,
    today,
    triaged: triage.entries.length,
    canaries,
    heard: answer.heard,
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
