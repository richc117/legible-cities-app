# ADR-057: The shipped Python runtime is locked, and the release is attested

- **Status:** Accepted
- **Date:** 2026-10-16
- **Supersedes:** none
- **Superseded by:** none
- **Amends:** [ADR-020](020-sidecar-packaging.md), whose decision - the
  sidecar ships as a pinned python-build-standalone runtime - stands, and
  whose runtime now carries locked, hashed packages and a pinned pip; and
  [ADR-041](041-releases-are-drafted-from-a-tag.md), whose decision - a
  release is drafted from a tag and published by hand - stands, and two of
  whose statements do not: that the engine's commit is not pinned, only its
  tag, as an accepted limit, and that the token reaches three places in the
  release job.

## Context

The codebase review of 15 Oct 2026 found two gaps in what the installers
carry (R8-03, R8-05; issue 434).

**The runtime was not locked.** `scripts/vendor-python.sh` built the
engine's wheel and let pip install it with its declared dependencies, which
are minimums (`pandas>=2.2`, `python-lsp-jsonrpc>=1.1`, `requests>=2.32`):
pip resolved them to whatever was newest on the day, majors included, with
nothing hashed, after upgrading itself with `--upgrade pip`. The engine
itself was pinned by tag and `__version__`, so a moved tag with an unchanged
version vendored another engine unseen; ADR-041 recorded that as an
accepted limit. The engine's own `uv.lock` went unused. The spike report
(`docs/adr/spikes/sidecar-packaging.md`, "Still open") had named the fix.
Measured on 16 Oct 2026: the runtime last vendored on a developer machine,
beside engine 0.10.1, carries pandas 3.0.6, idna 3.20 and urllib3 2.8.0,
where the engine's lock pins 3.0.5, 3.19 and 2.7.0.

**Nothing attested a release.** `SHA256SUMS.txt` beside the files it lists
shows that a download arrived whole, not who built it: whoever could
replace a file on the Release could replace its line too.

And three facts shaped the answer. Every python-build-standalone 20260901
asset already carries pip 26.2.1. The release job is the one job with
`contents: write`, and `id-token: write` is job-wide, so any step of a job
holding it can mint the OIDC token Sigstore's certificate is issued for.
And the engine's wheel is built by pip in an isolated environment, with the
build backend its `pyproject.toml` names, `hatchling`, unversioned.

## Options

For the packages:

- **Pin the dependencies here by hand** (a requirements file written in
  this repository). A second list beside the engine's lock, and the two
  drift; the engine is the source of truth (constitution, principle II).
