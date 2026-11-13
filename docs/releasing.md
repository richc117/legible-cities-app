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
  whose version has none (`scripts/release.mjs notes`). Links in it are
  inline, `[text](address)`, with no images and no reference-style links.
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

Once that has merged, check the notes on the commit to be tagged, for a
candidate and for a final alike. The release job writes them only after
packaging, an hour into its run, and a refusal then means moving a tag
already pushed; this refuses exactly as the job would, in a second:

```
node scripts/release.mjs notes vX.Y.Z-rc.N <scratch file>
```

(`vX.Y.Z` for a final). Then dispatch the vendor workflow on `main` (`gh
workflow run vendor.yml --ref main`), so the tag's run finds its caches warm
(`docs/ARCHITECTURE.md` says why), and tag that commit and push the tag
alone:

```
git tag vX.Y.Z-rc.N <commit on main>
git push origin vX.Y.Z-rc.N
```

The tag's `build` run drafts a Release marked as a pre-release. The app in
it reports the tag's version, `X.Y.Z-rc.N`, under Settings › Versions and
in Copy diagnostics, as the notes' banner says; an installer built from
`main` or a branch reports `X.Y.Z+<sha7>`, the commit it was built from
(issue 558).

**The final release** is a tag `vX.Y.Z`, cut the same way once a candidate
has passed the gate. Its pull request also dates the section, `## [X.Y.Z] -
YYYY-MM-DD` with the day it is published, gives it a `### Security`, which
says "None." if the release fixes no publicly known vulnerability (the
notes then say "No publicly known vulnerability is fixed in this
release."), and adds the section's link at the foot of the changelog,
`[X.Y.Z]: https://github.com/richc117/legible-cities-app/compare/v<previous>...vX.Y.Z`,
with `[Unreleased]` moved to compare from `vX.Y.Z`. The release job refuses
a final tag whose section is undated or has no Security. These may go into
the last candidate's pull request, since a candidate's notes accept a dated
section, so that the final is tagged on the very commit the gate passed.

## The gate

A version is released only after a candidate of it has passed the release
gate. ADR-063 decided what the gate is and why: machines where they can
measure, the assistant's review of what they keep, and one person's
sitting for what neither can judge. Each part is recorded on the gate
issue, one per version.

- **The automated run**, `.github/workflows/acceptance.yml`, dispatched with
  the candidate's tag. Its token cannot see a draft, so the candidate is
  published as a pre-release first (below). It runs
  [`docs/acceptance.md`](acceptance.md) on a macOS and a Windows runner,
  and must be green on both: steps 1 to 21, the update over 0.1.0 (step
  22, issue 690), and the visual evidence with its machine assertions
  (issue 689). Until a part's issue has landed, the record says that part
  is not automated, and the gate is not passed without it.
- **The scripted VoiceOver run** on the macOS runner (issue 691), its
  cells worded as [`docs/accessibility.md`](accessibility.md#results-by-screen)'s
  legend says. What it hears is not a pass. If it is not recorded for the
  final candidate, the sitting walks the VoiceOver rows by ear instead.
- **The assistant's visual review**: every image the automated run kept,
  read under [the reviewer's protocol](acceptance.md#the-reviewers-protocol)
  and posted on the gate issue with its images. Its verdicts are `looks
  right`, `looks wrong` and `cannot tell`, never `pass`.
- **The sitting**, [`docs/acceptance-sitting.md`](acceptance-sitting.md):
  one person, about 45 minutes, on the final candidate, on a Mac, recorded
  in an issue of its own and ending in the go or no-go on the gate issue.
- **Windows** is a beta, and is accepted on its automated results alone:
  no person run, no SmartScreen check and no Narrator walk.

**After the release**, the stranger's timed run,
[`docs/acceptance-stranger.md`](acceptance-stranger.md), is feedback on
the released version. It does not hold the release, and what it finds goes
into the next one.

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

1. **Publish a patch release**, the next patch version, `X.Y.(Z+1)`, that
   fixes or reverts the fault, cut, gated and published as above. Its
   changelog section says what was wrong with the version it replaces.
2. **Open the bad Release's notes with a banner**, edited on GitHub:
   `> **Do not install this version.** <why>. Install <next> instead.`,
   with a link to the patch, followed by what a person who installed it
   should do.
3. **Untick "Set as the latest release"** on the bad Release, if publishing
   the patch as the latest has not already moved it.
4. **Mark it `[YANKED]` in the changelog**, in the patch's pull request:
   `## [X.Y.Z] - YYYY-MM-DD [YANKED]`.

`SECURITY.md` already says that only the latest release receives fixes.
