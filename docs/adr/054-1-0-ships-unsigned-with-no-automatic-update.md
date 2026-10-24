# ADR-054: 1.0 ships unsigned, with no automatic update

- **Status:** Accepted
- **Date:** 2026-10-24
- **Decided by:** the maintainer, 24 Oct 2026 (issue 484)
- **Revisit:** see "What would reopen it"
- **Supersedes:** none
- **Superseded by:** none

[ADR-037](037-the-first-release-is-unsigned.md) decided that the first
release, v0.1.0, ships unsigned. This record decides the same for 1.0 and
settles what follows from it for updates. It amends nothing in ADR-037,
whose decision covered the first release and stands as written.

## Context

The installers `.github/workflows/build.yml` makes (ADR-035) are signed as
ADR-037 describes and as they were for v0.1.0:

- **macOS: ad hoc.** `electron-builder.yml` sets `identity: '-'`. There is no
  Developer ID signature and no notarisation.
- **Windows: not at all.** The nsis installer is a per-user one-click
  install with no signature, so Windows names its publisher "Unknown
  publisher".
- **No updater.** The app has none, and `build/installer.nsh` removes the
  copy of the installer that electron-builder's template keeps for one
  (issue 128).

v0.1.0 was published on that footing on 8 Oct 2026. The three person runs of
its gate were reported done with no issue noted, so nobody was recorded as
stopped at a warning, though what each warning showed was not written down
(ADR-037, "As of 8 Oct 2026"). The question was asked again for 1.0 because
1.0 is the release a person finds without being told how to open it, and
because an update channel was the thing ADR-037 said would make signing pay
for itself.

**What the update services require.** Checked against their own
documentation and source on 24 Oct 2026:

- Electron's tutorial on updates describes `update.electronjs.org` as "a
  free and open-source webservice that Electron apps can use to
  self-update", and lists as criteria that the app runs on macOS or
  Windows, has a public GitHub repository, publishes its builds to GitHub
  Releases, and that builds are code-signed "(macOS only)". Its Squirrel.Mac
  response is "a mandatory `url` property that maps to a ZIP archive of the
  app update": <https://www.electronjs.org/docs/latest/tutorial/updates>.
- The service's own README lists the same criteria, with the last written
  "Your builds are [code signed] **(macOS and MSIX only)**" (MSIX being a
  Windows package format this app does not use). For a Mac it says "Asset
  must be a `.zip` file" and names no `.dmg`. For Windows it has the `squirrel`
  format ("Squirrel.Windows (default for Windows when omitted)", a `.zip` or
  `.exe` asset, served with a `RELEASES` file) and `msix`. It does not
  mention NSIS: <https://github.com/electron/update.electronjs.org>.
- Electron's `autoUpdater` page says "Your application must be signed for
  automatic updates on macOS", as a requirement of Squirrel.Mac. On Windows
  it says Squirrel.Windows is for "apps installed via traditional installers
  (created with electron-winstaller or Electron Forge's Squirrel.Windows
  maker)", which an nsis installer is not:
  <https://www.electronjs.org/docs/latest/api/auto-updater>.

So the free service does not serve this build on either platform. On the Mac
it needs a signed app **and** a zip of it published beside the dmg;
`electron-builder.yml` builds only a dmg, so signing alone would not get the
Mac served. On Windows it needs the Squirrel.Windows packaging (or MSIX),
which this app does not use. That the nsis installer is not served is an
inference from the formats the service names, not a sentence in its
documentation.

**Windows could have an updater without a signature; it is not built.** That
there is no automatic update on Windows is a choice, not something being
unsigned forces. An nsis install can be updated by `electron-updater`, which
is not tied to that service. It checks a downloaded installer's Authenticode
signature against a `publisherName` in the app's update configuration. In the
current source of electron-updater 7 (electron-builder v27), an app whose
configuration has no publisher name has its updates rejected unless it was
built with `win.verifyUpdateCodeSignature: false`, the one explicit opt-out;
the rejection message says verification "used to be skipped". So an unsigned
nsis app can take updates, but only if they are installed with no check of
who made them. Neither is done here, and `build/installer.nsh` deliberately
removes the installer copy that updater keeps (issue 128). The sources:
<https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/NsisUpdater.ts>
and
<https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/options/winOptions.ts>.
The repository builds with electron-builder 26, and this was not tried
against it.

