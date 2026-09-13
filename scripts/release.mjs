// Draft a GitHub Release from a tag: decide whether the tag may make one,
// gather the installers and the Corresponding Source into the files a
// Release carries, write the notes from the committed template, and judge
// what is already on GitHub (specs/025-release-on-a-tag, A6-01, ADR-041).
//
//   node scripts/release.mjs decide <tag> [--main <ref>] [--remote <name>] [--run-commit <sha>] [--repo <dir>]
//   node scripts/release.mjs assemble <tag> <downloaded> <out>
//   node scripts/release.mjs notes <tag> <out-file>
//   node scripts/release.mjs existing <tag> <releases.jsonl> <assets-dir>
//   node scripts/release.mjs verify <tag> <releases.jsonl> <assets-dir>
//
// The release job in .github/workflows/build.yml runs each in turn. Every
// decision is a function the unit test calls (tests/unit/release.test.ts),
// so a tag that does not match package.json's version, a commit that is not
// on main, a missing installer and a published Release are refused by
// tested code rather than proven by pushing bad tags (SC-002). Nothing here
// talks to GitHub: the workflow's step that holds the token lists the
// Releases with `gh api` and hands the list to `existing` and `verify`, and
// does only what they answer.
//
// The rules:
//
// - A tag is `v<X.Y.Z>` or `v<X.Y.Z>-rc.<N>`, and X.Y.Z is package.json's
//   version exactly. An `-rc.N` tag drafts a prerelease. Anything else is
//   refused before anything is drafted, naming both versions.
// - The tag still names, on the remote, the commit this run built: a run
//   for a tag since moved or deleted drafts nothing. And that commit is
//   reachable from main: a Release is made only from main's history.
// - A Release is a draft, always. No `--latest`, and never published here.
//   A draft for the tag is updated in place, its assets replaced and any
//   asset this run would not attach removed, and its notes left as the
//   maintainer may have edited them; a published Release for the tag, or
//   more than one draft, is refused and left untouched.
// - The assets are the three installers, SHA256SUMS.txt over every other
//   attached file, and one archive of each GPL component's Corresponding
//   Source (ffmpeg-source, loom-source with the loom-windows-toolchain
//   record inside it, engine-source, all from vendor.yml), archived with
//   fixed owners and times.
//   Each installer artefact's manifest must have been written from this
//   run's pins, for this app version, in this run.
//
// Child processes (git, tar) are spawned with argument arrays, windowsHide
// and a timeout, and their standard error is printed on failure.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const PRODUCT = 'Legible Cities'

/** Where the workflow runs, when GITHUB_REPOSITORY does not say. */
export const DEFAULT_REPOSITORY = 'richc117/legible-cities-app'

/** The notes template, committed. */
export const NOTES_TEMPLATE = join(repoRoot, '.github', 'release-notes.md')

/** The checksum file's name on the Release. */
export const SUMS = 'SHA256SUMS.txt'

/** Git and tar are given this long; a wedged child fails the job rather than holding it. */
const CHILD_TIMEOUT_MS = 5 * 60 * 1000

const NUMBER = '(0|[1-9]\\d*)'
const VERSION = new RegExp(`^${NUMBER}\\.${NUMBER}\\.${NUMBER}$`)
const TAG = new RegExp(`^v(${NUMBER}\\.${NUMBER}\\.${NUMBER})(?:-rc\\.([1-9]\\d*))?$`)

/**
 * What a tag says: the version it is for, its release-candidate number or
 * null, and the name it gives a Release. Null for any other tag.
 *
 * @param {string} tag
 * @returns {{ version: string, rc: number | null, label: string } | null}
 */
export function parseTag(tag) {
  const match = TAG.exec(tag)
  if (match === null) return null
  const rc = match[5] === undefined ? null : Number(match[5])
  return { version: match[1], rc, label: tag.slice(1) }
}

