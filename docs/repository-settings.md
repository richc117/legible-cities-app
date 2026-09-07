# Repository settings

Some of this project's hygiene lives in files that can be reviewed
(`.gitleaks.toml`, `.pre-commit-config.yaml`, `.github/`); the rest lives in
settings on the hosting side, where nothing in the repository can assert it.
This page is the second half, written down so it is applied deliberately and
can be audited later. See ADR-015 for why.

Everything below is free for a public repository.

## Code security

- [ ] **Secret scanning** on. It watches what has already been pushed, which
      is the case the local hooks cannot cover.
- [ ] **Push protection** on. It rejects a push containing a recognised
      secret before it lands, so a bypassed hook is still stopped.
- [ ] **Private vulnerability reporting** on. `SECURITY.md` and the issue
      chooser both send people there; with it off, those links go nowhere.
- [ ] **Dependabot alerts** on, and **Dependabot security updates** on.
      `.github/dependabot.yml` handles version updates.

## Actions

- [ ] Workflow permissions: **read repository contents**. A job that needs
      more asks for it in its own `permissions:` block.
- [ ] Do not allow GitHub Actions to create or approve pull requests.

## Branch protection on `main`

Applied 2026-09-07, when A0-09 landed the `ci` check. Direct commits to
`main` ended with the commit that ticked these boxes; see `CONTRIBUTING.md`.

- [x] Require a pull request before merging.
- [x] Require status checks to pass: `gitleaks`, `preflight`, and the three
      `ci (<os>)` jobs: `ci (ubuntu-22.04)`, `ci (macos-15)`,
      `ci (windows-latest)`.
- [x] Require branches to be up to date before merging.
- [x] Block force pushes.
- [x] Block deletions.

## Labels and milestones

The issue templates and `.github/dependabot.yml` apply labels, which have to
exist first or the label is silently dropped. `CONTRIBUTING.md` lists the
canonical set: a phase (`phase:0` … `phase:6`), a type (`type:spike`,
`type:spec`, `type:feature`, `type:bug`, `type:chore`, `type:docs`), an area
(`area:engine`, `area:shell`, `area:sidecar`, `area:capture`, `area:export`,
`area:ui`, `area:ci`, `area:release`) and a size (`size:S`, `size:M`,
`size:L`). The milestones are the seven phases and `Phase 1.5 - First
reel` between Engine boundary and Library and inspect.

## Checking it later

Settings drift, and a repository that was set up correctly is not the same
as one that still is. Re-read this page when a phase closes, and prove the
scanners still work the way ADR-015 describes: commit a fake key on a
throwaway branch, watch the hook refuse it, then push the branch with the
hook bypassed and watch push protection refuse it. Delete the branch.
