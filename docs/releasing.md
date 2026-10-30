# Releasing

How a version of the app goes from `main` to the Releases page. Releasing
is the maintainer's. The release job in `.github/workflows/build.yml` drafts
a Release from a tag and never publishes one (ADR-041); how it does that,
and what it refuses, is in `docs/ARCHITECTURE.md` under the release job.
This page is what a person does around it.

## Cutting a candidate

A candidate is a tag `vX.Y.Z-rc.N` on a commit of `main`, where `X.Y.Z` is
`package.json`'s version. Before it is tagged, one pull request brings
these up to date:

- **The changelog.** `CHANGELOG.md` has a `## [X.Y.Z]` section, undated for
  a candidate. It says what changed under Keep a Changelog's headings
  (Added, Changed, Deprecated, Removed, Fixed, Security), written for a
  person who uses the app and not as a list of pull requests, and has a
  `### Known issues`, which may say "None.". What is under `## [Unreleased]`
  moves into it. The release job fills the notes' "What changed", "Known
  issues" and "Security" from this section, and drafts nothing for a tag
  whose version has none (`scripts/release.mjs notes`).
- **The status text**, which says which version is current:
  - `README.md`, the install paragraph that names the first release and
    the paragraph that opens "Status:";
  - `CONTRIBUTING.md`, "Where things stand", the sentence that names the
    released version;
  - `docs/install.md`, "Check who built it", which says which releases have
    an attestation ("Releases after 0.1.0 have one"), and "Updating from an
    earlier release", which names the version being updated from;
  - `SECURITY.md`, "Supported versions", and the sentence on attestations
    under "What is in scope";
  - `.github/release-notes.md`, "Updating", which names the version being
    updated from.
- **No open flaky test on the gate.** No open issue labelled `flaky` names a
  spec the gate relies on, unless the maintainer has accepted it in writing
  on that issue (issue 553).

Once that has merged, dispatch the vendor workflow on `main` (`gh workflow
run vendor.yml --ref main`), so the tag's run finds its caches warm
(`docs/ARCHITECTURE.md` says why), then tag a commit of `main` and push the
tag alone:

```
git tag vX.Y.Z-rc.N <commit on main>
git push origin vX.Y.Z-rc.N
```

The tag's `build` run drafts a Release marked as a pre-release.

**The final release** is a tag `vX.Y.Z`, cut the same way once a candidate
has passed the gate. Its pull request also dates the section, `## [X.Y.Z] -
YYYY-MM-DD` with the day it is published, gives it a `### Security`, which
says "None." if the release fixes no publicly known vulnerability (the
notes then say "No publicly known vulnerability is fixed in this
release."), and adds the section's link at the foot of the changelog,
`[X.Y.Z]: https://github.com/richc117/legible-cities-app/compare/v<previous>...vX.Y.Z`,
with `[Unreleased]` moved to compare from `vX.Y.Z`. The release job refuses
a final tag whose section is undated or has no Security.

## The gate

A version is released only after a candidate of it has passed the release
gate, [`docs/acceptance.md`](acceptance.md):

- **The automated run**, `.github/workflows/acceptance.yml`, dispatched with
  the candidate's tag. Its token cannot see a draft, so the candidate is
  published as a pre-release first (below).
- **The person runs**: once on a Windows PC and once on a clean Mac, each
  recorded in an issue of its own from the checklist's results template.
  Step 22, "Update over 0.1.0", is made on one of the two.
- **The stranger's timed run**,
  [`docs/acceptance-stranger.md`](acceptance-stranger.md), and the
  screen-reader walkthrough in
  [`docs/accessibility.md`](accessibility.md#walking-it-with-a-screen-reader).

A failure is an issue of its own, as the checklist says. One that needs a
change is fixed on `main`, and the fix goes out as the next candidate.

## Publishing

1. The tag's `build` run is green in every job, `release (draft)`, `attest
   (provenance)` and `verify (attestations)` among them. Nothing is
   published before the attestations are made and verified.
2. Read the draft's notes. A candidate's open with its banner. "What
   changed", "Known issues" and, for a final, "Security" say what
   `CHANGELOG.md` says; the components table names the pins. A draft's
   notes may be edited before it is published, and a rerun of the job keeps
   them; a mistake in the changelog itself is fixed there too, in a pull
   request.
3. Publish it by hand on GitHub: a candidate as a pre-release, a final as
   the latest release.

## A release that has to be pulled

A published Release is never deleted, and its assets are never replaced.
`SHA256SUMS.txt` and the attestations name those exact files, and a
released version's contents must not change (Semantic Versioning 2.0.0,
item 3). A bad release is superseded instead:

1. **Publish a patch release**, `X.Y.Z+1`, that fixes or reverts the fault,
   cut, gated and published as above. Its changelog section says what was
   wrong with the version it replaces.
2. **Open the bad Release's notes with a banner**, edited on GitHub:
   `> **Do not install this version.** <why>. Install <next> instead.`,
   with a link to the patch, followed by what a person who installed it
   should do.
3. **Untick "Set as the latest release"** on the bad Release, if publishing
   the patch as the latest has not already moved it.
4. **Mark it `[YANKED]` in the changelog**, in the patch's pull request:
   `## [X.Y.Z] - YYYY-MM-DD [YANKED]`.

`SECURITY.md` already says that only the latest release receives fixes.
