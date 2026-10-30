# Repository settings

Some of this project's hygiene lives in files that can be reviewed
(`.gitleaks.toml`, `.pre-commit-config.yaml`, `.github/`); the rest lives in
settings on the hosting side, where nothing in the repository can assert it.
This page is the second half, written down so it is applied deliberately and
can be audited later. See ADR-015 for why.

Everything below is free for a public repository.

## Code security

- [x] **Secret scanning** on (checked 25 Oct 2026). It watches what has
      already been pushed, which is the case the local hooks cannot cover.
- [x] **Push protection** on (checked 25 Oct 2026). It rejects a push
      containing a recognised secret before it lands, so a bypassed hook is
      still stopped.
- [x] **Private vulnerability reporting** on (checked 25 Oct 2026).
      `SECURITY.md` and the issue chooser both send people there; with it off,
      those links go nowhere.
- [x] **Dependabot alerts** on, and **Dependabot security updates** on
      (checked 25 Oct 2026). `.github/dependabot.yml` handles version updates.

## Actions

- [x] Workflow permissions: **read repository contents** (checked 25 Oct 2026).
      A job that needs more asks for it in its own `permissions:` block.
- [x] Do not allow GitHub Actions to create or approve pull requests
      (checked 25 Oct 2026).
- [x] **Approval for running workflows from outside collaborators:
      "Require approval for first-time contributors"** (Settings, Actions,
      General, "Fork pull request workflows from outside collaborators"; the
      API calls it `first_time_contributors`) (checked 24 Oct 2026). The
      repository is open to outside contributors, and a workflow from a
      stranger's fork would otherwise run on the maintainer's runners
      unreviewed. With this setting a first pull request from a fork has its
      checks wait until the maintainer presses "Approve and run", and
      that stops once the person has had a pull request **merged** (approving
      one does not do it). The weaker choice,
      first-time contributors who are new to GitHub only, lets most strangers
      through unreviewed; the stronger one, all outside collaborators, makes
      every return visit wait. `CONTRIBUTING.md` tells contributors to expect the wait.

## Branch protection on `main`

Applied 2026-09-07, when A0-09 landed the `ci` check. The two `e2e` checks
are required from the merge that split the layers (issue 500), and the
setting is changed within the hour of that merge (task T011 of spec 038).
Direct commits to `main` ended with the commit that ticked these boxes; see
`CONTRIBUTING.md`.

- [x] Require a pull request before merging.
- [x] Require status checks to pass, seven of them: `gitleaks`,
      `preflight`, the three `ci (<os>)` jobs (`ci (ubuntu-22.04)`,
      `ci (macos-15)`, `ci (windows-latest)`) and the two `e2e (<os>)` jobs
      (`e2e (macos-15)`, `e2e (windows-latest)`). `ci` is the fast layer
      (style, types, unit tests, a build) and `e2e` the end-to-end suite
      over the real application; a pull request whose every changed path is
      documentation still gets an `e2e` result, which passes at once
      without running the suite (`scripts/ci-decide.mjs`). No job has a
      `paths:` filter, because a required check that never starts blocks the
      merge. Ubuntu has no `e2e` leg. The list is
      `specs/038-test-pyramid/contracts/ci-layers.md`'s; a change to the
      jobs' names in `ci.yml` is a change here and to the setting, in the
      same hour.
- [x] Require branches to be up to date before merging.
- [x] Block force pushes.
- [x] Block deletions.

## Release tags

Applied 2026-09-13, before the first release: a tag ruleset named
**Release tags** on `refs/tags/v*`, active. A pushed `v*` tag drafts a
GitHub Release (ADR-041), so who can make one matters more than the
workflow's own checks, which stop mistakes and not someone with push
access.

- [x] Restrict creations, updates and deletions of matching tags.
- [x] Block force pushes.
- [x] Bypass list: the **Repository admin** role, always. The maintainer
      pushes release tags by hand; nothing in a workflow creates, moves or
      deletes one, so the Actions token needs no bypass.

## Discussions

- [x] **Discussions** off (checked 29 Oct 2026). ADR-030 keeps one board, and
      a sole maintainer would be watching a second place. `SUPPORT.md` sends
      people to issues instead.

## Labels and milestones

The issue templates and `.github/dependabot.yml` apply labels, which have to
exist first or the label is silently dropped, so a template names only a label
the board holds (a defect is `bug`; there is no `type:bug`). `CONTRIBUTING.md`
("Labels, milestones and issue codes") lists the labels, and its "Where
things stand" points at the milestones; read the board itself for the live
set.

## Merging

The repository's squash setting uses the commit messages (GitHub's own
default), which adds a `Co-authored-by:` trailer with each other author's
commit address. A merge is therefore made with a squash message written by
hand and read with `bin/preflight --message-file` first, and any personal
address in a trailer is removed or rewritten to a no-reply address before
confirming: `preflight` reads the whole history on every push and force pushes
are blocked, so one that lands cannot be taken out. The message also keeps
each contributor's `Signed-off-by:` lines as they were written (ADR-058): a
squash that dropped them would leave `main` with a contribution and no record
of the certificate it came under. Do not use "Update
branch", which merges `main` into the branch; rebase it.

## Checking it later

Settings drift, and a repository that was set up correctly is not the same
as one that still is. Re-read this page when a phase closes, and prove the
scanners still work the way ADR-015 describes: commit a fake key on a
throwaway branch, watch the hook refuse it, then push the branch with the
hook bypassed and watch push protection refuse it. Delete the branch.