- **Install with uv on the runners** from the engine's lock (`uv sync
  --frozen` into the runtime). Exact, but a new tool in the step that
  builds what ships, and uv installs into an environment of its own making,
  not the runtime's `site-packages` as pip does.
- **Export the engine's lock with every file's hash, commit the export, and
  install it with `pip install --require-hashes`.** The lock stays the
  engine's; pip, which the runtime already carries, installs it; the
  committed file is reviewable in a pull request; a move costs a vendor
  run.

For the attestation:

- **Sign the checksum file with a key of our own** (GPG, minisign). A key
  to keep, rotate and publish, and a person verifying needs it from
  somewhere they trust.
- **Sigstore attestations through GitHub** (`actions/attest-build-provenance`),
  keyless: the certificate names this repository, the workflow and the
  commit, the statement is recorded in a public transparency log, and `gh
  attestation verify` checks it. Needs `id-token: write`.
- Where the token lives: **in the release job**, beside `contents: write`
  and every step there, or **in a job of its own** that holds nothing else.

## Decision

The runtime's packages are the engine's lock. `vendor/python-requirements.txt`
is `uv export --frozen --no-dev --hashes --no-emit-project` run in a clean
checkout of the engine at the pinned tag, written by `scripts/lock-python.sh`
with a header naming the engine's repository, tag, commit and the uv that
wrote it, and refused by that script for a checkout that is not clean, not
at the tag, or whose tag is not the pinned commit, or for a uv other than
`python.requirements.uv.version`. `vendor/pins.json` records `engine.commit`,
the manifest's sha256 (`python.requirements.sha256`), uv's version and the
hash of each target's wheel, and pip's version and wheel hash
(`python.pip`). The python job refuses an engine tag that names another
commit, checks the engine out by commit, installs the pinned uv by hash
into a throwaway environment and refuses a manifest whose body is not that
uv's export at the commit. `scripts/vendor-python.sh` refuses a manifest
the pins do not name and an engine checkout that is not at `engine.commit`
or has changes; installs pip at its pin by hash, never `--upgrade pip`; the
manifest with `--require-hashes --only-binary :all:`; the engine's wheel
with `--no-deps`; runs `pip check`; and records the engine commit and the
manifest's hash inside the runtime (`python/vendor-record.json`).
`scripts/check-vendored.mjs` refuses, in the vendor job and again at
packaging, a runtime whose packages are not exactly the manifest's for its
target, its environment markers judged for that target, with pip at its
pin, or whose record names another commit or manifest, and a manifest whose
hash is not the pins'. The `engine-source` job refuses a tag that no longer
names `engine.commit`, and its archive carries the manifest and the scripts
that write, install and check it.

A Release is attested. After the release job has assembled the assets and
written `SHA256SUMS.txt`, and before it writes the draft, it uploads that
folder as the `release-assets` artefact. An `attest` job after it, with
`contents: read`, `id-token: write` and `attestations: write` and nothing
else, downloads the artefact, refuses a file whose sha256 is not its line
in `SHA256SUMS.txt` or a file the list does not name, and runs
`actions/attest-build-provenance` (pinned by commit) over the installers
and `SHA256SUMS.txt`. The release job keeps `contents: write` alone and
cannot mint a token; the token reaches the attest job only. The draft is
published by hand only after the attest job is green. `docs/install.md`
says how a person checks a download with `gh attestation verify`.

The rule: **moving the engine pin means running `scripts/lock-python.sh`
against a clean checkout at the new tag, and moving `engine.commit` and
`python.requirements.sha256` with `engine.tag` and `engine.version`.**
`tests/unit/python-lock.test.ts` names the commit measured at the tag, so a
pin move edits it too.

## Consequences

**A dependency moves only when the engine's lock does.** A security fix in
pandas or urllib3 reaches the installers through an engine commit that
relocks, a new engine tag, and a pin move here, each a pull request; a
vendor run follows. That is the cost the issue named, and it is the point.
Dependabot's pip entry looks at the repository root and does not read
`vendor/python-requirements.txt`, so it proposes no bump of the manifest
(a bump of the manifest alone would diverge from the engine's lock and
fail the unit tests); a security alert on a manifest's package is a reason
to relock the engine. (Amended 2026-10-24, issue 472: it did read the
file, and on 19 Oct 2026 opened five bumps of it, each failing the unit
tests and `check-vendored` as this record intended. The pip entry was
removed, and the engine's own `.github/dependabot.yml` now proposes the
bumps, against its `uv.lock`, where a package can move. A security update,
which the repository's settings open and no entry governs, can still
arrive against the file; it is closed, and the engine relocked.)

**A pin move needs uv at the pinned version** on the machine that moves it,
and moving uv's own version means rereading its wheels' hashes.

**The engine's build backend is the gap left.** pip fetches `hatchling`
into the wheel build's isolated environment unpinned and unhashed; it does
not ship, but it writes the wheel that does. A second hashed manifest for
hatchling and its dependencies, installed into a build environment with
`--no-build-isolation`, or the engine publishing its wheel by tag with a
hash the pins record, would close it. Neither is done here.

**The release grows a job.** The attest job downloads the assets (about
700 MB) once more, and a Release is not to be published while it is red; a
rerun of it alone works for the artefact's seven days. Attestations are
made through Sigstore's public-good instance and stored by GitHub, so
verifying needs GitHub's API and `gh`; the app itself makes no new
connection. Releases from before this decision, v0.1.0 among them, have no
attestation.

**What is proved where.** The unit tests hold the committed manifest, its
header and the pins to each other on every pull request; the python job
holds the manifest to the engine's lock and the runtime to the manifest on
each target; the packaging hook holds the packaged runtime to both again.
Only a tag proves the attest job and `gh attestation verify` against a real
Release.

(Amended 2026-10-29, issue 557: the tag came, `v1.0.0-rc.1`, and `build.yml`
run 40617381664 was green in every job, the attest job among them. Checked
by hand against the draft: `gh attestation verify` over `SHA256SUMS.txt`
with `--repo`, `--signer-workflow` naming `build.yml` and `--source-ref
refs/tags/v1.0.0-rc.1` passed, its certificate naming that workflow at that
tag, a GitHub-hosted runner and the tag's commit; the same file with
`--source-ref refs/tags/v0.1.0` failed. So the wrong ref is refused, which
is what makes the check worth running. Nothing ran it, though, so the
attest job was proved to sign and not to be verifiable. A `verify
(attestations)` job now follows it, `needs: attest`, with `contents: read`
and `attestations: read` and no `id-token`, so the rule on who can sign
stands: it downloads the same artefact and runs `gh attestation verify` over
each installer and `SHA256SUMS.txt` with `--repo`, `--signer-workflow`,
`--source-ref "$GITHUB_REF"`, `--source-digest "$GITHUB_SHA"` and
`--deny-self-hosted-runners`. The draft is published by hand only after both
are green. The acceptance run's step 1 makes the same check, with the tag as
`--source-ref`, over the published Release's own download, and records a tag
from before this decision as not attested. The claim stays what GitHub says
of artifact attestations by themselves, SLSA Build Level 2 in its words, and
this project claims no level.)