## Options

**Stay unsigned, with no updater.** Keep the ad-hoc Mac signature, the
unsigned Windows installer and the instructions in `docs/install.md`. Costs
nothing and puts no secret into CI. Every person meets a warning they have
to be walked past, and a new version is a new download.

**Sign and notarise the Mac.** Needs a paid developer membership, a release
job that holds signing secrets, and every Mach-O under the app's `resources/`
signed (the Python runtime, the LOOM tools, ffmpeg and ffprobe), with the
runtime's entitlements found by trial against notarisation (ADR-037,
ADR-043). It removes the Gatekeeper override for most people. Updates would
also need a zip target beside the dmg for the free service to serve the Mac,
and Windows would still have none, so the two platforms would differ.

**Sign both.** The Mac as above and the Windows installer through a signing
service, so the installer names its publisher. It removes both overrides, and
a Windows updater could then verify what it installs. It is the larger step,
and by itself delivers no update on either platform.

**Add an updater.** On Windows, `electron-updater` over the nsis installer,
signed (with a publisher name) or unsigned (with the explicit opt-out
above); on the Mac, a signed app with a zip target, through either the free
service or an updater of our own. Not chosen for 1.0.

## Decision

1.0 ships unsigned on macOS and Windows, as v0.1.0 did. `identity: '-'`
stays and so does the unsigned nsis installer. The app has no updater, so
there is no automatic update: this is the maintainer's choice for 1.0, and
the free service could not serve the build as it stands in any case. A person
learns of a release from the repository's Releases page and installs it over
the old one: on a Mac by replacing the app in Applications, on Windows by
running the new installer, which replaces the old install for that user.

## Consequences

**A person meets the first-launch steps with each version they install.**
`docs/install.md` gives them: on macOS 15 and later, Done on the "Not
Opened" dialog and then **Open Anyway** in System Settings › Privacy &
Security; on macOS 13 and 14, Control-click › Open; on Windows, **Keep** in
the browser's downloads list and then **More info** › **Run anyway** on
SmartScreen's "Windows protected your PC", with the publisher shown as
"Unknown publisher". Its sentences must keep matching what each supported
macOS and Windows version shows, and the acceptance checklist and the
stranger's run quote it (ADR-037). A new ad-hoc build is a new code identity
to macOS, and a new unsigned installer has no standing with SmartScreen, so
a version installed over the old one should be expected to meet the warnings
again.

**Nobody is told that a later version exists.** A fix reaches only those who
come back to the Releases page. The release notes and the install guide say
so, rather than leaving a person to expect an updater.

**No cost and no secrets in CI.** The release job keeps the one elevated
permission it has (`contents: write`, ADR-041) and holds no certificate, key
or keychain. The ad-hoc signature stays whole, and replacing Electron's FFmpeg
stays possible (ADR-043).

**ADR-037's checks stand for whoever signs later.** Its list of what to check
before signing is unchanged. The one about `update.electronjs.org` is now
settled above: it serves a Mac only as a signed zip, and does not serve this
nsis installer.

## What would reopen it

- **People are stopped by the warnings.** A gate run, a bug report or a
  stranger's run that shows someone giving up at Gatekeeper or SmartScreen
  is a reason to sign the platform where it happened.
- **A decision to add an updater.** A release meant to reach people who will
  not come back for it, such as a security fix, needs an update channel. That
  decision is the maintainer's to take for either platform, and it does not
  wait on signing on Windows.
- **The service's requirements change**, for instance if it names a Windows
  installer format this build can produce, or stops requiring a signature on
  the Mac. Re-read the pages cited above first.
- **The maintainer's account of what a paid developer membership or a signing
  service is worth changes.** The cost is not recorded here.

Reopening is a new record that supersedes this one. It would change
`electron-builder.yml` (a signing identity, and on the Mac a zip target beside
the dmg), `build/installer.nsh` (which removes the installer copy an
electron-updater install keeps, issue 128), the release job and the bundled
Mach-Os, as ADR-037 describes.