/**
 * Whether a tag may draft a Release, and what the draft is.
 *
 * @param {object} input
 * @param {string} input.tag the tag's name, `v0.1.0` or `v0.1.0-rc.1`
 * @param {string} input.packageVersion package.json's version at the tag's commit
 * @param {boolean | string} input.onMain true when the run's commit is
 *   reachable from main, false when it is not, and a message when that
 *   could not be told
 * @param {{ run: string, remote: string | null } | string} input.tagNow the
 *   commit this run built and the commit the tag names on the remote now
 *   (null when the tag is gone from it), or a message when the remote could
 *   not be asked
 * @returns {{ ok: false, reason: string } | { ok: true, name: string, version: string, prerelease: boolean }}
 */
export function decide({ tag, packageVersion, onMain, tagNow }) {
  const parsed = parseTag(tag)
  if (parsed === null) {
    return {
      ok: false,
      reason: `the tag ${tag} is neither v<X.Y.Z> nor v<X.Y.Z>-rc.<N>, so it drafts no Release`,
    }
  }
  if (typeof packageVersion !== 'string' || !VERSION.test(packageVersion)) {
    return {
      ok: false,
      reason: `package.json's version is ${JSON.stringify(packageVersion)}, not X.Y.Z, so no tag can draft a Release from it`,
    }
  }
  if (parsed.version !== packageVersion) {
    return {
      ok: false,
      reason: `the tag ${tag} is for version ${parsed.version}, and package.json says ${packageVersion}; move the version in a pull request and tag v${packageVersion}${parsed.rc === null ? '' : `-rc.${parsed.rc}`} instead`,
    }
  }
  // The checkout forces the local tag to the run's commit, so only the
  // remote says whether the tag was moved or deleted after the push that
  // started this run; an older run must not replace a newer tag's draft.
  if (typeof tagNow === 'string') {
    return { ok: false, reason: `could not ask the remote where ${tag} points: ${tagNow}` }
  }
  if (tagNow === null || typeof tagNow !== 'object' || typeof tagNow.run !== 'string') {
    return { ok: false, reason: `nothing said which commit this run built for ${tag}` }
  }
  if (tagNow.remote === null) {
    return {
      ok: false,
      reason: `the tag ${tag} is no longer on the remote; this run built ${tagNow.run} for a tag that has since been deleted`,
    }
  }
  if (tagNow.remote !== tagNow.run) {
    return {
      ok: false,
      reason: `the tag ${tag} was moved: it names ${tagNow.remote} now, and this run built ${tagNow.run}; the run for the tag's new commit drafts the Release`,
    }
  }
  if (typeof onMain === 'string') {
    return { ok: false, reason: `could not tell whether ${tag} is on main: ${onMain}` }
  }
  if (onMain !== true) {
    return {
      ok: false,
      reason: `the tag ${tag} names a commit that is not on main; a Release is made only from main's history`,
    }
  }
  return {
    ok: true,
    name: `${PRODUCT} ${parsed.label}`,
    version: parsed.label,
    prerelease: parsed.rc !== null,
  }
}

function git(cwd, args) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: CHILD_TIMEOUT_MS,
    windowsHide: true,
  })
}

/**
 * The commit a tag names, peeled through an annotated tag, or a message.
 *
 * @returns {{ commit: string } | { error: string }}
 */
export function tagCommit(cwd, tag) {
  const result = git(cwd, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`])
  if (result.error) return { error: result.error.message }
  if (result.status !== 0) return { error: `there is no tag ${tag} in this checkout` }
  return { commit: result.stdout.trim() }
}

/** HEAD's committer time, in seconds, for the archives' fixed times. */
export function commitTime(cwd) {
  const result = git(cwd, ['log', '-1', '--format=%ct', 'HEAD'])
  const seconds = Number((result.stdout ?? '').trim())
  if (result.error || result.status !== 0 || !Number.isInteger(seconds)) {
    throw new Error(`could not read HEAD's commit time: ${(result.stderr ?? '').trim()}`)
  }
  return seconds
}

