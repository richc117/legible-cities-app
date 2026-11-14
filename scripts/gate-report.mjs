// One Markdown page for the gate issue, from a candidate's run ids (issue
// 693; docs/releasing.md, "The gate").
//
//   node scripts/gate-report.mjs --tag vX.Y.Z-rc.N --build <build.yml run id> \
//     --acceptance <acceptance.yml run id> [--sitting <issue number or url>] \
//     [--review <issue, comment or record url>] [--out <file>]
//
// The page has one section for each part the gate names: the build, the
// automated run on each system (both always shown), the scripted VoiceOver
// run, the assistant's visual review, the sitting, Windows as a beta; then
// Failures and Not recorded. It judges nothing the records do not already
// say: a result is copied as the record wrote it, a row still "not
// automated" is listed as it stands, and a part with no record reads "not
// recorded" and is named under Not recorded, never counted as a pass. A
// failure is a build or acceptance job that is not a success, a step whose
// result is not one the checklist counts as a pass or as not automated, a
// short or missing step row, a missing system, or a verdict that is not
// `looks right`, `looks wrong` or `cannot tell` (or is `looks wrong`). The
// issue numbers in a failure's notes are only mentioned: the run writes the
// record before a person files the failure, so none is taken as its issue.
//
// It refuses, in one sentence and a non-zero exit, before downloading
// anything: a rehearsal's run (artefacts named rehearsal-*, or a title that
// says so), a run of the wrong workflow, an acceptance run whose title is
// not `acceptance <tag>` (a bare `acceptance`, from before the title named
// the tag, only on a record that names it), a build run that is not the push
// of the tag at the tag's commit, and a build whose `release (draft)` job did
// not succeed. Then, from the records: a rehearsal's record, a record that
// is not an acceptance record, one that names another tag.
//
// Everything that decides or renders is an exported function the unit test
// calls (tests/unit/gate-report.test.ts); only `main` runs `gh`, with
// argument arrays and a timeout, into a fresh temporary folder it removes.
// Records are read with tests/acceptance/pure.mjs's own `recordKind` and
// `requireCandidateRecord`, the check `record-cli.mjs candidate` makes.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  cell,
  recordKind,
  redact,
  requireCandidateRecord,
  RESULTS,
} from '../tests/acceptance/pure.mjs'

export const REPO = 'richc117/legible-cities-app'
export const REPO_URL = `https://github.com/${REPO}`
export const VERDICTS = ['looks right', 'looks wrong', 'cannot tell']
/** The build.yml jobs docs/releasing.md names beside the packages. */
export const BUILD_JOBS = ['release (draft)', 'attest (provenance)', 'verify (attestations)']
/** The two systems the automated run covers; both are always on the page. */
export const SYSTEMS = ['darwin-arm64', 'win-x64']
/** The results that are not failures: every result the checklist has but these two. */
export const NOT_FAILURES = RESULTS.filter((r) => r !== 'fail' && r !== 'not run')
const TAG = /^v[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$/

/** A run, read with `gh run view <id> --json ...`, as the page needs it. */
export function parseRun(json) {
  if (json === null || typeof json !== 'object') throw new Error('a run could not be read')
  const id = String(json.databaseId ?? '')
  if (!/^[0-9]+$/.test(id)) throw new Error('a run has no id')
  return {
    id,
    url:
      typeof json.url === 'string' && json.url !== '' ? json.url : `${REPO_URL}/actions/runs/${id}`,
    workflow: String(json.workflowName ?? ''),
    title: String(json.displayTitle ?? ''),
    event: String(json.event ?? ''),
    branch: String(json.headBranch ?? ''),
    commit: String(json.headSha ?? ''),
    conclusion: String(json.conclusion || json.status || 'not finished'),
    jobs: (json.jobs ?? []).map((job) => ({
      name: String(job.name),
      conclusion: String(job.conclusion || job.status || 'not finished'),
      url: typeof job.url === 'string' ? job.url : '',
    })),
  }
}

/** One table row's cells, a `\|` inside a cell kept as a pipe. */
export function splitRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split(/(?<!\\)\|/).map((part) => part.replace(/\\\|/g, '|').trim())
}

/** The numbers of the issues a text names: `issue 12`, `issues 12` or an issues link; never a bare `#12`, which a colour or a hash can be. */
export function issuesNamed(text) {
  const found = new Set()
  for (const match of String(text).matchAll(/(?:\/issues\/|\bissues? )(\d+)\b/gi)) {
    found.add(Number(match[1]))
  }
  return [...found]
}

