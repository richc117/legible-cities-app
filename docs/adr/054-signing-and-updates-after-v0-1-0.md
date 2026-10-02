# ADR-054: Signing and updates after v0.1.0

- **Status:** Proposed
- **Date:** 2026-10-02
- **Supersedes:** ADR-037, its "revisit when there is a second version to deliver" clause only
- **Superseded by:** none

## Context

ADR-037 published v0.1.0 unsigned: ad hoc on macOS, an unsigned nsis installer on Windows, no update channel, to be revisited with a second version. Phase 8 is that version. The person runs ADR-037 owes are still blank.

**What a person meets today**, in the vendors' own words.

- macOS. The app is blocked; then System Settings › Privacy & Security and "Click Open Anyway." Apple: "This button is available for about an hour after you try to open the app."
- Windows. Microsoft, for an unsigned file: "Windows protected your PC"; "User must choose 'Run anyway' before the app can run." And: "Smart App Control will block execution of unsigned files unless the file has a positive reputation."
- Electron: "Both Windows and macOS prevent users from running unsigned applications. It is possible to distribute applications without codesigning them - but in order to run them, users need to go through multiple advanced and manual steps."

**What each remedy costs and buys.**

- *Apple Developer Program.* "$99 annual membership"; notarisation is part of it. electron-builder signs and notarises with a Developer ID and an App Store Connect key; every Mach-O under `resources/` (the Python runtime, the LOOM tools, ffmpeg) is sealed and checked; the runtime's hardened-runtime entitlements are unknown until a notarised build is launched, and ADR-043's replaceable `libffmpeg.dylib` interacts (ADR-037). For updates, Electron names `Squirrel.Mac` among frameworks "that only behave correctly once your app is code signed"; reports that an ad-hoc signature pins its designated requirement to one build so an updater can never validate the next are secondary (unverified raw).
- *Azure Artifact Signing* (formerly Trusted Signing). "Starts at $9.99/month"; "Artifact Signing doesn't support free, trial, or sponsored Azure subscriptions."; "Individual developers must be located in the United States or Canada."; the billing account "must have an Account Type of Individual"; validation "takes from 1 to 20 business days". It names the publisher at once, but "EV certificates no longer bypass SmartScreen." and reputation "can take several weeks and hundreds of clean installs from a wide audience." electron-builder's `azureSignOptions` drives it (not read raw).
- *SignPath Foundation.* No charge for open-source projects (the Foundation's homepage, summarised). Its terms: "The project must use an OSI-approved Open Source license without commercial dual-licensing for all components."; "The project must be actively maintained."; "A code signing policy must be specified on the project's home page."; "Every release needs manual approval for signing."; "All team members must use multi-factor authentication for both SignPath and source code repository access". This repository is GPL-3.0-or-later, active, with releases. Windows Authenticode in practice; macOS coverage not found (unverified). Reputation accrues as above.
- *update.electronjs.org.* Requires "a public GitHub repository" and builds that are "code signed (macOS and MSIX only)"; Windows through "Squirrel.Windows (default for Windows when omitted)" or "MSIX auto-update (available on Electron 41+)"; nothing for nsis. *electron-updater* has an `NsisUpdater` whose default verifier checks the downloaded installer's signature (class page, summarised); its main page could not be fetched, and its behaviour for an unsigned Windows app is unverified.
- *Constitution IV.* No update pings. Any check is a person's act.

## Options

**(a) Stay unsigned; add a user-initiated check.** No cost; every install keeps both warnings.

**(b) Sign and notarise the Mac; Windows unsigned; the check.** $99 a year and a spike.

**(c) (b), with Windows through SignPath Foundation.** $99 a year, a policy page, an approval per release.

**(d) (b), with Windows through Artifact Signing.** $99 plus $119.88 a year and a paid subscription; eligibility by country.

**(e) Any of (b) to (d), plus electron-updater now.** An updater on a platform still unsigned.

## Decision

A tree, walked in order. (1) The Mac is signed and notarised with a Developer ID, behind a two-session spike (its brief is beside this record) that must launch a notarised build carrying the Python runtime, LOOM and ffmpeg, keep `libffmpeg.dylib` replaceable per ADR-043 or say how a person replaces it, and leave secrets only in the release job with a temporary keychain deleted whatever the outcome; if the spike fails in its timebox, the Mac stays ad hoc and (a) stands for it. (2) Windows goes to SignPath Foundation first: it costs a policy page and a manual approval per release and no money; Artifact Signing is the maintainer's call where eligible, and nothing here depends on it. (3) Phase 8 ships a user-initiated "Check for updates" that asks GitHub Releases for the latest tag when, and only when, a person presses it, and offers the download page; never on launch, never on a schedule. (4) electron-updater comes only when both platforms are signed, as its own record: `NsisUpdater` with the GitHub provider, the macOS zip for Squirrel.Mac, and the per-user install and the removed updater copy (issue 128) revisited then. (5) `docs/install.md`, the acceptance checklist and the stranger's run change with whatever each release signs.

## Consequences

**Cost.** $99 a year if the spike succeeds; nothing for Windows under SignPath; CI holds an Apple key and a signing connector, under the one elevated permission ADR-041 gave the release job.

**Windows still warns for a while.** A signed installer names its publisher at once; SmartScreen's prompt fades with installs, not with the certificate.

**The measure moves on the Mac.** The Open Anyway override, and its hour-long window, go away for a notarised build; the stranger's run measures it.

**One outbound call, recorded.** The update check is the second thing the app reaches the network for, and only when asked; this record is its reason under constitution IV.

**What to watch.** Smart App Control refusing unsigned files outright is the signal to move Windows up; the person runs decide whether the Mac spike runs before or after the first v0.2.0 candidate. ADR-037's other consequences stand.
