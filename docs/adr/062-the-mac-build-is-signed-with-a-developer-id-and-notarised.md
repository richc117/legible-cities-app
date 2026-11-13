# ADR-062: The Mac build is signed with a Developer ID and notarised

- **Status:** Proposed; it becomes Accepted when a signed candidate has passed
  what "What must be shown first" lists
- **Date:** 2026-11-12
- **Decided by:** the maintainer (issue 686)
- **Supersedes:** [ADR-054](054-1-0-ships-unsigned-with-no-automatic-update.md),
  in part: the Mac's signature. Its "no automatic update" stands, and so
  does the unsigned Windows installer
- **Superseded by:** none
- **See also:** [ADR-037](037-the-first-release-is-unsigned.md), whose checks
  before signing are answered here;
  [ADR-043](043-electrons-ffmpeg-source-is-attached-to-every-release.md),
  whose entitlement is kept

## Context

ADR-054 kept 1.0 unsigned on both systems and named what would reopen it,
among them a change in what a developer membership is worth to the
maintainer. There is now an Apple Developer Program membership (issue 686),
so the Mac build can carry a Developer ID signature and be notarised.
Nothing has changed for Windows: there is no certificate for it.

**What a person meets today.** The Mac app is signed ad hoc
(`electron-builder.yml`, `identity: '-'`). macOS refuses to open it, and a
person gets past that only with `docs/install.md`: on macOS 15 and later,
Done and then **Open Anyway** in System Settings; on 13 and 14,
Control-click and Open (ADR-037, ADR-054). A notarised Developer ID build
opens with the one confirmation macOS gives anything downloaded from the
internet.

**What the build already is.** The ad-hoc build is signed by
electron-builder with the hardened runtime and its three template
entitlements (`com.apple.security.cs.allow-jit`,
`com.apple.security.cs.allow-unsigned-executable-memory`,
`com.apple.security.cs.disable-library-validation`) on the app and on every
nested executable, the bundled Python, the LOOM tools, ffmpeg and ffprobe
among them. The acceptance run passes against it, and nothing is written
inside the bundle (ADR-035), so a signature stays whole. ADR-037 listed
"the Python runtime's entitlements under the hardened runtime" as unknown
until a notarised build is launched. The runtime already runs under the
hardened runtime with those three, in every build and in the acceptance
run, so there is no entitlement left to find, only the notary's own verdict
to obtain.

**What the packager does**, read from the installed sources
(electron-builder, app-builder-lib and dmg-builder 26.18.0,
`@electron/osx-sign` 1.3.3, `@electron/notarize` 2.5.0):

- `mac.identity` is matched as a substring of the names of the keychain's
  valid identities, a "Developer ID Application" certificate first. With
  `forceCodeSigning`, which the base config has always set, no match fails
  the build. `-` is the ad-hoc identity and needs no certificate.
- With `CSC_LINK` and `CSC_KEY_PASSWORD` in its environment electron-builder
  imports the certificate into a temporary keychain of its own and signs
  from that. An **empty** `CSC_LINK` is not read as absent: it is read as a
  certificate to load, and fails.
- `@electron/osx-sign` runs `codesign` once for every file its detector
  calls binary, and `mac.signIgnore` takes patterns of paths to leave out.
  In a darwin-arm64 tree of the vendored components (an earlier pin's,
  measured for this record) the detector flags 1,706 files, and 1,593 of
  them are `.pyc`.
- electron-builder's own notarisation is of the app, never of the disk
  image, and runs inside the packaging call whenever any of its `APPLE_`
  variables is set and `mac.notarize` is not `false`, whatever the identity.
  It waits for the notary with no time limit, and it staples the app.
  dmg-builder neither notarises nor staples.
- `dmg.sign: true` signs the disk image with the same identity, by
  `codesign --sign` with no `--timestamp` argument.

**What Apple asks.** The notary is given the outermost container a person
downloads; the ticket is stapled to what is distributed; and the code
inside must be signed with a Developer ID certificate and a secure
timestamp, its executables with the hardened runtime.

## Options

**Stay ad hoc**, as ADR-054 decided. No secret in CI; every person on a Mac
is walked past a refusal.

