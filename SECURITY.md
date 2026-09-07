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

`bin/preflight` refuses personal paths, addresses, keys and tool-session
links before a push. When the repository is published on GitHub, secret
scanning, push protection and private vulnerability reporting will be
switched on and Dependabot will watch dependencies. Signing material, when
it exists, will live only in CI secrets.
