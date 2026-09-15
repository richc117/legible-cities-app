# ADR-037: The first release is unsigned

- **Status:** Proposed. It becomes Accepted when the A6-04 results in
  Context are filled in.
- **Date:** 2026-09-13
- **Revisit:** at the first release with an update to deliver
- **Supersedes:** none
- **Superseded by:** none

## Context

Issue 38 (A6-05) is the gate that asks whether `v0.1.0` is the release to
sign. By 2026-09-13 the installers `.github/workflows/build.yml` makes
(ADR-035) and the draft Release it attaches them to (ADR-041) were signed
as follows:

- **macOS: ad hoc.** `electron-builder.yml` sets `identity: '-'`. The
  packager changes the bundle after Electron's own signature was made, and
  an Apple-silicon Mac refuses a bundle whose signature is broken where it
  runs one signed ad hoc once a person allows it. The app has the hardened
  runtime and electron-builder's default entitlements (ADR-043), and the
  build job checks the ad-hoc signature with `codesign --verify --deep
  --strict`. `forceCodeSigning` is set but does nothing until a real
  identity replaces `-`.
- **Windows: not at all.** The nsis installer is a per-user one-click
  install with no signature, so Windows names its publisher "Unknown
  publisher".
- **No update channel.** The app has no updater, and `build/installer.nsh`
  removes the copy of the installer electron-builder's template keeps for
  one (issue 128). A new version is a new download.

A person gets past the warnings with `docs/install.md`: on macOS 15 and
later, Done on the "Not Opened" dialog and then **Open Anyway** in System
Settings › Privacy & Security; on macOS 13 and 14, Control-click › Open;
on Windows, **Keep** in the browser's downloads list and then **More info**
› **Run anyway** on SmartScreen's "Windows protected your PC". The
stranger's run (`docs/acceptance-stranger.md`) tells the person only that
the app is unsigned and the install guide explains what to do, and records
how long the warning took and whether the guide matched it.

The automated acceptance run (A6-04, `.github/workflows/acceptance.yml`)
cannot measure any of this. A runner downloads without a quarantine
attribute or a mark of the web, so neither Gatekeeper nor SmartScreen
warns (`docs/acceptance.md`, step 2). `v0.1.0-rc.4` passed that run on a
macOS and a Windows runner; what a person meets is measured only by the
three person runs on the same release candidate:

[RESULTS #117: the stranger's time from the release page to the first window and to the first reel; where they stalled; whether they passed the unsigned-app warning unaided]

[RESULTS #116: the clean Mac, macOS version, what Gatekeeper showed and whether install.md matched it]

[RESULTS #115: Windows version, what SmartScreen and the browser showed, any antivirus quarantine, and whether install.md matched it]

What else shaped the answer:

- **The maintainer's brief leaned on the stranger.** If the stranger
  stalls at Gatekeeper, sign the Mac; if they pass it unaided within the
  measure (a reel on disk within 15 minutes, with no help), stay unsigned.
- **Signing is not only a certificate.** Every Mach-O under the app's
  `resources/` (the Python runtime, the LOOM tools, ffmpeg and ffprobe) is
  sealed by a Developer ID signature and checked by notarisation, and the
  runtime was compiled so that nothing is written inside the bundle
  (ADR-035) so that a signature would stay whole.
- **Signing interacts with the LGPL library Electron bundles** (issue 109,
  ADR-043). A person can replace `libffmpeg.dylib` today and re-sign the
  app ad hoc while library validation stays disabled; a Developer ID
  signature and notarisation break on the same replacement.
- **An update channel is what makes signing pay for itself.** An updater
  on macOS needs a signed app, and without an updater the benefit of
  signing is one warning fewer per install.

## Options

Issue 38 weighed three answers.

**Stay unsigned.** Keep the ad-hoc Mac signature, the unsigned Windows
installer and the instructions in `docs/install.md`. Costs nothing and
puts no secret into CI; every person meets a warning they have to be
walked past, and how many stop there is what the person runs measure.

**Sign and notarise the Mac.** Enrol in the Apple Developer Program, make a
Developer ID Application certificate, turn on notarisation in
electron-builder with an App Store Connect API key, and sign every Mach-O
under `resources/`. The Python runtime would need entitlements beyond the
defaults, which would have to be found by trial against notarisation and a
launch. The secrets live only in GitHub Actions, with a temporary keychain
in the job deleted whatever the outcome. Removes the Gatekeeper override
for most people; costs a yearly membership, a release job that holds
signing secrets, and the answer to ADR-043's question of how a person
replaces Electron's FFmpeg in a notarised app.

**Sign both and add updates.** The Mac as above; Windows through Azure
Trusted Signing with electron-builder's `azureSignOptions`, so the
installer names its publisher; and an updater in the main process pointed
at this repository's Releases. Removes both overrides and
makes a new version reach people without a download. Costs two paid
accounts, secrets for both platforms, an updater to build and test, and
the checks below, none of which has been done.

## Decision

Publish 0.1.0 unsigned, as the maintainer decided on 2026-09-13 (issue 38).
Keep `identity: '-'` and the unsigned instructions in `docs/install.md`.
No update channel. Revisit when there is a second version to deliver, since
an update channel is what makes signing pay for itself.

## Consequences

**No cost and no secrets in CI.** The release job keeps the one elevated
permission it has (`contents: write`, ADR-041) and holds no certificate,
key or keychain.

**People follow the install document.** Every install meets Gatekeeper or
SmartScreen, and `docs/install.md` is the only thing that gets a person
past them. Its sentences must keep matching what each supported macOS and
Windows version shows; a change there is a change to the document, and to
the acceptance checklist and the stranger's run that quote it. The person
runs above are the only check that they still match.

**Every new version is a manual download.** Nobody running 0.1.0 is told a
later version exists, and a fix reaches only those who come back to the
Releases page.

**The ad-hoc signature stays whole, and replacing Electron's FFmpeg stays
possible.** `libffmpeg.dylib` can be replaced and the app re-signed ad hoc
without an identity; on Windows `ffmpeg.dll` is a file copy (ADR-043).

**Signing is a change to `electron-builder.yml`, the release job and every
bundled Mach-O**, recorded in issue 38 for when it is taken up. Whoever
takes it up should check first:

- `update.electronjs.org` serves macOS zips and Squirrel.Windows packages,
  not this build's nsis installer, so `electron-updater` is the likelier
  fit; the per-user install folder and the removed updater copy
  (issue 128) are then its concern.
- Azure Trusted Signing has had eligibility limits by country and account
  type.
- Signing interacts with keeping Electron's bundled LGPL FFmpeg replaceable
  (issue 109, ADR-043): keep library validation disabled, or say how a
  person replaces the library.
- The Python runtime's entitlements under the hardened runtime are
  unknown until a notarised build is launched.

**What to watch.** If the person runs show the warning stopping people,
which is where the brief leaned towards signing the Mac, that is a reason to
revisit before the first update rather than at it.