/** A commit id, peeled to the commit it names, or a message. */
export function commitOf(cwd, rev) {
  const result = git(cwd, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`])
  if (result.error) return { error: result.error.message }
  if (result.status !== 0) return { error: `${rev} is not a commit in this checkout` }
  return { commit: result.stdout.trim() }
}

/**
 * The commit a tag names in `git ls-remote` output: the peeled `^{}` line
 * for an annotated tag, the tag's own line for a lightweight one, or null
 * when the remote has no such tag.
 *
 * @param {string} text what `git ls-remote <remote> refs/tags/<tag> refs/tags/<tag>^{}` printed
 */
export function parseLsRemote(text, tag) {
  let plain = null
  let peeled = null
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{40,64})\t(\S+)$/.exec(line.trim())
    if (match === null) continue
    if (match[2] === `refs/tags/${tag}^{}`) peeled = match[1]
    else if (match[2] === `refs/tags/${tag}`) plain = match[1]
  }
  return peeled ?? plain
}

/**
 * Where a tag points on the remote now: a commit, null when it is gone, or
 * a message when the remote could not be asked.
 *
 * @returns {string | null | { error: string }}
 */
export function remoteTagCommit(cwd, remote, tag) {
  const result = git(cwd, ['ls-remote', remote, `refs/tags/${tag}`, `refs/tags/${tag}^{}`])
  if (result.error) return { error: result.error.message }
  if (result.status !== 0) {
    return { error: `git ls-remote exited ${result.status}: ${(result.stderr ?? '').trim()}` }
  }
  return parseLsRemote(result.stdout, tag)
}

/**
 * Whether `commit` is reachable from `mainRef`: true, false, or a message
 * when git could not say (no such ref in a shallow checkout, say).
 *
 * @returns {boolean | string}
 */
export function isOnMain(cwd, commit, mainRef) {
  const known = git(cwd, ['rev-parse', '--verify', '--quiet', `${mainRef}^{commit}`])
  if (known.error) return known.error.message
  if (known.status !== 0) return `${mainRef} is not in this checkout (it needs the full history)`
  const result = git(cwd, ['merge-base', '--is-ancestor', commit, mainRef])
  if (result.error) return result.error.message
  if (result.status === 0) return true
  if (result.status === 1) return false
  return `git merge-base exited ${result.status}: ${(result.stderr ?? '').trim()}`
}

/** The three installers a Release carries, by the build's target. */
export const INSTALLERS = [
  {
    target: 'darwin-arm64',
    extension: '.dmg',
    asset: (label) => `Legible-Cities-${label}-mac-arm64.dmg`,
    key: 'mac_arm64',
  },
  {
    target: 'darwin-x64',
    extension: '.dmg',
    asset: (label) => `Legible-Cities-${label}-mac-x64.dmg`,
    key: 'mac_x64',
  },
  {
    target: 'win-x64',
    extension: '.exe',
    asset: (label) => `Legible-Cities-${label}-windows-x64-setup.exe`,
    key: 'windows_x64',
  },
]

/**
 * The Corresponding Source archives, by the vendor workflow's artefact
 * name, each named with its component's version or commit.
 */
export function sourceAssets(pins) {
  return [
    {
      artefact: 'ffmpeg-source',
      stem: `ffmpeg-${pins.ffmpeg.version}-source`,
      key: 'ffmpeg_source',
    },
    {
      artefact: 'loom-source',
      stem: `loom-${pins.loom.commit.slice(0, 12)}-source`,
      key: 'loom_source',
      // The MSYS2 packages the loom-windows job linked in, recorded by that
      // job in the same run, travel inside LOOM's archive.
      with: ['loom-windows-toolchain'],
    },
    {
      artefact: 'engine-source',
      stem: `legible-cities-engine-${pins.engine.version}-source`,
      key: 'engine_source',
    },
  ]
}

/** Every asset name a Release for this label carries, SHA256SUMS.txt included. */
export function assetNames(label, pins) {
  return [
    ...INSTALLERS.map((installer) => installer.asset(label)),
    ...sourceAssets(pins).map((source) => `${source.stem}.tar`),
    SUMS,
  ]
}

const isDirectory = (path) => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Every file under a folder, as paths relative to it with forward slashes. */
function filesUnder(root) {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) found.push(relative(root, path).split('\\').join('/'))
    }
  }
  if (isDirectory(root)) walk(root)
  return found.sort()
}

/**
 * What to copy and archive, from the artefacts as the release job
 * downloaded them: each into a folder named for the artefact under
 * `downloaded`. An installer artefact holds exactly one installer and its
 * target's manifest; a source artefact is a folder that is not empty.
 *
 * @returns {{
 *   problems: string[],
 *   installers: { target: string, from: string, asset: string, manifest: string }[],
 *   sources: { artefact: string, from: string, stem: string, with: string[] }[],
 * }}
 */
export function planAssets({ downloaded, label, pins }) {
  const problems = []
  const installers = []
  for (const installer of INSTALLERS) {
    const artefact = `installer-${installer.target}`
    const dir = join(downloaded, artefact)
    if (!isDirectory(dir)) {
      problems.push(
        `${artefact} was not downloaded: the ${installer.target} installer is missing, and a Release has all three or does not exist`,
      )
      continue
    }
    const files = filesUnder(dir)
    const found = files.filter((file) => file.toLowerCase().endsWith(installer.extension))
    const manifest = files.find((file) => file.endsWith(`manifest-${installer.target}.json`))
    if (found.length !== 1) {
      problems.push(
        `${artefact} holds ${found.length} ${installer.extension} files, not one${found.length > 0 ? `: ${found.join(', ')}` : ''}`,
      )
    }
    if (manifest === undefined) {
      problems.push(`${artefact} holds no manifest-${installer.target}.json`)
    }
    if (found.length === 1 && manifest !== undefined) {
      installers.push({
        target: installer.target,
        from: join(dir, found[0]),
        asset: installer.asset(label),
        manifest: join(dir, manifest),
      })
    }
  }
  const sources = []
  for (const source of sourceAssets(pins)) {
    const dir = join(downloaded, source.artefact)
    if (filesUnder(dir).length === 0) {
      problems.push(`${source.artefact} was not downloaded, or is empty`)
      continue
    }
    const extras = (source.with ?? []).map((name) => join(downloaded, name))
    const missing = extras.filter((extra) => filesUnder(extra).length === 0)
    for (const extra of missing) {
      problems.push(`${relative(downloaded, extra)} was not downloaded, or is empty`)
    }
    if (missing.length > 0) continue
    sources.push({ artefact: source.artefact, from: dir, stem: source.stem, with: extras })
  }
  return { problems, installers, sources }
}

/**
 * An installer's manifest, judged against the run drafting the Release:
 * written for its target, from these pins, for this app version, and in
 * this run when the run is known.
 *
 * @returns {string[]} problems, empty when it agrees
 */
export function checkManifest(manifest, { target, pinsSha256, packageVersion, runId }) {
  const problems = []
  const where = `manifest-${target}.json`
  if (manifest === null || typeof manifest !== 'object') return [`${where} is not a JSON object`]
  if (manifest.target !== target) problems.push(`${where} was written for ${manifest.target}`)
  if (manifest.pins_sha256 !== pinsSha256) {
    problems.push(
      `${where} was written from pins ${manifest.pins_sha256}, and vendor/pins.json at this tag is ${pinsSha256}`,
    )
  }
  if (manifest.app?.version !== packageVersion) {
    problems.push(
      `${where} is for app version ${manifest.app?.version}, and package.json says ${packageVersion}`,
    )
  }
  if (runId && manifest.build?.run !== runId) {
    problems.push(`${where} was written in run ${manifest.build?.run}, not this run (${runId})`)
  }
  return problems
}

/** The hex sha256 of a file's bytes. */
export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * SHA256SUMS.txt: one `<hex>  <name>` line per file, sorted by name, in the
 * form `shasum -a 256 -c` and `sha256sum -c` read.
 *
 * @param {{ name: string, sha256: string }[]} entries
 */
export function formatSums(entries) {
  return [...entries]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((entry) => `${entry.sha256}  ${entry.name}\n`)
    .join('')
}

/** SHA256SUMS.txt read back: name to hex. */
export function parseSums(text) {
  const sums = new Map()
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line)
    if (match !== null) sums.set(match[2], match[1])
  }
  return sums
}

/**
 * `tar -cf <archive> -C <parent> <name>` with GNU tar's options for a
 * reproducible archive: names sorted, owner and group 0, every time the
 * given one (the tagged commit's). The release job runs on Ubuntu, whose
 * tar is GNU's.
 */
export function tarFolder(archive, parent, name, epoch) {
  const args = [
    '--create',
    '--file',
    archive,
    '--sort=name',
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    `--mtime=@${epoch}`,
    '-C',
    parent,
    name,
  ]
  const result = spawnSync('tar', args, {
    encoding: 'utf8',
    timeout: CHILD_TIMEOUT_MS,
    windowsHide: true,
  })
  if (result.error) throw new Error(`tar could not run: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`tar exited ${result.status} for ${name}: ${(result.stderr ?? '').trim()}`)
  }
}