function section(markdown, heading) {
  const start = markdown.search(new RegExp(`^## ${heading}\\s*$`, 'm'))
  if (start < 0) return ''
  const rest = markdown.slice(start).split('\n').slice(1)
  const end = rest.findIndex((line) => /^## /.test(line))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}

const dataRows = (text) =>
  text
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|[\s|:-]+\|?$/.test(line.trim()))
    .map(splitRow)

/** A record as the page reads it: its kind, the run table, the steps, the visual verdicts. */
export function parseRecord(markdown) {
  const md = markdown.replace(/\r\n/g, '\n')
  const fields = new Map()
  for (const [name, value] of dataRows(section(md, 'Acceptance run')).filter(
    (r) => r.length === 2,
  )) {
    if (name !== '') fields.set(name, value)
  }
  const steps = dataRows(section(md, 'Steps'))
    .filter((row) => /^[0-9]+$/.test(row[0]))
    .map(([n, title = '', result = '', ...notes]) => ({
      n: Number(n),
      title,
      result,
      notes: notes.join(' | '),
      short: notes.length === 0,
    }))
  const evidence = dataRows(section(md, 'Visual evidence'))
    .slice(1)
    .filter((row) => row.length >= 3 && !row[0].startsWith('('))
    .map(([entry, visible, verdict]) => ({
      entry,
      visible,
      // A blank cell or the template's own "a / b / c" is not yet a verdict.
      verdict: verdict === '' || verdict.includes(' / ') ? null : verdict,
    }))
  const tag = /The release under test: (v[0-9][^\s,;]*?)\.?\s*$/m.exec(md)
  return { kind: recordKind(md), fields, steps, evidence, tag: tag === null ? null : tag[1] }
}

/** A system's name from its artefact: acceptance-darwin-arm64 is darwin-arm64. */
export const targetOf = (artefact) =>
  /^(?:rehearsal-)?acceptance-(?!evidence)(.+)$/.exec(artefact)?.[1] ?? null

/** An issue number or a link into this repository, as a link into it; else a sentence. */
export function repoLink(value, kind = 'issues') {
  const text = String(value).trim()
  if (/^[0-9]+$/.test(text)) return `${REPO_URL}/${kind}/${text}`
  if (text.startsWith(`${REPO_URL}/`) && !/\s/.test(text)) return text
  throw new Error(`${text} is neither an issue number nor a link into ${REPO_URL}`)
}

export function refuseRehearsal(acceptance, artefacts) {
  const said = `acceptance run ${acceptance.id} is a rehearsal's, not a candidate's run`
  if (artefacts.some((name) => name.startsWith('rehearsal-'))) {
    throw new Error(`${said}: its artefacts are named rehearsal-*`)
  }
  if (/REHEARSAL/.test(acceptance.title)) {
    throw new Error(`${said}: its title says REHEARSAL`)
  }
}

/**
 * The model of the page, or the sentence refusing it. `records` maps a
 * system to its record's text; `artefacts` is every artefact name the
 * acceptance run kept; `tagCommit` is the commit the tag names.
 */
export function refuseRun({ tag, build, acceptance, tagCommit, artefacts }) {
  if (!TAG.test(tag)) throw new Error(`${tag} is neither v<X.Y.Z> nor v<X.Y.Z>-rc.<N>`)
  refuseRehearsal(acceptance, artefacts)
  if (build.workflow !== 'build') {
    throw new Error(`run ${build.id} is of the workflow "${build.workflow}", not build`)
  }
  if (acceptance.workflow !== 'acceptance') {
    throw new Error(
      `run ${acceptance.id} is of the workflow "${acceptance.workflow}", not acceptance`,
    )
  }
  if (acceptance.title !== `acceptance ${tag}` && acceptance.title !== 'acceptance') {
    throw new Error(
      `acceptance run ${acceptance.id} is titled "${acceptance.title}", not "acceptance ${tag}"`,
    )
  }
  if (build.commit === '' || build.commit !== tagCommit) {
    throw new Error(
      `build run ${build.id} was of commit ${build.commit.slice(0, 7) || 'none'}, not ${tag}'s commit ${String(tagCommit).slice(0, 7)}`,
    )
  }
  if (build.branch !== tag || build.event !== 'push') {
    throw new Error(
      `build run ${build.id} is not the push of ${tag} (it is ${build.event} on ${build.branch})`,
    )
  }
  const draft = build.jobs.find((job) => job.name === 'release (draft)')
  if (draft?.conclusion !== 'success') {
    throw new Error(
      `build run ${build.id} did not draft a release: release (draft) is ${draft?.conclusion ?? 'absent'}, and only a tag push runs it`,
    )
  }
}

export function assemble({ tag, build, acceptance, tagCommit, artefacts, records, links = {} }) {
  refuseRun({ tag, build, acceptance, tagCommit, artefacts })
  const parsed = new Map()
  for (const [target, text] of records) {
    if (recordKind(text) === 'rehearsal') {
      throw new Error(
        `acceptance run ${acceptance.id} is a rehearsal's: its ${target} record is headed REHEARSAL`,
      )
    }
    requireCandidateRecord(text)
    const record = parseRecord(text)
    if (record.tag !== tag) {
      throw new Error(
        `the ${target} record of acceptance run ${acceptance.id} says ${record.tag ?? 'no tag'}, not ${tag}`,
      )
    }
    parsed.set(target, record)
  }
  // acceptance.yml's run-name is `acceptance <tag>`. A run from before that
  // is titled `acceptance` alone, and is taken only on its records' word.
  if (acceptance.title === 'acceptance' && parsed.size === 0) {
    throw new Error(
      `acceptance run ${acceptance.id} is titled "acceptance" and has no record to say which tag it is of`,
    )
  }
  return {
    tag,
    build,
    acceptance,
    links,
    records: parsed,
    artefacts,
    targets: [...new Set([...SYSTEMS, ...parsed.keys()])].sort(),
  }
}

/** The artefact names of `gh api --paginate --jq '[...names]'`, one array a page. */
export function mergeArtefactPages(text) {
  const names = text
    .trim()
    .split(/(?<=\])\s*(?=\[)/)
    .flatMap((page) => JSON.parse(page))
  if (names.some((n) => typeof n !== 'string')) {
    throw new Error('the artefact list is not a list of names')
  }
  return names
}

const notAutomated = (step) =>
  /not automated/i.test(step.result) || /not automated/i.test(step.notes)
const ISSUES = (text) => {
  const found = issuesNamed(text)
  return found.length === 0
    ? 'no issue named'
    : `its notes mention ${found.map((n) => `[#${n}](${REPO_URL}/issues/${n})`).join(', ')}`
}

/** The page. */
export function renderReport(model) {
  const { tag, build, acceptance, links, records, artefacts, targets } = model
  const out = []
  const failures = []
  const missing = []
  const line = (text = '') => out.push(text)
  const jobLink = (job) => (job.url === '' ? job.name : `[${job.name}](${job.url})`)

  line(`## Gate report for ${tag}`)
  line()
  line(
    `Written by \`scripts/gate-report.mjs\` from [the build run](${build.url}) and [the acceptance run](${acceptance.url}). It copies what the records say and judges nothing; a part with no record reads "not recorded", which is not a pass.`,
  )
  line()

  line('### The build')
  line()
  line(
    `[Run ${build.id}](${build.url}), the push of ${tag}, commit \`${build.commit.slice(0, 7)}\`, the tag's own. Run ${build.conclusion}.`,
  )
  line()
  line('| Job | Conclusion |')
  line('|---|---|')
  for (const job of build.jobs) line(`| ${cell(jobLink(job))} | ${cell(job.conclusion)} |`)
  for (const name of BUILD_JOBS) {
    if (!build.jobs.some((job) => job.name === name)) {
      line(`| ${name} | not recorded |`)
      missing.push(`build job ${name}`)
    }
  }
  for (const job of build.jobs) {
    if (job.conclusion !== 'success') {
      failures.push(`build job ${job.name}: ${job.conclusion}; no issue named`)
    }
  }
  for (const name of BUILD_JOBS) {
    if (!build.jobs.some((job) => job.name === name)) {
      failures.push(`build job ${name}: not recorded; no issue named`)
    }
  }
  line()

  line('### The automated run')
  line()
  line(`[Run ${acceptance.id}](${acceptance.url}).`)
  for (const target of targets) {
    const job = acceptance.jobs.find((j) => j.name === `acceptance (${target})`)
    const record = records.get(target)
    line()
    line(`#### ${target}`)
    line()
    line(`Job: ${job === undefined ? 'not recorded' : `${jobLink(job)}, ${job.conclusion}`}.`)
    if (job === undefined) {
      failures.push(`acceptance job ${target}: not recorded; no issue named`)
      missing.push(`acceptance job ${target}`)
    } else if (job.conclusion !== 'success') {
      failures.push(`acceptance job ${target}: ${job.conclusion}; no issue named`)
    }
    if (record === undefined) {
      line('Record: not recorded.')
      failures.push(`${target} record: not recorded; no issue named`)
      missing.push(`${target} record`)
      continue
    }
    line("Record: a candidate's record, as the `candidate` check of `record-cli.mjs` reads it.")
    for (const key of [
      'App version',
      'Engine version',
      'OS and version',
      'Matches SHA256SUMS.txt?',
      'Attestation verified?',
    ]) {
      if (record.fields.has(key)) line(`- ${key}: ${cell(record.fields.get(key))}`)
    }
    line()
    line('| # | Step | Result |')
    line('|---|---|---|')
    for (const step of record.steps)
      line(`| ${step.n} | ${cell(step.title)} | ${cell(step.result)} |`)
    const open = record.steps.filter(notAutomated)
    line()
    line(`Still not automated, as the record says (${open.length}):`)
    for (const step of open) line(`- ${step.n}. ${step.title}: ${step.result}`)
    for (const step of record.steps) {
      if (step.short) {
        failures.push(
          `${target} step ${step.n}, ${step.title}: the row has fewer cells than the template's`,
        )
      }
      if (!NOT_FAILURES.includes(step.result)) {
        const unknown = RESULTS.includes(step.result) ? '' : ' (not a result the checklist has)'
        failures.push(
          `${target} step ${step.n}, ${step.title}: ${step.result || 'no result'}${unknown}; ${ISSUES(step.notes)}`,
        )
      }
    }
    for (let n = 1; n <= 22; n++) {
      if (!record.steps.some((step) => step.n === n)) {
        failures.push(`${target} step ${n}: missing from the record; no issue named`)
      }
    }
  }
  line()

  line('### The scripted VoiceOver run')
  line()
  const reader = acceptance.jobs.find((j) => j.name.startsWith('reader ('))
  const transcript = artefacts.includes('reader-darwin-arm64')
  if (reader === undefined && !transcript) {
    missing.push('the scripted VoiceOver run')
    line(
      'Not recorded: this run has no reader job, so the sitting walks the VoiceOver rows by ear (docs/releasing.md).',
    )
  } else {
    line(
      `Job: ${reader === undefined ? 'not recorded' : `${jobLink(reader)}, ${reader.conclusion}`}. Transcript artefact: ${transcript ? 'kept (`reader-darwin-arm64`)' : 'not recorded'}.`,
    )
    line('What it hears is not a pass; a person reads the transcript and commits the record.')
    if (reader !== undefined && reader.conclusion !== 'success') {
      failures.push(`reader job: ${reader.conclusion}; no issue named`)
    }
  }
  line()

  line("### The assistant's visual review")
  line()
  const rows = []
  for (const target of targets)
    for (const row of records.get(target)?.evidence ?? []) rows.push([target, row])
  const kept = targets.filter((t) => artefacts.includes(`acceptance-evidence-${t}`))
  line(
    `Evidence artefacts kept: ${kept.length === 0 ? 'not recorded' : kept.map((t) => `\`acceptance-evidence-${t}\``).join(', ')}. Key artefacts kept: ${targets.some((t) => artefacts.includes(`acceptance-evidence-key-${t}`)) ? 'yes' : 'not recorded'}.`,
  )
  if (links.review !== undefined) line(`The review's record: ${links.review}`)
  if (rows.length === 0) {
    if (links.review === undefined) missing.push("the visual review's verdicts")
    line(
      links.review === undefined
        ? 'Verdicts: not recorded.'
        : "Verdicts: in the review's record linked above; this page does not read them.",
    )
  } else {
    const count = (v) => rows.filter(([, r]) => r.verdict === v).length
    line(
      `Verdicts: ${VERDICTS.map((v) => `${count(v)} ${v}`).join(', ')}, ${rows.filter(([, r]) => r.verdict === null).length} not recorded.`,
    )
    for (const [target, row] of rows) {
      if (row.verdict === 'looks wrong') {
        failures.push(`${target} evidence ${row.entry}: looks wrong; ${ISSUES(row.visible)}`)
      } else if (row.verdict !== null && !VERDICTS.includes(row.verdict)) {
        failures.push(
          `${target} evidence ${row.entry}: "${row.verdict}" is not one of ${VERDICTS.join(', ')}`,
        )
      }
    }
  }
  line()

  line('### The sitting')
  line()
  if (links.sitting === undefined) missing.push('the sitting')
  line(
    links.sitting === undefined
      ? 'Not recorded: no issue was given for it.'
      : `Recorded in ${links.sitting}. The go or no-go is on the gate issue.`,
  )
  line()

  line('### Windows')
  line()
  const winJob = acceptance.jobs.find((j) => j.name === 'acceptance (win-x64)')
  line(
    `Windows is a beta; docs/releasing.md accepts it on its automated results alone, which are win-x64 above: job ${winJob?.conclusion ?? 'not recorded'}, record ${records.has('win-x64') ? 'present' : 'not recorded'}.`,
  )
  line()

  line('### Failures')
  line()
  if (failures.length === 0) line('None recorded.')
  for (const failure of failures) line(`- ${failure}`)
  line()

  line('### Not recorded')
  line()
  if (missing.length === 0) line('Every part above has a record.')
  for (const part of missing) line(`- ${part}`)
  line()
  return redact(out.join('\n'))
}

// ---- the CLI: the only part that runs gh ----

const GH_TIMEOUT = 120_000
const gh = (args) =>
  execFileSync('gh', [...args, '-R', REPO], {
    encoding: 'utf8',
    timeout: GH_TIMEOUT,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })
const ghApi = (path, ...extra) =>
  execFileSync('gh', ['api', path, ...extra], {
    encoding: 'utf8',
    timeout: GH_TIMEOUT,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

export function parseArgs(args) {
  const out = {}
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]
    if (
      !['--tag', '--build', '--acceptance', '--sitting', '--review', '--out'].includes(name) ||
      args[i + 1] === undefined
    ) {
      throw new Error(
        `unknown or incomplete option ${name}; see the head of scripts/gate-report.mjs`,
      )
    }
    out[name.slice(2)] = args[i + 1]
  }
  if (out.tag !== undefined && !TAG.test(out.tag)) {
    throw new Error(`${out.tag} is neither v<X.Y.Z> nor v<X.Y.Z>-rc.<N>`)
  }
  for (const need of ['tag', 'build', 'acceptance']) {
    if (out[need] === undefined) throw new Error(`--${need} is required`)
  }
  for (const id of ['build', 'acceptance']) {
    if (!/^[0-9]+$/.test(out[id])) throw new Error(`--${id} takes a run id, digits only`)
  }
  return out
}

const RUN_FIELDS =
  'databaseId,workflowName,displayTitle,event,status,conclusion,headSha,headBranch,jobs,url'

function main(argv) {
  const opts = parseArgs(argv)
  const links = {}
  if (opts.sitting !== undefined) links.sitting = repoLink(opts.sitting)
  if (opts.review !== undefined) links.review = repoLink(opts.review)
  const build = parseRun(JSON.parse(gh(['run', 'view', opts.build, '--json', RUN_FIELDS])))
  const acceptance = parseRun(
    JSON.parse(gh(['run', 'view', opts.acceptance, '--json', RUN_FIELDS])),
  )
  const tagCommit = ghApi(`repos/${REPO}/commits/${opts.tag}`, '--jq', '.sha').trim()
  const artefacts = mergeArtefactPages(
    ghApi(
      `repos/${REPO}/actions/runs/${opts.acceptance}/artifacts`,
      '--paginate',
      '--jq',
      '[.artifacts[].name]',
    ),
  )
  // Refuse a wrong run, a rehearsal included, before downloading anything.
  refuseRun({ tag: opts.tag, build, acceptance, tagCommit, artefacts })
  const tmp = mkdtempSync(join(tmpdir(), 'gate-report-'))
  try {
    const records = new Map()
    for (const name of artefacts) {
      const target = targetOf(name)
      if (target === null) continue
      const dir = join(tmp, name)
      gh(['run', 'download', opts.acceptance, '--name', name, '--dir', dir])
      const file = readdirSync(dir).find((f) => /^acceptance-.*\.md$/.test(f))
      if (file !== undefined) records.set(target, readFileSync(join(dir, file), 'utf8'))
    }
    const page = renderReport(
      assemble({ tag: opts.tag, build, acceptance, tagCommit, artefacts, records, links }),
    )
    if (opts.out === undefined) process.stdout.write(`${page}\n`)
    else writeFileSync(opts.out, `${page}\n`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    const first = (t) =>
      String(t ?? '')
        .split('\n')
        .find((l) => l.trim() !== '') ?? ''
    const said = first(error?.stderr)
    process.stderr.write(
      `gate-report: ${redact(first(text))}${said === '' ? '' : `: ${redact(said.trim())}`}\n`,
    )
    process.exitCode = 1
  }
}