**Let electron-builder do all of it**: a Team ID as the identity,
`notarize: true`, the notary's key in electron-builder's variables. One
config and no script. It notarises the app and leaves the disk image, the
file a person downloads, neither notarised nor stapled; its wait has no
limit; and the notary's key sits in the environment of the step that runs
npm's code and the packager's hooks.

**Sign by hand**: a keychain made in the workflow and `codesign` over every
Mach-O in a script of our own. Full control of every flag. It replaces a
signer that every branch build already exercises with one that would run
only in a release, where a mistake is found last.

**electron-builder signs; one script notarises the disk image; the secrets
sit behind a protected environment.** Chosen, below.

**Sign Windows as well.** Not available: there is no certificate, and
ADR-037's note on the signing service's eligibility is unanswered.

## Decision

**Signing stays electron-builder's.** `electron-builder.yml` stays ad hoc,
so every branch and pull-request build, and `npm run dist`, is what it was.
A second file, `electron-builder.release.yml`, extends it and sets three
keys and nothing else: `mac.identity`, the Developer ID Team ID (ten
characters, public, quoted so that an all-digit one stays a string);
`mac.notarize: false`; and `dmg.sign: true`. The values live in a file
because `-c.` overrides on the command line would read an all-digit
identity as a number and `true` as a string. The signed build is therefore
the build every branch tested, under another identity.

**Bytecode is sealed as a resource, not signed.** The base config gains
`mac.signIgnore: '\.pyc$'`. A `.pyc` is data: the bundle's signature covers
it as it covers every other resource, so one changed after signing breaks
the seal as before, and ADR-035's unchecked-hash bytecode is still never
rewritten. What goes is a `codesign` call per file, each of which would ask
Apple's timestamp server under a Developer ID. This is the one change the
ad-hoc build sees.

**The entitlements do not change, and no entitlements file is added.**
ADR-043 asked that signing keep
`com.apple.security.cs.disable-library-validation`, or say how a person
replaces Electron's FFmpeg library: the LGPL asks that a person can use a
modified `libffmpeg.dylib`, a replaced library is not signed by this team,
and ADR-043 found that an app re-signed ad hoc after the replacement
(`codesign --force --deep --sign -`) runs only while library validation
stays disabled. It is kept, which is the first of ADR-043's two answers and
needs nothing new written for a person. The same entitlement is what
electron-builder says an ad-hoc build under the hardened runtime needs in
order to load its own libraries, so both builds carry it for a reason.
`scripts/verify-mac-signing.mjs` holds the app and the bundled Python to it
in every build, signed or not.

**Notarisation is one script, on the disk image only.**
`scripts/notarize-dmg.mjs` submits the image
(`xcrun notarytool submit --wait --timeout 60m`), always fetches the
notary's log, goes on only if the status is `Accepted` and the log holds no
error, staples the ticket to the image and validates it. notarytool exits 0
for a submission the notary rejected, so the exit status is never the
verdict. The image is the outermost thing a person downloads, which is what
the notary is given; its ticket covers the app inside, which macOS looks up
when the app is opened. The app is not stapled: it is not distributed on
its own, and stapling it would change the bundle after the image was built
from it. electron-builder's notarisation is off because it does none of
this for an image and has no time limit.

**Signing mode, and where the secrets are.** A packaging job signs when its
target is a Mac and the run is a pushed `v*` tag or a dispatch with `sign`
ticked. Only then is the job in the `release-signing` environment; for
every other run the job's `environment` expression is the empty string.
The five secrets (the certificate and its password, the notary's key, its
id and its issuer) are the environment's, not the repository's, for three
reasons: a deployment rule limits which refs can reach them at all (tags
that start with `v`, and `main`); a required reviewer has to approve each
job that asks, so a workflow changed on a branch cannot take them by
running; and a job outside the environment is handed nothing, where a
repository secret would be handed to every job of every branch. Inside the
job, the certificate is given to electron-builder under its own variable
names only in the signing branch of the packaging step's shell, never at
the step, because an empty `CSC_LINK` fails every Mac build. The notary's
key is written to a file readable by the runner's user alone, in the
notarising step alone, after every step that runs npm's code or the app
has finished, and removed when that step's shell ends. The script it is
handed to imports nothing but Node's own modules.

**The stapled image is what every later job sees.** Notarising and stapling
happen in the packaging job, before the installer is uploaded, so the
release job checksums, and the attest and verify jobs attest and verify,
the final bytes; none of the three changes.

