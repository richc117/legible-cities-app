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
asks [OSV](https://osv.dev) about each of them, checks each id's rating
against the CVE records of the id and its aliases, and judges the answer
against `vendor/vuln-triage.json`. An id OSV returns is a match on a
component and a version, not a vulnerability found in the app; the triage
records, for each one, whether the app is affected and why.

The run fails when OSV returns an id the triage does not cover, or covers
for another component, version or severity, or rates below its CVE record
with no note saying why; when an open id is past its due date; and when a
triaged id is no longer returned, until its entry is taken out, since OSV
answering part of what it did looks the same as a fix. A red run is the
notice; nothing else is sent. It also fails, saying that nothing was
judged, when OSV or the CVE records cannot be reached, when the run
outlasts its own deadline (eight minutes, inside the job's ten), and when
OSV's answer cannot be trusted: a few canaries, old versions OSV has
matched for years, are asked beside the components, and one that comes
back silent, or a component the triage holds ids for that comes back with
none at all, means OSV's matching changed rather than the components went
clean.

Every run lists what it does not watch, and why: the libraries
inside the Python runtime, OpenSSL, SQLite and the rest, whose versions the
pins do not record, and Expat and libmpdec, whose versions the Windows
build's licence records name but whose matches are not yet triaged; bzip2
1.0.8 in the Windows LOOM tools, which is pinned but which OSV lists only
by commit; Chromium, and Electron's own FFmpeg with everything it links,
which reach the app as Electron releases; and the GCC and mingw-w64
runtime libraries the Windows LOOM tools link without a pinned version. A
component added to the pins, or a library added to a target's licence
record, refuses the run until the watch is taught it: a query for it, or
a row in this list saying why there is none. So does a Python runtime
that carries its own zlib with no record of its version, and an FFmpeg
configure line that carries an `--enable-` option the watch does not
know or a library linked by hand (`--extra-libs`, `-l`, `-framework`),
or that lacks `--disable-everything` or `--disable-autodetect`, without
which configure links whatever the runner has.

GitHub turns off a scheduled workflow in a public repository after 60 days
with no activity in the repository, and from then on there is no run to
go red. A quiet spell after a release can silence the watch that way: the
Actions tab then shows vuln-watch as disabled, and its "Enable workflow"
button, or `gh workflow enable vuln-watch.yml`, turns it back on. A run by
hand (`gh workflow run vuln-watch.yml`) is the check that it still works.

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

Then add an entry: the id; the component and version the run printed (an
id returned for two components has an entry for each);
`osv_severity` as the run printed it, or null where OSV gives none, and
`severity`, the highest rating the CVE records of the id and its aliases
give that vector, a CNA's or an ADP's (where OSV gives none, the highest
any of them gives, and `unrated` only for an id with no CVE alias), with a
`rating_note` saying why where it is lower or nothing rates it: a vector
no record names, or an alias whose record is missing, rejected or
unscored; a verdict, `not-affected` (not in what ships),
`not-reachable` (ships, but nothing the app runs reaches it as the
advisory needs), `fixed-in-pin` or `open`; a reason of one to three
sentences grounded in how the app uses the component; the day; and, for an
open one, a `due` date within the budget. Where the evidence does not
decide it, the verdict is `open` and the reason says it needs the
maintainer's reading: a wrong `not-reachable` is worse than an honest
`open`. The unit tests refuse an entry that is malformed, dated past its
budget, or names a version the pins no longer carry, so moving a pin means
rereading its entries in the same pull request. An id the run lists as no
longer returned is taken out, once the advisory or the pin shows why.
When neither does, run the watch again by hand (`gh workflow run
vuln-watch.yml`): an id that stays missing while its advisory still lists
the pinned version as affected stays in the triage, and the run stays red
until OSV returns it again or the advisory or the pin changes.

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
