# Security

## Supported versions

Nothing has been released. Once there are releases, only the latest release
receives fixes.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability.

- On GitHub, use **private vulnerability reporting** on this repository's
  Security tab, once the repository is published there with that setting
  enabled.
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
- The update and installer path, once one exists.

Out of scope: the transit agencies' own servers and data, and problems in
upstream projects that are not caused by how this app uses them (please
report those upstream, and tell us so we can update).

## Hygiene this repository practises

Two scanners run over every commit and again in CI: `gitleaks` for keys,
tokens and certificates, and `bin/preflight` for personal paths, addresses,
private hostnames and tool-session links. `CONTRIBUTING.md` says how to
install them; `docs/adr/015-hygiene-enforced-by-tools.md` says why there are
two. Dependabot watches dependencies once there are manifests to watch.

The settings that only the host can enforce - secret scanning, push
protection, private vulnerability reporting, branch protection on `main` -
are listed in `docs/repository-settings.md` and are switched on as the
repository is published. Signing material, when it exists, will live only in
CI secrets.