**What checks it.** `scripts/verify-mac-signing.mjs` has three modes:
`adhoc`, which every unsigned build passes through; `developer-id`, for the
signed app before it is notarised; and `dmg`, for the notarised image and
the app inside it. `acceptance.yml`'s step 2 runs the Developer ID checks
on a Release's own download when the tag carries the release config, and
fails on any of them. What macOS shows a person at the first open stays
"not automated": a runner's download is not quarantined.

**No automatic update, still.** ADR-054's decision on updates is not
touched, and the constitution's principle IV (no update pings) would have
to change first. A signed Mac build could be served by an updater; none is
added.

**Windows stays unsigned, and is called a beta until it has a
certificate.** Its installer is as ADR-054 describes it, SmartScreen's
warning included. Calling it a beta says plainly that one of the two
systems opens with a warning the other no longer has; the wording itself
is issue 687's.

## Consequences

**A person on a Mac gets one confirmation instead of a refusal**, once
this is Accepted and a Release is built this way. `docs/install.md`, the
release notes, the acceptance documents and ADR-037's and ADR-043's
descriptions of the Mac build still say ad hoc; they change with issue 687,
after a rehearsal has shown this works, and not before.

**CI holds secrets for the first time.** ADR-037 and ADR-054 counted "no
secrets in CI" among what staying unsigned bought. What stands in for it is
the environment's rule and reviewer, the two-step separation above, and the
unit tests that hold `build.yml` to it: `secrets.` in three steps only, no
variable of electron-builder's set at a step, one condition for the
environment and for signing, the notarising step after everything npm
runs. The Team ID is public and committed; nothing else about the account
is in the repository.

**A release now depends on Apple's notary.** An outage or a slow day holds
a release where nothing did. The script waits 60 minutes, its step 75 and
the job 120; past that the run fails and is run again. The notary's log is
uploaded as an artefact whatever the outcome.

**The signing path runs only in signing mode.** A dependency bump that
breaks signing is green on its own branch and red at the next tag. A
dispatch with `sign` after a bump of Electron or electron-builder is the
check; it needs the reviewer's approval, by design.

**Replacing Electron's FFmpeg in a notarised app** is as ADR-043 describes
it for the ad-hoc one: the replacement breaks the seal, and the person
re-signs the app ad hoc, with library validation still disabled. The copy
is then theirs: no longer this team's, no longer notarised, and opened on
their own Mac as any locally signed app is. That the re-signed app starts
is still unchecked, as ADR-043 says.

**The certificate will expire.** A signature with a secure timestamp
outlives its certificate, which is one reason the timestamp is checked. A
new certificate is a new pair of secrets in the environment; nothing in
the repository changes unless the team does.

## What must be shown first

The design rests on six things that reading the sources did not settle.
Each is named with what shows it; this record stays Proposed until all six
are shown and a signed candidate has passed the acceptance run.

1. **A job whose `environment` evaluates to the empty string is in no
   environment**: no deployment is recorded and no approval asked. Shown by
   a branch build with no secrets. If it is not so, signing moves to a
   second packaging job that names the environment outright.
2. **A bundle whose `.pyc` files are not signed one by one passes
   `codesign --verify --deep --strict` and launches.** Shown by the same
   branch build: its launch and verify steps.
3. **The notary accepts the bundle.** Shown by the notary's log in a
   dispatch with `sign`.
4. **The notary's credentials can be an App Store Connect API key.** If
   they cannot, notarytool also takes an Apple ID with an app-specific
   password and the Team ID, which changes the script's three variables and
   nothing else.
5. **The disk image's signature carries a secure timestamp**, though
   `dmg.sign` passes no `--timestamp`. The `dmg` mode reads it from
   `codesign -dvv` and fails without. If it is missing, the image is signed
   in the workflow instead, with `codesign --force --timestamp`.
6. **Gatekeeper's assessments are enabled on the hosted runners**, so that
   `spctl`'s verdict there means what it means on a person's Mac. Every Mac
   build prints `spctl --status`, so a branch build says it; the `dmg` mode
   fails if they are off, and treats any `override=` line in a verdict as a
   failure.

It is done when a dispatched build with `sign` makes an image that `spctl`
accepts as Notarized Developer ID and the stapler validates, the acceptance
run passes against a candidate built that way, and a branch build with no
secret is still ad hoc and green.
