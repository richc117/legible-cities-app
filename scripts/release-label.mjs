// The version the app reports (issue 558), and what a release tag says:
// releaseLabel and parseTag, with the patterns they read. A module of its
// own, with no import.meta and nothing imported, so every loader can read
// it: scripts/release.mjs re-exports both for the build and the release
// job, and tests/acceptance/pure.mjs imports it for a rehearsal's App row,
// under Playwright, whose loader cannot read a module that uses
// import.meta. One definition of the label, read by all of them.

const NUMBER = '(0|[1-9]\\d*)'
export const VERSION = new RegExp(`^${NUMBER}\\.${NUMBER}\\.${NUMBER}$`)
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

export const COMMIT = /^[0-9a-f]{7,64}$/

/**
 * The version the app reports, in Settings, Copy diagnostics and so the bug
 * report (issue 558): a release tag's own version, `1.0.0-rc.2` for
 * `refs/tags/v1.0.0-rc.2` and `1.0.0` for `refs/tags/v1.0.0`, so a
 * candidate says which candidate it is while package.json, which the tag
 * rules and the Windows installer's version read, stays X.Y.Z. Any other
 * build - a branch, a pull request, a local build, a tag that is not a
 * release tag - reports package.json's version with the commit as SemVer
 * build metadata, `1.0.0+abc1234`, so an installer from main says which
 * commit it is, or the bare version when no commit is known. A release tag
 * for another version than package.json's throws, which fails the build,
 * as `decide` would refuse its Release.
 *
 * @param {string} pkgVersion package.json's version, X.Y.Z
 * @param {string | null | undefined} ref the ref built, as GitHub names it
 *   (`refs/tags/<tag>`, `refs/heads/<branch>`), or nothing
 * @param {string | null | undefined} [commit] the commit built, in hex
 * @returns {string}
 */
export function releaseLabel(pkgVersion, ref, commit = null) {
  if (typeof pkgVersion !== 'string' || !VERSION.test(pkgVersion)) {
    throw new Error(
      `package.json's version is ${JSON.stringify(pkgVersion)}, not X.Y.Z, so the app has no version to report`,
    )
  }
  const tag =
    typeof ref === 'string' && ref.startsWith('refs/tags/')
      ? parseTag(ref.slice('refs/tags/'.length))
      : null
  if (tag !== null) {
    if (tag.version !== pkgVersion) {
      throw new Error(
        `the tag ${ref.slice('refs/tags/'.length)} is for version ${tag.version}, and package.json says ${pkgVersion}; an app built from it would report a version it is not`,
      )
    }
    return tag.label
  }
  if (commit === null || commit === undefined || commit === '') return pkgVersion
  if (typeof commit !== 'string' || !COMMIT.test(commit)) {
    throw new Error(`the commit built is ${JSON.stringify(commit)}, not a commit id in hex`)
  }
  return `${pkgVersion}+${commit.slice(0, 7)}`
}
