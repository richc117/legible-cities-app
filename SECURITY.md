# Security

## Supported versions

Only the latest release (the one the Releases page marks Latest, never a
release candidate) receives fixes. Older releases do not.

A fix is a new release on the repository's Releases page. The app has no
automatic update and does not tell anyone that a later version exists
(ADR-054), so a fix reaches a person when they come back to that page and
install the new version over the old one. `docs/install.md` says how.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability.

- On GitHub, use **private vulnerability reporting**: open this repository's
  Security tab and choose "Report a vulnerability". The report stays
  private to you and the repository's maintainers until an advisory is
  published.
- Otherwise, contact the maintainer through the details published at
  https://www.richardcaballero.com and mention "Legible Cities security".

A problem that is not a vulnerability, from someone with no GitHub account,
goes by the same contact; `SUPPORT.md` says how.

You will get an acknowledgement within a week and an honest estimate after
that. There is no bounty programme.

## What is in scope

The app opens transit feeds that users download from the internet and runs
them through native binaries (LOOM) and an encoder (FFmpeg). Reports about
the following are especially welcome:

- Zip handling: path traversal in archive entries, decompression bombs,
  malformed archives that crash or hang the app.
- Anything that lets a feed, a project file or a URL execute code, read
  files outside the app's data folder, or reach the network without the
  user asking.
- The sidecar protocol between the app and the Python engine.
- The installers and the way they are checked: the checksums and the signed
  attestations on a release (`docs/install.md`; releases after 0.1.0 have
  an attestation, 0.1.0 does not). The installers are unsigned, as ADR-054
  records, so a warning from macOS or Windows on first launch is expected
  and is not a vulnerability report. The app has no update path, so there
  is none to report on.

Out of scope: the transit agencies' own servers and data, and problems in
upstream projects that are not caused by how this app uses them (please
report those upstream, and tell us so we can update).

## Vulnerabilities in what the installers carry

Besides the app's own code, the installers carry a Python runtime with the
engine's packages, FFmpeg with x264 and zlib, and the LOOM tools, each
pinned in `vendor/pins.json` (the packages in
`vendor/python-requirements.txt`). Once a week
`.github/workflows/vuln-watch.yml` runs `scripts/vuln-watch.mjs`, which
asks [OSV](https://osv.dev) about each of them and judges the answer
against `vendor/vuln-triage.json`. An id OSV returns is a match on a
component and a version, not a vulnerability found in the app; the triage
records, for each one, whether the app is affected and why.

The run fails when OSV returns an id the triage does not cover, or covers
for another component, version or severity, and when an open id is past its
due date. A red run is the notice; nothing else is sent. It also fails when
OSV cannot be reached, saying that nothing was judged. Every run lists what
it does not watch, and why: the libraries inside the Python runtime
(OpenSSL, SQLite and the rest), whose versions the pins do not record;
Chromium and Electron's own FFmpeg, which reach the app as Electron
releases; and the libraries the Windows LOOM tools link without a pinned
version.

**The fix budget.** Medium or above within 60 days; critical or high in a
path the app can reach within 14. An open entry is reachable, or not yet
shown not to be, so a critical or high one is due 14 days after it was
triaged and anything else 60. A fix is a release, as under "Supported
versions", and its notes say what it fixes (`docs/releasing.md`).

**Triaging a new id.** Read the advisory (`https://osv.dev/vulnerability/`
and the id) and decide from evidence:

- whether what ships carries the affected code at all: the pins' configure
  lines say what FFmpeg compiles, and `vendor/python-requirements.txt` what
  the runtime carries;
- whether anything the app runs reaches it: the app runs the engine (as
  `python -m schematic.serve`, so the engine at the pinned tag is the code
  to read), the LOOM tools and ffmpeg, and nothing else;
- whether the pinned version already carries the fix.

Then add an entry: the id; the component and version the run printed;
`osv_severity` as the run printed it, or null where OSV gives none, and
`severity`, the rating the CVE record's own score gives that (`unrated`
where OSV gives none); a verdict, `not-affected` (not in what ships),
`not-reachable` (ships, but nothing the app runs reaches it as the
advisory needs), `fixed-in-pin` or `open`; a reason of one to three
sentences grounded in how the app uses the component; the day; and, for an
open one, a `due` date within the budget. Where the evidence does not
decide it, the verdict is `open` and the reason says it needs the
maintainer's reading: a wrong `not-reachable` is worse than an honest
`open`. The unit tests refuse an entry that is malformed, dated past its
budget, or names a version the pins no longer carry, so moving a pin means
rereading its entries in the same pull request. An id the run lists as no
longer returned is taken out.

## Hygiene this repository practises

Two scanners run over every commit and again in CI: `gitleaks` for keys,
tokens and certificates, and `bin/preflight` for personal paths, addresses,
private hostnames and tool-session links. `CONTRIBUTING.md` says how to
install them; `docs/adr/015-hygiene-enforced-by-tools.md` says why there are
two. Dependabot watches the npm packages and the workflows' actions here;
the shipped Python runtime is the engine's lock, so its packages are
watched in the engine's repository and reach this one as a pin (the
weekly watch above asks OSV about them too). A security update Dependabot
opens here against `vendor/python-requirements.txt` is closed, and the
engine relocked.

The settings that only the host can enforce - secret scanning, push
protection, private vulnerability reporting, Dependabot alerts and security
updates, branch protection on `main` - are listed in
`docs/repository-settings.md`, with the date each was applied or last
checked. Signing material, when it exists, will live only in CI secrets.
