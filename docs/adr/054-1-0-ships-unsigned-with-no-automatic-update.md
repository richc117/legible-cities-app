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
documentation on 24 Oct 2026:

- Electron's tutorial on updates describes `update.electronjs.org` as "a
  free and open-source webservice that Electron apps can use to
  self-update", and lists as criteria that the app runs on macOS or
  Windows, has a public GitHub repository, publishes its builds to GitHub
  Releases, and that builds are code-signed (macOS only):
  <https://www.electronjs.org/docs/latest/tutorial/updates>.
- The service's own README states the same four requirements, with code
  signing marked "(macOS and MSIX only)": a Mac build must be signed to be
  served at all.
  <https://github.com/electron/update.electronjs.org>.
- Electron's `autoUpdater` page says "Your application must be signed for
  automatic updates on macOS", as a requirement of Squirrel.Mac, and that on
  Windows "the module uses Squirrel.Windows for updates" for apps installed
  through a traditional installer:
  <https://www.electronjs.org/docs/latest/api/auto-updater>.
- For Windows the service's README lists the `squirrel` format
  ("Squirrel.Windows", the default) and `msix`, and routes the Squirrel
  format through the `RELEASES` file that a Squirrel.Windows build generates,
  with a `.zip` or `.exe` asset. It does not mention NSIS, and neither does
  Electron's page. That this build's nsis installer is not served is
  therefore an inference from the formats the service names, not a sentence
  in its documentation: an nsis build produces no `RELEASES` file, and the
  service reads one.

So the free service reaches neither platform for this build as it stands. On
the Mac it needs a signed app. On Windows it needs the Squirrel.Windows
packaging (or MSIX), which this app does not use. A different updater, such
as `electron-updater`, would not depend on that service, but it would be a
new component with its own signing and packaging requirements, and nothing
here decides to build one.

## Options

**Stay unsigned.** Keep the ad-hoc Mac signature, the unsigned Windows
installer and the instructions in `docs/install.md`. Costs nothing and puts
no secret into CI. Every person meets a warning they have to be walked past,
and there is no automatic update on either platform.

**Sign and notarise the Mac.** Needs a paid developer membership, a release
job that holds signing secrets, and every Mach-O under the app's `resources/`
signed (the Python runtime, the LOOM tools, ffmpeg and ffprobe), with the
runtime's entitlements found by trial against notarisation (ADR-037,
ADR-043). It removes the Gatekeeper override for most people and satisfies
the Mac's condition for the free service, but not Windows's, so Windows still
has no update and the two platforms would differ.

**Sign both.** The Mac as above and the Windows installer through a signing
service, so the installer names its publisher. It removes both overrides.
An automatic update on Windows would still need a packaging the service
serves, which is a separate piece of work, so signing both is the larger step
and does not by itself deliver updates.

## Decision

1.0 ships unsigned on macOS and Windows, as v0.1.0 did. `identity: '-'`
stays and so does the unsigned nsis installer. The app has no automatic
update. A person learns of a release from the repository's Releases page and
installs it over the old one: on a Mac by replacing the app in Applications,
on Windows by running the new installer, which replaces the old install for
that user.

## Consequences

**A person meets the first-launch steps once per install.** `docs/install.md`
gives them: on macOS 15 and later, Done on the "Not Opened" dialog and then
**Open Anyway** in System Settings › Privacy & Security; on macOS 13 and 14,
Control-click › Open; on Windows, **Keep** in the browser's downloads list
and then **More info** › **Run anyway** on SmartScreen's "Windows protected
your PC", with the publisher shown as "Unknown publisher". Its sentences must
keep matching what each supported macOS and Windows version shows, and the
acceptance checklist and the stranger's run quote it (ADR-037). A new version
installed over the old one may meet the warnings again.

**Nobody is told that a later version exists.** A fix reaches only those who
come back to the Releases page. The release notes and the install guide say
so, rather than leaving a person to expect an updater.

**No cost and no secrets in CI.** The release job keeps the one elevated
permission it has (`contents: write`, ADR-041) and holds no certificate, key
or keychain. The ad-hoc signature stays whole, and replacing Electron's FFmpeg
stays possible (ADR-043).

**ADR-037's checks stand for whoever signs later.** Its list of what to check
before signing is unchanged; the one about `update.electronjs.org` is now
confirmed above for the Mac and, for Windows, as an inference from the
formats the service names.

## What would reopen it

- **People are stopped by the warnings.** A gate run, a bug report or a
  stranger's run that shows someone giving up at Gatekeeper or SmartScreen
  is a reason to sign the platform where it happened.
- **A release is meant to reach people who will not come back for it.** A
  fix that must arrive without a person returning to the Releases page, such
  as a security fix, needs an update channel, and an update channel on the Mac
  needs the signature.
- **The service's requirements change**, for instance if it names a Windows
  installer format this build can produce, or stops requiring a signature on
  the Mac. Re-read the pages cited above first.
- **The maintainer's account of what a paid developer membership or a signing
  service is worth changes.** The cost is not recorded here.

Reopening is a new record that supersedes this one, and a change to
`electron-builder.yml`, the release job and the bundled Mach-Os, as ADR-037
describes.
