# Security

## Supported versions

Only the latest published release receives fixes. Older releases do not.

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

## Hygiene this repository practises

Two scanners run over every commit and again in CI: `gitleaks` for keys,
tokens and certificates, and `bin/preflight` for personal paths, addresses,
private hostnames and tool-session links. `CONTRIBUTING.md` says how to
install them; `docs/adr/015-hygiene-enforced-by-tools.md` says why there are
two. Dependabot watches the npm packages and the workflows' actions here;
the shipped Python runtime is the engine's lock, so its packages are
watched in the engine's repository and reach this one as a pin. A
security update Dependabot opens here against
`vendor/python-requirements.txt` is closed, and the engine relocked.

The settings that only the host can enforce - secret scanning, push
protection, private vulnerability reporting, Dependabot alerts and security
updates, branch protection on `main` - are listed in
`docs/repository-settings.md`, with the date each was last read. Signing
material, when it exists, will live only in CI secrets.
