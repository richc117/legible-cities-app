// The acceptance workflow's side of the record (A6-04): what steps 1, 2 and
// 21 found, written where tests/acceptance/acceptance.spec.ts reads it or
// into the record it wrote. Node only, no dependency, so a job can run it
// before `npm ci` has finished anything else.
//
//   node tests/acceptance/record-cli.mjs sha256 <file>
//   node tests/acceptance/record-cli.mjs sums <SHA256SUMS.txt> <name>
//   node tests/acceptance/record-cli.mjs prior <prior.json> field <name> <value>
//   node tests/acceptance/record-cli.mjs prior <prior.json> step <n> <result> <notes>
//   node tests/acceptance/record-cli.mjs fill <record.md> <n> <result> <notes>
//   node tests/acceptance/record-cli.mjs leftovers <made.json> <record.md> [<install folder>]
//
// `leftovers` is step 21 after the uninstall: every place install.md's
// tables name for this system, the folders the spec made, and a shallow
// search for anything else named for the app, each written into the record.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fillStep, parseSums, redact, RESULTS } from './pure.mjs'

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** A JSON file's object, or `fallback` when it is not there or not JSON. */
function readJson(path, fallback = {}) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

/** A record the spec wrote, or a sentence saying it did not. */
function readRecord(path) {
  if (!existsSync(path)) {
    throw new Error(
      `there is no record at ${path}: the spec did not write one, so step 21 has nowhere to go`,
    )
  }
  return readFileSync(path, 'utf8')
}