/**
 * The files a Release carries, into `out`: each installer renamed for its
 * machine, each source artefact archived as one tar that unpacks into a
 * folder of the same name, and SHA256SUMS.txt over all of them.
 *
 * @returns {{ problems: string[], files: string[] }}
 */
export function assemble({
  downloaded,
  out,
  tag,
  pins,
  pinsSha256,
  packageVersion,
  runId = null,
  epoch = 0,
  tar = tarFolder,
}) {
  const parsed = parseTag(tag)
  if (parsed === null) return { problems: [`the tag ${tag} is not a release tag`], files: [] }
  const plan = planAssets({ downloaded, label: parsed.label, pins })
  const problems = [...plan.problems]
  for (const installer of plan.installers) {
    let manifest
    try {
      manifest = JSON.parse(readFileSync(installer.manifest, 'utf8'))
    } catch {
      problems.push(`manifest-${installer.target}.json is not JSON`)
      continue
    }
    problems.push(
      ...checkManifest(manifest, { target: installer.target, pinsSha256, packageVersion, runId }),
    )
  }
  if (problems.length > 0) return { problems, files: [] }

  mkdirSync(out, { recursive: true })
  const leftovers = readdirSync(out)
  if (leftovers.length > 0) {
    return { problems: [`${out} is not empty: ${leftovers.join(', ')}`], files: [] }
  }
  const files = []
  for (const installer of plan.installers) {
    copyFileSync(installer.from, join(out, installer.asset))
    files.push(installer.asset)
  }
  const staging = mkdtempSync(join(tmpdir(), 'lc-release-'))
  try {
    for (const source of plan.sources) {
      cpSync(source.from, join(staging, source.stem), { recursive: true })
      for (const extra of source.with) {
        cpSync(extra, join(staging, source.stem), { recursive: true })
      }
      const archive = `${source.stem}.tar`
      tar(join(resolve(out), archive), staging, source.stem, epoch)
      files.push(archive)
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  const sums = formatSums(files.map((name) => ({ name, sha256: sha256File(join(out, name)) })))
  writeFileSync(join(out, SUMS), sums)
  files.push(SUMS)
  return { problems: [], files }
}

/**
 * The values the notes template is filled with.
 *
 * @param {object} input
 * @param {string} input.tag
 * @param {any} input.pins the parsed vendor/pins.json
 * @param {{ version: string, devDependencies?: Record<string, string> }} input.pkg package.json
 * @param {string} input.repository `owner/name`
 */
export function notesValues({ tag, pins, pkg, repository }) {
  const parsed = parseTag(tag)
  if (parsed === null) throw new Error(`the tag ${tag} is not a release tag`)
  const values = {
    tag,
    version: parsed.label,
    package_version: pkg.version,
    repository,
    install_url: `https://github.com/${repository}/blob/${tag}/docs/install.md`,
    app_source_url: `https://github.com/${repository}/archive/refs/tags/${tag}.tar.gz`,
    prerelease_note:
      parsed.rc === null
        ? ''
        : `> **A release candidate.** This is rehearsal ${parsed.rc} of ${pkg.version}: the app inside reports version ${pkg.version}. Use it to test the release, not to keep.\n\n`,
    electron_version: pkg.devDependencies?.electron ?? 'unknown',
    engine_repo: pins.engine.repo,
    engine_tag: pins.engine.tag,
    engine_version: pins.engine.version,
    loom_repo: pins.loom.repo,
    loom_commit: pins.loom.commit,
    port_repo: pins.loom_windows_port.repo,
    port_commit: pins.loom_windows_port.commit,
    ffmpeg_version: pins.ffmpeg.version,
    x264_commit: pins.ffmpeg.x264.commit,
    zlib_version: pins.ffmpeg.zlib.version,
    loom_zlib_version: pins.loom_windows_static.zlib.version,
    loom_bzip2_version: pins.loom_windows_static.bzip2.version,
    python_version: pins.python.version,
    python_release: pins.python.release,
    sums: SUMS,
  }
  for (const installer of INSTALLERS) values[installer.key] = installer.asset(parsed.label)
  for (const source of sourceAssets(pins)) values[source.key] = `${source.stem}.tar`
  return values
}

/**
 * The template with every `{{key}}` replaced. A key the values do not have
 * is a problem, not a blank: notes that say `{{loom_commit}}` or nothing
 * where a commit should be are refused.
 *
 * @returns {{ text: string, problems: string[] }}
 */
export function fillNotes(template, values) {
  const problems = []
  const text = template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (whole, key) => {
    if (!Object.hasOwn(values, key)) {
      problems.push(`the notes template names ${whole}, which nothing fills`)
      return whole
    }
    return String(values[key])
  })
  const stray = /\{\{|\}\}/.exec(text.replace(/\{\{\s*[A-Za-z0-9_]+\s*\}\}/g, ''))
  if (stray !== null) problems.push('the notes template has a brace pair that is not a {{key}}')
  return { text, problems }
}

/** The JSON lines `gh api --paginate --jq '.[] | {...}'` prints. */
export function parseReleases(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
}

/**
 * What to do on GitHub for this tag: create a draft, update the one draft
 * there is (removing the assets this run would not attach), or refuse.
 *
 * @param {{ id: number, tag_name: string, draft: boolean, assets?: { name: string }[] }[]} releases
 * @param {string} tag
 * @param {string[]} names the assets this run attaches
 * @returns {{ action: 'create' } | { action: 'update', id: number, stale: string[] } | { action: 'refuse', reason: string }}
 */
export function releaseAction(releases, tag, names) {
  const mine = releases.filter((release) => release.tag_name === tag)
  const published = mine.filter((release) => release.draft !== true)
  if (published.length > 0) {
    return {
      action: 'refuse',
      reason: `a published Release for ${tag} exists (id ${published.map((r) => r.id).join(', ')}); it is left untouched, and a published Release is never changed from here`,
    }
  }
  if (mine.length > 1) {
    return {
      action: 'refuse',
      reason: `${mine.length} draft Releases exist for ${tag} (ids ${mine.map((r) => r.id).join(', ')}); delete all but one, then run the job again`,
    }
  }
  if (mine.length === 0) return { action: 'create' }
  const wanted = new Set(names)
  const stale = (mine[0].assets ?? [])
    .map((asset) => asset.name)
    .filter((name) => !wanted.has(name))
  return { action: 'update', id: mine[0].id, stale }
}

/**
 * The draft as GitHub holds it after the upload, against the files as they
 * were uploaded: the same names, the same sizes, and the same sha256 where
 * GitHub records a digest for the asset.
 *
 * @param {{ id: number, tag_name: string, draft: boolean, assets?: { name: string, size?: number, digest?: string | null }[] }[]} releases
 * @param {{ name: string, size: number, sha256: string }[]} files
 * @returns {{ problems: string[], unverified: string[] }}
 */
export function verifyUploaded(releases, tag, files) {
  const mine = releases.filter((release) => release.tag_name === tag)
  if (mine.length !== 1 || mine[0].draft !== true) {
    return {
      problems: [`expected one draft Release for ${tag}, found ${mine.length} Releases for it`],
      unverified: [],
    }
  }
  const problems = []
  const unverified = []
  const assets = new Map((mine[0].assets ?? []).map((asset) => [asset.name, asset]))
  for (const file of files) {
    const asset = assets.get(file.name)
    if (asset === undefined) {
      problems.push(`${file.name} is not on the draft`)
      continue
    }
    if (asset.size !== file.size) {
      problems.push(`${file.name} is ${asset.size} bytes on the draft and ${file.size} here`)
    }
    if (typeof asset.digest === 'string' && asset.digest !== '') {
      if (asset.digest !== `sha256:${file.sha256}`) {
        problems.push(
          `${file.name} has digest ${asset.digest} on the draft, not sha256:${file.sha256}`,
        )
      }
    } else {
      unverified.push(file.name)
    }
  }
  const expected = new Set(files.map((file) => file.name))
  for (const name of assets.keys()) {
    if (!expected.has(name))
      problems.push(`${name} is on the draft and was not attached by this run`)
  }
  return { problems, unverified }
}

/**
 * Lines for $GITHUB_OUTPUT: `key=value`, or the delimited form for a value
 * with a line break in it.
 */
export function formatOutputs(values) {
  return Object.entries(values)
    .map(([key, value]) => {
      const text = String(value)
      if (!text.includes('\n')) return `${key}=${text}\n`
      let delimiter = 'EOF_RELEASE'
      while (text.includes(delimiter)) delimiter += '_'
      return `${key}<<${delimiter}\n${text}\n${delimiter}\n`
    })
    .join('')
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function emit(values) {
  const text = formatOutputs(values)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, text)
  process.stdout.write(text)
}

/** The files in an assets folder, with their sizes and hashes. */
function describeFiles(dir, names) {
  return names.map((name) => {
    const path = join(dir, name)
    return { name, size: statSync(path).size, sha256: sha256File(path) }
  })
}

/**
 * `decide <tag> [--main <ref>] [--remote <name>] [--run-commit <sha>] [--repo <dir>]`.
 * The run's commit defaults to GITHUB_SHA, and without it to the local tag's.
 */
export function parseDecideArgs(args, env = process.env) {
  const options = {
    tag: null,
    repo: repoRoot,
    mainRef: 'refs/remotes/origin/main',
    remote: 'origin',
    runCommit: env.GITHUB_SHA || null,
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    const value = () => {
      const next = args[i + 1]
      if (next === undefined || next === '') throw new Error(`${arg} needs a value`)
      i += 1
      return next
    }
    if (arg === '--main') options.mainRef = value()
    else if (arg === '--remote') options.remote = value()
    else if (arg === '--run-commit') options.runCommit = value()
    else if (arg === '--repo') options.repo = resolve(value())
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`)
    else if (options.tag === null) options.tag = arg
    else throw new Error(`one tag at a time; got ${options.tag} and ${arg}`)
  }
  if (options.tag === null) throw new Error('decide needs a tag')
  return options
}

function refuse(message) {
  process.stderr.write(`::error::${message}\n`)
  return 1
}

function main(argv) {
  const [command, ...args] = argv
  const pinsFile = join(repoRoot, 'vendor', 'pins.json')
  const pkg = readJson(join(repoRoot, 'package.json'))
  const pins = readJson(pinsFile)

  if (command === 'decide') {
    let options
    try {
      options = parseDecideArgs(args)
    } catch (error) {
      process.stderr.write(`${error.message}\n`)
      return 2
    }
    const { tag, repo, mainRef, remote } = options
    const packageVersion = readJson(join(repo, 'package.json')).version
    let onMain = 'not asked'
    let tagNow = 'not asked'
    if (parseTag(tag) !== null && packageVersion === parseTag(tag).version) {
      // The run's commit: GITHUB_SHA on the runner, else the local tag's.
      const run =
        options.runCommit === null ? tagCommit(repo, tag) : commitOf(repo, options.runCommit)
      if ('error' in run) {
        onMain = run.error
        tagNow = run.error
      } else {
        const remoteCommit = remoteTagCommit(repo, remote, tag)
        tagNow =
          remoteCommit !== null && typeof remoteCommit === 'object'
            ? remoteCommit.error
            : { run: run.commit, remote: remoteCommit }
        onMain = isOnMain(repo, run.commit, mainRef)
      }
    }
    const decision = decide({ tag, packageVersion, onMain, tagNow })
    if (!decision.ok) return refuse(`${decision.reason}. Nothing was drafted.`)
    emit({ name: decision.name, version: decision.version, prerelease: decision.prerelease })
    return 0
  }

  if (command === 'assemble' && args.length === 3) {
    const [tag, downloaded, out] = args
    const { problems, files } = assemble({
      downloaded: resolve(downloaded),
      out: resolve(out),
      tag,
      pins,
      pinsSha256: sha256File(pinsFile),
      packageVersion: pkg.version,
      runId: process.env.GITHUB_RUN_ID ?? null,
      epoch: commitTime(repoRoot),
    })
    if (problems.length > 0) {
      for (const problem of problems) process.stderr.write(`::error::${problem}\n`)
      return refuse('the Release was not assembled; nothing was drafted')
    }
    process.stdout.write(readFileSync(join(out, SUMS), 'utf8'))
    process.stdout.write(`assembled ${files.length} files in ${out}\n`)
    return 0
  }

  if (command === 'notes' && args.length === 2) {
    const [tag, outFile] = args
    if (parseTag(tag) === null) return refuse(`the tag ${tag} is not a release tag`)
    const values = notesValues({
      tag,
      pins,
      pkg,
      repository: process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY,
    })
    const { text, problems } = fillNotes(readFileSync(NOTES_TEMPLATE, 'utf8'), values)
    if (problems.length > 0) return refuse(problems.join('; '))
    writeFileSync(outFile, text)
    process.stdout.write(text)
    return 0
  }

  if ((command === 'existing' || command === 'verify') && args.length === 3) {
    const [tag, listing, assets] = args
    const parsed = parseTag(tag)
    if (parsed === null) return refuse(`the tag ${tag} is not a release tag`)
    const releases = parseReleases(readFileSync(listing, 'utf8'))
    const names = assetNames(parsed.label, pins)
    const missing = names.filter((name) => !existsSync(join(assets, name)))
    if (missing.length > 0) return refuse(`${assets} is missing ${missing.join(', ')}`)
    if (command === 'existing') {
      const action = releaseAction(releases, tag, names)
      if (action.action === 'refuse') return refuse(action.reason)
      process.stdout.write(`${JSON.stringify(action)}\n`)
      return 0
    }
    const files = describeFiles(assets, names)
    const sums = parseSums(readFileSync(join(assets, SUMS), 'utf8'))
    for (const file of files) {
      if (file.name !== SUMS && sums.get(file.name) !== file.sha256) {
        return refuse(`${SUMS} does not hold ${file.name}'s sha256`)
      }
    }
    const { problems, unverified } = verifyUploaded(releases, tag, files)
    if (problems.length > 0) return refuse(problems.join('; '))
    if (unverified.length > 0) {
      process.stdout.write(
        `::warning::GitHub recorded no digest for ${unverified.join(', ')}; their sizes match\n`,
      )
    }
    process.stdout.write(`the draft for ${tag} holds exactly the ${files.length} files assembled\n`)
    return 0
  }

  process.stderr.write(
    [
      'usage: release.mjs decide <tag> [--main <ref>] [--remote <name>] [--run-commit <sha>] [--repo <dir>]',
      '       release.mjs assemble <tag> <downloaded> <out>',
      '       release.mjs notes <tag> <out-file>',
      '       release.mjs existing <tag> <releases.jsonl> <assets-dir>',
      '       release.mjs verify <tag> <releases.jsonl> <assets-dir>',
      '',
    ].join('\n'),
  )
  return 2
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
if (invokedDirectly()) process.exitCode = main(process.argv.slice(2))