/** Every place install.md names for this system, and whether each is there. */
function installPlaces(installFolder) {
  const home = homedir()
  if (process.platform === 'darwin') {
    return [
      ['/Applications/Legible Cities.app', false],
      [join(home, 'Library', 'Application Support', 'Legible Cities'), false],
      [join(home, 'Library', 'Logs', 'Legible Cities'), false],
      [join(home, 'Library', 'Preferences', 'com.richardcaballero.legiblecities.plist'), true],
      [
        join(
          home,
          'Library',
          'Saved Application State',
          'com.richardcaballero.legiblecities.savedState',
        ),
        true,
      ],
      ...(installFolder ? [[installFolder, false]] : []),
    ]
  }
  const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
  const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
  return [
    [installFolder || join(local, 'Programs', 'legible-cities-app'), false],
    [join(appData, 'Legible Cities'), false],
    [join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Legible Cities.lnk'), false],
    [join(home, 'Desktop', 'Legible Cities.lnk'), false],
    [join(home, 'OneDrive', 'Desktop', 'Legible Cities.lnk'), false],
  ]
}

/** Anything else named for the app, one or two levels down from where apps keep things. */
function namedForTheApp() {
  const home = homedir()
  const roots =
    process.platform === 'darwin'
      ? [
          join(home, 'Library'),
          join(home, 'Library', 'Application Support'),
          join(home, 'Library', 'Caches'),
          join(home, 'Library', 'Preferences'),
          join(home, 'Library', 'Saved Application State'),
          join(home, 'Library', 'Logs'),
          '/Applications',
        ]
      : [
          process.env.APPDATA ?? join(home, 'AppData', 'Roaming'),
          process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'),
          join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Programs'),
        ]
  const pattern = /legible.?cities|legiblecities/i
  const found = []
  for (const root of roots) {
    let names
    try {
      names = readdirSync(root)
    } catch {
      continue
    }
    for (const name of names) if (pattern.test(name)) found.push(join(root, name))
  }
  if (process.platform === 'win32') {
    const reg = spawnSync(
      'reg',
      [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        '/s',
        '/f',
        'Legible Cities',
        '/d',
      ],
      { encoding: 'utf8', timeout: 60_000, windowsHide: true },
    )
    for (const line of (reg.stdout ?? '').split(/\r?\n/)) {
      if (/^HKEY_/.test(line.trim())) found.push(`registry: ${line.trim()}`)
    }
  }
  return [...new Set(found)]
}

function leftovers(madePath, recordPath, installFolder) {
  const made = readJson(madePath, null)
  const problems = []
  const notes = []
  if (made === null) {
    problems.push(
      `there is no readable made.json at ${madePath}, so the profile, export folder and log files the run made could not be checked`,
    )
  }
  for (const [what, path] of [
    ['the profile the run made', made?.profile],
    ['the export folder the run made', made?.exports],
    ...(made?.logFilesMade ?? []).map((path) => ['a log file the run made', path]),
    ...(made?.logsFolderMade ? [['the log folder the run made', made.logs]] : []),
  ]) {
    if (typeof path === 'string' && path !== '' && existsSync(path))
      problems.push(`${what} is still there: ${path}`)
  }
  const named = new Set()
  for (const [path, mayStay] of installPlaces(installFolder)) {
    named.add(path.toLowerCase())
    if (!existsSync(path)) continue
    if (mayStay)
      notes.push(`${path} is there; install.md's uninstall step 3 has a person delete it`)
    else problems.push(`${path} is still there`)
  }
  for (const path of namedForTheApp()) {
    if (named.has(path.toLowerCase())) continue
    problems.push(`found, named for the app and in no table of install.md: ${path}`)
  }
  const result = problems.length === 0 ? 'pass, part not automated' : 'fail'
  const text = [
    ...problems.map((p) => `Failed: ${p}.`),
    ...notes.map((n) => `${n}.`),
    process.platform === 'win32'
      ? 'Uninstalled with the uninstaller run silently (/S), not from Settings > Apps.'
      : 'The app was deleted from the folder it was copied to; nothing was put in Applications.',
    process.platform === 'win32'
      ? 'Not automated: the Windows apps list and the Start menu as a person sees them.'
      : "Not automated: a Finder search, which is a person's.",
  ].join(' ')
  writeFileSync(recordPath, fillStep(readRecord(recordPath), 21, result, text))
  process.stdout.write(`step 21: ${result}: ${redact(text)}\n`)
  return problems.length === 0 ? 0 : 1
}

function main(args) {
  const [command, ...rest] = args
  switch (command) {
    case 'sha256':
      process.stdout.write(`${sha256(rest[0])}\n`)
      return 0
    case 'sums': {
      const [sumsPath, name] = rest
      const sum = parseSums(readFileSync(sumsPath, 'utf8')).get(name)
      if (sum !== undefined) {
        process.stdout.write(`${sum}\n`)
        return 0
      }
      process.stderr.write(`${name} has no line in ${sumsPath}\n`)
      return 1
    }
    case 'prior': {
      const [path, kind, key, ...value] = rest
      const prior = readJson(path)
      if (kind === 'field') {
        prior.fields = { ...(prior.fields ?? {}), [key]: value.join(' ') }
      } else if (kind === 'step') {
        const [result, ...notes] = value
        if (!RESULTS.includes(result)) throw new Error(`${result} is not a result`)
        prior.steps = { ...(prior.steps ?? {}), [key]: { result, notes: notes.join(' ') } }
      } else {
        throw new Error(`prior takes field or step, not ${kind}`)
      }
      writeFileSync(path, `${JSON.stringify(prior, null, 2)}\n`)
      return 0
    }
    case 'fill': {
      const [path, n, result, ...notes] = rest
      writeFileSync(path, fillStep(readRecord(path), Number(n), result, notes.join(' ')))
      return 0
    }
    case 'leftovers':
      return leftovers(rest[0], rest[1], rest[2])
    default:
      process.stderr.write(
        'usage: record-cli.mjs sha256 | sums | prior | fill | leftovers (see the head of the file)\n',
      )
      return 2
  }
}

// A failure is a sentence on standard error and an exit code, never a stack
// trace in a workflow's log.
try {
  process.exitCode = main(process.argv.slice(2))
} catch (error) {
  process.stderr.write(
    `record-cli: ${redact(error instanceof Error ? error.message : String(error))}\n`,
  )
  process.exitCode = 1
}
